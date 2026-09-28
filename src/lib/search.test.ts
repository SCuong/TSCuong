import { describe, expect, it } from 'vitest';
import { createSearchIndex, editDistance, normalize, tokenize, type SearchDoc } from './search';

const docs: SearchDoc[] = [
  { id: 'json-formatter', name: 'JSON Formatter', description: 'Pretty-print or minify JSON.', category: 'json', keywords: ['json', 'format', 'beautify', 'minify'], aliases: ['format json', 'pretty print json'] },
  { id: 'csv-to-json', name: 'CSV to JSON', description: 'Convert CSV rows into JSON.', category: 'json', keywords: ['csv', 'json', 'convert'] },
  { id: 'json-to-csv', name: 'JSON to CSV', description: 'Flatten JSON into CSV.', category: 'json', keywords: ['json', 'csv', 'convert'] },
  { id: 'image-compress', name: 'Image Compressor', description: 'Reduce image file size.', category: 'image', keywords: ['compress', 'jpg', 'png', 'webp', 'shrink'] },
  { id: 'image-convert', name: 'Image Converter', description: 'Convert between image formats.', category: 'image', keywords: ['convert', 'jpg', 'jpeg', 'png', 'webp', 'avif'] },
  { id: 'pdf-merge', name: 'Merge PDFs', description: 'Combine several PDFs into one.', category: 'pdf', keywords: ['pdf', 'merge', 'combine', 'join'] },
  { id: 'pdf-delete', name: 'Delete PDF Pages', description: 'Remove pages from a PDF.', category: 'pdf', keywords: ['pdf', 'delete', 'remove', 'pages'] },
  { id: 'jwt-decoder', name: 'JWT Decoder', description: 'Decode and verify JSON Web Tokens.', category: 'security', keywords: ['jwt', 'token', 'decode', 'verify'] },
  { id: 'regex-tester', name: 'Regex Tester', description: 'Test regular expressions.', category: 'text', keywords: ['regex', 'regexp', 'pattern'] },
  { id: 'uuid', name: 'UUID Generator', description: 'Generate UUIDs.', category: 'generators', keywords: ['uuid', 'guid', 'v4', 'v7'] },
  { id: 'mermaid', name: 'Mermaid Diagram Studio', description: 'Flowcharts and diagrams from text.', category: 'workspace', keywords: ['mermaid', 'diagram', 'flowchart', 'uml'] },
];
const categoryNames: Record<string, string> = { json: 'JSON', image: 'Images', pdf: 'PDF', security: 'Security', text: 'Text', generators: 'Generators', workspace: 'Workspaces' };
const { search } = createSearchIndex(docs, (id) => categoryNames[id]);
const top = (q: string) => search(q)[0]?.item.id;

describe('normalize/tokenize', () => {
  it('lowercases, strips accents and punctuation', () => {
    expect(normalize('  Café — JSON!! ')).toBe('cafe json');
  });
  it('turns arrows into "to"', () => {
    expect(normalize('csv→json')).toBe('csv to json');
    expect(normalize('csv->json')).toBe('csv to json');
  });
  it('drops stop words but keeps a query made only of stop words', () => {
    expect(tokenize('jpg to webp')).toEqual(['jpg', 'webp']);
    expect(tokenize('to')).toEqual(['to']);
  });
});

describe('editDistance', () => {
  it('counts substitutions, insertions and transpositions', () => {
    expect(editDistance('json', 'json', 2)).toBe(0);
    expect(editDistance('jsno', 'json', 2)).toBe(1);
    expect(editDistance('formater', 'formatter', 2)).toBe(1);
    expect(editDistance('abc', 'xyz', 1)).toBe(2);
  });
});

describe('search', () => {
  it('returns nothing for blank queries', () => {
    expect(search('   ')).toEqual([]);
  });
  it('finds tools by name, keyword, alias and category', () => {
    expect(top('json')).toBe('json-formatter');
    expect(top('format json')).toBe('json-formatter');
    expect(top('pretty print json')).toBe('json-formatter');
    expect(top('merge pdf')).toBe('pdf-merge');
    expect(top('decode jwt')).toBe('jwt-decoder');
    expect(top('regex')).toBe('regex-tester');
    expect(top('uuid')).toBe('uuid');
  });
  it('respects word order for converters', () => {
    expect(top('csv json')).toBe('csv-to-json');
    expect(top('json to csv')).toBe('json-to-csv');
  });
  it('understands synonyms', () => {
    expect(top('compress picture')).toBe('image-compress');
    expect(top('guid')).toBe('uuid');
    expect(top('combine pdf')).toBe('pdf-merge');
    expect(top('remove pdf page')).toBe('pdf-delete');
    expect(top('diagram')).toBe('mermaid');
  });
  it('tolerates typos', () => {
    expect(top('jsno formater')).toBe('json-formatter');
    expect(top('mermiad')).toBe('mermaid');
  });
  it('matches format conversions', () => {
    const ids = search('jpg to webp').map((r) => r.item.id);
    expect(ids).toContain('image-convert');
  });
  it('requires all words for short queries', () => {
    expect(search('pdf uuid')).toEqual([]);
  });
});
