"""NAT function registration: exposes the ADK pipeline to nat run/serve/eval.

Design rule (spec §3.1): ADK owns orchestration, NAT owns observability and
evaluation. This module is the seam — deliberately narrow so ADK could also
run natively if the plugin integration ever fights us (spec §10).
"""

from pydantic import Field

from nat.builder.builder import Builder
from nat.builder.function_info import FunctionInfo
from nat.cli.register_workflow import register_function
from nat.data_models.function import FunctionBaseConfig

from periop.schemas import Case
from periop.store import CaseStore


class PeriopPipelineConfig(FunctionBaseConfig, name="periop_pipeline"):
    """Run a case through the pre-op → intra-op → post-op pipeline."""

    case_dir: str = Field(
        default="data/cases",
        description="Directory holding per-case JSON files (created if missing)",
    )


@register_function(config_type=PeriopPipelineConfig)
async def periop_pipeline(config: PeriopPipelineConfig, _builder: Builder):
    from periop.agents.pipeline import run_case

    store = CaseStore(config.case_dir)

    async def _run(case_id: str) -> str:
        case_id = case_id.strip()
        try:
            case = store.load(case_id)
        except KeyError:
            case = Case(case_id=case_id)
        case = await run_case(case)
        path = store.save(case)
        artifact_ids = ", ".join(a.artifact_id for a in case.artifacts)
        return f"case {case.case_id}: produced [{artifact_ids}] → {path}"

    yield FunctionInfo.from_fn(
        _run,
        description="Run one peri-op case (by case id) through all three stages",
    )
