import { describe, expect, it } from 'vitest';
import { firstInvalidUtf8, hexPreview, utf8DecodeStrict } from './bytes';
import { decodeBase64, decodeBase64Text, decodedSize, encodeBase64Text, formatBase64 } from './base64';
import { base64ToBytes, blobToBase64, parseBase64Payload, toDataUrl } from './base64File';
import { detectFileType, extensionForMime, looksLikeText } from './magic';
import { findMalformedPercent, urlDecode, urlDecodeLenient, urlEncode } from './url';
import { countEntities, decodeEntities, encodeEntities, NAMED_ENTITIES } from './htmlEntities';

describe('utf8 helpers', () => {
  it('finds the first invalid byte', () => {
    expect(firstInvalidUtf8(new Uint8Array([0x61, 0xc3, 0xa9]))).toBe(-1);
    expect(firstInvalidUtf8(new Uint8Array([0x61, 0xff]))).toBe(1);
    expect(firstInvalidUtf8(new Uint8Array([0xe2, 0x82]))).toBe(0); // truncated
    expect(firstInvalidUtf8(new Uint8Array([0xc0, 0x80]))).toBe(0); // overlong
    expect(firstInvalidUtf8(new Uint8Array([0xed, 0xa0, 0x80]))).toBe(0); // surrogate
    expect(firstInvalidUtf8(new Uint8Array([0xf0, 0x9f, 0x98, 0x80]))).toBe(-1);
  });

  it('decodes strictly with a lossy fallback', () => {
    const bad = utf8DecodeStrict(new Uint8Array([0x68, 0x69, 0xff]));
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(bad.offset).toBe(2);
      expect(bad.lossy).toBe('hi�');
    }
    expect(hexPreview(new Uint8Array([1, 255]))).toBe('01 ff');
  });
});

describe('Base64 text', () => {
  it('encodes UTF-8 safely', () => {
    expect(encodeBase64Text('Hello, World!')).toBe('SGVsbG8sIFdvcmxkIQ==');
    expect(encodeBase64Text('héllo 😀')).toBe('aMOpbGxvIPCfmIA=');
    expect(encodeBase64Text('')).toBe('');
  });

  it('supports URL-safe, no padding and MIME wrapping', () => {
    const raw = encodeBase64Text('ÿþ?>');
    expect(raw).toBe('w7/Dvj8+');
    expect(formatBase64(raw, { urlSafe: true })).toBe('w7_Dvj8-');
    expect(encodeBase64Text('a', { padding: false })).toBe('YQ');
    const wrapped = encodeBase64Text('x'.repeat(100), { wrap: 76 });
    expect(wrapped.split('\r\n').map((l) => l.length)).toEqual([76, 60]);
  });

  it('decodes standard, URL-safe, unpadded, whitespace and data URLs', () => {
    expect(decodeBase64Text('SGVsbG8sIFdvcmxkIQ==')).toMatchObject({ ok: true, text: 'Hello, World!' });
    expect(decodeBase64Text('aMOpbGxvIPCfmIA')).toMatchObject({ ok: true, text: 'héllo 😀' });
    expect(decodeBase64Text('w7_Dvj8-')).toMatchObject({ ok: true, text: 'ÿþ?>', urlSafe: true });
    expect(decodeBase64Text('SGVs\nbG8=')).toMatchObject({ ok: true, text: 'Hello' });
    expect(decodeBase64Text('data:text/plain;base64,SGk=')).toMatchObject({ ok: true, text: 'Hi' });
  });

  it('reports invalid input clearly', () => {
    expect(decodeBase64('SGk*')).toMatchObject({ ok: false, error: expect.stringContaining('"*" at position 4') });
    expect(decodeBase64('SGk=a')).toMatchObject({ ok: false, error: expect.stringContaining('padding') });
    expect(decodeBase64('abcde')).toMatchObject({ ok: false, error: expect.stringContaining('length') });
    expect(decodeBase64('ab+_')).toMatchObject({ ok: false, error: expect.stringContaining('mixes') });
    expect(decodeBase64('data:text/plain,hello')).toMatchObject({ ok: false });
    expect(decodeBase64('%3D')).toMatchObject({ ok: false, error: expect.stringContaining('URL-encoded') });
  });

  it('flags binary data that is not UTF-8', () => {
    const r = decodeBase64Text('/w==');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/binary/);
  });

  it('empty input decodes to nothing', () => {
    expect(decodeBase64Text('  ')).toMatchObject({ ok: true, text: '' });
  });

  it('round-trips large input', () => {
    const text = 'Ünïcødé 😀 '.repeat(20000);
    expect(decodeBase64Text(encodeBase64Text(text))).toMatchObject({ ok: true, text });
  });

  it('computes decoded size', () => {
    expect(decodedSize('SGVsbG8=')).toBe(5);
    expect(decodedSize('data:x;base64,SGk=')).toBe(2);
  });
});

