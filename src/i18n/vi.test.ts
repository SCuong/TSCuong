import { describe, expect, it } from 'vitest';
import vi from './vi';
import { TOOLS } from '@/tools/registry';
import { CATEGORIES } from '@/tools/categories';

/** Every source file that can call t(). */
const sources = import.meta.glob(['/src/**/*.{ts,tsx}', '!/src/**/*.test.{ts,tsx}', '!/src/i18n/**'], {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

/** Dictionary parts, to catch the same key translated differently in two files. */
const parts = import.meta.glob(['./vi/*.ts', '!./vi/index.ts'], { import: 'default', eager: true }) as Record<
  string,
  Record<string, string>
>;

const CALL = /(?<![\w.$])t\(\s*(?:'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)")/g;
const TEMPLATE_CALL = /(?<![\w.$])t\(\s*`/;

function unescape(body: string): string {
  return body.replace(/\\(u\{[0-9a-fA-F]+\}|u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|[\s\S])/g, (_, esc: string) => {
    if (esc[0] === 'u' && esc.length > 1) return String.fromCodePoint(parseInt(esc.replace(/[u{}]/g, ''), 16));
    if (esc[0] === 'x' && esc.length > 1) return String.fromCharCode(parseInt(esc.slice(1), 16));
    return ({ n: '\n', t: '\t', r: '\r' } as Record<string, string>)[esc] ?? esc;
  });
}

/** Only files that import the translation function (some modules have their own `t` helper). */
const IMPORTS_T = /import\s*\{[^}]*\bt\b[^}]*\}\s*from\s*'(?:@\/lib\/i18n|\.\/i18n)'/;

function keysInSource(): Map<string, string> {
  const keys = new Map<string, string>();
  for (const [file, text] of Object.entries(sources)) {
    if (!IMPORTS_T.test(text)) continue;
    for (const match of text.matchAll(CALL)) {
      const key = unescape(match[1] ?? match[2]);
      if (!keys.has(key)) keys.set(key, file);
    }
  }
  return keys;
}

const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe('Vietnamese dictionary', () => {
  it('translates every string passed to t()', () => {
    const missing = [...keysInSource()].filter(([key]) => !Object.hasOwn(vi, key)).map(([key, file]) => `${file}: ${key}`);
    expect(missing).toEqual([]);
  });

  it('translates every tool and category name and description', () => {
    const texts = [
      ...TOOLS.flatMap((tool) => [tool.name, tool.description, ...(tool.networkNote ? [tool.networkNote] : [])]),
      ...CATEGORIES.flatMap((category) => [category.name, category.description]),
    ];
    expect(texts.filter((text) => !Object.hasOwn(vi, text))).toEqual([]);
  });

  it('keeps the placeholders of each English text', () => {
    const wrong = Object.entries(vi)
      .filter(([en, text]) => placeholders(en).join() !== placeholders(text).join())
      .map(([en]) => en);
    expect(wrong).toEqual([]);
  });

  it('has no empty translations and no conflicting duplicates', () => {
    expect(Object.entries(vi).filter(([, text]) => !text.trim())).toEqual([]);
    const seen = new Map<string, string>();
    const conflicts: string[] = [];
    for (const dictionary of Object.values(parts)) {
      for (const [en, text] of Object.entries(dictionary)) {
        if (seen.has(en) && seen.get(en) !== text) conflicts.push(en);
        seen.set(en, text);
      }
    }
    expect(conflicts).toEqual([]);
  });

  it('is called with literal text, never template literals', () => {
    const offenders = Object.entries(sources)
      .filter(([, text]) => IMPORTS_T.test(text) && TEMPLATE_CALL.test(text))
      .map(([file]) => file);
    expect(offenders).toEqual([]);
  });
});
