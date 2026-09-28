/** Unicode inspection: per code point properties without shipping the Unicode database. */

export const GENERAL_CATEGORIES: Array<{ code: string; name: string }> = [
  { code: 'Lu', name: 'Uppercase letter' },
  { code: 'Ll', name: 'Lowercase letter' },
  { code: 'Lt', name: 'Titlecase letter' },
  { code: 'Lm', name: 'Modifier letter' },
  { code: 'Lo', name: 'Other letter' },
  { code: 'Mn', name: 'Nonspacing mark' },
  { code: 'Mc', name: 'Spacing mark' },
  { code: 'Me', name: 'Enclosing mark' },
  { code: 'Nd', name: 'Decimal number' },
  { code: 'Nl', name: 'Letter number' },
  { code: 'No', name: 'Other number' },
  { code: 'Pc', name: 'Connector punctuation' },
  { code: 'Pd', name: 'Dash punctuation' },
  { code: 'Ps', name: 'Open punctuation' },
  { code: 'Pe', name: 'Close punctuation' },
  { code: 'Pi', name: 'Initial quote' },
  { code: 'Pf', name: 'Final quote' },
  { code: 'Po', name: 'Other punctuation' },
  { code: 'Sm', name: 'Math symbol' },
  { code: 'Sc', name: 'Currency symbol' },
  { code: 'Sk', name: 'Modifier symbol' },
  { code: 'So', name: 'Other symbol' },
  { code: 'Zs', name: 'Space separator' },
  { code: 'Zl', name: 'Line separator' },
  { code: 'Zp', name: 'Paragraph separator' },
  { code: 'Cc', name: 'Control' },
  { code: 'Cf', name: 'Format' },
  { code: 'Cs', name: 'Surrogate' },
  { code: 'Co', name: 'Private use' },
  { code: 'Cn', name: 'Unassigned' },
];

const CATEGORY_TESTS = GENERAL_CATEGORIES.map((c) => ({ ...c, re: new RegExp(`^\\p{gc=${c.code}}$`, 'u') }));

export function generalCategory(ch: string): { code: string; name: string } {
  for (const c of CATEGORY_TESTS) if (c.re.test(ch)) return { code: c.code, name: c.name };
  return { code: 'Cn', name: 'Unassigned' };
}

const SCRIPTS = [
  'Latin', 'Greek', 'Cyrillic', 'Armenian', 'Hebrew', 'Arabic', 'Syriac', 'Thaana', 'Devanagari', 'Bengali', 'Gurmukhi',
  'Gujarati', 'Tamil', 'Telugu', 'Kannada', 'Malayalam', 'Sinhala', 'Thai', 'Lao', 'Tibetan', 'Myanmar', 'Georgian',
  'Hangul', 'Ethiopic', 'Cherokee', 'Khmer', 'Mongolian', 'Hiragana', 'Katakana', 'Bopomofo', 'Han', 'Common', 'Inherited',
].map((name) => ({ name, re: new RegExp(`^\\p{Script=${name}}$`, 'u') }));

export function scriptOf(ch: string): string {
  for (const s of SCRIPTS) if (s.re.test(ch)) return s.name;
  return 'Other';
}

