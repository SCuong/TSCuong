import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CATEGORIES } from '../categories';
import { getToolByRoute, TOOLS } from './index';

const REGISTRY_DIR = resolve(__dirname);
const TOOLS_DIR = resolve(__dirname, '..');

function duplicates(values: string[]): string[] {
  const seen = new Set<string>();
  const dupes = new Set<string>();
  for (const v of values) (seen.has(v) ? dupes : seen).add(v);
  return [...dupes];
}

describe('tool registry', () => {
  it('has unique, stable-looking ids', () => {
    expect(duplicates(TOOLS.map((t) => t.id))).toEqual([]);
    expect(TOOLS.filter((t) => !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(t.id)).map((t) => t.id)).toEqual([]);
  });

  it('has unique names, so search and navigation are unambiguous', () => {
    expect(duplicates(TOOLS.map((t) => t.name.toLowerCase()))).toEqual([]);
  });

  it('has unique, well-formed routes', () => {
    expect(duplicates(TOOLS.map((t) => t.route))).toEqual([]);
    expect(TOOLS.filter((t) => !/^[a-z0-9-]+(?:\/[a-z0-9-]+)*$/.test(t.route)).map((t) => t.route)).toEqual([]);
  });

  it('keeps redirect aliases unique and never shadowing a real route', () => {
    const routes = new Set(TOOLS.map((t) => t.route));
    const redirects = TOOLS.flatMap((t) => t.redirectFrom ?? []);
    expect(redirects.filter((r) => routes.has(r))).toEqual([]);
    expect(duplicates(redirects)).toEqual([]);
    for (const tool of TOOLS) {
      for (const from of tool.redirectFrom ?? []) expect(getToolByRoute(from)?.id).toBe(tool.id);
      expect(getToolByRoute(tool.route)?.id).toBe(tool.id);
    }
  });

  it('only uses known categories, and every category has tools', () => {
    const known = new Set(CATEGORIES.map((c) => c.id));
    expect(TOOLS.filter((t) => !known.has(t.category)).map((t) => t.id)).toEqual([]);
    const used = new Set(TOOLS.map((t) => t.category));
    expect(CATEGORIES.filter((c) => !used.has(c.id)).map((c) => c.id)).toEqual([]);
  });

  it('has searchable metadata for every tool', () => {
    for (const tool of TOOLS) {
      expect(tool.name.trim(), tool.id).not.toBe('');
      expect(tool.description.trim().length, tool.id).toBeGreaterThan(20);
      expect(tool.description.trim().length, `${tool.id} description is too long for cards`).toBeLessThanOrEqual(180);
      expect(tool.keywords.length, `${tool.id} needs keywords`).toBeGreaterThan(2);
      expect(tool.icon, tool.id).toBeTruthy();
      if (tool.priority !== undefined) expect(tool.priority, tool.id).toBeGreaterThanOrEqual(1);
    }
  });

  it('lazy-loads every tool from an existing module with a default export', () => {
    // Static check of the registry source: importing every tool module here would pull in heavy engines.
    const problems: string[] = [];
    let count = 0;
    for (const file of readdirSync(REGISTRY_DIR).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts') && f !== 'index.ts')) {
      const source = readFileSync(join(REGISTRY_DIR, file), 'utf8');
      for (const match of source.matchAll(/load:\s*\(\)\s*=>\s*import\('\.\.\/([^']+)'\)/g)) {
        count++;
        const base = join(TOOLS_DIR, match[1]!);
        const path = ['.tsx', '.ts'].map((ext) => base + ext).find((p) => existsSync(p));
        if (!path) problems.push(`${file}: missing module ${match[1]}`);
        else if (!/export default\s+(?:function|class|memo|\w)/.test(readFileSync(path, 'utf8')))
          problems.push(`${file}: ${match[1]} has no default export`);
      }
    }
    expect(problems).toEqual([]);
    expect(count).toBe(TOOLS.length);
  });

  it('keeps heavy engines out of registry files (they are in the main bundle)', () => {
    const heavy = /from '(?:pdf-lib|pdfjs-dist|tesseract\.js|sql\.js|mermaid|xlsx|prettier|terser|svgo|zxing-wasm|@jsquash\/[^']+|@zxcvbn-ts\/[^']+|@peculiar\/x509|mime-db|jose|sql-formatter|yaml|fast-xml-parser|smol-toml)'/;
    const offenders = readdirSync(REGISTRY_DIR)
      .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
      .filter((f) => heavy.test(readFileSync(join(REGISTRY_DIR, f), 'utf8')));
    expect(offenders).toEqual([]);
  });
});
