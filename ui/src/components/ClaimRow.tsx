import type { Case, Claim } from "../lib/schema";
import { ProvenanceChip } from "./ProvenanceChip";
import { StatusBadge } from "./StatusBadge";

export function claimDomId(artifactId: string, claimId: string): string {
  return `claim-${artifactId}-${claimId}`.replace(/[^A-Za-z0-9-]+/g, "-");
}

/**
 * One row of the claim ledger: status badge, claim text, provenance chips.
 * Clicking the row activates the first ref; chips are individually clickable.
 */
export function ClaimRow({
  kase,
  artifactId,
  claim,
  active = false,
  onActivateRef,
}: {
  kase: Case;
  artifactId: string;
  claim: Claim;
  active?: boolean;
  onActivateRef: (ref: string) => void;
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
      <div className="mt-1.5 flex flex-wrap gap-1 pl-7">
        {claim.provenance.length === 0 ? (
          <span className="text-xs italic text-ink-subtle">no citations</span>
        ) : (
          claim.provenance.map((ref) => (
            <ProvenanceChip key={ref} kase={kase} refStr={ref} onActivate={onActivateRef} />
          ))
        )}
      </div>
    </div>
  );
}
