"""Push NimChat LLM calls onto the NAT event stream (spec §3.1, §6).

The chat client hits build.nvidia.com's OpenAI endpoint directly, below the
level NAT's framework hooks instrument (the ADK plugin only patches litellm),
so the client emits its own LLM_START/LLM_END intermediate steps with token
usage. NAT's profiler and OTel exporters consume these; outside a NAT run
the event stream has no subscribers and emission is a harmless no-op.
"""

from __future__ import annotations

import time
from collections.abc import Iterator
from contextlib import contextmanager
from typing import Any

from nat.builder.context import Context
from nat.data_models.intermediate_step import (
    IntermediateStepPayload,
    IntermediateStepType,
    StreamEventData,
    TraceMetadata,
    UsageInfo,
)
from nat.data_models.token_usage import TokenUsageBaseModel


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
    step_manager.push_intermediate_step(start)
    record = LlmCallRecord()
    try:
        yield record
    finally:
        step_manager.push_intermediate_step(
            IntermediateStepPayload(
                event_type=IntermediateStepType.LLM_END,
                span_event_timestamp=time.time(),
                name=model,
                data=StreamEventData(input=prompt_text, output=_output_text(record.response)),
                usage_info=UsageInfo(token_usage=_token_usage(record.response), num_llm_calls=1),
                UUID=start.UUID,
            )
        )
