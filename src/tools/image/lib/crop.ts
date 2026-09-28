/** Pure crop-box interaction math (image pixel coordinates). */
import type { Rect, Size } from './geometry';

export type Handle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function moveCrop(start: Rect, dx: number, dy: number, bounds: Size): Rect {
  return {
    ...start,
    x: clamp(start.x + dx, 0, bounds.width - start.width),
    y: clamp(start.y + dy, 0, bounds.height - start.height),
  };
}

/**
 * Resize a crop rectangle by dragging `handle` by (dx, dy). The opposite side
 * or corner stays anchored; with `aspect` (width / height) the ratio is kept
 * and the rectangle never leaves `bounds`.
 */
export function resizeCrop(start: Rect, handle: Handle, dx: number, dy: number, bounds: Size, aspect: number | null, minSize = 1): Rect {
  const hasW = handle.includes('w');
  const hasE = handle.includes('e');
  const hasN = handle.includes('n');
  const hasS = handle.includes('s');
  const right = start.x + start.width;
  const bottom = start.y + start.height;
  const min = Math.max(1, minSize);

  let x1 = start.x;
  let x2 = right;
  let y1 = start.y;
  let y2 = bottom;
  if (hasW) x1 = clamp(start.x + dx, 0, right - min);
  if (hasE) x2 = clamp(right + dx, start.x + min, bounds.width);
  if (hasN) y1 = clamp(start.y + dy, 0, bottom - min);
  if (hasS) y2 = clamp(bottom + dy, start.y + min, bounds.height);

  if (!aspect || !Number.isFinite(aspect) || aspect <= 0) {
    return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
  }

  const corner = (hasW || hasE) && (hasN || hasS);
  if (corner) {
    const anchorX = hasW ? right : start.x;
    const anchorY = hasN ? bottom : start.y;
    const availW = hasW ? anchorX : bounds.width - anchorX;
    const availH = hasN ? anchorY : bounds.height - anchorY;
    let w = Math.min(x2 - x1, availW);
    let h = Math.min(y2 - y1, availH);
    if (w / h > aspect) w = h * aspect;
    else h = w / aspect;
    // Respect the available room after enforcing the ratio.
    if (w > availW) {
      w = availW;
      h = w / aspect;
    }
    if (h > availH) {
      h = availH;
      w = h * aspect;
    }
    w = Math.max(min, w);
    h = Math.max(min, h);
    return { x: hasW ? anchorX - w : anchorX, y: hasN ? anchorY - h : anchorY, width: w, height: h };
  }

  if (hasW || hasE) {
    const anchorX = hasW ? right : start.x;
    let w = x2 - x1;
    let h = w / aspect;
    if (h > bounds.height) {
      h = bounds.height;
      w = h * aspect;
    }
    const cy = start.y + start.height / 2;
    const y = clamp(cy - h / 2, 0, bounds.height - h);
    return { x: hasW ? anchorX - w : anchorX, y, width: w, height: h };
  }

  const anchorY = hasN ? bottom : start.y;
  let h = y2 - y1;
  let w = h * aspect;
  if (w > bounds.width) {
    w = bounds.width;
    h = w / aspect;
  }
  const cx = start.x + start.width / 2;
  const x = clamp(cx - w / 2, 0, bounds.width - w);
  return { x, y: hasN ? anchorY - h : anchorY, width: w, height: h };
}

/** Round to whole pixels and keep inside the image. */
export function roundCrop(rect: Rect, bounds: Size): Rect {
  const width = clamp(Math.round(rect.width), 1, bounds.width);
  const height = clamp(Math.round(rect.height), 1, bounds.height);
  return {
    x: clamp(Math.round(rect.x), 0, bounds.width - width),
    y: clamp(Math.round(rect.y), 0, bounds.height - height),
    width,
    height,
  };
}
