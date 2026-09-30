import { describe, expect, it } from 'vitest';
import { formatXml, minifyXml, xmlStats } from './xmlFormat';
import { buildXmlTree, parseXmlDocument } from './xmlTree';

describe('formatXml', () => {
  it('indents nested elements and keeps text elements on one line', () => {
    const r = formatXml('<?xml version="1.0"?><a><b>text</b><c x="1"/><d></d></a>', { indent: '2' });
    expect(r.ok && r.value).toBe('<?xml version="1.0"?>\n<a>\n  <b>text</b>\n  <c x="1"/>\n  <d></d>\n</a>\n');
  });

  it('collapses or expands empty elements when asked', () => {
    expect(formatXml('<a><d></d><e/></a>', { indent: '2', emptyElements: 'collapse' })).toMatchObject({
      value: '<a>\n  <d/>\n  <e/>\n</a>\n',
    });
    expect(formatXml('<a><d></d><e x="1"/></a>', { indent: '2', emptyElements: 'expand' })).toMatchObject({
      value: '<a>\n  <d></d>\n  <e x="1"></e>\n</a>\n',
    });
  });

  it('keeps mixed content and xml:space="preserve" as written', () => {
    const r = formatXml('<r><p>Hello <b>big</b>  world</p><pre xml:space="preserve"><x>  a  </x>\n  </pre></r>', { indent: '2' });
    expect(r.ok && r.value).toBe('<r>\n  <p>Hello <b>big</b>  world</p>\n  <pre xml:space="preserve"><x>  a  </x>\n  </pre>\n</r>\n');
  });

  it('keeps comments, CDATA and doctype', () => {
    const r = formatXml('<!DOCTYPE a [<!ENTITY e "x">]><!-- c --><a><![CDATA[ <raw> ]]></a>', { indent: '4' });
    expect(r.ok && r.value).toBe('<!DOCTYPE a [<!ENTITY e "x">]>\n<!-- c -->\n<a><![CDATA[ <raw> ]]></a>\n');
  });

  it('never expands entities, including external ones', () => {
    const xml = '<!DOCTYPE r [<!ENTITY xxe SYSTEM "file:///etc/passwd"><!ENTITY e "hi">]><r><a>&xxe;</a><b>&e; &amp; &#65;</b></r>';
    const r = formatXml(xml, { indent: '2' });
    expect(r.ok && r.value).toBe(
      '<!DOCTYPE r [<!ENTITY xxe SYSTEM "file:///etc/passwd"><!ENTITY e "hi">]>\n<r>\n  <a>&xxe;</a>\n  <b>&e; &amp; &#65;</b>\n</r>\n',
    );
  });

  it('accepts a DOCTYPE internal subset with comments, quotes and processing instructions', () => {
    const xml = `<!DOCTYPE note [\n  <!-- it's "quoted" ] > -->\n  <?pi don't ?>\n  <!ELEMENT note (#PCDATA)>\n]>\n<note>x</note>`;
    const r = formatXml(xml, { indent: '2' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.endsWith('<note>x</note>\n')).toBe(true);
  });

  it('uses tabs', () => {
    const r = formatXml('<a><b/></a>', { indent: 'tab' });
    expect(r.ok && r.value).toBe('<a>\n\t<b/>\n</a>\n');
  });

  it('keeps attribute quoting as written, or switches to double quotes', () => {
    expect(formatXml(`<a x='1' y="2"/>`, { indent: '2' })).toMatchObject({ value: `<a x='1' y="2"/>\n` });
    expect(formatXml(`<a x='say "hi"' y="2"/>`, { indent: '2', doubleQuotes: true })).toMatchObject({
      value: `<a x="say &quot;hi&quot;" y="2"/>\n`,
    });
  });

  it('puts attributes on separate lines', () => {
    const r = formatXml('<r><item id="1" name="a b" enabled="true"><v/></item><one x="1"/></r>', { indent: '2', attributes: 'multiline' });
    expect(r.ok && r.value).toBe(
      '<r>\n  <item\n    id="1"\n    name="a b"\n    enabled="true">\n    <v/>\n  </item>\n  <one x="1"/>\n</r>\n',
    );
  });

  it('wraps attributes only for long tags in auto mode', () => {
    const long = `<r><a first="${'x'.repeat(60)}" second="${'y'.repeat(40)}"/><b p="1" q="2"/></r>`;
    const r = formatXml(long, { indent: '2', attributes: 'auto' });
    expect(r.ok && r.value).toBe(`<r>\n  <a\n    first="${'x'.repeat(60)}"\n    second="${'y'.repeat(40)}"/>\n  <b p="1" q="2"/>\n</r>\n`);
  });

  it('removes comments when asked, also inside mixed content', () => {
    const r = formatXml('<!-- top --><r><!-- a --><p>Hi <!-- b --><b>x</b></p><t>1<!-- c -->2</t></r>', { indent: '2', removeComments: true });
    expect(r.ok && r.value).toBe('<r>\n  <p>Hi <b>x</b></p>\n  <t>12</t>\n</r>\n');
  });

  it('keeps whitespace-only text verbatim', () => {
    const r = formatXml('<a><b>   </b></a>', { indent: '2' });
    expect(r.ok && r.value).toBe('<a>\n  <b>   </b>\n</a>\n');
  });

  it('reports errors with line and column', () => {
    const r = formatXml('<a>\n<b></c>\n</a>', { indent: '2' });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toMatchObject({ line: 2, column: 4 });
      expect(r.error.message).toBe('Expected closing tag </b> (opened on line 2) but found </c>');
    }
  });

  it('normalizes CRLF and BOM', () => {
    const r = formatXml('\uFEFF<a>\r\n<b>1</b>\r\n</a>', { indent: '2' });
    expect(r.ok && r.value).toBe('<a>\n  <b>1</b>\n</a>\n');
  });

  it('handles Unicode names and text', () => {
    const r = formatXml('<données><élément>😀</élément></données>', { indent: '2' });
    expect(r.ok && r.value).toBe('<données>\n  <élément>😀</élément>\n</données>\n');
  });

  it('keeps namespace prefixes and processing instructions', () => {
    const r = formatXml('<?xml-stylesheet href="s.xsl"?><x:r xmlns:x="urn:x"><x:c x:a="1"/></x:r>', { indent: '2' });
    expect(r.ok && r.value).toBe('<?xml-stylesheet href="s.xsl"?>\n<x:r xmlns:x="urn:x">\n  <x:c x:a="1"/>\n</x:r>\n');
  });

  it('is idempotent', () => {
    const once = formatXml('<a><b><c>1</c></b><d/></a>', { indent: '2', attributes: 'multiline' });
    expect(once.ok).toBe(true);
    if (once.ok) {
      const twice = formatXml(once.value, { indent: '2', attributes: 'multiline' });
      expect(twice.ok && twice.value).toBe(once.value);
    }
  });

  it('handles large documents', () => {
    const xml = `<r>${'<i><v>1</v></i>'.repeat(10000)}</r>`;
    const r = formatXml(xml, { indent: '2' });
    expect(r.ok && r.value.split('\n').length).toBe(30000 + 3);
  });

  it('handles deep nesting', () => {
    const xml = '<a>'.repeat(2000) + 'x' + '</a>'.repeat(2000);
    const r = formatXml(xml, { indent: '2' });
    expect(r.ok).toBe(true);
  });
});

