"""Parakeet ASR transcription with diarization + word boosting (spec §3.3/§3.4).

The Parakeet NIM's OpenAI-style HTTP endpoint returns plain text only;
diarization (Sortformer) and word boosting live on the Riva gRPC API, so this
client speaks gRPC (``PERIOP_ASR_GRPC_URL``, default local NIM on :50051).

Speaker roles: diarization yields anonymous speaker tags. Interview scripts
always open with the provider, so the first speaker heard maps to PROVIDER,
the second to PATIENT, later ones to CAREGIVER (spec §10 role-mapping
heuristic — degrades gracefully rather than failing).
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any, Callable

from periop.schemas import AudioSegment, Source, SourceType

ASR_GRPC_DEFAULT = "localhost:50051"
DEFAULT_BOOST_SCORE = 20.0
_ROLE_ORDER = ["PROVIDER", "PATIENT", "CAREGIVER"]

# (audio_bytes, config) -> riva offline_recognize response
Recognize = Callable[[bytes, Any], Any]


def asr_grpc_url_from_env() -> str:
    return os.environ.get("PERIOP_ASR_GRPC_URL") or ASR_GRPC_DEFAULT


def words_to_segments(words: list[dict], max_pause_s: float = 2.0) -> list[AudioSegment]:
    """Group timestamped words into segments, breaking on speaker change or pause.

    ``words``: ``{word, t0, t1, speaker}`` with times in seconds. Segment ids
    follow the gold-path convention (s001…).
    """
    segments: list[AudioSegment] = []
    group: list[dict] = []

    def flush() -> None:
        if not group:
            return
        segments.append(
            AudioSegment(
                seg_id=f"s{len(segments) + 1:03d}",
                t0=round(group[0]["t0"], 2),
                t1=round(group[-1]["t1"], 2),
                speaker=str(group[0]["speaker"]),
                text=" ".join(w["word"] for w in group),
            )
        )
        group.clear()

    for w in words:
        if group and (
            w["speaker"] != group[0]["speaker"] or w["t0"] - group[-1]["t1"] > max_pause_s
        ):
            flush()
        group.append(w)
    flush()
    return segments


def assign_roles(segments: list[AudioSegment]) -> None:
    """Map anonymous diarization tags to roles by order of first appearance."""
    roles: dict[str, str] = {}
    for seg in segments:
        if seg.speaker not in roles:
            index = min(len(roles), len(_ROLE_ORDER) - 1)
            roles[seg.speaker] = _ROLE_ORDER[index]
        seg.speaker = roles[seg.speaker]


class ParakeetAsr:
    """Offline (batch) transcription against the Parakeet NIM over gRPC."""

    def __init__(
        self,
        server: str | None = None,
        recognize: Recognize | None = None,
        boosted_words: list[str] | None = None,
        boost_score: float = DEFAULT_BOOST_SCORE,
    ) -> None:
        self.server = server or asr_grpc_url_from_env()
        self.boosted_words = boosted_words
        self.boost_score = boost_score
        self._recognize = recognize

    def _riva_recognize(self, content: bytes, config: Any) -> Any:
        import riva.client

        auth = riva.client.Auth(uri=self.server, use_ssl=False)
        return riva.client.ASRService(auth).offline_recognize(content, config)

    def _build_config(self, diarize: bool, sample_rate_hz: int) -> Any:
        if self._recognize is not None:  # injected in tests — config unused
            return None
        import riva.client

        config = riva.client.RecognitionConfig(
            encoding=riva.client.AudioEncoding.LINEAR_PCM,
            language_code="en-US",
            max_alternatives=1,
            enable_automatic_punctuation=False,
            enable_word_time_offsets=True,
            audio_channel_count=1,
            sample_rate_hertz=sample_rate_hz,
        )
        if diarize:
            riva.client.add_speaker_diarization_to_config(
                config, diarization_enable=True, diarization_max_speakers=3
            )
        if self.boosted_words:
            riva.client.add_word_boosting_to_config(
                config, self.boosted_words, self.boost_score
            )
        return config

    def transcribe(
        self, wav_path: Path | str, source_id: str, diarize: bool = True
    ) -> Source:
        import wave

        content = Path(wav_path).read_bytes()
        try:
            with wave.open(str(wav_path), "rb") as w:
                sample_rate_hz = w.getframerate()
        except (wave.Error, EOFError):  # non-RIFF fixture in tests
            sample_rate_hz = 22050
        config = self._build_config(diarize, sample_rate_hz)
        recognize = self._recognize or self._riva_recognize
        response = recognize(content, config)

        words: list[dict] = []
        for result in response.results:
            if not result.alternatives:
                continue
            for w in result.alternatives[0].words:
                words.append(
                    {
                        "word": w.word,
                        "t0": max(w.start_time / 1000.0, 0.0),
                        "t1": max(w.end_time / 1000.0, 0.0),
                        "speaker": getattr(w, "speaker_tag", 0) if diarize else 0,
                    }
                )
        segments = words_to_segments(words)
        assign_roles(segments)
        return Source(source_id=source_id, type=SourceType.AUDIO, segments=segments)
