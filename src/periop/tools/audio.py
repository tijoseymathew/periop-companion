"""Audio normalization for live capture (spec v2 §3).

Browser capture produces webm/opus; uploads may be wav/m4a/mp3. Everything is
normalized server-side to 16 kHz mono 16-bit PCM wav — the format the
Parakeet ASR path, the audio-serving endpoint, and clip playback already
expect. ffmpeg does the transcoding when present; without it, PCM wav passes
through untouched so the wav-upload path always works.
"""

from __future__ import annotations

import io
import os
import shutil
import subprocess
import tempfile
import wave
from pathlib import Path

TARGET_RATE = 16000


class AudioNormalizationError(Exception):
    """The upload could not be turned into a playable wav."""

    def __init__(self, message: str, needs_ffmpeg: bool = False) -> None:
        super().__init__(message)
        self.needs_ffmpeg = needs_ffmpeg


def ffmpeg_available() -> bool:
    return shutil.which("ffmpeg") is not None


def normalize_to_wav(data: bytes, filename: str, dest: Path) -> None:
    """Write ``data`` (any common audio container) as 16 kHz mono PCM at dest."""
    dest.parent.mkdir(parents=True, exist_ok=True)
    if ffmpeg_available():
        _ffmpeg_normalize(data, filename, dest)
        return
    # ffmpeg-free fallback: PCM wav uploads pass through unchanged
    if not filename.lower().endswith(".wav"):
        raise AudioNormalizationError(
            "converting this recording needs ffmpeg on the server — "
            "install ffmpeg, or upload a .wav instead",
            needs_ffmpeg=True,
        )
    try:
        with wave.open(io.BytesIO(data), "rb") as w:
            w.getparams()
    except (wave.Error, EOFError):
        raise AudioNormalizationError("the upload is not a readable wav file") from None
    dest.write_bytes(data)


def _ffmpeg_normalize(data: bytes, filename: str, dest: Path) -> None:
    suffix = Path(filename).suffix or ".bin"
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        tmp.write(data)
        src = tmp.name
    try:
        result = subprocess.run(
            ["ffmpeg", "-y", "-i", src,
             "-ar", str(TARGET_RATE), "-ac", "1", "-c:a", "pcm_s16le",
             str(dest)],
            capture_output=True,
        )
        if result.returncode != 0:
            raise AudioNormalizationError("ffmpeg could not read the recording")
    finally:
        os.unlink(src)


def append_wav(dest: Path, extra: Path) -> None:
    """Append one wav's frames to another (intra-op memos accumulate, v2 §4.2)."""
    with wave.open(str(extra), "rb") as src:
        params = src.getparams()
        frames = src.readframes(src.getnframes())
    if not dest.exists():
        with wave.open(str(dest), "wb") as out:
            out.setparams(params)
            out.writeframes(frames)
        return
    with wave.open(str(dest), "rb") as existing:
        existing_params = existing.getparams()
        existing_frames = existing.readframes(existing.getnframes())
    if existing_params[:3] != params[:3]:  # channels, sampwidth, framerate
        raise AudioNormalizationError(
            "memo format differs from the earlier memos — re-record or install ffmpeg"
        )
    with wave.open(str(dest), "wb") as out:
        out.setparams(existing_params)
        out.writeframes(existing_frames + frames)
