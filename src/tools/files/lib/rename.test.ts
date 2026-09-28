import { describe, expect, it } from 'vitest';
import {
  applyCase,
  computeNames,
  DEFAULT_OPTIONS,
  expandPattern,
  findError,
  findProblems,
  formatDate,
  sortFiles,
  splitName,
  type RenameFile,
} from './rename';
import { uniquePaths } from './zipBuild';

const ts = new Date(2024, 4, 7, 9, 5, 3).getTime();
const f = (name: string, extra: Partial<RenameFile> = {}): RenameFile => ({
  name,
  size: 1000,
  lastModified: ts,
  ...extra,
});

describe('splitName', () => {
  it('splits base and extension', () => {
    expect(splitName('photo.final.JPG')).toEqual({
      base: 'photo.final',
      ext: 'JPG',
    });
    expect(splitName('.bashrc')).toEqual({ base: '.bashrc', ext: '' });
    expect(splitName('README')).toEqual({ base: 'README', ext: '' });
    expect(splitName('trailing.')).toEqual({ base: 'trailing.', ext: '' });
  });
});

describe('expandPattern', () => {
  it('replaces tokens including padded counters and dates', () => {
    expect(expandPattern('{name}-{n:3}', f('IMG_1.jpg'), 7)).toBe('IMG_1-007');
    expect(expandPattern('{n}', f('a'), 12)).toBe('12');
    expect(expandPattern('{n:2}', f('a'), -3)).toBe('-03');
    expect(expandPattern('{date}_{name}', f('a.txt'), 1)).toBe('2024-05-07_a');
    expect(expandPattern('{date:YYYYMMDD-HHmmss}', f('a'), 1)).toBe('20240507-090503');
    expect(expandPattern('{size}b {ext} {original}', f('x.png', { size: 42 }), 1)).toBe('42b png x.png');
    expect(expandPattern('{parent}-{name}', f('a.txt', { path: 'Trip/Day 1/a.txt' }), 1)).toBe('Day 1-a');
    expect(expandPattern('{unknown} {name', f('a'), 1)).toBe('{unknown} {name');
  });
  it('formatDate supports tokens', () => {
    expect(formatDate(ts, 'YY/MM/DD')).toBe('24/05/07');
    expect(formatDate(NaN)).toBe('');
  });
});

describe('applyCase', () => {
  it('converts cases', () => {
    expect(applyCase('Hello World file', 'lower')).toBe('hello world file');
    expect(applyCase('hello world', 'upper')).toBe('HELLO WORLD');
    expect(applyCase('hello wORLD-élan', 'title')).toBe('Hello World-Élan');
    expect(applyCase('My file_name-v2', 'camel')).toBe('myFileNameV2');
    expect(applyCase('My File Name', 'kebab')).toBe('my-file-name');
    expect(applyCase('myFileName v2', 'snake')).toBe('my_file_name_v2');
    expect(applyCase('😀 party time', 'title')).toBe('😀 Party Time');
  });
});

