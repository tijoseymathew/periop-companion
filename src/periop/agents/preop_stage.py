"""Pre-op stage orchestration (spec §3.3).

Composes the pre-op steps against one Case:
  1. ingest records → chunked document sources
  2. GapAnalyst → clarification questions (stored as open_questions)
  3. interview transcript → diarized audio source (gold path offline)
  4. PreOpNoteWriter → claim-structured pre-anesthesia note
  5. ClaimVerifier → supported/unsupported/conflicting per claim

`chat` is injected (reasoning-tier NimChat live, or a stub in tests). A
separate fast-tier chat verifies; both default to the module's live clients.
"""

from pathlib import Path

from periop.agents.claim_verifier import ClaimVerifier
from periop.agents.gap_analyst import GapAnalyst
from periop.agents.preop_note import PREOP_NOTE_ID, PreOpNoteWriter
from periop.schemas import Case
from periop.tools.ingest import ingest_records, transcript_source


def run_preop_stage(
    case: Case, case_dir: Path | str, chat, verifier_chat=None
) -> Case:
    case_dir = Path(case_dir)
    verifier_chat = verifier_chat or chat

    ingest_records(case, case_dir)
    GapAnalyst(chat=chat).analyze(case)

    preop_script = case_dir / "scripts" / "preop-interview.json"
    if preop_script.exists() and case.get_source("audio:preop-interview") is None:
        case.add_source(transcript_source(case_dir, "preop-interview", "audio:preop-interview"))

    PreOpNoteWriter(chat=chat).write(case)
    ClaimVerifier(chat=verifier_chat).verify(case, PREOP_NOTE_ID)
    return case
