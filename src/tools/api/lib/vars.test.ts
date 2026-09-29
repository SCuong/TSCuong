import { describe, expect, it } from 'vitest';
import { buildScope, referencedNames, resolveVars, segments, variableStatus } from './vars';
import { kv } from './model';

const scope = (obj: Record<string, string>) => new Map(Object.entries(obj));
const noDynamic = null;

describe('resolveVars', () => {
  it('substitutes simple variables and ignores whitespace in braces', () => {
    const r = resolveVars('{{base}}/users/{{ id }}', scope({ base: 'https://api.test', id: '42' }), noDynamic);
    expect(r.text).toBe('https://api.test/users/42');
    expect(r.missing).toEqual([]);
  });

  it('resolves nested variables', () => {
    const s = scope({ host: 'example.com', base: 'https://{{host}}/v{{version}}', version: '2' });
    expect(resolveVars('{{base}}/items', s, noDynamic).text).toBe('https://example.com/v2/items');
  });

  it('reports missing variables and leaves them untouched', () => {
    const r = resolveVars('{{a}}-{{b}}-{{a}}', scope({}), noDynamic);
    expect(r.text).toBe('{{a}}-{{b}}-{{a}}');
    expect(r.missing).toEqual(['a', 'b']);
  });

  it('reports cycles instead of looping forever', () => {
    const r = resolveVars('{{a}}', scope({ a: '{{b}}', b: '{{a}}' }), noDynamic);
    expect(r.cyclic.length).toBeGreaterThan(0);
  });

  it('treats a self reference as a cycle', () => {
    expect(resolveVars('{{x}}', scope({ x: 'pre{{x}}' }), noDynamic).cyclic).toEqual(['x']);
  });

  it('escapes \\{{ to literal braces', () => {
    const r = resolveVars('\\{{name}} and {{name}}', scope({ name: 'v' }), noDynamic);
    expect(r.text).toBe('{{name}} and v');
    expect(r.missing).toEqual([]);
  });

  it('handles empty input and text without variables', () => {
    expect(resolveVars('', scope({}), noDynamic)).toEqual({ text: '', missing: [], cyclic: [] });
    expect(resolveVars('plain { text }', scope({}), noDynamic).text).toBe('plain { text }');
  });

  it('keeps Unicode and emoji intact', () => {
    expect(resolveVars('héllo {{who}} 👋', scope({ who: '世界 🌍' }), noDynamic).text).toBe('héllo 世界 🌍 👋');
  });

  it('supports dynamic variables unless the scope defines them', () => {
    const dyn = (n: string) => (n === '$timestamp' ? '123' : undefined);
    expect(resolveVars('{{$timestamp}}', scope({}), dyn).text).toBe('123');
    expect(resolveVars('{{$timestamp}}', scope({ $timestamp: 'mine' }), dyn).text).toBe('mine');
    expect(resolveVars('{{$unknown}}', scope({}), dyn).missing).toEqual(['$unknown']);
  });

  it('generates real dynamic values by default', () => {
    const r = resolveVars('{{$guid}}', scope({}));
    expect(r.text).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('handles very long input', () => {
    const text = '{{v}}'.repeat(20_000);
    expect(resolveVars(text, scope({ v: 'x' }), noDynamic).text).toBe('x'.repeat(20_000));
  });
});

describe('buildScope', () => {
  it('lets later layers override earlier ones and skips disabled and blank rows', () => {
    const s = buildScope([kv('a', '1'), kv('b', '2')], [kv('a', 'override'), kv('c', '3', false), kv('  ', 'x')]);
    expect(Object.fromEntries(s)).toEqual({ a: 'override', b: '2' });
  });
});

describe('segments and names', () => {
  it('splits text, variables and escapes', () => {
    expect(segments('a{{b}}\\{{c}}')).toEqual([
      { type: 'text', text: 'a' },
      { type: 'var', text: '{{b}}', name: 'b' },
      { type: 'escaped', text: '\\{{' },
      { type: 'text', text: 'c}}' },
    ]);
    expect(referencedNames('{{a}}{{b}}{{a}}')).toEqual(['a', 'b']);
  });

  it('classifies variable status', () => {
    const s = scope({ a: '1' });
    expect(variableStatus('a', s)).toBe('resolved');
    expect(variableStatus('$guid', s)).toBe('dynamic');
    expect(variableStatus('zzz', s)).toBe('missing');
  });
});