describe('minifyXml', () => {
  it('removes whitespace between tags but keeps text', () => {
    const r = minifyXml('<a>\n  <b> keep  me </b>\n  <c/>\n  <d></d>\n</a>\n');
    expect(r.ok && r.value).toBe('<a><b> keep  me </b><c/><d/></a>');
  });

  it('removes comments when asked', () => {
    expect(minifyXml('<a><!-- x --><b/></a>', { removeComments: true })).toEqual({ ok: true, value: '<a><b/></a>', warnings: [] });
    const kept = minifyXml('<a><!-- x --><b/></a>');
    expect(kept.ok && kept.value).toBe('<a><!-- x --><b/></a>');
  });

  it('keeps mixed content spacing', () => {
    const r = minifyXml('<p>Hello <b>world</b> !</p>');
    expect(r.ok && r.value).toBe('<p>Hello <b>world</b> !</p>');
  });

  it('keeps the prolog', () => {
    const r = minifyXml('<?xml version="1.0"?>\n<!DOCTYPE a>\n<a>\n  <b/>\n</a>\n');
    expect(r.ok && r.value).toBe('<?xml version="1.0"?><!DOCTYPE a><a><b/></a>');
  });

  it('round-trips with the formatter', () => {
    const src = '<r><a x="1">t</a><b><c/></b></r>';
    const pretty = formatXml(src, { indent: '2' });
    expect(pretty.ok && minifyXml(pretty.value)).toEqual({ ok: true, value: src, warnings: [] });
  });

  it('reports invalid input', () => {
    expect(minifyXml('<a>').ok).toBe(false);
    expect(minifyXml('').ok).toBe(false);
  });
});

