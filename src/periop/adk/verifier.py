"""ClaimVerifier as an ADK agent (spec §4.3, v2-speed §3.3).

A custom agent that fans one NLI-style generate→validate step out over every
claim of an artifact. Verdicts are independent, so claims are verified in
parallel batches — each batch a dynamically built ``ParallelAgent`` whose
width is ``PERIOP_VERIFIER_CONCURRENCY`` (default 4; ``0``/``1`` =
sequential, the knob for rate-limited hosted endpoints). Each claim gets its
own session-state keys, so branches never contend; verdicts are flagged onto
the claims in place — never dropped — in original ledger order.
"""

from __future__ import annotations

import os
from typing import Any, AsyncGenerator

from google.adk.agents import BaseAgent, ParallelAgent
from google.adk.agents.invocation_context import InvocationContext
from google.adk.events import Event, EventActions
from google.genai import types

from periop.adk.runtime import case_delta, get_case
from periop.adk.steps import structured_step
from periop.schemas import Case, ClaimStatus


def _concurrency() -> int:
    return int(os.environ.get("PERIOP_VERIFIER_CONCURRENCY") or 4)


def _verdict_step(
    name: str, chat: Any, *, input_key: str, verdict_key: str,
    forward_looking: bool, stage: str,
):
    from periop.agents.claim_verifier import (
        FORWARD_LOOKING_PROMPT,
        PROMPT,
        SYSTEM,
        VerifierVerdict,
    )

    template = FORWARD_LOOKING_PROMPT if forward_looking else PROMPT

    def prompt_fn(case: Case, state: Any) -> str:
        payload = state[input_key]
        return template.format(claim=payload["claim"], spans=payload["spans"])

    def apply_fn(case: Case, parsed: VerifierVerdict, state: Any) -> tuple[str, dict]:
        return parsed.status.value, {verdict_key: parsed.status.value}

    return structured_step(
        name=name,
        label="ClaimVerifier",
        stage=stage,
        chat=chat,
        schema=VerifierVerdict,
        system=SYSTEM,
        prompt_fn=prompt_fn,
        apply_fn=apply_fn,
        announce_start=False,
        announce_end=False,
        model_name="nim-fast",
    )


class ClaimVerifierAgent(BaseAgent):
    """Verify every claim of one artifact against its cited spans."""

    artifact_id: str
    forward_looking: bool = False
    chat: Any = None
    stage_label: str = ""

    @classmethod
    def build(
        cls, *, name: str, chat: Any, artifact_id: str,
        forward_looking: bool = False, stage: str = "",
    ) -> "ClaimVerifierAgent":
        return cls(
            name=name,
            artifact_id=artifact_id,
            forward_looking=forward_looking,
            chat=chat,
            stage_label=stage,
        )

    async def _run_async_impl(
        self, ctx: InvocationContext
    ) -> AsyncGenerator[Event, None]:
        from periop.agents.claim_verifier import render_spans

        case = get_case(ctx.session.state)
        artifact = case.get_artifact(self.artifact_id)
        if artifact is None:
            raise KeyError(f"no such artifact: {self.artifact_id}")
        if not artifact.claims:
            return

        # seed every claim's input (text + rendered spans) in one delta, and
        # build one verdict step per claim with its own state keys
        delta: dict[str, Any] = {}
        steps: list[tuple[str, str, BaseAgent]] = []
        for i, claim in enumerate(artifact.claims):
            input_key = f"{self.name}__c{i}__input"
            verdict_key = f"{self.name}__c{i}__verdict"
            delta[input_key] = {
                "claim": claim.text,
                "spans": render_spans(case, claim),
            }
            delta[verdict_key] = None
            steps.append((
                claim.claim_id,
                verdict_key,
                _verdict_step(
                    f"{self.name}_c{i}",
                    self.chat,
                    input_key=input_key,
                    verdict_key=verdict_key,
                    forward_looking=self.forward_looking,
                    stage=self.stage_label,
                ),
            ))
        yield Event(
            invocation_id=ctx.invocation_id,
            author=self.name,
            actions=EventActions(state_delta=delta),
        )

        width = max(1, min(_concurrency(), len(steps)))
        for start in range(0, len(steps), width):
            batch = steps[start : start + width]
            if width == 1 or len(batch) == 1:
                for _, _, step in batch:
                    async for event in step.run_async(ctx):
                        yield event
            else:
                parallel = ParallelAgent(
                    name=f"{self.name}_batch{start // width}",
                    sub_agents=[step for _, _, step in batch],
                )
                async for event in parallel.run_async(ctx):
                    yield event

        # re-read the case (the state is authoritative) and flag in place,
        # in original ledger order
        verdicts = {
            claim_id: ctx.session.state.get(verdict_key)
            for claim_id, verdict_key, _ in steps
        }
        case = get_case(ctx.session.state)
        artifact = case.get_artifact(self.artifact_id)
        for claim in artifact.claims:
            verdict = verdicts.get(claim.claim_id)
            if verdict:
                claim.status = ClaimStatus(verdict)
        yield Event(
            invocation_id=ctx.invocation_id,
            author=self.name,
            content=types.Content(
                role="model",
                parts=[types.Part(text=f"{len(verdicts)} claims verified")],
            ),
            actions=EventActions(state_delta=case_delta(case)),
        )
