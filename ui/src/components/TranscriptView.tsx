import { useEffect } from "react";
import type { CitingClaim } from "../lib/provenance";
import type { Source } from "../lib/schema";
import { CitedBy } from "./CitedBy";

/** Speaker color-coding: PROVIDER / PATIENT / others distinct (ui.md §5.4). */
const SPEAKER_CLASSES: Record<string, string> = {
  PROVIDER: "bg-brand/20 text-brand-soft",
  PATIENT: "bg-status-inference/20 text-status-inference",
};
const OTHER_SPEAKER = "bg-surface-overlay text-ink-secondary";

/**
 * Diarized transcript: seg id, speaker badge, times, text. Click seeks the
 * player; the currently-playing segment highlights via player time.
 */
export function TranscriptView({
  source,
  highlightedAnchor,
  currentTime,
  playing,
  reverseIndex,
  onSeekToTime,
  onJumpToClaim,
}: {
  source: Source;
  highlightedAnchor: string | null;
  /** Player position in seconds, when this source's wav is loaded. */
  currentTime: number | null;
  /** Whether the player currently holds this source's audio. */
  playing: boolean;
  reverseIndex: Map<string, CitingClaim[]>;
  onSeekToTime: (seconds: number) => void;
  onJumpToClaim: (artifactId: string, claimId: string) => void;
}) {
  useEffect(() => {
    if (!highlightedAnchor) return;
    document
      .querySelector<HTMLElement>(`[data-testid="segment-${highlightedAnchor}"]`)
      ?.scrollIntoView?.({ block: "center" });
  }, [highlightedAnchor, source.source_id]);

  return (
    <div className="space-y-1.5 p-3">
      {source.segments.map((seg) => {
        const isHighlighted = seg.seg_id === highlightedAnchor;
        const isPlaying =
          playing && currentTime !== null && currentTime >= seg.t0 && currentTime < seg.t1;
        return (
          <div
            key={seg.seg_id}
            data-testid={`segment-${seg.seg_id}`}
            data-highlighted={isHighlighted}
            data-playing={isPlaying}
            onClick={() => onSeekToTime(seg.t0)}
            className={`cursor-pointer rounded border px-2.5 py-1.5 ${
              isHighlighted
                ? "border-brand bg-brand/10 ring-1 ring-brand"
                : isPlaying
                  ? "border-brand/60 bg-brand/5"
                  : "border-surface-overlay/60 hover:border-surface-overlay"
            }`}
          >
            <div className="flex items-center gap-2 text-xs">
              <span className="font-mono text-ink-subtle">{seg.seg_id}</span>
              <span
                className={`rounded px-1.5 py-px font-semibold ${
                  SPEAKER_CLASSES[seg.speaker] ?? OTHER_SPEAKER
                }`}
              >
                {seg.speaker}
              </span>
              <span className="font-mono text-ink-subtle">
                {seg.t0.toFixed(1)}–{seg.t1.toFixed(1)}s
              </span>
            </div>
            <p className="mt-1 font-mono text-sm leading-snug text-ink-primary">{seg.text}</p>
            <CitedBy
              citers={reverseIndex.get(`${source.source_id}#${seg.seg_id}`) ?? []}
              onJumpToClaim={onJumpToClaim}
            />
          </div>
        );
      })}
    </div>
  );
}
