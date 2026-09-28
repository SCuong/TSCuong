export const CSS_UNITS = ['px', 'rem', 'em', '%', 'vw', 'vh', 'vmin', 'vmax', 'pt', 'pc', 'in', 'cm', 'mm', 'Q'] as const;
export type CssUnit = (typeof CSS_UNITS)[number];

export interface UnitContext {
  /** Root (html) font size in px, for rem. */
  rootFontSize: number;
  /** Parent element font size in px, for em. */
  parentFontSize: number;
  viewportWidth: number;
  viewportHeight: number;
  /** The length that 100% refers to, in px (e.g. the parent's width). */
  percentBase: number;
}

export const DEFAULT_CONTEXT: UnitContext = {
  rootFontSize: 16,
  parentFontSize: 16,
  viewportWidth: 1440,
  viewportHeight: 900,
  percentBase: 1200,
};

export const UNIT_INFO: Record<CssUnit, string> = {
  px: 'CSS pixels (1/96 inch)',
  rem: 'Root font size',
  em: 'Parent font size',
  '%': 'Percent of the reference length',
  vw: '1% of viewport width',
  vh: '1% of viewport height',
  vmin: '1% of the smaller viewport side',
  vmax: '1% of the larger viewport side',
  pt: 'Points (1/72 inch)',
  pc: 'Picas (12 points)',
  in: 'Inches (96px)',
  cm: 'Centimeters',
  mm: 'Millimeters',
  Q: 'Quarter-millimeters',
};

/** px per one unit. */
export function pxPerUnit(unit: CssUnit, ctx: UnitContext): number {
  switch (unit) {
    case 'px':
      return 1;
    case 'rem':
      return ctx.rootFontSize;
    case 'em':
      return ctx.parentFontSize;
    case '%':
      return ctx.percentBase / 100;
    case 'vw':
      return ctx.viewportWidth / 100;
    case 'vh':
      return ctx.viewportHeight / 100;
    case 'vmin':
      return Math.min(ctx.viewportWidth, ctx.viewportHeight) / 100;
    case 'vmax':
      return Math.max(ctx.viewportWidth, ctx.viewportHeight) / 100;
    case 'pt':
      return 96 / 72;
    case 'pc':
      return 16;
    case 'in':
      return 96;
    case 'cm':
      return 96 / 2.54;
    case 'mm':
      return 96 / 25.4;
    case 'Q':
      return 96 / 101.6;
  }
}

export function convert(value: number, from: CssUnit, to: CssUnit, ctx: UnitContext): number {
  const perTo = pxPerUnit(to, ctx);
  if (perTo === 0) return NaN;
  return (value * pxPerUnit(from, ctx)) / perTo;
}

export function formatNumber(n: number, precision: number): string {
  if (!Number.isFinite(n)) return '—';
  const r = Number(n.toFixed(precision));
  return String(Object.is(r, -0) ? 0 : r);
}

export interface ParsedLength {
  value: number;
  unit: CssUnit;
}

const UNIT_LOOKUP = new Map(CSS_UNITS.map((u) => [u.toLowerCase(), u]));

/** Parses "16px", "1.5 rem", "-2.25em", ".5in", "100%". A bare number uses `defaultUnit`. */
export function parseLength(text: string, defaultUnit: CssUnit = 'px'): ParsedLength | null {
  const m = /^\s*([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)\s*([a-z%]*)\s*$/i.exec(text);
  if (!m) return null;
  const value = Number(m[1]);
  if (!Number.isFinite(value)) return null;
  if (!m[2]) return { value, unit: defaultUnit };
  const unit = m[2] === 'Q' ? 'Q' : UNIT_LOOKUP.get(m[2].toLowerCase());
  return unit ? { value, unit } : null;
}

export interface BatchRow {
  input: string;
  parsed: ParsedLength | null;
  result: string | null;
  error: string | null;
}

/** Converts a list of lengths (comma-, semicolon- or newline-separated) to one unit. */
export function batchConvert(text: string, to: CssUnit, ctx: UnitContext, precision: number, defaultUnit: CssUnit = 'px'): BatchRow[] {
  return text
    .split(/[\n,;]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((input) => {
      const parsed = parseLength(input, defaultUnit);
      if (!parsed) return { input, parsed: null, result: null, error: 'Not a CSS length' };
      const n = convert(parsed.value, parsed.unit, to, ctx);
      if (!Number.isFinite(n)) return { input, parsed, result: null, error: 'Reference size is 0' };
      return { input, parsed, result: `${formatNumber(n, precision)}${to}`, error: null };
    });
}
