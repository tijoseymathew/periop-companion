/**
 * Recorder (spec v2 §4.1 step 5, §6.5): one big labelled record button,
 * elapsed time while recording, stop → upload; failures keep the recording
 * and offer Retry. MediaRecorder is mocked — the state machine is the unit.
 */
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Recorder } from "../Recorder";

class FakeMediaRecorder {
  static instances: FakeMediaRecorder[] = [];
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  mimeType = "audio/webm";
  state = "inactive";
  constructor(public stream: MediaStream) {
    FakeMediaRecorder.instances.push(this);
  }
  start() {
    this.state = "recording";
  }
  stop() {
    this.state = "inactive";
    this.ondataavailable?.({ data: new Blob(["fake-audio"], { type: "audio/webm" }) });
    this.onstop?.();
  }
}

const fakeTrack = { stop: vi.fn() };

beforeEach(() => {
  FakeMediaRecorder.instances = [];
  vi.stubGlobal("MediaRecorder", FakeMediaRecorder);
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: {
      getUserMedia: vi.fn(async () => ({ getTracks: () => [fakeTrack] })),
    },
  });
});

afterEach(() => vi.unstubAllGlobals());

describe("Recorder", () => {
  it("records then uploads on stop", async () => {
    const onUpload = vi.fn(async () => {});
    render(<Recorder label="Record interview" filename="preop-interview" onUpload={onUpload} />);
    await userEvent.click(screen.getByRole("button", { name: /record interview/i }));
    expect(await screen.findByRole("button", { name: /stop/i })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /stop/i }));
    await waitFor(() => expect(onUpload).toHaveBeenCalled());
    const file = (onUpload.mock.calls as unknown as [File][])[0][0];
    expect(file.name).toContain("preop-interview");
  });

  it("shows elapsed time while recording", async () => {
    vi.useFakeTimers();
    try {
      const { unmount } = render(
        <Recorder label="Record interview" filename="preop-interview" onUpload={vi.fn(async () => {})} />,
      );
      const btn = screen.getByRole("button", { name: /record interview/i });
      await act(async () => {
        btn.click();
      });
      await act(async () => {
        vi.advanceTimersByTime(65_000);
      });
      expect(screen.getByText(/1:05/)).toBeInTheDocument();
      unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it("failed upload keeps the recording and offers Retry (v2 §6.7)", async () => {
    const onUpload = vi
      .fn(async () => {})
      .mockRejectedValueOnce(new Error("network down"));
    render(<Recorder label="Record interview" filename="preop-interview" onUpload={onUpload} />);
    await userEvent.click(screen.getByRole("button", { name: /record interview/i }));
    await userEvent.click(screen.getByRole("button", { name: /stop/i }));
    expect(await screen.findByText(/kept on this device/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /retry/i }));
    await waitFor(() => expect(onUpload).toHaveBeenCalledTimes(2));
  });

  it("offers a labelled file-upload fallback", async () => {
    const onUpload = vi.fn(async () => {});
    render(<Recorder label="Record interview" filename="preop-interview" onUpload={onUpload} />);
    const file = new File(["wav-bytes"], "interview.wav", { type: "audio/wav" });
    await userEvent.upload(screen.getByLabelText(/upload audio/i), file);
    expect(onUpload).toHaveBeenCalledWith(file);
  });

  it("microphone refusal says what to do", async () => {
    (navigator.mediaDevices.getUserMedia as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("denied"),
    );
    render(<Recorder label="Record interview" filename="preop-interview" onUpload={vi.fn(async () => {})} />);
    await userEvent.click(screen.getByRole("button", { name: /record interview/i }));
    expect(await screen.findByText(/microphone/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/upload audio/i)).toBeInTheDocument();
  });
});
