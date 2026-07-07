"""Parakeet ASR path (spec §3.3 step 4, §3.4 step 1).

Offline: riva responses are faked; only the proto→segment conversion, role
mapping, and config plumbing are tested here. Live transcription is exercised
by scripts/eval_asr.py against a self-hosted Parakeet NIM.
"""

from types import SimpleNamespace

import pytest

from periop.schemas import SourceType
from periop.tools.asr import (
    ParakeetAsr,
    asr_grpc_url_from_env,
    assign_roles,
    words_to_segments,
)


def word(text, t0, t1, speaker=0):
    return {"word": text, "t0": t0, "t1": t1, "speaker": speaker}


class TestWordsToSegments:
    def test_groups_contiguous_words_by_speaker(self):
        words = [
            word("any", 0.0, 0.2, speaker=0),
            word("allergies", 0.3, 0.8, speaker=0),
            word("penicillin", 1.2, 1.9, speaker=1),
            word("doctor", 2.0, 2.4, speaker=1),
            word("noted", 3.0, 3.3, speaker=0),
        ]
        segments = words_to_segments(words)
        assert [s.text for s in segments] == [
            "any allergies",
            "penicillin doctor",
            "noted",
        ]
        assert segments[0].seg_id == "s001"
        assert segments[0].t0 == 0.0 and segments[0].t1 == 0.8
        assert segments[1].t0 == 1.2 and segments[1].t1 == 2.4

    def test_splits_on_long_pause_within_speaker(self):
        words = [
            word("propofol", 0.0, 0.5),
            word("given", 0.6, 0.9),
            # > max_pause_s of silence — separate dictation
            word("intubated", 5.0, 5.6),
        ]
        segments = words_to_segments(words, max_pause_s=2.0)
        assert [s.text for s in segments] == ["propofol given", "intubated"]

    def test_empty_words(self):
        assert words_to_segments([]) == []


class TestAssignRoles:
    def test_first_speaker_is_provider_second_patient(self):
        words = [
            word("hello", 0.0, 0.3, speaker=3),
            word("morning", 1.0, 1.4, speaker=1),
            word("thanks", 2.0, 2.3, speaker=3),
        ]
        segments = words_to_segments(words)
        assign_roles(segments)
        assert [s.speaker for s in segments] == ["PROVIDER", "PATIENT", "PROVIDER"]

    def test_third_speaker_is_caregiver(self):
        words = [
            word("a", 0.0, 0.1, speaker=0),
            word("b", 1.0, 1.1, speaker=1),
            word("c", 2.0, 2.1, speaker=2),
        ]
        segments = words_to_segments(words)
        assign_roles(segments)
        assert segments[2].speaker == "CAREGIVER"


def fake_riva_response(words):
    """Shape mirrors riva offline_recognize: results→alternatives→words."""
    riva_words = [
        SimpleNamespace(
            word=w["word"],
            start_time=int(w["t0"] * 1000),
            end_time=int(w["t1"] * 1000),
            speaker_tag=w["speaker"],
        )
        for w in words
    ]
    alt = SimpleNamespace(transcript=" ".join(w["word"] for w in words), words=riva_words)
    return SimpleNamespace(results=[SimpleNamespace(alternatives=[alt])])


class TestParakeetAsr:
    def test_transcribe_builds_diarized_source(self, tmp_path):
        wav = tmp_path / "a.wav"
        wav.write_bytes(b"RIFFfakewav")
        response = fake_riva_response(
            [
                word("any", 0.0, 0.2, speaker=0),
                word("allergies", 0.3, 0.8, speaker=0),
                word("penicillin", 1.2, 1.9, speaker=1),
            ]
        )
        calls = {}

        def recognize(content, config):
            calls["content"] = content
            calls["config"] = config
            return response

        asr = ParakeetAsr(recognize=recognize)
        source = asr.transcribe(wav, source_id="audio:preop-interview")
        assert source.source_id == "audio:preop-interview"
        assert source.type == SourceType.AUDIO
        assert calls["content"] == b"RIFFfakewav"
        assert [s.speaker for s in source.segments] == ["PROVIDER", "PATIENT"]
        assert source.segments[0].text == "any allergies"

    def test_transcribe_single_speaker_mode(self, tmp_path):
        wav = tmp_path / "n.wav"
        wav.write_bytes(b"RIFF")
        response = fake_riva_response(
            [word("propofol", 0.0, 0.5, speaker=0), word("given", 0.6, 0.9, speaker=0)]
        )
        asr = ParakeetAsr(recognize=lambda content, config: response)
        source = asr.transcribe(wav, source_id="audio:intraop-notes", diarize=False)
        assert all(s.speaker == "PROVIDER" for s in source.segments)


class TestEnv:
    def test_default(self, monkeypatch):
        monkeypatch.delenv("PERIOP_ASR_GRPC_URL", raising=False)
        assert asr_grpc_url_from_env() == "localhost:50051"

    def test_override(self, monkeypatch):
        monkeypatch.setenv("PERIOP_ASR_GRPC_URL", "gpu-host:50051")
        assert asr_grpc_url_from_env() == "gpu-host:50051"
