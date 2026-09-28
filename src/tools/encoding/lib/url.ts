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

/** Decode as much as possible, leaving malformed sequences untouched. */
export function urlDecodeLenient(text: string, plusAsSpace: boolean): string {
  const input = plusAsSpace ? text.replace(/\+/g, ' ') : text;
  return input.replace(/(?:%[0-9a-f]{2})+/gi, (run) => {
    try {
      return decodeURIComponent(run);
    } catch {
      // Decode valid pieces inside the run one sequence at a time.
      return run.replace(/%[0-9a-f]{2}/gi, (seq) => {
        const b = parseInt(seq.slice(1), 16);
        return b < 0x80 ? String.fromCharCode(b) : seq;
      });
    }
  });
}
