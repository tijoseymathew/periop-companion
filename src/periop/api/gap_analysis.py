"""Background intake gap analysis (spec v2-speed §3.2).

Document uploads return once the document is durable; question prep runs on
its own worker thread inside the shared NAT session, serialized with stage
runs by the same ``RUN_LOCK`` (one generation in flight per server). The
launch stamps ``gap_analysis`` on the case's pre-op stage so the intake
screen can poll: pending → running → complete | failed.
"""

from __future__ import annotations

import threading

from periop.api.run_lock import RUN_LOCK
from periop.schemas import Case, GapAnalysisState
from periop.store import CaseStore


def launch_gap_analysis(app_state, case_id: str) -> Case:
    """Stamp ``pending``, start the worker, return the stamped case."""
    store = CaseStore(app_state.out_dir)
    case = _stamp(store, case_id, GapAnalysisState.PENDING)
    nat_sessions = app_state.nat_sessions
    runner = app_state.runner
    out_dir, case_dir = app_state.out_dir, app_state.case_dir

    def work() -> None:
        from periop.api.nat_bridge import run_gap_analysis_in_nat

        # if a stage run holds the lock, wait here — in the worker, never in
        # the provider's upload request
        with RUN_LOCK:
            _stamp(store, case_id, GapAnalysisState.RUNNING)
            try:
                run_gap_analysis_in_nat(nat_sessions, runner, case_id, out_dir, case_dir)
            except Exception as e:
                _stamp(store, case_id, GapAnalysisState.FAILED, error=str(e))
            else:
                _stamp(store, case_id, GapAnalysisState.COMPLETE)

    threading.Thread(target=work, daemon=True, name=f"gap-analysis-{case_id}").start()
    return case


def _stamp(
    store: CaseStore, case_id: str, state: GapAnalysisState, error: str | None = None
) -> Case:
    def apply(case: Case) -> None:
        stage = case.workflow.stages["preop"]
        stage.gap_analysis = state
        stage.gap_analysis_error = error

    # mutate, not save: the provider keeps uploading documents while the
    # analysis runs, and a stale whole-object save would swallow them
    return store.mutate(case_id, apply)


def fail_interrupted_analyses(out_dir) -> None:
    """Boot-time sweep: a crash mid-analysis must not strand a case.

    ``pending``/``running`` states belong to threads of a live process; on a
    fresh boot any survivor is an orphan — mark it failed so both retry paths
    (the next upload, ``POST …/questions/analyze``) open up.
    """
    store = CaseStore(out_dir)
    for case_id in store.list_case_ids():
        try:
            case = store.load(case_id)
        except Exception:
            continue
        if case.workflow is None:
            continue
        stage = case.workflow.stages["preop"]
        if stage.gap_analysis in (GapAnalysisState.PENDING, GapAnalysisState.RUNNING):
            stage.gap_analysis = GapAnalysisState.FAILED
            stage.gap_analysis_error = (
                "interrupted by a server restart — add the next record or "
                "re-run the analysis to retry"
            )
            store.save(case)