/** Names for characters that commonly cause trouble in pasted text. */
export const SPECIAL_NAMES: Record<number, string> = {
  0x00: 'NULL', 0x07: 'BELL', 0x08: 'BACKSPACE', 0x09: 'CHARACTER TABULATION', 0x0a: 'LINE FEED', 0x0b: 'LINE TABULATION',
  0x0c: 'FORM FEED', 0x0d: 'CARRIAGE RETURN', 0x1b: 'ESCAPE', 0x20: 'SPACE', 0x7f: 'DELETE', 0x85: 'NEXT LINE',
  0xa0: 'NO-BREAK SPACE', 0xad: 'SOFT HYPHEN', 0x34f: 'COMBINING GRAPHEME JOINER', 0x61c: 'ARABIC LETTER MARK',
  0x115f: 'HANGUL CHOSEONG FILLER', 0x1160: 'HANGUL JUNGSEONG FILLER', 0x180e: 'MONGOLIAN VOWEL SEPARATOR',
  0x2000: 'EN QUAD', 0x2001: 'EM QUAD', 0x2002: 'EN SPACE', 0x2003: 'EM SPACE', 0x2004: 'THREE-PER-EM SPACE',
  0x2005: 'FOUR-PER-EM SPACE', 0x2006: 'SIX-PER-EM SPACE', 0x2007: 'FIGURE SPACE', 0x2008: 'PUNCTUATION SPACE',
  0x2009: 'THIN SPACE', 0x200a: 'HAIR SPACE', 0x200b: 'ZERO WIDTH SPACE', 0x200c: 'ZERO WIDTH NON-JOINER',
  0x200d: 'ZERO WIDTH JOINER', 0x200e: 'LEFT-TO-RIGHT MARK', 0x200f: 'RIGHT-TO-LEFT MARK', 0x2028: 'LINE SEPARATOR',
  0x2029: 'PARAGRAPH SEPARATOR', 0x202a: 'LEFT-TO-RIGHT EMBEDDING', 0x202b: 'RIGHT-TO-LEFT EMBEDDING',
  0x202c: 'POP DIRECTIONAL FORMATTING', 0x202d: 'LEFT-TO-RIGHT OVERRIDE', 0x202e: 'RIGHT-TO-LEFT OVERRIDE',
  0x202f: 'NARROW NO-BREAK SPACE', 0x205f: 'MEDIUM MATHEMATICAL SPACE', 0x2060: 'WORD JOINER',
  0x2061: 'FUNCTION APPLICATION', 0x2062: 'INVISIBLE TIMES', 0x2063: 'INVISIBLE SEPARATOR', 0x2064: 'INVISIBLE PLUS',
  0x2066: 'LEFT-TO-RIGHT ISOLATE', 0x2067: 'RIGHT-TO-LEFT ISOLATE', 0x2068: 'FIRST STRONG ISOLATE',
  0x2069: 'POP DIRECTIONAL ISOLATE', 0x3000: 'IDEOGRAPHIC SPACE', 0x3164: 'HANGUL FILLER', 0xfe0e: 'VARIATION SELECTOR-15 (text)',
  0xfe0f: 'VARIATION SELECTOR-16 (emoji)', 0xfeff: 'ZERO WIDTH NO-BREAK SPACE (BOM)', 0xfffc: 'OBJECT REPLACEMENT CHARACTER',
  0xfffd: 'REPLACEMENT CHARACTER', 0xffa0: 'HALFWIDTH HANGUL FILLER',
};

const BIDI_CONTROLS = new Set([0x061c, 0x200e, 0x200f, 0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2066, 0x2067, 0x2068, 0x2069]);
const INVISIBLE = new Set([
  0x00ad, 0x034f, 0x115f, 0x1160, 0x180e, 0x200b, 0x200c, 0x200d, 0x2060, 0x2061, 0x2062, 0x2063, 0x2064, 0x3164, 0xfeff, 0xffa0,
]);

export type Flag = 'control' | 'invisible' | 'bidi' | 'combining' | 'whitespace' | 'nonstandard-space' | 'surrogate' | 'private' | 'unassigned' | 'variation' | 'replacement';

export interface CodePointInfo {
  char: string;
  codePoint: number;
  label: string;
  utf8: number[];
  utf16: number[];
  category: { code: string; name: string };
  script: string;
  name: string | null;
  flags: Flag[];
}

export interface GraphemeInfo {
  grapheme: string;
  index: number;
  codePoints: CodePointInfo[];
}

const infoCache = new Map<string, CodePointInfo>();

/** Properties of a single code point (cached: texts reuse few distinct characters). */
export function describeCodePoint(ch: string): CodePointInfo {
  let info = infoCache.get(ch);
  if (!info) {
    if (infoCache.size > 20000) infoCache.clear();
    info = computeInfo(ch);
    infoCache.set(ch, info);
  }
  return info;
}

