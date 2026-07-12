"""Stage seams for intra-op and post-op, plus a full-case runner.

Each function keeps the historical Case → Case signature but executes the
corresponding ADK stage agent (``periop.adk.stages``). `chat` is the
reasoning tier; `fast_chat` is the fast tier used for the event-extraction
first pass and claim verification. Both are injected (live NimChat, or stubs
in tests). `emit` is an optional progress callback ``emit(event, data)``
feeding the SSE stream (ui.md §7).

Post-op's two reasoning calls overlap (spec v2-speed §3.4) under an ADK
``ParallelAgent``: the HandoffComposer composes from existing signed-off
claims and the PostAnesthesiaEvaluator reads only the case sources — neither
reads the other's output, and a fixed-order ledger commit keeps the artifact
order deterministic. Intra-op stays sequential: the IssueAnticipator renders
the intra-op record's claims into its prompt, a real data dependency.
"""

from pathlib import Path

from periop.adk.runtime import run_agent, sync_case
from periop.adk.stages import (
    build_case_pipeline,
    build_intraop_stage,
    build_postop_stage,
)
from periop.agents.preop_stage import run_preop_stage  # noqa: F401  — stage seam set
from periop.schemas import Case


def run_intraop_stage(case: Case, case_dir: Path | str, chat, fast_chat=None, emit=None) -> Case:
    stage = build_intraop_stage(Path(case_dir), chat, fast_chat=fast_chat)
    result, _ = run_agent(stage, case, emit_fn=emit)
    return sync_case(case, result)


def run_postop_stage(case: Case, case_dir: Path | str, chat, fast_chat=None, emit=None) -> Case:
    stage = build_postop_stage(Path(case_dir), chat, fast_chat=fast_chat)
    result, _ = run_agent(stage, case, emit_fn=emit)
    return sync_case(case, result)


def run_case_stages(case: Case, case_dir: Path | str, chat, fast_chat=None) -> Case:
    """Run all three stages end-to-end on one case, in one ADK session."""
    pipeline = build_case_pipeline(Path(case_dir), chat, fast_chat=fast_chat)
    result, _ = run_agent(pipeline, case)
    return sync_case(case, result)
