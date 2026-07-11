/**
 * Pre-op · Building the intake (PeriOp Workflow.dc.html "isGenerating").
 * The progress ring runs on real signals — the record uploads landing, then
 * the background question prep's pending → running → complete lifecycle —
 * with a slow creep between signals so the wait reads as motion, never a
 * bare spinner (design brief §4.4). The screen never blocks anything: prep
 * runs server-side and the case flips to the interview when it lands.
 */
import { useEffect, useRef, useState } from "react";
import type { JobState } from "../../lib/flow";

export interface UploadProgress {
  done: number;
  total: number;
}

export function IntakeBuildScreen({
  title,
  uploads,
  gap,
  gapError,
  onRetry,
  onBackToRecords,
}: {
  title: string;
  uploads: UploadProgress | null;
  gap: JobState;
  gapError: string | null;
  onRetry: () => void;
  onBackToRecords: () => void;
}) {
  const uploadsDone = !uploads || uploads.done >= uploads.total;
  const failed = gap === "failed";

  // honest milestones, animated between: uploads → 35, queued → 45,
  // reading (running) creeps toward 90, complete → 100
  const target = !uploadsDone
    ? Math.round((uploads.done / Math.max(1, uploads.total)) * 35)
    : gap === "complete"
      ? 100
      : gap === "running"
        ? 90
        : 45;
  const [pct, setPct] = useState(0);
  const pctRef = useRef(0);
  useEffect(() => {
    const id = setInterval(() => {
      const cur = pctRef.current;
      if (cur >= target) return;
      // sprint toward fresh milestones, creep while the model reads
      const step = target - cur > 20 ? 4 : target === 90 ? 0.4 : 2;
      pctRef.current = Math.min(target, cur + step);
      setPct(Math.round(pctRef.current));
    }, 120);
    return () => clearInterval(id);
  }, [target]);

  const steps: { label: string; done: boolean; active: boolean }[] = [
    {
      label: uploads
        ? `Saving the records (${Math.min(uploads.done, uploads.total)} of ${uploads.total})`
        : "Saving the records",
      done: uploadsDone,
      active: !uploadsDone,
    },
    {
      label: "Reading the records for gaps and conflicts",
      done: gap === "complete",
      active: uploadsDone && (gap === "pending" || gap === "running"),
    },
    {
      label: "Preparing the interview questions",
      done: gap === "complete",
      active: gap === "running",
    },
  ];

  return (
    <div className="flex h-full flex-col items-center justify-center p-10">
      <div className="w-full max-w-[520px] text-center">
        <div
          data-testid="intake-ring"
          className="mx-auto mb-7 flex h-[172px] w-[172px] items-center justify-center rounded-full"
          style={{
            background: failed
              ? "conic-gradient(#A24B2E 360deg, #E4DBCB 0deg)"
              : `conic-gradient(#2F6B5E ${pct * 3.6}deg, #E4DBCB 0deg)`,
          }}
        >
          <div className="flex h-[132px] w-[132px] flex-col items-center justify-center rounded-full bg-surface-base">
            {failed ? (
              <div className="font-serif text-[34px] font-medium leading-none text-status-conflicting">
                !
              </div>
            ) : (
              <div className="font-serif text-[40px] font-medium leading-none text-brand">
                {pct}
                <span className="text-[19px]">%</span>
              </div>
            )}
            <div className="mt-1.5 text-[11px] font-bold uppercase tracking-[.1em] text-ink-faint">
              {failed ? "Stopped" : "Extracting"}
            </div>
          </div>
        </div>

        <div className="text-[12px] font-bold uppercase tracking-[.12em] text-gold">
          Building the intake
        </div>
        <h2 className="mb-5 mt-2 font-serif text-[24px] font-medium text-ink-primary">
          {title}
        </h2>

        {failed ? (
          <div className="rounded-[15px] border border-status-conflicting/40 bg-status-conflicting/[0.06] px-5 py-5 text-left">
            <div className="text-[14.5px] font-semibold text-status-conflicting">
              Question prep stopped
            </div>
            <p className="mt-1.5 text-[13.5px] leading-relaxed text-ink-secondary">
              {gapError ?? "The analysis could not finish."} Your records are saved.
            </p>
            <div className="mt-4 flex gap-2.5">
              <button
                type="button"
                onClick={onRetry}
                className="min-h-[44px] rounded-[10px] bg-brand px-5 text-[14px] font-semibold text-ink-onBrand"
              >
                Try again
              </button>
              <button
                type="button"
                onClick={onBackToRecords}
                className="min-h-[44px] rounded-[10px] border border-surface-overlay bg-surface-sunken px-5 text-[14px] font-semibold text-ink-muted"
              >
                Back to the records
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="rounded-[15px] border border-surface-overlay bg-surface-base px-6 py-4 text-left">
              {steps.map((s) => (
                <div key={s.label} className="flex items-center gap-3.5 py-2">
                  <span
                    className="flex h-[22px] w-[22px] flex-none items-center justify-center rounded-full border-2 text-[11px]"
                    style={{
                      borderColor: s.done ? "#5f8a52" : s.active ? "#2F6B5E" : "#D8CFBE",
                      color: s.done ? "#5f8a52" : "#2F6B5E",
                    }}
                  >
                    {s.done ? (
                      "✓"
                    ) : s.active ? (
                      <span
                        className="h-[15px] w-[15px] rounded-full border-[2.5px] border-transparent border-t-brand"
                        style={{ animation: "spin .8s linear infinite" }}
                      />
                    ) : null}
                  </span>
                  <span
                    className={`flex-1 text-[14px] ${
                      s.done || s.active ? "text-ink-primary" : "text-ink-subtle"
                    }`}
                  >
                    {s.label}
                  </span>
                </div>
              ))}
            </div>
            <div className="mt-4 text-[13px] text-ink-dim">
              Safe to leave — the questions will be waiting on this case.
            </div>
          </>
        )}
      </div>
    </div>
  );
}
