import { useEffect, useRef, useState } from "react";
import { ClipboardCopy } from "lucide-react";
import type { StatusFilters } from "../lib/filters";
import { artifactToMarkdown, copyText } from "../lib/markdown";
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
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => () => clearTimeout(copiedTimer.current), []);
  return (
    <section className="mb-6">
      <h2 className="mb-2 flex items-baseline gap-2 text-sm font-semibold">
        <span className="font-mono">{artifact.artifact_id}</span>
        <span className="text-xs font-normal text-ink-subtle">
          ({artifact.claims.length} claims)
        </span>
        <button
          type="button"
          aria-label={`copy ${artifact.artifact_id} as markdown`}
          title="Copy as Markdown"
          onClick={async () => {
            if (await copyText(artifactToMarkdown(kase, artifact))) {
              setCopied(true);
              clearTimeout(copiedTimer.current);
              copiedTimer.current = setTimeout(() => setCopied(false), 1500);
            }
          }}
          className="ml-auto flex items-center gap-1 rounded border border-surface-overlay px-1.5 py-0.5 text-xs font-normal text-ink-secondary hover:border-brand hover:text-brand"
        >
          <ClipboardCopy className="h-3.5 w-3.5" aria-hidden />
          {copied ? "copied" : "copy md"}
        </button>
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
