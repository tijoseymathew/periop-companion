/**
 * Browser audio → dictation-socket audio (v2 §2 stretch).
 *
 * The AudioContext hands out Float32 frames at the hardware rate (usually
 * 48 kHz); the streaming ASR path speaks 16 kHz PCM16 mono. Linear-interp
 * resample + clamp + quantize, pure and testable.
 */

export const TARGET_RATE = 16000;

export function downsampleToPcm16(
  input: Float32Array,
  fromRate: number,
  toRate: number = TARGET_RATE,
): Int16Array {
  const ratio = fromRate / toRate;
  const length = Math.floor(input.length / ratio);
  const out = new Int16Array(length);
  for (let i = 0; i < length; i++) {
    const pos = i * ratio;
    const left = Math.floor(pos);
    const right = Math.min(left + 1, input.length - 1);
    const frac = pos - left;
    const sample = input[left] * (1 - frac) + input[right] * frac;
    const clamped = Math.max(-1, Math.min(1, sample));
    out[i] = Math.round(clamped * (clamped < 0 ? 32768 : 32767));
  }
  return out;
}
