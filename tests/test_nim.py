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
    NIM_BASE_URL,
    REASONING_MODEL,
    NimChat,
    api_key_from_env,
    extract_json,
    strip_reasoning,
    tier_config,
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

    def test_removes_untagged_reasoning_with_bare_close(self):
        # Self-hosted nano NIM (nemotron-nano-9b-v2-dgx-spark) emits the
        # reasoning stream without the opening <think> tag.
        assert strip_reasoning("Okay, the user wants ok.\n</think>\n\nok\n") == "ok"


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

    def test_default_max_tokens_applied_when_set(self):
        # The self-hosted nano NIM defaults max_tokens to ~1k, which its
        # reasoning stream exhausts before the answer (finish_reason=length,
        # zero JSON). A NimChat-level default keeps completions un-truncated.
        client, completions = fake_client("ok")
        chat = NimChat(client=client, model=FAST_MODEL, default_max_tokens=8192)
        chat.complete(user="Q")
        assert completions.calls[0]["max_tokens"] == 8192

    def test_default_max_tokens_caller_override_wins(self):
        client, completions = fake_client("ok")
        chat = NimChat(client=client, model=FAST_MODEL, default_max_tokens=8192)
        chat.complete(user="Q", max_tokens=64)
        assert completions.calls[0]["max_tokens"] == 64

    def test_no_max_tokens_sent_when_unset(self):
        client, completions = fake_client("ok")
        chat = NimChat(client=client, model=REASONING_MODEL)
        chat.complete(user="Q")
        assert "max_tokens" not in completions.calls[0]

    def test_complete_structured_skips_echoed_schema(self):
        # Live failure (sg-0003 GapAnalyst): the model restates the JSON
        # schema before its answer; the first JSON object in the reply is
        # then the schema, not the instance. The parser must keep scanning
        # for a candidate that validates.
        schema_echo = (
            'Matching this schema: {"properties": {"drug": {"type": "string"},'
            ' "dose_mg": {"type": "integer"}}, "type": "object"}\n'
            'Answer: {"drug": "propofol", "dose_mg": 120}'
        )
        client, completions = fake_client(schema_echo)
        chat = NimChat(client=client, model=FAST_MODEL)
        result = chat.complete_structured(user="Extract.", schema=ExtractionResult)
        assert result == ExtractionResult(drug="propofol", dose_mg=120)
        assert len(completions.calls) == 1  # no retry needed

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


# --------------------------------------------- endpoint resolution (spec §8)
#
# Hosted build.nvidia.com is the default; self-hosted NIMs (spec M6 /
# configs/selfhosted.yml) are selected purely via environment variables so
# no call site changes between hosted and local runs.


ENDPOINT_VARS = [
    "PERIOP_NIM_BASE_URL",
    "PERIOP_REASONING_BASE_URL",
    "PERIOP_FAST_BASE_URL",
    "PERIOP_REASONING_MODEL",
    "PERIOP_FAST_MODEL",
]


@pytest.fixture(autouse=True)
def _clean_endpoint_env(monkeypatch):
    for var in ENDPOINT_VARS:
        monkeypatch.delenv(var, raising=False)


class TestTierConfig:
    def test_defaults_to_hosted(self):
        cfg = tier_config("reasoning")
        assert cfg.base_url == NIM_BASE_URL
        assert cfg.model == REASONING_MODEL
        assert tier_config("fast").model == FAST_MODEL

    def test_generic_base_url_applies_to_both_tiers(self, monkeypatch):
        monkeypatch.setenv("PERIOP_NIM_BASE_URL", "http://spark:8000/v1")
        assert tier_config("reasoning").base_url == "http://spark:8000/v1"
        assert tier_config("fast").base_url == "http://spark:8000/v1"

    def test_per_tier_base_url_beats_generic(self, monkeypatch):
        monkeypatch.setenv("PERIOP_NIM_BASE_URL", "http://spark:8000/v1")
        monkeypatch.setenv("PERIOP_FAST_BASE_URL", "http://spark:8001/v1")
        assert tier_config("reasoning").base_url == "http://spark:8000/v1"
        assert tier_config("fast").base_url == "http://spark:8001/v1"

    def test_model_overrides(self, monkeypatch):
        monkeypatch.setenv("PERIOP_REASONING_MODEL", "my/served-model")
        assert tier_config("reasoning").model == "my/served-model"
        assert tier_config("fast").model == FAST_MODEL

    def test_unknown_tier_rejected(self):
        with pytest.raises(ValueError):
            tier_config("turbo")


class TestApiKey:
    def test_required_for_hosted_endpoint(self, monkeypatch):
        monkeypatch.delenv("NGC_API_KEY", raising=False)
        monkeypatch.delenv("NVIDIA_API_KEY", raising=False)
        with pytest.raises(RuntimeError):
            api_key_from_env(NIM_BASE_URL)

    def test_optional_for_local_endpoint(self, monkeypatch):
        monkeypatch.delenv("NGC_API_KEY", raising=False)
        monkeypatch.delenv("NVIDIA_API_KEY", raising=False)
        key = api_key_from_env("http://spark:8000/v1")
        assert key  # non-empty placeholder — local NIMs don't authenticate

    def test_env_key_used_when_present(self, monkeypatch):
        monkeypatch.setenv("NGC_API_KEY", "nvapi-test")
        assert api_key_from_env(NIM_BASE_URL) == "nvapi-test"
        assert api_key_from_env("http://spark:8000/v1") == "nvapi-test"
