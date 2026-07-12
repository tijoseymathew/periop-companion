"""Parakeet ASR transcription with diarization + word boosting (spec §3.3/§3.4).

The Parakeet NIM's OpenAI-style HTTP endpoint returns plain text only;
diarization (Sortformer) and word boosting live on the Riva gRPC API, so this
client speaks gRPC (``PERIOP_ASR_GRPC_URL``, default local NIM on :50051). The
same gRPC client reaches NVIDIA's hosted NVCF endpoint (SSL + function-id, see
``_asr_hosted``); that endpoint is streaming-only, so batch jobs are streamed
there rather than sent as one offline call.

Speaker roles: diarization yields anonymous speaker tags. Interview scripts
always open with the provider, so the first speaker heard maps to PROVIDER,
the second to PATIENT, later ones to CAREGIVER (spec §10 role-mapping
heuristic — degrades gracefully rather than failing).
"""

from __future__ import annotations

import os
import queue
import threading
from pathlib import Path
from typing import Any, Callable, Iterator

from periop.schemas import AudioSegment, Source, SourceType

ASR_GRPC_DEFAULT = "localhost:50051"
DEFAULT_BOOST_SCORE = 20.0
_ROLE_ORDER = ["PROVIDER", "PATIENT", "CAREGIVER"]

# (audio_bytes, config) -> riva offline_recognize response
Recognize = Callable[[bytes, Any], Any]


def asr_grpc_url_from_env() -> str:
    return os.environ.get("PERIOP_ASR_GRPC_URL") or ASR_GRPC_DEFAULT


def _asr_hosted() -> bool:
    """Is ASR pointed at NVIDIA's hosted NVCF endpoint (vs a local NIM)?

    Enabled by ``PERIOP_ASR_FUNCTION_ID`` (or ``PERIOP_ASR_USE_SSL=1``). The
    hosted endpoint is streaming-only, so batch transcription is fed through the
    streaming API when this is true — see ``ParakeetAsr.transcribe``.
    """
    return bool(os.environ.get("PERIOP_ASR_FUNCTION_ID")) or os.environ.get(
        "PERIOP_ASR_USE_SSL", ""
    ).lower() in ("1", "true", "yes")


def _riva_auth(server: str) -> Any:
    """Build a Riva ``Auth`` for either a local NIM or the hosted NVCF endpoint.

    Local NIMs (the default) don't authenticate: plain gRPC, no SSL. When
    ``_asr_hosted()`` the connection uses SSL and carries the key and function id
    as gRPC metadata (not an HTTP header); the nvapi- key is read from
    ``NGC_API_KEY`` (``NVIDIA_API_KEY`` accepted as a synonym). Diarization is
    available on the hosted ``…-sortformer`` function over this gRPC path.
    """
    import riva.client

    if not _asr_hosted():
        return riva.client.Auth(uri=server, use_ssl=False)

    function_id = os.environ.get("PERIOP_ASR_FUNCTION_ID")
    key = os.environ.get("NGC_API_KEY") or os.environ.get("NVIDIA_API_KEY") or ""
    metadata: list[list[str]] = []
    if function_id:
        metadata.append(["function-id", function_id])
    if key:
        metadata.append(["authorization", f"Bearer {key}"])
    return riva.client.Auth(uri=server, use_ssl=True, metadata_args=metadata or None)


def _words_from_results(results: Any, diarize: bool) -> list[dict]:
    """Flatten riva results (offline or streaming) to ``{word,t0,t1,speaker}``."""
    words: list[dict] = []
    for result in results:
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
    return words


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
    """Batch transcription against the Parakeet NIM over gRPC.

    Local NIMs transcribe in one ``offline_recognize`` call. The hosted NVCF
    endpoint (``_asr_hosted()``) is streaming-only, so there the same recording
    is fed through the streaming API — chunked and drained to finals — which is
    also where the hosted ``…-sortformer`` model returns diarization. Either way
    the word list feeds the same segment/role logic, so callers see no
    difference (spec §10 role mapping still degrades gracefully).
    """

    def __init__(
        self,
        server: str | None = None,
        recognize: Recognize | None = None,
        boosted_words: list[str] | None = None,
        boost_score: float = DEFAULT_BOOST_SCORE,
        stream_fn: "StreamFn | None" = None,
    ) -> None:
        self.server = server or asr_grpc_url_from_env()
        self.boosted_words = boosted_words
        self.boost_score = boost_score
        self._recognize = recognize
        self._stream_fn = stream_fn

    def _riva_recognize(self, content: bytes, config: Any) -> Any:
        import riva.client

        return riva.client.ASRService(_riva_auth(self.server)).offline_recognize(
            content, config
        )

    def _riva_stream_file(self, chunks: "Iterator[bytes]", config: Any) -> Any:
        import riva.client

        return riva.client.ASRService(_riva_auth(self.server)).streaming_response_generator(
            audio_chunks=chunks, streaming_config=config
        )

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

    def _use_streaming(self) -> bool:
        if self._recognize is not None:  # offline test double
            return False
        if self._stream_fn is not None:  # streaming test double
            return True
        return _asr_hosted()

    def _transcribe_offline(self, wav_path: Path | str, diarize: bool) -> list[dict]:
        content = Path(wav_path).read_bytes()
        config = self._build_config(diarize, self._wav_rate(wav_path))
        recognize = self._recognize or self._riva_recognize
        return _words_from_results(recognize(content, config).results, diarize)

    def _transcribe_streaming(self, wav_path: Path | str, diarize: bool) -> list[dict]:
        import riva.client

        sample_rate_hz, frames = self._read_pcm(wav_path)
        config = self._build_config(diarize, sample_rate_hz)
        streaming_config = (
            None
            if config is None
            else riva.client.StreamingRecognitionConfig(config=config, interim_results=False)
        )
        chunk = max(int(sample_rate_hz * 0.5) * 2, 2)  # ~0.5s of PCM16 per frame
        chunks = (frames[i : i + chunk] for i in range(0, len(frames), chunk))
        stream_fn = self._stream_fn or self._riva_stream_file
        words: list[dict] = []
        for response in stream_fn(chunks, streaming_config):
            finals = [r for r in response.results if r.is_final]
            words += _words_from_results(finals, diarize)
        return words

    @staticmethod
    def _wav_rate(wav_path: Path | str) -> int:
        import wave

        try:
            with wave.open(str(wav_path), "rb") as w:
                return w.getframerate()
        except (wave.Error, EOFError):  # non-RIFF fixture in tests
            return 22050

    @staticmethod
    def _read_pcm(wav_path: Path | str) -> tuple[int, bytes]:
        import wave

        try:
            with wave.open(str(wav_path), "rb") as w:
                return w.getframerate(), w.readframes(w.getnframes())
        except (wave.Error, EOFError):  # non-RIFF fixture in tests
            return 22050, b""

    def transcribe(
        self, wav_path: Path | str, source_id: str, diarize: bool = True
    ) -> Source:
        from periop.nat.telemetry import traced_tool_call

        with traced_tool_call("parakeet-asr", input_text=str(wav_path)) as record:
            if self._use_streaming():
                words = self._transcribe_streaming(wav_path, diarize)
            else:
                words = self._transcribe_offline(wav_path, diarize)
            segments = words_to_segments(words)
            assign_roles(segments)
            record.output = f"{source_id}: {len(segments)} segments"
        return Source(source_id=source_id, type=SourceType.AUDIO, segments=segments)


