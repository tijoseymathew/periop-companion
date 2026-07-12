/**
 * Microphone capture for the record buttons (design: "Record or upload").
 * A thin MediaRecorder wrapper: start → elapsed seconds tick → stop hands the
 * finished take to the caller as a File, which goes up the same upload path
 * as a dropped audio file (the backend normalizes webm/opus to wav).
 */
import { useEffect, useRef, useState } from "react";

export type RecorderState = "idle" | "recording";

export interface Recorder {
  state: RecorderState;
  seconds: number;
  /** null until getUserMedia fails — a plain sentence for the screen */
  error: string | null;
  start: () => Promise<void>;
  stop: () => void;
}

export function useRecorder(onFinish: (file: File) => void): Recorder {
  const [state, setState] = useState<RecorderState>("idle");
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const ticker = useRef<ReturnType<typeof setInterval> | null>(null);
  const finish = useRef(onFinish);
  finish.current = onFinish;

  useEffect(
    () => () => {
      // unmount mid-recording: stop the mic, drop the take
      if (ticker.current) clearInterval(ticker.current);
      const rec = recorder.current;
      if (rec && rec.state !== "inactive") {
        rec.ondataavailable = null;
        rec.onstop = null;
        rec.stop();
        rec.stream.getTracks().forEach((t) => t.stop());
      }
    },
    [],
  );

  async function start() {
    setError(null);
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setError("Microphone unavailable — check permissions, or upload an audio file instead.");
      return;
    }
    const mimeType = MediaRecorder.isTypeSupported?.("audio/webm") ? "audio/webm" : undefined;
    const rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };
    rec.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      const type = rec.mimeType || "audio/webm";
      const ext = type.includes("ogg") ? "ogg" : type.includes("mp4") ? "m4a" : "webm";
      finish.current(new File(chunks, `recording.${ext}`, { type }));
    };
    recorder.current = rec;
    rec.start();
    setSeconds(0);
    setState("recording");
    ticker.current = setInterval(() => setSeconds((s) => s + 1), 1000);
  }

  function stop() {
    if (ticker.current) clearInterval(ticker.current);
    ticker.current = null;
    const rec = recorder.current;
    if (rec && rec.state !== "inactive") rec.stop();
    recorder.current = null;
    setState("idle");
  }

  return { state, seconds, error, start, stop };
}

/** mm:ss for the elapsed-time display. */
export function clock(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}
