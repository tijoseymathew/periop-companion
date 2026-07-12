"""Case chatbot endpoints.

POST streams one chat turn as ``text/event-stream`` (the stage-run pattern:
EventSource cannot POST, the client reads fetch + ReadableStream): every tool
call the agent makes surfaces as a ``tool_call``/``tool_result`` pair, the
final answer as ``reply``. GET returns the conversation so far — chat history
is per-process (it lives in the ADK session service), which is demo-grade on
purpose; the case record itself is never written by the chat path except
through the equipment ledger.

Chat works on demo cases too — asking questions is read-only; the ordering
tools do their own pre-op/writability gating.
"""

from __future__ import annotations

import json
import queue
import threading

from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, field_validator

from periop.api.routers.cases import load_case
from periop.api.routers.workflow import require_provider

router = APIRouter()


class ChatTurn(BaseModel):
    message: str
    provider_id: str

    @field_validator("message")
    @classmethod
    def _not_blank(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("message must not be blank")
        return v.strip()


def _sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data)}\n\n"


@router.get("/cases/{case_id}/chat")
def chat_history(request: Request, case_id: str) -> list[dict]:
    load_case(request, case_id)  # 404 unknown cases
    return request.app.state.chat_runtime.history(case_id)


@router.post("/cases/{case_id}/chat")
def chat_turn(request: Request, case_id: str, body: ChatTurn) -> StreamingResponse:
    load_case(request, case_id)
    require_provider(request, body.provider_id)
    runtime = request.app.state.chat_runtime

    def stream():
        events: queue.Queue = queue.Queue()
        outcome: dict = {}

        def work():
            try:
                outcome["reply"] = runtime.send(
                    case_id, body.message, body.provider_id,
                    lambda e, d: events.put((e, d)),
                )
            except Exception as e:  # surfaced as an SSE error event
                outcome["error"] = str(e)
            finally:
                events.put(None)

        worker = threading.Thread(target=work, daemon=True)
        worker.start()
        while (item := events.get()) is not None:
            yield _sse(*item)
        worker.join()
        if "error" in outcome:
            yield _sse("error", {"message": outcome["error"]})
        else:
            yield _sse("reply", {"text": outcome.get("reply", "")})

    return StreamingResponse(stream(), media_type="text/event-stream")
