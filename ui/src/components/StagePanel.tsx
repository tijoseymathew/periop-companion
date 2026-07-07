/**
 * The center-pane capture screen for a live case's stage before its
 * artifacts exist (spec v2 §6). Dispatches on the one primary action: every
 * screen opens with one plain sentence and exactly one dominant button, and
 * failures say what to do next.
 */
import { useEffect, useState } from "react";
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
import { STATUS_WORDS, type PrimaryAction } from "../lib/workflow";
import { IntakeForm } from "./IntakeForm";
import { LiveDictation } from "./LiveDictation";
import { OrientationView } from "./OrientationView";
import { QuestionReview } from "./QuestionReview";
import { Recorder } from "./Recorder";

const AUDIO_KIND: Record<StageKey, string> = {
  preop: "preop-interview",
  intraop: "intraop-notes",
  postop: "postop-interview",
};

const CAPTURE_SENTENCES: Record<StageKey, string> = {
  preop: "Questions approved. Record or upload the patient interview.",
  intraop: "Dictate voice notes through the case — as many as needed.",
  postop: "Record or upload the recovery-room interview with the patient.",
};

const GENERATE_SENTENCES: Record<StageKey, string> = {
  preop: "Interview recorded. Generate the pre-op note when ready.",
  intraop: "Memos recorded. Generate the intra-op record when the case is done.",
  postop: "Interview recorded. Generate the PACU handoff and post-op note.",
};

