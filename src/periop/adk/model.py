"""ADK model adapters over the project's chat protocol.

``ChatModel`` plugs the NIM chat tiers (``periop.nim.NimChat``) into ADK's
model layer, so ``LlmAgent`` steps drive the same endpoint-resolved,
``/no_think``-configured, NAT-traced clients as before. Test doubles that
implement only ``complete_structured`` (the historical stub seam) are also
accepted: their pydantic result is serialized back to JSON text, which the
step's validator then re-parses — both paths exercise identical downstream
logic.

``ToolChatModel`` is the conversational sibling for the case chatbot: it
carries the whole ADK conversation (text, function calls, function
responses) across to the NIM's OpenAI-compatible ``tools`` interface and maps
``tool_calls`` replies back into genai ``function_call`` parts, so a plain
``LlmAgent`` with Python function tools runs its native tool loop against
the fast tier.
"""

from __future__ import annotations

import asyncio
import json
from typing import Any, AsyncGenerator

from google.adk.models import BaseLlm, LlmRequest, LlmResponse
from google.genai import types
from pydantic import BaseModel

from periop.nim import strip_reasoning


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


# ---- tool-calling adapter (case chatbot) ------------------------------------


def _schema_to_json(schema: types.Schema | None) -> dict[str, Any]:
    """genai ``types.Schema`` → plain JSON Schema for the OpenAI tools param."""
    if schema is None:
        return {"type": "object", "properties": {}}
    raw = schema.model_dump(exclude_none=True)

    def convert(node: Any) -> Any:
        if isinstance(node, dict):
            out = {}
            for key, value in node.items():
                if key == "type":
                    out["type"] = str(getattr(value, "value", value)).lower()
                else:
                    out[key] = convert(value)
            return out
        if isinstance(node, list):
            return [convert(v) for v in node]
        return node

    return convert(raw)


def _openai_tools(llm_request: LlmRequest) -> list[dict[str, Any]] | None:
    declarations = [
        decl
        for tool in (llm_request.config.tools or [])
        if isinstance(tool, types.Tool) and tool.function_declarations
        for decl in tool.function_declarations
    ]
    if not declarations:
        return None
    return [
        {
            "type": "function",
            "function": {
                "name": d.name,
                "description": d.description or "",
                "parameters": _schema_to_json(d.parameters),
            },
        }
        for d in declarations
    ]


def _openai_messages(llm_request: LlmRequest) -> list[dict[str, Any]]:
    """ADK contents → OpenAI messages, preserving tool-call identity.

    Function calls the model made ride on assistant messages as
    ``tool_calls``; ADK's function responses become ``tool`` messages whose
    ``tool_call_id`` echoes the id assigned when the call was parsed, so the
    NIM sees the exact pairing the OpenAI protocol requires.
    """
    messages: list[dict[str, Any]] = []
    system = _system_text(llm_request)
    if system:
        messages.append({"role": "system", "content": system})
    for content in llm_request.contents or []:
        texts: list[str] = []
        tool_calls: list[dict[str, Any]] = []
        for part in content.parts or []:
            if part.function_call is not None:
                fc = part.function_call
                tool_calls.append(
                    {
                        "id": fc.id or f"call_{len(tool_calls)}",
                        "type": "function",
                        "function": {
                            "name": fc.name,
                            "arguments": json.dumps(dict(fc.args or {})),
                        },
                    }
                )
            elif part.function_response is not None:
                fr = part.function_response
                messages.append(
                    {
                        "role": "tool",
                        "tool_call_id": fr.id or "",
                        "content": json.dumps(fr.response),
                    }
                )
            elif part.text:
                texts.append(part.text)
        if content.role == "model":
            if texts or tool_calls:
                message: dict[str, Any] = {"role": "assistant"}
                if texts:
                    message["content"] = "\n".join(texts)
                if tool_calls:
                    message["tool_calls"] = tool_calls
                messages.append(message)
        elif texts:
            messages.append({"role": "user", "content": "\n".join(texts)})
    return messages


class ToolChatModel(BaseLlm):
    """BaseLlm over ``NimChat.complete_chat`` with OpenAI-native tool calls."""

    model: str = "nim-chat-tools"
    chat: Any = None

    async def generate_content_async(
        self, llm_request: LlmRequest, stream: bool = False
    ) -> AsyncGenerator[LlmResponse, None]:
        messages = _openai_messages(llm_request)
        tools = _openai_tools(llm_request)
        reply = await asyncio.to_thread(self.chat.complete_chat, messages, tools)

        parts: list[types.Part] = []
        if reply.content:
            text = strip_reasoning(reply.content)
            if text:
                parts.append(types.Part(text=text))
        for tc in reply.tool_calls or []:
            try:
                args = json.loads(tc.function.arguments or "{}")
            except json.JSONDecodeError:
                args = {}
            parts.append(
                types.Part(
                    function_call=types.FunctionCall(
                        id=tc.id, name=tc.function.name, args=args
                    )
                )
            )
        if not parts:
            parts.append(types.Part(text=""))
        yield LlmResponse(content=types.Content(role="model", parts=parts))
