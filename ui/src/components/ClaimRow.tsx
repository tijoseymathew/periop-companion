import type { Case, Claim, ClaimReviewState } from "../lib/schema";
import { claimUnresolved } from "../lib/claims";
import { ProvenanceChip } from "./ProvenanceChip";
import { StatusBadge } from "./StatusBadge";

export function claimDomId(artifactId: string, claimId: string): string {
  return `claim-${artifactId}-${claimId}`.replace(/[^A-Za-z0-9-]+/g, "-");
}

/**
 * One card of the claim ledger (imported design): a "CLAIM ##" tag and status
 * badge, the claim sentence, then its provenance chips. Clicking the card
 * activates the first ref; chips are individually clickable. On live cases the
 * card carries quiet review actions (v2 W6a) — mark reviewed or flag, an
 * annotation on the review pass, never an edit to the claim.
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
  review?: ClaimReviewState | null;
  onReview?: (state: ClaimReviewState | null) => void;
}) {
  const firstRef = claim.provenance[0];
  const unresolved = claimUnresolved(claim);
  return (
    <div
      id={claimDomId(artifactId, claim.claim_id)}
      data-active={active}
      onClick={firstRef ? () => onActivateRef(firstRef) : undefined}
      className={`rounded-xl border p-4 ${
        active
          ? "border-brand/50 bg-brand/[0.06]"
          : "border-surface-line bg-surface-raised hover:border-surface-overlay"
      } ${firstRef ? "cursor-pointer" : ""}`}
    >
      <div className="flex items-center justify-between gap-3">
        <span className="font-mono text-xs text-ink-faint">CLAIM {claim.claim_id}</span>
        <StatusBadge status={claim.status} />
      </div>
      <p data-testid="claim-text" className="mt-2 text-[14.5px] leading-relaxed text-ink-primary">
        {claim.text}
      </p>
      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        {unresolved && (
          <span className="inline-flex items-center gap-1.5 rounded-md border border-status-conflicting/40 bg-status-conflicting/[0.13] px-2 py-1 font-mono text-[11.5px] text-status-conflicting">
            ⚠ SOURCE UNRESOLVED
          </span>
        )}
        {claim.provenance.map((ref) => (
          <ProvenanceChip key={ref} kase={kase} refStr={ref} onActivate={onActivateRef} />
        ))}
        {onReview && (
          <span className="ml-auto flex gap-1.5">
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
        e.stopPropagation(); // the card click plays provenance, not this
        onToggle();
      }}
      className={`rounded-md border px-2 py-1 text-[11.5px] ${
        pressed ? pressedClass : "border-surface-line text-ink-subtle hover:text-ink-secondary"
      }`}
    >
      {label}
    </button>
  );
}
