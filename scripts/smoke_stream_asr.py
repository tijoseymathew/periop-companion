"""Live streaming-ASR smoke test against the Parakeet NIM. Not run by pytest.

Feeds a wav to the streaming profile in real-time-ish chunks and prints the
partial/final events as they arrive — what the intra-op dictation screen
sees, minus the browser.

Usage: uv run python scripts/smoke_stream_asr.py [path/to/audio.wav]
Requires the Parakeet NIM's gRPC endpoint (PERIOP_ASR_GRPC_URL, default
localhost:50051). Defaults to a rendered case wav if no path is given.
"""

import sys
import wave
from pathlib import Path

from dotenv import load_dotenv

from periop.agents.lexicon import ANESTHESIA_LEXICON
from periop.tools.asr import ParakeetStreamingAsr

DEFAULT_WAV = Path("data/cases/sg-0001/audio/intraop-notes.wav")
CHUNK_SECONDS = 0.5


def main() -> None:
    load_dotenv()
    wav_path = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_WAV
    if not wav_path.exists():
        sys.exit(
            f"no wav at {wav_path} — render one (scripts/render_audio.py) "
            "or pass a path"
        )

    with wave.open(str(wav_path), "rb") as w:
        rate = w.getframerate()
        frames = w.readframes(w.getnframes())
    chunk_bytes = int(rate * CHUNK_SECONDS) * w.getsampwidth()
    print(f"streaming {wav_path} ({len(frames) / rate / 2:.1f}s at {rate} Hz)…\n")

    asr = ParakeetStreamingAsr(boosted_words=ANESTHESIA_LEXICON, sample_rate_hz=rate)
    partials = finals = 0
    for offset in range(0, len(frames), chunk_bytes):
        for event in asr.feed(frames[offset : offset + chunk_bytes]):
            if event["type"] == "partial":
                partials += 1
                print(f"  … {event['text']}")
            elif event["type"] == "final":
                finals += 1
                print(f"  ✓ [{event.get('t0', '?')}–{event.get('t1', '?')}s] {event['text']}")
    for event in asr.finish():
        if event["type"] == "final":
            finals += 1
            print(f"  ✓ [{event.get('t0', '?')}–{event.get('t1', '?')}s] {event['text']}")
        elif event["type"] == "error":
            sys.exit(f"stream error: {event['message']}")

    print(f"\nsmoke test OK — {partials} partials, {finals} finals")


if __name__ == "__main__":
    main()