function computeInfo(ch: string): CodePointInfo {
  const cp = ch.codePointAt(0)!;
  const category = generalCategory(ch);
  const flags: Flag[] = [];
  if (category.code === 'Cc') flags.push('control');
  if (category.code === 'Cs') flags.push('surrogate');
  if (category.code === 'Co') flags.push('private');
  if (category.code === 'Cn') flags.push('unassigned');
  if (category.code === 'Mn' || category.code === 'Me' || category.code === 'Mc') flags.push('combining');
  if (BIDI_CONTROLS.has(cp)) flags.push('bidi');
  if (INVISIBLE.has(cp) || (category.code === 'Cf' && !BIDI_CONTROLS.has(cp) && !(cp >= 0xfe00 && cp <= 0xfe0f))) flags.push('invisible');
  if ((cp >= 0xfe00 && cp <= 0xfe0f) || (cp >= 0xe0100 && cp <= 0xe01ef)) flags.push('variation');
  if (cp === 0xfffd) flags.push('replacement');
  if (/\s/u.test(ch)) flags.push(cp === 0x20 || cp === 0x09 || cp === 0x0a || cp === 0x0d ? 'whitespace' : 'nonstandard-space');
  const utf16: number[] = [];
  for (let i = 0; i < ch.length; i++) utf16.push(ch.charCodeAt(i));
  const utf8 = category.code === 'Cs' ? [0xef, 0xbf, 0xbd] : Array.from(new TextEncoder().encode(ch));
  return {
    char: ch,
    codePoint: cp,
    label: `U+${cp.toString(16).toUpperCase().padStart(4, '0')}`,
    utf8,
    utf16,
    category,
    script: scriptOf(ch),
    name: SPECIAL_NAMES[cp] ?? (cp >= 0xe0000 && cp <= 0xe007f ? 'TAG CHARACTER' : null),
    flags: [...new Set(flags)],
  };
}

/** Split into code points, keeping lone surrogates as their own entries. */
export function codePointsOf(text: string): string[] {
  return Array.from(text);
}

export function inspectText(text: string, maxGraphemes = 5000): { graphemes: GraphemeInfo[]; truncated: boolean } {
  const out: GraphemeInfo[] = [];
  let truncated = false;
  const segmenter = typeof Intl.Segmenter === 'function' ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;
  const segments: Iterable<{ segment: string; index: number }> = segmenter
    ? segmenter.segment(text)
    : (function* () {
        let index = 0;
        for (const c of text) {
          yield { segment: c, index };
          index += c.length;
        }
      })();
  for (const s of segments) {
    if (out.length >= maxGraphemes) {
      truncated = true;
      break;
    }
    out.push({ grapheme: s.segment, index: s.index, codePoints: codePointsOf(s.segment).map(describeCodePoint) });
  }
  return { graphemes: out, truncated };
}

export interface InspectSummary {
  graphemes: number;
  codePoints: number;
  utf16: number;
  utf8Bytes: number;
  invisible: number;
  bidi: number;
  control: number;
  combining: number;
  nonstandardSpaces: number;
  rtlCharacters: number;
  scripts: string[];
  isNFC: boolean;
}

export function summarize(text: string): InspectSummary {
  let codePoints = 0;
  let utf8Bytes = 0;
  let invisible = 0;
  let bidi = 0;
  let control = 0;
  let combining = 0;
  let nonstandardSpaces = 0;
  let rtl = 0;
  const scripts = new Set<string>();
  let prev = '';
  for (const ch of text) {
    codePoints++;
    const info = describeCodePoint(ch);
    utf8Bytes += info.utf8.length;
    // A zero-width joiner after an emoji is part of an emoji sequence (👨‍👩‍👧), not a hidden character.
    const emojiJoiner = info.codePoint === 0x200d && /\p{Extended_Pictographic}|\p{Emoji_Modifier}|\ufe0f/u.test(prev);
    if (info.flags.includes('invisible') && !emojiJoiner) invisible++;
    prev = ch;
    if (info.flags.includes('bidi')) bidi++;
    if (info.flags.includes('control') && !/[\n\r\t]/.test(ch)) control++;
    if (info.flags.includes('combining')) combining++;
    if (info.flags.includes('nonstandard-space')) nonstandardSpaces++;
    if (/\p{Script=Hebrew}|\p{Script=Arabic}|\p{Script=Syriac}|\p{Script=Thaana}|\p{Script=Nko}/u.test(ch)) rtl++;
    if (info.script !== 'Common' && info.script !== 'Inherited') scripts.add(info.script);
  }
  const graphemes =
    typeof Intl.Segmenter === 'function' ? Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)).length : codePoints;
  return {
    graphemes,
    codePoints,
    utf16: text.length,
    utf8Bytes,
    invisible,
    bidi,
    control,
    combining,
    nonstandardSpaces,
    rtlCharacters: rtl,
    scripts: Array.from(scripts),
    isNFC: text.normalize('NFC') === text,
  };
}

/** Remove invisible, bidi-control and non-printing control characters (keeps \n, \r, \t). */
export function stripInvisible(text: string): string {
  let out = '';
  for (const ch of text) {
    const info = describeCodePoint(ch);
    if (info.flags.includes('bidi') || (info.flags.includes('invisible') && info.codePoint !== 0x200d)) continue;
    if (info.flags.includes('control') && !/[\n\r\t]/.test(ch)) continue;
    out += ch;
  }
  return out;
}
