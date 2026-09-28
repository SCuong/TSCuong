import { describe, expect, it } from 'vitest';
import { bytesToBase64, DataUrlError, extensionFor, parseDataUrl, snippets, svgToDataUrl, toDataUrl, unwrap } from './dataurl';

const PNG_1PX =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

describe('parseDataUrl', () => {
  it('parses a base64 PNG data URL and detects the type', () => {
    const r = parseDataUrl(`data:image/png;base64,${PNG_1PX}`);
    expect(r.declaredMime).toBe('image/png');
    expect(r.detected).toBe('png');
    expect(r.wasDataUrl).toBe(true);
    expect(r.bytes[0]).toBe(0x89);
  });

  it('accepts bare base64 with whitespace/newlines and missing padding', () => {
    const wrapped = PNG_1PX.replace(/=+$/, '').replace(/(.{20})/g, '$1\n  ');
    const r = parseDataUrl(wrapped);
    expect(r.detected).toBe('png');
    expect(r.wasDataUrl).toBe(false);
  });

  it('accepts URL-safe base64', () => {
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xfb, 0xef, 0xbe]);
    const urlSafe = bytesToBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_');
    expect(parseDataUrl(urlSafe).detected).toBe('jpeg');
  });

  it('unwraps CSS, HTML, Markdown and quotes', () => {
    const d = `data:image/png;base64,${PNG_1PX}`;
    expect(unwrap(`background-image: url("${d}");`)).toBe(d);
    expect(unwrap(`url('${d}')`)).toBe(d);
    expect(unwrap(`<img alt="x" src="${d}">`)).toBe(d);
    expect(unwrap(`![logo](${d})`)).toBe(d);
    expect(unwrap(`"${d}"`)).toBe(d);
    expect(parseDataUrl(`background: url(${d})`).detected).toBe('png');
  });

  it('parses percent-encoded SVG data URLs', () => {
    const url = svgToDataUrl('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect fill="#f00" width="10" height="10"/></svg>');
    expect(url.startsWith('data:image/svg+xml,')).toBe(true);
    expect(url).not.toContain('#');
    const r = parseDataUrl(url);
    expect(r.detected).toBe('svg');
    expect(new TextDecoder().decode(r.bytes)).toContain("fill='#f00'");
  });

  it('gives clear errors', () => {
    expect(() => parseDataUrl('')).toThrow(DataUrlError);
    expect(() => parseDataUrl('data:image/png;base64')).toThrow(/comma/);
    expect(() => parseDataUrl('not base64!!')).toThrow(/invalid characters/);
    expect(() => parseDataUrl('abcde')).toThrow(/length/);
    expect(() => parseDataUrl('data:image/png;base64,')).toThrow(/empty/);
    expect(() => parseDataUrl('data:text/plain,%E0%A4%A')).toThrow(/percent/);
  });

  it('returns null detection for non-images', () => {
    const r = parseDataUrl(`data:text/plain;base64,${btoa('hello')}`);
    expect(r.detected).toBeNull();
    expect(r.declaredMime).toBe('text/plain');
  });
});

describe('encoding helpers', () => {
  it('bytesToBase64 handles large buffers', () => {
    const big = new Uint8Array(200_000).map((_, i) => i & 255);
    const b64 = bytesToBase64(big);
    expect(parseDataUrl(b64).bytes).toEqual(big);
  });
  it('toDataUrl and snippets', () => {
    const url = toDataUrl(new Uint8Array([1, 2, 3]), 'image/png');
    expect(url).toBe('data:image/png;base64,AQID');
    const s = snippets(url, 'A "quoted" [alt]');
    expect(s.css).toBe(`background-image: url("${url}");`);
    expect(s.html).toBe(`<img src="${url}" alt="A &quot;quoted&quot; [alt]" />`);
    expect(s.markdown).toBe(`![A "quoted" alt](${url})`);
  });
  it('extensionFor', () => {
    expect(extensionFor('jpeg', null)).toBe('jpg');
    expect(extensionFor(null, 'image/svg+xml')).toBe('svg');
    expect(extensionFor(null, 'application/x-weird-long-type')).toBe('bin');
    expect(extensionFor(null, null)).toBe('bin');
  });
});
