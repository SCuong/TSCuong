/**
 * CSS-style image filters. Uses `ctx.filter` when the browser supports it and
 * an equivalent pixel implementation otherwise (e.g. older Safari).
 */

export interface FilterSettings {
  /** Percent, 100 = unchanged. */
  brightness: number;
  contrast: number;
  saturate: number;
  /** Percent 0–100. */
  grayscale: number;
  sepia: number;
  invert: number;
  /** Degrees. */
  hueRotate: number;
  /** Pixels. */
  blur: number;
}

export const DEFAULT_FILTERS: FilterSettings = {
  brightness: 100,
  contrast: 100,
  saturate: 100,
  grayscale: 0,
  sepia: 0,
  invert: 0,
  hueRotate: 0,
  blur: 0,
};

export function isIdentity(f: FilterSettings): boolean {
  return (Object.keys(DEFAULT_FILTERS) as Array<keyof FilterSettings>).every((k) => f[k] === DEFAULT_FILTERS[k]);
}

/** CSS filter string in the canonical order used by the pixel fallback too. */
export function filterString(f: FilterSettings): string {
  const parts: string[] = [];
  if (f.brightness !== 100) parts.push(`brightness(${f.brightness}%)`);
  if (f.contrast !== 100) parts.push(`contrast(${f.contrast}%)`);
  if (f.saturate !== 100) parts.push(`saturate(${f.saturate}%)`);
  if (f.grayscale) parts.push(`grayscale(${f.grayscale}%)`);
  if (f.sepia) parts.push(`sepia(${f.sepia}%)`);
  if (f.hueRotate) parts.push(`hue-rotate(${f.hueRotate}deg)`);
  if (f.invert) parts.push(`invert(${f.invert}%)`);
  if (f.blur) parts.push(`blur(${f.blur}px)`);
  return parts.join(' ') || 'none';
}

type Matrix = number[]; // 3×3 row-major for RGB

function saturateMatrix(s: number): Matrix {
  return [
    0.213 + 0.787 * s, 0.715 - 0.715 * s, 0.072 - 0.072 * s,
    0.213 - 0.213 * s, 0.715 + 0.285 * s, 0.072 - 0.072 * s,
    0.213 - 0.213 * s, 0.715 - 0.715 * s, 0.072 + 0.928 * s,
  ];
}

function grayscaleMatrix(g: number): Matrix {
  const a = 1 - g;
  return [
    0.2126 + 0.7874 * a, 0.7152 - 0.7152 * a, 0.0722 - 0.0722 * a,
    0.2126 - 0.2126 * a, 0.7152 + 0.2848 * a, 0.0722 - 0.0722 * a,
    0.2126 - 0.2126 * a, 0.7152 - 0.7152 * a, 0.0722 + 0.9278 * a,
  ];
}

function sepiaMatrix(s: number): Matrix {
  const a = 1 - s;
  return [
    0.393 + 0.607 * a, 0.769 - 0.769 * a, 0.189 - 0.189 * a,
    0.349 - 0.349 * a, 0.686 + 0.314 * a, 0.168 - 0.168 * a,
    0.272 - 0.272 * a, 0.534 - 0.534 * a, 0.131 + 0.869 * a,
  ];
}

function hueRotateMatrix(deg: number): Matrix {
  const rad = (deg * Math.PI) / 180;
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  return [
    0.213 + c * 0.787 - s * 0.213, 0.715 - c * 0.715 - s * 0.715, 0.072 - c * 0.072 + s * 0.928,
    0.213 - c * 0.213 + s * 0.143, 0.715 + c * 0.285 + s * 0.14, 0.072 - c * 0.072 - s * 0.283,
    0.213 - c * 0.213 - s * 0.787, 0.715 - c * 0.715 + s * 0.715, 0.072 + c * 0.928 + s * 0.072,
  ];
}

function applyMatrix(d: Uint8ClampedArray, m: Matrix) {
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i];
    const g = d[i + 1];
    const b = d[i + 2];
    d[i] = m[0] * r + m[1] * g + m[2] * b;
    d[i + 1] = m[3] * r + m[4] * g + m[5] * b;
    d[i + 2] = m[6] * r + m[7] * g + m[8] * b;
  }
}

function applyTransfer(d: Uint8ClampedArray, fn: (v: number) => number) {
  const lut = new Uint8ClampedArray(256);
  for (let v = 0; v < 256; v++) lut[v] = Math.round(fn(v / 255) * 255);
  for (let i = 0; i < d.length; i += 4) {
    d[i] = lut[d[i]];
    d[i + 1] = lut[d[i + 1]];
    d[i + 2] = lut[d[i + 2]];
  }
}

