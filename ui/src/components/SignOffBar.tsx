/**
 * Sign-off screen footer (spec v2 §4.5): counts and a jump list of
 * unsupported / conflicting claims and UNRESOLVED provenance — what a
 * reviewer must not miss. Sign-off with outstanding conflicts is allowed but
 * said in words. Hosts the handoff acknowledge and the quiet stage reopen.
 */
import { useState } from "react";
import { resolveRef } from "../lib/provenance";
import type { ArtifactRecord, Case, ClaimReviews } from "../lib/schema";
import type { PrimaryAction } from "../lib/workflow";

interface Flagged {
  artifactId: string;
  claimId: string;
  why: "conflicting" | "unsupported" | "unresolved" | "flagged";
}

export function SignOffBar({
  kase,
  artifacts,
  action,
  signedOff,
  reviews = {},
  onSignOff,
  onAcknowledge,
  onReopen,
  onJumpToClaim,
}: {
  kase: Case;
  artifacts: ArtifactRecord[];
  action: PrimaryAction | null;
  signedOff: boolean;
  /** per-claim review actions (v2 W6a), keyed `artifact_id#claim_id` */
  reviews?: ClaimReviews;
  onSignOff: () => Promise<void>;
  onAcknowledge: () => Promise<void>;
  onReopen: () => Promise<void>;
  onJumpToClaim: (artifactId: string, claimId: string) => void;
}) {
  const [busy, setBusy] = useState(false);

  const flagged: Flagged[] = [];
  let claimCount = 0;
  let reviewedCount = 0;
  for (const artifact of artifacts) {
    for (const claim of artifact.claims) {
      claimCount += 1;
      if (claim.status === "conflicting" || claim.status === "unsupported") {
        flagged.push({ artifactId: artifact.artifact_id, claimId: claim.claim_id, why: claim.status });
      } else if (claim.provenance.some((ref) => resolveRef(kase, ref) === null)) {
        flagged.push({ artifactId: artifact.artifact_id, claimId: claim.claim_id, why: "unresolved" });
      }
      const review = reviews[`${artifact.artifact_id}#${claim.claim_id}`];
      if (review?.state === "reviewed") reviewedCount += 1;
      if (review?.state === "flagged") {
        flagged.push({ artifactId: artifact.artifact_id, claimId: claim.claim_id, why: "flagged" });
      }
    }
  }
  const counts = {
    conflicting: flagged.filter((f) => f.why === "conflicting").length,
    unsupported: flagged.filter((f) => f.why === "unsupported").length,
    unresolved: flagged.filter((f) => f.why === "unresolved").length,
    flagged: flagged.filter((f) => f.why === "flagged").length,
  };

  async function run(work: () => Promise<void>) {
    setBusy(true);
    try {
      await work();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="border-t border-surface-overlay bg-surface-raised px-4 py-3">
      {flagged.length > 0 ? (
        <div className="text-sm">
          <p className="text-ink-secondary">
            Before signing off, check:{" "}
            {counts.conflicting > 0 && (
              <span className="text-status-conflicting">{counts.conflicting} conflicting</span>
            )}
            {counts.conflicting > 0 && counts.unsupported > 0 && " · "}
            {counts.unsupported > 0 && (
              <span className="text-status-unsupported">{counts.unsupported} unsupported</span>
            )}
            {counts.unresolved > 0 && (
              <>
                {(counts.conflicting > 0 || counts.unsupported > 0) && " · "}
                <span className="text-status-conflicting">{counts.unresolved} unresolved citation{counts.unresolved > 1 ? "s" : ""}</span>
              </>
            )}
            {counts.flagged > 0 && (
              <>
                {(counts.conflicting > 0 || counts.unsupported > 0 || counts.unresolved > 0) && " · "}
                <span className="text-status-unsupported">
                  {counts.flagged} flagged by a reviewer
                </span>
              </>
            )}
          </p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {flagged.map((f) => (
              <button
                key={`${f.artifactId}#${f.claimId}#${f.why}`}
                type="button"
                onClick={() => onJumpToClaim(f.artifactId, f.claimId)}
                className="rounded border border-surface-overlay px-2 py-1 font-mono text-xs text-ink-secondary hover:border-brand hover:text-brand"
              >
                {f.claimId} · {f.why}
              </button>
            ))}
          </div>
          {action?.kind === "sign-off" && (
            <p className="mt-1.5 text-xs text-ink-subtle">
              Signing off with these outstanding is allowed — it is recorded on
              the case.
            </p>
          )}
        </div>
      ) : (
        !signedOff && (
          <p className="text-sm text-ink-secondary">
            Nothing flagged — every claim is supported and traceable.
          </p>
        )
      )}
      {reviewedCount > 0 && (
        <p className="mt-1 text-xs text-ink-subtle">
          {reviewedCount} of {claimCount} claims marked reviewed.
        </p>
      )}

      {action?.kind === "sign-off" && (
        <button
          type="button"
          disabled={busy}
          data-primary-action
          onClick={() => run(onSignOff)}
          className="mt-2.5 min-h-[44px] w-full rounded bg-brand px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-40"
        >
          {action.label}
        </button>
      )}
      {action?.kind === "acknowledge-handoff" && (
        <button
          type="button"
          disabled={busy}
          data-primary-action
          onClick={() => run(onAcknowledge)}
          className="mt-2.5 min-h-[44px] w-full rounded bg-brand px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-40"
        >
          {action.label}
        </button>
      )}
      {signedOff && (
        <div className="mt-1 flex items-center justify-between">
          <p className="text-sm text-status-supported">
            This stage is signed off and read-only.
          </p>
          <button
            type="button"
            disabled={busy}
            onClick={() => run(onReopen)}
            className="rounded border border-surface-overlay px-3 py-1.5 text-xs text-ink-secondary"
          >
            Reopen stage
          </button>
        </div>
      )}
    </div>
  );
}
