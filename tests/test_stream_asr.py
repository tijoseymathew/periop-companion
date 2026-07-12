"""Streaming intra-op ASR (spec v2 §2 stretch).

The provider dictates; 16 kHz PCM16 frames go up a WebSocket, partial/final
transcript events come back, and on stop the session lands exactly like a
memo: PCM appended to the intra-op wav (ffmpeg-free), final segments
registered on ``audio:intraop-notes`` with wav-offset times, stage stamped.
The transcriber behind the socket is a feed/finish seam — fake here and in
e2e, the Riva streaming profile live.
"""

import json
import wave
from datetime import datetime, timezone
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from periop.api.app import create_app
from periop.schemas import Case, Provider, StageStatus, Workflow
from periop.store import CaseStore

PROVIDERS = [
    {"provider_id": "p-lim", "name": "Dr A. Lim", "role": "consultant"},
    {"provider_id": "p-tan", "name": "Dr B. Tan", "role": "registrar"},
]

RATE = 16000
HALF_SECOND = b"\x00\x00" * (RATE // 2)  # 0.5 s of silence, PCM16 mono


def make_live_case(case_id: str = "live-1") -> Case:
    return Case(
        case_id=case_id,
        label="TKR Mrs W",
        workflow=Workflow(
            created_by=Provider(provider_id="p-lim", name="Dr A. Lim", role="consultant"),
            created_at=datetime.now(timezone.utc),
        ),
    )


class ScriptedTranscriber:
    """Feed/finish seam double: one partial per feed, one final at finish."""

    def __init__(self):
        self.fed = b""

    def feed(self, pcm: bytes) -> list[dict]:
        self.fed += pcm
        return [{"type": "partial", "text": "Propofol one twenty…"}]

    def finish(self) -> list[dict]:
        return [{"type": "final", "text": "[08:02] Propofol one twenty milligrams."}]


@pytest.fixture
def env(tmp_path):
    store = CaseStore(tmp_path / "_out")
    store.save(make_live_case())
    store.save(Case(case_id="demo-1"))
    providers = tmp_path / "providers.json"
    providers.write_text(json.dumps(PROVIDERS))
    client = TestClient(
        create_app(
            out_dir=store.root,
            case_dir=tmp_path,
            providers_path=providers,
            streaming_asr_factory=ScriptedTranscriber,
        )
    )
    return client, store, tmp_path


def stream_session(client, case_id="live-1", frames=2, provider="p-tan"):
    events = []
    with client.websocket_connect(
        f"/api/cases/{case_id}/sources/audio/stream?kind=intraop-notes&provider_id={provider}"
    ) as ws:
        for _ in range(frames):
            ws.send_bytes(HALF_SECOND)
        ws.send_text(json.dumps({"type": "stop"}))
        while True:
            event = ws.receive_json()
            events.append(event)
            if event["type"] in ("saved", "error"):
                break
    return events


class TestStreamingSession:
    def test_partials_stream_back_and_stop_saves(self, env):
        client, store, tmp_path = env
        events = stream_session(client, frames=2)

        assert {"type": "partial", "text": "Propofol one twenty…"} in events
        finals = [e for e in events if e["type"] == "final"]
        assert finals == [
            {
                "type": "final",
                "text": "[08:02] Propofol one twenty milligrams.",
                "t0": 0.0,
                "t1": 1.0,  # two half-second frames
            }
        ]
        assert events[-1]["type"] == "saved"
        assert events[-1]["segments"] == 1

        case = store.load("live-1")
        source = case.get_source("audio:intraop-notes")
        assert [s.seg_id for s in source.segments] == ["s001"]
        assert source.segments[0].speaker == "PROVIDER"
        assert source.segments[0].text == "[08:02] Propofol one twenty milligrams."
        assert (source.segments[0].t0, source.segments[0].t1) == (0.0, 1.0)

        stage = case.workflow.stages["intraop"]
        assert stage.status is StageStatus.READY_TO_GENERATE
        assert stage.performed_by == "p-tan"
        assert stage.inputs_recorded_at is not None

        with wave.open(str(tmp_path / "live-1" / "audio" / "intraop-notes.wav"), "rb") as w:
            assert w.getframerate() == RATE
            assert w.getnchannels() == 1
            assert w.getnframes() == RATE  # 1.0 s

    def test_second_session_appends_with_offset(self, env):
        client, store, tmp_path = env
        stream_session(client, frames=2)  # 1.0 s
        events = stream_session(client, frames=1)  # +0.5 s

        final = next(e for e in events if e["type"] == "final")
        assert (final["t0"], final["t1"]) == (1.0, 1.5)

        source = store.load("live-1").get_source("audio:intraop-notes")
        assert [s.seg_id for s in source.segments] == ["s001", "s002"]
        assert (source.segments[1].t0, source.segments[1].t1) == (1.0, 1.5)
        with wave.open(str(tmp_path / "live-1" / "audio" / "intraop-notes.wav"), "rb") as w:
            assert w.getnframes() == RATE + RATE // 2

    def test_demo_case_is_refused(self, env):
        client, _, _ = env
        events = stream_session(client, case_id="demo-1", frames=0)
        assert events[-1]["type"] == "error"
        assert "demo" in events[-1]["message"]

    def test_signed_off_stage_is_refused(self, env):
        client, store, _ = env
        case = store.load("live-1")
        case.workflow.stages["intraop"].status = StageStatus.SIGNED_OFF
        store.save(case)
        events = stream_session(client, frames=0)
        assert events[-1]["type"] == "error"
        assert "signed off" in events[-1]["message"]

    def test_only_intraop_kind_streams(self, env):
        client, _, _ = env
        with client.websocket_connect(
            "/api/cases/live-1/sources/audio/stream?kind=preop-interview&provider_id=p-tan"
        ) as ws:
            event = ws.receive_json()
        assert event["type"] == "error"
        assert "intraop-notes" in event["message"]

    def test_stub_runner_env_wires_a_fake_transcriber(self, tmp_path, monkeypatch):
        monkeypatch.setenv("PERIOP_STUB_RUNNER", "1")
        store = CaseStore(tmp_path / "_out")
        store.save(make_live_case())
        providers = tmp_path / "providers.json"
        providers.write_text(json.dumps(PROVIDERS))
        client = TestClient(
            create_app(out_dir=store.root, case_dir=tmp_path, providers_path=providers)
        )
        events = stream_session(client, frames=1)
        assert any(e["type"] == "partial" for e in events)
        assert events[-1]["type"] == "saved"


class TestParakeetStreamingAdapter:
    def test_bridges_riva_responses_to_feed_finish_events(self):
        from periop.tools.asr import ParakeetStreamingAsr

        def fake_stream(chunks, config):
            consumed = b"".join(chunks)
            assert consumed  # the audio made it through the queue
            yield SimpleNamespace(
                results=[
                    SimpleNamespace(
                        alternatives=[SimpleNamespace(transcript="propofol one ", words=[])],
                        is_final=False,
                    )
                ]
            )
            yield SimpleNamespace(
                results=[
                    SimpleNamespace(
                        alternatives=[
                            SimpleNamespace(
                                transcript="propofol one twenty",
                                words=[
                                    SimpleNamespace(word="propofol", start_time=100, end_time=600),
                                    SimpleNamespace(word="one", start_time=700, end_time=900),
                                    SimpleNamespace(word="twenty", start_time=1000, end_time=1500),
                                ],
                            )
                        ],
                        is_final=True,
                    )
                ]
            )

        asr = ParakeetStreamingAsr(stream_fn=fake_stream)
        events = asr.feed(HALF_SECOND)
        events += asr.finish()

        assert {"type": "partial", "text": "propofol one"} in events
        final = next(e for e in events if e["type"] == "final")
        assert final["text"] == "propofol one twenty"
        assert (final["t0"], final["t1"]) == (0.1, 1.5)  # ms → s from word times

    def test_finish_without_audio_is_empty(self):
        from periop.tools.asr import ParakeetStreamingAsr

        asr = ParakeetStreamingAsr(stream_fn=lambda chunks, config: iter(()))
        assert asr.finish() == []
