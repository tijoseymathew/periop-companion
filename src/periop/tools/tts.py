"""TTS rendering via the Magpie TTS NIM (spec §5).

Interview scripts are rendered to a single wav per encounter by synthesizing
each turn with a per-speaker voice and concatenating with short silence gaps.
Multi-speaker synthesis in one call isn't offered by the NIM, so speaker
identity is established by construction — and the returned timing manifest
(seg_id, speaker, t0, t1, text) is the ground-truth alignment the ASR/
diarization eval compares against.

Endpoint: ``PERIOP_TTS_BASE_URL`` (default local NIM on :9001), HTTP
``POST /v1/audio/synthesize`` multipart form → complete 16-bit mono PCM wav.
"""

from __future__ import annotations

import io
import os
import wave
from pathlib import Path
from typing import Any, Callable

DEFAULT_TTS_BASE_URL = "http://localhost:9001"

# Distinct, neutral en-US voices per script speaker role. Verified against
# /v1/audio/list_voices on magpie-tts-multilingual (2026-07).
DEFAULT_VOICES = {
    "PROVIDER": "Magpie-Multilingual.EN-US.Aria",
    "PATIENT": "Magpie-Multilingual.EN-US.Jason",
    "CAREGIVER": "Magpie-Multilingual.EN-US.Mia",
}
FALLBACK_VOICE = "Magpie-Multilingual.EN-US.Leo"

Synth = Callable[[str, str], bytes]  # (text, voice) -> wav bytes


def tts_base_url_from_env() -> str:
    return (os.environ.get("PERIOP_TTS_BASE_URL") or DEFAULT_TTS_BASE_URL).rstrip("/")


class MagpieTts:
    """Thin HTTP client for the Magpie TTS NIM; callable as a ``Synth``."""

    def __init__(
        self,
        base_url: str | None = None,
        client: Any | None = None,
        language: str = "en-US",
        sample_rate_hz: int = 22050,
        timeout_s: float = 120.0,
    ) -> None:
        if client is None:
            import httpx

            client = httpx.Client()
        self.client = client
        self.base_url = (base_url or tts_base_url_from_env()).rstrip("/")
        self.language = language
        self.sample_rate_hz = sample_rate_hz
        self.timeout_s = timeout_s

    def synthesize(self, text: str, voice: str) -> bytes:
        response = self.client.post(
            f"{self.base_url}/v1/audio/synthesize",
            data={
                "text": text,
                "language": self.language,
                "voice": voice,
                "sample_rate_hz": self.sample_rate_hz,
                "encoding": "LINEAR_PCM",
            },
            timeout=self.timeout_s,
        )
        response.raise_for_status()
        return response.content

    __call__ = synthesize


def render_dialogue(
    turns: list[dict],
    synth: Synth,
    out_path: Path | str,
    voices: dict[str, str] | None = None,
    gap_s: float = 0.35,
) -> list[dict]:
    """Render scripted turns to one wav; return the segment timing manifest.

    Each manifest entry mirrors the ``AudioSegment`` shape used in Case
    sources: ``{seg_id, speaker, text, t0, t1}``.
    """
    voices = voices if voices is not None else DEFAULT_VOICES
    out_path = Path(out_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)

    segments: list[dict] = []
    out_wav: wave.Wave_write | None = None
    params = None
    cursor_frames = 0
    try:
        for i, turn in enumerate(turns):
            voice = voices.get(turn["speaker"], FALLBACK_VOICE)
            clip = wave.open(io.BytesIO(synth(turn["text"], voice)), "rb")
            if out_wav is None:
                params = clip.getparams()
                out_wav = wave.open(str(out_path), "wb")
                out_wav.setparams(params)
            rate = params.framerate
            if i > 0:
                gap_frames = int(gap_s * rate)
                out_wav.writeframes(b"\x00" * gap_frames * params.sampwidth)
                cursor_frames += gap_frames
            n_frames = clip.getnframes()
            segments.append(
                {
                    "seg_id": f"s{i:03d}",
                    "speaker": turn["speaker"],
                    "text": turn["text"],
                    "t0": round(cursor_frames / rate, 3),
                    "t1": round((cursor_frames + n_frames) / rate, 3),
                }
            )
            out_wav.writeframes(clip.readframes(n_frames))
            cursor_frames += n_frames
    finally:
        if out_wav is not None:
            out_wav.close()
    return segments
