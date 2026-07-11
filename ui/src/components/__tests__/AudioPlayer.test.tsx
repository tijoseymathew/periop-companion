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

  it("defers seekToTime until metadata loads when the wav is still loading", () => {
    // reproduces the provenance-jump bug: switching SourceModal to a new
    // audio source seeks before the fresh src has loaded metadata
    mockReadyState(0); // HAVE_NOTHING
    const { ref, audio } = setup();
    act(() => ref.current!.seekToTime(96.4));
    expect(audio!.currentTime).toBe(0); // not applied yet
    mockReadyState(1);
    fireEvent(audio!, new Event("loadedmetadata"));
    expect(audio!.currentTime).toBe(96.4);
  });

  it("applies seekTo once the element mounts, even though it didn't exist when src went from null to a URL", () => {
    // reproduces the actual SourceModal bug: the modal opens with src=null
    // (no <audio> in the DOM yet), then an effect sets a real src — a ref
    // call made at that same moment can fire before the element exists and
    // silently no-op; seekTo is a declarative prop instead, applied by an
    // effect inside AudioPlayer itself once its own element is there.
    mockReadyState(0); // HAVE_NOTHING — metadata not loaded on the new src yet
    const onTimeUpdate = vi.fn();
    const { rerender, container } = render(
      <AudioPlayer ref={null} src={null} seekTo={null} label={null} onTimeUpdate={onTimeUpdate} />,
    );
    expect(container.querySelector("audio")).toBeNull();

    rerender(
      <AudioPlayer
        ref={null}
        src="/api/cases/sg-t/audio/audio%3Apreop-interview"
        seekTo={214.3}
        label="audio:preop-interview"
        onTimeUpdate={onTimeUpdate}
      />,
    );
    const audio = container.querySelector("audio")!;
    expect(audio.currentTime).toBe(0); // not applied yet — metadata still loading

    mockReadyState(1);
    fireEvent(audio, new Event("loadedmetadata"));
    expect(audio.currentTime).toBe(214.3);
  });

  it("clears a stale pending seekTo when the src changes again before metadata lands", () => {
    mockReadyState(0);
    const { rerender, container } = render(
      <AudioPlayer ref={null} src="/audio/a" seekTo={10} label="a" />,
    );
    // switch to a different source (and a different citation) before "a"
    // ever finished loading — the pending seek for "a" must not leak onto "b"
    rerender(<AudioPlayer ref={null} src="/audio/b" seekTo={null} label="b" />);
    const audio = container.querySelector("audio")!;
    mockReadyState(1);
    fireEvent(audio, new Event("loadedmetadata"));
    expect(audio.currentTime).toBe(0);
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
