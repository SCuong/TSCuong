/** Regression tests for defects found in the encoding tools audit. */
import { describe, expect, it } from 'vitest';
import { decodeBase64 } from './base64';
import { parseBase64Payload } from './base64File';
import { canonicalMime, detectFileType, extensionForMime } from './magic';
import { urlDecodeLenient } from './url';
import { decodeEntitiesCounted, encodeEntitiesCounted } from './htmlEntities';
import { convertUnicodeEscapes, escapeUnicode, unescapeUnicode } from './unicodeEscape';
import { convertString, escapeString } from './stringEscape';
import { binaryConvert, bytesToHex, hexConvert, textToBinary } from './hexBinary';
import { convertDomains, dnsProblems, domainToUnicode } from './punycode';
import { binaryFileWarning, decodeAs, decodeUtf32, ENCODINGS, guessEncoding, tryAllEncodings } from './textEncoding';
import { stripInvisible, summarize } from './inspect';
import { rotate } from './rot';

describe('Base64 error positions', () => {
  it('points at the character as typed, with line and column for wrapped input', () => {
    expect(decodeBase64('SGVs\n  bG8*')).toMatchObject({ ok: false, error: 'Invalid Base64: unexpected character "*" at line 2, column 6.' });
    expect(decodeBase64('  SGk*')).toMatchObject({ ok: false, error: expect.stringContaining('"*" at position 6') });
    expect(decodeBase64('data:text/plain;base64,SGk\u200b=')).toMatchObject({
      ok: false,
      error: expect.stringContaining('U+200B (an invisible character) at position 27'),
    });
    expect(parseBase64Payload('data:image/png;base64,iVBO#')).toMatchObject({ ok: false, error: expect.stringContaining('"#" at position 27') });
  });
});

describe('Base64 file types', () => {
  it('normalizes MIME aliases and marks text guesses as weak', () => {
    expect(canonicalMime('image/JPG; q=1')).toBe('image/jpeg');
    expect(canonicalMime('text/xml')).toBe('application/xml');
    expect(extensionForMime('text/csv')).toBe('csv');
    expect(extensionForMime('image/jpg')).toBe('jpg');
    expect(detectFileType(new TextEncoder().encode('a,b\n1,2\n'))).toMatchObject({ mime: 'text/plain', weak: true });
    expect(detectFileType(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))?.weak).toBeUndefined();
    expect(parseBase64Payload('data:Text/CSV;charset=utf-8;base64,YSxiCg==')).toMatchObject({ ok: true, declaredMime: 'text/csv' });
  });
});

describe('URL decoding', () => {
  it('keeps valid UTF-8 next to a malformed byte in lenient mode', () => {
    expect(urlDecodeLenient('%C3%A9%FF%C3%A9', false)).toBe('é%FFé');
    expect(urlDecodeLenient('%E2%82%AC%E2%82', false)).toBe('€%E2%82');
    expect(urlDecodeLenient('a%2Fb%3F%C3%A9%FF', false, 'uri')).toBe('a%2Fb%3Fé%FF');
    expect(urlDecodeLenient('a+b%20c', true)).toBe('a b c');
  });
});

describe('HTML entities', () => {
  it('counts only references that decode', () => {
    expect(decodeEntitiesCounted('&amp; &foo; &copy &#x41; &#0;')).toEqual({ text: '& &foo; © A \ufffd', count: 4 });
    expect(encodeEntitiesCounted('<a> & é', { format: 'named', scope: 'nonAscii' })).toEqual({ text: '&lt;a&gt; &amp; &eacute;', count: 4 });
  });
});

describe('Unicode escapes', () => {
  it('does not read JavaScript escapes as one-digit CSS escapes', () => {
    expect(unescapeUnicode(String.raw`\b\f\0 \e9 x\A y \1F600`)).toMatchObject({ text: '\\b\\f\\0 éx\ny 😀', count: 3 });
    expect(unescapeUnicode(String.raw`C:\dev`, { css: false }).text).toBe(String.raw`C:\dev`);
  });

  it('pads CSS escapes to two digits so they round-trip', () => {
    const text = '\tA\u0001é';
    const escaped = escapeUnicode(text, { format: 'css', scope: 'all', uppercase: false });
    expect(escaped).toBe('\\09 \\41\\01\\e9');
    expect(unescapeUnicode(escaped).text).toBe(text);
    expect(convertUnicodeEscapes('é', 'encode', { format: 'js', scope: 'nonAscii', uppercase: true, css: true }).text).toBe('\\u00E9');
  });
});

describe('String escaping', () => {
  it('escapes lone surrogates like JSON.stringify', () => {
    const text = 'a\ud83db\ude00c😀';
    expect(escapeString(text, 'json')).toBe(JSON.stringify(text).slice(1, -1));
    expect(escapeString(text, 'js')).toBe('a\\ud83db\\ude00c😀');
    expect(convertString('"a\\nb"', 'decode', 'json', {})).toEqual({ ok: true, text: 'a\nb' });
  });
});

describe('Hex and binary', () => {
  it('formats with lookup tables and converts both ways', () => {
    expect(bytesToHex(Uint8Array.from([0, 15, 255]), { separator: 'comma0x', uppercase: true, bytesPerLine: 2 })).toBe('0x00, 0x0F,\n0xFF');
    expect(textToBinary('é', { separator: 'space' })).toBe('11000011 10101001');
    expect(hexConvert('Hi', 'encode', { separator: 'space', uppercase: false, bytesPerLine: 0 })).toEqual({ ok: true, text: '48 69', bytes: 2 });
    expect(hexConvert('ff fe', 'decode', { separator: 'space', uppercase: false, bytesPerLine: 0 })).toMatchObject({ ok: false });
    expect(binaryConvert('01001000 01101001', 'decode', { separator: 'space' })).toEqual({ ok: true, text: 'Hi', bytes: 2 });
  });
});