export function StagePanel({
  kase,
  me,
  stage,
  action,
  onCaseUpdated,
  onActivateRef,
}: {
  kase: Case;
  me: string | null;
  /** the stage the provider is looking at (the rail selection) */
  stage: StageKey;
  /** the case's one primary action, when it belongs to this stage */
  action: PrimaryAction | null;
  onCaseUpdated: (updated: Case) => void;
  onActivateRef: (ref: string) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<RunEvent[] | null>(null);
  // live dictation degraded (mic/socket/ASR) — fall back to the memo recorder
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

  async function captureAudio(file: File) {
    if (!me) return;
    const updated = await guard(() => uploadAudio(kase.case_id, AUDIO_KIND[stage], file, me));
    if (updated) onCaseUpdated(updated);
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
    } catch (e) {
      setError(`${(e as Error).message} — the case is unchanged; try again.`);
      // refresh so the stage status (restored server-side) is honest
      const fresh = await fetchCase(kase.case_id).catch(() => null);
      if (fresh) onCaseUpdated(fresh);
    } finally {
      setProgress(null);
    }
  }

  const memoRecorder = (
    <Recorder label="Record voice memo" filename="intraop-memo" onUpload={captureAudio} />
  );

  const body = (() => {
    if (progress !== null) {
      return <RunProgress stage={stage} events={progress} />;
    }
    switch (action?.kind) {
      case "add-records":
        return (
          <IntakeForm
            providerId={me}
            existingDocTypes={kase.sources
              .filter((s) => s.type === "document")
              .map((s) => s.source_id.replace(/^doc:/, ""))}
            onAddText={async (docType, text) => {
              if (!me) return;
              const updated = await guard(() =>
                addDocumentText(kase.case_id, docType, text, me),
              );
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
        );
      case "review-questions":
        // question prep runs in the background (v2-speed §3.2): until the
        // questions land, this screen watches the case instead of reviewing
        if (kase.open_questions.length === 0) {
          return <QuestionPrep kase={kase} onCaseUpdated={onCaseUpdated} />;
        }
        return (
          <QuestionReview
            questions={kase.open_questions}
            onActivateRef={onActivateRef}
            onApprove={async (reviewed: OpenQuestion[]) => {
              if (!me) return;
              const updated = await guard(() =>
                reviewQuestions(kase.case_id, reviewed, me),
              );
              if (updated) onCaseUpdated(updated);
            }}
          />
        );
      case "record-interview":
        return (
          <div className="mx-auto w-full max-w-2xl space-y-4 p-6">
            <p className="text-sm text-ink-secondary">{CAPTURE_SENTENCES[stage]}</p>
            <Recorder
              label={action.label}
              filename={AUDIO_KIND[stage]}
              onUpload={captureAudio}
            />
            {!me && (
              <p className="text-xs text-status-unsupported">
                Choose your name in the top-right picker first.
              </p>
            )}
          </div>
        );
      case "record-memo":
        // intra-op is dictation-first (v2 §2 stretch): live transcript while
        // speaking; any failure degrades to the memo recorder (v2 §10)
        return (
          <div className="mx-auto w-full max-w-2xl space-y-4 p-6">
            <OrientationView kase={kase} onActivateRef={onActivateRef} />
            <p className="text-sm text-ink-secondary">{CAPTURE_SENTENCES.intraop}</p>
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
                  <div className="mt-2">{memoRecorder}</div>
                </details>
              </>
            ) : (
              <>
                {dictationProblem && (
                  <p className="text-sm text-status-unsupported">{dictationProblem}</p>
                )}
                {memoRecorder}
              </>
            )}
            {!me && (
              <p className="text-xs text-status-unsupported">
                Choose your name in the top-right picker first.
              </p>
            )}
          </div>
        );
      case "generate":
        return (
          <div className="mx-auto w-full max-w-2xl space-y-4 p-6">
            {stage === "intraop" && (
              <OrientationView kase={kase} onActivateRef={onActivateRef} />
            )}
            <p className="text-sm text-ink-secondary">{GENERATE_SENTENCES[stage]}</p>
            <button
              type="button"
              disabled={!me}
              data-primary-action
              onClick={() => void generate()}
              className="min-h-[56px] w-full rounded bg-brand px-5 py-3 text-base font-semibold text-white disabled:opacity-40"
            >
              {action.label}
            </button>
            <p className="text-xs text-ink-subtle">
              Generation takes a few minutes. You can leave this case and come
              back — the worklist shows when it is ready to review.
            </p>
            {stage === "intraop" && (
              <details className="text-sm text-ink-secondary">
                <summary className="cursor-pointer">Record another memo</summary>
                <div className="mt-2">{memoRecorder}</div>
              </details>
            )}
          </div>
        );
      case "generating":
        return (
          <div className="flex flex-1 items-center justify-center p-8">
            <p className="text-sm text-ink-secondary">
              Generating — progress appears here; it is safe to leave and return.
            </p>
          </div>
        );
      default:
        return (
          <div className="flex flex-1 items-center justify-center p-8">
            <p className="text-sm text-ink-secondary">
              This stage is{" "}
              {kase.workflow ? STATUS_WORDS[kase.workflow.stages[stage].status] : "read-only"}.
            </p>
          </div>
        );
    }
  })();

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      {error && (
        <p className="mx-6 mt-4 rounded border border-status-conflicting/50 p-3 text-sm text-status-conflicting">
          {error}
        </p>
      )}
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
      <div className="mx-auto w-full max-w-2xl space-y-4 p-6">
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
          className="min-h-[44px] rounded bg-brand px-5 py-2 text-sm font-semibold text-white disabled:opacity-40"
        >
          {retrying ? "Starting…" : "Try again"}
        </button>
        {error && <p className="text-sm text-status-unsupported">{error}</p>}
      </div>
    );
  }
  return (
    <div className="mx-auto w-full max-w-2xl p-6">
      <p className="text-sm text-ink-secondary" role="status">
        Preparing interview questions… They appear here when ready — this can
        take a few minutes on local hardware, and it is safe to leave and come
        back.
      </p>
    </div>
  );
}

/** SSE progress rendering (ui.md §7): per-agent progress, not a spinner. */
function RunProgress({ stage, events }: { stage: StageKey; events: RunEvent[] }) {
  return (
    <div className="mx-auto w-full max-w-2xl p-6" data-testid="run-progress">
      <p className="text-sm text-ink-secondary">
        Generating the {stage === "preop" ? "pre-op note" : stage === "intraop" ? "intra-op record" : "handoff and post-op note"}
        … this takes a few minutes.
      </p>
      <ul className="mt-3 space-y-1.5 font-mono text-xs text-ink-secondary">
        {events.map((event, i) => (
          <li key={i}>
            {event.event === "agent_start" && `▸ ${event.data.agent} working…`}
            {event.event === "agent_end" &&
              `✓ ${event.data.agent} — ${event.data.summary ?? "done"}`}
            {event.event === "artifact_complete" &&
              `✓ ${event.data.artifact_id} (${event.data.claims} claims)`}
            {event.event === "status" && String(event.data.message ?? "")}
            {event.event === "stage_start" && `stage: ${event.data.stage}`}
            {event.event === "complete" && "complete — loading the review…"}
          </li>
        ))}
      </ul>
    </div>
  );
}
