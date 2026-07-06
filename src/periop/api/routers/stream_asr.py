"""Streaming intra-op ASR over WebSocket (spec v2 §2 stretch).

The provider dictates instead of recording memos: 16 kHz PCM16 frames come up
the socket, partial/final transcript events go back down, and stop lands the
session exactly like a memo upload — PCM appended to the intra-op wav
(ffmpeg-free), final segments registered on ``audio:intraop-notes`` with
wav-offset times so click-to-play provenance works unchanged. The transcriber
is the injected feed/finish seam (fake in tests/e2e, Riva streaming live);
this handler owns the timing fallback and all case mutation.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, WebSocket
from fastapi.concurrency import run_in_threadpool
from starlette.websockets import WebSocketDisconnect

from periop.schemas import AudioSegment, Source, SourceType, StageStatus
from periop.store import CaseStore
from periop.tools.audio import append_pcm16, wav_duration_s

router = APIRouter()

RATE = 16000
BYTES_PER_SECOND = RATE * 2  # 16-bit mono


@router.websocket("/cases/{case_id}/sources/audio/stream")
async def stream_audio(ws: WebSocket, case_id: str, kind: str = "", provider_id: str = "") -> None:
    await ws.accept()

    async def refuse(message: str) -> None:
        await ws.send_json({"type": "error", "message": message})
        await ws.close()

    app = ws.app
    store = CaseStore(app.state.out_dir)
    try:
        case = store.load(case_id)
    except KeyError:
        return await refuse(f"no such case: {case_id}")
    if case.is_demo:
        return await refuse(
            f"case {case_id} is seeded demo data (no workflow block) and cannot be modified"
        )
    if kind != "intraop-notes":
        return await refuse(
            "live dictation is intra-op only — set kind=intraop-notes; "
            "interviews are recorded or uploaded whole"
        )
    stage = case.workflow.stages["intraop"]
    if stage.status is StageStatus.SIGNED_OFF:
        return await refuse("the intra-op stage is signed off — reopen it before dictating")

    transcriber = app.state.streaming_asr_factory()
    wav_path = Path(app.state.case_dir) / case_id / "audio" / "intraop-notes.wav"
    offset = wav_duration_s(wav_path)

    pcm = bytearray()
    finals: list[dict] = []
    last_final_end = 0.0
    connected = True

    def clock(events: list[dict]) -> list[dict]:
        """Absolute-time finals: adapter times when given, byte-count fallback."""
        nonlocal last_final_end
        timed = []
        for event in events:
            if event.get("type") == "final":
                t0 = event.get("t0", last_final_end)
                t1 = event.get("t1", len(pcm) / BYTES_PER_SECOND)
                last_final_end = t1
                event = {**event, "t0": round(offset + t0, 2), "t1": round(offset + t1, 2)}
                finals.append(event)
            timed.append(event)
        return timed

    async def send(events: list[dict]) -> None:
        nonlocal connected
        if not connected:
            return
        try:
            for event in events:
                await ws.send_json(event)
        except (WebSocketDisconnect, RuntimeError):
            connected = False

    while True:
        try:
            message = await ws.receive()
        except WebSocketDisconnect:
            connected = False
            break
        if message["type"] == "websocket.disconnect":
            connected = False
            break
        data = message.get("bytes")
        if data:
            pcm.extend(data)
            await send(clock(await run_in_threadpool(transcriber.feed, data)))
        elif message.get("text"):
            try:
                if json.loads(message["text"]).get("type") == "stop":
                    break
            except json.JSONDecodeError:
                pass

    # the dictation is kept even if the browser vanished mid-session (v2 §6.7)
    await send(clock(await run_in_threadpool(transcriber.finish)))

    segments_added = 0
    if pcm and finals:
        append_pcm16(wav_path, bytes(pcm))
        source = case.get_source("audio:intraop-notes")
        if source is None:
            source = Source(
                source_id="audio:intraop-notes",
                type=SourceType.AUDIO,
                captured_at=datetime.now(timezone.utc),
                provided_by=provider_id or None,
            )
            case.add_source(source)
        for final in finals:
            source.segments.append(
                AudioSegment(
                    seg_id=f"s{len(source.segments) + 1:03d}",
                    t0=final["t0"],
                    t1=final["t1"],
                    speaker="PROVIDER",  # dictation is single-speaker by construction
                    text=final["text"],
                )
            )
            segments_added += 1
        stage.inputs_recorded_at = datetime.now(timezone.utc)
        if provider_id:
            stage.performed_by = provider_id
        if stage.status is StageStatus.AWAITING_INPUTS:
            stage.status = StageStatus.READY_TO_GENERATE
        store.save(case)

    if connected:
        await send(
            [{"type": "saved", "segments": segments_added, "source_id": "audio:intraop-notes"}]
        )
        try:
            await ws.close()
        except RuntimeError:
            pass
