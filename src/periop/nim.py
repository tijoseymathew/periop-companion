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
from typing import Any, TypeVar

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
    """Drop Nemotron ``<think>…</think>`` blocks, returning the final answer."""
    return _THINK_BLOCK.sub("", text).strip()


def extract_json(text: str) -> Any:
    """Pull the first JSON object/array out of a model reply.

    Handles bare JSON, ```json fences, and JSON embedded in prose.
    """
    fence = re.search(r"```(?:json)?\s*(.*?)```", text, re.DOTALL)
    if fence:
        text = fence.group(1)
    decoder = json.JSONDecoder()
    for start in (m.start() for m in re.finditer(r"[{\[]", text)):
        try:
            value, _ = decoder.raw_decode(text[start:])
            return value
        except json.JSONDecodeError:
            continue
    raise ValueError(f"no JSON found in model reply: {text[:200]!r}")


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

    def complete(self, user: str, system: str | None = None, **kwargs: Any) -> str:
        from periop.nat.telemetry import traced_llm_call

        messages: list[dict[str, str]] = []
        if system:
            messages.append({"role": "system", "content": system})
        messages.append({"role": "user", "content": user})
        with traced_llm_call(self.model, messages) as record:
            response = self.client.chat.completions.create(
                model=self.model,
                messages=messages,
                temperature=kwargs.pop("temperature", self.temperature),
                **kwargs,
            )
            record.response = response
        return strip_reasoning(response.choices[0].message.content or "")

    def complete_structured(
        self, user: str, schema: type[M], system: str | None = None, **kwargs: Any
    ) -> M:
        """Ask for JSON matching ``schema``; retry on parse/validation failure."""
        schema_hint = json.dumps(schema.model_json_schema(), indent=2)
        prompt = (
            f"{user}\n\nRespond with a single JSON object matching this schema "
            f"(no extra keys, no commentary):\n{schema_hint}"
        )
        last_error: Exception | None = None
        attempt_prompt = prompt
        for _ in range(self.max_retries + 1):
            reply = self.complete(attempt_prompt, system=system, **kwargs)
            try:
                return schema.model_validate(extract_json(reply))
            except (ValueError, ValidationError) as exc:
                last_error = exc
                attempt_prompt = (
                    f"{prompt}\n\nYour previous reply was rejected:\n{reply}\n\n"
                    f"Validation error:\n{exc}\n\n"
                    "Correct the JSON so it matches the schema exactly."
                )
        raise ValueError(
            f"model failed to produce valid {schema.__name__} after "
            f"{self.max_retries + 1} attempts"
        ) from last_error


def reasoning_chat(**kwargs: Any) -> NimChat:
    cfg = tier_config("reasoning")
    kwargs.setdefault("model", cfg.model)
    kwargs.setdefault("base_url", cfg.base_url)
    return NimChat(**kwargs)


def fast_chat(**kwargs: Any) -> NimChat:
    cfg = tier_config("fast")
    kwargs.setdefault("model", cfg.model)
    kwargs.setdefault("base_url", cfg.base_url)
    return NimChat(**kwargs)
