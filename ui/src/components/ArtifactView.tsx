import type { StatusFilters } from "../lib/filters";
import type { ArtifactRecord, Case, ClaimReviews, ClaimReviewState } from "../lib/schema";
import { ClaimRow } from "./ClaimRow";
import { EventsTable } from "./EventsTable";

/**
 * An artifact rendered as its ordered claims — this *is* the note (ui.md §5.3).
 * `record:intra-op` additionally shows the structured events table. The screen
 * header (title, copy, sign-off) is owned by the surrounding ReviewScreen.
 */
export function ArtifactView({
  kase,
  artifact,
  filters,
  activeClaimId = null,
  onActivateRef,
  reviews,
  onReviewClaim,
}: {
  kase: Case;
  artifact: ArtifactRecord;
  filters: StatusFilters;
  activeClaimId?: string | null;
  onActivateRef: (ref: string) => void;
  /** per-claim review actions (v2 W6a); absent on demo cases */
  reviews?: ClaimReviews;
  onReviewClaim?: (ref: string, state: ClaimReviewState | null) => void;
}) {
  const visible = artifact.claims.filter((c) => filters[c.status]);
  const hidden = artifact.claims.length - visible.length;
  return (
    <section className="mb-7">
      <h2 className="mb-3 font-mono text-[10.5px] tracking-wider text-ink-faint">
        {artifact.artifact_id.toUpperCase()} · {artifact.claims.length} CLAIMS
      </h2>
      <div className="space-y-2.5">
        {visible.map((claim) => (
          <ClaimRow
            key={claim.claim_id}
            kase={kase}
            artifactId={artifact.artifact_id}
            claim={claim}
            active={claim.claim_id === activeClaimId}
            onActivateRef={onActivateRef}
            review={reviews?.[`${artifact.artifact_id}#${claim.claim_id}`]?.state ?? null}
            onReview={
              onReviewClaim &&
              ((state) => onReviewClaim(`${artifact.artifact_id}#${claim.claim_id}`, state))
            }
          />
        ))}
      </div>
      {hidden > 0 && (
        <p className="mt-2.5 text-xs italic text-ink-subtle">
          {hidden} claim{hidden === 1 ? "" : "s"} hidden by status filters
        </p>
      )}
      {artifact.artifact_id === "record:intra-op" && kase.intraop_events.length > 0 && (
        <EventsTable kase={kase} events={kase.intraop_events} onActivateRef={onActivateRef} />
      )}
    </section>
  );
}
