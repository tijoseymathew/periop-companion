/**
 * The capture / generate / orientation sub-screens for an open case (brief §4).
 * Screen-driven: the stepper decides which sub-screen is shown; this component
 * renders it with the same one-plain-sentence + one-primary-action treatment,
 * and failures say what to do next. The Review / Sign-off / Handoff screens are
 * rendered by App, not here.
 */
import { useEffect, useState, type ReactNode } from "react";
import {
  addDocumentText,
  analyzeQuestions,
  fetchCase,
  reviewQuestions,
  uploadAudio,
  uploadDocumentFile,
} from "../lib/api";
import type { Case, OpenQuestion, StageKey } from "../lib/schema";
import { streamStageRun, type RunEvent } from "../lib/sse";
import { GENERATE_LABELS, type SubScreen } from "../lib/workflow";
import { IntakeForm } from "./IntakeForm";
import { LiveDictation } from "./LiveDictation";
import { OrientationView } from "./OrientationView";
import { QuestionReview } from "./QuestionReview";
import { Recorder } from "./Recorder";
import { RunProgress } from "./RunProgress";

const AUDIO_KIND: Record<StageKey, string> = {
  preop: "preop-interview",
  intraop: "intraop-notes",
  postop: "postop-interview",
};

const STAGE_WORD: Record<StageKey, string> = {
  preop: "PRE-OP",
  intraop: "INTRA-OP",
  postop: "POST-OP",
};

function ScreenHeader({
  kase,
  stage,
  title,
  sentence,
  action,
}: {
  kase: Case;
  stage: StageKey;
  title: string;
  sentence: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-none items-start justify-between gap-6 border-b border-surface-overlay px-8 py-5">
      <div>
        <div className="mb-1.5 font-mono text-[11px] tracking-wide text-ink-subtle">
          {kase.case_id} · {(kase.label ?? "").toUpperCase()} · {STAGE_WORD[stage]}
        </div>
        <h1 className="text-[23px] font-semibold tracking-tight">{title}</h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-secondary">{sentence}</p>
      </div>
      {action}
    </div>
  );
}

