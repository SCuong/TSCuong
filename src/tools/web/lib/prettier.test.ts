import { describe, expect, it } from 'vitest';
import { DEFAULT_OPTIONS, describeFormatError, formatCode, formatErrorText } from './prettier';

const o = DEFAULT_OPTIONS;

describe('formatCode', () => {
  it('formats HTML with embedded CSS and JS', async () => {
    const out = await formatCode('<div><p>Hi <b>there</b></p><style>a{color:red}</style><script>let a=1</script></div>', 'html', o);
    expect(out).toContain('<p>Hi <b>there</b></p>');
    expect(out).toContain('color: red;');
    expect(out).toContain('let a = 1;');
  });

  it('formats Vue and Angular templates', async () => {
    expect(await formatCode('<template><div   v-if="a">x</div></template>', 'vue', o)).toContain('<div v-if="a">x</div>');
    expect(await formatCode('<p *ngIf="a">{{x|uppercase}}</p>', 'angular', o)).toContain('{{ x | uppercase }}');
  });

  it('formats CSS, SCSS and Less', async () => {
    expect(await formatCode('a{color:red;margin:0}', 'css', o)).toBe('a {\n  color: red;\n  margin: 0;\n}\n');
    expect(await formatCode('.a{&:hover{color:$x}}', 'scss', o)).toContain('&:hover {');
    expect(await formatCode('.a{.mixin();}', 'less', o)).toContain('.mixin();');
  });

  it('formats JS/JSX with options', async () => {
    expect(await formatCode('const a = "x"', 'babel', { ...o, singleQuote: true, semi: false })).toBe("const a = 'x'\n");
    expect(await formatCode('const el=<div a="1">{x}</div>', 'babel', o)).toContain('const el = <div a="1">{x}</div>;');
    expect(await formatCode('f(a,b)', 'babel', { ...o, useTabs: true, printWidth: 4 })).toContain('\ta,');
  });

  it('formats TypeScript, JSON, JSON5 and GraphQL', async () => {
    expect(await formatCode('let a:number=1', 'typescript', o)).toBe('let a: number = 1;\n');
    expect(await formatCode('{"a":[1,2]}', 'json', o)).toBe('{ "a": [1, 2] }\n');
    expect(await formatCode("{a:'x',}", 'json5', o)).toContain('a: "x"');
    expect(await formatCode('query{a{b}}', 'graphql', o)).toBe('query {\n  a {\n    b\n  }\n}\n');
  });

  it('keeps Unicode and emoji', async () => {
    expect(await formatCode('const s="héllo 🎉"', 'babel', o)).toBe('const s = "héllo 🎉";\n');
  });

  it('reports syntax errors with line and column', async () => {
    const error = await formatCode('const a = 1;\nconst b = ;', 'babel', o).catch((e: unknown) => e);
    const info = describeFormatError(error);
    expect(info.line).toBe(2);
    expect(info.column).toBeGreaterThan(0);
    expect(info.message).not.toMatch(/\(\d+:\d+\)/);
    expect(info.message.includes(String.fromCharCode(27))).toBe(false);
    expect(formatErrorText(info)).toMatch(/^Line 2, column \d+: /);
    expect(info.frame).toContain('|');
  });

  it('reports CSS errors', async () => {
    const error = await formatCode('a { color: red;\n\n b {', 'css', o).catch((e: unknown) => e);
    const info = describeFormatError(error);
    expect(info.line).not.toBeNull();
  });

  it('describes non-Error values', () => {
    expect(describeFormatError('boom')).toMatchObject({ message: 'Boom.', line: null });
  });
});
