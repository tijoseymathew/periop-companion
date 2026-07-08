/**
 * Orientation / "Catch me up" (brief §4.6): the provider taking over mid-case —
 * who may never have met the patient — gets everything unresolved or conflicting
 * pinned to the very top, then the key facts. Urgent-but-calm reference, not a
 * wall of text. Every item is traceable to its source.
 */
import type { Case } from "../lib/schema";
import { ProvenanceChip } from "./ProvenanceChip";

export function OrientationView({
  kase,
  onActivateRef,
}: {
  kase: Case;
  onActivateRef: (ref: string) => void;
}) {
  const claims = kase.artifacts.flatMap((a) => a.claims);
  const conflicts = claims.filter((c) => c.status === "conflicting");
  const watch = kase.anticipated_issues;
  const questions = kase.open_questions.filter((q) => q.review !== "dismissed");
  const keyFacts = claims.filter((c) => c.status === "supported" || c.status === "inference").slice(0, 8);

  const hasAttention = conflicts.length > 0 || watch.length > 0 || questions.length > 0;

  return (
    <div className="mx-auto w-full max-w-3xl">
      {hasAttention ? (
        <>
          <div className="mb-3 font-mono text-[10.5px] tracking-wider text-status-conflicting">
            ⚠ NEEDS YOUR ATTENTION
          </div>
          {conflicts.map((c) => (
            <div
              key={c.claim_id}
              className="mb-2.5 rounded-xl border border-status-conflicting/30 bg-status-conflicting/[0.06] px-4 py-4"
            >
              <div className="mb-2 inline-flex items-center gap-1.5 text-xs font-semibold text-status-conflicting">
                ✕ Conflicting
              </div>
              <div className="text-[15px] leading-relaxed text-ink-primary">{c.text}</div>
              {c.provenance.length > 0 && (
                <div className="mt-2.5 flex flex-wrap gap-1.5">
                  {c.provenance.map((ref) => (
                    <ProvenanceChip key={ref} kase={kase} refStr={ref} onActivate={onActivateRef} />
                  ))}
                </div>
              )}
            </div>
          ))}
          {watch.map((issue, i) => (
            <div
              key={i}
              className="mb-2.5 rounded-xl border border-status-inference/28 bg-status-inference/[0.05] px-4 py-4"
            >
              <div className="mb-2 inline-flex items-center gap-1.5 text-xs font-semibold text-status-inference">
                → Watch
              </div>
              <div className="text-[15px] leading-relaxed text-ink-primary">{issue}</div>
            </div>
          ))}
          {questions.map((q, i) => (
            <div
              key={i}
              className="mb-2.5 rounded-xl border border-surface-line bg-surface-raised px-4 py-4"
            >
              <div className="mb-2 inline-flex items-center gap-1.5 text-xs font-semibold text-ink-subtle">
                ? Open question
              </div>
              <div className="text-[15px] leading-relaxed text-ink-primary">
                {q.review === "edited" && q.edited_text ? q.edited_text : q.question}
              </div>
              {q.provenance.length > 0 && (
                <div className="mt-2.5 flex flex-wrap gap-1.5">
                  {q.provenance.map((ref) => (
                    <ProvenanceChip key={ref} kase={kase} refStr={ref} onActivate={onActivateRef} />
                  ))}
                </div>
              )}
            </div>
          ))}
        </>
      ) : (
        <div className="mb-6 rounded-xl border border-status-supported/30 bg-status-supported/[0.06] px-4 py-4 text-sm text-status-supported">
          Nothing unresolved on this case — you're clear to review the key facts below.
        </div>
      )}

      {keyFacts.length > 0 && (
        <>
          <div className="mb-3 mt-6 font-mono text-[10.5px] tracking-wider text-ink-faint">
            KEY FACTS
          </div>
          <div className="grid grid-cols-2 gap-2.5">
            {keyFacts.map((c) => (
              <button
                key={c.claim_id}
                type="button"
                onClick={() => c.provenance[0] && onActivateRef(c.provenance[0])}
                className="rounded-xl border border-surface-line bg-surface-raised px-4 py-4 text-left text-[14.5px] leading-relaxed text-ink-primary hover:border-surface-overlay"
              >
                {c.text}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
