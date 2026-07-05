/**
 * Clip logic against a mocked media element — jsdom has no real audio
 * (ui.md §10). `playClip(t0, t1)` must seek, play, and auto-pause at t1 via
 * timeupdate; a visible clip marker shows while a clip is active.
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AudioPlayer, type AudioPlayerHandle } from "../AudioPlayer";

function mockReadyState(value: number) {
  Object.defineProperty(window.HTMLMediaElement.prototype, "readyState", {
    configurable: true,
    get: () => value,
  });
}

beforeEach(() => {
  window.HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined);
  window.HTMLMediaElement.prototype.pause = vi.fn();
  mockReadyState(1); // HAVE_METADATA by default; individual tests override
});

afterEach(() => {
  vi.restoreAllMocks();
});

function setup(src: string | null = "/api/cases/sg-t/audio/audio%3Apreop-interview") {
  const ref = createRef<AudioPlayerHandle>();
  const onTimeUpdate = vi.fn();
  const onError = vi.fn();
  const utils = render(
    <AudioPlayer
      ref={ref}
      src={src}
      label={src ? "audio:preop-interview" : null}
      onTimeUpdate={onTimeUpdate}
      onError={onError}
    />,
  );
  const audio = utils.container.querySelector("audio");
  return { ref, audio, onTimeUpdate, onError, ...utils };
}

describe("AudioPlayer", () => {
  it("shows which recording is loaded", () => {
    setup();
    expect(screen.getByText("audio:preop-interview")).toBeInTheDocument();
  });

  it("seekToTime seeks the underlying element", () => {
    const { ref, audio } = setup();
    act(() => ref.current!.seekToTime(42.5));
    expect(audio!.currentTime).toBe(42.5);
  });

  it("playClip seeks to t0 and plays", () => {
    const { ref, audio } = setup();
    act(() => ref.current!.playClip(214.3, 221.8));
    expect(audio!.currentTime).toBe(214.3);
    expect(audio!.play).toHaveBeenCalled();
  });

  it("playClip auto-pauses at t1 via timeupdate, not before", () => {
    const { ref, audio } = setup();
    act(() => ref.current!.playClip(214.3, 221.8));
    audio!.currentTime = 218.0;
    fireEvent(audio!, new Event("timeupdate"));
    expect(audio!.pause).not.toHaveBeenCalled();
    audio!.currentTime = 221.9;
    fireEvent(audio!, new Event("timeupdate"));
    expect(audio!.pause).toHaveBeenCalled();
  });

  it("defers playClip until metadata loads when the wav is still loading", () => {
    mockReadyState(0); // HAVE_NOTHING
    const { ref, audio } = setup();
    act(() => ref.current!.playClip(10, 12));
    expect(audio!.play).not.toHaveBeenCalled();
    mockReadyState(1);
    fireEvent(audio!, new Event("loadedmetadata"));
    expect(audio!.currentTime).toBe(10);
    expect(audio!.play).toHaveBeenCalled();
  });

  it("shows a clip-region marker while a clip is active and clears it after", () => {
    Object.defineProperty(window.HTMLMediaElement.prototype, "duration", {
      configurable: true,
      get: () => 300,
    });
    const { ref, audio } = setup();
    fireEvent(audio!, new Event("loadedmetadata"));
    act(() => ref.current!.playClip(150, 225));
    const marker = screen.getByTestId("clip-marker");
    expect(marker.style.left).toBe("50%");
    expect(marker.style.width).toBe("25%");
    // clip completes → marker gone
    audio!.currentTime = 225.1;
    fireEvent(audio!, new Event("timeupdate"));
    expect(screen.queryByTestId("clip-marker")).not.toBeInTheDocument();
  });

  it("reports playback position and surfaces media errors", () => {
    const { audio, onTimeUpdate, onError } = setup();
    audio!.currentTime = 33.3;
    fireEvent(audio!, new Event("timeupdate"));
    expect(onTimeUpdate).toHaveBeenCalledWith(33.3);
    fireEvent(audio!, new Event("error"));
    expect(onError).toHaveBeenCalled();
  });

  it("renders an idle hint when nothing is loaded", () => {
    setup(null);
    expect(screen.getByText(/no recording loaded/i)).toBeInTheDocument();
  });
});
