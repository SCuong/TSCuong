import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import * as csso from 'csso';
import { compactCss, minifyCss, tokenizeCss, usesNesting, type Tokenize } from './cssMinify';
import { DEFAULT_JS_OPTIONS, JsMinifyError, detectModule, minifyJs } from './jsMinify';

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
    expect(r.engine).toBe('csso');
  });

  it('handles empty input and unicode', async () => {
    expect((await minifyCss('', { restructure: true, keepLicense: true })).css).toBe('');
    expect((await minifyCss('a::after { content: "→ 🎉"; }', { restructure: true, keepLicense: true })).css).toBe('a::after{content:"→ 🎉"}');
  });

  // Regression: CSSO cannot parse CSS nesting and silently dropped every nested rule.
  it('keeps nested rules (CSS nesting) by compacting instead of optimizing', async () => {
    const css = '.card {\n  color: red;\n  &:hover { color: blue; }\n  .title { font-weight: bold; }\n  @media (width > 600px) { color: green; }\n}\n.other { margin: 0px; }';
    const r = await minifyCss(css, { restructure: true, keepLicense: true });
    expect(r.engine).toBe('compact');
    expect(r.issues).toEqual([]);
    expect(r.css).toBe('.card{color:red;&:hover{color:blue}.title{font-weight:bold}@media (width>600px){color:green}}.other{margin:0px}');
  });

  it('still reports unclosed blocks in nested CSS', async () => {
    const r = await minifyCss('.a { &:hover { color: red; }', { restructure: true, keepLicense: true });
    expect(r.engine).toBe('compact');
    expect(r.issues).toHaveLength(1);
    expect(r.issues[0]).toMatchObject({ line: 1, column: 4 });
  });
});

describe('CSS nesting detection and compaction', () => {
  const tokenize = (csso.syntax as unknown as { tokenize: Tokenize }).tokenize;
  const tokens = (css: string) => tokenizeCss(css, tokenize);
  const compact = (css: string, keepLicense = false) => compactCss(tokens(css), keepLicense, tokenize);

  it('detects nesting only inside style rules', () => {
    expect(usesNesting(tokens('.a { &:hover { color: red } }'))).toBe(true);
    expect(usesNesting(tokens('.a { color: red; .b { color: blue } }'))).toBe(true);
    expect(usesNesting(tokens('.a { @media print { color: red } }'))).toBe(true);
    expect(usesNesting(tokens('@media print { .a { color: red } }'))).toBe(false);
    expect(usesNesting(tokens('@keyframes f { from { opacity: 0 } to { opacity: 1 } }'))).toBe(false);
    expect(usesNesting(tokens('@page :first { margin: 1in; @top-center { content: "x" } }'))).toBe(false);
    expect(usesNesting(tokens(':root { --json: { "a": 1 }; color: red }'))).toBe(false);
    expect(usesNesting(tokens('a { content: "{ .b { } }" }'))).toBe(false);
  });

  it('removes only insignificant whitespace', () => {
    expect(compact('.a  .b ,  .c > .d { margin : 0 auto ; }')).toBe('.a .b,.c>.d{margin :0 auto}');
    expect(compact('a { width: calc( 100% - ( 2 * 10px ) ) }')).toBe('a{width:calc(100% - (2 * 10px))}');
    expect(compact('@media screen and (min-width: 600px) { a { color: red !important } }')).toBe('@media screen and (min-width:600px){a{color:red!important}}');
    expect(compact('a :hover { x: y }')).toBe('a :hover{x:y}');
    expect(compact('a { font: 12px / 1.5 serif; grid-area: 1 / 2 }')).toBe('a{font:12px / 1.5 serif;grid-area:1 / 2}');
  });

  it('keeps strings, urls and custom property values intact', () => {
    expect(compact('p::before { content: "  a ; b  " }')).toBe('p::before{content:"  a ; b  "}');
    expect(compact('a { background: url( "a b.png" ) }')).toBe('a{background:url("a b.png")}');
    expect(compact('a { background: url(a.png) no-repeat }')).toBe('a{background:url(a.png) no-repeat}');
    expect(compact(':root { --x: { a; } }')).toBe(':root{--x:{a;}}');
  });

  it('drops comments without merging the tokens around them', () => {
    expect(compact('/* c */ .a/**/.b { margin: 1px/**/2px }')).toBe('.a.b{margin:1px/**/2px}');
    expect(compact('.a /* c */ .b { x: y }')).toBe('.a .b{x:y}');
    expect(compact('/*! MIT */ a { x: y } /* drop */', true)).toBe('/*! MIT */a{x:y}');
    expect(compact('/*! MIT */ a { x: y }', false)).toBe('a{x:y}');
  });
});

/** Runs a classic script in a fresh context and returns its globals and output (for equivalence checks). */
function run(code: string) {
  const logs: string[] = [];
  const sandbox: Record<string, unknown> = { console: { log: (...a: unknown[]) => logs.push(a.map(String).join(' ')) } };
  vm.runInNewContext(code, sandbox, { timeout: 2000 });
  return { logs, globals: Object.keys(sandbox).sort(), result: JSON.stringify(sandbox.result) };
}

