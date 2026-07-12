"""RecordIngestor + transcript tools (spec §3.3).

RecordIngestor chunks the prior-records pack into citable document sources.
transcript_from_script is the offline gold path for the interview
transcribers: it turns a diarized script into timestamped audio segments
deterministically, so the rest of the pipeline (provenance, note writing)
runs without any TTS/ASR round-trip. The Parakeet NIM path produces the same
Source shape.
"""

import json
import os
from pathlib import Path

from periop.schemas import AudioSegment, Case, Source, SourceType
from periop.tools.chunker import chunk_text

# Rough spoken pace for synthesising plausible segment timings from text.
_WORDS_PER_SEC = 2.5
_INTER_TURN_GAP = 0.4


def ingest_records(case: Case, case_dir: Path) -> None:
    """Chunk every record markdown file into a document Source on the case.

    Idempotent: already-registered sources are skipped, so re-ingesting a
    resumed case is safe.
    """
    for md in sorted((Path(case_dir) / "records").glob("*.md")):
        source_id = f"doc:{md.stem}"
        if case.get_source(source_id) is not None:
            continue
        case.add_source(
            Source(source_id=source_id, type=SourceType.DOCUMENT, chunks=chunk_text(md.read_text()))
        )


def transcript_from_script(script_path: Path, source_id: str) -> Source:
    """Convert a diarized interview script into a timestamped audio Source."""
    turns = json.loads(Path(script_path).read_text())["turns"]
    return _segments_source(
        source_id, [(turn["speaker"], turn["text"]) for turn in turns]
    )


def transcript_from_voice_notes(notes_path: Path, source_id: str) -> Source:
    """Convert intra-op voice notes into a single-speaker audio Source.

    Voice notes are the anesthetist speaking hands-free, so every segment is
    the PROVIDER; the note's clock time is preserved in the segment text so
    downstream extraction can read it.
    """
    notes = json.loads(Path(notes_path).read_text())["notes"]
    # Prepend the dictation clock time so downstream event extraction reads the
    # real time (segment t0/t1 are only synthetic playback offsets).
    return _segments_source(
        source_id,
        [("PROVIDER", f"[{note['t']}] {note['text']}") for note in notes],
    )


def has_transcript_inputs(case_dir: Path, name: str) -> bool:
    """True when a transcript can be produced: a gold script or a captured wav."""
    case_dir = Path(case_dir)
    return (case_dir / "scripts" / f"{name}.json").exists() or (
        case_dir / "audio" / f"{name}.wav"
    ).exists()


def transcript_source(case_dir: Path, name: str, source_id: str) -> Source:
    """Pick the transcript path for one encounter script.

    Gold (deterministic, offline) by default. When ``PERIOP_TRANSCRIBE=asr``
    and TTS-rendered audio exists (scripts/render_audio.py), the wav goes
    through the Parakeet NIM instead — diarized for interviews; single-speaker
    with the anesthesia lexicon boosted for intra-op voice notes. Note the ASR
    path has no dictation clock times (the gold voice-notes path embeds them),
    so extracted event times degrade to playback offsets — part of what the
    audio A/B measures.

    Live-captured cases (v2) have a wav from the recorder but no gold script,
    so ASR is the only option there regardless of the env switch.
    """
    case_dir = Path(case_dir)
    wav = case_dir / "audio" / f"{name}.wav"
    script = case_dir / "scripts" / f"{name}.json"
    if wav.exists() and (os.environ.get("PERIOP_TRANSCRIBE") == "asr" or not script.exists()):
        import periop.tools.asr as asr_mod
        from periop.agents.lexicon import ANESTHESIA_LEXICON

        intraop = name == "intraop-notes"
        asr = asr_mod.ParakeetAsr(boosted_words=ANESTHESIA_LEXICON if intraop else None)
        return asr.transcribe(wav, source_id, diarize=not intraop)

    if name == "intraop-notes":
        return transcript_from_voice_notes(script, source_id)
    return transcript_from_script(script, source_id)


def _segments_source(source_id: str, turns: list[tuple[str, str]]) -> Source:
    segments: list[AudioSegment] = []
    t = 0.0
    for i, (speaker, text) in enumerate(turns, start=1):
        duration = max(1.0, len(text.split()) / _WORDS_PER_SEC)
        segments.append(
            AudioSegment(
                seg_id=f"s{i:03d}",
                t0=round(t, 2),
                t1=round(t + duration, 2),
                speaker=speaker,
                text=text,
            )
        )
        t += duration + _INTER_TURN_GAP
    return Source(source_id=source_id, type=SourceType.AUDIO, segments=segments)
