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


def build_pipeline(stages=None) -> SequentialAgent:
    """Build the ADK SequentialAgent. Defaults to the M0 stubs; pass real
    (name, Case→Case) stage functions for the production path."""
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


def build_case_pipeline(case_dir, chat, fast_chat=None) -> SequentialAgent:
    """ADK pipeline whose stages run the real agents against ``case_dir``.

    Model tiers are bound into the stage closures; the Case rides in ADK
    session state so every stage's LLM/tool calls land in the NAT profiler.
    """
    from functools import partial

    from periop.agents.stages import run_intraop_stage, run_postop_stage
    from periop.agents.preop_stage import run_preop_stage

    fast_chat = fast_chat or chat
    return build_pipeline(
        [
            ("preop_stage", lambda c: run_preop_stage(c, case_dir, chat=chat, verifier_chat=fast_chat)),
            ("intraop_stage", lambda c: run_intraop_stage(c, case_dir, chat=chat, fast_chat=fast_chat)),
            ("postop_stage", lambda c: run_postop_stage(c, case_dir, chat=chat, fast_chat=fast_chat)),
        ]
    )


async def run_case(case: Case, pipeline: SequentialAgent | None = None) -> Case:
    """Run one case through an ADK pipeline (stub by default); returns the Case."""
    runner = InMemoryRunner(agent=pipeline or build_pipeline(), app_name="periop")
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
