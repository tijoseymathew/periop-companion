import { useState } from "react";
import type { CitingClaim } from "../lib/provenance";
import { StatusBadge } from "./StatusBadge";

/**
 * Reverse-index affordance (ui.md §5.4): "cited by n claims" on a chunk or
 * segment; expanding lists the citing claims (verdicts side by side — that is
 * how conflicts become legible) and clicking one jumps the center pane to it.
 */
export function CitedBy({
  citers,
  onJumpToClaim,
}: {
  citers: CitingClaim[];
  onJumpToClaim: (artifactId: string, claimId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  if (citers.length === 0) return null;
  return (
    <div className="mt-1">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        className="text-xs text-brand hover:underline"
      >
        cited by {citers.length} claim{citers.length === 1 ? "" : "s"}
      </button>
      {open && (
        <ul className="mt-1 space-y-1">
          {citers.map(({ artifactId, claim }) => (
            <li key={`${artifactId}#${claim.claim_id}`}>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onJumpToClaim(artifactId, claim.claim_id);
                }}
                className="flex w-full items-start gap-1.5 rounded px-1 py-0.5 text-left text-xs hover:bg-surface-overlay/50"
              >
                <StatusBadge status={claim.status} />
                <span className="flex-1">{claim.text}</span>
                <span className="font-mono text-ink-subtle">{claim.claim_id}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