describe('Base64 files', () => {
  it('encodes blobs in chunks identically to one-shot encoding', async () => {
    const bytes = new Uint8Array(3 * 256 * 1024 + 5).map((_, i) => (i * 31) % 256);
    let progress = 0;
    const b64 = await blobToBase64(new Blob([bytes]), { progress: (p) => (progress = p) });
    expect(progress).toBe(1);
    const back = await base64ToBytes(b64);
    expect(back.length).toBe(bytes.length);
    expect(back.every((b, i) => b === bytes[i])).toBe(true);
  });

  it('parses data URLs and raw payloads', () => {
    expect(parseBase64Payload('data:image/png;base64,iVBORw0KGgo=')).toMatchObject({ ok: true, declaredMime: 'image/png' });
    expect(parseBase64Payload('iVBO Rw0K Ggo')).toMatchObject({ ok: true, base64: 'iVBORw0KGgo=' });
    expect(parseBase64Payload('')).toMatchObject({ ok: false });
    expect(parseBase64Payload('abc!')).toMatchObject({ ok: false });
    expect(parseBase64Payload('data:,hello')).toMatchObject({ ok: false });
    expect(toDataUrl('AA==', '')).toBe('data:application/octet-stream;base64,AA==');
  });

  it('decodes URL-safe payloads', async () => {
    const p = parseBase64Payload('w7_Dvj8-');
    if (!p.ok) throw new Error('parse failed');
    expect(Array.from(await base64ToBytes(p.base64))).toEqual([0xc3, 0xbf, 0xc3, 0xbe, 0x3f, 0x3e]);
  });
});

describe('magic bytes', () => {
  const b = (...bytes: number[]) => new Uint8Array(bytes);
  const s = (text: string) => new TextEncoder().encode(text);
  it('detects common formats', () => {
    expect(detectFileType(b(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))?.mime).toBe('image/png');
    expect(detectFileType(b(0xff, 0xd8, 0xff, 0xe0))?.ext).toBe('jpg');
    expect(detectFileType(s('GIF89a....'))?.mime).toBe('image/gif');
    expect(detectFileType(s('RIFF\0\0\0\0WEBPVP8 '))?.mime).toBe('image/webp');
    expect(detectFileType(s('%PDF-1.7'))?.mime).toBe('application/pdf');
    expect(detectFileType(b(0x50, 0x4b, 0x03, 0x04, 0, 0))?.ext).toBe('zip');
    expect(detectFileType(b(0x1f, 0x8b, 8))?.ext).toBe('gz');
    expect(detectFileType(s('\0\0\0\x18ftypavif'))?.mime).toBe('image/avif');
    expect(detectFileType(s('\0\0\0\x18ftypisom'))?.mime).toBe('video/mp4');
    expect(detectFileType(s('ID3\x03'))?.mime).toBe('audio/mpeg');
    expect(detectFileType(s('wOF2abcd'))?.mime).toBe('font/woff2');
    expect(detectFileType(b(0, 0x61, 0x73, 0x6d, 1, 0, 0, 0))?.mime).toBe('application/wasm');
  });

  it('detects text formats', () => {
    expect(detectFileType(s('<svg xmlns="http://www.w3.org/2000/svg"></svg>'))?.mime).toBe('image/svg+xml');
    expect(detectFileType(s('<!DOCTYPE html><html>'))?.mime).toBe('text/html');
    expect(detectFileType(s('{"a": 1}'))?.mime).toBe('application/json');
    expect(detectFileType(s('hello world'))?.mime).toBe('text/plain');
    expect(detectFileType(b(0x00, 0x01, 0x02, 0x03, 0x80, 0x81))).toBeNull();
    expect(detectFileType(new Uint8Array())).toBeNull();
    expect(looksLikeText(s('plain ascii'))).toBe(true);
  });

  it('maps MIME types to extensions', () => {
    expect(extensionForMime('image/svg+xml')).toBe('svg');
    expect(extensionForMime('text/plain; charset=utf-8')).toBe('txt');
    expect(extensionForMime('application/x-unknown')).toBe('bin');
  });
});

