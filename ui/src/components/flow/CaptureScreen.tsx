/**
 * Intra-op · Voice memo / Post-op · Interview (PeriOp Workflow.dc.html
 * "isIntraRecord" / "isPostInterview"). One unmistakable record button —
 * designed for a tablet at arm's length — with upload as the quiet
 * alternative. The transcript appears moments after the recording lands
 * (upload-time transcription); intra-op memos accumulate into one running
 * timeline. One primary action once audio exists: generate the stage.
 */
import { useRef } from "react";
import { audioUrl } from "../../lib/api";
import { audioSource, transcriptionBusy, transcriptionState } from "../../lib/flow";
import { clock, useRecorder } from "../../lib/recorder";
import { GENERATE_LABELS } from "../../lib/workflow";
import type { Case, StageKey } from "../../lib/schema";
import { AudioPlayer } from "../AudioPlayer";
import { StageContainer } from "./StageContainer";
import { TranscriptList } from "./TranscriptList";

const COPY: Record<
  "intraop" | "postop",
  { eyebrow: string; h1: string; sub: string; doneTitle: string; doneSub: string }
> = {
  intraop: {
    eyebrow: "Intra-op · Voice memo",
    h1: "Record a voice memo",
    sub: "Dictate what's happening in theatre. Each memo is transcribed straight onto the case — no typing, no clarifying questions.",
    doneTitle: "Memo transcribed",
    doneSub: "Every line links back to this recording. Keep dictating as the case moves, then generate the theatre record.",
  },
  postop: {
    eyebrow: "Post-op · Interview",
    h1: "Record the post-op interview",
    sub: "Capture the recovery conversation — pain, nausea, obs — then generate the PACU handoff.",
    doneTitle: "Interview captured",
    doneSub: "Ready to bring the whole case — pre-op, theatre and recovery — together into the handoff.",
  },
};

