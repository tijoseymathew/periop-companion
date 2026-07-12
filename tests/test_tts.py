"""TTS rendering (spec §5): interview scripts → multi-speaker wav + timing manifest.

Offline: synthesis is faked with generated PCM wavs; the Magpie HTTP client is
tested against a mocked transport. Live rendering lives in scripts/render_audio.py.
"""

import io
import struct
import wave
from types import SimpleNamespace

import pytest

from periop.tools.tts import (
    DEFAULT_VOICES,
    MagpieTts,
    render_dialogue,
    tts_base_url_from_env,
)


def make_wav(duration_s: float, rate: int = 22050) -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        n = int(duration_s * rate)
        w.writeframes(struct.pack(f"<{n}h", *([1000] * n)))
    return buf.getvalue()


def wav_duration(path) -> float:
    with wave.open(str(path), "rb") as w:
        return w.getnframes() / w.getframerate()


TURNS = [
    {"speaker": "PROVIDER", "text": "Any allergies?"},
    {"speaker": "PATIENT", "text": "Penicillin, doctor. Got rash."},
    {"speaker": "PROVIDER", "text": "Noted."},
]


class FakeSynth:
    """Callable (text, voice) -> wav bytes; records calls."""

    def __init__(self, duration_s=0.5):
        self.duration_s = duration_s
        self.calls = []

    def __call__(self, text, voice):
        self.calls.append((text, voice))
        return make_wav(self.duration_s)


class TestRenderDialogue:
    def test_writes_concatenated_wav_with_gaps(self, tmp_path):
        synth = FakeSynth(duration_s=0.5)
        out = tmp_path / "preop.wav"
        render_dialogue(TURNS, synth, out, gap_s=0.2)
        assert out.exists()
        # 3 × 0.5s speech + 2 × 0.2s inter-turn gaps
        assert wav_duration(out) == pytest.approx(1.9, abs=0.02)

    def test_manifest_timing_and_content(self, tmp_path):
        synth = FakeSynth(duration_s=0.5)
        segments = render_dialogue(TURNS, synth, tmp_path / "a.wav", gap_s=0.2)
        assert [s["speaker"] for s in segments] == ["PROVIDER", "PATIENT", "PROVIDER"]
        assert [s["text"] for s in segments] == [t["text"] for t in TURNS]
        assert segments[0]["seg_id"] == "s000"
        assert segments[0]["t0"] == pytest.approx(0.0)
        assert segments[0]["t1"] == pytest.approx(0.5, abs=0.01)
        # next turn starts after the gap
        assert segments[1]["t0"] == pytest.approx(0.7, abs=0.01)
        for seg in segments:
            assert seg["t1"] > seg["t0"]

    def test_speaker_voice_mapping(self, tmp_path):
        synth = FakeSynth()
        voices = {"PROVIDER": "voice-a", "PATIENT": "voice-b"}
        render_dialogue(TURNS, synth, tmp_path / "a.wav", voices=voices)
        assert [v for _, v in synth.calls] == ["voice-a", "voice-b", "voice-a"]

    def test_unknown_speaker_falls_back_to_default_voice(self, tmp_path):
        synth = FakeSynth()
        turns = [{"speaker": "CAREGIVER", "text": "She ate at eight."}]
        render_dialogue(turns, synth, tmp_path / "a.wav", voices={"PROVIDER": "v"})
        assert len(synth.calls) == 1  # falls back rather than raising

    def test_default_voices_cover_script_speakers(self):
        for speaker in ("PROVIDER", "PATIENT", "CAREGIVER"):
            assert speaker in DEFAULT_VOICES


class TestMagpieTts:
    def test_posts_multipart_form_and_returns_bytes(self):
        posted = {}

        def fake_post(url, data=None, files=None, timeout=None):
            posted["url"] = url
            posted["data"] = data
            return SimpleNamespace(
                status_code=200, content=b"RIFFwav", raise_for_status=lambda: None
            )

        client = SimpleNamespace(post=fake_post)
        tts = MagpieTts(base_url="http://spark:9001", client=client)
        out = tts.synthesize("Hello.", voice="Magpie-Multilingual.EN-US.Aria")
        assert out == b"RIFFwav"
        assert posted["url"] == "http://spark:9001/v1/audio/synthesize"
        assert posted["data"]["text"] == "Hello."
        assert posted["data"]["language"] == "en-US"
        assert posted["data"]["voice"] == "Magpie-Multilingual.EN-US.Aria"


class TestBaseUrlEnv:
    def test_env_override(self, monkeypatch):
        monkeypatch.setenv("PERIOP_TTS_BASE_URL", "http://spark:9001/")
        assert tts_base_url_from_env() == "http://spark:9001"  # trailing slash stripped

    def test_default(self, monkeypatch):
        monkeypatch.delenv("PERIOP_TTS_BASE_URL", raising=False)
        assert tts_base_url_from_env() == "http://localhost:9001"
