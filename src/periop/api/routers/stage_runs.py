"""Stage runs with SSE progress (spec v2 §5.2, event vocabulary ui.md §7).

POST returns ``text/event-stream`` (EventSource cannot POST, so the client
reads it with fetch + ReadableStream). One run at a time per server — an
in-memory lock, this is a demo tool, not a job queue. The pipeline runs in a
worker thread; events flow through a queue so long Super-49B stages stream
progress instead of a spinner of unknown duration.
"""

from __future__ import annotations

import json
import queue
import threading
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from periop.api.routers.cases import load_case
from periop.api.routers.workflow import AUDIO_KIND_TO_STAGE, require_writable
from periop.schemas import Case, StageStatus
from periop.store import CaseStore
from periop.tools.ingest import has_transcript_inputs

router = APIRouter()

RUN_LOCK = threading.Lock()

STAGE_KIND = {v: k for k, v in AUDIO_KIND_TO_STAGE.items()}  # stage → audio kind
PRIMARY_ARTIFACT = {
    "preop": "note:pre-anesthesia-eval",
    "intraop": "record:intra-op",
    "postop": "note:pacu-handoff",
}
PRIOR_STAGE = {"intraop": "preop", "postop": "intraop"}


class RunRequest(BaseModel):
    provider_id: str


def _sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data)}\n\n"


def _check_gate(request: Request, case: Case, stage: str) -> None:
    """409 with a next-action message when the stage isn't runnable (v2 §6.7)."""
    state = case.workflow.stages[stage]
    if case.get_artifact(PRIMARY_ARTIFACT[stage]) is not None:
        raise HTTPException(
            status_code=409,
            detail=f"the {stage} output already exists — reopen the stage to re-review it",
        )
    if state.status is StageStatus.GENERATING:
        raise HTTPException(status_code=409, detail=f"the {stage} stage is already generating")

    prior = PRIOR_STAGE.get(stage)
    if prior and case.workflow.stages[prior].status is not StageStatus.SIGNED_OFF:
        raise HTTPException(
            status_code=409,
            detail=f"sign off the {prior} stage before generating the {stage} output",
        )
    if stage == "preop" and state.questions_approved_at is None:
        raise HTTPException(
            status_code=409,
            detail="review and approve the clarification questions before generating the note",
        )

    case_dir = request.app.state.case_dir / case.case_id
    if not (
        state.inputs_recorded_at or has_transcript_inputs(case_dir, STAGE_KIND[stage])
    ):
        what = {
            "preop": "record or upload the pre-op interview first",
            "intraop": "record at least one voice memo first",
            "postop": "record or upload the post-op interview first",
        }[stage]
        raise HTTPException(status_code=409, detail=what)


@router.post("/cases/{case_id}/stages/{stage}/run")
def run_stage(request: Request, case_id: str, stage: str, body: RunRequest) -> StreamingResponse:
    if stage not in PRIMARY_ARTIFACT:
        raise HTTPException(status_code=404, detail=f"no such stage: {stage}")
    store = CaseStore(request.app.state.out_dir)
    case = load_case(request, case_id)
    require_writable(case)
    _check_gate(request, case, stage)

    if not RUN_LOCK.acquire(blocking=False):
        raise HTTPException(
            status_code=409,
            detail="another generation is in progress — try again when it finishes",
        )

    state = case.workflow.stages[stage]
    try:
        state.status = StageStatus.GENERATING
        state.performed_by = body.provider_id
        store.save(case)
    except BaseException:
        RUN_LOCK.release()
        raise

    runner = request.app.state.runner
    case_dir = request.app.state.case_dir / case_id

    def stream():
        events: queue.Queue = queue.Queue()
        outcome: dict = {}

        def work():
            try:
                runner.run_stage(case, stage, case_dir, lambda e, d: events.put((e, d)))
                outcome["ok"] = True
            except Exception as e:  # surfaced as an SSE error event
                outcome["error"] = str(e)
            finally:
                events.put(None)

        try:
            yield _sse("status", {"message": f"loading case {case_id}"})
            yield _sse("stage_start", {"stage": stage})
            worker = threading.Thread(target=work, daemon=True)
            worker.start()
            while (item := events.get()) is not None:
                yield _sse(*item)
            worker.join()
            if outcome.get("ok"):
                state.status = StageStatus.AWAITING_REVIEW
                store.save(case)
                yield _sse("complete", {"case_id": case_id})
            else:
                # discard partial in-memory mutations; restore the runnable state
                fresh = store.load(case_id)
                fresh.workflow.stages[stage].status = StageStatus.READY_TO_GENERATE
                store.save(fresh)
                yield _sse("error", {"message": outcome.get("error", "stage run failed")})
        finally:
            RUN_LOCK.release()

    return StreamingResponse(stream(), media_type="text/event-stream")
