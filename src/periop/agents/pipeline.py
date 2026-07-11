"""Root ADK pipeline entry points.

``build_case_pipeline`` is the real thing: the three-stage ADK composition
from ``periop.adk.stages`` (LlmAgent steps in stage SequentialAgents, the
Case in session state). ``build_pipeline`` keeps the M0 no-LLM stub pass —
three deterministic stage wrappers over ``periop.pipeline`` — for
``nat run --stub`` and smoke tests.
"""

from collections.abc import AsyncGenerator, Callable

from google.adk.agents import BaseAgent, SequentialAgent
from google.adk.agents.invocation_context import InvocationContext
from google.adk.events import Event, EventActions
from google.genai import types

from periop.adk.runtime import CASE_KEY, run_agent_async
from periop.adk.stages import build_case_pipeline  # noqa: F401  — the real pipeline
from periop.pipeline import run_intraop, run_postop, run_preop
from periop.schemas import Case

CASE_STATE_KEY = CASE_KEY


class StageAgent(BaseAgent):
    """Wraps a Case → Case stage function as an ADK agent (M0 stub path)."""

    stage_fn: Callable[[Case], Case]

    async def _run_async_impl(self, ctx: InvocationContext) -> AsyncGenerator[Event, None]:
        case = Case.model_validate(ctx.session.state[CASE_STATE_KEY])
        case = self.stage_fn(case)
        yield Event(
            invocation_id=ctx.invocation_id,
            author=self.name,
            content=types.Content(
                role="model",
                parts=[types.Part(text=f"{self.name} complete for case {case.case_id}")],
            ),
            actions=EventActions(
                state_delta={CASE_STATE_KEY: case.model_dump(mode="json")}
            ),
        )


def build_pipeline(stages=None) -> SequentialAgent:
    """Build the M0 stub SequentialAgent; pass (name, Case→Case) pairs to
    substitute stage functions. The production path is ``build_case_pipeline``."""
    stages = stages or [
        ("preop_stage", run_preop),
        ("intraop_stage", run_intraop),
        ("postop_stage", run_postop),
    ]
    return SequentialAgent(
        name="periop_pipeline",
        description="Pre-op → intra-op → post-op documentation pipeline",
        sub_agents=[StageAgent(name=name, stage_fn=fn) for name, fn in stages],
    )


async def run_case(case: Case, pipeline: SequentialAgent | None = None) -> Case:
    """Run one case through an ADK pipeline (stub by default); returns the Case."""
    result, _ = await run_agent_async(pipeline or build_pipeline(), case)
    return result
