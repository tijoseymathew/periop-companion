"""The structured generation step: a ``LoopAgent`` generate→validate cycle.

Each LLM step in the pipeline is built from the same three parts (spec §4.1:
writers emit structured output; hallucinated citations are dropped, not kept):

- a **writer** ``LlmAgent`` whose user message is rendered from the Case in
  session state (plus the shared JSON-Schema instruction block from
  ``periop.nim``, so live prompts match the pre-ADK pipeline byte for byte);
- a **validator** custom agent that parses the reply against the step's
  pydantic schema and, on success, runs the step's ``apply_fn`` (citation
  filtering, artifact/ledger writes) and escalates out of the loop;
- the enclosing ``LoopAgent``, whose iterations are the structured-output
  retries — a rejected reply feeds its validation error back into the next
  writer turn, and exhausting ``max_attempts`` raises exactly like
  ``NimChat.complete_structured`` did.
"""

from __future__ import annotations

from typing import Any, AsyncGenerator, Callable, Mapping

from google.adk.agents import BaseAgent, LlmAgent, LoopAgent
from google.adk.agents.invocation_context import InvocationContext
from google.adk.events import Event, EventActions
from google.genai import types
from pydantic import BaseModel, ValidationError

from periop.adk.model import ChatModel
from periop.adk.runtime import emit, get_case
from periop.nim import first_valid, retry_feedback, structured_prompt
from periop.schemas import Case

# prompt_fn(case, state) -> the step's user prompt
PromptFn = Callable[[Case, Mapping[str, Any]], str]
# apply_fn(case, parsed, state) -> (agent_end summary, extra state delta);
# include the updated case in the delta via runtime.case_delta when mutated
ApplyFn = Callable[[Case, Any, Mapping[str, Any]], tuple[str, dict[str, Any]]]
SkipFn = Callable[[Case, Mapping[str, Any]], bool]


def _keys(name: str) -> dict[str, str]:
    return {
        "raw": f"{name}__raw",
        "err": f"{name}__error",
        "att": f"{name}__attempts",
    }


class StructuredValidator(BaseAgent):
    """Parses the writer's reply; applies it on success, feeds back on failure."""

    schema_cls: type[BaseModel]
    apply_fn: ApplyFn
    raw_key: str
    err_key: str
    att_key: str
    max_attempts: int
    stage: str
    label: str
    announce_end: bool
    artifact_state_key: str | None = None
    """When set, the artifact this step parked in state (parallel writers)
    gets its ``artifact_complete`` emitted right after ``agent_end`` — the
    old completion-order SSE contract (ui.md §7)."""

    async def _run_async_impl(
        self, ctx: InvocationContext
    ) -> AsyncGenerator[Event, None]:
        state = ctx.session.state
        reply = state.get(self.raw_key) or ""
        attempt = int(state.get(self.att_key) or 0) + 1
        try:
            parsed = first_valid(reply, self.schema_cls)
        except (ValueError, ValidationError) as exc:
            if attempt >= self.max_attempts:
                raise ValueError(
                    f"{self.label}: model failed to produce valid "
                    f"{self.schema_cls.__name__} after {attempt} attempts"
                ) from exc
            yield Event(
                invocation_id=ctx.invocation_id,
                author=self.name,
                content=types.Content(
                    role="model",
                    parts=[types.Part(text=f"attempt {attempt} rejected: {exc}")],
                ),
                actions=EventActions(
                    state_delta={self.err_key: str(exc), self.att_key: attempt}
                ),
            )
            return

        case = get_case(state)
        summary, extra = self.apply_fn(case, parsed, state)
        if self.announce_end:
            emit("agent_end", {"stage": self.stage, "agent": self.label,
                               "summary": summary})
        if self.artifact_state_key and self.artifact_state_key in extra:
            artifact = extra[self.artifact_state_key]
            emit("artifact_complete", {
                "artifact_id": artifact["artifact_id"],
                "claims": len(artifact["claims"]),
            })
        yield Event(
            invocation_id=ctx.invocation_id,
            author=self.name,
            content=types.Content(role="model", parts=[types.Part(text=summary)]),
            actions=EventActions(
                state_delta={self.err_key: None, self.att_key: 0, **extra},
                escalate=True,
            ),
        )


def structured_step(
    *,
    name: str,
    label: str,
    stage: str,
    chat: Any,
    schema: type[BaseModel],
    system: str,
    prompt_fn: PromptFn,
    apply_fn: ApplyFn,
    skip_fn: SkipFn | None = None,
    announce_start: bool = True,
    announce_end: bool = True,
    artifact_state_key: str | None = None,
    max_attempts: int = 3,
    model_name: str = "nim",
) -> LoopAgent:
    """Build one generate→validate step of the pipeline."""
    keys = _keys(name)
    text_path = hasattr(chat, "complete")

    def _before_model(callback_context, llm_request):
        case = get_case(callback_context.state)
        prompt = prompt_fn(case, callback_context.state)
        if text_path:
            prompt = structured_prompt(prompt, schema)
            err = callback_context.state.get(keys["err"])
            if err:
                prompt = retry_feedback(
                    prompt, callback_context.state.get(keys["raw"]) or "", err
                )
        # exactly one user turn and the step's own system prompt — never the
        # session transcript, and none of ADK's identity boilerplate
        llm_request.contents = [
            types.Content(role="user", parts=[types.Part(text=prompt)])
        ]
        llm_request.config.system_instruction = system
        return None

    writer = LlmAgent(
        name=f"{name}_writer",
        model=ChatModel(model=model_name, chat=chat, schema_hint=schema),
        instruction=system,
        include_contents="none",
        before_model_callback=_before_model,
        output_key=keys["raw"],
    )
    validator = StructuredValidator(
        name=f"{name}_validator",
        schema_cls=schema,
        apply_fn=apply_fn,
        raw_key=keys["raw"],
        err_key=keys["err"],
        att_key=keys["att"],
        max_attempts=max_attempts,
        stage=stage,
        label=label,
        announce_end=announce_end,
        artifact_state_key=artifact_state_key,
    )

    def _before_agent(callback_context):
        if skip_fn is not None and skip_fn(
            get_case(callback_context.state), callback_context.state
        ):
            return types.Content(
                role="model", parts=[types.Part(text=f"{label}: skipped")]
            )
        if announce_start:
            emit("agent_start", {"stage": stage, "agent": label})
        return None

    return LoopAgent(
        name=name,
        max_iterations=max_attempts,
        sub_agents=[writer, validator],
        before_agent_callback=_before_agent,
    )