describe('URL encoding', () => {
  it('encodes components, URIs and forms', () => {
    expect(urlEncode('a b&c=d/é', { mode: 'component', strict: false, perLine: false })).toEqual({ ok: true, text: 'a%20b%26c%3Dd%2F%C3%A9' });
    expect(urlEncode('https://x.com/a b?q=é', { mode: 'uri', strict: false, perLine: false })).toEqual({ ok: true, text: 'https://x.com/a%20b?q=%C3%A9' });
    expect(urlEncode('a b+c', { mode: 'form', strict: false, perLine: false })).toEqual({ ok: true, text: 'a+b%2Bc' });
    expect(urlEncode("it's (ok)*!", { mode: 'component', strict: true, perLine: false })).toEqual({ ok: true, text: 'it%27s%20%28ok%29%2A%21' });
    expect(urlEncode('a b\nc d', { mode: 'component', strict: false, perLine: true })).toEqual({ ok: true, text: 'a%20b\nc%20d' });
    expect(urlEncode('😀', { mode: 'component', strict: false, perLine: false })).toEqual({ ok: true, text: '%F0%9F%98%80' });
  });

  it('refuses lone surrogates', () => {
    expect(urlEncode('\ud800', { mode: 'component', strict: false, perLine: false }).ok).toBe(false);
  });

  it('decodes with + as space', () => {
    expect(urlDecode('a+b%20c', { plusAsSpace: true, mode: 'component' })).toEqual({ ok: true, text: 'a b c' });
    expect(urlDecode('a+b', { plusAsSpace: false, mode: 'component' })).toEqual({ ok: true, text: 'a+b' });
    expect(urlDecode('%2F%C3%A9', { plusAsSpace: false, mode: 'uri' })).toEqual({ ok: true, text: '%2Fé' });
  });

  it('explains malformed sequences', () => {
    expect(urlDecode('100%', { plusAsSpace: false, mode: 'component' })).toMatchObject({ ok: false, error: expect.stringContaining('position 4') });
    expect(urlDecode('%E2%82', { plusAsSpace: false, mode: 'component' })).toMatchObject({ ok: false, error: expect.stringContaining('incomplete UTF-8') });
    expect(urlDecode('%FF', { plusAsSpace: false, mode: 'component' })).toMatchObject({ ok: false, error: expect.stringContaining('start byte') });
    expect(findMalformedPercent('%41%C3%A9')).toBeNull();
    expect(findMalformedPercent('ok %zz')).toMatchObject({ index: 3 });
  });

  it('lenient decoding leaves bad sequences', () => {
    expect(urlDecodeLenient('%41 100% %C3%A9 %FF', false)).toBe('A 100% é %FF');
  });
});

describe('HTML entities', () => {
  it('encodes only special characters', () => {
    expect(encodeEntities(`<a href="x">Tom & Jerry's</a> é`, { format: 'named', scope: 'special' })).toBe(
      '&lt;a href=&quot;x&quot;&gt;Tom &amp; Jerry&#39;s&lt;/a&gt; é',
    );
  });

  it('encodes non-ASCII as named, decimal or hex', () => {
    expect(encodeEntities('é © 😀 ž', { format: 'named', scope: 'nonAscii' })).toBe('&eacute; &copy; &#128512; &#382;');
    expect(encodeEntities('é😀', { format: 'decimal', scope: 'nonAscii' })).toBe('&#233;&#128512;');
    expect(encodeEntities('é😀', { format: 'hex', scope: 'nonAscii' })).toBe('&#xE9;&#x1F600;');
    expect(encodeEntities('a-b', { format: 'decimal', scope: 'all' })).toBe('a&#45;b');
  });

  it('decodes named, numeric and legacy references like a browser', () => {
    expect(decodeEntities('&lt;p&gt; &amp;amp; &eacute; &#233; &#xE9; &hearts; &NotEqualTilde; &copy')).toBe('<p> &amp; é é é ♥ ≂̸ ©');
    expect(decodeEntities('&#128512; &#0; &#x110000; &unknown;')).toBe('😀 � � &unknown;');
    expect(decodeEntities('no refs')).toBe('no refs');
  });

  it('never parses markup from the input and keeps line endings', () => {
    const input = '</textarea><img src=x onerror=alert(1)>&amp;\r\n<script>x</script>';
    expect(decodeEntities(input)).toBe('</textarea><img src=x onerror=alert(1)>&\r\n<script>x</script>');
  });

  it('every named entity in the encode table decodes back to its character', () => {
    for (const [cp, name] of NAMED_ENTITIES) {
      expect(decodeEntities(`&${name};`), name).toBe(String.fromCodePoint(cp));
    }
  });

  it('round-trips', () => {
    const text = `Ünïcødé <tags> & "quotes" 'single' 😀 ©`;
    for (const format of ['named', 'decimal', 'hex'] as const) {
      expect(decodeEntities(encodeEntities(text, { format, scope: 'nonAscii' }))).toBe(text);
    }
    expect(countEntities('&amp; &#1; &#x1; & x')).toBe(3);
  });
});
