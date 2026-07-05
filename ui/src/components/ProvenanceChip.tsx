import { resolveRef } from "../lib/provenance";
import type { Case } from "../lib/schema";

/**
 * A clickable citation (`source_id#anchor`). Unresolvable refs carry an
 * unmissable UNRESOLVED badge — broken provenance is a finding, never hidden.
 */
export function ProvenanceChip({
  kase,
  refStr,
  onActivate,
}: {
  kase: Case;
  refStr: string;
  onActivate: (ref: string) => void;
}) {
  const resolved = resolveRef(kase, refStr) !== null;
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onActivate(refStr);
      }}
      className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-xs transition-colors ${
        resolved
          ? "border-surface-overlay text-ink-secondary hover:border-brand hover:text-brand"
          : "border-status-conflicting/60 text-ink-secondary"
      }`}
    >
      <span className="font-mono">{refStr}</span>
      {!resolved && (
        <span className="rounded bg-status-conflicting px-1 font-bold text-surface-base">
          UNRESOLVED
        </span>
      )}
    </button>
  );
}
