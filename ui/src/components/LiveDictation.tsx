/**
 * Live intra-op dictation (v2 §2 stretch): the provider talks, the words
 * appear. Mic → 16 kHz PCM16 frames up the case's dictation WebSocket;
 * partial/final transcript events render as they arrive; stop saves the
 * session server-side exactly like a memo. Any failure — mic blocked, socket
 * refused, ASR down — degrades to the memo recorder via `onUnavailable`
 * (v2 §10 ladder): dictation is never the only way through the stage.
 */
import { useEffect, useRef, useState } from "react";
import { Mic, Square } from "lucide-react";
import { downsampleToPcm16 } from "../lib/pcm";

type Phase = "idle" | "connecting" | "dictating" | "saving";

function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function LiveDictation({
  caseId,
  providerId,
  onSaved,
  onUnavailable,
}: {
  caseId: string;
  providerId: string;
  onSaved: () => void;
  /** dictation cannot run here — the caller shows the memo recorder */
  onUnavailable: (reason: string) => void;
}) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [elapsed, setElapsed] = useState(0);
  const [partial, setPartial] = useState("");
  const [finals, setFinals] = useState<string[]>([]);

  const wsRef = useRef<WebSocket | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const contextRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const doneRef = useRef(false);

  function teardown() {
    if (timerRef.current) clearInterval(timerRef.current);
    processorRef.current?.disconnect();
    processorRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    void contextRef.current?.close()?.catch(() => {});
    contextRef.current = null;
  }

  useEffect(
    () => () => {
      doneRef.current = true;
      teardown();
      wsRef.current?.close();
    },
    [],
  );

  function fail(reason: string) {
    if (doneRef.current) return;
    doneRef.current = true;
    teardown();
    wsRef.current?.close();
    onUnavailable(reason);
  }

  async function start() {
    setPhase("connecting");
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      onUnavailable(
        "The microphone is unavailable or blocked — record a memo or upload audio instead.",
      );
      return;
    }
    streamRef.current = stream;

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(
      `${protocol}//${window.location.host}/api/cases/${encodeURIComponent(caseId)}` +
        `/sources/audio/stream?kind=intraop-notes&provider_id=${encodeURIComponent(providerId)}`,
    );
    wsRef.current = ws;

    ws.onopen = () => {
      const context = new AudioContext();
      contextRef.current = context;
      const source = context.createMediaStreamSource(stream);
      const processor = context.createScriptProcessor(4096, 1, 1);
      processorRef.current = processor;
      processor.onaudioprocess = (event) => {
        if (ws.readyState !== WebSocket.OPEN) return;
        const pcm = downsampleToPcm16(event.inputBuffer.getChannelData(0), context.sampleRate);
        ws.send(pcm.buffer);
      };
      source.connect(processor);
      processor.connect(context.destination); // required for processing to run
      setElapsed(0);
      timerRef.current = setInterval(() => setElapsed((s) => s + 1), 1000);
      setPhase("dictating");
    };

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data) as {
        type: string;
        text?: string;
        message?: string;
      };
      if (data.type === "partial") setPartial(data.text ?? "");
      if (data.type === "final") {
        setFinals((lines) => [...lines, data.text ?? ""]);
        setPartial("");
      }
      if (data.type === "error") {
        fail(`Live transcription failed (${data.message}) — record a memo instead.`);
      }
      if (data.type === "saved") {
        doneRef.current = true;
        teardown();
        onSaved();
      }
    };
    ws.onerror = () =>
      fail("Live transcription is unreachable — record a memo or upload audio instead.");
    ws.onclose = () => {
      if (!doneRef.current && phase !== "idle") {
        fail("The dictation connection closed — record a memo or upload audio instead.");
      }
    };
  }

  function stop() {
    if (timerRef.current) clearInterval(timerRef.current);
    processorRef.current?.disconnect();
    wsRef.current?.send(JSON.stringify({ type: "stop" }));
    setPhase("saving");
  }

  return (
    <div className="rounded border border-surface-overlay bg-surface-raised p-4">
      {phase === "dictating" ? (
        <button
          type="button"
          onClick={stop}
          data-primary-action
          className="flex min-h-[56px] w-full items-center justify-center gap-2 rounded bg-status-conflicting px-5 py-3 text-base font-semibold text-white"
        >
          <Square className="h-5 w-5" aria-hidden /> Stop dictating ·{" "}
          {formatElapsed(elapsed)}
        </button>
      ) : (
        <button
          type="button"
          disabled={phase !== "idle"}
          onClick={() => void start()}
          data-primary-action
          className="flex min-h-[56px] w-full items-center justify-center gap-2 rounded bg-brand px-5 py-3 text-base font-semibold text-white disabled:opacity-40"
        >
          <Mic className="h-5 w-5" aria-hidden />
          {phase === "saving"
            ? "Saving the dictation…"
            : phase === "connecting"
              ? "Connecting…"
              : "Start dictating"}
        </button>
      )}
      {(finals.length > 0 || partial) && (
        <div className="mt-3 space-y-1 text-sm" data-testid="live-transcript">
          {finals.map((line, i) => (
            <p key={i} className="text-ink-primary">
              {line}
            </p>
          ))}
          {partial && <p className="italic text-ink-subtle">{partial}</p>}
        </div>
      )}
      <p className="mt-3 text-center text-xs text-ink-subtle">
        Your words appear as you speak and are saved when you stop.
      </p>
    </div>
  );
}
