import type { StatusFilters } from "../lib/filters";
import type { ArtifactRecord, Case } from "../lib/schema";
import { ClaimRow } from "./ClaimRow";
import { EventsTable } from "./EventsTable";

/**
 * An artifact rendered as its ordered claims — this *is* the note (ui.md §5.3).
 * `record:intra-op` additionally shows the structured events table.
 */
export function ArtifactView({
  kase,
  artifact,
  filters,
  activeClaimId = null,
  onActivateRef,
}: {
  kase: Case;
  artifact: ArtifactRecord;
  filters: StatusFilters;
  activeClaimId?: string | null;
  onActivateRef: (ref: string) => void;
}) {
  const visible = artifact.claims.filter((c) => filters[c.status]);
  const hidden = artifact.claims.length - visible.length;
  return (
    <section className="mb-6">
      <h2 className="mb-2 flex items-baseline gap-2 text-sm font-semibold">
        <span className="font-mono">{artifact.artifact_id}</span>
        <span className="text-xs font-normal text-ink-subtle">
          ({artifact.claims.length} claims)
        </span>
      </h2>
      <div className="space-y-1.5">
        {visible.map((claim) => (
          <ClaimRow
            key={claim.claim_id}
            kase={kase}
            artifactId={artifact.artifact_id}
            claim={claim}
            active={claim.claim_id === activeClaimId}
            onActivateRef={onActivateRef}
          />
        ))}
      </div>
      {hidden > 0 && (
        <p className="mt-2 text-xs italic text-ink-subtle">
          {hidden} claim{hidden === 1 ? "" : "s"} hidden by status filters
        </p>
      )}
      {artifact.artifact_id === "record:intra-op" && kase.intraop_events.length > 0 && (
        <EventsTable kase={kase} events={kase.intraop_events} onActivateRef={onActivateRef} />
      )}
    </section>
  );
}
