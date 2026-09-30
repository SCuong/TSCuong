/** Pure geometry helpers for resizing, rotating and cropping. */

export type ResizeMode = 'percent' | 'exact' | 'fit' | 'width' | 'height' | 'cover';

export interface ResizeSpec {
  mode: ResizeMode;
  width?: number;
  height?: number;
  percent?: number;
  /** For `exact`: keep aspect ratio by deriving the missing side. */
  keepAspect?: boolean;
  /** Never enlarge beyond the original size. */
  noUpscale?: boolean;
}

export interface Size {
  width: number;
  height: number;
}

const r = (n: number) => Math.max(1, Math.round(n));

/** Compute output dimensions for a resize request. Throws on invalid input. */
export function computeResize(src: Size, spec: ResizeSpec): Size {
  const { width: sw, height: sh } = src;
  const pos = (n: number | undefined) => typeof n === 'number' && Number.isFinite(n) && n > 0;
  let out: Size;
  switch (spec.mode) {
    case 'percent': {
      if (!pos(spec.percent)) throw new Error('Enter a percentage greater than 0.');
      const f = spec.percent! / 100;
      out = { width: r(sw * f), height: r(sh * f) };
      break;
    }
    case 'width':
      if (!pos(spec.width)) throw new Error('Enter a width greater than 0.');
      out = { width: r(spec.width!), height: r((sh * spec.width!) / sw) };
      break;
    case 'height':
      if (!pos(spec.height)) throw new Error('Enter a height greater than 0.');
      out = { width: r((sw * spec.height!) / sh), height: r(spec.height!) };
      break;
    case 'fit': {
      const w = pos(spec.width) ? spec.width! : Infinity;
      const h = pos(spec.height) ? spec.height! : Infinity;
      if (w === Infinity && h === Infinity) throw new Error('Enter a maximum width or height.');
      const f = Math.min(w / sw, h / sh);
      out = { width: r(sw * f), height: r(sh * f) };
      break;
    }
    case 'cover':
    case 'exact': {
      if (spec.keepAspect && spec.mode === 'exact') {
        if (pos(spec.width) && !pos(spec.height)) return computeResize(src, { ...spec, mode: 'width' });
        if (pos(spec.height) && !pos(spec.width)) return computeResize(src, { ...spec, mode: 'height' });
      }
      if (!pos(spec.width) || !pos(spec.height)) throw new Error('Enter both a width and a height.');
      out = { width: r(spec.width!), height: r(spec.height!) };
      break;
    }
  }
  if (spec.noUpscale && (out.width > sw || out.height > sh) && spec.mode !== 'exact' && spec.mode !== 'cover') {
    return { width: sw, height: sh };
  }
  return out;
}

/** Limit the longest side to `max` (no upscaling). */
export function fitMaxDimension(src: Size, max: number | null | undefined): Size {
  if (!max || max <= 0) return src;
  const longest = Math.max(src.width, src.height);
  if (longest <= max) return src;
  const f = max / longest;
  return { width: r(src.width * f), height: r(src.height * f) };
}

/** cos/sin of a clockwise angle in degrees, exact for multiples of 90°. */
function cosSin(degrees: number): [number, number] {
  const norm = ((degrees % 360) + 360) % 360;
  if (norm === 0) return [1, 0];
  if (norm === 90) return [0, 1];
  if (norm === 180) return [-1, 0];
  if (norm === 270) return [0, -1];
  const rad = (norm * Math.PI) / 180;
  return [Math.cos(rad), Math.sin(rad)];
}

/** Bounding box of a w×h rectangle rotated by `degrees`. */
export function rotatedBounds(src: Size, degrees: number): Size {
  const [c, s] = cosSin(degrees);
  const cos = Math.abs(c);
  const sin = Math.abs(s);
  // Snap near-integers so 90° rotations give exact swapped sizes.
  const w = src.width * cos + src.height * sin;
  const h = src.width * sin + src.height * cos;
  return { width: Math.max(1, Math.round(w - 1e-9)), height: Math.max(1, Math.round(h - 1e-9)) };
}

/** A 2D affine transform in canvas `setTransform(a, b, c, d, e, f)` order. */
export type Matrix2D = [a: number, b: number, c: number, d: number, e: number, f: number];

/**
 * Transform that draws a `src`-sized image rotated clockwise by `degrees` and then
 * mirrored in screen space (so "horizontal" always means left↔right of the result,
 * whatever the rotation), centered in the rotated bounding box.
 */
