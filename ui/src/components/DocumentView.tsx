import { useEffect } from "react";
import type { CitingClaim } from "../lib/provenance";
import type { Source } from "../lib/schema";
import { CitedBy } from "./CitedBy";

/** Document chunks with section headings, ids, highlight, and cited-by. */
export function DocumentView({
  source,
  highlightedAnchor,
  reverseIndex,
  onJumpToClaim,
}: {
  source: Source;
  highlightedAnchor: string | null;
  reverseIndex: Map<string, CitingClaim[]>;
  onJumpToClaim: (artifactId: string, claimId: string) => void;
}) {
  useEffect(() => {
    if (!highlightedAnchor) return;
    // jsdom has no scrollIntoView; optional call keeps tests happy
    document
      .querySelector<HTMLElement>(`[data-testid="chunk-${highlightedAnchor}"]`)
      ?.scrollIntoView?.({ block: "center" });
  }, [highlightedAnchor, source.source_id]);

  let lastSection: string | null = null;
  return (
    <div className="space-y-2 p-3">
      {source.chunks.map((chunk) => {
        const heading = chunk.section && chunk.section !== lastSection ? chunk.section : null;
        if (chunk.section) lastSection = chunk.section;
        const highlighted = chunk.chunk_id === highlightedAnchor;
        return (
          <div key={chunk.chunk_id}>
            {heading && (
              <h3 className="mb-1 mt-3 text-xs font-semibold uppercase tracking-wide text-ink-secondary">
                {heading}
              </h3>
            )}
            <div
              data-testid={`chunk-${chunk.chunk_id}`}
              data-highlighted={highlighted}
              className={`rounded border px-2.5 py-1.5 ${
                highlighted
                  ? "border-brand bg-brand/10 ring-1 ring-brand"
                  : "border-surface-overlay/60"
              }`}
            >
              <span className="font-mono text-xs text-ink-subtle">{chunk.chunk_id}</span>
              <p className="mt-0.5 text-sm leading-snug">{chunk.text}</p>
              <CitedBy
                citers={reverseIndex.get(`${source.source_id}#${chunk.chunk_id}`) ?? []}
                onJumpToClaim={onJumpToClaim}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
