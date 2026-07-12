"""Background upload-time transcription.

Audio uploads return once the wav is durable; ASR runs on its own worker
thread and lands the transcript on the case, so the provider sees the
segments moments after uploading instead of at generate time — and the stage
run's own Transcriber then skips its minutes-long ASR leg (the source already
exists). The launch stamps ``transcription`` on the stage so the capture
screens can poll: pending → running → complete | failed. A failed or
interrupted job strands nothing: generating the stage transcribes as before.

ASR talks to the Parakeet NIM, not the reasoning tier, so this deliberately
does not take ``RUN_LOCK`` — a transcript can land while a generation or the
gap analysis is in flight.
"""

from __future__ import annotations

import threading
from datetime import datetime, timezone
from pathlib import Path

from periop.schemas import AudioSegment, Case, GapAnalysisState, Source, SourceType
from periop.store import CaseStore


def launch_transcription(
    app_state,
    case_id: str,
    stage: str,
    kind: str,
    wav_path: Path,
    offset: float = 0.0,
    provider_id: str | None = None,
    cleanup: Path | None = None,
) -> Case:
    """Stamp ``pending``, start the ASR worker, return the stamped case.

    Interview kinds transcribe the whole recording and replace the source's
    segments (uploads replace only with explicit confirmation, so a re-upload
    means a new recording). Intra-op memos accumulate: ``wav_path`` is the
    newly appended memo alone and ``offset`` its start within the growing wav,
    mirroring the streaming-dictation clock, and its segments append.
    """
    store = CaseStore(app_state.out_dir)
    case = _stamp(store, case_id, stage, GapAnalysisState.PENDING)
    runner = app_state.runner
    source_id = f"audio:{kind}"

    def work() -> None:
        _stamp(store, case_id, stage, GapAnalysisState.RUNNING)
        try:
            transcribed = runner.transcribe(wav_path, kind, source_id)
        except Exception as e:
            _stamp(store, case_id, stage, GapAnalysisState.FAILED, error=str(e))
        else:

            def apply(fresh: Case) -> None:
                source = fresh.get_source(source_id)
                if source is None:
                    source = Source(
                        source_id=source_id,
                        type=SourceType.AUDIO,
                        captured_at=datetime.now(timezone.utc),
                        provided_by=provider_id,
                    )
                    fresh.add_source(source)
                if kind == "intraop-notes":
                    for seg in transcribed.segments:
                        source.segments.append(
                            AudioSegment(
                                seg_id=f"s{len(source.segments) + 1:03d}",
                                t0=round(offset + seg.t0, 2),
                                t1=round(offset + seg.t1, 2),
                                speaker=seg.speaker,
                                text=seg.text,
                            )
                        )
                else:
                    source.segments = transcribed.segments
                fresh.workflow.stages[stage].transcription = GapAnalysisState.COMPLETE
                fresh.workflow.stages[stage].transcription_error = None

            # merged into the freshest copy: uploads, question prep, or a
            # generation may be saving this case concurrently
            store.mutate(case_id, apply)
        finally:
            if cleanup is not None:
                cleanup.unlink(missing_ok=True)

    threading.Thread(target=work, daemon=True, name=f"transcribe-{case_id}-{kind}").start()
    return case


def _stamp(
    store: CaseStore,
    case_id: str,
    stage: str,
    state: GapAnalysisState,
    error: str | None = None,
) -> Case:
    def apply(case: Case) -> None:
        s = case.workflow.stages[stage]
        s.transcription = state
        s.transcription_error = error

    return store.mutate(case_id, apply)


def fail_interrupted_transcriptions(out_dir) -> None:
    """Boot-time sweep: a crash mid-transcription must not strand a stage.

    The wav is durable, so nothing is lost — the stage run transcribes at
    generate time exactly as before upload-time transcription existed.
    """
    store = CaseStore(out_dir)
    for case_id in store.list_case_ids():
        try:
            case = store.load(case_id)
        except Exception:
            continue
        if case.workflow is None:
            continue
        dirty = False
        for stage in case.workflow.stages.values():
            if stage.transcription in (GapAnalysisState.PENDING, GapAnalysisState.RUNNING):
                stage.transcription = GapAnalysisState.FAILED
                stage.transcription_error = (
                    "interrupted by a server restart — the recording is safe; "
                    "generating this stage transcribes it"
                )
                dirty = True
        if dirty:
            store.save(case)
