/** RFC 3492 Punycode plus IDNA conversion of domain names via the URL API. */

const BASE = 36;
const T_MIN = 1;
const T_MAX = 26;
const SKEW = 38;
const DAMP = 700;
const INITIAL_BIAS = 72;
const INITIAL_N = 128;
const MAX_INT = 0x7fffffff;

export class PunycodeError extends Error {}

function adapt(delta: number, numPoints: number, firstTime: boolean): number {
  let d = firstTime ? Math.floor(delta / DAMP) : delta >> 1;
  d += Math.floor(d / numPoints);
  let k = 0;
  while (d > ((BASE - T_MIN) * T_MAX) >> 1) {
    d = Math.floor(d / (BASE - T_MIN));
    k += BASE;
  }
  return k + Math.floor(((BASE - T_MIN + 1) * d) / (d + SKEW));
}

function digitToBasic(digit: number): number {
  // 0..25 → a..z, 26..35 → 0..9
  return digit + 22 + 75 * (digit < 26 ? 1 : 0);
}

function basicToDigit(code: number): number {
  if (code >= 0x30 && code <= 0x39) return code - 22; // 0-9 → 26-35
  if (code >= 0x41 && code <= 0x5a) return code - 0x41; // A-Z
  if (code >= 0x61 && code <= 0x7a) return code - 0x61; // a-z
  return BASE;
}

/** Encode a single label (no "xn--" prefix). */
export function punycodeEncode(input: string): string {
  const codePoints = Array.from(input, (c) => c.codePointAt(0)!);
  let n = INITIAL_N;
  let delta = 0;
  let bias = INITIAL_BIAS;
  let output = '';
  for (const cp of codePoints) if (cp < 0x80) output += String.fromCharCode(cp);
  const basicLength = output.length;
  let handled = basicLength;
  if (basicLength > 0) output += '-';
  while (handled < codePoints.length) {
    let m = MAX_INT;
    for (const cp of codePoints) if (cp >= n && cp < m) m = cp;
    if (m - n > Math.floor((MAX_INT - delta) / (handled + 1))) throw new PunycodeError('Input is too long to encode.');
    delta += (m - n) * (handled + 1);
    n = m;
    for (const cp of codePoints) {
      if (cp < n && ++delta > MAX_INT) throw new PunycodeError('Input is too long to encode.');
      if (cp === n) {
        let q = delta;
        for (let k = BASE; ; k += BASE) {
          const t = k <= bias ? T_MIN : k >= bias + T_MAX ? T_MAX : k - bias;
          if (q < t) break;
          output += String.fromCharCode(digitToBasic(t + ((q - t) % (BASE - t))));
          q = Math.floor((q - t) / (BASE - t));
        }
        output += String.fromCharCode(digitToBasic(q));
        bias = adapt(delta, handled + 1, handled === basicLength);
        delta = 0;
        handled++;
      }
    }
    delta++;
    n++;
  }
  return output;
}

/** Decode a single label (no "xn--" prefix). Throws PunycodeError on invalid input. */
export function punycodeDecode(input: string): string {
  const output: number[] = [];
  const basic = input.lastIndexOf('-');
  const start = basic > 0 ? basic : 0;
  for (let j = 0; j < start; j++) {
    const code = input.charCodeAt(j);
    if (code >= 0x80) throw new PunycodeError('Punycode may only contain ASCII characters.');
    output.push(code);
  }
  let n = INITIAL_N;
  let bias = INITIAL_BIAS;
  let i = 0;
  for (let index = basic > 0 ? basic + 1 : 0; index < input.length; ) {
    const oldi = i;
    for (let w = 1, k = BASE; ; k += BASE) {
      if (index >= input.length) throw new PunycodeError('Punycode ends in the middle of a character.');
      const digit = basicToDigit(input.charCodeAt(index++));
      if (digit >= BASE) throw new PunycodeError(`"${input[index - 1]}" is not a valid Punycode digit.`);
      if (digit > Math.floor((MAX_INT - i) / w)) throw new PunycodeError('Punycode value overflows.');
      i += digit * w;
      const t = k <= bias ? T_MIN : k >= bias + T_MAX ? T_MAX : k - bias;
      if (digit < t) break;
      if (w > Math.floor(MAX_INT / (BASE - t))) throw new PunycodeError('Punycode value overflows.');
      w *= BASE - t;
    }
    const out = output.length + 1;
    bias = adapt(i - oldi, out, oldi === 0);
    if (Math.floor(i / out) > MAX_INT - n) throw new PunycodeError('Punycode value overflows.');
    n += Math.floor(i / out);
    i %= out;
    if (n > 0x10ffff || (n >= 0xd800 && n <= 0xdfff)) throw new PunycodeError('Punycode decodes to an invalid code point.');
    output.splice(i++, 0, n);
  }
  return String.fromCodePoint(...output);
}

export type DomainResult = { ok: true; value: string } | { ok: false; error: string };

const SEPARATORS = /[.。．｡]/;

function splitHost(input: string): { host: string; rest: string; prefix: string } {
  // Accept full URLs: keep scheme/path around the converted host.
  const m = /^([a-z][a-z0-9+.-]*:\/\/(?:[^@/?#]*@)?)?([^/:?#]*)(.*)$/i.exec(input.trim());
  return { prefix: m?.[1] ?? '', host: m?.[2] ?? input.trim(), rest: m?.[3] ?? '' };
}

/**
 * Unicode domain → ASCII (IDNA/UTS #46 via the browser's URL parser, which also
 * lowercases, maps full-width characters and validates labels).
 */
export function domainToAscii(input: string): DomainResult {
  const { prefix, host, rest } = splitHost(input);
  if (!host) return { ok: false, error: 'Enter a domain name such as bücher.example.' };
  try {
    const url = new URL(`http://${host}/`);
    return { ok: true, value: prefix + url.hostname + rest };
  } catch {
    return { ok: false, error: `"${host}" is not a valid domain name (check for spaces, symbols or labels that are too long).` };
  }
}

/** ASCII (xn--) domain → Unicode, decoding each Punycode label. */
export function domainToUnicode(input: string): DomainResult {
  const { prefix, host, rest } = splitHost(input);
  if (!host) return { ok: false, error: 'Enter a domain name such as xn--bcher-kva.example.' };
  try {
    const labels = host.split(SEPARATORS).map((label) => {
      if (/^xn--/i.test(label)) {
        const decoded = punycodeDecode(label.slice(4).toLowerCase());
        if (!decoded) throw new PunycodeError(`"${label}" is an empty Punycode label.`);
        return decoded;
      }
      return label.toLowerCase();
    });
    return { ok: true, value: prefix + labels.join('.') + rest };
  } catch (error) {
    return { ok: false, error: error instanceof PunycodeError ? error.message : 'Invalid Punycode.' };
  }
}

/** Whether a Unicode label mixes scripts in a way that is typical for look-alike (homograph) domains. */
export function mixedScriptLabels(domain: string): string[] {
  const suspicious: string[] = [];
  for (const label of domain.split(SEPARATORS)) {
    const scripts = new Set<string>();
    for (const ch of label) {
      if (/\p{Script=Latin}/u.test(ch)) scripts.add('Latin');
      else if (/\p{Script=Cyrillic}/u.test(ch)) scripts.add('Cyrillic');
      else if (/\p{Script=Greek}/u.test(ch)) scripts.add('Greek');
    }
    if (scripts.size > 1) suspicious.push(label);
  }
  return suspicious;
}
