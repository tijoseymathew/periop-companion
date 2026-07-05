import type { CitingClaim } from "../lib/provenance";
import type { Case } from "../lib/schema";
import { DocumentView } from "./DocumentView";
import { TranscriptView } from "./TranscriptView";

/** Right-sidebar source panel (ui.md §5.4): documents ⟷ transcripts. */
export function SourcePanel({
  kase,
  reverseIndex,
  activeSourceId,
  highlightedAnchor,
  currentTime,
  playingSourceId,
  onSelectSource,
  onSeekToTime,
  onJumpToClaim,
}: {
  kase: Case;
  reverseIndex: Map<string, CitingClaim[]>;
  activeSourceId: string | null;
  /** chunk_id / seg_id to highlight within the active source. */
  highlightedAnchor: string | null;
  currentTime: number | null;
  /** source_id whose wav is loaded in the player, if any. */
  playingSourceId: string | null;
  onSelectSource: (sourceId: string) => void;
  onSeekToTime: (seconds: number) => void;
  onJumpToClaim: (artifactId: string, claimId: string) => void;
}) {
  const source = kase.sources.find((s) => s.source_id === activeSourceId) ?? null;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        role="tablist"
        aria-label="Sources"
        className="flex flex-wrap gap-1 border-b border-surface-overlay p-2"
      >
        {kase.sources.map((s) => (
          <button
            key={s.source_id}
            type="button"
            role="tab"
            aria-selected={s.source_id === activeSourceId}
            onClick={() => onSelectSource(s.source_id)}
            className={`rounded px-2 py-1 font-mono text-xs ${
              s.source_id === activeSourceId
                ? "bg-surface-overlay text-ink-primary"
                : "text-ink-subtle hover:text-ink-secondary"
            }`}
          >
            {s.source_id}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {source?.type === "document" && (
          <DocumentView
            source={source}
            highlightedAnchor={highlightedAnchor}
            reverseIndex={reverseIndex}
            onJumpToClaim={onJumpToClaim}
          />
        )}
        {source?.type === "audio" && (
          <TranscriptView
            source={source}
            highlightedAnchor={highlightedAnchor}
            currentTime={currentTime}
            playing={source.source_id === playingSourceId}
            reverseIndex={reverseIndex}
            onSeekToTime={onSeekToTime}
            onJumpToClaim={onJumpToClaim}
          />
        )}
        {!source && (
          <p className="p-4 text-sm text-ink-subtle">
            Select a source, or click a claim's citation.
          </p>
        )}
      </div>
    </div>
  );
}
