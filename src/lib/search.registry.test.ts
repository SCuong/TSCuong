import { describe, expect, it } from 'vitest';
import { searchTools, TOOLS } from '@/tools/registry';

/** Top result for a query against the real tool registry. */
const top = (query: string) => searchTools(query, 5)[0]?.item.id;
const ids = (query: string, limit = 5) => searchTools(query, limit).map((r) => r.item.id);

describe('universal search over the real registry', () => {
  // The queries from the product brief, plus common variants people type.
  it.each([
    ['json', 'json-formatter'],
    ['format json', 'json-formatter'],
    ['pretty print json', 'json-formatter'],
    ['compress picture', 'image-compress'],
    ['compress image', 'image-compress'],
    ['merge pdf', 'pdf-merge'],
    ['combine pdfs', 'pdf-merge'],
    ['remove pdf page', 'pdf-delete-pages'],
    ['csv json', 'csv-to-json'],
    ['csv to json', 'csv-to-json'],
    ['sqlite', 'sqlite-viewer'],
    ['regex', 'regex-tester'],
    ['base64 decode', 'base64-text'],
    ['diagram', 'mermaid-studio'],
    ['mermaid', 'mermaid-studio'],
    ['markdown', 'markdown-notes'],
    ['compare files', 'text-diff'],
    ['uuid', 'uuid-generator'],
    ['hash text', 'hash-generator'],
    ['postman', 'api-client'],
  ])('"%s" → %s', (query, expected) => {
    expect(top(query)).toBe(expected);
  });

  it('finds the image converter for format-to-format phrasing', () => {
    expect(ids('jpg to webp', 3)).toContain('image-convert');
    expect(ids('png to jpeg', 3)).toContain('image-convert');
  });

  it('tolerates typos in common queries', () => {
    expect(top('jsno formater')).toBe('json-formatter');
    expect(top('mermiad')).toBe('mermaid-studio');
  });

  it('every tool can be found by its own name', () => {
    const misses = TOOLS.filter((tool) => !ids(tool.name, 3).includes(tool.id)).map((t) => `${t.id} (“${t.name}”)`);
    expect(misses).toEqual([]);
  });
});
