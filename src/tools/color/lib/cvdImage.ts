import { MACHADO_2009, linearToSrgb, srgbToLinear, type VisionType } from './cvd';

/** sRGB 8-bit value → linear light. */
const TO_LINEAR = Float32Array.from({ length: 256 }, (_, i) => srgbToLinear(i / 255));
/** Linear light (quantized to 1/4096) → sRGB 8-bit value; accurate to ±1 level. */
const LUT_STEPS = 4096;
const TO_SRGB = Uint8ClampedArray.from({ length: LUT_STEPS + 1 }, (_, i) => Math.round(linearToSrgb(i / LUT_STEPS) * 255));

const encode = (v: number) => TO_SRGB[v <= 0 ? 0 : v >= 1 ? LUT_STEPS : Math.round(v * LUT_STEPS)];

/**
 * Applies the same simulation as `simulate()` to RGBA pixels (e.g. `ImageData.data`): Machado et al. (2009)
 * matrices in linear RGB for dichromacy, Rec. 709 luminance for achromatopsia. Alpha is copied unchanged.
 * Processes the byte range [from, to) so callers can split large images into chunks.
 */
export function simulatePixels(src: Uint8ClampedArray, type: VisionType, out: Uint8ClampedArray, from = 0, to = src.length): void {
  if (type === 'normal') {
    out.set(src.subarray(from, to), from);
    return;
  }
  const m = type === 'achromatopsia' ? null : MACHADO_2009[type];
  for (let i = from; i < to; i += 4) {
    const r = TO_LINEAR[src[i]];
    const g = TO_LINEAR[src[i + 1]];
    const b = TO_LINEAR[src[i + 2]];
    if (m) {
      out[i] = encode(m[0][0] * r + m[0][1] * g + m[0][2] * b);
      out[i + 1] = encode(m[1][0] * r + m[1][1] * g + m[1][2] * b);
      out[i + 2] = encode(m[2][0] * r + m[2][1] * g + m[2][2] * b);
    } else {
      const y = encode(0.2126 * r + 0.7152 * g + 0.0722 * b);
      out[i] = y;
      out[i + 1] = y;
      out[i + 2] = y;
    }
    out[i + 3] = src[i + 3];
  }
}

/** Largest side, in pixels, that images are simulated at (bigger images are scaled down first). */
export const MAX_IMAGE_SIDE = 2400;

/** Size an image is simulated at: scaled down (keeping the aspect ratio) so neither side exceeds `max`. */
export function fitSize(width: number, height: number, max = MAX_IMAGE_SIDE): { width: number; height: number; scaled: boolean } {
  const scale = Math.min(1, max / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)), scaled: scale < 1 };
}
