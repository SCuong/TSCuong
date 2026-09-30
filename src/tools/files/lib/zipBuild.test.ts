import { describe, expect, it } from 'vitest';
import { buildZip, zipDate, zipLimitProblem, ZIP_MAX_ENTRIES } from './zipBuild';
import { readZipDirectory } from './zip';

const fakeFile = (name: string, size: number) => ({ path: name, file: { size, name, lastModified: 0 } as File });

describe('classic ZIP limits', () => {
  it('refuses what the writer would corrupt (it has no ZIP64)', () => {
    // Regression: sizes ≥ 4 GiB and more than 65,535 entries were written with truncated fields.
    expect(zipLimitProblem([fakeFile('ok.bin', 10)])).toBeNull();
    expect(zipLimitProblem([fakeFile('huge.iso', 2 ** 32)])).toMatch(/“huge.iso” is 4 GB or larger, which needs ZIP64/);
    const many = Array.from({ length: ZIP_MAX_ENTRIES }, (_, i) => fakeFile(`f${i}`, 1));
    expect(zipLimitProblem(many)).toBeNull();
    expect(zipLimitProblem(many, 1)).toMatch(/at most 65,535 entries/);
  });

  it('clamps timestamps to the DOS date range instead of failing', () => {
    // Regression: a file dated before 1980 made fflate throw "date not in range 1980-2099".
    expect(zipDate(new Date(1975, 5, 1).getTime()).getFullYear()).toBe(1980);
    expect(zipDate(new Date(2150, 0, 1).getTime()).getFullYear()).toBe(2099);
    expect(zipDate(new Date(2024, 4, 17).getTime()).getMonth()).toBe(4);
  });
});

describe('empty folders', () => {
  it('are stored as directory entries', async () => {
    const blob = await buildZip([], 6, () => {}, new AbortController().signal, ['photos/empty', 'photos']);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const dir = await readZipDirectory(bytes.length, async (s, e) => bytes.slice(s, e));
    expect(dir.entries.map((e) => [e.name, e.isDirectory])).toEqual([
      ['photos/empty/', true],
      ['photos/', true],
    ]);
  });
});
