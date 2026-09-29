import { describe, expect, it } from 'vitest';
import { displayWidth, escapeMarkdownCell, parseMarkdownTable, toMarkdownTable } from './markdownTable';

describe('displayWidth', () => {
  it('counts CJK and emoji as two columns', () => {
    expect(displayWidth('abc')).toBe(3);
    expect(displayWidth('東京')).toBe(4);
    expect(displayWidth('🍣')).toBe(2);
    expect(displayWidth('👩‍💻')).toBe(2);
    expect(displayWidth('é')).toBe(1);
    expect(displayWidth('')).toBe(0);
  });
});

describe('escapeMarkdownCell', () => {
  it('escapes pipes and converts line breaks', () => {
    expect(escapeMarkdownCell('a|b')).toBe('a\\|b');
    expect(escapeMarkdownCell('x\r\ny')).toBe('x<br>y');
  });
});

describe('toMarkdownTable', () => {
  const t = {
    headers: ['Name', 'Qty'],
    rows: [
      ['Apple', '3'],
      ['Kiwi', '12'],
    ],
  };

  it('renders an aligned, padded table', () => {
    expect(toMarkdownTable(t, { align: ['left', 'right'] })).toBe(
      ['| Name  | Qty |', '| :---- | --: |', '| Apple |   3 |', '| Kiwi  |  12 |'].join('\n'),
    );
  });

  it('renders a compact table', () => {
    expect(toMarkdownTable(t, { pretty: false, align: ['center'] })).toBe(
      ['| Name | Qty |', '| :-: | --- |', '| Apple | 3 |', '| Kiwi | 12 |'].join('\n'),
    );
  });

  it('centers text and pads wide characters', () => {
    const out = toMarkdownTable({ headers: ['x'], rows: [['東京'], ['a']] }, { align: ['center'] });
    expect(out.split('\n')).toEqual(['|  x   |', '| :--: |', '| 東京 |', '|  a   |']);
  });

  it('names empty headers and returns nothing for no columns', () => {
    expect(toMarkdownTable({ headers: [''], rows: [] }).split('\n')[0]).toBe('| Column 1 |');
    expect(toMarkdownTable({ headers: [], rows: [] })).toBe('');
  });

  it('round-trips through parseMarkdownTable', () => {
    const table = {
      headers: ['a|b', 'c'],
      rows: [
        ['x\ny', 'back\\slash'],
        ['🍣', ''],
      ],
    };
    const md = toMarkdownTable(table, { align: ['right', 'none'] });
    const parsed = parseMarkdownTable(md);
    expect(parsed?.table).toEqual(table);
    expect(parsed?.align).toEqual(['right', 'none']);
  });
});

describe('parseMarkdownTable', () => {
  it('finds the first table in surrounding text', () => {
    const text = 'Intro\n\nA | B\n--- | :-:\n1 | 2\n3\n\nafter';
    expect(parseMarkdownTable(text)).toEqual({
      table: { headers: ['A', 'B'], rows: [['1', '2']] },
      align: ['none', 'center'],
    });
  });

  it('pads and truncates rows to the header width', () => {
    const r = parseMarkdownTable('| a | b |\n|---|---|\n| 1 |\n| 1 | 2 | 3 |');
    expect(r?.table.rows).toEqual([
      ['1', ''],
      ['1', '2'],
    ]);
  });

  it('returns null when there is no table', () => {
    expect(parseMarkdownTable('just | text')).toBeNull();
    expect(parseMarkdownTable('')).toBeNull();
  });

  it('handles CRLF', () => {
    expect(parseMarkdownTable('|a|\r\n|-|\r\n|1|')?.table.rows).toEqual([['1']]);
  });
});