# (chunk_iterator, streaming_config) -> riva streaming response iterator
StreamFn = Callable[[Iterator[bytes], Any], Any]


class ParakeetStreamingAsr:
    """Streaming (dictation) transcription — the Parakeet streaming profile.

    The WS handler pushes PCM16 frames via ``feed`` and collects transcript
    events; ``finish`` closes the stream and drains the rest. Internally a
    worker thread drives the pull-based Riva streaming generator, bridged by
    queues, so the caller never blocks on the network per frame.

    Events: ``{"type": "partial"|"final", "text": …}``; finals carry ``t0``/
    ``t1`` seconds (from word time offsets) when the service provides them —
    otherwise the WS handler falls back to byte-count timing.
    """

    def __init__(
        self,
        server: str | None = None,
        boosted_words: list[str] | None = None,
        boost_score: float = DEFAULT_BOOST_SCORE,
        sample_rate_hz: int = 16000,
        stream_fn: StreamFn | None = None,
    ) -> None:
        self.server = server or asr_grpc_url_from_env()
        self.boosted_words = boosted_words
        self.boost_score = boost_score
        self.sample_rate_hz = sample_rate_hz
        self._stream_fn = stream_fn
        self._thread: threading.Thread | None = None
        self._done = False

    def _build_config(self) -> Any:
        if self._stream_fn is not None:  # injected in tests — config unused
            return None
        import riva.client

        config = riva.client.RecognitionConfig(
            encoding=riva.client.AudioEncoding.LINEAR_PCM,
            language_code="en-US",
            max_alternatives=1,
            enable_automatic_punctuation=False,
            enable_word_time_offsets=True,
            audio_channel_count=1,
            sample_rate_hertz=self.sample_rate_hz,
        )
        if self.boosted_words:
            riva.client.add_word_boosting_to_config(
                config, self.boosted_words, self.boost_score
            )
        return riva.client.StreamingRecognitionConfig(config=config, interim_results=True)

    def _riva_stream(self, chunks: Iterator[bytes], config: Any) -> Any:
        import riva.client

        return riva.client.ASRService(_riva_auth(self.server)).streaming_response_generator(
            audio_chunks=chunks, streaming_config=config
        )

    def _ensure_started(self) -> None:
        if self._thread is not None:
            return
        self._in_q: queue.Queue = queue.Queue()
        self._out_q: queue.Queue = queue.Queue()
        stream_fn = self._stream_fn or self._riva_stream
        config = self._build_config()

        def work() -> None:
            try:
                for response in stream_fn(iter(self._in_q.get, None), config):
                    for result in response.results:
                        if not result.alternatives:
                            continue
                        alt = result.alternatives[0]
                        event: dict = {
                            "type": "final" if result.is_final else "partial",
                            "text": alt.transcript.strip(),
                        }
                        words = getattr(alt, "words", None)
                        if result.is_final and words:
                            event["t0"] = round(words[0].start_time / 1000.0, 2)
                            event["t1"] = round(words[-1].end_time / 1000.0, 2)
                        self._out_q.put(event)
            except Exception as e:  # surfaced as a transcript error event
                self._out_q.put({"type": "error", "message": str(e)})
            finally:
                self._out_q.put(None)  # stream ended

        self._thread = threading.Thread(target=work, daemon=True)
        self._thread.start()

    def _drain_nowait(self) -> list[dict]:
        events: list[dict] = []
        while True:
            try:
                item = self._out_q.get_nowait()
            except queue.Empty:
                return events
            if item is None:
                self._done = True
                return events
            events.append(item)

    def feed(self, pcm: bytes) -> list[dict]:
        self._ensure_started()
        if not self._done:
            self._in_q.put(bytes(pcm))
        return self._drain_nowait()

    def finish(self) -> list[dict]:
        if self._thread is None:
            return []
        events = self._drain_nowait()
        if self._done:
            return events
        self._in_q.put(None)
        while (item := self._out_q.get()) is not None:
            events.append(item)
        self._done = True
        self._thread.join(timeout=5)
        return events
