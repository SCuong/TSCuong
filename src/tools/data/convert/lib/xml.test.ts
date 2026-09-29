import { describe, expect, it } from 'vitest';
import { jsonToXml, toXmlName, xmlToJson, type JsonToXmlOptions, type XmlToJsonOptions } from './xml';

const X2J: XmlToJsonOptions = {
  indent: '2',
  attributes: true,
  attributePrefix: '@_',
  textKey: '#text',
  parseValues: true,
  alwaysArray: false,
};

const J2X: JsonToXmlOptions = {
  indent: '2',
  rootName: 'root',
  itemName: 'item',
  attributePrefix: '@_',
  textKey: '#text',
  declaration: false,
};

function json(r: ReturnType<typeof xmlToJson>) {
  if (!r.ok) throw new Error(r.error.message);
  return JSON.parse(r.value);
}

describe('xmlToJson', () => {
  it('converts elements, attributes and repeated children', () => {
    const xml = '<?xml version="1.0"?><books><book id="1"><title>A</title></book><book id="2"><title>B</title></book></books>';
    expect(json(xmlToJson(xml, X2J))).toEqual({
      books: { book: [{ '@_id': 1, title: 'A' }, { '@_id': 2, title: 'B' }] },
    });
  });

  it('can ignore attributes', () => {
    expect(json(xmlToJson('<a x="1"><b>t</b></a>', { ...X2J, attributes: false }))).toEqual({ a: { b: 't' } });
  });

  it('keeps values as strings when parsing is off', () => {
    expect(json(xmlToJson('<a><n>007</n><b>true</b></a>', { ...X2J, parseValues: false }))).toEqual({ a: { n: '007', b: 'true' } });
  });

  it('does not strip leading zeros when parsing numbers', () => {
    expect(json(xmlToJson('<a><zip>01234</zip><n>42</n></a>', X2J))).toEqual({ a: { zip: '01234', n: 42 } });
  });

  it('always produces arrays when asked (except the root)', () => {
    expect(json(xmlToJson('<r><a>1</a></r>', { ...X2J, alwaysArray: true }))).toEqual({ r: { a: [1] } });
  });

  it('uses the text key for elements with attributes and text', () => {
    expect(json(xmlToJson('<a lang="en">Hi</a>', X2J))).toEqual({ a: { '#text': 'Hi', '@_lang': 'en' } });
  });

  it('lists attributes first, then text, then child elements', () => {
    const r = xmlToJson('<r><b id="1" x="y"><c>1</c></b><t lang="en">Hi</t></r>', X2J);
    expect(r.ok && r.value).toBe(
      '{\n  "r": {\n    "b": {\n      "@_id": 1,\n      "@_x": "y",\n      "c": 1\n    },\n    "t": {\n      "@_lang": "en",\n      "#text": "Hi"\n    }\n  }\n}',
    );
  });

  it('strips namespace prefixes when asked', () => {
    expect(json(xmlToJson('<ns:r xmlns:ns="u"><ns:a>1</ns:a></ns:r>', { ...X2J, attributes: false, stripNamespaces: true }))).toEqual({
      r: { a: 1 },
    });
  });

  it('decodes entities and CDATA', () => {
    expect(json(xmlToJson('<a><b>x &amp; y &lt; z</b><c><![CDATA[<raw>]]></c></a>', X2J))).toEqual({
      a: { b: 'x & y < z', c: '<raw>' },
    });
  });

  it('warns about mixed content', () => {
    const r = xmlToJson('<p>Hello <b>world</b>!</p>', X2J);
    expect(r.ok && r.warnings.length).toBe(1);
  });

  it('reports malformed XML with line and column', () => {
    const r = xmlToJson('<a>\n  <b>\n</a>', X2J);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.line).toBe(3);
      expect(r.error.column).toBeGreaterThan(0);
    }
  });

  it('rejects multiple roots and text outside the root', () => {
    expect(xmlToJson('<a/><b/>', X2J).ok).toBe(false);
    expect(xmlToJson('<a/>junk', X2J).ok).toBe(false);
  });

  it('reports empty input', () => {
    const r = xmlToJson('   ', X2J);
    expect(r.ok).toBe(false);
  });

  it('handles BOM, CRLF and Unicode', () => {
    expect(json(xmlToJson('﻿<r>\r\n  <名前>😀 café</名前>\r\n</r>', X2J))).toEqual({ r: { 名前: '😀 café' } });
  });

  it('validates option values', () => {
    expect(xmlToJson('<a/>', { ...X2J, attributePrefix: '' }).ok).toBe(false);
    expect(xmlToJson('<a/>', { ...X2J, textKey: '' }).ok).toBe(false);
  });

  it('handles large input', () => {
    const xml = `<list>${Array.from({ length: 5000 }, (_, i) => `<i n="${i}">v${i}</i>`).join('')}</list>`;
    const out = json(xmlToJson(xml, X2J));
    expect(out.list.i).toHaveLength(5000);
  });
});

