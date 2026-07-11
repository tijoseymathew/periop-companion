"""ADK model adapter over the project's chat protocol.

``ChatModel`` plugs the NIM chat tiers (``periop.nim.NimChat``) into ADK's
model layer, so ``LlmAgent`` steps drive the same endpoint-resolved,
``/no_think``-configured, NAT-traced clients as before. Test doubles that
implement only ``complete_structured`` (the historical stub seam) are also
accepted: their pydantic result is serialized back to JSON text, which the
step's validator then re-parses — both paths exercise identical downstream
logic.
"""

from __future__ import annotations

import asyncio
from typing import Any, AsyncGenerator

from google.adk.models import BaseLlm, LlmRequest, LlmResponse
from google.genai import types
from pydantic import BaseModel


def _system_text(llm_request: LlmRequest) -> str | None:
    si = llm_request.config.system_instruction if llm_request.config else None
    if si is None:
        return None
    if isinstance(si, str):
        return si
    if isinstance(si, types.Content):
        return "\n".join(p.text or "" for p in si.parts or [])
    return str(si)


def _user_text(llm_request: LlmRequest) -> str:
    texts: list[str] = []
    for content in llm_request.contents or []:
        for part in content.parts or []:
            if part.text:
                texts.append(part.text)
    return "\n".join(texts)


class ChatModel(BaseLlm):
    """BaseLlm over a chat client (live NimChat, or an injected test stub)."""

    model: str = "nim-chat"
    chat: Any = None
    schema_hint: type[BaseModel] | None = None
    """Schema handed to ``complete_structured`` for chat doubles that only
    speak the structured protocol; the live text path ignores it (the step's
    prompt already embeds the JSON Schema and its validator does the parse)."""

    async def generate_content_async(
        self, llm_request: LlmRequest, stream: bool = False
    ) -> AsyncGenerator[LlmResponse, None]:
        system = _system_text(llm_request)
        user = _user_text(llm_request)
        if hasattr(self.chat, "complete"):
            text = await asyncio.to_thread(self.chat.complete, user, system=system)
        else:
            if self.schema_hint is None:
                raise TypeError(
                    f"chat {self.chat!r} has no complete(); a schema_hint is "
                    "required to fall back to complete_structured()"
                )
            result = await asyncio.to_thread(
                self.chat.complete_structured, user, self.schema_hint, system=system
            )
            text = result.model_dump_json()
        yield LlmResponse(
            content=types.Content(role="model", parts=[types.Part(text=text)])
        )
