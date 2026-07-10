"""Pre-op stage seam (spec §3.3).

``run_preop_stage`` keeps the historical Case → Case signature the write API,
CLI, and tests call, but the execution is the ADK ``preop_stage``
SequentialAgent (``periop.adk.stages.build_preop_stage``):

  1. RecordIngestor (deterministic agent) → chunked document sources
  2. GapAnalyst step → clarification questions — skipped when questions
     already exist (the live workflow runs the GapAnalyst at intake and the
     provider reviews the list, v2 §4.1)
  3. InterviewTranscriber (deterministic agent) → diarized audio source
  4. PreOpNoteWriter step → claim-structured pre-anesthesia note
  5. ClaimVerifier fan-out → supported/unsupported/conflicting per claim

`chat` is injected (reasoning-tier NimChat live, or a stub in tests). A
separate fast-tier chat verifies; `emit` is an optional progress callback
``emit(event, data)`` feeding the SSE stream (ui.md §7).
"""

from pathlib import Path

from periop.adk.runtime import run_agent, sync_case
from periop.adk.stages import build_preop_stage
from periop.schemas import Case


def run_preop_stage(
    case: Case, case_dir: Path | str, chat, verifier_chat=None, emit=None
) -> Case:
    stage = build_preop_stage(Path(case_dir), chat, verifier_chat=verifier_chat)
    result, _ = run_agent(stage, case, emit_fn=emit)
    return sync_case(case, result)
