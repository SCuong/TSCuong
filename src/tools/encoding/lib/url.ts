export type UrlEncodeMode = 'component' | 'uri' | 'form';

/** Characters encodeURIComponent leaves alone that RFC 3986 reserves: ! ' ( ) * */
function strictComponent(text: string): string {
  return encodeURIComponent(text).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

export type UrlResult = { ok: true; text: string } | { ok: false; error: string };

function hasLoneSurrogate(text: string): boolean {
  return /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/.test(text);
}

export interface UrlEncodeOptions {
  mode: UrlEncodeMode;
  /** Also encode ! ' ( ) * (RFC 3986 strict). Component and form modes only. */
  strict: boolean;
  /** Encode each line separately, keeping line breaks. */
  perLine: boolean;
}

export function urlEncode(text: string, o: UrlEncodeOptions): UrlResult {
  if (hasLoneSurrogate(text)) {
    return { ok: false, error: 'The text contains an unpaired surrogate (a broken emoji or character), which cannot be URL-encoded.' };
  }
  const encodeOne = (s: string) => {
    switch (o.mode) {
      case 'uri':
        return encodeURI(s);
      case 'form':
        // application/x-www-form-urlencoded: spaces become "+", CRLF line breaks per the HTML spec.
        return (o.strict ? strictComponent(s) : encodeURIComponent(s)).replace(/%20/g, '+');
      default:
        return o.strict ? strictComponent(s) : encodeURIComponent(s);
    }
  };
  if (o.perLine) return { ok: true, text: text.split(/\r\n|\r|\n/).map(encodeOne).join('\n') };
  return { ok: true, text: encodeOne(o.mode === 'form' ? text.replace(/\r?\n/g, '\r\n') : text) };
}

/** Position (0-based) and description of the first malformed percent sequence, or null. */
export function findMalformedPercent(text: string): { index: number; sequence: string; reason: string } | null {
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== '%') continue;
    const hex = text.slice(i + 1, i + 3);
    if (!/^[0-9a-f]{2}$/i.test(hex)) {
      return { index: i, sequence: text.slice(i, i + 3), reason: '"%" must be followed by two hex digits' };
    }
    const first = parseInt(hex, 16);
    if (first < 0x80) {
      i += 2;
      continue;
    }
    const need = first >= 0xf0 ? (first <= 0xf4 ? 3 : -1) : first >= 0xe0 ? 2 : first >= 0xc2 && first <= 0xdf ? 1 : -1;
    if (need === -1) return { index: i, sequence: text.slice(i, i + 3), reason: 'it is not a valid UTF-8 start byte' };
    const bytes = [first];
    let j = i + 3;
    for (let k = 0; k < need; k++, j += 3) {
      const cont = /^%([0-9a-f]{2})$/i.exec(text.slice(j, j + 3));
      if (!cont || (parseInt(cont[1], 16) & 0xc0) !== 0x80) {
        return { index: i, sequence: text.slice(i, j + 3), reason: 'it is an incomplete UTF-8 sequence' };
      }
      bytes.push(parseInt(cont[1], 16));
    }
    try {
      decodeURIComponent(text.slice(i, j));
    } catch {
      return { index: i, sequence: text.slice(i, j), reason: 'it is not valid UTF-8' };
    }
    i = j - 1;
  }
  return null;
}

export interface UrlDecodeOptions {
  /** Treat "+" as a space (form encoding). */
  plusAsSpace: boolean;
  /** decodeURI keeps reserved characters like %2F encoded. */
  mode: 'component' | 'uri';
}

export function urlDecode(text: string, o: UrlDecodeOptions): UrlResult {
  const input = o.plusAsSpace ? text.replace(/\+/g, ' ') : text;
  try {
    return { ok: true, text: o.mode === 'uri' ? decodeURI(input) : decodeURIComponent(input) };
  } catch {
    const bad = findMalformedPercent(input);
    if (bad) {
      const line = input.slice(0, bad.index).split('\n').length;
      return {
        ok: false,
        error: `Malformed percent-encoding "${bad.sequence}" at position ${bad.index + 1}${line > 1 ? ` (line ${line})` : ''}: ${bad.reason}.`,
      };
    }
    return { ok: false, error: 'The text contains malformed percent-encoding.' };
  }
}

/** Characters that decodeURI keeps percent-encoded so the URL structure does not change. */
const URI_RESERVED = new Set([...';/?:@&=+$,#']);

/** Length of the UTF-8 sequence a lead byte starts (1–4), or 0 when it cannot start one. */
function utf8SequenceLength(lead: number): number {
  if (lead < 0x80) return 1;
  if (lead >= 0xc2 && lead <= 0xdf) return 2;
  if (lead >= 0xe0 && lead <= 0xef) return 3;
  if (lead >= 0xf0 && lead <= 0xf4) return 4;
  return 0;
}

/**
 * Decode as much as possible, leaving malformed sequences untouched: in "%C3%A9%FF" the valid
 * "é" is decoded and only "%FF" stays. In `uri` mode reserved characters (%2F, %3F…) stay
 * encoded, like decodeURI.
 */
export function urlDecodeLenient(text: string, plusAsSpace: boolean, mode: 'component' | 'uri' = 'component'): string {
  const input = plusAsSpace ? text.replace(/\+/g, ' ') : text;
  return input.replace(/(?:%[0-9a-f]{2})+/gi, (run) => {
    const count = run.length / 3;
    let out = '';
    let i = 0;
    while (i < count) {
      const len = utf8SequenceLength(parseInt(run.slice(i * 3 + 1, i * 3 + 3), 16));
      if (len > 0 && i + len <= count) {
        const seq = run.slice(i * 3, (i + len) * 3);
        try {
          const ch = decodeURIComponent(seq);
          out += mode === 'uri' && URI_RESERVED.has(ch) ? seq : ch;
          i += len;
          continue;
        } catch {
          // Not valid UTF-8: keep this byte encoded and try again from the next one.
        }
      }
      out += run.slice(i * 3, i * 3 + 3);
      i++;
    }
    return out;
  });
}
