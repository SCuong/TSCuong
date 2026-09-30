export const ROMAN_MIN = 1;
export const ROMAN_MAX = 3999;

const TABLE: Array<[number, string]> = [
  [1000, 'M'],
  [900, 'CM'],
  [500, 'D'],
  [400, 'CD'],
  [100, 'C'],
  [90, 'XC'],
  [50, 'L'],
  [40, 'XL'],
  [10, 'X'],
  [9, 'IX'],
  [5, 'V'],
  [4, 'IV'],
  [1, 'I'],
];

const VALUES: Record<string, number> = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 };

export interface RomanPart {
  symbol: string;
  value: number;
}

export type RomanResult<T> = { ok: true; value: T; parts: RomanPart[] } | { ok: false; error: string };

export function toRoman(n: number): RomanResult<string> {
  if (!Number.isFinite(n)) return { ok: false, error: 'Enter a whole number.' };
  if (!Number.isInteger(n)) return { ok: false, error: 'Roman numerals only represent whole numbers.' };
  if (n < ROMAN_MIN) return { ok: false, error: 'Roman numerals start at 1 (there is no zero or negative numeral).' };
  if (n > ROMAN_MAX) return { ok: false, error: `Standard Roman numerals go up to ${ROMAN_MAX} (MMMCMXCIX).` };
  let rest = n;
  const parts: RomanPart[] = [];
  for (const [value, symbol] of TABLE) {
    while (rest >= value) {
      parts.push({ symbol, value });
      rest -= value;
    }
  }
  return { ok: true, value: parts.map((p) => p.symbol).join(''), parts };
}

/** Strict parser: only accepts the canonical (subtractive) form, e.g. rejects IIII, VV, IC, MMMM. */
export function fromRoman(input: string): RomanResult<number> {
  const s = input.trim().toUpperCase();
  if (!s) return { ok: false, error: 'Enter a Roman numeral.' };
  // Check the characters as typed (code points), so emoji or letters whose upper case is longer ("ß")
  // are reported at their real position.
  const typed = [...input.trim()];
  const bad = typed.findIndex((c) => !Object.hasOwn(VALUES, c.toUpperCase()));
  if (bad >= 0) {
    return { ok: false, error: `'${typed[bad]}' at position ${bad + 1} is not a Roman numeral letter (use I, V, X, L, C, D, M).` };
  }
  for (const c of ['V', 'L', 'D']) {
    if (s.split(c).length > 2) return { ok: false, error: `'${c}' can appear only once.` };
  }
  const run = /(I{4,}|X{4,}|C{4,}|M{4,})/.exec(s);
  if (run) {
    const c = run[1][0];
    return {
      ok: false,
      error:
        c === 'M'
          ? `'${run[1]}' is too many M's: the largest standard numeral is MMMCMXCIX (3999).`
          : `'${run[1]}' repeats '${c}' more than three times; use the subtractive form (e.g. IV, XL, CD).`,
    };
  }
  // Tokenize greedily using the canonical table and check order.
  const parts: RomanPart[] = [];
  let i = 0;
  let total = 0;
  while (i < s.length) {
    const two = s.slice(i, i + 2);
    const pair = TABLE.find(([, sym]) => sym.length === 2 && sym === two);
    if (pair) {
      parts.push({ symbol: pair[1], value: pair[0] });
      total += pair[0];
      i += 2;
      continue;
    }
    const cur = VALUES[s[i]];
    const next = i + 1 < s.length ? VALUES[s[i + 1]] : 0;
    if (next > cur) {
      return {
        ok: false,
        error: `'${s[i]}${s[i + 1]}' is not a valid subtraction; only IV, IX, XL, XC, CD and CM are allowed.`,
      };
    }
    parts.push({ symbol: s[i], value: cur });
    total += cur;
    i++;
  }
  const canonical = toRoman(total);
  if (!canonical.ok) return canonical;
  if (canonical.value !== s) {
    return { ok: false, error: `'${s}' is not in standard form. Did you mean ${canonical.value} (${total})?` };
  }
  return { ok: true, value: total, parts: canonical.parts };
}
