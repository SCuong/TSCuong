import { describe, expect, it } from 'vitest';
import { escapeHtml, sanitizeClassName, sanitizeId, toHtmlTable } from './htmlTable';

const t = {
  headers: ['Name', 'Note'],
  rows: [
    ['Ada', '<b>bold</b> & "q"'],
    ['Zoë', 'line 1\nline 2'],
  ],
};

describe('toHtmlTable', () => {
  it('renders thead and tbody with escaping and line breaks', () => {
    expect(toHtmlTable(t)).toBe(
      [
        '<table>',
        '  <thead>',
        '    <tr>',
        '      <th scope="col">Name</th>',
        '      <th scope="col">Note</th>',
        '    </tr>',
        '  </thead>',
        '  <tbody>',
        '    <tr>',
        '      <td>Ada</td>',
        '      <td>&lt;b&gt;bold&lt;/b&gt; &amp; &quot;q&quot;</td>',
        '    </tr>',
        '    <tr>',
        '      <td>Zoë</td>',
        '      <td>line 1<br>line 2</td>',
        '    </tr>',
        '  </tbody>',
        '</table>',
      ].join('\n'),
    );
  });

  it('can put the header in the body, minify and skip escaping', () => {
    const html = toHtmlTable({ headers: ['a'], rows: [['<i>x</i>']] }, { thead: false, indent: 'none', escape: false });
    expect(html).toBe('<table><tbody><tr><td>a</td></tr><tr><td><i>x</i></td></tr></tbody></table>');
  });

  it('adds id, class, caption, row headers and alignment', () => {
    const html = toHtmlTable(
      { headers: ['k', 'v'], rows: [['a', '1']] },
      {
        id: 'my table',
        className: 'data "evil" striped',
        caption: 'Totals <2024>',
        rowHeaders: true,
        align: ['left', 'right'],
        indent: 'tab',
      },
    );
    expect(html).toContain('<table id="my-table" class="data evil striped">');
    expect(html).toContain('\t<caption>Totals &lt;2024&gt;</caption>');
    expect(html).toContain('<th scope="row" style="text-align: left">a</th>');
    expect(html).toContain('<td style="text-align: right">1</td>');
  });

  it('keeps line breaks raw when asked', () => {
    expect(toHtmlTable({ headers: ['a'], rows: [['x\ny']] }, { lineBreaks: false, indent: 'none' })).toContain('<td>x\ny</td>');
  });

  it('handles an empty table', () => {
    expect(toHtmlTable({ headers: [], rows: [] })).toBe('<table>\n</table>');
  });

  it('pads short rows', () => {
    expect(toHtmlTable({ headers: ['a', 'b'], rows: [['1']] }, { indent: 'none' })).toContain('<td>1</td><td></td>');
  });
});

describe('sanitizers', () => {
  it('escapeHtml', () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;');
  });
  it('sanitizeClassName keeps Tailwind-style tokens', () => {
    expect(sanitizeClassName('  w-1/2 md:flex  "><script>')).toBe('w-1/2 md:flex script');
  });
  it('sanitizeId', () => {
    expect(sanitizeId(' a b"c ')).toBe('a-b-c');
  });
});
