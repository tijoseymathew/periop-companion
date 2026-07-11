"""The three peri-op stages as ADK agent compositions (spec §3.1/§3.3-3.5).

Each stage is a ``SequentialAgent`` over deterministic agents (ingest,
transcription), generate→validate ``LoopAgent`` steps (one per LLM agent of
the spec), and the claim-verifier fan-out. The post-op writers — independent
by design (v2-speed §3.4) — run under a ``ParallelAgent`` with a fixed-order
ledger commit behind them. The root pipeline is the three stages in sequence,
with the Case in session state throughout.

Model tiering (spec §8) is per step: writers/gap analysis/event verification
on the reasoning tier, extraction first pass and claim verification on the
fast tier.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from google.adk.agents import BaseAgent, LoopAgent, ParallelAgent, SequentialAgent

from periop.adk.deterministic import (
    AppendArtifacts,
    EmitArtifacts,
    RecordIngestor,
    Transcriber,
)
from periop.adk.runtime import emit, get_case
from periop.adk.steps import structured_step
from periop.adk.verifier import ClaimVerifierAgent
from periop.agents.context import preview_texts


def gap_analyst_step(chat: Any, *, skip_when_present: bool = True) -> LoopAgent:
    """GapAnalyst (reasoning tier). In the pipeline it is skipped when the
    case already has questions — the live workflow runs gap analysis at
    intake and the provider reviews the list (v2 §4.1)."""
    from periop.agents import gap_analyst

    return structured_step(
        name="gap_analyst",
        label="GapAnalyst",
        stage="preop",
        chat=chat,
        schema=gap_analyst.GapQuestions,
        system=gap_analyst.SYSTEM,
        prompt_fn=gap_analyst.prompt,
        apply_fn=gap_analyst.apply,
        skip_fn=(lambda case, state: bool(case.open_questions))
        if skip_when_present
        else None,
        model_name="nim-reasoning",
    )


def preop_note_step(chat: Any) -> LoopAgent:
    from periop.agents import preop_note

    return structured_step(
        name="preop_note",
        label="PreOpNoteWriter",
        stage="preop",
        chat=chat,
        schema=preop_note.WriterOutput,
        system=preop_note.SYSTEM,
        prompt_fn=preop_note.prompt,
        apply_fn=preop_note.apply,
        model_name="nim-reasoning",
    )


def extractor_steps(fast_chat: Any, reasoning_chat: Any, *, verify: bool = True) -> list[BaseAgent]:
    """EventExtractor: Nano first pass, then Super verification (spec §8).

    One SSE agent bracket for both passes — start announced by the first
    pass, end (with the final event count) by whichever pass is last.
    """
    from periop.agents import event_extractor

    steps: list[BaseAgent] = [
        structured_step(
            name="event_first_pass",
            label="EventExtractor",
            stage="intraop",
            chat=fast_chat,
            schema=event_extractor.ExtractedEvents,
            system=event_extractor.SYSTEM,
            prompt_fn=event_extractor.first_pass_prompt,
            apply_fn=event_extractor.apply_first_pass(final=not verify),
            announce_end=not verify,
            model_name="nim-fast",
        )
    ]
    if verify:
        steps.append(
            structured_step(
                name="event_verify",
                label="EventExtractor",
                stage="intraop",
                chat=reasoning_chat,
                schema=event_extractor.ExtractedEvents,
                system=event_extractor.SYSTEM,
                prompt_fn=event_extractor.verify_prompt,
                apply_fn=event_extractor.apply_verify,
                announce_start=False,
                model_name="nim-reasoning",
            )
        )
    return steps


def intraop_record_step(chat: Any) -> LoopAgent:
    from periop.agents import intraop_record

    return structured_step(
        name="intraop_record",
        label="IntraOpRecordWriter",
        stage="intraop",
        chat=chat,
        schema=intraop_record.WriterOutput,
        system=intraop_record.SYSTEM,
        prompt_fn=intraop_record.prompt,
        apply_fn=intraop_record.apply,
        model_name="nim-reasoning",
    )


def issue_anticipator_step(chat: Any) -> LoopAgent:
    from periop.agents import issue_anticipator

    return structured_step(
        name="issue_anticipator",
        label="IssueAnticipator",
        stage="intraop",
        chat=chat,
        schema=issue_anticipator.AnticipatedIssues,
        system=issue_anticipator.SYSTEM,
        prompt_fn=issue_anticipator.prompt,
        apply_fn=issue_anticipator.apply,
        model_name="nim-reasoning",
    )


def handoff_step(chat: Any, *, announce: bool = True) -> LoopAgent:
    from periop.agents import handoff

    return structured_step(
        name="handoff",
        label="HandoffComposer",
        stage="postop",
        chat=chat,
        schema=handoff.HandoffPlan,
        system=handoff.SYSTEM,
        prompt_fn=handoff.prompt,
        apply_fn=handoff.apply,
        announce_start=announce,
        announce_end=announce,
        artifact_state_key=handoff.HANDOFF_STATE_KEY if announce else None,
        model_name="nim-reasoning",
    )


def postop_eval_step(chat: Any, *, announce: bool = True) -> LoopAgent:
    from periop.agents import postop_eval

    return structured_step(
        name="postop_eval",
        label="PostAnesthesiaEvaluator",
        stage="postop",
        chat=chat,
        schema=postop_eval.WriterOutput,
        system=postop_eval.SYSTEM,
        prompt_fn=postop_eval.prompt,
        apply_fn=postop_eval.apply,
        announce_start=announce,
        announce_end=announce,
        artifact_state_key=postop_eval.POSTOP_STATE_KEY if announce else None,
        model_name="nim-reasoning",
    )


def _verifier_block(
    name: str, stage: str, chat: Any, artifacts: list[tuple[str, bool]]
) -> SequentialAgent:
    """ClaimVerifier over one or more artifacts, one SSE bracket (ui.md §7)."""

    def _start(callback_context):
        emit("agent_start", {"stage": stage, "agent": "ClaimVerifier"})
        return None

    def _end(callback_context):
        case = get_case(callback_context.state)
        lines = [
            f"{claim.status.value}: {claim.text}"
            for artifact_id, _ in artifacts
            if (artifact := case.get_artifact(artifact_id)) is not None
            for claim in artifact.claims
        ]
        emit("agent_end", {
            "stage": stage, "agent": "ClaimVerifier", "summary": "verified",
            "preview": preview_texts(lines),
        })
        return None

    return SequentialAgent(
        name=name,
        sub_agents=[
            ClaimVerifierAgent.build(
                name=f"{name}_{i}",
                chat=chat,
                artifact_id=artifact_id,
                forward_looking=forward,
                stage=stage,
            )
            for i, (artifact_id, forward) in enumerate(artifacts)
        ],
        before_agent_callback=_start,
        after_agent_callback=_end,
    )


def build_preop_stage(case_dir: Path | str, chat: Any, verifier_chat: Any = None) -> SequentialAgent:
    """Pre-op (spec §3.3): ingest → gap analysis → interview → note → verify."""
    from periop.agents.preop_note import PREOP_NOTE_ID

    case_dir = Path(case_dir)
    verifier_chat = verifier_chat or chat
    return SequentialAgent(
        name="preop_stage",
        description="Pre-op: records, gap analysis, interview, pre-anesthesia note",
        sub_agents=[
            RecordIngestor(name="record_ingestor", case_dir=case_dir),
            gap_analyst_step(chat),
            Transcriber(
                name="interview_transcriber",
                case_dir=case_dir,
                stem="preop-interview",
                source_id="audio:preop-interview",
                stage="preop",
                label="InterviewTranscriber",
            ),
            preop_note_step(chat),
            _verifier_block(
                "preop_verifier", "preop", verifier_chat, [(PREOP_NOTE_ID, False)]
            ),
            EmitArtifacts(name="preop_artifacts", artifact_ids=[PREOP_NOTE_ID]),
        ],
    )


def build_intraop_stage(case_dir: Path | str, chat: Any, fast_chat: Any = None) -> SequentialAgent:
    """Intra-op (spec §3.4): transcribe → extract (2-tier) → record → issues → verify."""
    from periop.agents.intraop_record import INTRAOP_RECORD_ID
    from periop.agents.issue_anticipator import ANTICIPATED_ISSUES_ID

    case_dir = Path(case_dir)
    fast_chat = fast_chat or chat
    return SequentialAgent(
        name="intraop_stage",
        description="Intra-op: voice notes, event extraction, record, anticipated issues",
        sub_agents=[
            Transcriber(
                name="voice_note_transcriber",
                case_dir=case_dir,
                stem="intraop-notes",
                source_id="audio:intraop-notes",
                stage="intraop",
                label="VoiceNoteTranscriber",
            ),
            *extractor_steps(fast_chat, chat, verify=True),
            intraop_record_step(chat),
            issue_anticipator_step(chat),
            _verifier_block(
                "intraop_verifier",
                "intraop",
                fast_chat,
                [(INTRAOP_RECORD_ID, False), (ANTICIPATED_ISSUES_ID, True)],
            ),
            EmitArtifacts(
                name="intraop_artifacts",
                artifact_ids=[INTRAOP_RECORD_ID, ANTICIPATED_ISSUES_ID],
            ),
        ],
    )


def build_postop_stage(case_dir: Path | str, chat: Any, fast_chat: Any = None) -> SequentialAgent:
    """Post-op (spec §3.5): transcribe → (handoff ∥ eval note) → commit → verify."""
    from periop.agents.handoff import HANDOFF_ID, HANDOFF_STATE_KEY
    from periop.agents.postop_eval import POSTOP_NOTE_ID, POSTOP_STATE_KEY

    case_dir = Path(case_dir)
    fast_chat = fast_chat or chat
    return SequentialAgent(
        name="postop_stage",
        description="Post-op: interview, PACU handoff, post-anesthesia evaluation",
        sub_agents=[
            Transcriber(
                name="postop_transcriber",
                case_dir=case_dir,
                stem="postop-interview",
                source_id="audio:postop-interview",
                stage="postop",
                label="PostOpTranscriber",
            ),
            # the two reasoning calls are independent by design: the handoff
            # composes from existing claims, the evaluator reads only sources
            ParallelAgent(
                name="postop_writers",
                sub_agents=[handoff_step(chat), postop_eval_step(chat)],
            ),
            AppendArtifacts(
                name="postop_ledger",
                state_keys=[HANDOFF_STATE_KEY, POSTOP_STATE_KEY],
            ),
            _verifier_block(
                "postop_verifier",
                "postop",
                fast_chat,
                [(HANDOFF_ID, False), (POSTOP_NOTE_ID, False)],
            ),
        ],
    )


def build_case_pipeline(case_dir: Path | str, chat: Any, fast_chat: Any = None) -> SequentialAgent:
    """The full pre-op → intra-op → post-op pipeline over one case bundle."""
    fast_chat = fast_chat or chat
    return SequentialAgent(
        name="periop_pipeline",
        description="Pre-op → intra-op → post-op documentation pipeline",
        sub_agents=[
            build_preop_stage(case_dir, chat, verifier_chat=fast_chat),
            build_intraop_stage(case_dir, chat, fast_chat=fast_chat),
            build_postop_stage(case_dir, chat, fast_chat=fast_chat),
        ],
    )
