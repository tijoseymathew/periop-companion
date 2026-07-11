/**
 * Pre-op · Interview (PeriOp Workflow.dc.html "isInterview"). Left: the
 * clarifying questions raised from the records — reviewed here (keep /
 * dismiss / approve, the pre-op question gate, v2 §4.1), then kept on screen
 * as the list to ask. Right: the interview recording with its transcript,
 * which lands moments after upload. One primary action: generate the brief.
 */
import { useState } from "react";
import { categorizeReason } from "../../lib/catchup";
import { audioSource, transcriptionBusy } from "../../lib/flow";
import type { Case, OpenQuestion } from "../../lib/schema";
import { RecordingPanel } from "./RecordingPanel";
import { StageContainer } from "./StageContainer";

export function InterviewScreen({
  kase,
  busy,
  notice,
  canWrite,
  onApproveQuestions,
  onUploadAudio,
  onGenerate,
}: {
  kase: Case;
  busy: boolean;
  notice: string | null;
  canWrite: boolean;
  onApproveQuestions: (questions: OpenQuestion[]) => void;
  onUploadAudio: (file: File) => void;
  onGenerate: () => void;
}) {
  const preop = kase.workflow?.stages.preop ?? null;
  const approved = !!preop?.questions_approved_at;
  const questions = kase.open_questions;
  const source = audioSource(kase, "preop");
  const inputsRecorded = !!preop?.inputs_recorded_at;
  const transcribing = transcriptionBusy(kase, "preop");
  const canGenerate = canWrite && approved && inputsRecorded && !transcribing && !busy;

  const askList = approved
    ? questions.filter((q) => q.review !== "dismissed")
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
              ? "Ask these during the interview, then add the audio and generate the brief."
              : "These came from gaps and conflicts in the records. Keep the ones worth asking, dismiss the rest."}
          </p>
        </div>
        {/* while questions are still under review, "Approve & continue"
            below is the one recommended action — a second green button up
            here (even disabled) reads as a competing call to action */}
        {approved && (
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
            <QuestionReview questions={questions} busy={busy} onApprove={onApproveQuestions} />
          )}
        </div>

        <RecordingPanel
          title="Interview recording"
          kase={kase}
          stage="preop"
          source={source}
          busy={busy}
          canWrite={canWrite}
          onUploadAudio={onUploadAudio}
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
        {q.reason && <span className="truncate text-[12px] text-ink-faint">↳ {q.reason}</span>}
      </div>
      <div className="text-[15.5px] leading-normal text-ink-primary">
        {q.edited_text ?? q.question}
      </div>
    </div>
  );
}

/**
 * Keep/dismiss each question, submit the reviewed list once (the whole list
 * is the record of the review — dismissals are kept, never deleted).
 * Approving an empty list is valid: it records that nothing needed asking.
 */
function QuestionReview({
  questions,
  busy,
  onApprove,
}: {
  questions: OpenQuestion[];
  busy: boolean;
  onApprove: (questions: OpenQuestion[]) => void;
}) {
  const [decisions, setDecisions] = useState<Record<number, "approved" | "dismissed">>({});
  const decisionFor = (i: number) => decisions[i] ?? "approved";

  return (
    <div>
      {questions.map((q, i) => {
        const meta = categorizeReason(q.reason);
        const decision = decisionFor(i);
        return (
          <div key={i} className={`mb-2.5 rounded-[13px] border ${meta.borderClass} ${meta.bgClass} p-4`}>
            <span
              className={`inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[.09em] ${meta.textClass}`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${meta.dotClass}`} />
              {meta.label}
            </span>
            <div className="mt-2 text-[15.5px] font-semibold leading-snug text-ink-primary">
              {q.edited_text ?? q.question}
            </div>
            {q.reason && (
              <div className="mt-1 text-[13px] leading-relaxed text-ink-secondary">{q.reason}</div>
            )}
            <div className="mt-3 inline-flex rounded-[10px] border border-surface-overlay bg-surface-panel p-[3px]">
              {(["approved", "dismissed"] as const).map((opt) => {
                const on = decision === opt;
                return (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => setDecisions((d) => ({ ...d, [i]: opt }))}
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
            </div>
          </div>
        );
      })}
      {questions.length === 0 && (
        <p className="mb-2.5 rounded-[12px] border border-dashed border-[#cdbfa4] px-4 py-3.5 text-[13.5px] text-ink-dim">
          The records didn't raise anything to clarify — approve to continue.
        </p>
      )}
      <button
        type="button"
        disabled={busy}
        onClick={() => onApprove(questions.map((q, i) => ({ ...q, review: decisionFor(i) })))}
        className="mt-1 flex min-h-[48px] items-center rounded-[11px] bg-brand px-5 text-[15px] font-semibold text-ink-onBrand shadow-[0_1px_0_rgba(255,255,255,.16)_inset] disabled:opacity-50"
      >
        Approve questions &amp; continue &nbsp;→
      </button>
    </div>
  );
}
