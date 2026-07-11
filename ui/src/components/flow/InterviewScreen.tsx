/**
 * Pre-op · Interview (PeriOp Workflow.dc.html "isInterview"). Left: the
 * clarifying questions raised from the records — kept, dismissed, or added
 * to here (the pre-op question gate, v2 §4.1), then kept on screen as the
 * list to ask. There is no approve button: uploading the interview
 * recording submits the reviewed list as it stands and passes the gate in
 * the same breath. Right: the interview recording with its transcript,
 * which lands moments after upload — and the brief starts generating on its
 * own the moment it does (App's auto-generate). A manual generate appears
 * only on the recovery paths: a failed transcription (the run transcribes at
 * generate time) or a failed run.
 */
import { useState } from "react";
import { categorizeReason } from "../../lib/catchup";
import { audioSource, transcriptionBusy, transcriptionState } from "../../lib/flow";
import type { Case, OpenQuestion } from "../../lib/schema";
import type { RunEvent } from "../../lib/sse";
import { LiveResults } from "./LiveResults";
import { RecordingPanel } from "./RecordingPanel";
import { StageContainer } from "./StageContainer";

export function InterviewScreen({
  kase,
  busy,
  notice,
  canWrite,
  genFailed = false,
  onUploadAudio,
  onGenerate,
  liveEvents = [],
}: {
  kase: Case;
  busy: boolean;
  notice: string | null;
  canWrite: boolean;
  /** the last stage run failed — offer the manual generate again */
  genFailed?: boolean;
  /** `reviewed` is the question list to approve alongside the upload —
   * null once the gate has already been passed */
  onUploadAudio: (file: File, reviewed: OpenQuestion[] | null) => void;
  onGenerate: () => void;
  /** this session's own stage-run SSE events, while one is in flight */
  liveEvents?: RunEvent[];
}) {
  const preop = kase.workflow?.stages.preop ?? null;
  const approved = !!preop?.questions_approved_at;
  const source = audioSource(kase, "preop");
  const inputsRecorded = !!preop?.inputs_recorded_at;
  const transcribing = transcriptionBusy(kase, "preop");
  // the brief generates itself once the transcript lands; the button exists
  // only for the paths auto-generate never fires on: a failed run, a failed
  // transcription, or a legacy case with no transcription state at all
  const jobState = transcriptionState(kase, "preop");
  const needsManualGenerate =
    approved &&
    inputsRecorded &&
    !transcribing &&
    (genFailed || jobState === "failed" || jobState === null);
  const canGenerate = canWrite && needsManualGenerate && !busy;

  // the review state lives here so the recording panel can submit it:
  // keep/dismiss decisions plus any questions the provider added
  const [decisions, setDecisions] = useState<Record<number, "approved" | "dismissed">>({});
  const [added, setAdded] = useState<OpenQuestion[]>([]);
  const questions = [...kase.open_questions, ...added];
  const decisionFor = (i: number) => decisions[i] ?? "approved";
  const reviewed = approved
    ? null
    : questions.map((q, i) => ({ ...q, review: decisionFor(i) }));

  const askList = approved
    ? kase.open_questions.filter((q) => q.review !== "dismissed")
    : questions;

  return (
    <StageContainer>
      <div className="mb-6 flex items-start justify-between gap-6">
        <div>
          <div className="text-[12px] font-bold uppercase tracking-[.13em] text-gold">
            Pre-op · Interview
          </div>
          <h1 className="mt-2 font-serif text-[29px] font-medium text-ink-primary">
            Questions to ask, then the recording
          </h1>
          <p className="mt-2 max-w-[600px] text-[14.5px] leading-relaxed text-ink-secondary">
            {approved
              ? "Ask these during the interview, then add the audio — the brief starts generating the moment it's transcribed."
              : "These came from gaps and conflicts in the records. Keep the ones worth asking, dismiss the rest, add your own — then upload the recording when you're ready."}
          </p>
        </div>
        {/* no standing "Generate" button — the brief generates itself once
            the transcript lands; this appears only on the recovery paths */}
        {needsManualGenerate && (
          <button
            type="button"
            disabled={!canGenerate}
            onClick={onGenerate}
            className="flex min-h-[50px] flex-none items-center rounded-[11px] bg-brand px-6 text-[15px] font-semibold text-ink-onBrand shadow-[0_1px_0_rgba(255,255,255,.16)_inset] disabled:opacity-40"
          >
            Generate pre-op brief &nbsp;→
          </button>
        )}
      </div>

      {notice && (
        <div className="mb-6 rounded-[12px] border border-status-unsupported/40 bg-status-unsupported/[0.08] px-4 py-3 text-[13.5px] text-status-unsupported">
          {notice}
        </div>
      )}

      <div className="flex items-start gap-7">
        <div className="min-w-0 flex-1">
          <div className="mb-3 text-[12px] font-bold uppercase tracking-[.12em] text-gold">
            {approved ? "Ask during the interview" : "Review the questions"}
          </div>

          {approved ? (
            <>
              {askList.map((q, i) => (
                <QuestionCard key={i} q={q} />
              ))}
              {askList.length === 0 && (
                <p className="rounded-[12px] border border-dashed border-[#cdbfa4] px-4 py-3.5 text-[13.5px] text-ink-dim">
                  Nothing needed clarifying — record the interview when you're ready.
                </p>
              )}
            </>
          ) : (
            <QuestionReview
              questions={kase.open_questions}
              added={added}
              decisionFor={decisionFor}
              onDecide={(i, d) => setDecisions((prev) => ({ ...prev, [i]: d }))}
              onAdd={(text) =>
                setAdded((prev) => [
                  ...prev,
                  { question: text, reason: null, provenance: [], review: null, edited_text: null },
                ])
              }
              onRemoveAdded={(j) => {
                setAdded((prev) => prev.filter((_, k) => k !== j));
                setDecisions((prev) => {
                  const keep: Record<number, "approved" | "dismissed"> = {};
                  const gone = kase.open_questions.length + j;
                  for (const [k, v] of Object.entries(prev)) {
                    const idx = Number(k);
                    if (idx === gone) continue;
                    keep[idx > gone ? idx - 1 : idx] = v;
                  }
                  return keep;
                });
              }}
            />
          )}
          <LiveResults events={liveEvents} />
        </div>

        <RecordingPanel
          title="Interview recording"
          kase={kase}
          stage="preop"
          source={source}
          busy={busy}
          canWrite={canWrite}
          onUploadAudio={(file) => onUploadAudio(file, reviewed)}
        />
      </div>
    </StageContainer>
  );
}