export function CaptureScreen({
  stage,
  kase,
  busy,
  notice,
  canWrite,
  onUploadAudio,
  onGenerate,
}: {
  stage: Extract<StageKey, "intraop" | "postop">;
  kase: Case;
  busy: boolean;
  notice: string | null;
  canWrite: boolean;
  onUploadAudio: (file: File) => void;
  onGenerate: () => void;
}) {
  const copy = COPY[stage];
  const fileInput = useRef<HTMLInputElement>(null);
  const recorder = useRecorder(onUploadAudio);
  const source = audioSource(kase, stage);
  const transcribing = transcriptionBusy(kase, stage);
  const failed = transcriptionState(kase, stage) === "failed";
  const inputsRecorded = !!kase.workflow?.stages[stage].inputs_recorded_at;
  const captured = source !== null && source.segments.length > 0;
  const canGenerate = canWrite && inputsRecorded && !transcribing && !busy;

  return (
    <StageContainer fullHeight>
      <div className="mb-5">
        <div className="text-[12px] font-bold uppercase tracking-[.13em] text-gold">
          {copy.eyebrow}
        </div>
        <h1 className="mt-2 font-serif text-[29px] font-medium text-ink-primary">{copy.h1}</h1>
        <p className="mt-2 max-w-[600px] text-[14.5px] leading-relaxed text-ink-secondary">
          {copy.sub}
        </p>
      </div>

      {notice && (
        <div className="mb-5 rounded-[12px] border border-status-unsupported/40 bg-status-unsupported/[0.08] px-4 py-3 text-[13.5px] text-status-unsupported">
          {notice}
        </div>
      )}

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

      {/* nothing captured yet: the big record surface */}
      {!captured && (
        <div className="flex flex-1 flex-col items-center justify-center gap-6">
          {recorder.state === "idle" && !busy && !transcribing && (
            <>
              <button
                type="button"
                disabled={!canWrite}
                onClick={() => void recorder.start()}
                className="flex h-[150px] w-[150px] flex-col items-center justify-center gap-2 rounded-full bg-status-conflicting ring-[6px] ring-status-conflicting/20 disabled:opacity-40"
              >
                <span className="h-10 w-10 rounded-full bg-surface-base" />
                <span className="text-[15px] font-semibold text-ink-onBrand">Record</span>
              </button>
              <div className="text-[14px] text-ink-dim">
                Tap to start · or{" "}
                <button
                  type="button"
                  disabled={!canWrite}
                  onClick={() => fileInput.current?.click()}
                  className="font-semibold text-brand-ink underline underline-offset-2 disabled:opacity-40"
                >
                  upload an audio file
                </button>
              </div>
              {recorder.error && (
                <p className="max-w-[420px] text-center text-[13px] text-status-conflicting">
                  {recorder.error}
                </p>
              )}
              {failed && (
                <p className="max-w-[460px] text-center text-[13px] leading-relaxed text-ink-dim">
                  The recording is saved but couldn't be transcribed here — it will be
                  transcribed when the {stage === "intraop" ? "record" : "handoff"} generates.
                  {inputsRecorded && " You can generate now, or record again."}
                </p>
              )}
              {failed && inputsRecorded && (
                <button
                  type="button"
                  disabled={!canGenerate}
                  onClick={onGenerate}
                  className="flex min-h-[50px] items-center rounded-[11px] bg-brand px-6 text-[15px] font-semibold text-ink-onBrand shadow-[0_1px_0_rgba(255,255,255,.16)_inset] disabled:opacity-40"
                >
                  {GENERATE_LABELS[stage]} &nbsp;→
                </button>
              )}
            </>
          )}
          {recorder.state === "recording" && (
            <>
              <div className="flex items-center gap-2.5 text-[14px] font-semibold text-status-conflicting">
                <span className="h-2.5 w-2.5 animate-barflow rounded-full bg-status-conflicting" />
                RECORDING
              </div>
              <div className="font-serif text-[56px] font-medium leading-none text-ink-primary">
                {clock(recorder.seconds)}
              </div>
              <button
                type="button"
                onClick={recorder.stop}
                aria-label="Stop recording"
                className="flex h-[118px] w-[118px] animate-recPulse items-center justify-center rounded-full bg-status-conflicting"
              >
                <span className="h-9 w-9 rounded-[9px] bg-surface-base" />
              </button>
              <div className="text-[14px] text-ink-dim">Tap the square to stop</div>
            </>
          )}
          {(busy || transcribing) && recorder.state === "idle" && (
            <div className="flex items-center gap-3 rounded-[13px] border border-surface-overlay bg-surface-base px-5 py-4 text-[14px] text-ink-secondary">
              <span
                className="h-4 w-4 flex-none rounded-full border-[2.5px] border-transparent border-t-brand"
                style={{ animation: "spin .8s linear infinite" }}
              />
              {busy
                ? "Saving the recording…"
                : "Transcribing — the transcript lands here in a moment…"}
            </div>
          )}
        </div>
      )}

      {/* captured: transcript + the one action */}
      {captured && source && (
        <div className="flex items-start gap-7">
          <div className="min-w-0 flex-1">
            <div className="mb-4 rounded-[13px] border border-surface-overlay bg-surface-sunken px-4 pb-2 pt-3">
              <div className="px-0.5 text-[13.5px] font-semibold text-ink-primary">
                {stage === "intraop" ? "Theatre memos" : "Post-op interview"}
              </div>
              <AudioPlayer src={audioUrl(kase.case_id, source.source_id)} label={null} />
            </div>
            <div className="mb-2 text-[11px] font-bold uppercase tracking-[.09em] text-ink-faint">
              Transcript
            </div>
            <TranscriptList segments={source.segments} />
          </div>

          <div className="sticky top-0 w-[300px] flex-none rounded-[15px] border border-surface-overlay bg-surface-sunken px-5 py-5">
            {transcribing ? (
              <div className="mb-3 flex h-[34px] w-[34px] items-center justify-center rounded-full bg-brand/10">
                <span
                  className="h-4 w-4 rounded-full border-[2.5px] border-transparent border-t-brand"
                  style={{ animation: "spin .8s linear infinite" }}
                />
              </div>
            ) : (
              <div className="mb-3 flex h-[34px] w-[34px] items-center justify-center rounded-full bg-brand/10 text-[15px] text-brand-ink">
                ✓
              </div>
            )}
            <div className="text-[15px] font-semibold text-ink-primary">
              {transcribing ? "Transcribing the latest memo…" : copy.doneTitle}
            </div>
            <div className="mt-1.5 text-[13.5px] leading-relaxed text-ink-secondary">
              {copy.doneSub}
            </div>
            <button
              type="button"
              disabled={!canGenerate}
              onClick={onGenerate}
              className="mt-4 flex min-h-[48px] w-full items-center justify-center rounded-[11px] bg-brand px-4 text-[14.5px] font-semibold text-ink-onBrand shadow-[0_1px_0_rgba(255,255,255,.16)_inset] disabled:opacity-40"
            >
              {GENERATE_LABELS[stage]} &nbsp;→
            </button>
            {stage === "intraop" && (
              <button
                type="button"
                disabled={!canWrite || busy || transcribing || recorder.state === "recording"}
                onClick={() => void recorder.start()}
                className="mt-2.5 flex min-h-[44px] w-full items-center justify-center rounded-[11px] border border-surface-overlay bg-surface-base text-[13.5px] font-semibold text-ink-muted disabled:opacity-40"
              >
                ● Record another memo
              </button>
            )}
            {recorder.state === "recording" && (
              <div className="mt-3 flex flex-col items-center gap-2.5 rounded-[12px] border border-status-conflicting/40 bg-surface-base px-3 py-4">
                <div className="font-serif text-[30px] font-medium leading-none text-ink-primary">
                  {clock(recorder.seconds)}
                </div>
                <button
                  type="button"
                  onClick={recorder.stop}
                  aria-label="Stop recording"
                  className="flex h-[56px] w-[56px] animate-recPulse items-center justify-center rounded-full bg-status-conflicting"
                >
                  <span className="h-[18px] w-[18px] rounded-[5px] bg-surface-base" />
                </button>
                <span className="text-[12px] text-ink-dim">Tap the square to stop</span>
              </div>
            )}
          </div>
        </div>
      )}
    </StageContainer>
  );
}
