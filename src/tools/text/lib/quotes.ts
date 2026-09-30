export interface SmartOptions {
  quotes: boolean;
  /** 'em' turns "--" into an em dash; 'oldschool' turns "---" into an em dash and "--" into an en dash. */
  dashes: 'off' | 'em' | 'oldschool';
  ellipsis: boolean;
}

export const DEFAULT_SMART_OPTIONS: SmartOptions = { quotes: true, dashes: 'oldschool', ellipsis: true };

const OPENING_CONTEXT = /[\s([{—–<\-/]/u;

function isOpeningPosition(prev: string | undefined): boolean {
  return prev === undefined || OPENING_CONTEXT.test(prev) || prev === '“' || prev === '‘';
}

/** Straight quotes → typographic quotes, "--" → dashes, "..." → ellipsis. */
export function toSmart(text: string, opts: Partial<SmartOptions> = {}): string {
  const o = { ...DEFAULT_SMART_OPTIONS, ...opts };
  let s = text;
  if (o.ellipsis) s = s.replace(/\.\.\./g, '…');
  if (o.dashes === 'oldschool') s = s.replace(/---/g, '—').replace(/--/g, '–');
  else if (o.dashes === 'em') s = s.replace(/---?/g, '—');
  if (!o.quotes) return s;

  const chars = Array.from(s);
  let out = '';
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    const prev = i > 0 ? chars[i - 1] : undefined;
    const next = chars[i + 1];
    if (ch === '"') {
      const opening = isOpeningPosition(prev) && next !== undefined && !/\s/u.test(next);
      out += opening ? '“' : '”';
    } else if (ch === "'") {
      const prevIsWord = prev !== undefined && /[\p{L}\p{N}]/u.test(prev);
      const nextIsWord = next !== undefined && /[\p{L}\p{N}]/u.test(next);
      if (prevIsWord) {
        out += '’'; // contraction or closing quote: don't, dogs'
      } else if (isOpeningPosition(prev) && nextIsWord) {
        // Decade abbreviations and elisions: '90s, 'til, 'em, 'n'
        const rest = chars.slice(i + 1, i + 5).join('');
        out += /^(\d\ds|til\b|tis\b|twas\b|em\b|n'?\s|cause\b|round\b)/iu.test(rest) ? '’' : '‘';
      } else if (isOpeningPosition(prev) && next !== undefined && !/\s/u.test(next)) {
        out += '‘';
      } else {
        out += '’';
      }
    } else {
      out += ch;
    }
  }
  return out;
}

/** Typographic punctuation → plain ASCII. */
export function toStraight(text: string, opts: Partial<SmartOptions> = {}): string {
  const o = { ...DEFAULT_SMART_OPTIONS, ...opts };
  let s = text;
  if (o.quotes) {
    s = s.replace(/[‘’‚‛′‹›]/g, "'").replace(/[“”„‟″«»]/g, '"');
  }
  if (o.dashes !== 'off') {
    s = o.dashes === 'oldschool' ? s.replace(/—/g, '---').replace(/–/g, '--') : s.replace(/[—–]/g, '--');
    s = s.replace(/[‐‑‒−]/g, '-');
  }
  if (o.ellipsis) s = s.replace(/…/g, '...');
  return s;
}

export function countTypographic(text: string): number {
  let n = 0;
  for (const _ of text.matchAll(/[‘’‚‛“”„‟–—…′″«»‹›‐‑‒−]/g)) n++;
  return n;
}

export type QuoteDirection = 'smart' | 'straight';

/**
 * Convert in either direction. `marks` is the number of typographic marks in the result
 * (straight → curly) or the number that were replaced by plain ASCII (curly → straight).
 */
export function convertQuotes(text: string, direction: QuoteDirection, opts: Partial<SmartOptions> = {}): { text: string; marks: number } {
  if (direction === 'smart') {
    const out = toSmart(text, opts);
    return { text: out, marks: countTypographic(out) };
  }
  const out = toStraight(text, opts);
  return { text: out, marks: countTypographic(text) - countTypographic(out) };
}
