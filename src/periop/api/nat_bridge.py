"""Run one live stage inside the shared NAT ``Runner`` (spec v2-nat §3.3).

The stage-run worker thread calls :func:`run_stage_in_nat`, which opens its
own event loop around the NAT session — NAT's documented per-request pattern
(``Runner.__aenter__`` restores a saved build-phase context precisely because
"HTTP requests in nat serve run in different async contexts"). The app's
injected runner and the UI-facing SSE ``emit`` callback travel through the
``_LIVE_BRIDGE`` contextvar; NAT's intermediate-step stream is a second,
parallel channel and never leaks into the SSE vocabulary.
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Callable
from pathlib import Path

logger = logging.getLogger(__name__)


def run_stage_in_nat(
    nat_sessions,
    runner,
    case_id: str,
    stage: str,
    out_dir: Path,
    case_dir: Path,
    emit: Callable[[str, dict], None],
    mode: str = "stage",
) -> str:
    """Blocking; call from the worker thread. Returns the workflow result."""
    from nat.builder.runtime_event_subscriber import pull_intermediate

    from periop.nat.register import _LIVE_BRIDGE, StageRunBridge, StageRunInput

    async def go() -> str:
        _LIVE_BRIDGE.set(
            StageRunBridge(runner=runner, emit=emit, out_dir=out_dir, case_dir=case_dir)
        )
        message = StageRunInput(case_id=case_id, stage=stage, mode=mode)
        async with nat_sessions.run(message) as nat_runner:
            # subscribe before the workflow starts (same shape as `nat eval`)
            steps_task = asyncio.ensure_future(pull_intermediate())
            runner_task = asyncio.create_task(nat_runner.result(to_type=str))
            result = await runner_task
            steps = await steps_task
        logger.info(
            "case %s %s ran inside NAT: %d intermediate steps [%s]",
            case_id,
            "gap analysis" if mode == "gap_analysis" else f"stage {stage}",
            len(steps),
            ",".join(s["payload"]["event_type"] for s in steps),
        )
        return result

    return asyncio.run(go())


def run_gap_analysis_in_nat(
    nat_sessions, runner, case_id: str, out_dir: Path, case_dir: Path
) -> str:
    """Blocking; call from the gap-analysis worker thread (v2-speed §3.2).

    No SSE channel exists at intake — progress reaches the provider through
    ``gap_analysis`` state on the case, which the intake screen polls.
    """
    return run_stage_in_nat(
        nat_sessions,
        runner,
        case_id,
        "preop",
        out_dir,
        case_dir,
        lambda event, data: None,
        mode="gap_analysis",
    )