/** Separable box blur applied three times ≈ Gaussian blur with the given sigma (px). */
export function blurPixels(d: Uint8ClampedArray, width: number, height: number, sigma: number) {
  if (sigma <= 0) return;
  const boxes = boxesForGauss(sigma, 3);
  const tmp = new Float32Array(d.length);
  const buf = new Float32Array(d.length);
  for (let i = 0; i < d.length; i++) buf[i] = d[i];
  for (const size of boxes) {
    const radius = (size - 1) / 2;
    boxBlurH(buf, tmp, width, height, radius);
    boxBlurV(tmp, buf, width, height, radius);
  }
  for (let i = 0; i < d.length; i++) d[i] = buf[i];
}

function boxesForGauss(sigma: number, n: number): number[] {
  const wIdeal = Math.sqrt((12 * sigma * sigma) / n + 1);
  let wl = Math.floor(wIdeal);
  if (wl % 2 === 0) wl--;
  const wu = wl + 2;
  const mIdeal = (12 * sigma * sigma - n * wl * wl - 4 * n * wl - 3 * n) / (-4 * wl - 4);
  const m = Math.round(mIdeal);
  return Array.from({ length: n }, (_, i) => (i < m ? wl : wu));
}

function boxBlurH(src: Float32Array, dst: Float32Array, w: number, h: number, r: number) {
  const iarr = 1 / (r + r + 1);
  for (let y = 0; y < h; y++) {
    for (let c = 0; c < 4; c++) {
      const row = y * w * 4 + c;
      const first = src[row];
      const last = src[row + (w - 1) * 4];
      let val = (r + 1) * first;
      for (let j = 0; j < r; j++) val += src[row + Math.min(j, w - 1) * 4];
      for (let x = 0; x < w; x++) {
        val += (x + r < w ? src[row + (x + r) * 4] : last) - (x - r - 1 >= 0 ? src[row + (x - r - 1) * 4] : first);
        dst[row + x * 4] = val * iarr;
      }
    }
  }
}

function boxBlurV(src: Float32Array, dst: Float32Array, w: number, h: number, r: number) {
  const iarr = 1 / (r + r + 1);
  const stride = w * 4;
  for (let x = 0; x < w; x++) {
    for (let c = 0; c < 4; c++) {
      const col = x * 4 + c;
      const first = src[col];
      const last = src[col + (h - 1) * stride];
      let val = (r + 1) * first;
      for (let j = 0; j < r; j++) val += src[col + Math.min(j, h - 1) * stride];
      for (let y = 0; y < h; y++) {
        val += (y + r < h ? src[col + (y + r) * stride] : last) - (y - r - 1 >= 0 ? src[col + (y - r - 1) * stride] : first);
        dst[col + y * stride] = val * iarr;
      }
    }
  }
}

/** Apply filters to RGBA pixels in place (the fallback path). */
export function applyFiltersToPixels(d: Uint8ClampedArray, width: number, height: number, f: FilterSettings) {
  if (f.brightness !== 100) {
    const k = f.brightness / 100;
    applyTransfer(d, (v) => v * k);
  }
  if (f.contrast !== 100) {
    const k = f.contrast / 100;
    applyTransfer(d, (v) => (v - 0.5) * k + 0.5);
  }
  if (f.saturate !== 100) applyMatrix(d, saturateMatrix(f.saturate / 100));
  if (f.grayscale) applyMatrix(d, grayscaleMatrix(Math.min(1, f.grayscale / 100)));
  if (f.sepia) applyMatrix(d, sepiaMatrix(Math.min(1, f.sepia / 100)));
  if (f.hueRotate) applyMatrix(d, hueRotateMatrix(f.hueRotate));
  if (f.invert) {
    const k = Math.min(1, f.invert / 100);
    applyTransfer(d, (v) => v * (1 - k) + (1 - v) * k);
  }
  if (f.blur) blurPixels(d, width, height, f.blur);
}

let filterSupport: boolean | null = null;

/** Detects whether canvas `ctx.filter` actually works (Safari historically ignored it). */
export function supportsCanvasFilter(): boolean {
  if (filterSupport !== null) return filterSupport;
  try {
    const c = typeof document !== 'undefined' ? document.createElement('canvas') : new OffscreenCanvas(1, 1);
    c.width = 1;
    c.height = 1;
    const ctx = c.getContext('2d') as CanvasRenderingContext2D | null;
    if (!ctx || !('filter' in ctx)) return (filterSupport = false);
    ctx.fillStyle = '#fff';
    ctx.filter = 'invert(1)';
    ctx.fillRect(0, 0, 1, 1);
    const [r] = ctx.getImageData(0, 0, 1, 1).data;
    filterSupport = r < 10;
  } catch {
    filterSupport = false;
  }
  return filterSupport;
}
