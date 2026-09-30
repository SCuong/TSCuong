import { describe, expect, it } from 'vitest';
import {
  clampScale,
  describeMermaidError,
  diagramFileName,
  fitTransform,
  MAX_SCALE,
  MIN_SCALE,
  standaloneSvg,
  svgSize,
  uniqueName,
  zoomAt,
  sizedSvg,
} from './diagrams';
import { patchRecord } from './store';
import { collection } from '@/lib/storage/db';

async function parseError(source: string): Promise<unknown> {
  const mermaid = (await import('mermaid')).default;
  mermaid.initialize({ startOnLoad: false, securityLevel: 'strict' });
  try {
    await mermaid.parse(source);
  } catch (error) {
    return error;
  }
  throw new Error('expected a parse error');
}

describe('describeMermaidError', () => {
  it('reads the line from a Jison error (flowchart)', async () => {
    const source = 'flowchart TD\n  A --> B\n  B --> ';
    const err = describeMermaidError(await parseError(source), source);
    expect(err.line).toBe(3);
    expect(err.sourceLine).toBe('  B --> ');
    expect(err.message).toMatch(/ends unexpectedly|Unexpected/);
  }, 30_000);

  it('reads the line from a Langium error (pie)', async () => {
    const source = 'pie title Pets\n  "Dogs" 3';
    const err = describeMermaidError(await parseError(source), source);
    expect(err.line).toBe(2);
    expect(err.message).toMatch(/Expecting token/);
  }, 30_000);

  it('explains a missing diagram type', async () => {
    const source = 'hello there';
    const err = describeMermaidError(await parseError(source), source);
    expect(err.line).toBe(1);
    expect(err.message).toMatch(/No diagram type/);
  }, 30_000);

  it('handles plain strings, unknown values and out-of-range lines', () => {
    expect(describeMermaidError('boom', 'x').message).toBe('Boom.');
    expect(describeMermaidError(null, 'x').message).toMatch(/could not parse/);
    const e = Object.assign(new Error('Parse error on line 99:\nfoo'), {});
    expect(describeMermaidError(e, 'a\nb').line).toBe(2);
  });
});

describe('svg helpers', () => {
  const svg = '<svg id="m" width="100%" style="max-width: 320px;" viewBox="0 0 320.5 200" xmlns="http://www.w3.org/2000/svg"><g/></svg>';

  it('measures from the viewBox', () => {
    expect(svgSize(svg)).toEqual({ width: 320.5, height: 200 });
    expect(svgSize('<svg width="40" height="30"></svg>')).toEqual({ width: 40, height: 30 });
    expect(svgSize('<svg></svg>')).toBeNull();
    expect(svgSize('<svg viewBox="0 0 0 0"></svg>')).toBeNull();
  });

  it('makes a standalone SVG with explicit size', () => {
    const out = standaloneSvg(svg, '#fff');
    expect(out.startsWith('<?xml')).toBe(true);
    expect(out).toContain('width="321" height="200"');
    expect(out).not.toContain('100%');
    expect(out).not.toContain('max-width');
    expect(out).toContain('background-color: #fff');
    expect(out.match(/xmlns=/g)).toHaveLength(1);
    expect(standaloneSvg('<svg viewBox="0 0 10 10"></svg>')).toContain('xmlns="http://www.w3.org/2000/svg"');
  });
});

describe('names', () => {
  it('builds safe file names', () => {
    expect(diagramFileName('Login / flow: v2?')).toBe('Login flow v2');
    expect(diagramFileName('   ')).toBe('diagram');
    expect(diagramFileName('Ünïcödé 🚀 map')).toBe('Ünïcödé 🚀 map');
    expect(diagramFileName('x'.repeat(200))).toHaveLength(80);
    expect(diagramFileName('name...')).toBe('name');
  });
  it('creates unique names case-insensitively', () => {
    expect(uniqueName('Untitled', [])).toBe('Untitled');
    expect(uniqueName('Untitled', ['untitled', 'Untitled 2'])).toBe('Untitled 3');
  });
});

describe('view transform math', () => {
  it('clamps scale', () => {
    expect(clampScale(0)).toBe(MIN_SCALE);
    expect(clampScale(100)).toBe(MAX_SCALE);
    expect(clampScale(1.5)).toBe(1.5);
  });
  it('zooms around a fixed point', () => {
    const v = zoomAt({ scale: 1, x: 0, y: 0 }, 2, 100, 50);
    expect(v).toEqual({ scale: 2, x: -100, y: -50 });
    // The point under the cursor stays put: (100 - x) / scale is unchanged.
    expect((100 - v.x) / v.scale).toBe(100);
  });
  it('fits and centers without upscaling', () => {
    expect(fitTransform({ width: 100, height: 50 }, { width: 500, height: 300 })).toEqual({ scale: 1, x: 200, y: 125 });
    const big = fitTransform({ width: 2000, height: 1000 }, { width: 548, height: 348 }, 24);
    expect(big.scale).toBeCloseTo(0.25);
    expect(big.x).toBeCloseTo(24);
  });
});

describe('friendly parse errors', () => {
  it('names grammar tokens in plain words instead of internal token names', async () => {
    const source = 'flowchart TD\n  A --> B\n  B --> ((broken';
    const err = describeMermaidError(await parseError(source), source);
    expect(err.line).toBe(3);
    expect(err.message).not.toMatch(/\b(PS|TESTSTR|AMP|NODE_STRING)\b/);
    expect(err.message).toMatch(/^(Unexpected|The diagram ends)/);
  }, 30_000);

  it('maps a synthetic Jison message', () => {
    const error = Object.assign(new Error("Parse error on line 2:\n...\n---^\nExpecting 'SQE', 'PS', 'TAGEND', got 'NEWLINE'"), {
      hash: { loc: { first_line: 2 } },
    });
    const err = describeMermaidError(error, 'flowchart\nA[x\n');
    expect(err.message).toBe('Unexpected line break. Expected one of: "]", "(".');
  });
});

describe('sizedSvg', () => {
  it('sets explicit pixel size without an XML declaration', () => {
    const out = sizedSvg('<svg width="100%" style="max-width: 50px;" viewBox="0 0 50.5 20"><g/></svg>');
    expect(out.startsWith('<svg')).toBe(true);
    expect(out).toContain('width="51" height="20"');
    expect(out).not.toContain('max-width');
  });
});

describe('patchRecord', () => {
  it('merges patches in order and ignores missing records', async () => {
    const coll = collection<{ id: string; name: string; code: string; updatedAt: number }>('diagrams');
    await coll.put({ id: 'p1', name: 'A', code: 'x', updatedAt: 1 });
    const writes = [patchRecord(coll, 'p1', { code: 'y' }), patchRecord(coll, 'p1', { name: 'B' })];
    await Promise.all(writes);
    const saved = await coll.get('p1');
    expect(saved).toMatchObject({ id: 'p1', name: 'B', code: 'y' });
    expect(saved!.updatedAt).toBeGreaterThan(1);
    expect(await patchRecord(coll, 'missing', { name: 'x' })).toBeNull();
    await coll.remove('p1');
  });
});
