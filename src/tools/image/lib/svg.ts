/** SVG analysis and SVGO configuration helpers. */
import type { Config as SvgoConfig } from 'svgo/browser';
import { t } from '@/lib/i18n';

export interface SvgInfo {
  ok: boolean;
  error: string | null;
  width: string | null;
  height: string | null;
  viewBox: string | null;
  /** Rendered size in px (from width/height or viewBox), if determinable. */
  size: { width: number; height: number } | null;
  elements: number;
  warnings: string[];
}

const UNIT_PX: Record<string, number> = { px: 1, pt: 4 / 3, pc: 16, mm: 96 / 25.4, cm: 96 / 2.54, in: 96 };

function toPx(v: string | null): number | null {
  if (!v) return null;
  const m = /^\s*([\d.]+(?:e[+-]?\d+)?)\s*(px|pt|pc|mm|cm|in)?\s*$/i.exec(v);
  if (!m) return null;
  const n = parseFloat(m[1]) * UNIT_PX[(m[2] || 'px').toLowerCase()];
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * A readable message from a DOMParser <parsererror>. Chrome reports "…error on line 1 at
 * column 98: Unexpected closing tag… Below is a rendering of the page…", Firefox
 * "XML Parsing Error: mismatched tag… Location: … Line Number 1, Column 98: …".
 */
export function describeXmlError(raw: string): string {
  const msg = raw.replace(/\s+/g, ' ').trim();
  const chrome = /error on line (\d+) at column (\d+):\s*(.*?)\s*(?:Below is a rendering of the page.*)?$/i.exec(msg);
  const firefox = /XML Parsing Error:\s*(.*?)\s*Location:.*?Line Number (\d+), Column (\d+)/i.exec(msg);
  let line: string | undefined;
  let column: string | undefined;
  let detail: string;
  if (chrome) [, line, column, detail] = chrome;
  else if (firefox) [, detail, line, column] = firefox;
  else detail = msg.replace(/^.*?error[^:]*:\s*/i, '');
  // Namespaced names like "{http://www.w3.org/2000/svg}rect" → "rect".
  detail = detail.replace(/\{[^}]*\}/g, '').trim().replace(/[.:]+$/, '');
  const where = line ? ` at line ${line}${column ? `, column ${column}` : ''}` : '';
  return `Invalid XML${where}: ${detail.slice(0, 160) || 'the markup could not be parsed'}.`;
}

