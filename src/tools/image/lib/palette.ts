/** Palette extraction: k-means++ clustering in the perceptual OKLab space. */

export interface PaletteColor {
  hex: string;
  rgb: [number, number, number];
  /** Fraction of sampled pixels (0–1). */
  share: number;
}

const toLinear = (c: number) => {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};
const toGamma = (v: number) => {
  const c = v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
  return Math.round(Math.min(1, Math.max(0, c)) * 255);
};

export function srgbToOklab(r: number, g: number, b: number): [number, number, number] {
  const lr = toLinear(r);
  const lg = toLinear(g);
  const lb = toLinear(b);
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

export function oklabToSrgb(L: number, a: number, b: number): [number, number, number] {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    toGamma(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    toGamma(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    toGamma(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ];
}

export function rgbToHex([r, g, b]: [number, number, number]): string {
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

/** Deterministic PRNG (mulberry32) so the same image always yields the same palette. */
function rng(seed: number) {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let x = Math.imul(t ^ (t >>> 15), 1 | t);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

/** Sample opaque pixels (RGBA) into OKLab triples. */
export function samplePixels(data: Uint8ClampedArray | Uint8Array, maxSamples = 40000, alphaThreshold = 125): Float64Array {
  const total = data.length / 4;
  const step = Math.max(1, Math.floor(total / maxSamples));
  const out: number[] = [];
  for (let p = 0; p < total; p += step) {
    const i = p * 4;
    if (data[i + 3] < alphaThreshold) continue;
    const [L, a, b] = srgbToOklab(data[i], data[i + 1], data[i + 2]);
    out.push(L, a, b);
  }
  return Float64Array.from(out);
}

export function kmeans(points: Float64Array, k: number, maxIter = 24, seed = 1): { centers: Float64Array; counts: number[] } {
  const n = points.length / 3;
  if (n === 0) return { centers: new Float64Array(0), counts: [] };
  const K = Math.max(1, Math.min(k, n));
  const rand = rng(seed);
  const centers = new Float64Array(K * 3);
  // k-means++ seeding
  const first = Math.floor(rand() * n);
  centers.set(points.subarray(first * 3, first * 3 + 3), 0);
  const d2 = new Float64Array(n).fill(Infinity);
  let chosen = 1;
  for (; chosen < K; chosen++) {
    let sum = 0;
    const c = (chosen - 1) * 3;
    for (let i = 0; i < n; i++) {
      const dx = points[i * 3] - centers[c];
      const dy = points[i * 3 + 1] - centers[c + 1];
      const dz = points[i * 3 + 2] - centers[c + 2];
      const d = dx * dx + dy * dy + dz * dz;
      if (d < d2[i]) d2[i] = d;
      sum += d2[i];
    }
    if (sum <= 1e-12) break; // fewer distinct colors than k
    let r = rand() * sum;
    let pick = n - 1;
    for (let i = 0; i < n; i++) {
      r -= d2[i];
      if (r <= 0) {
        pick = i;
        break;
      }
    }
    centers.set(points.subarray(pick * 3, pick * 3 + 3), chosen * 3);
  }
  const k2 = chosen;
  const assign = new Int32Array(n);
  const counts = new Array<number>(k2).fill(0);
  for (let iter = 0; iter < maxIter; iter++) {
    let changed = 0;
    for (let i = 0; i < n; i++) {
      let best = 0;
      let bestD = Infinity;
      for (let c = 0; c < k2; c++) {
        const dx = points[i * 3] - centers[c * 3];
        const dy = points[i * 3 + 1] - centers[c * 3 + 1];
        const dz = points[i * 3 + 2] - centers[c * 3 + 2];
        const d = dx * dx + dy * dy + dz * dz;
        if (d < bestD) {
          bestD = d;
          best = c;
        }
      }
      if (assign[i] !== best || iter === 0) {
        if (assign[i] !== best) changed++;
        assign[i] = best;
      }
    }
    const sums = new Float64Array(k2 * 3);
    counts.fill(0);
    for (let i = 0; i < n; i++) {
      const c = assign[i];
      counts[c]++;
      sums[c * 3] += points[i * 3];
      sums[c * 3 + 1] += points[i * 3 + 1];
      sums[c * 3 + 2] += points[i * 3 + 2];
    }
    for (let c = 0; c < k2; c++) {
      if (counts[c]) {
        centers[c * 3] = sums[c * 3] / counts[c];
        centers[c * 3 + 1] = sums[c * 3 + 1] / counts[c];
        centers[c * 3 + 2] = sums[c * 3 + 2] / counts[c];
      }
    }
    if (iter > 0 && changed === 0) break;
  }
  return { centers: centers.subarray(0, k2 * 3), counts };
}

/** Extract up to `k` dominant colors, largest share first. Empty for fully transparent images. */
export function extractPalette(data: Uint8ClampedArray | Uint8Array, k: number): PaletteColor[] {
  const points = samplePixels(data);
  const n = points.length / 3;
  if (n === 0) return [];
  const { centers, counts } = kmeans(points, k);
  const colors: PaletteColor[] = [];
  const byHex = new Map<string, PaletteColor>();
  counts.forEach((count, c) => {
    if (!count) return;
    const rgb = oklabToSrgb(centers[c * 3], centers[c * 3 + 1], centers[c * 3 + 2]);
    const hex = rgbToHex(rgb);
    const existing = byHex.get(hex);
    if (existing) existing.share += count / n;
    else {
      const color = { hex, rgb, share: count / n };
      byHex.set(hex, color);
      colors.push(color);
    }
  });
  return colors.sort((a, b) => b.share - a.share);
}

export function paletteToCss(colors: PaletteColor[], prefix = 'color'): string {
  return `:root {\n${colors.map((c, i) => `  --${prefix}-${i + 1}: ${c.hex};`).join('\n')}\n}\n`;
}

export function paletteToJson(colors: PaletteColor[]): string {
  return JSON.stringify(
    colors.map((c) => ({ hex: c.hex, rgb: c.rgb, percent: Math.round(c.share * 1000) / 10 })),
    null,
    2,
  );
}
