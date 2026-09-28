import { describe, expect, it } from 'vitest';
import { escapeUnicode, unescapeUnicode } from './unicodeEscape';
import { escapeString, unescapeString, ESCAPE_LANGUAGES, type EscapeLanguage } from './stringEscape';
import { binaryToText, hexToText, parseBinary, parseHex, textToBinary, textToHex } from './hexBinary';
import { allShifts, caesar, rot13, rot18, rot47 } from './rot';
import { domainToAscii, domainToUnicode, mixedScriptLabels, punycodeDecode, punycodeEncode } from './punycode';

describe('unicode escape', () => {
  const text = 'é😀a';
  it('escapes in every format', () => {
    const o = { scope: 'nonAscii' as const, uppercase: false };
    expect(escapeUnicode(text, { ...o, format: 'js' })).toBe('\\u00e9\\ud83d\\ude00a');
    expect(escapeUnicode(text, { ...o, format: 'es6' })).toBe('\\u{e9}\\u{1f600}a');
    expect(escapeUnicode(text, { ...o, format: 'python32' })).toBe('\\u00e9\\U0001f600a');
    expect(escapeUnicode(text, { ...o, format: 'utf8hex' })).toBe('\\xc3\\xa9\\xf0\\x9f\\x98\\x80a');
    expect(escapeUnicode(text, { ...o, format: 'html' })).toBe('&#xE9;&#x1F600;a');
    expect(escapeUnicode(text, { ...o, format: 'htmlDec' })).toBe('&#233;&#128512;a');
    expect(escapeUnicode(text, { ...o, format: 'uplus' })).toBe('U+00E9U+1F600a');
    expect(escapeUnicode(text, { ...o, format: 'css' })).toBe('\\e9\\1f600 a');
    expect(escapeUnicode('é!', { ...o, format: 'css' })).toBe('\\e9!');
  });

  it('respects scope and case', () => {
    expect(escapeUnicode('a\tb', { format: 'js', scope: 'nonPrintable', uppercase: true })).toBe('a\tb');
    expect(escapeUnicode('a\x01', { format: 'js', scope: 'nonPrintable', uppercase: true })).toBe('a\\u0001');
    expect(escapeUnicode('Hi', { format: 'uplus', scope: 'all', uppercase: true })).toBe('U+0048 U+0069');
    expect(escapeUnicode('é', { format: 'js', scope: 'nonAscii', uppercase: true })).toBe('\\u00E9');
  });

  it('unescapes all formats and combines surrogate pairs', () => {
    expect(unescapeUnicode('\\u00e9\\ud83d\\ude00').text).toBe('é😀');
    expect(unescapeUnicode('\\u{1F600} \\U0001F600').text).toBe('😀 😀');
    expect(unescapeUnicode('\\xc3\\xa9').text).toBe('é');
    expect(unescapeUnicode('&#xE9;&#233;').text).toBe('éé');
    expect(unescapeUnicode('U+0048 U+0069').text).toBe('Hi');
    expect(unescapeUnicode('U+0048 U+0020 U+0069').text).toBe('H i');
    expect(unescapeUnicode('char U+00E9 here').text).toBe('char é here');
    expect(unescapeUnicode('\\e9 \\1f600 a').text).toBe('é😀a');
  });

  it('round-trips every format', () => {
    const sample = 'Crème brûlée 😀 — 日本';
    for (const format of ['js', 'es6', 'python32', 'utf8hex', 'html', 'htmlDec', 'css'] as const) {
      expect(unescapeUnicode(escapeUnicode(sample, { format, scope: 'nonAscii', uppercase: false })).text, format).toBe(sample);
    }
    expect(unescapeUnicode(escapeUnicode(sample, { format: 'uplus', scope: 'all', uppercase: false })).text).toBe(sample);
  });

  it('warns about lone surrogates and out-of-range values', () => {
    expect(unescapeUnicode('\\ud83d').warnings[0]).toMatch(/unpaired surrogate/);
    const r = unescapeUnicode('\\u{110000}');
    expect(r.text).toBe('\\u{110000}');
    expect(r.warnings[0]).toMatch(/beyond/);
  });

  it('falls back to Latin-1 for invalid UTF-8 byte escapes', () => {
    const r = unescapeUnicode('\\xe9');
    expect(r.text).toBe('é');
    expect(r.warnings[0]).toMatch(/Latin-1/);
  });

  it('can skip CSS escapes', () => {
    expect(unescapeUnicode('C:\\dev', { css: false }).text).toBe('C:\\dev');
  });
});