export function StagePanel({
  kase,
  me,
  stage,
  screen,
  onCaseUpdated,
  onActivateRef,
  onNavigate,
  onWorklist,
}: {
  kase: Case;
  me: string | null;
  stage: StageKey;
  /** the sub-screen the stepper selected */
  screen: SubScreen;
  onCaseUpdated: (updated: Case) => void;
  onActivateRef: (ref: string) => void;
  onNavigate: (screen: SubScreen) => void;
  onWorklist: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<RunEvent[] | null>(null);
  const [dictationProblem, setDictationProblem] = useState<string | null>(null);

  async function guard<T>(work: () => Promise<T>): Promise<T | undefined> {
    setError(null);
    try {
      return await work();
    } catch (e) {
      const detail =
        (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ??
        (e as Error).message;
      setError(`${detail} — nothing was lost; fix the issue and try again.`);
      return undefined;
    }
  }

  async function captureAudio(file: File, advance = false) {
    if (!me) return;
    const updated = await guard(() => uploadAudio(kase.case_id, AUDIO_KIND[stage], file, me));
    if (updated) {
      onCaseUpdated(updated);
      if (advance) onNavigate("generate");
    }
  }

  async function generate() {
    if (!me) return;
    setError(null);
    setProgress([]);
    try {
      await streamStageRun(kase.case_id, stage, me, (event) =>
        setProgress((events) => [...(events ?? []), event]),
      );
      onCaseUpdated(await fetchCase(kase.case_id));
      onNavigate("review");
    } catch (e) {
      setError(`${(e as Error).message} — the case is unchanged; try again.`);
      const fresh = await fetchCase(kase.case_id).catch(() => null);
      if (fresh) onCaseUpdated(fresh);
    } finally {
      setProgress(null);
    }
  }

  const errorBanner = error && (
    <p className="mx-8 mt-4 rounded-lg border border-status-conflicting/50 bg-status-conflicting/10 p-3 text-sm text-status-conflicting">
      {error}
    </p>
  );

  const needsProvider = !me && (
    <p className="px-8 text-xs text-status-unsupported">
      Choose your name in the top-right picker first.
    </p>
  );

  if (progress !== null) {
    return (
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <ScreenHeader
          kase={kase}
          stage={stage}
          title={`Generating the ${GENERATE_LABELS[stage].replace(/^Generate /, "")}`}
          sentence="This can take a few minutes. It's safe to leave this page — we'll keep everything and notify you when it's ready."
        />
        <RunProgress stage={stage} events={progress} onWorklist={onWorklist} />
      </div>
    );
  }

  const body = (() => {
    switch (screen) {
      case "orientation":
        return (
          <>
            <ScreenHeader
              kase={kase}
              stage={stage}
              title="Before you touch this patient"
              sentence="Everything unresolved is pinned to the top. Read that first — then the key facts below."
              action={
                <button
                  type="button"
                  onClick={() => onNavigate("review")}
                  className="min-h-[44px] flex-none rounded-lg border border-surface-line px-4 py-2.5 text-sm font-medium text-ink-primary hover:border-brand hover:text-brand"
                >
                  Open full record →
                </button>
              }
            />
            <div className="min-h-0 flex-1 overflow-y-auto px-8 py-6">
              <OrientationView kase={kase} onActivateRef={onActivateRef} />
            </div>
          </>
        );

      case "intake":
        return (
          <>
            <ScreenHeader
              kase={kase}
              stage={stage}
              title="Records intake"
              sentence="Add the patient's prior records below. When you're ready, generate the clarifying questions."
              action={
                <button
                  type="button"
                  onClick={() => onNavigate("questions")}
                  className="min-h-[44px] flex-none rounded-lg border border-surface-line px-4 py-2.5 text-sm font-medium text-ink-primary hover:border-brand hover:text-brand"
                >
                  Find gaps in the record →
                </button>
              }
            />
            <div className="min-h-0 flex-1 overflow-y-auto px-8 py-6">
              <IntakeForm
                providerId={me}
                existingDocTypes={kase.sources
                  .filter((s) => s.type === "document")
                  .map((s) => s.source_id.replace(/^doc:/, ""))}
                onAddText={async (docType, text) => {
                  if (!me) return;
                  const updated = await guard(() => addDocumentText(kase.case_id, docType, text, me));
                  if (updated) onCaseUpdated(updated);
                }}
                onUploadFile={async (docType, file) => {
                  if (!me) return;
                  const updated = await guard(() =>
                    uploadDocumentFile(kase.case_id, docType, file, me),
                  );
                  if (updated) onCaseUpdated(updated);
                }}
              />
            </div>
          </>
        );

      case "questions": {
        // Gap analysis runs in the background (v2-speed §3.2): until the
        // questions land, watch the case instead of reviewing.
        const waiting = kase.open_questions.length === 0;
        return (
          <>
            <ScreenHeader
              kase={kase}
              stage={stage}
              title="Clarifying questions"
              sentence={
                waiting
                  ? "We're finding gaps in the record. The questions appear here when they're ready — it's safe to leave and come back."
                  : "We found gaps in the record. Review them before you interview the patient — dismiss, edit, or add your own, then approve."
              }
            />
            <div className="min-h-0 flex-1 overflow-y-auto px-8 py-6">
              {waiting ? (
                <QuestionPrep kase={kase} onCaseUpdated={onCaseUpdated} />
              ) : (
                <QuestionReview
                  questions={kase.open_questions}
                  onActivateRef={onActivateRef}
                  onApprove={async (reviewed: OpenQuestion[]) => {
                    if (!me) return;
                    const updated = await guard(() => reviewQuestions(kase.case_id, reviewed, me));
                    if (updated) {
                      onCaseUpdated(updated);
                      onNavigate("record");
                    }
                  }}
                />
              )}
            </div>
          </>
        );
      }

      case "record":
        return (
          <>
            <ScreenHeader
              kase={kase}
              stage={stage}
              title={stage === "postop" ? "Post-op interview" : "Pre-op interview"}
              sentence="Recording your conversation with the patient. Tap Stop when you're finished."
            />
            <div className="flex min-h-0 flex-1 flex-col items-center overflow-y-auto px-8 py-6">
              <Recorder
                variant="primary"
                label={stage === "postop" ? "Record post-op interview" : "Record interview"}
                filename={AUDIO_KIND[stage]}
                onUpload={(file) => captureAudio(file, true)}
              />
              {needsProvider}
            </div>
          </>
        );

      case "intraop":
        return (
          <>
            <ScreenHeader
              kase={kase}
              stage="intraop"
              title="Intra-op — voice memos"
              sentence="Hold the button and speak a quick note. Each memo stacks into one running timeline."
              action={
                <button
                  type="button"
                  onClick={() => onNavigate("generate")}
                  className="min-h-[44px] flex-none rounded-lg border border-surface-line px-4 py-2.5 text-sm font-medium text-ink-primary hover:border-brand hover:text-brand"
                >
                  Done — generate record →
                </button>
              }
            />
            <div className="min-h-0 flex-1 overflow-y-auto px-8 py-6">
              <div className="mx-auto w-full max-w-3xl space-y-4">
                {me && !dictationProblem ? (
                  <>
                    <LiveDictation
                      caseId={kase.case_id}
                      providerId={me}
                      onSaved={() => {
                        void fetchCase(kase.case_id).then(onCaseUpdated).catch(() => {});
                      }}
                      onUnavailable={setDictationProblem}
                    />
                    <details className="text-sm text-ink-secondary">
                      <summary className="cursor-pointer">Prefer a memo or an upload?</summary>
                      <div className="mt-2">
                        <Recorder
                          label="Record voice memo"
                          filename="intraop-memo"
                          onUpload={(f) => captureAudio(f)}
                        />
                      </div>
                    </details>
                  </>
                ) : (
                  <>
                    {dictationProblem && (
                      <p className="text-sm text-status-unsupported">{dictationProblem}</p>
                    )}
                    <Recorder
                      label="Record voice memo"
                      filename="intraop-memo"
                      onUpload={(f) => captureAudio(f)}
                    />
                  </>
                )}
                {needsProvider}
              </div>
            </div>
          </>
        );

      case "generate": {
        const generated = kase.artifacts.some(
          (a) =>
            a.artifact_id ===
            ({ preop: "note:pre-anesthesia-eval", intraop: "record:intra-op", postop: "note:pacu-handoff" } as const)[
              stage
            ],
        );
        return (
          <>
            <ScreenHeader
              kase={kase}
              stage={stage}
              title={GENERATE_LABELS[stage].replace(/^Generate /, "Generate the ")}
              sentence="After inputs exist, generate the note. It takes a few minutes — it's safe to leave and come back."
            />
            <div className="min-h-0 flex-1 overflow-y-auto px-8 py-6">
              <div className="mx-auto w-full max-w-2xl space-y-4">
                {generated ? (
                  <div className="rounded-xl border border-brand/20 bg-brand/[0.07] p-4 text-sm text-brand-soft">
                    This note is already generated.{" "}
                    <button type="button" onClick={() => onNavigate("review")} className="underline">
                      Open the review →
                    </button>
                  </div>
                ) : (
                  <>
                    <button
                      type="button"
                      disabled={!me}
                      data-primary-action
                      onClick={() => void generate()}
                      className="min-h-[56px] w-full rounded-lg bg-brand px-5 py-3 text-base font-semibold text-ink-onBrand hover:bg-brand-soft disabled:opacity-40"
                    >
                      {GENERATE_LABELS[stage]}
                    </button>
                    <p className="text-xs text-ink-subtle">
                      Generation takes a few minutes. You can leave this case and come back — the
                      worklist shows when it is ready to review.
                    </p>
                    {needsProvider}
                  </>
                )}
              </div>
            </div>
          </>
        );
      }

      default:
        return (
          <div className="flex flex-1 items-center justify-center p-8">
            <p className="text-sm text-ink-secondary">Nothing to show for this step yet.</p>
          </div>
        );
    }
  })();

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {errorBanner}
      {body}
    </div>
  );
}

/**
 * Question prep runs as a background generation (v2-speed §3.2): poll the
 * case until the questions arrive, and offer an explicit retry when it
 * failed — the documents are durable either way.
 */
function QuestionPrep({
  kase,
  onCaseUpdated,
}: {
  kase: Case;
  onCaseUpdated: (updated: Case) => void;
}) {
  const preop = kase.workflow?.stages.preop;
  const failed = preop?.gap_analysis === "failed";
  const [error, setError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);

  useEffect(() => {
    if (failed) return;
    const timer = setInterval(() => {
      void fetchCase(kase.case_id).then(onCaseUpdated).catch(() => {});
    }, 1500);
    return () => clearInterval(timer);
  }, [kase.case_id, failed, onCaseUpdated]);

  if (failed) {
    return (
      <div className="mx-auto w-full max-w-2xl space-y-4">
        <p className="text-sm text-status-unsupported">
          Preparing the interview questions failed
          {preop?.gap_analysis_error ? ` — ${preop.gap_analysis_error}` : ""}. The
          documents are saved; nothing was lost.
        </p>
        <button
          type="button"
          disabled={retrying}
          data-primary-action
          onClick={async () => {
            setError(null);
            setRetrying(true);
            try {
              onCaseUpdated(await analyzeQuestions(kase.case_id));
            } catch (e) {
              const detail =
                (e as { response?: { data?: { detail?: string } } })?.response?.data
                  ?.detail ?? (e as Error).message;
              setError(detail);
            } finally {
              setRetrying(false);
            }
          }}
          className="min-h-[44px] rounded-lg bg-brand px-5 py-2 text-sm font-semibold text-ink-onBrand hover:bg-brand-soft disabled:opacity-40"
        >
          {retrying ? "Starting…" : "Try again"}
        </button>
        {error && <p className="text-sm text-status-unsupported">{error}</p>}
      </div>
    );
  }
  return (
    <div className="mx-auto w-full max-w-2xl">
      <p className="text-sm text-ink-secondary" role="status">
        Preparing interview questions… They appear here when ready — this can
        take a few minutes on local hardware, and it is safe to leave and come
        back.
      </p>
    </div>
  );
}
