import { describe, expect, it } from 'vitest';
import { minifyCss } from './cssMinify';
import { DEFAULT_JS_OPTIONS, JsMinifyError, minifyJs } from './jsMinify';

describe('minifyCss', () => {
  it('minifies with and without restructuring', async () => {
    const css = '.a { color: #ff0000; }\n.b { color: #ff0000; }\n/* note */\n/*! keep */';
    expect((await minifyCss(css, { restructure: true, keepLicense: true })).css).toBe('.a,.b{color:red}\n/*! keep */');
    expect((await minifyCss(css, { restructure: false, keepLicense: false })).css).toBe('.a{color:red}.b{color:red}');
  });

  it('reports syntax problems with positions', async () => {
    const r = await minifyCss('a { color: red; }\nb { color: ; }\n.c {', { restructure: false, keepLicense: false });
    expect(r.issues.length).toBeGreaterThan(0);
    expect(r.issues[0].line).toBeGreaterThanOrEqual(2);
  });

  it('handles empty input and unicode', async () => {
    expect((await minifyCss('', { restructure: true, keepLicense: true })).css).toBe('');
    expect((await minifyCss('a::after { content: "→ 🎉"; }', { restructure: true, keepLicense: true })).css).toBe('a::after{content:"→ 🎉"}');
  });
});

describe('minifyJs', () => {
  const src = 'export function add(first, second) {\n  // comment\n  const total = first + second;\n  return total;\n}\n';

  it('compresses and mangles', async () => {
    expect(await minifyJs(src, DEFAULT_JS_OPTIONS)).toMatch(/^export function add\((\w),(\w)\)\{return \1\+\2\}$/);
  });

  it('respects toggles', async () => {
    const noMangle = await minifyJs(src, { ...DEFAULT_JS_OPTIONS, mangle: false });
    expect(noMangle).toContain('first');
    const noCompress = await minifyJs(src, { ...DEFAULT_JS_OPTIONS, compress: false, mangle: false });
    expect(noCompress).toContain('const total');
  });

  it('keeps license comments when asked', async () => {
    const code = '/*! MIT */\nvar a = 1;';
    expect(await minifyJs(code, { ...DEFAULT_JS_OPTIONS, module: false })).toContain('/*! MIT */');
    expect(await minifyJs(code, { ...DEFAULT_JS_OPTIONS, module: false, keepLicense: false })).not.toContain('MIT');
  });

  it('module mode mangles top-level names only in scripts', async () => {
    expect(await minifyJs('var longName = 1; console.log(longName);', { ...DEFAULT_JS_OPTIONS, module: false, compress: false })).toContain('longName');
    expect(await minifyJs('import x from "y"; console.log(x)', DEFAULT_JS_OPTIONS)).toContain('import');
  });

  it('reports errors with line and column', async () => {
    const err = await minifyJs('let a = 1;\nlet b = ;', DEFAULT_JS_OPTIONS).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(JsMinifyError);
    expect((err as JsMinifyError).line).toBe(2);
    expect((err as JsMinifyError).column).toBe(9);
    expect((err as JsMinifyError).message).toMatch(/^Line 2, column 9: /);
  });

  it('keeps unicode strings', async () => {
    expect(await minifyJs('console.log("héllo 🎉")', DEFAULT_JS_OPTIONS)).toBe('console.log("héllo 🎉");');
  });
});
