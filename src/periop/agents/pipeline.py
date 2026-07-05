"""ADK orchestration: the three stage functions wrapped as a SequentialAgent.

The Case travels in ADK session state under the ``"case"`` key (spec §3.1:
session state = the Case object). Stage agents are deterministic wrappers —
LLM calls live inside the stage functions' tools, not in the orchestration.
"""

from collections.abc import AsyncGenerator, Callable

from google.adk.agents import BaseAgent, SequentialAgent
from google.adk.agents.invocation_context import InvocationContext
from google.adk.events import Event, EventActions
from google.adk.runners import InMemoryRunner
from google.genai import types

from periop.pipeline import run_intraop, run_postop, run_preop
from periop.schemas import Case

CASE_STATE_KEY = "case"


class StageAgent(BaseAgent):
    """Wraps a Case → Case stage function as an ADK agent."""

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


def build_pipeline() -> SequentialAgent:
    return SequentialAgent(
        name="periop_pipeline",
        description="Pre-op → intra-op → post-op documentation pipeline",
        sub_agents=[
            StageAgent(name="preop_stage", stage_fn=run_preop),
            StageAgent(name="intraop_stage", stage_fn=run_intraop),
            StageAgent(name="postop_stage", stage_fn=run_postop),
        ],
    )


async def run_case(case: Case) -> Case:
    """Run one case through the full pipeline; returns the updated Case."""
    runner = InMemoryRunner(agent=build_pipeline(), app_name="periop")
    session = await runner.session_service.create_session(
        app_name="periop",
        user_id="periop",
        state={CASE_STATE_KEY: case.model_dump(mode="json")},
    )
    async for _ in runner.run_async(
        user_id="periop",
        session_id=session.id,
        new_message=types.Content(role="user", parts=[types.Part(text="run")]),
    ):
        pass
    final = await runner.session_service.get_session(
        app_name="periop", user_id="periop", session_id=session.id
    )
    return Case.model_validate(final.state[CASE_STATE_KEY])
