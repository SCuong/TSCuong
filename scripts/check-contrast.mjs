// Design-token contrast audit: every text token against every surface and tinted
// background it is used on, in both themes, using the values in src/styles/index.css.
// Usage: node scripts/check-contrast.mjs   (exits 1 if any pair is below its minimum)
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../src/styles/index.css', import.meta.url), 'utf8');

function block(selector) {
  const start = css.indexOf(selector);
  if (start === -1) throw new Error(`Missing ${selector}`);
  return css.slice(start, css.indexOf('\n}', start));
}

function tokens(text) {
  const out = {};
  for (const m of text.matchAll(/--lk-([a-z0-9-]+):\s*([^;]+);/g)) out[m[1]] = m[2].trim();
  return out;
}

function parse(value) {
  const hex = value.match(/^#([0-9a-f]{6})$/i);
  if (hex) return { rgb: [0, 2, 4].map((i) => parseInt(hex[1].slice(i, i + 2), 16)), a: 1 };
  const rgb = value.match(/^rgb\((\d+)\s+(\d+)\s+(\d+)\s*\/\s*([\d.]+)\)$/);
  if (rgb) return { rgb: rgb.slice(1, 4).map(Number), a: Number(rgb[4]) };
  return null;
}

const lin = (c) => ((c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const ratio = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};
const over = (fg, bg) => fg.rgb.map((c, i) => c * fg.a + bg[i] * (1 - fg.a));

const TEXT = ['text-primary', 'text-secondary', 'text-muted', 'accent-text', 'success', 'warning', 'danger'];
const SYNTAX = ['syn-keyword', 'syn-string', 'syn-number', 'syn-comment', 'syn-function', 'syn-property', 'syn-tag', 'syn-type', 'syn-attr'];
const SURFACES = ['bg', 'surface', 'surface-raised', 'surface-hover', 'surface-sunken'];
/** Tinted backgrounds and the text colours actually placed on them (badges, alerts, selected rows). */
const TINTS = {
  'accent-soft': ['text-primary', 'text-secondary', 'text-muted', 'accent-text'],
  'success-soft': ['success', 'text-primary'],
  'warning-soft': ['warning', 'text-primary'],
  'danger-soft': ['danger', 'text-primary'],
};

let failures = 0;
for (const [theme, selector] of [
  ['light', ":root,\n[data-theme='light'] {"],
  ['dark', "[data-theme='dark'] {"],
]) {
  const t = tokens(block(selector));
  const color = (name) => {
    const p = parse(t[name] ?? '');
    if (!p) throw new Error(`${theme}: cannot parse --lk-${name}: ${t[name]}`);
    return p;
  };
  const check = (fgName, bgLabel, bg, min = 4.5) => {
    const r = ratio(over(color(fgName), bg), bg);
    if (r < min) {
      failures++;
      console.log(`FAIL ${theme.padEnd(5)} ${fgName.padEnd(15)} on ${bgLabel.padEnd(28)} ${r.toFixed(2)} < ${min}`);
    }
    return r;
  };
  for (const s of SURFACES) {
    const bg = color(s).rgb;
    for (const fg of TEXT) check(fg, s, bg);
  }
  // Code is shown on sunken surfaces (editors) and surfaces (read-only panels).
  for (const s of ['surface', 'surface-sunken', 'surface-hover']) {
    for (const fg of SYNTAX) check(fg, `${s} (code)`, color(s).rgb);
  }
  // Filled buttons: their label color on every fill state they can show.
  for (const fill of ['accent', 'accent-hover']) check('accent-contrast', `${fill} (button)`, color(fill).rgb);
  check('accent-contrast', 'danger-solid (button)', color('danger-solid').rgb);
  for (const [tint, fgs] of Object.entries(TINTS)) {
    for (const s of ['bg', 'surface', 'surface-raised']) {
      const bg = over(color(tint), color(s).rgb);
      for (const fg of fgs) check(fg, `${tint} over ${s}`, bg);
    }
  }
}
console.log(failures ? `\n${failures} token pairs below the WCAG AA minimum` : 'All token pairs meet WCAG AA (4.5:1).');
process.exitCode = failures ? 1 : 0;