describe('Punycode / IDN', () => {
  it('rejects labels that decode to characters not allowed in host names', () => {
    expect(domainToUnicode('xn--a.com')).toMatchObject({ ok: false, error: expect.stringContaining('not allowed in domain names') });
    expect(domainToUnicode('xn--bcher-kva.example')).toEqual({ ok: true, value: 'bücher.example', warnings: [] });
  });

  it('warns about DNS limits the URL parser does not check', () => {
    expect(dnsProblems(`${'a'.repeat(64)}.com`)).toEqual(['the label "aaaaaaaaaaaaaaaaaaaa…" is 64 characters long (DNS allows 63)']);
    expect(dnsProblems('a..b')).toEqual(['it contains an empty label (two dots in a row)']);
    expect(dnsProblems('-bad-.com')).toEqual(['the label "-bad-" starts or ends with a hyphen']);
    expect(dnsProblems('192.168.0.1')).toEqual([]);
    const rows = convertDomains('bücher.example\n\nаpple.com', 'encode');
    expect(rows.map((r) => r.output)).toEqual(['xn--bcher-kva.example', '', 'xn--pple-43d.com']);
    expect(rows[2].warnings[0]).toMatch(/look-alike/);
  });
});

describe('UTF-32 text files', () => {
  const utf32 = (text: string, le: boolean, bom: boolean) => {
    const cps = [...(bom ? [0xfeff] : []), ...Array.from(text, (c) => c.codePointAt(0)!)];
    const buf = new DataView(new ArrayBuffer(cps.length * 4));
    cps.forEach((cp, i) => buf.setUint32(i * 4, cp, le));
    return new Uint8Array(buf.buffer);
  };

  it('decodes UTF-32 with and without a byte order mark', () => {
    const text = 'Grüße 😀 from UTF-32, with enough ASCII to detect';
    for (const le of [true, false]) {
      for (const bom of [true, false]) {
        const bytes = utf32(text, le, bom);
        const guess = guessEncoding(bytes, tryAllEncodings(bytes));
        expect(guess).toBe(le ? 'utf-32le' : 'utf-32be');
        expect(decodeAs(bytes, ENCODINGS.find((e) => e.label === guess)!)).toMatchObject({ valid: true, text });
      }
    }
    expect(decodeUtf32(Uint8Array.from([0x41, 0, 0, 0, 0x42]), true)).toEqual({ text: 'A\ufffd', valid: false });
  });
});

describe('binary files in the text encoding converter', () => {
  it('warns about binary data but not about text in legacy encodings', () => {
    const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 1]);
    expect(binaryFileWarning(png, 'windows-1252')).toMatch(/binary data \(PNG image\)/);
    expect(binaryFileWarning(Uint8Array.from([0x42, 0x4d, 0x57, 0x20, 0xfc, 0x62, 0x65, 0x72, 0x0d, 0x0a]), 'windows-1252')).toBeNull();
    // Shift_JIS "日本語" and ISO-2022-JP (which uses ESC sequences) are text.
    expect(binaryFileWarning(Uint8Array.from([0x93, 0xfa, 0x96, 0x7b, 0x8c, 0xea]), 'shift_jis')).toBeNull();
    expect(binaryFileWarning(Uint8Array.from([0x1b, 0x24, 0x42, 0x46, 0x7c, 0x1b, 0x28, 0x42]), 'iso-2022-jp')).toBeNull();
    expect(binaryFileWarning(Uint8Array.from([0x48, 0, 0x69, 0]), 'utf-16le')).toBeNull();
    expect(binaryFileWarning(new Uint8Array(0), 'utf-8')).toBeNull();
  });
});

describe('Unicode inspector', () => {
  const sample = 'pay\u200bpal pay\u200dpal 👨\u200d👩 می\u200cخواهم 🏴\u{e0067}\u{e0062}\u{e0073}\u{e0063}\u{e0074}\u{e007f} hi\u{e0041}\u202e';

  it('strips exactly the characters the summary reports', () => {
    const s = summarize(sample);
    expect(s).toMatchObject({ invisible: 3, bidi: 1, control: 0 });
    const cleaned = stripInvisible(sample);
    expect(Array.from(sample).length - Array.from(cleaned).length).toBe(s.invisible + s.bidi + s.control);
    // Emoji joiners, the Persian ZWNJ and the flag's tag characters stay.
    expect(cleaned).toBe('paypal paypal 👨\u200d👩 می\u200cخواهم 🏴\u{e0067}\u{e0062}\u{e0073}\u{e0063}\u{e0074}\u{e007f} hi');
    expect(summarize(cleaned)).toMatchObject({ invisible: 0, bidi: 0, control: 0 });
  });
});

describe('ROT', () => {
  it('rotates and restores in one call', () => {
    expect(rotate('Hello 123', 'caesar', 13, false, true)).toBe('Uryyb 678');
    expect(rotate(rotate('Hello', 'caesar', 3, false, false), 'caesar', 3, true, false)).toBe('Hello');
    expect(rotate('Hi!', 'rot47', 13, false, false)).toBe('w:P');
  });
});
