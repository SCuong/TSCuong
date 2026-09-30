export function gcd(a: number, b: number): number {
  let x = Math.abs(Math.round(a));
  let y = Math.abs(Math.round(b));
  while (y) [x, y] = [y, x % y];
  return x;
}

export interface Ratio {
  w: number;
  h: number;
}

/** Simplifies a ratio of integers, or approximates decimals (1.85:1, 2.39:1) with a small denominator. */
export function simplifyRatio(w: number, h: number): Ratio | null {
  if (!(w > 0) || !(h > 0) || !Number.isFinite(w) || !Number.isFinite(h)) return null;
  if (Number.isInteger(w) && Number.isInteger(h)) {
    const d = gcd(w, h);
    return { w: w / d, h: h / d };
  }
  const value = w / h;
  const r = approximate(value);
  // A small fraction cannot express extreme ratios (0.5 : 1280 would become 0:1): keep the numbers as given.
  if (r.w <= 0 || r.h <= 0 || Math.abs(r.w / r.h - value) / value > 0.001) return { w, h };
  return r;
}

/** Best rational approximation with denominator ≤ maxDen (continued fractions). */
export function approximate(value: number, maxDen = 100): Ratio {
  let [h0, h1, k0, k1] = [0, 1, 1, 0];
  let x = value;
  for (let i = 0; i < 64; i++) {
    const a = Math.floor(x);
    const h2 = a * h1 + h0;
    const k2 = a * k1 + k0;
    if (k2 > maxDen) break;
    [h0, h1, k0, k1] = [h1, h2, k1, k2];
    if (Math.abs(x - a) < 1e-12) break;
    x = 1 / (x - a);
  }
  return { w: h1, h: k1 };
}

export function solveHeight(width: number, ratio: Ratio): number {
  return (width * ratio.h) / ratio.w;
}

export function solveWidth(height: number, ratio: Ratio): number {
  return (height * ratio.w) / ratio.h;
}

export function ratioDecimal(ratio: Ratio): number {
  return ratio.w / ratio.h;
}

export const RATIO_PRESETS: Array<{ label: string; ratio: Ratio; use: string }> = [
  { label: '16:9', ratio: { w: 16, h: 9 }, use: 'HD video, most screens' },
  { label: '4:3', ratio: { w: 4, h: 3 }, use: 'Classic TV, iPad' },
  { label: '3:2', ratio: { w: 3, h: 2 }, use: '35mm photos' },
  { label: '1:1', ratio: { w: 1, h: 1 }, use: 'Square posts, avatars' },
  { label: '4:5', ratio: { w: 4, h: 5 }, use: 'Portrait social posts' },
  { label: '9:16', ratio: { w: 9, h: 16 }, use: 'Stories, vertical video' },
  { label: '21:9', ratio: { w: 21, h: 9 }, use: 'Ultrawide monitors' },
  { label: '2:1', ratio: { w: 2, h: 1 }, use: 'Univisium, banners' },
  { label: '1.91:1', ratio: { w: 191, h: 100 }, use: 'Open Graph images (1200×630)' },
];

/** Common pixel sizes for a ratio (exact integer sizes only). */
export function commonSizes(ratio: Ratio): Array<{ w: number; h: number }> {
  const widths = [320, 480, 640, 720, 800, 960, 1024, 1080, 1200, 1280, 1440, 1600, 1920, 2048, 2560, 3840];
  const out: Array<{ w: number; h: number }> = [];
  for (const w of widths) {
    const h = solveHeight(w, ratio);
    if (Number.isInteger(Math.round(h * 1e9) / 1e9)) out.push({ w, h: Math.round(h) });
  }
  return out;
}

/** Parses "16:9", "16/9", "16x9", "1.85:1" or a single decimal such as "2.39". */
export function parseRatio(text: string): Ratio | null {
  const t = text.trim().replace(/\s+/g, '');
  if (!t) return null;
  const m = /^(\d+(?:\.\d+)?|\.\d+)(?:[:/x×](\d+(?:\.\d+)?|\.\d+))?$/i.exec(t);
  if (!m) return null;
  const w = Number(m[1]);
  const h = m[2] === undefined ? 1 : Number(m[2]);
  if (!(w > 0) || !(h > 0)) return null;
  return { w, h };
}

/** Rounds to at most `digits` decimals and drops trailing zeros. */
export function fmt(value: number, digits = 4): string {
  if (!Number.isFinite(value)) return '';
  return String(Number(value.toFixed(digits)));
}

/** Formats a ratio for CSS or display, simplifying integer ratios. */
export function ratioLabel(ratio: Ratio, sep = ':'): string {
  const s = simplifyRatio(ratio.w, ratio.h);
  if (s && Number.isInteger(ratio.w) && Number.isInteger(ratio.h)) return `${s.w}${sep}${s.h}`;
  return `${fmt(ratio.w)}${sep}${fmt(ratio.h)}`;
}

/** Height as a percentage of width, for the classic padding-top aspect-ratio hack. */
export function paddingPercent(ratio: Ratio): string {
  return `${fmt((ratio.h / ratio.w) * 100)}%`;
}

export function cssSnippets(ratio: Ratio): { modern: string; legacy: string } {
  const r = ratioLabel(ratio, ' / ');
  return {
    modern: `.box {\n  aspect-ratio: ${r};\n  width: 100%;\n}`,
    legacy: `.box {\n  position: relative;\n  width: 100%;\n  height: 0;\n  padding-top: ${paddingPercent(ratio)}; /* ${ratioLabel(ratio)} */\n}\n.box > * {\n  position: absolute;\n  inset: 0;\n  width: 100%;\n  height: 100%;\n}`,
  };
}
