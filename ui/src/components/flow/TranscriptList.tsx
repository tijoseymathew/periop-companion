/**
 * Transcript rendering shared by the interview panel and the capture screens
 * (design: timestamp + speaker rail, serif source text — raw material reads
 * differently from generated prose).
 */
import type { AudioSegment } from "../../lib/schema";

function mmss(t: number): string {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function TranscriptList({
  segments,
  maxHeight,
}: {
  segments: AudioSegment[];
  maxHeight?: number;
}) {
  return (
    <div
      className="overflow-y-auto"
      style={maxHeight ? { maxHeight } : undefined}
      data-testid="transcript"
    >
      {segments.map((seg) => (
        <div key={seg.seg_id} className="flex gap-3 border-t border-surface-line py-2 first:border-t-0">
          <div className="w-12 flex-none">
            <div className="text-[12px] font-semibold text-ink-dim">{mmss(seg.t0)}</div>
            <div
              className={`text-[10.5px] ${
                seg.speaker === "PATIENT" ? "text-brand-ink" : "text-ink-faint"
              }`}
            >
              {seg.speaker.charAt(0) + seg.speaker.slice(1).toLowerCase()}
            </div>
          </div>
          <div className="flex-1 font-serif text-[14.5px] leading-relaxed text-ink-body">
            {seg.text}
          </div>
        </div>
      ))}
      {segments.length === 0 && (
        <p className="py-2 text-[13px] text-ink-subtle">No speech found in the recording.</p>
      )}
    </div>
  );
}
