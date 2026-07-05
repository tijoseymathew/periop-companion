"""Chat client for NVIDIA-hosted NIMs (build.nvidia.com, OpenAI-compatible).

Model tiering per spec §8: a reasoning model for note generation and a fast
model for cheap extraction/classification/verification. A single API key
(``NGC_API_KEY`` or ``NVIDIA_API_KEY``) is the only credential needed.
"""

from __future__ import annotations

import json
import os
import re
from typing import Any, TypeVar

from pydantic import BaseModel, ValidationError

NIM_BASE_URL = "https://integrate.api.nvidia.com/v1"
REASONING_MODEL = "nvidia/llama-3.3-nemotron-super-49b-v1.5"
FAST_MODEL = "nvidia/nvidia-nemotron-nano-9b-v2"

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


def api_key_from_env() -> str:
    key = os.environ.get("NGC_API_KEY") or os.environ.get("NVIDIA_API_KEY")
    if not key:
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
    ) -> None:
        if client is None:
            from openai import OpenAI

            client = OpenAI(base_url=NIM_BASE_URL, api_key=api_key_from_env())
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
    return NimChat(model=REASONING_MODEL, **kwargs)


def fast_chat(**kwargs: Any) -> NimChat:
    return NimChat(model=FAST_MODEL, **kwargs)