describe('jsonToXml', () => {
  it('uses a single top-level key as the root', () => {
    const r = jsonToXml('{"note":{"@_id":"7","to":"Tove","body":"Hi"}}', J2X);
    expect(r.ok && r.value).toBe('<note id="7">\n  <to>Tove</to>\n  <body>Hi</body>\n</note>\n');
  });

  it('wraps other values in the root element', () => {
    const r = jsonToXml('{"a":1,"b":2}', J2X);
    expect(r.ok && r.value).toBe('<root>\n  <a>1</a>\n  <b>2</b>\n</root>\n');
  });

  it('repeats elements for arrays', () => {
    const r = jsonToXml('{"r":{"tag":["a","b"]}}', J2X);
    expect(r.ok && r.value).toBe('<r>\n  <tag>a</tag>\n  <tag>b</tag>\n</r>\n');
  });

  it('wraps a top-level array in item elements', () => {
    const r = jsonToXml('[1,2]', J2X);
    expect(r.ok && r.value).toBe('<root>\n  <item>1</item>\n  <item>2</item>\n</root>\n');
  });

  it('adds an XML declaration', () => {
    const r = jsonToXml('{"a":1}', { ...J2X, declaration: true });
    expect(r.ok && r.value.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<a>1</a>')).toBe(true);
  });

  it('escapes special characters', () => {
    const r = jsonToXml('{"a":"x < y & \\"z\\""}', J2X);
    expect(r.ok && r.value).toContain('x &lt; y &amp;');
  });

  it('renames invalid keys with a warning', () => {
    const r = jsonToXml('{"r":{"first name":"A","1st":"B"}}', J2X);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value).toContain('<first_name>A</first_name>');
      expect(r.value).toContain('<_1st>B</_1st>');
      expect(r.warnings[0]).toMatch(/2 keys were renamed/);
    }
  });

  it('removes control characters XML cannot hold', () => {
    const r = jsonToXml('{"a":"x\\u0001y"}', J2X);
    expect(r.ok && r.value).toContain('<a>xy</a>');
    expect(r.ok && r.warnings.length).toBe(1);
  });

  it('rejects invalid root and item names', () => {
    expect(jsonToXml('[1]', { ...J2X, rootName: '1bad' }).ok).toBe(false);
    expect(jsonToXml('[1]', { ...J2X, itemName: 'has space' }).ok).toBe(false);
  });

  it('reports invalid JSON', () => {
    const r = jsonToXml('{"a":', J2X);
    expect(r.ok).toBe(false);
  });

  it('round-trips through XML', () => {
    const data = { catalog: { item: [{ '@_sku': 'A1', name: 'Café ☕', qty: 2 }, { '@_sku': 'B2', name: 'Tea', qty: 5 }] } };
    const x = jsonToXml(JSON.stringify(data), J2X);
    expect(x.ok).toBe(true);
    if (x.ok) expect(json(xmlToJson(x.value, X2J))).toEqual(data);
  });
});

describe('toXmlName', () => {
  it('keeps valid names and fixes invalid ones', () => {
    expect(toXmlName('valid_name')).toBe('valid_name');
    expect(toXmlName('ns:el')).toBe('ns:el');
    expect(toXmlName('café')).toBe('café');
    expect(toXmlName('a b')).toBe('a_b');
    expect(toXmlName('9lives')).toBe('_9lives');
    expect(toXmlName('-x')).toBe('_-x');
    expect(toXmlName('́x')).toBe('_́x');
    expect(toXmlName('')).toBe('_');
    expect(toXmlName('😀')).toMatch(/^_+$/);
  });
});

