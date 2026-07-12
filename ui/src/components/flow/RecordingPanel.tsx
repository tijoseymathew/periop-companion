/**
 * The recording rail (design: "Interview recording"). One panel owns the
 * whole audio lifecycle: record or upload → uploading → transcribing (the
 * upload returns immediately; ASR runs server-side and the transcript lands
 * on the case) → ✓ transcribed with the playable recording and its segments.
 * A failed transcription never blocks: the wav is safe and the stage run
 * transcribes at generate time — the panel says exactly that.
 */
import { useRef } from "react";
import { audioUrl } from "../../lib/api";
import { transcriptionState, type JobState } from "../../lib/flow";
import { clock, useRecorder } from "../../lib/recorder";
import type { Case, Source, StageKey } from "../../lib/schema";
import { AudioPlayer } from "../AudioPlayer";
import { TranscriptList } from "./TranscriptList";

export function RecordingPanel({
  title,
  kase,
  stage,
  source,
  busy,
  canWrite,
  onUploadAudio,
}: {
  title: string;
  kase: Case;
  stage: StageKey;
  /** the stage's audio source once its transcript has landed */
  source: Source | null;
  busy: boolean;
  canWrite: boolean;
  onUploadAudio: (file: File) => void;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const recorder = useRecorder(onUploadAudio);
  const job: JobState = transcriptionState(kase, stage);
  const transcribing = job === "pending" || job === "running";
  const ready = source !== null && source.segments.length > 0;

  return (
    <div className="max-h-full w-[380px] flex-none self-start overflow-y-auto rounded-[15px] border border-surface-overlay bg-surface-sunken p-5">
      <div className="mb-3.5 text-[11.5px] font-bold uppercase tracking-[.11em] text-ink-faint">
        {title}
      </div>

      <input
        ref={fileInput}
        type="file"
        accept="audio/*,.wav,.mp3,.m4a,.webm"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onUploadAudio(f);
          e.target.value = "";
        }}
      />

      {!ready && recorder.state === "idle" && !busy && !transcribing && (
        <>
          <div className="flex flex-col items-center gap-2.5 rounded-[13px] border-[1.5px] border-dashed border-[#a9c6bd] bg-surface-base px-4 py-6">
            <button
              type="button"
              disabled={!canWrite}
              onClick={() => void recorder.start()}
              className="flex min-h-[52px] w-full items-center justify-center gap-2.5 rounded-[11px] bg-status-conflicting text-[15px] font-semibold text-ink-onBrand disabled:opacity-40"
            >
              <span className="h-3 w-3 rounded-full bg-surface-base" /> Record
            </button>
            <button
              type="button"
              disabled={!canWrite || busy}
              onClick={() => fileInput.current?.click()}
              className="text-[13.5px] font-semibold text-brand-ink underline underline-offset-2 disabled:opacity-40"
            >
              or upload an audio file
            </button>
            <span className="text-center text-[12px] text-ink-subtle">
              The transcript appears here moments after the recording lands.
            </span>
          </div>
          {recorder.error && (
            <p className="mt-2.5 text-[12.5px] leading-relaxed text-status-conflicting">
              {recorder.error}
            </p>
          )}
          {job === "failed" && (
            <p className="mt-2.5 text-[12.5px] leading-relaxed text-status-unsupported">
              The last recording couldn't be transcribed here — it's saved, and it will be
              transcribed when the note generates. You can also record again.
            </p>
          )}
        </>
      )}

      {recorder.state === "recording" && (
        <div className="flex flex-col items-center gap-3 rounded-[13px] border border-status-conflicting/40 bg-surface-base px-4 py-6">
          <div className="flex items-center gap-2 text-[13px] font-semibold text-status-conflicting">
            <span className="h-2 w-2 animate-barflow rounded-full bg-status-conflicting" />
            RECORDING
          </div>
          <div className="font-serif text-[40px] font-medium leading-none text-ink-primary">
            {clock(recorder.seconds)}
          </div>
          <button
            type="button"
            onClick={recorder.stop}
            className="flex h-[72px] w-[72px] animate-recPulse items-center justify-center rounded-full bg-status-conflicting"
            aria-label="Stop recording"
          >
            <span className="h-6 w-6 rounded-[6px] bg-surface-base" />
          </button>
          <span className="text-[12.5px] text-ink-dim">Tap the square to stop</span>
        </div>
      )}

      {(busy || transcribing) && recorder.state === "idle" && !ready && (
        <div className="flex items-center gap-3 rounded-[13px] border border-surface-overlay bg-surface-base px-4 py-4 text-[13.5px] text-ink-secondary">
          <span
            className="h-4 w-4 flex-none rounded-full border-[2.5px] border-transparent border-t-brand"
            style={{ animation: "spin .8s linear infinite" }}
          />
          {busy ? "Saving the recording…" : "Transcribing — the transcript lands here in a moment…"}
        </div>
      )}

      {ready && source && (
        <>
          <div className="rounded-[13px] border border-surface-overlay bg-surface-base px-4 pb-2 pt-3">
            <div className="flex items-center justify-between gap-3 px-0.5">
              <div className="min-w-0">
                <div className="truncate text-[13.5px] font-semibold text-ink-primary">
                  {source.source_id.replace(/^audio:/, "")}
                </div>
                <div className="mt-0.5 text-[12px] text-ink-subtle">
                  {source.segments.length} segment{source.segments.length === 1 ? "" : "s"}
                </div>
              </div>
              <span className="flex-none rounded-full bg-brand/10 px-2.5 py-1 text-[12px] font-semibold text-brand-ink">
                ✓ transcribed
              </span>
            </div>
            <AudioPlayer src={audioUrl(kase.case_id, source.source_id)} label={null} />
          </div>
          <div className="mb-2 mt-4 text-[11px] font-bold uppercase tracking-[.09em] text-ink-faint">
            Transcript
          </div>
          <TranscriptList segments={source.segments} maxHeight={230} />
          {stage === "intraop" && canWrite && (
            <button
              type="button"
              disabled={busy || transcribing}
              onClick={() => void recorder.start()}
              className="mt-3 flex min-h-[44px] w-full items-center justify-center rounded-[11px] border border-surface-overlay bg-surface-base text-[13.5px] font-semibold text-ink-muted disabled:opacity-40"
            >
              ● Record another memo
            </button>
          )}
        </>
      )}
    </div>
  );
}
