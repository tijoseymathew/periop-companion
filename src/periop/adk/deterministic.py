"""Deterministic (no-LLM) pipeline agents: ingestion, transcription, ledger.

Spec §3.3/§3.4/§3.5 model these steps as tools; in the ADK composition they
are custom ``BaseAgent``s in the stage sequence — they always run at a fixed
point of the stage, not at a model's discretion, and their effect is a
state_delta on the Case.
"""

from __future__ import annotations

from pathlib import Path
from typing import AsyncGenerator

from google.adk.agents import BaseAgent
from google.adk.agents.invocation_context import InvocationContext
from google.adk.events import Event, EventActions
from google.genai import types

from periop.adk.runtime import case_delta, emit, get_case
from periop.tools.ingest import has_transcript_inputs, ingest_records, transcript_source


def _event(ctx: InvocationContext, author: str, text: str, delta: dict) -> Event:
    return Event(
        invocation_id=ctx.invocation_id,
        author=author,
        content=types.Content(role="model", parts=[types.Part(text=text)]),
        actions=EventActions(state_delta=delta),
    )


class RecordIngestor(BaseAgent):
    """Chunk the prior-records pack into citable document sources (idempotent)."""

    case_dir: Path

    async def _run_async_impl(
        self, ctx: InvocationContext
    ) -> AsyncGenerator[Event, None]:
        case = get_case(ctx.session.state)
        ingest_records(case, self.case_dir)
        docs = sum(1 for s in case.sources if s.type == "document")
        yield _event(ctx, self.name, f"{docs} document sources", case_delta(case))


class Transcriber(BaseAgent):
    """Register one diarized audio source (gold script offline, ASR for wavs).

    Skips silently when the source is already on the case or the bundle has
    no matching inputs — same contract as the pre-ADK stage functions.
    """

    case_dir: Path
    stem: str
    source_id: str
    stage: str
    label: str

    async def _run_async_impl(
        self, ctx: InvocationContext
    ) -> AsyncGenerator[Event, None]:
        case = get_case(ctx.session.state)
        if case.get_source(self.source_id) is not None or not has_transcript_inputs(
            self.case_dir, self.stem
        ):
            return
        # the ASR leg is its own bar on the waterfall — on live audio it is
        # minutes, not free (ui.md §7)
        emit("agent_start", {"stage": self.stage, "agent": self.label})
        source = transcript_source(self.case_dir, self.stem, self.source_id)
        case.add_source(source)
        emit("agent_end", {"stage": self.stage, "agent": self.label,
                           "summary": f"{len(source.segments)} segments"})
        yield _event(
            ctx, self.name, f"{len(source.segments)} segments", case_delta(case)
        )


class AppendArtifacts(BaseAgent):
    """Append artifacts produced by parallel writers to the ledger in fixed order.

    The post-op writers run concurrently and leave their artifacts in their
    own state keys; this agent commits them handoff-first so the ledger never
    depends on completion order (spec v2-speed §3.4).
    """

    state_keys: list[str]

    async def _run_async_impl(
        self, ctx: InvocationContext
    ) -> AsyncGenerator[Event, None]:
        from periop.schemas import ArtifactRecord

        case = get_case(ctx.session.state)
        for key in self.state_keys:
            artifact = ArtifactRecord.model_validate(ctx.session.state[key])
            case.add_artifact(artifact)
        yield _event(
            ctx, self.name, f"{len(self.state_keys)} artifacts", case_delta(case)
        )


class EmitArtifacts(BaseAgent):
    """Emit ``artifact_complete`` for finished artifacts (stage tail, ui.md §7)."""

    artifact_ids: list[str]

    async def _run_async_impl(
        self, ctx: InvocationContext
    ) -> AsyncGenerator[Event, None]:
        case = get_case(ctx.session.state)
        for artifact_id in self.artifact_ids:
            artifact = case.get_artifact(artifact_id)
            emit("artifact_complete", {
                "artifact_id": artifact_id,
                "claims": len(artifact.claims) if artifact else 0,
            })
        return
        yield  # pragma: no cover — keeps this an async generator
