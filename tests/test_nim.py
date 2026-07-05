"""NIM chat client tests.

The client talks to build.nvidia.com's OpenAI-compatible endpoint. Tests
inject a fake OpenAI client — no network. Model tiering (spec §8): reasoning
= Nemotron Super 49B, fast = Nemotron Nano.
"""

from types import SimpleNamespace

import pytest
from pydantic import BaseModel

from periop.nim import (
    FAST_MODEL,
    REASONING_MODEL,
    NimChat,
    extract_json,
    strip_reasoning,
)


class FakeCompletions:
    def __init__(self, replies):
        self.replies = list(replies)
        self.calls = []

    def create(self, **kwargs):
        self.calls.append(kwargs)
        content = self.replies.pop(0)
        return SimpleNamespace(
            choices=[SimpleNamespace(message=SimpleNamespace(content=content))]
        )


def fake_client(*replies):
    completions = FakeCompletions(replies)
    return SimpleNamespace(chat=SimpleNamespace(completions=completions)), completions


# ------------------------------------------------------------- pure helpers


class TestStripReasoning:
    def test_removes_think_block(self):
        assert strip_reasoning("<think>hmm, let me\nreason</think>\nAnswer.") == "Answer."

    def test_passthrough_without_think(self):
        assert strip_reasoning("Answer.") == "Answer."


class TestExtractJson:
    def test_bare_json(self):
        assert extract_json('{"a": 1}') == {"a": 1}

    def test_fenced_json(self):
        assert extract_json('Here you go:\n```json\n{"a": 1}\n```\nDone.') == {"a": 1}

    def test_json_embedded_in_prose(self):
        assert extract_json('The result is {"a": [1, 2]} as requested.') == {"a": [1, 2]}

    def test_raises_on_no_json(self):
        with pytest.raises(ValueError):
            extract_json("no json here")


# ------------------------------------------------------------------ NimChat


class ExtractionResult(BaseModel):
    drug: str
    dose_mg: int


class TestNimChat:
    def test_complete_sends_messages_and_returns_text(self):
        client, completions = fake_client("Aspirin stopped 6 days ago.")
        chat = NimChat(client=client, model=REASONING_MODEL)
        out = chat.complete(system="You are a scribe.", user="Summarize.")
        assert out == "Aspirin stopped 6 days ago."
        call = completions.calls[0]
        assert call["model"] == REASONING_MODEL
        assert call["messages"][0] == {"role": "system", "content": "You are a scribe."}
        assert call["messages"][1] == {"role": "user", "content": "Summarize."}

    def test_complete_strips_reasoning_block(self):
        client, _ = fake_client("<think>reasoning...</think>\nFinal answer.")
        chat = NimChat(client=client, model=REASONING_MODEL)
        assert chat.complete(user="Q") == "Final answer."

    def test_complete_structured_parses_into_model(self):
        client, _ = fake_client('```json\n{"drug": "propofol", "dose_mg": 120}\n```')
        chat = NimChat(client=client, model=FAST_MODEL)
        result = chat.complete_structured(user="Extract.", schema=ExtractionResult)
        assert result == ExtractionResult(drug="propofol", dose_mg=120)

    def test_complete_structured_retries_on_invalid_json(self):
        client, completions = fake_client(
            "sorry, no json", '{"drug": "propofol", "dose_mg": 120}'
        )
        chat = NimChat(client=client, model=FAST_MODEL, max_retries=1)
        result = chat.complete_structured(user="Extract.", schema=ExtractionResult)
        assert result.drug == "propofol"
        assert len(completions.calls) == 2

    def test_retry_prompt_includes_validation_error_feedback(self):
        # First reply is valid JSON but wrong shape (dose as "120 mg" string);
        # the retry must tell the model what failed so it can correct itself.
        client, completions = fake_client(
            '{"drug": "propofol", "dose_mg": "not a number"}',
            '{"drug": "propofol", "dose_mg": 120}',
        )
        chat = NimChat(client=client, model=FAST_MODEL, max_retries=1)
        result = chat.complete_structured(user="Extract.", schema=ExtractionResult)
        assert result.dose_mg == 120
        retry_prompt = completions.calls[1]["messages"][-1]["content"]
        assert "previous reply" in retry_prompt
        assert "dose_mg" in retry_prompt

    def test_complete_structured_raises_after_retries_exhausted(self):
        client, _ = fake_client("nope", "still nope")
        chat = NimChat(client=client, model=FAST_MODEL, max_retries=1)
        with pytest.raises(ValueError):
            chat.complete_structured(user="Extract.", schema=ExtractionResult)

    def test_default_models(self):
        assert REASONING_MODEL == "nvidia/llama-3.3-nemotron-super-49b-v1.5"
        assert "nemotron" in FAST_MODEL
