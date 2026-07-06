/**
 * Live intra-op dictation (v2 §2 stretch): mic → PCM frames up a WebSocket,
 * partial/final transcript lines straight back. Failures degrade to the memo
 * recorder (v2 §10 ladder) and never lose the workflow.
 */
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LiveDictation } from "../LiveDictation";

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  static OPEN = 1;
  url: string;
  readyState = 0;
  sent: (string | ArrayBuffer)[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }
  send(data: string | ArrayBuffer) {
    this.sent.push(data);
  }
  close() {
    this.readyState = 3;
  }
  // test helpers
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  message(payload: object) {
    this.onmessage?.({ data: JSON.stringify(payload) });
  }
}

class FakeProcessor {
  onaudioprocess: ((e: { inputBuffer: { getChannelData: () => Float32Array } }) => void) | null =
    null;
  connect = vi.fn();
  disconnect = vi.fn();
}

const processor = new FakeProcessor();

class FakeAudioContext {
  sampleRate = 48000;
  createMediaStreamSource = vi.fn(() => ({ connect: vi.fn(), disconnect: vi.fn() }));
  createScriptProcessor = vi.fn(() => processor);
  destination = {};
  close = vi.fn();
}

const track = { stop: vi.fn() };
const getUserMedia = vi.fn(async () => ({ getTracks: () => [track] }));

beforeEach(() => {
  FakeWebSocket.instances = [];
  vi.stubGlobal("WebSocket", FakeWebSocket);
  vi.stubGlobal("AudioContext", FakeAudioContext);
  Object.defineProperty(global.navigator, "mediaDevices", {
    value: { getUserMedia },
    configurable: true,
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

function renderDictation(overrides: Partial<Parameters<typeof LiveDictation>[0]> = {}) {
  const props = {
    caseId: "tkr-mrs-w",
    providerId: "p-tan",
    onSaved: vi.fn(),
    onUnavailable: vi.fn(),
    ...overrides,
  };
  render(<LiveDictation {...props} />);
  return props;
}

async function startDictating() {
  await userEvent.click(screen.getByRole("button", { name: /start dictating/i }));
  const ws = FakeWebSocket.instances[0];
  act(() => ws.open());
  return ws;
}

describe("LiveDictation", () => {
  it("start opens the case's dictation socket and shows the live transcript", async () => {
    renderDictation();
    const ws = await startDictating();
    expect(ws.url).toContain("/api/cases/tkr-mrs-w/sources/audio/stream");
    expect(ws.url).toContain("kind=intraop-notes");
    expect(ws.url).toContain("provider_id=p-tan");

    act(() => ws.message({ type: "partial", text: "Propofol one twenty…" }));
    expect(screen.getByText("Propofol one twenty…")).toBeInTheDocument();
    act(() => ws.message({ type: "final", text: "[08:02] Propofol one twenty milligrams.", t0: 0, t1: 1 }));
    expect(screen.getByText("[08:02] Propofol one twenty milligrams.")).toBeInTheDocument();
  });

  it("mic frames go up the socket as binary PCM", async () => {
    renderDictation();
    const ws = await startDictating();
    act(() =>
      processor.onaudioprocess?.({
        inputBuffer: { getChannelData: () => new Float32Array(4800) },
      }),
    );
    const binary = ws.sent.filter((m) => m instanceof ArrayBuffer) as ArrayBuffer[];
    expect(binary).toHaveLength(1);
    expect(binary[0].byteLength).toBe(1600 * 2); // 100 ms at 16 kHz PCM16
  });

  it("stop sends the stop message and saved hands back to the workflow", async () => {
    const props = renderDictation();
    const ws = await startDictating();
    await userEvent.click(screen.getByRole("button", { name: /stop dictating/i }));
    expect(ws.sent).toContainEqual(JSON.stringify({ type: "stop" }));
    act(() => ws.message({ type: "saved", segments: 1, source_id: "audio:intraop-notes" }));
    expect(props.onSaved).toHaveBeenCalled();
  });

  it("a blocked microphone degrades to the memo recorder with words", async () => {
    getUserMedia.mockRejectedValueOnce(new Error("denied"));
    const props = renderDictation();
    await userEvent.click(screen.getByRole("button", { name: /start dictating/i }));
    expect(props.onUnavailable).toHaveBeenCalled();
  });

  it("a server error mid-dictation degrades instead of hanging", async () => {
    const props = renderDictation();
    const ws = await startDictating();
    act(() => ws.message({ type: "error", message: "ASR unavailable" }));
    expect(props.onUnavailable).toHaveBeenCalled();
    expect(track.stop).toHaveBeenCalled();
  });
});
