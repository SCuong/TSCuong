/** Pure pixel operations for the transparency & background tool. */

export interface KeyOptions {
  target: [number, number, number];
  /** 0–100: colors within this distance are fully affected. */
  tolerance: number;
  /** 0–100: extra distance over which the effect fades out (soft edges). */
  feather: number;
  mode: 'transparent' | 'replace';
  replacement?: [number, number, number];
  /** Only affect pixels connected to `seed` (flood fill). */
  contiguous?: boolean;
  seed?: { x: number; y: number };
}

const MAX_DIST = Math.sqrt(3 * 255 * 255);

/** Distance between two colors on a 0–100 scale. */
export function colorDistance(r1: number, g1: number, b1: number, r2: number, g2: number, b2: number): number {
  const dr = r1 - r2;
  const dg = g1 - g2;
  const db = b1 - b2;
  return (Math.sqrt(dr * dr + dg * dg + db * db) / MAX_DIST) * 100;
}

/** Effect strength (0–1) for a distance given tolerance and feather. */
export function strength(dist: number, tolerance: number, feather: number): number {
  if (dist <= tolerance) return 1;
  if (feather <= 0 || dist >= tolerance + feather) return 0;
  return 1 - (dist - tolerance) / feather;
}

/** Make a color transparent or replace it, in place. Returns the number of affected pixels. */
export function keyColor(data: Uint8ClampedArray, width: number, height: number, o: KeyOptions): number {
  const [tr, tg, tb] = o.target;
  const n = width * height;
  const reach = o.tolerance + o.feather;
  let mask: Uint8Array | null = null;
  if (o.contiguous && o.seed) {
    mask = new Uint8Array(n);
    const sx = Math.floor(o.seed.x);
    const sy = Math.floor(o.seed.y);
    if (sx >= 0 && sy >= 0 && sx < width && sy < height) {
      // 0 = unvisited, 1 = inside, 2 = visited but outside
      const stack = new Int32Array(n);
      let top = 0;
      const visit = (q: number) => {
        if (mask![q]) return;
        const i = q * 4;
        if (colorDistance(data[i], data[i + 1], data[i + 2], tr, tg, tb) > reach) {
          mask![q] = 2;
          return;
        }
        mask![q] = 1;
        stack[top++] = q;
      };
      visit(sy * width + sx);
      while (top > 0) {
        const p = stack[--top];
        const x = p % width;
        if (x > 0) visit(p - 1);
        if (x < width - 1) visit(p + 1);
        if (p >= width) visit(p - width);
        if (p < n - width) visit(p + width);
      }
    }
  }
  const [rr, rg, rb] = o.replacement ?? [255, 255, 255];
  let affected = 0;
  for (let p = 0; p < n; p++) {
    if (mask && mask[p] !== 1) continue;
    const i = p * 4;
    const f = strength(colorDistance(data[i], data[i + 1], data[i + 2], tr, tg, tb), o.tolerance, o.feather);
    if (f <= 0) continue;
    affected++;
    if (o.mode === 'transparent') {
      data[i + 3] = Math.round(data[i + 3] * (1 - f));
    } else {
      data[i] = Math.round(data[i] + (rr - data[i]) * f);
      data[i + 1] = Math.round(data[i + 1] + (rg - data[i + 1]) * f);
      data[i + 2] = Math.round(data[i + 2] + (rb - data[i + 2]) * f);
    }
  }
  return affected;
}

/** Composite every pixel over an opaque background color, in place. */
export function flatten(data: Uint8ClampedArray, bg: [number, number, number]) {
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3] / 255;
    data[i] = Math.round(data[i] * a + bg[0] * (1 - a));
    data[i + 1] = Math.round(data[i + 1] * a + bg[1] * (1 - a));
    data[i + 2] = Math.round(data[i + 2] * a + bg[2] * (1 - a));
    data[i + 3] = 255;
  }
}

/** The most common color along the image border (a good guess for the background). */
export function guessBackground(data: Uint8ClampedArray, width: number, height: number): [number, number, number] {
  const counts = new Map<number, number>();
  const add = (x: number, y: number) => {
    const i = (y * width + x) * 4;
    if (data[i + 3] < 128) return;
    // Quantize to 5 bits per channel to group near-identical colors.
    const key = ((data[i] >> 3) << 10) | ((data[i + 1] >> 3) << 5) | (data[i + 2] >> 3);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  };
  for (let x = 0; x < width; x++) {
    add(x, 0);
    add(x, height - 1);
  }
  for (let y = 0; y < height; y++) {
    add(0, y);
    add(width - 1, y);
  }
  let best = -1;
  let bestN = 0;
  for (const [k, n] of counts) if (n > bestN) [best, bestN] = [k, n];
  if (best < 0) return [255, 255, 255];
  const q = (v: number) => (v << 3) | (v >> 2);
  return [q((best >> 10) & 31), q((best >> 5) & 31), q(best & 31)];
}
