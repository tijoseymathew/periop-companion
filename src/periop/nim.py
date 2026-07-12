"""Chat client for NVIDIA NIMs (OpenAI-compatible).

Model tiering per spec §8: a reasoning model for note generation and a fast
model for cheap extraction/classification/verification. Hosted
build.nvidia.com is the default; self-hosted NIM endpoints (spec §8 /
configs/selfhosted.yml) are selected via environment variables:

- ``PERIOP_NIM_BASE_URL``        — base URL for both tiers
- ``PERIOP_REASONING_BASE_URL``  — per-tier override (wins over generic)
- ``PERIOP_FAST_BASE_URL``
- ``PERIOP_REASONING_MODEL`` / ``PERIOP_FAST_MODEL`` — served-model names

``NGC_API_KEY`` (or ``NVIDIA_API_KEY``) is required only for the hosted
endpoint; local NIMs don't authenticate.
"""

from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass
from typing import Any, Iterator, TypeVar

from pydantic import BaseModel, ValidationError

NIM_BASE_URL = "https://integrate.api.nvidia.com/v1"
REASONING_MODEL = "nvidia/llama-3.3-nemotron-super-49b-v1.5"
FAST_MODEL = "nvidia/nvidia-nemotron-nano-9b-v2"

_TIER_DEFAULTS = {"reasoning": REASONING_MODEL, "fast": FAST_MODEL}


@dataclass(frozen=True)
class TierConfig:
    """Resolved endpoint + model for one tier ("reasoning" or "fast")."""

    base_url: str
    model: str


def tier_config(tier: str) -> TierConfig:
    """Resolve a tier's endpoint and model from the environment."""
    if tier not in _TIER_DEFAULTS:
        raise ValueError(f"unknown tier {tier!r}; expected one of {sorted(_TIER_DEFAULTS)}")
    base_url = (
        os.environ.get(f"PERIOP_{tier.upper()}_BASE_URL")
        or os.environ.get("PERIOP_NIM_BASE_URL")
        or NIM_BASE_URL
    )
    model = os.environ.get(f"PERIOP_{tier.upper()}_MODEL") or _TIER_DEFAULTS[tier]
    return TierConfig(base_url=base_url, model=model)

_THINK_BLOCK = re.compile(r"<think>.*?</think>", re.DOTALL)

M = TypeVar("M", bound=BaseModel)


def strip_reasoning(text: str) -> str:
    """Drop Nemotron reasoning, returning the final answer.

    Handles ``<think>…</think>`` blocks and replies where the serving stack
    omits the opening tag (the self-hosted nano-9b-v2 NIM streams bare
    reasoning terminated by a lone ``</think>``).
    """
    text = _THINK_BLOCK.sub("", text)
    _, _, tail = text.rpartition("</think>")
    return tail.strip()


def extract_json_candidates(text: str) -> Iterator[Any]:
    """Yield every decodable JSON object/array in a model reply, in order.

    Handles bare JSON, ```json fences, and JSON embedded in prose. Callers
    that expect a specific shape should scan candidates rather than trust the
    first one — models sometimes restate the requested schema before (or
    instead of) the actual instance.
    """
    fence = re.search(r"```(?:json)?\s*(.*?)```", text, re.DOTALL)
    if fence:
        text = fence.group(1)
    decoder = json.JSONDecoder()
    pos = 0
    while True:
        match = re.search(r"[{\[]", text[pos:])
        if not match:
            return
        start = pos + match.start()
        try:
            value, end = decoder.raw_decode(text[start:])
            yield value
            pos = start + end
        except json.JSONDecodeError:
            pos = start + 1


def extract_json(text: str) -> Any:
    """Pull the first JSON object/array out of a model reply."""
    for value in extract_json_candidates(text):
        return value
    raise ValueError(f"no JSON found in model reply: {text[:200]!r}")


def structured_prompt(user: str, schema: type[BaseModel]) -> str:
    """Append the JSON-Schema instruction block used for structured output.

    Shared by ``NimChat.complete_structured`` and the ADK generate/validate
    steps so the live prompts are identical on both paths.
    """
    schema_hint = json.dumps(schema.model_json_schema(), indent=2)
    return (
        f"{user}\n\nRespond with a single JSON object that conforms to the "
        f"JSON Schema below. Output only the data instance — do not repeat "
        f"the schema itself, add extra keys, or add commentary.\n{schema_hint}"
    )


def retry_feedback(base_prompt: str, reply: str, error: str) -> str:
    """The corrective re-prompt after a rejected structured reply."""
    return (
        f"{base_prompt}\n\nYour previous reply was rejected:\n{reply}\n\n"
        f"Validation error:\n{error}\n\n"
        "Correct the JSON so it matches the schema exactly."
    )


def first_valid(reply: str, schema: type[M]) -> M:
    """Validate the first JSON candidate in ``reply`` matching ``schema``.

    Models sometimes echo the requested schema before the instance; the
    echo decodes as JSON but fails validation, so keep scanning. The
    first candidate's validation error is re-raised when none fit (it is
    the most useful retry feedback).
    """
    first_error: ValidationError | None = None
    found = False
    for candidate in extract_json_candidates(reply):
        found = True
        try:
            return schema.model_validate(candidate)
        except ValidationError as exc:
            first_error = first_error or exc
    if not found:
        raise ValueError(f"no JSON found in model reply: {reply[:200]!r}")
    raise first_error


