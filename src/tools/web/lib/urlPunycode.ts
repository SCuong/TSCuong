// Punycode (RFC 3492) for internationalized domain names. The browser's URL parser already
// converts Unicode hostnames to ASCII ("xn--" labels), so only decoding is needed here to
// show the human-readable form; encoding is provided for completeness and round-trip tests.

const BASE = 36;
const T_MIN = 1;
const T_MAX = 26;
const SKEW = 38;
const DAMP = 700;
const INITIAL_BIAS = 72;
const INITIAL_N = 128;
const MAX_INT = 0x7fffffff;

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

function digitValue(code: number): number {
  if (code >= 48 && code <= 57) return code - 22; // 0-9 -> 26-35
  if (code >= 65 && code <= 90) return code - 65; // A-Z
  if (code >= 97 && code <= 122) return code - 97; // a-z
  return BASE;
}

function digitChar(d: number): string {
  return String.fromCharCode(d + 22 + 75 * (d < 26 ? 1 : 0));
}

/** Decodes a single punycode label (without the "xn--" prefix). Throws on malformed input. */
export function punycodeDecode(input: string): string {
  const output: number[] = [];
  const basicEnd = input.lastIndexOf('-');
  for (let j = 0; j < Math.max(basicEnd, 0); j++) {
    const c = input.charCodeAt(j);
    if (c >= 0x80) throw new Error('Invalid punycode: non-basic character before delimiter');
    output.push(c);
  }
  let n = INITIAL_N;
  let bias = INITIAL_BIAS;
  let i = 0;
  for (let index = basicEnd > 0 ? basicEnd + 1 : 0; index < input.length; ) {
    const oldi = i;
    for (let w = 1, k = BASE; ; k += BASE) {
      if (index >= input.length) throw new Error('Invalid punycode: truncated input');
      const digit = digitValue(input.charCodeAt(index++));
      if (digit >= BASE) throw new Error('Invalid punycode: bad digit');
      if (digit > Math.floor((MAX_INT - i) / w)) throw new Error('Invalid punycode: overflow');
      i += digit * w;
      const t = k <= bias ? T_MIN : k >= bias + T_MAX ? T_MAX : k - bias;
      if (digit < t) break;
      if (w > Math.floor(MAX_INT / (BASE - t))) throw new Error('Invalid punycode: overflow');
      w *= BASE - t;
    }
    const out = output.length + 1;
    bias = adapt(i - oldi, out, oldi === 0);
    if (Math.floor(i / out) > MAX_INT - n) throw new Error('Invalid punycode: overflow');
    n += Math.floor(i / out);
    i %= out;
    output.splice(i++, 0, n);
  }
  return String.fromCodePoint(...output);
}

/** Encodes a single label to punycode (without the "xn--" prefix). */
export function punycodeEncode(input: string): string {
  const codes = Array.from(input, (ch) => ch.codePointAt(0)!);
  let n = INITIAL_N;
  let delta = 0;
  let bias = INITIAL_BIAS;
  let output = codes
    .filter((c) => c < 0x80)
    .map((c) => String.fromCharCode(c))
    .join('');
  const basicLength = output.length;
  let handled = basicLength;
  if (basicLength) output += '-';
  while (handled < codes.length) {
    let m = MAX_INT;
    for (const c of codes) if (c >= n && c < m) m = c;
    delta += (m - n) * (handled + 1);
    n = m;
    for (const c of codes) {
      if (c < n) delta++;
      if (c === n) {
        let q = delta;
        for (let k = BASE; ; k += BASE) {
          const t = k <= bias ? T_MIN : k >= bias + T_MAX ? T_MAX : k - bias;
          if (q < t) break;
          output += digitChar(t + ((q - t) % (BASE - t)));
          q = Math.floor((q - t) / (BASE - t));
        }
        output += digitChar(q);
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

/** Converts an ASCII hostname with "xn--" labels to its Unicode form. Malformed labels are kept as-is. */
export function hostnameToUnicode(hostname: string): string {
  return hostname
    .split('.')
    .map((label) => {
      if (!/^xn--/i.test(label)) return label;
      try {
        return punycodeDecode(label.slice(4).toLowerCase());
      } catch {
        return label;
      }
    })
    .join('.');
}

/** Converts a Unicode hostname to ASCII ("xn--" labels). Labels are lower-cased; no full IDNA mapping. */
export function hostnameToAscii(hostname: string): string {
  return hostname
    .split('.')
    .map((label) => {
      const lower = label.toLowerCase();
      const ascii = Array.from(lower).every((ch) => ch.charCodeAt(0) < 0x80);
      return ascii ? lower : `xn--${punycodeEncode(lower)}`;
    })
    .join('.');
}
