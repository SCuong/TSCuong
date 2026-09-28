/** Pure binary encoders: ICO (PNG entries) and BMP (24-bit). */

export interface IcoEntry {
  width: number;
  height: number;
  /** A complete PNG file. */
  png: Uint8Array;
}

/**
 * Build a Windows .ico containing PNG-compressed images (supported since
 * Windows Vista and by every browser). Sizes up to 256×256; 256 is stored as 0.
 */
export function encodeIco(entries: IcoEntry[]): Uint8Array {
  if (entries.length === 0) throw new Error('An ICO file needs at least one image.');
  if (entries.length > 0xffff) throw new Error('Too many images for one ICO file.');
  for (const e of entries) {
    if (e.width < 1 || e.height < 1 || e.width > 256 || e.height > 256) {
      throw new Error(`ICO images must be between 1 and 256 pixels (got ${e.width}×${e.height}).`);
    }
  }
  const headerSize = 6 + 16 * entries.length;
  const total = headerSize + entries.reduce((n, e) => n + e.png.length, 0);
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  view.setUint16(0, 0, true); // reserved
  view.setUint16(2, 1, true); // type: icon
  view.setUint16(4, entries.length, true);
  let offset = headerSize;
  entries.forEach((e, i) => {
    const p = 6 + i * 16;
    out[p] = e.width >= 256 ? 0 : e.width;
    out[p + 1] = e.height >= 256 ? 0 : e.height;
    out[p + 2] = 0; // palette colors
    out[p + 3] = 0; // reserved
    view.setUint16(p + 4, 1, true); // color planes
    view.setUint16(p + 6, 32, true); // bits per pixel
    view.setUint32(p + 8, e.png.length, true);
    view.setUint32(p + 12, offset, true);
    out.set(e.png, offset);
    offset += e.png.length;
  });
  return out;
}

export interface ParsedIcoEntry {
  width: number;
  height: number;
  bitCount: number;
  size: number;
  offset: number;
  isPng: boolean;
}

/** Parse an ICO directory (used by tests and the info inspector). */
export function parseIco(bytes: Uint8Array): ParsedIcoEntry[] {
  if (bytes.length < 6) throw new Error('Not an ICO file.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint16(0, true) !== 0 || view.getUint16(2, true) !== 1) throw new Error('Not an ICO file.');
  const count = view.getUint16(4, true);
  const entries: ParsedIcoEntry[] = [];
  for (let i = 0; i < count; i++) {
    const p = 6 + i * 16;
    if (p + 16 > bytes.length) throw new Error('Truncated ICO directory.');
    const size = view.getUint32(p + 8, true);
    const offset = view.getUint32(p + 12, true);
    entries.push({
      width: bytes[p] || 256,
      height: bytes[p + 1] || 256,
      bitCount: view.getUint16(p + 6, true),
      size,
      offset,
      isPng: offset + 8 <= bytes.length && bytes[offset] === 0x89 && bytes[offset + 1] === 0x50,
    });
  }
  return entries;
}

/**
 * Encode RGBA pixels as a 24-bit bottom-up BMP. Alpha is composited over
 * `background` (RGB triple) because 24-bit BMP has no alpha channel.
 */
export function encodeBmp(
  rgba: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  background: [number, number, number] = [255, 255, 255],
): Uint8Array {
  if (width < 1 || height < 1) throw new Error('Image is empty.');
  if (rgba.length < width * height * 4) throw new Error('Pixel buffer is smaller than width × height.');
  const rowSize = Math.ceil((width * 3) / 4) * 4;
  const imageSize = rowSize * height;
  const fileSize = 54 + imageSize;
  const out = new Uint8Array(fileSize);
  const v = new DataView(out.buffer);
  out[0] = 0x42;
  out[1] = 0x4d;
  v.setUint32(2, fileSize, true);
  v.setUint32(10, 54, true); // pixel data offset
  v.setUint32(14, 40, true); // BITMAPINFOHEADER
  v.setInt32(18, width, true);
  v.setInt32(22, height, true); // positive = bottom-up
  v.setUint16(26, 1, true);
  v.setUint16(28, 24, true);
  v.setUint32(30, 0, true); // BI_RGB
  v.setUint32(34, imageSize, true);
  v.setInt32(38, 2835, true); // 72 DPI
  v.setInt32(42, 2835, true);
  const [br, bg, bb] = background;
  for (let y = 0; y < height; y++) {
    const src = (height - 1 - y) * width * 4;
    let dst = 54 + y * rowSize;
    for (let x = 0; x < width; x++) {
      const i = src + x * 4;
      const a = rgba[i + 3] / 255;
      out[dst++] = Math.round(rgba[i + 2] * a + bb * (1 - a));
      out[dst++] = Math.round(rgba[i + 1] * a + bg * (1 - a));
      out[dst++] = Math.round(rgba[i] * a + br * (1 - a));
    }
  }
  return out;
}

/** Parse "#rgb", "#rrggbb" or "#rrggbbaa" into an RGB triple (alpha ignored). */
export function hexToRgb(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(hex.trim());
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = h.replace(/./g, (c) => c + c);
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