describe('minifyJs', () => {
  const src = 'export function add(first, second) {\n  // comment\n  const total = first + second;\n  return total;\n}\n';

  it('compresses and mangles', async () => {
    const r = await minifyJs(src, DEFAULT_JS_OPTIONS);
    expect(r.code).toMatch(/^export function add\((\w),(\w)\)\{return \1\+\2\}$/);
    expect(r.module).toBe(true);
  });

  it('respects toggles', async () => {
    const noMangle = await minifyJs(src, { ...DEFAULT_JS_OPTIONS, mangle: false });
    expect(noMangle.code).toContain('first');
    const noCompress = await minifyJs(src, { ...DEFAULT_JS_OPTIONS, compress: false, mangle: false });
    expect(noCompress.code).toContain('const total');
  });

  it('keeps license comments when asked', async () => {
    const code = '/*! MIT */\nvar a = 1;';
    expect((await minifyJs(code, DEFAULT_JS_OPTIONS)).code).toContain('/*! MIT */');
    expect((await minifyJs(code, { ...DEFAULT_JS_OPTIONS, keepLicense: false })).code).not.toContain('MIT');
  });

  // Regression: the default treated every input as an ES module, so a classic script's unused global
  // functions were deleted (empty output) and the others renamed, breaking onclick="…" and other scripts.
  it('keeps the globals of a classic script by default', async () => {
    const script = "function greet(name) { return 'Hi ' + name; }\nvar counter = 0;\nfunction bump() { counter++; return counter; }\n";
    const r = await minifyJs(script, DEFAULT_JS_OPTIONS);
    expect(r.module).toBe(false);
    expect(r.code).toContain('function greet(');
    expect(r.code).toContain('function bump(');
    expect(run(r.code).globals).toEqual(run(script).globals);
    const used = `${script}result = [greet('a'), bump(), bump()];`;
    expect(run((await minifyJs(used, DEFAULT_JS_OPTIONS)).code)).toEqual(run(used));
  });

  it('auto-detects modules from import/export and top-level await', async () => {
    const { minify } = await import('terser');
    expect(await detectModule('import x from "y"; console.log(x)', minify)).toBe(true);
    expect(await detectModule('export const a = 1;', minify)).toBe(true);
    expect(await detectModule('const r = await fetch("/x"); console.log(r);', minify)).toBe(true);
    expect(await detectModule('import("./x.js").then((m) => m.y);', minify)).toBe(false);
    expect(await detectModule('var importantThing = 1; // export later', minify)).toBe(false);
    expect(await detectModule('let = ;', minify)).toBe(false);
  });

  it('lets the source type be forced', async () => {
    const code = 'function unused() { return 1; }\nvar longName = 1; console.log(longName);';
    const script = await minifyJs(code, { ...DEFAULT_JS_OPTIONS, sourceType: 'script', compress: false });
    expect(script.code).toContain('longName');
    expect(script.code).toContain('unused');
    const module = await minifyJs(code, { ...DEFAULT_JS_OPTIONS, sourceType: 'module' });
    expect(module.module).toBe(true);
    expect(module.code).not.toContain('unused');
    expect(module.code).not.toContain('longName');
  });

  it('produces code that behaves the same', async () => {
    const programs = [
      'var fns=[];for(let i=0;i<3;i++){fns.push(()=>i*2)}result=fns.map(f=>f());',
      'class A{#x=1;static s=2;get x(){return this.#x}inc(){this.#x++;return this}}result=[new A().inc().inc().x,A.s];',
      'var log=[];var o={get a(){log.push("a");return 1}};o.a;result=log;',
      'function f(){var secret=42;return eval("secret")}result=f();',
      'outer:for(var i=0;i<3;i++){for(var j=0;j<3;j++){if(j==1)continue outer;if(i==2)break outer;console.log(i,j)}}',
      'result=[0.1+0.2,1e21,-0,/a\\/b/g.source,"\\u2028".length,0x10,1_000_000,"</script>".length];',
    ];
    for (const code of programs) expect(run((await minifyJs(code, DEFAULT_JS_OPTIONS)).code)).toEqual(run(code));
  });

  it('reports errors with line and column', async () => {
    const err = await minifyJs('let a = 1;\nlet b = ;', DEFAULT_JS_OPTIONS).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(JsMinifyError);
    expect((err as JsMinifyError).line).toBe(2);
    expect((err as JsMinifyError).column).toBe(9);
    expect((err as JsMinifyError).message).toMatch(/^Line 2, column 9: /);
  });

  it('keeps unicode strings', async () => {
    expect((await minifyJs('console.log("héllo 🎉")', DEFAULT_JS_OPTIONS)).code).toBe('console.log("héllo 🎉");');
  });
});
