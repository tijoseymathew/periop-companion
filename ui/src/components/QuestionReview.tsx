/**
 * Question review (spec v2 §4.1 steps 3-4): the GapAnalyst's prioritized
 * questions with their why (missing / stale / conflicting) and the triggering
 * chunk, clickable exactly like any provenance chip. The provider dismisses,
 * rewords, or adds questions, then approves the list. Dismissals are kept —
 * a dismissed question that later proves relevant is itself a finding.
 */
import { useState } from "react";
import type { OpenQuestion } from "../lib/schema";

interface Draft {
  question: string;
  reason: string | null;
  provenance: string[];
  dismissed: boolean;
  editedText: string | null; // non-null once reworded
  editing: boolean;
}

const REASON_TEXT: Record<string, string> = {
  missing: "text-status-unsupported",
  stale: "text-status-inference",
  conflicting: "text-status-conflicting",
};

export function QuestionReview({
  questions,
  onApprove,
  onActivateRef,
}: {
  questions: OpenQuestion[];
  onApprove: (reviewed: OpenQuestion[]) => Promise<void>;
  onActivateRef: (ref: string) => void;
}) {
  const [drafts, setDrafts] = useState<Draft[]>(() =>
    questions.map((q) => ({
      question: q.question,
      reason: q.reason,
      provenance: q.provenance,
      dismissed: q.review === "dismissed",
      editedText: q.review === "edited" ? q.edited_text : null,
      editing: false,
    })),
  );
  const [newQuestion, setNewQuestion] = useState("");
  const [busy, setBusy] = useState(false);

  function update(i: number, patch: Partial<Draft>) {
    setDrafts((ds) => ds.map((d, j) => (j === i ? { ...d, ...patch } : d)));
  }

  async function approve() {
    setBusy(true);
    try {
      await onApprove(
        drafts.map((d) => ({
          question: d.question,
          reason: d.reason,
          provenance: d.provenance,
          review: d.dismissed
            ? "dismissed"
            : d.editedText && d.editedText !== d.question
              ? "edited"
              : "approved",
          edited_text:
            !d.dismissed && d.editedText && d.editedText !== d.question
              ? d.editedText
              : null,
        })),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-2xl p-6">
      <p className="text-sm text-ink-secondary">
        These are the questions to clarify at the interview. Dismiss or reword
        any of them, then approve the list.
      </p>
      <ul className="mt-4 space-y-2">
        {drafts.map((d, i) => (
          <li
            key={i}
            className={`rounded border border-surface-overlay bg-surface-raised p-3 ${
              d.dismissed ? "opacity-50" : ""
            }`}
          >
            {d.editing ? (
              <div>
                <textarea
                  value={d.editedText ?? d.question}
                  onChange={(e) => update(i, { editedText: e.target.value })}
                  rows={2}
                  className="w-full rounded border border-surface-overlay bg-surface-sunken px-2 py-1.5 text-sm text-ink-primary"
                />
                <button
                  type="button"
                  onClick={() => update(i, { editing: false })}
                  className="mt-1 rounded border border-surface-overlay px-3 py-1.5 text-xs"
                >
                  Done
                </button>
              </div>
            ) : (
              <p className={`text-sm ${d.dismissed ? "line-through" : ""}`}>
                {d.editedText ?? d.question}
              </p>
            )}
            <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs">
              {d.reason && (
                <span className={REASON_TEXT[d.reason] ?? "text-ink-subtle"}>{d.reason}</span>
              )}
              {d.provenance.map((ref) => (
                <button
                  key={ref}
                  type="button"
                  onClick={() => onActivateRef(ref)}
                  className="rounded border border-surface-overlay px-1.5 py-0.5 font-mono text-xs text-ink-secondary hover:border-brand hover:text-brand"
                >
                  {ref}
                </button>
              ))}
              <span className="ml-auto flex gap-1">
                {!d.dismissed && !d.editing && (
                  <button
                    type="button"
                    onClick={() => update(i, { editing: true, editedText: d.editedText ?? d.question })}
                    className="rounded border border-surface-overlay px-2.5 py-1.5 text-xs text-ink-secondary"
                  >
                    Reword
                  </button>
                )}
                {d.dismissed ? (
                  <button
                    type="button"
                    onClick={() => update(i, { dismissed: false })}
                    className="rounded border border-surface-overlay px-2.5 py-1.5 text-xs text-ink-secondary"
                  >
                    Restore
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => update(i, { dismissed: true, editing: false })}
                    className="rounded border border-surface-overlay px-2.5 py-1.5 text-xs text-ink-secondary"
                  >
                    Dismiss
                  </button>
                )}
              </span>
            </div>
          </li>
        ))}
      </ul>

      <div className="mt-3 flex items-end gap-2">
        <label className="flex-1 text-sm text-ink-secondary">
          Add a question
          <input
            value={newQuestion}
            onChange={(e) => setNewQuestion(e.target.value)}
            placeholder="Type a question of your own (optional)"
            className="mt-1 w-full rounded border border-surface-overlay bg-surface-sunken px-2 py-2 text-sm text-ink-primary"
          />
        </label>
        <button
          type="button"
          disabled={!newQuestion.trim()}
          onClick={() => {
            setDrafts((ds) => [
              ...ds,
              {
                question: newQuestion.trim(),
                reason: null,
                provenance: [],
                dismissed: false,
                editedText: null,
                editing: false,
              },
            ]);
            setNewQuestion("");
          }}
          className="min-h-[38px] rounded border border-surface-overlay px-4 py-2 text-sm text-ink-secondary disabled:opacity-40"
        >
          Add
        </button>
      </div>

      <button
        type="button"
        disabled={busy}
        onClick={approve}
        data-primary-action
        className="mt-5 min-h-[44px] w-full rounded bg-brand px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-40"
      >
        Approve questions
      </button>
    </div>
  );
}