describe('string escaper', () => {
  const tricky = 'He said "hi"\n\tit\'s C:\\path — ok? 😀';
  it('escapes JSON exactly like JSON.stringify', () => {
    const escaped = escapeString(tricky, 'json', { wrap: true });
    expect(JSON.parse(escaped)).toBe(tricky);
    expect(escaped).toBe(JSON.stringify(tricky));
    expect(escapeString('é', 'json', { asciiOnly: true })).toBe('\\u00e9');
    expect(escapeString('😀', 'json', { asciiOnly: true })).toBe('\\ud83d\\ude00');
  });

  it('escapes JavaScript with the chosen quote', () => {
    expect(escapeString(`a'b"c`, 'js', { quote: "'", wrap: true })).toBe(`'a\\'b"c'`);
    expect(escapeString('${x}`', 'js', { quote: '`' })).toBe('\\${x}\\`');
    expect(escapeString('\0' + '1', 'js')).toBe('\\x001');
  });

  it('escapes C with octal UTF-8 bytes', () => {
    expect(escapeString('é\n"', 'c')).toBe('\\303\\251\\n\\"');
    expect(escapeString('??=', 'c')).toBe('\\??=');
  });

  it('escapes SQL, regex, shell, CSV and XML', () => {
    expect(escapeString("O'Brien", 'sql', { wrap: true })).toBe("'O''Brien'");
    expect(escapeString('a.b*c', 'regex')).toBe('a\\.b\\*c');
    expect(new RegExp(escapeString('(1+1)=[2]?', 'regex')).test('(1+1)=[2]?')).toBe(true);
    expect(escapeString("it's", 'shell')).toBe(`'it'\\''s'`);
    expect(escapeString('a,"b"', 'csv')).toBe('"a,""b"""');
    expect(escapeString('plain', 'csv')).toBe('plain');
    expect(escapeString(`<a href="x">'&'</a>`, 'xml')).toBe('&lt;a href=&quot;x&quot;&gt;&apos;&amp;&apos;&lt;/a&gt;');
  });

  it('round-trips every language', () => {
    for (const { value } of ESCAPE_LANGUAGES) {
      const lang = value as EscapeLanguage;
      const escaped = escapeString(tricky, lang, { wrap: true });
      expect(unescapeString(escaped, lang), lang).toEqual({ ok: true, text: tricky });
    }
  });

  it('unescapes common sequences', () => {
    expect(unescapeString('"a\\u00e9\\n"', 'json')).toEqual({ ok: true, text: 'aé\n' });
    expect(unescapeString('\\x41\\u{1F600}\\101', 'js')).toEqual({ ok: true, text: 'A😀A' });
    expect(unescapeString('\\101\\x41', 'c')).toEqual({ ok: true, text: 'AA' });
    expect(unescapeString('\\uuu0041\\s', 'java')).toEqual({ ok: true, text: 'A ' });
    expect(unescapeString(`'a'"b"\\ c$'\\t'`, 'shell')).toEqual({ ok: true, text: 'ab c\t' });
    expect(unescapeString('&lt;&#65;&#x42;&amp;', 'xml')).toEqual({ ok: true, text: '<AB&' });
    expect(unescapeString('a\\.b', 'regex')).toEqual({ ok: true, text: 'a.b' });
  });

  it('reports bad escapes', () => {
    expect(unescapeString('\\q', 'json')).toMatchObject({ ok: false, error: expect.stringContaining('Unknown escape') });
    expect(unescapeString('\\u12', 'json')).toMatchObject({ ok: false, error: expect.stringContaining('4 hex digits') });
    expect(unescapeString('abc\\', 'java')).toMatchObject({ ok: false, error: expect.stringContaining('Dangling') });
    expect(unescapeString("'abc", 'shell')).toMatchObject({ ok: false, error: expect.stringContaining('Unterminated') });
    expect(unescapeString('"a"b"', 'csv')).toMatchObject({ ok: false });
    expect(unescapeString('a\nb', 'json')).toMatchObject({ ok: false, error: expect.stringContaining('control') });
    expect(unescapeString('\\q', 'js')).toEqual({ ok: true, text: 'q' });
  });

  it('empty input', () => {
    for (const { value } of ESCAPE_LANGUAGES) expect(unescapeString('', value).ok).toBe(true);
    expect(escapeString('', 'json')).toBe('');
  });
});

describe('hex', () => {
  it('encodes UTF-8 bytes with separators', () => {
    expect(textToHex('Hé', { separator: 'space', uppercase: false, bytesPerLine: 0 })).toBe('48 c3 a9');
    expect(textToHex('Hé', { separator: 'none', uppercase: true, bytesPerLine: 0 })).toBe('48C3A9');
    expect(textToHex('Hi', { separator: 'comma0x', uppercase: false, bytesPerLine: 0 })).toBe('0x48, 0x69');
    expect(textToHex('Hi', { separator: 'backslashX', uppercase: false, bytesPerLine: 0 })).toBe('\\x48\\x69');
    expect(textToHex('abcd', { separator: 'space', uppercase: false, bytesPerLine: 2 })).toBe('61 62\n63 64');
  });

  it('parses any notation', () => {
    for (const input of ['48 69', '4869', '48:69', '0x48, 0x69', '\\x48\\x69', '%48%69', '48-69']) {
      expect(hexToText(input), input).toMatchObject({ ok: true, text: 'Hi' });
    }
    expect(parseHex('')).toMatchObject({ ok: true });
  });

  it('reports invalid hex', () => {
    expect(parseHex('4g')).toMatchObject({ ok: false, error: expect.stringContaining('"g"') });
    expect(parseHex('486')).toMatchObject({ ok: false, error: expect.stringContaining('odd number') });
    expect(hexToText('ff')).toMatchObject({ ok: false, error: expect.stringContaining('not valid UTF-8') });
  });
});

