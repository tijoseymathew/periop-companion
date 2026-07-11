/**
 * Custom chrome over a hidden `<audio preload="metadata">` (ui.md §5.4).
 * Imperative `seekToTime` / `playClip(t0, t1)` via useImperativeHandle —
 * the working pattern adapted from the ambient-provider blueprint's
 * AudioPlayer (Apache-2.0; see docs/attribution.md). New here: clip playback
 * with timeupdate auto-pause, a clip-region marker, and a source label.
 */
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type ChangeEvent,
  type MouseEvent,
} from "react";
import { Pause, Play, RotateCcw, Volume2 } from "lucide-react";

export interface AudioPlayerHandle {
  seekToTime(seconds: number): void;
  playClip(t0: number, t1: number): void;
}

interface AudioPlayerProps {
  /** wav URL, or null when no recording is loaded. */
  src: string | null;
  /** Which of the case's recordings is loaded (source_id). */
  label: string | null;
  /**
   * Seek here once `src`'s metadata is ready — declarative, for "open
   * already pointed at the cited moment" (e.g. SourceModal). Distinct from
   * the imperative seekToTime handle below, which a user's own click (e.g.
   * a transcript segment) drives and never races the mount, since the
   * element already exists by the time that fires.
   */
  seekTo?: number | null;
  onTimeUpdate?: (seconds: number) => void;
  onError?: () => void;
}

const SPEEDS = [0.75, 1, 1.25, 1.5, 2];

