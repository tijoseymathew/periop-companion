import { resolveRef } from "../lib/provenance";
import type { Case } from "../lib/schema";

/**
 * A clickable citation (`source_id#anchor`). Audio clips read teal with a ▶,
 * document excerpts read quiet with a ¶, and unresolvable refs carry an
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
  const hit = resolveRef(kase, refStr);
  const isAudio = hit?.kind === "segment";
  const tint = !hit
    ? "border-status-conflicting/50 text-ink-secondary"
    : isAudio
      ? "border-brand/28 bg-brand/10 text-brand-soft"
      : "border-surface-line bg-surface-raised text-ink-secondary hover:border-brand hover:text-brand";
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onActivate(refStr);
      }}
      className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 font-mono text-[11.5px] transition-colors ${tint}`}
    >
      <span aria-hidden>{!hit ? "⚠" : isAudio ? "▶" : "¶"}</span>
      <span>{refStr}</span>
      {!hit && (
        <span className="rounded bg-status-conflicting px-1 font-bold text-surface-base">
          UNRESOLVED
        </span>
      )}
    </button>
  );
}
