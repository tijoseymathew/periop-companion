"""Pre-op stage orchestration (spec §3.3).

Composes the pre-op steps against one Case:
  1. ingest records → chunked document sources
  2. GapAnalyst → clarification questions (stored as open_questions) —
     skipped when questions already exist (the live workflow runs the
     GapAnalyst at intake and the provider reviews the list, v2 §4.1)
  3. interview transcript → diarized audio source (gold path offline,
     ASR for live-captured wavs)
  4. PreOpNoteWriter → claim-structured pre-anesthesia note
  5. ClaimVerifier → supported/unsupported/conflicting per claim

`chat` is injected (reasoning-tier NimChat live, or a stub in tests). A
separate fast-tier chat verifies; both default to the module's live clients.
`emit` is an optional progress callback ``emit(event, data)`` feeding the SSE
stream (ui.md §7); it must not perturb the pipeline itself.
"""

from pathlib import Path

from periop.agents.claim_verifier import ClaimVerifier
from periop.agents.gap_analyst import GapAnalyst
from periop.agents.preop_note import PREOP_NOTE_ID, PreOpNoteWriter
from periop.schemas import Case
from periop.tools.ingest import has_transcript_inputs, ingest_records, transcript_source


def _noop(event: str, data: dict) -> None:
    pass


def run_preop_stage(
    case: Case, case_dir: Path | str, chat, verifier_chat=None, emit=None
) -> Case:
    case_dir = Path(case_dir)
    verifier_chat = verifier_chat or chat
    emit = emit or _noop

    ingest_records(case, case_dir)
    if not case.open_questions:
        emit("agent_start", {"stage": "preop", "agent": "GapAnalyst"})
        questions = GapAnalyst(chat=chat).analyze(case)
        emit(
            "agent_end",
            {"stage": "preop", "agent": "GapAnalyst", "summary": f"{len(questions)} questions"},
        )

    if case.get_source("audio:preop-interview") is None and has_transcript_inputs(
        case_dir, "preop-interview"
    ):
        case.add_source(transcript_source(case_dir, "preop-interview", "audio:preop-interview"))

    emit("agent_start", {"stage": "preop", "agent": "PreOpNoteWriter"})
    note = PreOpNoteWriter(chat=chat).write(case)
    emit(
        "agent_end",
        {"stage": "preop", "agent": "PreOpNoteWriter", "summary": f"{len(note.claims)} claims"},
    )
    emit("agent_start", {"stage": "preop", "agent": "ClaimVerifier"})
    ClaimVerifier(chat=verifier_chat).verify(case, PREOP_NOTE_ID)
    emit("agent_end", {"stage": "preop", "agent": "ClaimVerifier", "summary": "verified"})
    emit("artifact_complete", {"artifact_id": PREOP_NOTE_ID, "claims": len(note.claims)})
    return case
