/**
 * Intra-op orientation (spec v2 §4.2 step 1): the incoming provider — who
 * may never have met the patient — gets the unanswered questions and flagged
 * conflicts pinned to the top, every item traceable to its source.
 */
import type { Case } from "../lib/schema";

export function OrientationView({
  kase,
  onActivateRef,
}: {
  kase: Case;
  onActivateRef: (ref: string) => void;
}) {
  const questions = kase.open_questions.filter((q) => q.review !== "dismissed");
  const conflicts = kase.artifacts.flatMap((a) =>
    a.claims
      .filter((c) => c.status === "conflicting")
      .map((c) => ({ artifactId: a.artifact_id, claim: c })),
  );
  if (questions.length === 0 && conflicts.length === 0) return null;

  const chip = (ref: string) => (
    <button
      key={ref}
      type="button"
      onClick={() => onActivateRef(ref)}
      className="rounded border border-surface-overlay px-1.5 py-0.5 font-mono text-xs text-ink-secondary hover:border-brand hover:text-brand"
    >
      {ref}
    </button>
  );

  return (
    <div className="rounded border border-status-conflicting/40 bg-surface-raised p-4">
      <h3 className="text-sm font-semibold">What you need to know before induction</h3>
      <ul className="mt-2 space-y-2">
        {conflicts.map(({ artifactId, claim }) => (
          <li key={`${artifactId}#${claim.claim_id}`} className="text-sm">
            <span className="mr-2 rounded bg-status-conflicting/20 px-1.5 py-0.5 text-xs text-status-conflicting">
              conflict
            </span>
            {claim.text}
            <span className="ml-2 inline-flex flex-wrap gap-1">
              {claim.provenance.map(chip)}
            </span>
          </li>
        ))}
        {questions.map((q) => (
          <li key={q.question} className="text-sm">
            <span className="mr-2 rounded bg-surface-overlay px-1.5 py-0.5 text-xs text-ink-subtle">
              open question
            </span>
            {q.review === "edited" && q.edited_text ? q.edited_text : q.question}
            <span className="ml-2 inline-flex flex-wrap gap-1">{q.provenance.map(chip)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