export function rotateFlipTransform(src: Size, degrees: number, flipH = false, flipV = false): { matrix: Matrix2D; width: number; height: number } {
  const { width, height } = rotatedBounds(src, degrees);
  const [cos, sin] = cosSin(degrees);
  const sx = flipH ? -1 : 1;
  const sy = flipV ? -1 : 1;
  // Screen-space flip × rotation (canvas rotate() is clockwise because y points down).
  const a = sx * cos;
  const c = -sx * sin;
  const b = sy * sin;
  const d = sy * cos;
  const e = width / 2 - (a * src.width + c * src.height) / 2;
  const f = height / 2 - (b * src.width + d * src.height) / 2;
  return { matrix: [a, b, c, d, e, f], width, height };
}

/** Apply a matrix to a point (used by tests and previews). */
export function transformPoint([a, b, c, d, e, f]: Matrix2D, x: number, y: number): { x: number; y: number } {
  return { x: a * x + c * y + e, y: b * x + d * y + f };
}

/** CSS transform equivalent to {@link rotateFlipTransform} for a preview element (rotate first, then mirror on screen). */
export function rotateFlipCss(degrees: number, flipH = false, flipV = false): string {
  return `scale(${flipH ? -1 : 1}, ${flipV ? -1 : 1}) rotate(${degrees}deg)`;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Clamp a crop rectangle inside the image, keeping it at least 1px. */
export function clampRect(rect: Rect, bounds: Size): Rect {
  const width = Math.max(1, Math.min(Math.round(rect.width), bounds.width));
  const height = Math.max(1, Math.min(Math.round(rect.height), bounds.height));
  const x = Math.min(Math.max(0, Math.round(rect.x)), bounds.width - width);
  const y = Math.min(Math.max(0, Math.round(rect.y)), bounds.height - height);
  return { x, y, width, height };
}

/** The largest centered rectangle with aspect `ratio` (w/h) inside `bounds`. */
export function centeredAspectRect(bounds: Size, ratio: number): Rect {
  let width = bounds.width;
  let height = width / ratio;
  if (height > bounds.height) {
    height = bounds.height;
    width = height * ratio;
  }
  return clampRect({ x: (bounds.width - width) / 2, y: (bounds.height - height) / 2, width, height }, bounds);
}

/**
 * Source rectangle for drawing `src` into a `dst` frame with object-fit cover,
 * positioned by a focal point (0–1 in each axis).
 */
export function coverSourceRect(src: Size, dst: Size, focal: { x: number; y: number } = { x: 0.5, y: 0.5 }): Rect {
  const scale = Math.max(dst.width / src.width, dst.height / src.height);
  const width = dst.width / scale;
  const height = dst.height / scale;
  const x = Math.min(Math.max(0, focal.x * src.width - width / 2), src.width - width);
  const y = Math.min(Math.max(0, focal.y * src.height - height / 2), src.height - height);
  return { x, y, width, height };
}

/** Destination rectangle for object-fit contain (centered). */
export function containDestRect(src: Size, dst: Size): Rect {
  const scale = Math.min(dst.width / src.width, dst.height / src.height);
  const width = src.width * scale;
  const height = src.height * scale;
  return { x: (dst.width - width) / 2, y: (dst.height - height) / 2, width, height };
}

export function gcd(a: number, b: number): number {
  a = Math.abs(Math.round(a));
  b = Math.abs(Math.round(b));
  while (b) [a, b] = [b, a % b];
  return a || 1;
}

/** "16:9" style ratio, with a decimal fallback for awkward sizes. */
export function aspectRatioLabel(width: number, height: number): string {
  if (!width || !height) return '—';
  const g = gcd(width, height);
  const a = width / g;
  const b = height / g;
  if (a <= 50 && b <= 50) return `${a}:${b}`;
  const common: Array<[number, number]> = [
    [16, 9],
    [4, 3],
    [3, 2],
    [21, 9],
    [16, 10],
    [5, 4],
    [1, 1],
    [9, 16],
    [3, 4],
    [2, 3],
  ];
  const ratio = width / height;
  const near = common.find(([x, y]) => Math.abs(x / y - ratio) < 0.01);
  return near ? `≈ ${near[0]}:${near[1]}` : `${ratio.toFixed(3)}:1`;
}