/** Parse and inspect SVG markup (uses DOMParser; nothing is rendered or executed). */
export function analyzeSvg(text: string): SvgInfo {
  const empty: SvgInfo = { ok: false, error: null, width: null, height: null, viewBox: null, size: null, elements: 0, warnings: [] };
  if (!text.trim()) return { ...empty, error: 'The SVG is empty.' };
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
  const err = doc.querySelector('parsererror');
  if (err) return { ...empty, error: describeXmlError(err.textContent || '') };
  const root = doc.documentElement;
  if (!root || root.localName !== 'svg') return { ...empty, error: `The root element is <${root?.localName ?? '?'}>, not <svg>.` };
  const width = root.getAttribute('width');
  const height = root.getAttribute('height');
  const viewBox = root.getAttribute('viewBox');
  const vb = viewBox?.trim().split(/[\s,]+/).map(Number);
  const vbOk = vb && vb.length === 4 && vb.every(Number.isFinite) && vb[2] > 0 && vb[3] > 0;
  let w = toPx(width);
  let h = toPx(height);
  if (vbOk) {
    if (w && !h) h = (w * vb![3]) / vb![2];
    else if (h && !w) w = (h * vb![2]) / vb![3];
    else if (!w && !h) {
      w = vb![2];
      h = vb![3];
    }
  }
  const warnings: string[] = [];
  const all = Array.from(root.querySelectorAll('*'));
  if (root.getAttribute('xmlns') !== 'http://www.w3.org/2000/svg' && root.namespaceURI !== 'http://www.w3.org/2000/svg') {
    warnings.push('Missing xmlns="http://www.w3.org/2000/svg": browsers will not render it as an image.');
  }
  if (!viewBox) warnings.push('No viewBox: the SVG will not scale cleanly.');
  else if (!vbOk) warnings.push(`The viewBox "${viewBox}" is invalid (expected four numbers with positive width and height).`);
  if (!w || !h) warnings.push('No usable width/height or viewBox: a default size of 300×150 may be used.');
  const scripts = all.filter((el) => el.localName === 'script').length;
  if (scripts) warnings.push(`Contains ${scripts} <script> element${scripts > 1 ? 's' : ''} (not executed in previews here).`);
  const handlers = [root, ...all].filter((el) => Array.from(el.attributes).some((a) => /^on/i.test(a.name))).length;
  if (handlers) warnings.push(`${handlers} element${handlers > 1 ? 's have' : ' has'} event handler attributes (onload, onclick…).`);
  if (all.some((el) => el.localName === 'foreignObject')) warnings.push('Contains <foreignObject> (HTML inside SVG), which some renderers ignore.');
  const remote = /^\s*(https?:)?\/\//i;
  // @import "…", @import url(…) and url(…) pointing at the web, in <style> or style="".
  const cssRemote = /(?:@import\s+(?:url\(\s*)?|url\(\s*)["']?\s*(?:https?:)?\/\//gi;
  const cssCount = (css: string | null | undefined) => (css ? (css.match(cssRemote)?.length ?? 0) : 0);
  const external =
    all.filter((el) => {
      const href = el.getAttribute('href') ?? el.getAttributeNS('http://www.w3.org/1999/xlink', 'href');
      return href && remote.test(href);
    }).length +
    [root, ...all].reduce((n, el) => n + Array.from(el.attributes).reduce((m, a) => m + cssCount(a.value), 0), 0) +
    all.filter((el) => el.localName === 'style').reduce((n, el) => n + cssCount(el.textContent), 0);
  if (external) warnings.push(`${external} external reference${external > 1 ? 's' : ''} (images/fonts from the web are blocked when used as an image).`);
  return {
    ok: true,
    error: null,
    width,
    height,
    viewBox,
    size: w && h ? { width: w, height: h } : null,
    elements: all.length + 1,
    warnings,
  };
}

export type SvgoPreset = 'safe' | 'default' | 'aggressive';

export interface SvgoOptions {
  preset: SvgoPreset;
  multipass: boolean;
  precision: number;
  pretty: boolean;
  /** Plugin toggles: true = enabled. Keys are SVGO plugin names. */
  plugins: Record<string, boolean>;
}

/** Plugins exposed as toggles, with whether they are part of preset-default. */
export const SVGO_TOGGLES: Array<{ name: string; label: string; inPreset: boolean; hint?: string }> = [
  { name: 'removeComments', label: t('Remove comments'), inPreset: true },
  { name: 'removeMetadata', label: t('Remove <metadata>'), inPreset: true },
  { name: 'removeEditorsNSData', label: t('Remove editor data (Inkscape, Illustrator…)'), inPreset: true },
  { name: 'removeDesc', label: t('Remove <desc>'), inPreset: true },
  { name: 'removeTitle', label: t('Remove <title>'), inPreset: false, hint: t('Titles are used by screen readers.') },
  { name: 'cleanupIds', label: t('Minify / remove unused IDs'), inPreset: true, hint: t('Breaks CSS or JS that targets IDs.') },
  { name: 'convertColors', label: t('Shorten colors'), inPreset: true },
  { name: 'convertPathData', label: t('Optimize path data'), inPreset: true },
  { name: 'convertShapeToPath', label: t('Convert shapes to paths'), inPreset: true },
  { name: 'mergePaths', label: t('Merge paths'), inPreset: true },
  { name: 'collapseGroups', label: t('Collapse useless groups'), inPreset: true },
  { name: 'inlineStyles', label: t('Inline <style> rules'), inPreset: true },
  { name: 'minifyStyles', label: t('Minify styles'), inPreset: true },
  { name: 'removeUnknownsAndDefaults', label: t('Remove default attributes'), inPreset: true },
  { name: 'removeHiddenElems', label: t('Remove hidden elements'), inPreset: true },
  { name: 'sortAttrs', label: t('Sort attributes'), inPreset: true },
  { name: 'removeDimensions', label: t('Remove width/height (keep viewBox)'), inPreset: false, hint: t('Makes the SVG responsive.') },
  { name: 'removeScripts', label: t('Remove scripts and event handlers'), inPreset: false },
  { name: 'removeViewBox', label: t('Remove viewBox'), inPreset: false, hint: t('Usually a bad idea: stops the SVG from scaling.') },
];

export function presetToggles(preset: SvgoPreset): Record<string, boolean> {
  const t: Record<string, boolean> = {};
  for (const p of SVGO_TOGGLES) t[p.name] = p.inPreset;
  if (preset === 'safe') {
    t.cleanupIds = false;
    t.mergePaths = false;
    t.convertShapeToPath = false;
    t.inlineStyles = false;
    t.collapseGroups = false;
  }
  if (preset === 'aggressive') {
    t.removeDimensions = true;
    t.removeScripts = true;
    t.removeTitle = true;
  }
  return t;
}

export function defaultPrecision(preset: SvgoPreset): number {
  return preset === 'aggressive' ? 1 : preset === 'safe' ? 3 : 3;
}

/** Build an SVGO v4 config object from UI options. */
export function buildSvgoConfig(o: SvgoOptions): SvgoConfig {
  const overrides: Record<string, false> = {};
  const extra: string[] = [];
  for (const p of SVGO_TOGGLES) {
    const on = o.plugins[p.name] ?? p.inPreset;
    if (p.inPreset && !on) overrides[p.name] = false;
    if (!p.inPreset && on) extra.push(p.name);
  }
  return {
    multipass: o.multipass,
    floatPrecision: Math.max(0, Math.min(8, Math.round(o.precision))),
    js2svg: { pretty: o.pretty, indent: 2 },
    plugins: [{ name: 'preset-default', params: { overrides } }, ...extra] as SvgoConfig['plugins'],
  };
}
