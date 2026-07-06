import type { Case, Claim, ClaimReviewState } from "../lib/schema";
import { ProvenanceChip } from "./ProvenanceChip";
import { StatusBadge } from "./StatusBadge";

export function claimDomId(artifactId: string, claimId: string): string {
  return `claim-${artifactId}-${claimId}`.replace(/[^A-Za-z0-9-]+/g, "-");
}

/**
 * One row of the claim ledger: status badge, claim text, provenance chips.
 * Clicking the row activates the first ref; chips are individually clickable.
 * On live cases the row carries quiet review actions (v2 W6a): mark reviewed
 * or flag — annotations on the review pass, never edits to the claim.
 */
export function ClaimRow({
  kase,
  artifactId,
  claim,
  active = false,
  onActivateRef,
  review,
  onReview,
}: {
  kase: Case;
  artifactId: string;
  claim: Claim;
  active?: boolean;
  onActivateRef: (ref: string) => void;
  /** this claim's current review action, when the case supports them */
  review?: ClaimReviewState | null;
  onReview?: (state: ClaimReviewState | null) => void;
}) {
  const firstRef = claim.provenance[0];
  return (
    <div
      id={claimDomId(artifactId, claim.claim_id)}
      data-active={active}
      onClick={firstRef ? () => onActivateRef(firstRef) : undefined}
      className={`rounded border-l-2 px-3 py-2 ${
        active ? "bg-surface-overlay/60 ring-1 ring-brand" : "hover:bg-surface-raised"
      } ${firstRef ? "cursor-pointer" : ""} border-surface-overlay`}
    >
      <div className="flex items-start gap-2">
        <StatusBadge status={claim.status} />
        <p data-testid="claim-text" className="flex-1 text-sm leading-snug">
          {claim.text}
        </p>
        <span className="font-mono text-xs text-ink-subtle">{claim.claim_id}</span>
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-1 pl-7">
        {claim.provenance.length === 0 ? (
          <span className="text-xs italic text-ink-subtle">no citations</span>
        ) : (
          claim.provenance.map((ref) => (
            <ProvenanceChip key={ref} kase={kase} refStr={ref} onActivate={onActivateRef} />
          ))
        )}
        {onReview && (
          <span className="ml-auto flex gap-1">
            <ReviewToggle
              label="Mark reviewed"
              pressed={review === "reviewed"}
              onToggle={() => onReview(review === "reviewed" ? null : "reviewed")}
              pressedClass="border-status-supported text-status-supported"
            />
            <ReviewToggle
              label="Flag"
              pressed={review === "flagged"}
              onToggle={() => onReview(review === "flagged" ? null : "flagged")}
              pressedClass="border-status-conflicting text-status-conflicting"
            />
          </span>
        )}
      </div>
    </div>
  );
}

function ReviewToggle({
  label,
  pressed,
  onToggle,
  pressedClass,
}: {
  label: string;
  pressed: boolean;
  onToggle: () => void;
  pressedClass: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={(e) => {
        e.stopPropagation(); // the row click plays provenance, not this
        onToggle();
      }}
      className={`rounded border px-2 py-1 text-xs ${
        pressed ? pressedClass : "border-surface-overlay text-ink-subtle hover:text-ink-secondary"
      }`}
    >
      {label}
    </button>
  );
}
