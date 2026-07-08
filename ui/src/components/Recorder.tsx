/**
 * Audio capture (spec v2 §4.1 step 5, §6.5): one big labelled record button,
 * elapsed time, stop → upload; the recording is kept on this device until the
 * upload confirms, and failures offer Retry (v2 §6.7, §10). File upload is the
 * always-works fallback. The "primary" variant is the unmissable pre-op record
 * button from the imported design; "compact" is the intra-op fallback control.
 */
import { useEffect, useRef, useState } from "react";
import { Mic, Square } from "lucide-react";

type Phase = "idle" | "recording" | "uploading" | "failed";

function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

// deterministic waveform bar heights (visual only)
const WAVE = Array.from({ length: 48 }, (_, i) =>
  Math.min(46, Math.max(8, Math.round(18 + 24 * Math.abs(Math.sin(i * 0.7) + 0.5 * Math.sin(i * 0.31 + 1))))),
);

export function Recorder({
  label,
  filename,
  onUpload,
  variant = "compact",
}: {
  label: string;
  filename: string;
  onUpload: (file: File) => Promise<void>;
  variant?: "primary" | "compact";
}) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [elapsed, setElapsed] = useState(0);
  const [problem, setProblem] = useState<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const pendingRef = useRef<File | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(
    () => () => {
      if (timerRef.current) clearInterval(timerRef.current);
    },
    [],
  );

  async function send(file: File) {
    pendingRef.current = file; // kept until the upload confirms
    setPhase("uploading");
    setProblem(null);
    try {
      await onUpload(file);
      pendingRef.current = null;
      setPhase("idle");
    } catch (e) {
      const detail =
        (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ??
        (e as Error).message;
      setProblem(`Upload failed (${detail}) — the recording is kept on this device; tap Retry.`);
      setPhase("failed");
    }
  }

  async function start() {
    setProblem(null);
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setProblem(
        "The microphone is unavailable or blocked — allow microphone access in the browser, or use Upload audio below.",
      );
      return;
    }
    const recorder = new MediaRecorder(stream);
    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => chunks.push(e.data);
    recorder.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      if (timerRef.current) clearInterval(timerRef.current);
      const blob = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
      void send(new File([blob], `${filename}.webm`, { type: blob.type }));
    };
    recorderRef.current = recorder;
    setElapsed(0);
    timerRef.current = setInterval(() => setElapsed((s) => s + 1), 1000);
    recorder.start();
    setPhase("recording");
  }

  const uploadFallback = (
    <label className="mt-3 block cursor-pointer text-center text-sm text-ink-secondary underline">
      or upload audio (.wav, .webm, .m4a, .mp3)
      <input
        type="file"
        accept="audio/*,.wav,.webm,.m4a,.mp3"
        className="sr-only"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void send(file);
          e.target.value = "";
        }}
      />
    </label>
  );

  if (variant === "primary") {
    const recording = phase === "recording";
    return (
      <div className="flex w-full flex-col items-center gap-6 py-6">
        {recording && (
          <div className="flex items-center gap-2 font-mono text-[15px] text-status-conflicting">
            <span className="h-2.5 w-2.5 rounded-full bg-status-conflicting" /> RECORDING
          </div>
        )}
        <div className="font-mono text-6xl font-medium tracking-wide">{formatElapsed(elapsed)}</div>
        <div className="flex h-16 w-[420px] max-w-[80%] items-end gap-[3px]">
          {WAVE.map((h, i) => (
            <div
              key={i}
              className={`flex-1 rounded-sm ${recording ? "animate-barflow bg-[#3f5563]" : "bg-surface-line"}`}
              style={{ height: `${h}px` }}
            />
          ))}
        </div>
        {phase === "failed" ? (
          <button
            type="button"
            data-primary-action
            onClick={() => pendingRef.current && send(pendingRef.current)}
            className="min-h-[56px] rounded-lg bg-brand px-8 py-3 text-base font-semibold text-ink-onBrand"
          >
            Retry upload
          </button>
        ) : recording ? (
          <button
            type="button"
            data-primary-action
            onClick={() => recorderRef.current?.stop()}
            className="flex h-28 w-28 animate-recPulse items-center justify-center rounded-full bg-status-conflicting"
            aria-label="stop recording"
          >
            <span className="h-9 w-9 rounded-lg bg-white" />
          </button>
        ) : (
          <button
            type="button"
            data-primary-action
            disabled={phase === "uploading"}
            onClick={start}
            className="flex h-28 w-28 items-center justify-center rounded-full bg-brand disabled:opacity-40"
            aria-label={label}
          >
            <Mic className="h-10 w-10 text-ink-onBrand" aria-hidden />
          </button>
        )}
        <div className="text-sm text-ink-secondary">
          {phase === "uploading"
            ? "Uploading…"
            : recording
              ? "Tap the square to stop"
              : label}
        </div>
        {problem && <p className="text-sm text-status-conflicting">{problem}</p>}
        <div className="w-full max-w-sm">{uploadFallback}</div>
      </div>
    );
  }

  return (
    <div className="w-full rounded-xl border border-surface-line bg-surface-raised p-4">
      {phase === "recording" ? (
        <button
          type="button"
          onClick={() => recorderRef.current?.stop()}
          data-primary-action
          className="flex min-h-[56px] w-full items-center justify-center gap-2 rounded-lg bg-status-conflicting px-5 py-3 text-base font-semibold text-white"
        >
          <Square className="h-5 w-5" aria-hidden /> Stop recording · {formatElapsed(elapsed)}
        </button>
      ) : phase === "failed" ? (
        <button
          type="button"
          onClick={() => pendingRef.current && send(pendingRef.current)}
          data-primary-action
          className="flex min-h-[56px] w-full items-center justify-center gap-2 rounded-lg bg-brand px-5 py-3 text-base font-semibold text-ink-onBrand"
        >
          Retry upload
        </button>
      ) : (
        <button
          type="button"
          disabled={phase === "uploading"}
          onClick={start}
          data-primary-action
          className="flex min-h-[56px] w-full items-center justify-center gap-2 rounded-lg bg-brand px-5 py-3 text-base font-semibold text-ink-onBrand disabled:opacity-40"
        >
          <Mic className="h-5 w-5" aria-hidden />
          {phase === "uploading" ? "Uploading…" : label}
        </button>
      )}
      {problem && <p className="mt-2 text-sm text-status-conflicting">{problem}</p>}
      {uploadFallback}
    </div>
  );
}
