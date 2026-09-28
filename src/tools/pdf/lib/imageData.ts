/**
 * Conversion of pdf.js decoded image objects to RGBA pixels, plus a cheap
 * content hash for de-duplication. Pure functions (unit tested).
 */

/** pdf.js ImageKind values. */
export const IMAGE_KIND = { GRAYSCALE_1BPP: 1, RGB_24BPP: 2, RGBA_32BPP: 3 } as const;

export interface RawImage {
  width: number;
  height: number;
  kind?: number;
  data?: Uint8Array | Uint8ClampedArray;
}

/** Expand pdf.js image data to RGBA. Returns null for unknown layouts. */
export function toRgba(img: RawImage): Uint8ClampedArray | null {
  const { width, height, kind, data } = img;
  if (!data || width < 1 || height < 1) return null;
  const pixels = width * height;
  const out = new Uint8ClampedArray(pixels * 4);
  if (kind === IMAGE_KIND.RGBA_32BPP) {
    if (data.length < pixels * 4) return null;
    out.set(data.subarray(0, pixels * 4));
    return out;
  }
  if (kind === IMAGE_KIND.RGB_24BPP) {
    if (data.length < pixels * 3) return null;
    for (let i = 0, j = 0; i < pixels; i++, j += 3) {
      const o = i * 4;
      out[o] = data[j];
      out[o + 1] = data[j + 1];
      out[o + 2] = data[j + 2];
      out[o + 3] = 255;
    }
    return out;
  }
  if (kind === IMAGE_KIND.GRAYSCALE_1BPP) {
    // Rows are padded to whole bytes; a set bit is white (as pdf.js paints it).
    const rowBytes = (width + 7) >> 3;
    if (data.length < rowBytes * height) return null;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const bit = (data[y * rowBytes + (x >> 3)] >> (7 - (x & 7))) & 1;
        const o = (y * width + x) * 4;
        const v = bit ? 255 : 0;
        out[o] = v;
        out[o + 1] = v;
        out[o + 2] = v;
        out[o + 3] = 255;
      }
    }
    return out;
  }
  return null;
}

/** FNV-1a over a strided sample of the pixels plus the dimensions: fast and good enough to spot duplicates. */
export function pixelHash(width: number, height: number, rgba: ArrayLike<number>): string {
  let h = 0x811c9dc5;
  const mix = (v: number) => {
    h ^= v & 0xff;
    h = Math.imul(h, 0x01000193) >>> 0;
  };
  mix(width);
  mix(width >> 8);
  mix(height);
  mix(height >> 8);
  const step = Math.max(1, Math.floor(rgba.length / 65536));
  for (let i = 0; i < rgba.length; i += step) mix(rgba[i]);
  return `${width}x${height}:${h.toString(16)}:${rgba.length}`;
}
