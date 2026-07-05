"""NimChat emits NAT intermediate steps so live runs land in the profiler.

The chat client talks to build.nvidia.com's OpenAI endpoint directly, below
NAT's framework hooks (the ADK plugin only instruments litellm), so the
client itself pushes LLM_START/LLM_END events — with token usage — onto the
NAT event stream (spec §3.1: NAT owns observability; spec §6: per-stage
token usage from the profiler). Outside a NAT run the stream simply has no
subscribers, so emission is a safe no-op.
"""

from types import SimpleNamespace

import pytest

from nat.builder.context import ContextState
from nat.data_models.intermediate_step import IntermediateStepType

from periop.nim import FAST_MODEL, NimChat


class FakeCompletions:
    def __init__(self, replies, usage=None):
        self.replies = list(replies)
        self.usage = usage
        self.calls = []

    def create(self, **kwargs):
        self.calls.append(kwargs)
        return SimpleNamespace(
            choices=[SimpleNamespace(message=SimpleNamespace(content=self.replies.pop(0)))],
            usage=self.usage,
        )


def fake_client(*replies, usage=None):
    completions = FakeCompletions(replies, usage=usage)
    return SimpleNamespace(chat=SimpleNamespace(completions=completions))


@pytest.fixture
def steps():
    collected = []
    subscription = ContextState.get().event_stream.get().subscribe(collected.append)
    yield collected
    subscription.unsubscribe()


class TestLlmStepEmission:
    def test_complete_emits_paired_llm_start_and_end(self, steps):
        chat = NimChat(client=fake_client("Answer."), model=FAST_MODEL)
        chat.complete(user="Q", system="S")
        events = [s.payload.event_type for s in steps]
        assert events == [IntermediateStepType.LLM_START, IntermediateStepType.LLM_END]
        start, end = (s.payload for s in steps)
        assert start.UUID == end.UUID  # profiler pairs events by UUID
        assert start.name == FAST_MODEL

    def test_end_event_carries_token_usage(self, steps):
        usage = SimpleNamespace(
            model_dump=lambda: {"prompt_tokens": 11, "completion_tokens": 7, "total_tokens": 18}
        )
        chat = NimChat(client=fake_client("Answer.", usage=usage), model=FAST_MODEL)
        chat.complete(user="Q")
        end = steps[-1].payload
        assert end.usage_info.token_usage.prompt_tokens == 11
        assert end.usage_info.token_usage.completion_tokens == 7
        assert end.usage_info.token_usage.total_tokens == 18

    def test_end_event_captures_prompt_and_reply_text(self, steps):
        chat = NimChat(client=fake_client("The answer."), model=FAST_MODEL)
        chat.complete(user="The question?")
        end = steps[-1].payload
        assert "The question?" in end.data.input
        assert end.data.output == "The answer."

    def test_missing_usage_defaults_to_zero_not_crash(self, steps):
        chat = NimChat(client=fake_client("Answer."), model=FAST_MODEL)
        assert chat.complete(user="Q") == "Answer."
        assert steps[-1].payload.usage_info.token_usage.total_tokens == 0

    def test_llm_error_still_closes_the_step(self, steps):
        class ExplodingCompletions:
            def create(self, **kwargs):
                raise RuntimeError("boom")

        client = SimpleNamespace(chat=SimpleNamespace(completions=ExplodingCompletions()))
        chat = NimChat(client=client, model=FAST_MODEL)
        with pytest.raises(RuntimeError):
            chat.complete(user="Q")
        events = [s.payload.event_type for s in steps]
        assert events == [IntermediateStepType.LLM_START, IntermediateStepType.LLM_END]
