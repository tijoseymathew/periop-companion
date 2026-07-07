"""NAT function registration: exposes the ADK pipeline to nat run/serve/eval.

Design rule (spec §3.1): ADK owns orchestration, NAT owns observability and
evaluation. This module is the seam — deliberately narrow so ADK could also
run natively if the plugin integration ever fights us (spec §10).
"""

import asyncio
import contextvars
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

from pydantic import BaseModel, Field

from nat.builder.builder import Builder
from nat.builder.function_info import FunctionInfo
from nat.cli.register_workflow import register_function
from nat.data_models.function import FunctionBaseConfig

import periop.nat.observability  # noqa: F401  — registers _type: periop_langfuse
from periop.schemas import Case
from periop.store import CaseStore


class PeriopPipelineConfig(FunctionBaseConfig, name="periop_pipeline"):
    """Run a case through the pre-op → intra-op → post-op pipeline."""

    case_dir: str = Field(
        default="data/cases",
        description="Directory holding per-case bundles (records/scripts/gold) and outputs",
    )
    stub: bool = Field(
        default=False,
        description="Run the M0 no-LLM stub stages instead of the real agents",
    )


@register_function(config_type=PeriopPipelineConfig)
async def periop_pipeline(config: PeriopPipelineConfig, _builder: Builder):
    from periop.agents.pipeline import build_case_pipeline, run_case
    from periop.nim import fast_chat, reasoning_chat

    # bundles live in <case_dir>/<case_id>/; processed cases in <case_dir>/_out
    store = CaseStore(Path(config.case_dir) / "_out")

    async def _run(case_id: str) -> str:
        case_id = case_id.strip()
        try:
            case = store.load(case_id)
        except KeyError:
            case = Case(case_id=case_id)

        if config.stub:
            pipeline = None
        else:
            case_bundle_dir = Path(config.case_dir) / case_id
            pipeline = build_case_pipeline(
                case_bundle_dir, chat=reasoning_chat(), fast_chat=fast_chat()
            )
        case = await run_case(case, pipeline=pipeline)
        path = store.save(case)
        claims = sum(len(a.claims) for a in case.artifacts)
        artifact_ids = ", ".join(a.artifact_id for a in case.artifacts)
        return f"case {case.case_id}: {len(case.artifacts)} artifacts, {claims} claims [{artifact_ids}] → {path}"

    yield FunctionInfo.from_fn(
        _run,
        description="Run one peri-op case (by case id) through all three stages",
    )


class StageRunInput(BaseModel):
    """Input for one live stage run — the granularity the write API calls at."""

    case_id: str
    stage: str


@dataclass
class StageRunBridge:
    """Per-request plumbing the API hands into the NAT function (spec v2-nat §3.1).

    NAT functions are built once from config with no per-request closure; the
    UI-facing SSE ``emit`` callback (and the app's injected runner + store
    paths) reach the function through a contextvar set just before the API
    enters the NAT ``Runner``. Contextvars propagate through the task chain
    the Runner executes in, so no new transport is needed.
    """

    runner: object
    emit: Callable[[str, dict], None]
    out_dir: Path
    case_dir: Path  # root holding per-case bundles, not the per-case dir


_LIVE_BRIDGE: contextvars.ContextVar[StageRunBridge | None] = contextvars.ContextVar(
    "periop_live_bridge", default=None
)


class PeriopStageRunConfig(FunctionBaseConfig, name="periop_stage_run"):
    """Run one stage of one case — the live write-API entry point."""

    case_dir: str = Field(
        default="data/cases",
        description="Directory holding per-case bundles (records/scripts/gold) and outputs",
    )
    stub: bool = Field(
        default=False,
        description="Run the instant deterministic stub runner instead of the real agents",
    )


@register_function(config_type=PeriopStageRunConfig)
async def periop_stage_run(config: PeriopStageRunConfig, _builder: Builder):
    from periop.api.runner import LivePipelineRunner, StubPipelineRunner

    async def _run(input: StageRunInput) -> str:
        bridge = _LIVE_BRIDGE.get()
        if bridge is None:  # standalone `nat run` — everything from config
            bridge = StageRunBridge(
                runner=StubPipelineRunner() if config.stub else LivePipelineRunner(),
                emit=lambda event, data: None,
                out_dir=Path(config.case_dir) / "_out",
                case_dir=Path(config.case_dir),
            )
        store = CaseStore(bridge.out_dir)
        # never fabricate a case: the write API creates cases, so an unknown
        # id is an error here (unlike periop_pipeline's synthetic-bundle seed)
        case = store.load(input.case_id)
        case_dir = bridge.case_dir / input.case_id
        case = await asyncio.to_thread(
            bridge.runner.run_stage, case, input.stage, case_dir, bridge.emit
        )
        store.save(case)
        return (
            f"case {case.case_id} stage {input.stage}: "
            f"{len(case.artifacts)} artifacts"
        )

    def _parse_input(data: str) -> StageRunInput:
        # `nat run --input '{"case_id": ..., "stage": ...}'` arrives as a string
        return StageRunInput.model_validate_json(data)

    yield FunctionInfo.from_fn(
        _run,
        description="Run one stage of one live case",
        converters=[_parse_input],
    )
