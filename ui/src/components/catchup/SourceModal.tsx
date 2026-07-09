/**
 * Source-for-this-fact modal (PeriOp Catch-Up.dc.html "SOURCE MODAL"). Opens
 * from any provenance link — a key fact, a theatre event, a "needs you now"
 * card. Left rail lists every citation; the pane renders the active one with
 * its exact span highlighted: an audio transcript over the shared AudioPlayer,
 * or a document with the cited chunk lit.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { AudioPlayer, type AudioPlayerHandle } from "../AudioPlayer";
import { audioUrl } from "../../lib/api";
import { parseRef } from "../../lib/provenance";
import type { Case, Source } from "../../lib/schema";

export interface SourceRequest {
  title: string;
  refs: string[];
}

interface Entry {
  ref: string;
  sourceId: string;
  anchor: string;
  source: Source | null;
}

function glyphFor(source: Source | null): { glyph: string; audio: boolean } {
  const audio = source?.type === "audio";
  return { glyph: audio ? "▶" : "¶", audio };
}

function segSubtitle(entry: Entry): string {
  const s = entry.source;
  if (!s) return "Unresolved source";
  if (s.type === "audio") {
    const seg = s.segments.find((x) => x.seg_id === entry.anchor);
    return seg ? `${fmtTime(seg.t0)} · ${seg.speaker}` : "Recording";
  }
  return "Document";
}

function fmtTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function SourceModal({
  kase,
  request,
  onClose,
}: {
  kase: Case;
  request: SourceRequest;
  onClose: () => void;
}) {
  const entries = useMemo<Entry[]>(
    () =>
      request.refs.map((ref) => {
        const parsed = parseRef(ref);
        const sourceId = parsed?.sourceId ?? ref;
        return {
          ref,
          sourceId,
          anchor: parsed?.anchor ?? "",
          source: kase.sources.find((s) => s.source_id === sourceId) ?? null,
        };
      }),
    [kase, request],
  );

  const [idx, setIdx] = useState(0);
  const active = entries[idx] ?? entries[0];

  const playerRef = useRef<AudioPlayerHandle>(null);
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null);
  const [playerTime, setPlayerTime] = useState<number | null>(null);
  const [missing, setMissing] = useState<Set<string>>(new Set());

  // Escape closes; reset the selection whenever a new request opens.
  useEffect(() => {
    setIdx(0);
  }, [request]);
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Load the active audio source and seek to its cited segment.
  useEffect(() => {
    if (!active?.source || active.source.type !== "audio") {
      setLoadedSrc(null);
      return;
    }
    if (missing.has(active.sourceId)) {
      setLoadedSrc(null);
      return;
    }
    setLoadedSrc(audioUrl(kase.case_id, active.sourceId));
    const seg = active.source.segments.find((x) => x.seg_id === active.anchor);
    if (seg) {
      // seekToTime after the element mounts/loads
      requestAnimationFrame(() => playerRef.current?.seekToTime(seg.t0));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx, active?.sourceId]);

  const src = active?.source;

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-[60] flex items-center justify-center bg-[rgba(35,27,15,.44)] p-6 sm:p-9"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex h-[660px] max-h-full w-[940px] max-w-full flex-col overflow-hidden rounded-[18px] bg-surface-base shadow-[0_44px_100px_-30px_rgba(35,27,15,.6)]"
      >
        <div className="flex flex-none items-start justify-between gap-4 border-b border-surface-chromeline px-6 py-4">
          <div className="min-w-0">
            <div className="text-[11px] font-bold uppercase tracking-[.11em] text-ink-faint">
              Source for this fact
            </div>
            <div className="mt-1 text-[15px] font-semibold leading-snug text-ink-primary">
              {request.title}
            </div>
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="flex h-[34px] w-[34px] flex-none items-center justify-center rounded-[9px] border border-surface-overlay bg-surface-sunken text-[17px] text-ink-secondary hover:text-ink-primary"
          >
            ✕
          </button>
        </div>

        <div className="flex min-h-0 flex-1">
          {/* cited-sources list */}
          <div className="w-[238px] flex-none overflow-y-auto border-r border-surface-chromeline bg-surface-sunken p-3.5">
            <div className="px-1.5 pb-2.5 text-[10.5px] font-bold uppercase tracking-[.1em] text-ink-faint">
              Cited here
            </div>
            {entries.map((entry, i) => {
              const { glyph, audio } = glyphFor(entry.source);
              const on = i === idx;
              return (
                <button
                  key={entry.ref + i}
                  type="button"
                  onClick={() => setIdx(i)}
                  className={`mb-2 flex w-full items-center gap-2.5 rounded-[10px] border p-2.5 text-left ${
                    on ? "border-brand bg-surface-base" : "border-transparent"
                  }`}
                >
                  <span
                    className={`flex h-[26px] w-[26px] flex-none items-center justify-center text-[11px] ${
                      audio
                        ? "rounded-full bg-brand/14 text-brand-ink"
                        : "rounded-md bg-[#EBE4D6] text-ink-secondary"
                    }`}
                  >
                    {glyph}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[13px] font-semibold text-ink-primary">
                      {entry.source?.source_id ?? entry.sourceId}
                    </span>
                    <span className="mt-0.5 block truncate text-[11.5px] text-ink-dim">
                      {segSubtitle(entry)}
                    </span>
                  </span>
                </button>
              );
            })}
            {entries.length === 0 && (
              <p className="px-1.5 text-[12.5px] text-ink-ghost">No source on file.</p>
            )}
          </div>

          {/* rendered source */}
          <div className="flex min-w-0 flex-1 flex-col">
            {!src && (
              <div className="flex flex-1 items-center justify-center p-8 text-center text-[13.5px] text-ink-ghost">
                This fact is awaiting a source on file.
              </div>
            )}

            {src?.type === "audio" && (
              <>
                <div className="flex-none border-b border-surface-line px-6 py-4">
                  <div className="text-[15px] font-semibold text-ink-primary">
                    {src.source_id}
                  </div>
                  <div className="mt-0.5 text-[12.5px] text-ink-subtle">
                    recording · {src.segments.length} segments
                  </div>
                  {missing.has(src.source_id) ? (
                    <p className="mt-3 text-[12.5px] text-status-unsupported">
                      No rendered audio on file — showing the transcript only.
                    </p>
                  ) : (
                    <div className="mt-3">
                      <AudioPlayer
                        ref={playerRef}
                        src={loadedSrc}
                        label={src.source_id}
                        onTimeUpdate={setPlayerTime}
                        onError={() => {
                          setMissing((prev) => new Set(prev).add(src.source_id));
                          setLoadedSrc(null);
                        }}
                      />
                    </div>
                  )}
                </div>
                <div className="flex-1 overflow-y-auto px-6 py-4">
                  {src.segments.map((g) => {
                    const cited = g.seg_id === active.anchor;
                    const playing =
                      playerTime !== null && playerTime >= g.t0 && playerTime < g.t1;
                    const lit = cited || playing;
                    return (
                      <button
                        key={g.seg_id}
                        type="button"
                        onClick={() => playerRef.current?.seekToTime(g.t0)}
                        className={`mb-1 flex w-full gap-3.5 rounded-[9px] border-l-2 px-3 py-2.5 text-left ${
                          lit ? "border-brand bg-brand/10" : "border-transparent"
                        }`}
                      >
                        <span className="w-[52px] flex-none">
                          <span
                            className={`block text-[12.5px] font-semibold ${
                              lit ? "text-brand-ink" : "text-ink-dim"
                            }`}
                          >
                            {fmtTime(g.t0)}
                          </span>
                          <span
                            className={`mt-0.5 block text-[11px] ${
                              g.speaker.toLowerCase().includes("patient")
                                ? "text-brand-ink"
                                : "text-ink-faint"
                            }`}
                          >
                            {g.speaker}
                          </span>
                        </span>
                        <span
                          className={`flex-1 font-serif text-[16px] leading-relaxed ${
                            lit ? "text-ink-primary" : "text-ink-secondary"
                          }`}
                        >
                          {g.text}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </>
            )}

            {src?.type === "document" && (
              <>
                <div className="flex-none border-b border-surface-line px-6 py-4">
                  <div className="text-[15px] font-semibold text-ink-primary">
                    {src.source_id}
                  </div>
                  <div className="mt-0.5 text-[12.5px] text-ink-subtle">
                    document · {src.chunks.length} passages
                  </div>
                </div>
                <div className="flex-1 overflow-y-auto px-7 py-6">
                  <div className="max-w-[600px]">
                    {src.chunks.map((b, i) => {
                      const cited = b.chunk_id === active.anchor;
                      const prev = i > 0 ? src.chunks[i - 1] : null;
                      const showHead = b.section && b.section !== prev?.section;
                      return (
                        <div key={b.chunk_id}>
                          {showHead && (
                            <div className="mb-1.5 mt-5 text-[11.5px] font-bold uppercase tracking-[.09em] text-ink-faint">
                              {b.section}
                            </div>
                          )}
                          <div
                            className={`-mx-2 rounded-md px-2 py-1 font-serif text-[16.5px] leading-relaxed ${
                              cited
                                ? "bg-gold/25 shadow-[inset_3px_0_0_#c9a24a]"
                                : ""
                            } text-ink-body`}
                          >
                            {b.text}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
