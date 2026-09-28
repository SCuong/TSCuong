import { describe, expect, it } from 'vitest';
import { describeCodePoint, generalCategory, inspectText, scriptOf, stripInvisible, summarize } from './inspect';
import { decodeAs, detectBom, encodeOutput, encodeSingleByte, ENCODINGS, guessEncoding, plausibility, rankAttempts, repairMojibake, tryAllEncodings } from './textEncoding';

describe('unicode inspector', () => {
  it('classifies general categories', () => {
    expect(generalCategory('A').code).toBe('Lu');
    expect(generalCategory('a').code).toBe('Ll');
    expect(generalCategory('5').code).toBe('Nd');
    expect(generalCategory('́').code).toBe('Mn');
    expect(generalCategory('€').code).toBe('Sc');
    expect(generalCategory('\u200b').code).toBe('Cf');
    expect(generalCategory('͸').code).toBe('Cn');
    expect(scriptOf('ж')).toBe('Cyrillic');
    expect(scriptOf('a')).toBe('Latin');
  });

  it('describes code points with UTF-8/16 units and flags', () => {
    const e = describeCodePoint('😀');
    expect(e.label).toBe('U+1F600');
    expect(e.utf8).toEqual([0xf0, 0x9f, 0x98, 0x80]);
    expect(e.utf16).toEqual([0xd83d, 0xde00]);
    expect(describeCodePoint('\u200b').flags).toContain('invisible');
    expect(describeCodePoint('\u200b').name).toBe('ZERO WIDTH SPACE');
    expect(describeCodePoint('\u202e').flags).toContain('bidi');
    expect(describeCodePoint('́').flags).toContain('combining');
    expect(describeCodePoint('\u00a0').flags).toContain('nonstandard-space');
    expect(describeCodePoint('\u0007').flags).toContain('control');
    expect(describeCodePoint('\ufe0f').flags).toContain('variation');
    expect(describeCodePoint('\ud800').flags).toContain('surrogate');
  });

  it('groups code points into graphemes', () => {
    const r = inspectText('é👩‍👩‍👧');
    expect(r.graphemes).toHaveLength(2);
    expect(r.graphemes[0].codePoints).toHaveLength(2);
    expect(r.graphemes[1].codePoints).toHaveLength(5);
    expect(inspectText('abc', 2)).toMatchObject({ truncated: true });
  });

  it('summarizes suspicious content', () => {
    const s = summarize('pay\u200bpal \u202eevil\u202c שלום é');
    expect(s.invisible).toBe(1);
    expect(s.bidi).toBe(2);
    expect(s.combining).toBe(1);
    expect(s.rtlCharacters).toBe(4);
    expect(s.scripts).toEqual(expect.arrayContaining(['Latin', 'Hebrew']));
    expect(s.isNFC).toBe(false);
  });

  it('strips invisible characters but keeps ZWJ emoji and line breaks', () => {
    expect(stripInvisible('a\u200bb\u202ec\n👩‍👩‍👧\u0007')).toBe('abc\n👩‍👩‍👧');
  });
});

describe('text encoding converter', () => {
  it('detects BOMs', () => {
    expect(detectBom(new Uint8Array([0xef, 0xbb, 0xbf, 0x41]))).toEqual({ bom: 'utf-8', length: 3 });
    expect(detectBom(new Uint8Array([0xff, 0xfe, 0x41, 0]))).toEqual({ bom: 'utf-16le', length: 2 });
    expect(detectBom(new Uint8Array([0xfe, 0xff]))).toEqual({ bom: 'utf-16be', length: 2 });
    expect(detectBom(new Uint8Array([0x41]))).toBeNull();
  });

  it('marks invalid decodings using fatal mode', () => {
    const latin1 = new Uint8Array([0x63, 0x61, 0x66, 0xe9]); // "café" in windows-1252
    const utf8 = ENCODINGS.find((e) => e.label === 'utf-8')!;
    const cp1252 = ENCODINGS.find((e) => e.label === 'windows-1252')!;
    expect(decodeAs(latin1, utf8).valid).toBe(false);
    expect(decodeAs(latin1, cp1252)).toMatchObject({ valid: true, text: 'café' });
  });

  it('guesses UTF-8, legacy and Shift_JIS encodings', () => {
    const utf8 = new TextEncoder().encode('Grüße 😀');
    expect(guessEncoding(utf8, tryAllEncodings(utf8))).toBe('utf-8');
    const cp1252 = new Uint8Array([0x47, 0x72, 0xfc, 0xdf, 0x65]); // Grüße
    const guess = guessEncoding(cp1252, tryAllEncodings(cp1252));
    expect(decodeAs(cp1252, ENCODINGS.find((e) => e.label === guess)!).text).toMatch(/^Gr/);
    const sjis = new Uint8Array([0x82, 0xb1, 0x82, 0xf1, 0x82, 0xc9, 0x82, 0xbf, 0x82, 0xcd]); // こんにちは
    const attempts = tryAllEncodings(sjis);
    expect(attempts.find((a) => a.encoding.label === 'shift_jis')).toMatchObject({ valid: true, text: 'こんにちは' });
    expect(attempts.find((a) => a.encoding.label === 'utf-8')?.valid).toBe(false);
  });

  it('detects UTF-16 without BOM', () => {
    const le = encodeOutput('Hello world, plain text', 'utf-16le-bom').subarray(2);
    expect(guessEncoding(le, tryAllEncodings(le))).toBe('utf-16le');
  });

  it('scores mojibake lower than clean text', () => {
    expect(plausibility('café crème')).toBeGreaterThan(plausibility('cafÃ© crÃ¨me'));
    expect(plausibility('')).toBe(0);
  });

  it('encodes output with and without BOM', () => {
    expect(Array.from(encodeOutput('A', 'utf-8'))).toEqual([0x41]);
    expect(Array.from(encodeOutput('A', 'utf-8-bom'))).toEqual([0xef, 0xbb, 0xbf, 0x41]);
    expect(Array.from(encodeOutput('A😀', 'utf-16le-bom'))).toEqual([0xff, 0xfe, 0x41, 0, 0x3d, 0xd8, 0x00, 0xde]);
    expect(Array.from(encodeOutput('A', 'utf-16be-bom'))).toEqual([0xfe, 0xff, 0, 0x41]);
  });
});

