import { t } from '@/lib/i18n';
/**
 * Page geometry helpers. "Visual" coordinates are what the reader sees: origin
 * at the bottom-left of the displayed (rotated) page, y pointing up, in points.
 * "User" coordinates are the page's own PDF coordinate space. Pages with a
 * /Rotate entry are displayed rotated clockwise, so anything we draw must be
 * mapped (and rotated) to appear upright.
 */

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type Rotation = 0 | 90 | 180 | 270;

export function normalizeRotation(angle: number): Rotation {
  const r = (((Math.round(angle / 90) * 90) % 360) + 360) % 360;
  return r as Rotation;
}

/** Size of the page as displayed. */
export function visualSize(box: Box, rotation: number): { width: number; height: number } {
  const r = normalizeRotation(rotation);
  return r === 90 || r === 270 ? { width: box.height, height: box.width } : { width: box.width, height: box.height };
}

/** Map a visual point to user space for a page with the given box and /Rotate. */
export function visualToUser(vx: number, vy: number, box: Box, rotation: number): { x: number; y: number } {
  const r = normalizeRotation(rotation);
  const { width: w, height: h } = box;
  let ux: number;
  let uy: number;
  switch (r) {
    case 90:
      ux = w - vy;
      uy = vx;
      break;
    case 180:
      ux = w - vx;
      uy = h - vy;
      break;
    case 270:
      ux = vy;
      uy = h - vx;
      break;
    default:
      ux = vx;
      uy = vy;
  }
  return { x: box.x + ux, y: box.y + uy };
}

export interface Margins {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** Convert margins given on the displayed page into margins of the page's user-space box. */
export function visualMarginsToUser(m: Margins, rotation: number): Margins {
  switch (normalizeRotation(rotation)) {
    case 90:
      return { left: m.top, top: m.right, right: m.bottom, bottom: m.left };
    case 180:
      return { left: m.right, right: m.left, top: m.bottom, bottom: m.top };
    case 270:
      return { right: m.top, bottom: m.right, left: m.bottom, top: m.left };
    default:
      return { ...m };
  }
}

/** Shrink a box by margins. Returns null when nothing would remain. */
export function insetBox(box: Box, m: Margins): Box | null {
  const width = box.width - m.left - m.right;
  const height = box.height - m.top - m.bottom;
  if (width < 1 || height < 1) return null;
  return { x: box.x + m.left, y: box.y + m.bottom, width, height };
}

export type Position =
  | 'top-left'
  | 'top-center'
  | 'top-right'
  | 'middle-left'
  | 'center'
  | 'middle-right'
  | 'bottom-left'
  | 'bottom-center'
  | 'bottom-right';

/**
 * Center point (visual coordinates) of an element of size (w × h) anchored at
 * `position` on a page of visual size (pw × ph) with a margin.
 */
export function anchorCenter(
  position: Position,
  w: number,
  h: number,
  pw: number,
  ph: number,
  margin: number,
): { cx: number; cy: number } {
  const [v, hz] = position === 'center' ? ['middle', 'center'] : (position.split('-') as [string, string]);
  const cx = hz === 'left' ? margin + w / 2 : hz === 'right' ? pw - margin - w / 2 : pw / 2;
  const cy = v === 'top' ? ph - margin - h / 2 : v === 'bottom' ? margin + h / 2 : ph / 2;
  return { cx, cy };
}

/**
 * Origin (bottom-left corner before rotation) for an element of size w × h that
 * should be centered at (cx, cy) after rotating it counter-clockwise by `angle` degrees
 * around that origin (which is how PDF drawing operators rotate).
 */
export function originForCenteredRotation(cx: number, cy: number, w: number, h: number, angle: number) {
  const a = (angle * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  // Rotated vector from origin to the element's center.
  const dx = (w / 2) * cos - (h / 2) * sin;
  const dy = (w / 2) * sin + (h / 2) * cos;
  return { x: cx - dx, y: cy - dy };
}

/** Axis-aligned bounding size of a w × h rectangle rotated by `angle` degrees. */
export function rotatedBounds(w: number, h: number, angle: number): { width: number; height: number } {
  const a = (angle * Math.PI) / 180;
  const c = Math.abs(Math.cos(a));
  const s = Math.abs(Math.sin(a));
  return { width: w * c + h * s, height: w * s + h * c };
}

export const MM_PER_PT = 25.4 / 72;
export const ptToMm = (pt: number) => pt * MM_PER_PT;
export const mmToPt = (mm: number) => mm / MM_PER_PT;
export const ptToIn = (pt: number) => pt / 72;

export const PAPER_SIZES = {
  a4: { width: 595.28, height: 841.89, label: 'A4' },
  letter: { width: 612, height: 792, label: 'Letter' },
  legal: { width: 612, height: 1008, label: 'Legal' },
  a3: { width: 841.89, height: 1190.55, label: 'A3' },
  a5: { width: 419.53, height: 595.28, label: 'A5' },
} as const;

/** Name a page size when it matches a common paper size (either orientation, ±1.5pt). */
export function paperName(width: number, height: number): string | null {
  for (const p of Object.values(PAPER_SIZES)) {
    const near = (a: number, b: number) => Math.abs(a - b) < 1.5;
    if ((near(width, p.width) && near(height, p.height)) || (near(width, p.height) && near(height, p.width))) return t(p.label);
  }
  return null;
}

/**
 * Centers for a tiled watermark: rows run along the (rotated) text direction,
 * alternate rows are offset by half a step, and the grid covers the whole page.
 */
export function tileCenters(pw: number, ph: number, w: number, h: number, angle: number, limit = 600): Array<{ cx: number; cy: number }> {
  if (w <= 0 || h <= 0 || pw <= 0 || ph <= 0) return [];
  const a = (angle * Math.PI) / 180;
  const u = { x: Math.cos(a), y: Math.sin(a) };
  const v = { x: -Math.sin(a), y: Math.cos(a) };
  const stepU = w + Math.max(24, w * 0.3);
  const stepV = Math.max(h * 3, h + 36);
  const c0 = { x: pw / 2, y: ph / 2 };
  const corners = [
    [0, 0],
    [pw, 0],
    [0, ph],
    [pw, ph],
  ].map(([x, y]) => ({ u: (x - c0.x) * u.x + (y - c0.y) * u.y, v: (x - c0.x) * v.x + (y - c0.y) * v.y }));
  const uMin = Math.min(...corners.map((c) => c.u)) - stepU;
  const uMax = Math.max(...corners.map((c) => c.u)) + stepU;
  const vMin = Math.min(...corners.map((c) => c.v)) - stepV;
  const vMax = Math.max(...corners.map((c) => c.v)) + stepV;
  const reach = Math.hypot(w, h) / 2;
  const out: Array<{ cx: number; cy: number }> = [];
  for (let j = Math.floor(vMin / stepV); j <= Math.ceil(vMax / stepV); j++) {
    const shift = (((j % 2) + 2) % 2) * (stepU / 2);
    for (let i = Math.floor(uMin / stepU); i <= Math.ceil(uMax / stepU); i++) {
      const du = i * stepU + shift;
      const dv = j * stepV;
      const cx = c0.x + du * u.x + dv * v.x;
      const cy = c0.y + du * u.y + dv * v.y;
      if (cx < -reach || cx > pw + reach || cy < -reach || cy > ph + reach) continue;
      out.push({ cx, cy });
      if (out.length >= limit) return out;
    }
  }
  return out;
}