def api_key_from_env(base_url: str = NIM_BASE_URL) -> str:
    key = os.environ.get("NGC_API_KEY") or os.environ.get("NVIDIA_API_KEY")
    if not key:
        if base_url != NIM_BASE_URL:
            return "local-nim"  # self-hosted NIMs accept any bearer token
        raise RuntimeError("set NGC_API_KEY (or NVIDIA_API_KEY) in the environment / .env")
    return key


class NimChat:
    """Thin synchronous chat wrapper with structured-output retries."""

    def __init__(
        self,
        model: str,
        client: Any | None = None,
        temperature: float = 0.2,
        max_retries: int = 2,
        base_url: str | None = None,
        timeout_s: float | None = None,
        default_max_tokens: int | None = None,
        system_prefix: str | None = None,
    ) -> None:
        if client is None:
            from openai import OpenAI

            base_url = base_url or NIM_BASE_URL
            if timeout_s is None:
                # Self-hosted NIMs on small GPUs can run long generations well
                # past the openai default; PERIOP_NIM_TIMEOUT_S overrides.
                timeout_s = float(os.environ.get("PERIOP_NIM_TIMEOUT_S") or 1800)
            client = OpenAI(
                base_url=base_url, api_key=api_key_from_env(base_url), timeout=timeout_s
            )
        self.client = client
        self.model = model
        self.temperature = temperature
        self.max_retries = max_retries
        self.default_max_tokens = default_max_tokens
        self.system_prefix = system_prefix

    def complete(self, user: str, system: str | None = None, **kwargs: Any) -> str:
        from periop.nat.telemetry import traced_llm_call

        if self.system_prefix:
            system = f"{self.system_prefix}\n{system}" if system else self.system_prefix
        messages: list[dict[str, str]] = []
        if system:
            messages.append({"role": "system", "content": system})
        messages.append({"role": "user", "content": user})
        if self.default_max_tokens is not None:
            kwargs.setdefault("max_tokens", self.default_max_tokens)
        with traced_llm_call(self.model, messages) as record:
            response = self.client.chat.completions.create(
                model=self.model,
                messages=messages,
                temperature=kwargs.pop("temperature", self.temperature),
                **kwargs,
            )
            record.response = response
        return strip_reasoning(response.choices[0].message.content or "")

    def complete_chat(
        self,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]] | None = None,
        **kwargs: Any,
    ) -> Any:
        """One turn over a full message list, optionally with OpenAI tools.

        Returns the raw assistant message (``choices[0].message``) so callers
        see ``tool_calls`` — the seam the ADK tool-calling adapter
        (``periop.adk.model.ToolChatModel``) drives. ``system_prefix``
        (``/no_think``) rides on the leading system message like
        :meth:`complete`.
        """
        from periop.nat.telemetry import traced_llm_call

        messages = [dict(m) for m in messages]
        if self.system_prefix:
            if messages and messages[0].get("role") == "system":
                messages[0]["content"] = f"{self.system_prefix}\n{messages[0]['content']}"
            else:
                messages.insert(0, {"role": "system", "content": self.system_prefix})
        if self.default_max_tokens is not None:
            kwargs.setdefault("max_tokens", self.default_max_tokens)
        if tools:
            kwargs["tools"] = tools
        with traced_llm_call(self.model, messages) as record:
            response = self.client.chat.completions.create(
                model=self.model,
                messages=messages,
                temperature=kwargs.pop("temperature", self.temperature),
                **kwargs,
            )
            record.response = response
        return response.choices[0].message

    def complete_structured(
        self, user: str, schema: type[M], system: str | None = None, **kwargs: Any
    ) -> M:
        """Ask for JSON matching ``schema``; retry on parse/validation failure."""
        prompt = structured_prompt(user, schema)
        last_error: Exception | None = None
        attempt_prompt = prompt
        for _ in range(self.max_retries + 1):
            reply = self.complete(attempt_prompt, system=system, **kwargs)
            try:
                return first_valid(reply, schema)
            except (ValueError, ValidationError) as exc:
                last_error = exc
                attempt_prompt = retry_feedback(prompt, reply, str(exc))
        raise ValueError(
            f"model failed to produce valid {schema.__name__} after "
            f"{self.max_retries + 1} attempts"
        ) from last_error

    _first_valid = staticmethod(first_valid)


def reasoning_chat(**kwargs: Any) -> NimChat:
    cfg = tier_config("reasoning")
    kwargs.setdefault("model", cfg.model)
    kwargs.setdefault("base_url", cfg.base_url)
    # Reasoning latency is proportional to completion tokens at the
    # self-hosted decode rate, and thinking is most of the completion
    # (2,712→~1,000 tokens on the pre-op note). PERIOP_REASONING_THINKING=1
    # restores it for A/B runs.
    if not os.environ.get("PERIOP_REASONING_THINKING"):
        kwargs.setdefault("system_prefix", "/no_think")
    return NimChat(**kwargs)


def fast_chat(**kwargs: Any) -> NimChat:
    cfg = tier_config("fast")
    kwargs.setdefault("model", cfg.model)
    kwargs.setdefault("base_url", cfg.base_url)
    # The self-hosted nano NIM defaults max_tokens low enough that its
    # reasoning stream truncates before the answer; ask for real headroom.
    kwargs.setdefault(
        "default_max_tokens", int(os.environ.get("PERIOP_FAST_MAX_TOKENS") or 8192)
    )
    # Fast-tier calls are cheap extraction/verification: nano's reasoning
    # stream turns a 1s verdict into ~60s of thinking tokens. Disable it via
    # Nemotron's "/no_think" control; PERIOP_FAST_THINKING=1 re-enables.
    if not os.environ.get("PERIOP_FAST_THINKING"):
        kwargs.setdefault("system_prefix", "/no_think")
    return NimChat(**kwargs)
