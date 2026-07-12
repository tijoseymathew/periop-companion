"""Push NimChat LLM calls onto the NAT event stream (spec §3.1, §6).

The chat client hits build.nvidia.com's OpenAI endpoint directly, below the
level NAT's framework hooks instrument (the ADK plugin only patches litellm),
so the client emits its own LLM_START/LLM_END intermediate steps with token
usage. NAT's profiler and OTel exporters consume these; outside a NAT run
the event stream has no subscribers and emission is a harmless no-op.

Loop safety: NAT's OTel exporters react to a step by calling
``asyncio.create_task`` in the thread that pushed it, so a step pushed from a
thread without a running event loop (the ADK model adapter runs every NimChat
completion in ``asyncio.to_thread``) is dropped with "Cannot create export
task … no running event loop". The registered NAT functions therefore bind
their session loop via :func:`bind_export_loop`, and :func:`_push` marshals
any off-loop step onto it — contextvars carry the binding through ADK's task
tree and ``to_thread`` workers.
"""

from __future__ import annotations

import asyncio
import contextvars
import logging
import time
from collections.abc import Iterator
from contextlib import contextmanager
from typing import Any

from nat.builder.context import Context, ContextState
from nat.builder.intermediate_step_manager import IntermediateStepManager
from nat.data_models.intermediate_step import (
    IntermediateStepPayload,
    IntermediateStepType,
    StreamEventData,
    TraceMetadata,
    UsageInfo,
)
from nat.data_models.token_usage import TokenUsageBaseModel

logger = logging.getLogger(__name__)

_EXPORT_LOOP: contextvars.ContextVar[asyncio.AbstractEventLoop | None] = (
    contextvars.ContextVar("periop_nat_export_loop", default=None)
)


def bind_export_loop() -> None:
    """Adopt the calling coroutine's loop as the step destination.

    Call once at the top of a NAT function body: the loop lives for the whole
    session, so export tasks created on it always get to run (and flush)
    before the exporter shuts down.
    """
    _EXPORT_LOOP.set(asyncio.get_running_loop())


def set_trace_session(session_id: str) -> None:
    """Group this run's Langfuse trace under ``session_id`` (one id per case).

    NAT's span exporter copies ``conversation_id`` onto every span it emits as
    a ``session.id`` attribute, and Langfuse adopts that attribute — found on
    any span of a trace — as the trace's Session. Setting the case id here
    makes all of a case's generations (gap analysis, pre/intra/post-op stage
    runs, retries) one Langfuse session, each run one trace inside it.

    Call at the top of a NAT function body. Spans opened before the function
    body runs (the WORKFLOW_START root span) miss the attribute on this path;
    the API bridge additionally passes the id through ``SessionManager.session``
    so live runs carry it on the root span too.
    """
    ContextState.get().conversation_id.set(session_id)


def _push(step_manager: IntermediateStepManager, payload: IntermediateStepPayload) -> None:
    """Push a step from any thread without losing its export.

    On a thread with a running loop the push is direct (exporter tasks land
    on that loop, as NAT expects). Off-loop, the push is marshaled to the
    bound session loop with this thread's context, so span parentage is
    preserved; timestamps ride in the payload, so late delivery — the session
    loop may be blocked until the stage finishes — costs nothing.
    """
    try:
        asyncio.get_running_loop()
    except RuntimeError:
        loop = _EXPORT_LOOP.get()
        if loop is not None:
            try:
                loop.call_soon_threadsafe(
                    step_manager.push_intermediate_step,
                    payload,
                    context=contextvars.copy_context(),
                )
            except RuntimeError:  # session loop already closed — a straggler
                logger.debug("dropping %s step: session loop closed", payload.event_type)
            return
    step_manager.push_intermediate_step(payload)


class LlmCallRecord:
    """Filled in by the caller once the completion returns."""

    response: Any = None


def _token_usage(response: Any) -> TokenUsageBaseModel:
    usage = getattr(response, "usage", None)
    if usage is None:
        return TokenUsageBaseModel()
    payload = usage.model_dump() if hasattr(usage, "model_dump") else dict(usage)
    return TokenUsageBaseModel(**{k: v for k, v in payload.items() if isinstance(v, int)})


def _output_text(response: Any) -> str:
    if response is None:
        return ""
    return "".join(
        choice.message.content or "" for choice in getattr(response, "choices", [])
    )


@contextmanager
def traced_llm_call(model: str, messages: list[dict[str, str]]) -> Iterator[LlmCallRecord]:
    """Emit paired LLM_START/LLM_END steps around one chat completion.

    The caller sets ``record.response`` before the block exits; on exception
    the END step is still pushed (empty output) so the span stack stays sane.
    """
    step_manager = Context.get().intermediate_step_manager
    prompt_text = "\n".join(str(m.get("content", "")) for m in messages)
    start = IntermediateStepPayload(
        event_type=IntermediateStepType.LLM_START,
        name=model,
        data=StreamEventData(input=prompt_text, payload=messages),
        metadata=TraceMetadata(chat_inputs=list(messages)),
        usage_info=UsageInfo(token_usage=TokenUsageBaseModel(), num_llm_calls=1),
    )
    _push(step_manager, start)
    record = LlmCallRecord()
    try:
        yield record
    finally:
        _push(
            step_manager,
            IntermediateStepPayload(
                event_type=IntermediateStepType.LLM_END,
                # by NAT convention the END step's span_event_timestamp is
                # the span's *start* time (event_timestamp is the end)
                span_event_timestamp=start.event_timestamp,
                name=model,
                data=StreamEventData(input=prompt_text, output=_output_text(record.response)),
                usage_info=UsageInfo(token_usage=_token_usage(record.response), num_llm_calls=1),
                UUID=start.UUID,
            )
        )


class ToolCallRecord:
    """Filled in by the caller before the block exits."""

    output: str = ""


@contextmanager
def traced_tool_call(name: str, input_text: str = "") -> Iterator[ToolCallRecord]:
    """Emit paired TOOL_START/TOOL_END steps around one tool invocation.

    Gives the minutes-long non-LLM legs (Parakeet ASR) their own bar on the
    trace waterfall; same no-op-outside-NAT contract as the LLM tracer.
    """
    step_manager = Context.get().intermediate_step_manager
    start = IntermediateStepPayload(
        event_type=IntermediateStepType.TOOL_START,
        name=name,
        data=StreamEventData(input=input_text),
    )
    _push(step_manager, start)
    record = ToolCallRecord()
    try:
        yield record
    finally:
        _push(
            step_manager,
            IntermediateStepPayload(
                event_type=IntermediateStepType.TOOL_END,
                span_event_timestamp=start.event_timestamp,
                name=name,
                data=StreamEventData(input=input_text, output=record.output),
                UUID=start.UUID,
            )
        )