describe('xmlStats', () => {
  it('counts elements, attributes, depth and comments', () => {
    expect(xmlStats('<a x="1"><!--c--><b y="2" z="3"><c/></b></a>')).toMatchObject({ elements: 3, attributes: 3, maxDepth: 3, comments: 1 });
  });

  it('counts namespaces, CDATA, processing instructions and text', () => {
    const s = xmlStats(
      '<?xml version="1.0"?><?pi x?><!DOCTYPE r><r xmlns="urn:a" xmlns:b="urn:b"><b:t>hi</b:t><c><![CDATA[x]]></c>\n</r>',
    );
    expect(s).toEqual({
      elements: 3,
      attributes: 2,
      maxDepth: 2,
      comments: 0,
      cdata: 1,
      processingInstructions: 1,
      namespaces: 2,
      textNodes: 1,
      doctype: true,
      declaration: true,
      root: 'r',
    });
  });

  it('returns null for invalid XML', () => {
    expect(xmlStats('<a>')).toBeNull();
  });
});

describe('parseXmlDocument', () => {
  function error(xml: string) {
    const r = parseXmlDocument(xml);
    if (r.ok) throw new Error('expected an error');
    return r.error;
  }

  it('reports unclosed elements', () => {
    expect(error('<a><b></b>')).toMatchObject({ message: 'Element <a> is not closed', line: 1, column: 1 });
  });

  it('reports unquoted attributes at the value', () => {
    expect(error('<a x=1/>')).toMatchObject({ message: 'Value of attribute "x" must be quoted', column: 6 });
  });

  it('reports duplicate attributes', () => {
    expect(error('<a x="1" x="2"/>').message).toMatch(/appears more than once/);
  });

  it('reports "<" inside attribute values', () => {
    expect(error('<a b="x<y"/>')).toMatchObject({ column: 8 });
  });

  it('reports attributes without whitespace between them', () => {
    expect(error('<a x="1"y="2"/>').message).toMatch(/separated by whitespace/);
  });

  it('reports unclosed comments precisely', () => {
    expect(error('<a>\n  <!-- open\n</a>')).toMatchObject({ message: 'Comment is not closed (missing -->)', line: 2, column: 3 });
  });

  it('reports text outside the root at the first character', () => {
    expect(error('<a/>\n\n  junk')).toMatchObject({ message: 'Text is not allowed after the root element', line: 3, column: 3 });
    expect(error('junk<a/>')).toMatchObject({ message: 'Text is not allowed before the root element', line: 1, column: 1 });
  });

  it('reports multiple roots', () => {
    expect(error('<a/><b/>').message).toMatch(/single root element, but <b> follows <a>/);
  });

  it('reports a DOCTYPE after the root', () => {
    expect(error('<a/><!DOCTYPE a>').message).toMatch(/only allowed before the root/);
  });

  it('reports invalid tag starts', () => {
    expect(error('<a>< b</a>').message).toBe('a space cannot start a tag name (use &lt; for a literal <)');
  });

  it('reports bare ampersands (validator)', () => {
    expect(error('<a>fish & chips</a>')).toMatchObject({ line: 1, column: 9 });
  });

  it('builds a tree with source ranges', () => {
    const doc = buildXmlTree('<a><b>t</b></a>');
    expect(doc.root.name).toBe('a');
    expect(doc.root.children[0]).toMatchObject({ type: 'element', name: 'b', start: 3, end: 11 });
  });

  it('accepts names with combining marks', () => {
    const r = parseXmlDocument('<é/>');
    expect(r.ok).toBe(true);
  });
});