describe('mojibake repair', () => {
  it('recovers UTF-8 text that was read as Windows-1252', () => {
    const garbled = new TextDecoder('windows-1252').decode(new TextEncoder().encode('Café “déjà vu” — 😀'));
    expect(repairMojibake(garbled, 'windows-1252', 'utf-8')).toEqual({ ok: true, text: 'Café “déjà vu” — 😀' });
  });

  it('recovers Cyrillic read with the wrong code page', () => {
    const bytes = new TextEncoder().encode('Привет');
    const garbled = new TextDecoder('windows-1252').decode(bytes);
    expect(repairMojibake(garbled, 'windows-1252', 'utf-8')).toMatchObject({ ok: true, text: 'Привет' });
  });

  it('explains impossible repairs', () => {
    expect(encodeSingleByte('日本', 'windows-1252').ok).toBe(false);
    expect(repairMojibake('café', 'windows-1252', 'utf-8').ok).toBe(false);
    expect(Array.from((encodeSingleByte('é€', 'windows-1252') as { bytes: Uint8Array }).bytes)).toEqual([0xe9, 0x80]);
  });
});

describe('emoji joiners', () => {
  it('does not count joiners inside emoji sequences as hidden characters', () => {
    const family = String.fromCodePoint(0x1f468, 0x200d, 0x1f469, 0x200d, 0x1f467);
    expect(summarize(family).invisible).toBe(0);
    expect(summarize(`a${String.fromCodePoint(0x200d)}b`).invisible).toBe(1);
  });
});

describe('encoding guesses', () => {
  const guess = (bytes: number[]) => {
    const u8 = new Uint8Array(bytes);
    return guessEncoding(u8, tryAllEncodings(u8));
  };
  it('prefers Shift_JIS for Japanese with kana', () => {
    // こんにちは、世界！
    expect(guess([0x82, 0xb1, 0x82, 0xf1, 0x82, 0xc9, 0x82, 0xbf, 0x82, 0xcd, 0x81, 0x41, 0x90, 0xa2, 0x8a, 0x45, 0x81, 0x49])).toBe('shift_jis');
  });

  it('prefers GBK for Simplified Chinese', () => {
    // 中文测试你好 repeated
    const zh = [0xd6, 0xd0, 0xce, 0xc4, 0xb2, 0xe2, 0xca, 0xd4, 0xc4, 0xe3, 0xba, 0xc3];
    expect(guess([...zh, 0x20, ...zh])).toBe('gbk');
  });

  it('prefers Windows-1251 for Russian and Windows-1252 for German', () => {
    expect(guess([0xcf, 0xf0, 0xe8, 0xe2, 0xe5, 0xf2, 0x20, 0xec, 0xe8, 0xf0])).toBe('windows-1251');
    expect(guess([0x47, 0x72, 0xfc, 0xdf, 0x65, 0x20, 0x61, 0x75, 0x73, 0x20, 0x4d, 0xfc, 0x6e, 0x63, 0x68, 0x65, 0x6e])).toBe('windows-1252');
  });

  it('ranks only valid attempts', () => {
    const u8 = new Uint8Array([0x82, 0xb1, 0x82, 0xf1]);
    expect(rankAttempts(tryAllEncodings(u8)).every((a) => a.valid)).toBe(true);
  });
});
