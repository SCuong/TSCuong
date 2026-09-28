// Generates the app's PNG/ICO icons from the LocalKit mark (no native deps).
// Run: node scripts/generate-icons.mjs
import { writeFileSync, mkdirSync } from 'node:fs';
import UPNG from 'upng-js';

const DARK = [14, 20, 32];
const LIGHT = [230, 234, 242];
const WARM = [245, 165, 36];

/** Signed-distance rounded rect coverage with 4x4 supersampling. */
function draw(size, { padding = 0, background = null } = {}) {
  const px = new Uint8Array(size * size * 4);
  const unit = (size - padding * 2) / 32;
  const shapes = [
    { x: 1, y: 1, w: 30, h: 30, r: 8, c: DARK, a: 1 },
    { x: 7, y: 7, w: 8, h: 8, r: 2, c: LIGHT, a: 1 },
    { x: 17, y: 7, w: 8, h: 8, r: 2, c: LIGHT, a: 0.55 },
    { x: 7, y: 17, w: 8, h: 8, r: 2, c: LIGHT, a: 0.55 },
    { x: 17, y: 17, w: 8, h: 8, r: 2, c: WARM, a: 1 },
  ];
  if (background) shapes[0] = { x: -100, y: -100, w: 300, h: 300, r: 0, c: DARK, a: 1 };
  const inside = (s, x, y) => {
    const cx = Math.min(Math.max(x, s.x + s.r), s.x + s.w - s.r);
    const cy = Math.min(Math.max(y, s.y + s.r), s.y + s.h - s.r);
    return (x - cx) ** 2 + (y - cy) ** 2 <= s.r ** 2 && x >= s.x && x <= s.x + s.w && y >= s.y && y <= s.y + s.h;
  };
  const SS = 4;
  for (let py = 0; py < size; py++) {
    for (let pxl = 0; pxl < size; pxl++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const x = (pxl + (sx + 0.5) / SS - padding) / unit;
          const y = (py + (sy + 0.5) / SS - padding) / unit;
          let cr = 0, cg = 0, cb = 0, ca = 0;
          for (const s of shapes) {
            if (!inside(s, x, y)) continue;
            // source-over
            cr = s.c[0] * s.a + cr * (1 - s.a);
            cg = s.c[1] * s.a + cg * (1 - s.a);
            cb = s.c[2] * s.a + cb * (1 - s.a);
            ca = s.a + ca * (1 - s.a);
          }
          r += cr; g += cg; b += cb; a += ca;
        }
      }
      const n = SS * SS;
      const i = (py * size + pxl) * 4;
      const alpha = a / n;
      px[i] = alpha ? Math.round(r / n / alpha) : 0;
      px[i + 1] = alpha ? Math.round(g / n / alpha) : 0;
      px[i + 2] = alpha ? Math.round(b / n / alpha) : 0;
      px[i + 3] = Math.round(alpha * 255);
    }
  }
  return Buffer.from(UPNG.encode([px.buffer], size, size, 0));
}

function ico(pngs) {
  const header = Buffer.alloc(6 + 16 * pngs.length);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngs.length, 4);
  let offset = header.length;
  pngs.forEach(({ size, data }, i) => {
    const e = 6 + i * 16;
    header.writeUInt8(size >= 256 ? 0 : size, e);
    header.writeUInt8(size >= 256 ? 0 : size, e + 1);
    header.writeUInt16LE(1, e + 4);
    header.writeUInt16LE(32, e + 6);
    header.writeUInt32LE(data.length, e + 8);
    header.writeUInt32LE(offset, e + 12);
    offset += data.length;
  });
  return Buffer.concat([header, ...pngs.map((p) => p.data)]);
}

mkdirSync('public/icons', { recursive: true });
writeFileSync('public/icons/icon-192.png', draw(192));
writeFileSync('public/icons/icon-512.png', draw(512));
writeFileSync('public/icons/icon-maskable-512.png', draw(512, { padding: 64, background: true }));
writeFileSync('public/apple-touch-icon.png', draw(180, { padding: 18, background: true }));
writeFileSync('public/favicon.ico', ico([16, 32, 48].map((size) => ({ size, data: draw(size) }))));
console.log('icons written');