function fmt(seconds: number): string {
  if (!Number.isFinite(seconds)) return "--:--";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export const AudioPlayer = forwardRef<AudioPlayerHandle, AudioPlayerProps>(function AudioPlayer(
  { src, label, seekTo = null, onTimeUpdate, onError },
  ref,
) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const pendingClipRef = useRef<{ t0: number; t1: number } | null>(null);
  const pendingSeekRef = useRef<number | null>(null);
  const [clip, setClip] = useState<{ t0: number; t1: number } | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(NaN);
  const [paused, setPaused] = useState(true);

  // runs after the DOM has the current `src`'s <audio> element mounted
  // (unlike an imperative ref call from the parent, which can fire before
  // it exists), so the provenance jump on open is never silently dropped
  useEffect(() => {
    // clear any still-pending seek from a previous src/seekTo pair first, so
    // a stale target can't land on loadedmetadata for a source it wasn't for
    pendingSeekRef.current = null;
    const el = audioRef.current;
    if (!el || seekTo == null) return;
    if (el.readyState >= 1) {
      el.currentTime = seekTo;
      setCurrentTime(seekTo);
    } else {
      pendingSeekRef.current = seekTo;
    }
  }, [src, seekTo]);

  function startClip(el: HTMLAudioElement, t0: number, t1: number) {
    el.currentTime = t0;
    setCurrentTime(t0);
    setClip({ t0, t1 });
    // jsdom's play() is unimplemented and may return undefined
    Promise.resolve(el.play()).catch(() => undefined);
  }

  useImperativeHandle(ref, () => ({
    seekToTime(seconds: number) {
      const el = audioRef.current;
      if (!el) return;
      setClip(null);
      // a fresh `src` hasn't loaded metadata yet (readyState 0) — setting
      // currentTime now is silently reset to 0 once it does, so the
      // provenance jump would land back at the start; queue it instead,
      // same as playClip's pendingClipRef below
      if (el.readyState >= 1) {
        el.currentTime = seconds;
        setCurrentTime(seconds);
      } else {
        pendingSeekRef.current = seconds;
      }
    },
    playClip(t0: number, t1: number) {
      const el = audioRef.current;
      if (!el) return;
      if (el.readyState >= 1) startClip(el, t0, t1);
      else pendingClipRef.current = { t0, t1 }; // applied on loadedmetadata
    },
  }));

  function handleTimeUpdate() {
    const el = audioRef.current;
    if (!el) return;
    setCurrentTime(el.currentTime);
    onTimeUpdate?.(el.currentTime);
    if (clip && el.currentTime >= clip.t1) {
      el.pause();
      setClip(null);
    }
  }

  function handleLoadedMetadata() {
    const el = audioRef.current;
    if (!el) return;
    setDuration(el.duration);
    const pendingClip = pendingClipRef.current;
    if (pendingClip) {
      pendingClipRef.current = null;
      pendingSeekRef.current = null;
      startClip(el, pendingClip.t0, pendingClip.t1);
      return;
    }
    const pendingSeek = pendingSeekRef.current;
    if (pendingSeek !== null) {
      pendingSeekRef.current = null;
      el.currentTime = pendingSeek;
      setCurrentTime(pendingSeek);
    }
  }

  function handleBarClick(e: MouseEvent<HTMLDivElement>) {
    const el = audioRef.current;
    if (!el || !Number.isFinite(duration)) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const frac = (e.clientX - rect.left) / rect.width;
    setClip(null);
    el.currentTime = frac * duration;
    setCurrentTime(el.currentTime);
  }

  const progress = Number.isFinite(duration) && duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div className="flex h-40 shrink-0 flex-col justify-center gap-2 border-b border-surface-overlay px-4 py-3">
      {src ? (
        <>
          <audio
            ref={audioRef}
            className="hidden"
            preload="metadata"
            src={src}
            onTimeUpdate={handleTimeUpdate}
            onLoadedMetadata={handleLoadedMetadata}
            onPlay={() => setPaused(false)}
            onPause={() => setPaused(true)}
            onError={() => onError?.()}
          />
          <div className="truncate font-mono text-xs text-ink-secondary" title={label ?? undefined}>
            {label}
          </div>
          <div
            data-testid="progress-bar"
            onClick={handleBarClick}
            className="relative h-2 cursor-pointer rounded bg-surface-overlay"
          >
            {clip && Number.isFinite(duration) && duration > 0 && (
              <div
                data-testid="clip-marker"
                className="absolute inset-y-0 rounded bg-brand/30 ring-1 ring-brand"
                style={{
                  left: `${(clip.t0 / duration) * 100}%`,
                  width: `${((clip.t1 - clip.t0) / duration) * 100}%`,
                }}
              />
            )}
            <div className="absolute inset-y-0 left-0 rounded bg-brand" style={{ width: `${progress}%` }} />
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              aria-label={paused ? "play" : "pause"}
              onClick={() => {
                const el = audioRef.current;
                if (!el) return;
                if (el.paused) Promise.resolve(el.play()).catch(() => undefined);
                else el.pause();
              }}
              className="rounded-full bg-brand p-1.5 text-ink-onBrand hover:bg-brand-soft"
            >
              {paused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
            </button>
            <button
              type="button"
              aria-label="reset"
              onClick={() => {
                const el = audioRef.current;
                if (!el) return;
                setClip(null);
                el.currentTime = 0;
                setCurrentTime(0);
              }}
              className="rounded p-1 text-ink-secondary hover:text-ink-primary"
            >
              <RotateCcw className="h-4 w-4" />
            </button>
            <span className="font-mono text-xs text-ink-secondary">
              {fmt(currentTime)} / {fmt(duration)}
            </span>
            <select
              aria-label="playback speed"
              defaultValue="1"
              onChange={(e: ChangeEvent<HTMLSelectElement>) => {
                if (audioRef.current) audioRef.current.playbackRate = Number(e.target.value);
              }}
              className="ml-auto rounded border border-surface-overlay bg-surface-raised px-1 py-0.5 text-xs"
            >
              {SPEEDS.map((s) => (
                <option key={s} value={s}>
                  {s}×
                </option>
              ))}
            </select>
            <Volume2 className="h-4 w-4 text-ink-subtle" aria-hidden />
            <input
              type="range"
              aria-label="volume"
              min={0}
              max={1}
              step={0.05}
              defaultValue={1}
              onChange={(e: ChangeEvent<HTMLInputElement>) => {
                if (audioRef.current) audioRef.current.volume = Number(e.target.value);
              }}
              className="w-16 accent-brand"
            />
          </div>
        </>
      ) : (
        <p className="text-sm text-ink-subtle">
          No recording loaded — click a claim with an audio citation.
        </p>
      )}
    </div>
  );
});
