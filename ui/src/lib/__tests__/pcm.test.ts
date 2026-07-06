/**
 * Browser audio arrives as Float32 at the AudioContext rate (usually 48 kHz);
 * the dictation socket wants 16 kHz PCM16 mono. Pure resample + quantize.
 */
import { describe, expect, it } from "vitest";
import { downsampleToPcm16 } from "../pcm";

describe("downsampleToPcm16", () => {
  it("resamples 48 kHz down to a third of the samples", () => {
    const input = new Float32Array(4800); // 100 ms at 48 kHz
    const out = downsampleToPcm16(input, 48000);
    expect(out.length).toBe(1600); // 100 ms at 16 kHz
  });

  it("keeps a linear ramp linear and scales to int16", () => {
    const input = Float32Array.from({ length: 480 }, (_, i) => i / 480);
    const out = downsampleToPcm16(input, 48000);
    expect(out[0]).toBe(0);
    // half way up the ramp ≈ half of int16 max
    const mid = out[Math.floor(out.length / 2)];
    expect(Math.abs(mid - 16384)).toBeLessThan(400);
  });

  it("clamps out-of-range samples instead of wrapping", () => {
    const out = downsampleToPcm16(Float32Array.from([1.5, -1.5]), 16000);
    expect(out[0]).toBe(32767);
    expect(out[1]).toBe(-32768);
  });

  it("passes a matching rate through sample-for-sample", () => {
    const input = Float32Array.from([0, 0.5, -0.5]);
    const out = downsampleToPcm16(input, 16000);
    expect(out.length).toBe(3);
    expect(out[1]).toBe(16384); // round(0.5 × 32767)
  });
});