describe('binary', () => {
  it('encodes and decodes', () => {
    expect(textToBinary('Hi', { separator: 'space' })).toBe('01001000 01101001');
    expect(textToBinary('é', { separator: 'none' })).toBe('1100001110101001');
    expect(binaryToText('01001000 01101001')).toMatchObject({ ok: true, text: 'Hi' });
    expect(binaryToText('0100100001101001')).toMatchObject({ ok: true, text: 'Hi' });
    expect(binaryToText('1001000 1101001')).toMatchObject({ ok: true, text: 'Hi' });
    expect(binaryToText(textToBinary('😀 ok', { separator: 'newline' }))).toMatchObject({ ok: true, text: '😀 ok' });
  });

  it('reports errors', () => {
    expect(parseBinary('0102')).toMatchObject({ ok: false, error: expect.stringContaining('"2"') });
    expect(parseBinary('010010001')).toMatchObject({ ok: false, error: expect.stringContaining('multiple of 8') });
    expect(binaryToText('11111111')).toMatchObject({ ok: false });
  });
});

describe('rotation ciphers', () => {
  it('rot13 is its own inverse', () => {
    expect(rot13('Hello, World!')).toBe('Uryyb, Jbeyq!');
    expect(rot13(rot13('Any Text 123 é'))).toBe('Any Text 123 é');
  });

  it('caesar shifts both ways', () => {
    expect(caesar('abc xyz', 3)).toBe('def abc');
    expect(caesar('def abc', -3)).toBe('abc xyz');
    expect(caesar('abc', 29)).toBe('def');
    expect(caesar('a1', 3, true)).toBe('d4');
    expect(caesar(caesar('Az09', 7, true), -7, true)).toBe('Az09');
  });

  it('rot18 and rot47', () => {
    expect(rot18('abc123')).toBe('nop678');
    expect(rot18(rot18('abc123'))).toBe('abc123');
    expect(rot47('Hello, World!')).toBe('w6==@[ (@C=5P');
    expect(rot47(rot47('The ~ Quick 123'))).toBe('The ~ Quick 123');
  });

  it('lists all shifts', () => {
    const shifts = allShifts('a');
    expect(shifts).toHaveLength(25);
    expect(shifts[0]).toEqual({ shift: 1, text: 'b' });
  });
});

describe('punycode', () => {
  it('encodes and decodes RFC 3492 samples', () => {
    expect(punycodeEncode('bücher')).toBe('bcher-kva');
    expect(punycodeEncode('münchen')).toBe('mnchen-3ya');
    expect(punycodeEncode('日本語')).toBe('wgv71a119e');
    expect(punycodeEncode('😀')).toBe('e28h');
    expect(punycodeDecode('bcher-kva')).toBe('bücher');
    expect(punycodeDecode('wgv71a119e')).toBe('日本語');
    expect(punycodeDecode('e28h')).toBe('😀');
    // RFC 3492 7.1 (L) Japanese sample
    expect(punycodeDecode('3B-ww4c5e180e575a65lsy2b')).toBe('3年B組金八先生');
  });

  it('round-trips random text', () => {
    for (const s of ['abc', 'ñandú', 'Привет', 'παράδειγμα', 'a-b-c-ü', '中文域名']) {
      expect(punycodeDecode(punycodeEncode(s))).toBe(s);
    }
  });

  it('rejects invalid punycode', () => {
    expect(() => punycodeDecode('abc-!!')).toThrow();
    expect(() => punycodeDecode('ü')).toThrow();
  });

  it('converts domains both ways', () => {
    expect(domainToAscii('Bücher.Example')).toEqual({ ok: true, value: 'xn--bcher-kva.example' });
    expect(domainToAscii('https://müller.de/path?q=1')).toEqual({ ok: true, value: 'https://xn--mller-kva.de/path?q=1' });
    expect(domainToUnicode('xn--bcher-kva.example')).toEqual({ ok: true, value: 'bücher.example' });
    expect(domainToUnicode('XN--MNCHEN-3YA.DE')).toEqual({ ok: true, value: 'münchen.de' });
    expect(domainToUnicode('https://xn--wgv71a119e.jp/x')).toEqual({ ok: true, value: 'https://日本語.jp/x' });
  });

  it('reports invalid domains', () => {
    expect(domainToAscii('bad domain.com').ok).toBe(false);
    expect(domainToAscii('').ok).toBe(false);
    expect(domainToUnicode('xn--!!!.com').ok).toBe(false);
  });

  it('flags mixed-script labels', () => {
    expect(mixedScriptLabels('аpple.com')).toEqual(['аpple']); // Cyrillic а
    expect(mixedScriptLabels('apple.com')).toEqual([]);
  });
});

describe('hex single digits', () => {
  it('pads single digits only in 0x lists', () => {
    expect(parseHex('0x0, 0x1f')).toMatchObject({ ok: true, bytes: new Uint8Array([0, 0x1f]) });
    expect(parseHex('48 65 6')).toMatchObject({ ok: false, error: expect.stringContaining('odd number') });
  });
});
