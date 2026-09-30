/**
 * Color quantization for lossy PNG: reduce RGBA pixels to at most `maxColors`
 * colors with a weighted median cut (5 bits per channel histogram), so the PNG
 * can be stored with a small palette. Images that already have few colors are
 * returned unchanged (lossless). Pure function: safe in workers and tests.
 *
 * (upng-js ships its own quantizer, but its power iteration starts from a fixed
 * vector and never splits clusters that differ only in hue at equal brightness —
 * e.g. pure red and pure green were merged into olive.)
 */

const BITS = 5;
const SHIFT = 8 - BITS;
const LEVELS = 1 << BITS;

const bucketKey = (r: number, g: number, b: number, a: number) => (((((r >> SHIFT) * LEVELS + (g >> SHIFT)) * LEVELS + (b >> SHIFT)) * LEVELS) + (a >> SHIFT));

interface Box {
  /** Indexes into the bucket arrays. */
  items: number[];
  count: number;
  /** Weighted sum of squared distances to the box mean (split priority). */
  sse: number;
  /** Channel (0–3) with the largest weighted variance, used to split. */
  axis: number;
}

/** Up to `limit + 1` distinct RGBA values (stops counting early). */
function distinctColors(data: Uint8ClampedArray | Uint8Array, limit: number): number {
  const seen = new Set<number>();
  for (let i = 0; i < data.length; i += 4) {
    seen.add(((data[i] << 24) | (data[i + 1] << 16) | (data[i + 2] << 8) | data[i + 3]) >>> 0);
    if (seen.size > limit) break;
  }
  return seen.size;
}

/** Reduce `data` (RGBA) to at most `maxColors` colors. Returns a new array. */
export function quantizeRgba(data: Uint8ClampedArray | Uint8Array, maxColors: number): Uint8ClampedArray {
  const k = Math.max(2, Math.min(256, Math.floor(maxColors)));
  const out = new Uint8ClampedArray(data);
  if (distinctColors(data, k) <= k) return out;

  // Histogram of 5-bit buckets with exact sums for accurate means.
  const index = new Int32Array(LEVELS ** 4).fill(-1);
  const counts: number[] = [];
  const sums: number[][] = [[], [], [], []];
  const sq: number[][] = [[], [], [], []];
  const pixelBucket = new Int32Array(data.length / 4);
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    const key = bucketKey(data[i], data[i + 1], data[i + 2], data[i + 3]);
    let b = index[key];
    if (b < 0) {
      b = counts.length;
      index[key] = b;
      counts.push(0);
      for (let c = 0; c < 4; c++) {
        sums[c].push(0);
        sq[c].push(0);
      }
    }
    counts[b]++;
    for (let c = 0; c < 4; c++) {
      const v = data[i + c];
      sums[c][b] += v;
      sq[c][b] += v * v;
    }
    pixelBucket[p] = b;
  }

  const makeBox = (items: number[]): Box => {
    let count = 0;
    const s = [0, 0, 0, 0];
    const s2 = [0, 0, 0, 0];
    for (const b of items) {
      count += counts[b];
      for (let c = 0; c < 4; c++) {
        s[c] += sums[c][b];
        s2[c] += sq[c][b];
      }
    }
    let sse = 0;
    let axis = 0;
    let best = -1;
    for (let c = 0; c < 4; c++) {
      const variance = s2[c] - (s[c] * s[c]) / count;
      sse += variance;
      if (variance > best) {
        best = variance;
        axis = c;
      }
    }
    return { items, count, sse: items.length > 1 ? sse : 0, axis };
  };

  const boxes: Box[] = [makeBox(counts.map((_, i) => i))];
  while (boxes.length < k) {
    let pick = -1;
    for (let i = 0; i < boxes.length; i++) if (boxes[i].sse > 0 && (pick < 0 || boxes[i].sse > boxes[pick].sse)) pick = i;
    if (pick < 0) break; // every box is a single bucket
    const box = boxes[pick];
    const c = box.axis;
    const mean = (b: number) => sums[c][b] / counts[b];
    const sorted = [...box.items].sort((x, y) => mean(x) - mean(y));
    // Split at the weighted median, keeping both halves non-empty.
    let acc = 0;
    let cut = 1;
    for (let i = 0; i < sorted.length - 1; i++) {
      acc += counts[sorted[i]];
      cut = i + 1;
      if (acc >= box.count / 2) break;
    }
    boxes.splice(pick, 1, makeBox(sorted.slice(0, cut)), makeBox(sorted.slice(cut)));
  }

  // Palette = weighted mean of each box; every bucket maps to its box color.
  const bucketColor = new Uint32Array(counts.length);
  for (const box of boxes) {
    const s = [0, 0, 0, 0];
    for (const b of box.items) for (let c = 0; c < 4; c++) s[c] += sums[c][b];
    const [r, g, b, a] = s.map((v) => Math.round(v / box.count));
    const color = ((r << 24) | (g << 16) | (b << 8) | a) >>> 0;
    for (const item of box.items) bucketColor[item] = color;
  }
  for (let p = 0, i = 0; p < pixelBucket.length; p++, i += 4) {
    const color = bucketColor[pixelBucket[p]];
    const a = color & 255;
    // Fully transparent pixels carry no color.
    if (a === 0) {
      out[i] = out[i + 1] = out[i + 2] = out[i + 3] = 0;
      continue;
    }
    out[i] = color >>> 24;
    out[i + 1] = (color >>> 16) & 255;
    out[i + 2] = (color >>> 8) & 255;
    out[i + 3] = a;
  }
  return out;
}

/** Number of distinct RGBA colors (for tests and diagnostics). */
export function countColors(data: Uint8ClampedArray | Uint8Array): number {
  return distinctColors(data, Number.MAX_SAFE_INTEGER);
}