function QuestionCard({ q }: { q: OpenQuestion }) {
  const meta = categorizeReason(q.reason);
  return (
    <div
      className={`mb-2.5 rounded-[12px] border border-surface-overlay bg-surface-base p-4 ${meta.borderClass}`}
      style={{ borderLeftWidth: 3 }}
    >
      <div className="mb-2 flex items-center gap-2.5">
        <span
          className={`inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[11px] font-bold uppercase tracking-[.08em] ${meta.textClass} ${meta.bgClass}`}
        >
          {meta.label}
        </span>
      </div>
      <div className="text-[15.5px] leading-normal text-ink-primary">
        {q.edited_text ?? q.question}
      </div>
    </div>
  );
}

/**
 * Keep/dismiss each question and add your own; the reviewed list travels
 * with the recording upload (the whole list is the record of the review —
 * dismissals are kept, never deleted). An empty list is valid: uploading
 * records that nothing needed asking.
 */
function QuestionReview({
  questions,
  added,
  decisionFor,
  onDecide,
  onAdd,
  onRemoveAdded,
}: {
  questions: OpenQuestion[];
  added: OpenQuestion[];
  decisionFor: (i: number) => "approved" | "dismissed";
  onDecide: (i: number, d: "approved" | "dismissed") => void;
  onAdd: (text: string) => void;
  onRemoveAdded: (j: number) => void;
}) {
  const [draft, setDraft] = useState("");
  const all = [...questions, ...added];

  function submitDraft() {
    const text = draft.trim();
    if (!text) return;
    onAdd(text);
    setDraft("");
  }

  return (
    <div>
      {all.map((q, i) => {
        const isAdded = i >= questions.length;
        const meta = categorizeReason(q.reason);
        const decision = decisionFor(i);
        return (
          <div key={i} className={`mb-2.5 rounded-[13px] border ${meta.borderClass} ${meta.bgClass} p-4`}>
            <div className="flex items-center justify-between gap-3">
              <span
                className={`inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[.09em] ${meta.textClass}`}
              >
                <span className={`h-1.5 w-1.5 rounded-full ${meta.dotClass}`} />
                {isAdded ? "Added by you" : meta.label}
              </span>
              <span className="flex flex-none items-center gap-2">
                <span className="inline-flex rounded-[10px] border border-surface-overlay bg-surface-panel p-[3px]">
                  {(["approved", "dismissed"] as const).map((opt) => {
                    const on = decision === opt;
                    return (
                      <button
                        key={opt}
                        type="button"
                        onClick={() => onDecide(i, opt)}
                        className={`rounded-md px-3.5 py-1.5 text-[12.5px] font-semibold ${
                          on
                            ? "bg-surface-base text-ink-primary shadow-[0_1px_2px_rgba(35,27,15,.08)]"
                            : "text-ink-dim"
                        }`}
                      >
                        {opt === "approved" ? "Keep" : "Dismiss"}
                      </button>
                    );
                  })}
                </span>
                {isAdded && (
                  <button
                    type="button"
                    aria-label={`Remove ${q.question}`}
                    onClick={() => onRemoveAdded(i - questions.length)}
                    className="flex h-[30px] w-[30px] flex-none items-center justify-center rounded-lg border border-surface-overlay bg-surface-base text-[13px] text-ink-faint"
                  >
                    ✕
                  </button>
                )}
              </span>
            </div>
            <div className="mt-2 text-[15.5px] font-semibold leading-snug text-ink-primary">
              {q.edited_text ?? q.question}
            </div>
          </div>
        );
      })}
      {all.length === 0 && (
        <p className="mb-2.5 rounded-[12px] border border-dashed border-[#cdbfa4] px-4 py-3.5 text-[13.5px] text-ink-dim">
          The records didn't raise anything to clarify — record the interview when you're ready.
        </p>
      )}
      <div className="mt-1 flex gap-2.5">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submitDraft();
          }}
          placeholder="Add your own question…"
          className="min-w-0 flex-1 rounded-[10px] border border-surface-overlay bg-surface-sunken px-3.5 py-2.5 text-[14px] text-ink-primary outline-none placeholder:text-ink-ghost"
        />
        <button
          type="button"
          disabled={!draft.trim()}
          onClick={submitDraft}
          className="flex min-h-[44px] flex-none items-center rounded-[10px] border border-surface-overlay bg-surface-base px-4 text-[13.5px] font-semibold text-ink-muted disabled:opacity-40"
        >
          + Add question
        </button>
      </div>
    </div>
  );
}
