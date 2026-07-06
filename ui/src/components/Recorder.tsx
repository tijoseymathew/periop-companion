/**
 * Audio capture (spec v2 §4.1 step 5, §6.5): one big labelled record button,
 * elapsed time, stop → upload; the recording is kept on this device until
 * the upload confirms, and failures offer Retry (v2 §6.7, §10). File upload
 * is the always-works fallback.
 */
import { useEffect, useRef, useState } from "react";
import { Mic, Square } from "lucide-react";

type Phase = "idle" | "recording" | "uploading" | "failed";

function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function Recorder({
  label,
  filename,
  onUpload,
}: {
  label: string;
  filename: string;
  onUpload: (file: File) => Promise<void>;
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
      setProblem(
        `Upload failed (${detail}) — the recording is kept on this device; tap Retry.`,
      );
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

  return (
    <div className="rounded border border-surface-overlay bg-surface-raised p-4">
      {phase === "recording" ? (
        <button
          type="button"
          onClick={() => recorderRef.current?.stop()}
          data-primary-action
          className="flex min-h-[56px] w-full items-center justify-center gap-2 rounded bg-status-conflicting px-5 py-3 text-base font-semibold text-white"
        >
          <Square className="h-5 w-5" aria-hidden /> Stop recording · {formatElapsed(elapsed)}
        </button>
      ) : phase === "failed" ? (
        <button
          type="button"
          onClick={() => pendingRef.current && send(pendingRef.current)}
          data-primary-action
          className="flex min-h-[56px] w-full items-center justify-center gap-2 rounded bg-brand px-5 py-3 text-base font-semibold text-white"
        >
          Retry upload
        </button>
      ) : (
        <button
          type="button"
          disabled={phase === "uploading"}
          onClick={start}
          data-primary-action
          className="flex min-h-[56px] w-full items-center justify-center gap-2 rounded bg-brand px-5 py-3 text-base font-semibold text-white disabled:opacity-40"
        >
          <Mic className="h-5 w-5" aria-hidden />
          {phase === "uploading" ? "Uploading…" : label}
        </button>
      )}
      {problem && <p className="mt-2 text-sm text-status-conflicting">{problem}</p>}
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
    </div>
  );
}