describe('computeNames', () => {
  const files = [f('IMG_0001.JPG'), f('IMG_0002.JPG'), f('notes.txt')];
  it('default options keep names', () => {
    expect(computeNames(files, DEFAULT_OPTIONS)).toEqual(['IMG_0001.JPG', 'IMG_0002.JPG', 'notes.txt']);
  });
  it('pattern + counter + extension lowercasing', () => {
    expect(
      computeNames(files, {
        ...DEFAULT_OPTIONS,
        pattern: 'Holiday {n:2}',
        extMode: 'lower',
        start: 5,
        step: 5,
      }),
    ).toEqual(['Holiday 05.jpg', 'Holiday 10.jpg', 'Holiday 15.txt']);
  });
  it('plain find/replace is literal and case-insensitive by default', () => {
    expect(
      computeNames([f('a.b.c (1).txt')], {
        ...DEFAULT_OPTIONS,
        find: '.',
        replace: '_',
      }),
    ).toEqual(['a_b_c (1).txt']);
    expect(
      computeNames([f('IMG img.txt')], {
        ...DEFAULT_OPTIONS,
        find: 'img',
        replace: 'pic',
        replaceAll: false,
      }),
    ).toEqual(['pic img.txt']);
    expect(
      computeNames([f('IMG img.txt')], {
        ...DEFAULT_OPTIONS,
        find: 'img',
        replace: 'pic',
        matchCase: true,
      }),
    ).toEqual(['IMG pic.txt']);
    expect(
      computeNames([f('a.txt')], {
        ...DEFAULT_OPTIONS,
        find: 'a',
        replace: '$&$&',
      }),
    ).toEqual(['$&$&.txt']);
  });
  it('regex find/replace with groups', () => {
    expect(
      computeNames([f('2024-05-07 report.pdf')], {
        ...DEFAULT_OPTIONS,
        find: '(\\d{4})-(\\d{2})-(\\d{2})',
        replace: '$3.$2.$1',
        regex: true,
      }),
    ).toEqual(['07.05.2024 report.pdf']);
  });
  it('invalid regex throws a readable error', () => {
    expect(findError({ find: '(', regex: true, matchCase: false })).toMatch(/Invalid regular expression/);
    expect(() => computeNames(files, { ...DEFAULT_OPTIONS, find: '[', regex: true })).toThrow(/Invalid regular expression/);
    expect(findError({ find: '(', regex: false, matchCase: false })).toBeNull();
  });
  it('change/remove extensions and collapse spaces', () => {
    expect(
      computeNames([f('a  b .jpeg')], {
        ...DEFAULT_OPTIONS,
        extMode: 'change',
        newExt: '.jpg',
      }),
    ).toEqual(['a b.jpg']);
    expect(computeNames([f('a.jpeg')], { ...DEFAULT_OPTIONS, extMode: 'remove' })).toEqual(['a']);
  });
  it('handles Unicode and emoji names', () => {
    expect(
      computeNames([f('Café 😀.txt')], {
        ...DEFAULT_OPTIONS,
        caseMode: 'upper',
      }),
    ).toEqual(['CAFÉ 😀.txt']);
  });
});

describe('sortFiles', () => {
  const list = [
    f('b10.txt', { size: 3, lastModified: 3 }),
    f('b2.txt', { size: 1, lastModified: 2 }),
    f('A.txt', { size: 2, lastModified: 1 }),
  ];
  it('sorts naturally by name, date or size', () => {
    expect(sortFiles(list, 'name').map((x) => x.name)).toEqual(['A.txt', 'b2.txt', 'b10.txt']);
    expect(sortFiles(list, 'date').map((x) => x.name)).toEqual(['A.txt', 'b2.txt', 'b10.txt']);
    expect(sortFiles(list, 'size').map((x) => x.name)).toEqual(['b2.txt', 'A.txt', 'b10.txt']);
    expect(sortFiles(list, 'original')).toEqual(list);
  });
});

describe('findProblems', () => {
  it('detects duplicates (case-insensitive), invalid and reserved names', () => {
    const p = findProblems(['a.txt', 'A.TXT', 'b?.txt', 'CON.txt', 'x.', '', 'ok.txt', 'x'.repeat(256)]);
    expect(p[0]).toContain('duplicate');
    expect(p[1]).toContain('duplicate');
    expect(p[2]).toContain('invalid-chars');
    expect(p[3]).toContain('reserved');
    expect(p[4]).toContain('trailing');
    expect(p[5]).toContain('empty');
    expect(p[6]).toEqual([]);
    expect(p[7]).toContain('too-long');
  });
  it('case-sensitive mode', () => {
    expect(findProblems(['a.txt', 'A.txt'], false)).toEqual([[], []]);
  });
  it('an extension-only name is empty', () => {
    expect(findProblems(['.txt'])[0]).toEqual([]); // dotfile is a valid name
    expect(findProblems(['   .txt'])[0]).toContain('empty');
  });
});

describe('uniquePaths (zip)', () => {
  it('dedupes while keeping folders and strips traversal', () => {
    expect(uniquePaths(['a/b.txt', 'a/B.txt', '../x.txt', 'a\\c.txt', ''])).toEqual(['a/b.txt', 'a/B (2).txt', 'x.txt', 'a/c.txt', 'file']);
  });
});
