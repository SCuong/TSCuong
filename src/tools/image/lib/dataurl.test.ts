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

  it('keeps SVGs with apostrophes and quotes intact (regression: blind " → \' swap broke them)', () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="50"><text font-family="'Open Sans', Arial">Tom &amp; Jerry say "hi" #1 100%</text></svg>`;
    const url = svgToDataUrl(svg);
    expect(url).not.toMatch(/["<>\\\n]/);
    // Decodes back to exactly the original markup (quotes included).
    expect(new TextDecoder().decode(parseDataUrl(url).bytes)).toBe(svg);
    // Without apostrophes or quoted text, the shorter single-quote form is used.
    const plain = svgToDataUrl(`<svg xmlns="http://www.w3.org/2000/svg"><rect fill="red"/></svg>`);
    expect(plain).toBe(`data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'%3E%3Crect fill='red'/%3E%3C/svg%3E`);
    // " inside text content is not changed into '.
    const quoted = `<svg xmlns="http://www.w3.org/2000/svg"><text>"hi"</text></svg>`;
    expect(new TextDecoder().decode(parseDataUrl(svgToDataUrl(quoted)).bytes)).toBe(quoted);
  });

  it('collapses insignificant whitespace but keeps preserved text and non-breaking spaces', () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg">\n  <text>a  b</text>\n</svg>';
    expect(new TextDecoder().decode(parseDataUrl(svgToDataUrl(svg)).bytes)).toBe('<svg xmlns=\'http://www.w3.org/2000/svg\'> <text>a  b</text> </svg>');
    const pre = '<svg xmlns="http://www.w3.org/2000/svg" xml:space="preserve"><text>a  \n\tb</text></svg>';
    const url = svgToDataUrl(pre);
    expect(url).not.toMatch(/\n|\t/);
    expect(new TextDecoder().decode(parseDataUrl(url).bytes)).toBe(pre.replace(/"/g, "'"));
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
    const s = snippets(url, 'A "quoted" [alt] & <b>');
    expect(s.css).toBe(`background-image: url("${url}");`);
    expect(s.html).toBe(`<img src="${url}" alt="A &quot;quoted&quot; [alt] &amp; &lt;b&gt;" />`);
    expect(s.markdown).toBe(`![A "quoted" alt & <b>](${url})`);
  });
  it('snippets stay valid for URL-encoded SVG (spaces, &, parentheses)', () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><g transform="translate(1 2)"><text>A &amp; B</text></g></svg>`;
    const url = svgToDataUrl(svg);
    const s = snippets(url, 'x');
    // HTML: & is escaped so the browser hands the original &amp; back to the SVG parser.
    expect(s.html).toContain('A &amp;amp; B');
    expect(unwrap(s.html)).toBe(url);
    // Markdown: no raw spaces or parentheses in the link destination.
    const dest = /^!\[x\]\((.*)\)$/.exec(s.markdown)![1];
    expect(dest).not.toMatch(/[ ()]/);
    expect(new TextDecoder().decode(parseDataUrl(s.markdown).bytes)).toBe(new TextDecoder().decode(parseDataUrl(url).bytes));
    // CSS: the url("…") string needs no escaping.
    expect(s.css).toBe(`background-image: url("${url}");`);
  });
  it('unwrap handles Markdown <…> destinations, titles and HTML entities', () => {
    const d = 'data:image/png;base64,AQID';
    expect(unwrap(`![a](<${d}>)`)).toBe(d);
    expect(unwrap(`![a](${d} "title")`)).toBe(d);
    expect(unwrap(`<img src="data:image/svg+xml,%3Csvg%3E&amp;x&#39;" alt="">`)).toBe("data:image/svg+xml,%3Csvg%3E&x'");
  });
  it('extensionFor', () => {
    expect(extensionFor('jpeg', null)).toBe('jpg');
    expect(extensionFor(null, 'image/svg+xml')).toBe('svg');
    expect(extensionFor(null, 'application/x-weird-long-type')).toBe('bin');
    expect(extensionFor(null, null)).toBe('bin');
  });
});