describe('xmlToJson: safety and fidelity', () => {
  it('keeps elements and attributes named constructor, prototype or __proto__', () => {
    const r = xmlToJson('<class><constructor visibility="public">init</constructor><prototype/><__proto__ constructor="x">p</__proto__><toString>s</toString></class>', X2J);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).not.toContain('\\u0000');
    const parsed = JSON.parse(r.value);
    expect(parsed.class.constructor).toEqual({ '#text': 'init', '@_visibility': 'public' });
    expect(parsed.class.prototype).toBe('');
    expect(Object.hasOwn(parsed.class, '__proto__')).toBe(true);
    expect(parsed.class.toString).toBe('s');
    expect(({} as Record<string, unknown>).constructor).toBe(Object);
  });

  it('keeps a root named constructor when forcing arrays', () => {
    expect(json(xmlToJson('<constructor><a>1</a></constructor>', { ...X2J, alwaysArray: true }))).toEqual({ constructor: { a: [1] } });
  });

  it('never loads external entities', () => {
    const r = xmlToJson('<?xml version="1.0"?><!DOCTYPE r [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><r><a>&xxe;</a><b>&amp; &lt;</b></r>', X2J);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(JSON.parse(r.value)).toEqual({ r: { a: '&xxe;', b: '& <' } });
    expect(r.warnings[0]).toMatch(/external entities, which are never loaded/);
  });

  it('expands internal entities but not recursive "billion laughs" ones', () => {
    const lol = '<!DOCTYPE r [<!ENTITY a "x"><!ENTITY b "&a;&a;&a;&a;&a;&a;&a;&a;&a;&a;"><!ENTITY c "&b;&b;&b;&b;&b;&b;&b;&b;&b;&b;">]><r><e>&a;</e><big>&c;</big></r>';
    const r = xmlToJson(lol, X2J);
    expect(r.ok).toBe(true);
    if (r.ok) {
      const out = JSON.parse(r.value);
      expect(out.r.e).toBe('x');
      expect(out.r.big.length).toBeLessThan(200);
    }
  });

  it('warns about dropped comments and processing instructions', () => {
    const r = xmlToJson('<?xml version="1.0"?><?xml-stylesheet href="a.xsl"?><r><!-- one --><a>1</a><!-- two --></r>', X2J);
    expect(r.ok && r.warnings).toEqual(['2 comments were dropped, because JSON has no comments.', '1 processing instruction (<?…?>) was dropped.']);
  });

  it('keeps very large integers as strings instead of rounding them', () => {
    expect(json(xmlToJson('<r><id>12345678901234567890</id><n>42</n></r>', X2J))).toEqual({ r: { id: '12345678901234567890', n: 42 } });
  });

  it('converts documents nested deeper than 100 levels', () => {
    const xml = '<a>'.repeat(300) + 'x' + '</a>'.repeat(300);
    const r = xmlToJson(xml, X2J);
    expect(r.ok).toBe(true);
  });

  it('reports the precise error position for malformed input', () => {
    const r = xmlToJson('<r>\n  <a>1</b>\n</r>', X2J);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatchObject({ message: 'Expected closing tag </a> (opened on line 2) but found </b>', line: 2, column: 7 });
  });
});

describe('jsonToXml: fidelity', () => {
  it('keeps integers beyond 2^53 exact', () => {
    const r = jsonToXml('{"r":{"id":123456789012345678901234567890,"@_big":98765432109876543210}}', J2X);
    expect(r.ok && r.value).toBe('<r big="98765432109876543210">\n  <id>123456789012345678901234567890</id>\n</r>\n');
  });

  it('keeps __proto__ keys as elements', () => {
    const r = jsonToXml('{"r":{"__proto__":{"a":1}}}', J2X);
    expect(r.ok && r.value).toBe('<r>\n  <__proto__>\n    <a>1</a>\n  </__proto__>\n</r>\n');
  });

  it('writes null and empty objects as empty elements and warns about empty arrays', () => {
    const r = jsonToXml('{"r":{"a":null,"b":{},"c":"","tags":[]}}', J2X);
    expect(r.ok && r.value).toBe('<r>\n  <a/>\n  <b/>\n  <c/>\n</r>\n');
    expect(r.ok && r.warnings).toEqual(['1 empty array produced no elements.']);
  });

  it('serializes object values of attributes and text as JSON', () => {
    const r = jsonToXml('{"r":{"@_meta":{"a":1},"#text":[1,2]}}', J2X);
    expect(r.ok && r.value).toBe('<r meta="{&quot;a&quot;:1}">[1,2]</r>\n');
  });

  it('uses tabs and 4 spaces', () => {
    expect(jsonToXml('{"a":{"b":1}}', { ...J2X, indent: 'tab' })).toMatchObject({ value: '<a>\n\t<b>1</b>\n</a>\n' });
    expect(jsonToXml('{"a":{"b":1}}', { ...J2X, indent: '4' })).toMatchObject({ value: '<a>\n    <b>1</b>\n</a>\n' });
  });

  it('handles emoji and scalars at the top level', () => {
    expect(jsonToXml('"😀 & <b>"', J2X)).toMatchObject({ value: '<root>😀 &amp; &lt;b&gt;</root>\n' });
    expect(jsonToXml('42', J2X)).toMatchObject({ value: '<root>42</root>\n' });
  });
});
