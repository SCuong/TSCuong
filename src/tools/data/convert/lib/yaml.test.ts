import { describe, expect, it } from 'vitest';
import { formatYaml, isYaml11Ambiguous, jsonToYaml, resolvePlainScalar, validateYaml, yamlToJson } from './yaml';

const Y2J = { indent: '2' as const };
const J2Y = { indent: '2' as const };

function value(r: ReturnType<typeof yamlToJson>) {
  if (!r.ok) throw new Error(r.error.message);
  return JSON.parse(r.value);
}

describe('yamlToJson', () => {
  it('converts a mapping', () => {
    expect(value(yamlToJson('a: 1\nb: [x, y]\nc:\n  d: true\n', Y2J))).toEqual({ a: 1, b: ['x', 'y'], c: { d: true } });
  });

  it('reports empty input', () => {
    const r = yamlToJson('  \n ', Y2J);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.message).toBe('Input is empty');
  });

  it('returns null with a warning for comment-only input', () => {
    const r = yamlToJson('# only a comment\n', Y2J);
    expect(r.ok && r.value).toBe('null');
    expect(r.ok && r.warnings.length).toBe(1);
  });

  it('combines multiple documents into an array with a warning', () => {
    const r = yamlToJson('a: 1\n---\nb: 2\n', Y2J);
    expect(value(r)).toEqual([{ a: 1 }, { b: 2 }]);
    expect(r.ok && r.warnings[0]).toMatch(/2 YAML documents/);
  });

  it('reports syntax errors with a line', () => {
    const r = yamlToJson('a: 1\nb: [1, 2\nc: 3\n', Y2J);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.line).toBeGreaterThanOrEqual(2);
  });

  it('rejects duplicate keys', () => {
    const r = yamlToJson('a: 1\na: 2\n', Y2J);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.message).toMatch(/unique|duplicate/i);
      expect(r.error.line).toBe(2);
    }
  });

  it('handles BOM and CRLF', () => {
    expect(value(yamlToJson('\uFEFFa: 1\r\nb: two\r\n', Y2J))).toEqual({ a: 1, b: 'two' });
  });

  it('keeps big integers exact', () => {
    const r = yamlToJson('n: 12345678901234567890\n', Y2J);
    expect(r.ok && r.value).toContain('12345678901234567890');
  });

  it('YAML 1.2 keeps yes/no as strings, YAML 1.1 makes booleans', () => {
    expect(value(yamlToJson('a: yes\n', Y2J))).toEqual({ a: 'yes' });
    expect(value(yamlToJson('a: yes\n', { indent: '2', yaml11: true }))).toEqual({ a: true });
  });

  it('resolves anchors and aliases', () => {
    expect(value(yamlToJson('base: &b {x: 1}\ncopy: *b\n', Y2J))).toEqual({ base: { x: 1 }, copy: { x: 1 } });
  });

  it('refuses alias bombs', () => {
    const lines = ['a: &a ["x","x","x","x","x","x","x","x","x"]'];
    for (let i = 1; i < 9; i++) {
      const prev = String.fromCharCode(96 + i);
      const cur = String.fromCharCode(97 + i);
      lines.push(`${cur}: &${cur} [${Array(9).fill(`*${prev}`).join(',')}]`);
    }
    const r = yamlToJson(lines.join('\n'), Y2J);
    expect(r.ok).toBe(false);
  });

  it('writes non-finite numbers as strings with a warning', () => {
    const r = yamlToJson('a: .inf\nb: .nan\n', Y2J);
    expect(value(r)).toEqual({ a: 'Infinity', b: 'NaN' });
    expect(r.ok && r.warnings.some((w) => /NaN/.test(w))).toBe(true);
  });

  it('handles Unicode and emoji', () => {
    expect(value(yamlToJson('名前: "😀 café"\n', Y2J))).toEqual({ 名前: '😀 café' });
  });

  it('uses tab indentation when asked', () => {
    const r = yamlToJson('a:\n  b: 1\n', { indent: 'tab' });
    expect(r.ok && r.value).toBe('{\n\t"a": {\n\t\t"b": 1\n\t}\n}');
  });

  it('handles large input', () => {
    const yaml = Array.from({ length: 5000 }, (_, i) => `- id: ${i}\n  name: item ${i}`).join('\n');
    const out = value(yamlToJson(yaml, Y2J));
    expect(out).toHaveLength(5000);
    expect(out[4999]).toEqual({ id: 4999, name: 'item 4999' });
  });
});

describe('jsonToYaml', () => {
  it('converts objects', () => {
    const r = jsonToYaml('{"a":1,"b":["x",{"c":null}]}', J2Y);
    expect(r.ok && r.value).toBe('a: 1\nb:\n  - x\n  - c: null\n');
  });

  it('reports invalid JSON with position', () => {
    const r = jsonToYaml('{"a":1,}', J2Y);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.line).toBe(1);
  });

  it('reports empty input', () => {
    expect(jsonToYaml('', J2Y).ok).toBe(false);
  });

  it('quotes strings that YAML 1.1 would misread', () => {
    const r = jsonToYaml('{"country":"NO","v":"1.0","t":"true","s":"plain"}', J2Y);
    expect(r.ok && r.value).toBe('country: "NO"\nv: "1.0"\nt: "true"\ns: plain\n');
  });

  it('can skip quoting ambiguous strings (still valid YAML 1.2)', () => {
    const r = jsonToYaml('{"country":"NO"}', { indent: '2', quoteAmbiguous: false });
    expect(r.ok && r.value).toBe('country: NO\n');
  });

  it('sorts keys', () => {
    const r = jsonToYaml('{"b":1,"a":{"d":1,"c":2}}', { indent: '2', sortKeys: true });
    expect(r.ok && r.value).toBe('a:\n  c: 2\n  d: 1\nb: 1\n');
  });

  it('splits a top-level array into documents', () => {
    const r = jsonToYaml('[{"a":1},{"b":2}]', { indent: '2', splitDocuments: true });
    expect(r.ok && r.value).toBe('---\na: 1\n---\nb: 2\n');
  });

  it('warns when splitting a non-array', () => {
    const r = jsonToYaml('{"a":1}', { indent: '2', splitDocuments: true });
    expect(r.ok && r.warnings.length).toBe(1);
  });

  it('round-trips through YAML', () => {
    const data = { name: 'LocalKit 😀', n: 1.5, list: [1, 'two', null, true], nested: { 'key with space': 'v: x', empty: {} } };
    const y = jsonToYaml(JSON.stringify(data), J2Y);
    expect(y.ok).toBe(true);
    if (y.ok) expect(value(yamlToJson(y.value, Y2J))).toEqual(data);
  });

  it('uses 4-space indentation', () => {
    const r = jsonToYaml('{"a":{"b":1}}', { indent: '4' });
    expect(r.ok && r.value).toBe('a:\n    b: 1\n');
  });
});

describe('isYaml11Ambiguous', () => {
  it('detects YAML 1.1 special scalars', () => {
    for (const s of ['yes', 'No', 'on', 'OFF', '~', '0755', '1_000', '12:30', '2024-01-02', '.inf', '.NaN']) {
      expect(isYaml11Ambiguous(s)).toBe(true);
    }
    for (const s of ['hello', 'yess', 'v1.0', '']) expect(isYaml11Ambiguous(s)).toBe(false);
  });

  it('also detects YAML 1.2-only forms and exponents', () => {
    for (const s of ['0o17', '1e3', '+12', '0x1F', '<<', '=']) expect(isYaml11Ambiguous(s)).toBe(true);
  });
});

describe('yamlToJson: YAML 1.1 / 1.2 differences', () => {
  it('warns about the Norway problem and other version-dependent plain values', () => {
    const r = yamlToJson('country: NO\nmode: 0755\ntime: 12:30\nbig: 1_000\nname: plain\nquoted: "no"\n', Y2J);
    expect(value(r)).toEqual({ country: 'NO', mode: 755, time: '12:30', big: '1_000', name: 'plain', quoted: 'no' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const text = r.warnings.join('\n');
    expect(text).toMatch(/"NO" \(line 1\) is the string "NO" in YAML 1\.2, but the boolean false/);
    expect(text).toMatch(/"0755" \(line 2\) is the number 755 in YAML 1\.2, but the number 493/);
    expect(text).toMatch(/"12:30" \(line 3\)/);
    expect(text).toMatch(/"1_000" \(line 4\)/);
    expect(text).not.toMatch(/"no"/); // quoted values are unambiguous
    expect(text).not.toMatch(/plain/);
  });

  it('includes keys such as GitHub Actions "on:"', () => {
    const r = yamlToJson('on:\n  push: {}\n', Y2J);
    expect(value(r)).toEqual({ on: { push: {} } });
    expect(r.ok && r.warnings.some((w) => /"on" \(line 1\) is the string "on" in YAML 1\.2, but the boolean true/.test(w))).toBe(true);
  });

  it('describes the reverse difference when parsing as YAML 1.1', () => {
    const r = yamlToJson('a: yes\nb: 0o17\n', { indent: '2', yaml11: true });
    expect(value(r)).toEqual({ a: true, b: '0o17' });
    const text = r.ok ? r.warnings.join('\n') : '';
    expect(text).toMatch(/"yes" \(line 1\) is the boolean true in YAML 1\.1, but the string "yes" for YAML 1\.2 parsers/);
    expect(text).toMatch(/"0o17" \(line 2\) is the string "0o17" in YAML 1\.1, but the number 15/);
  });

  it('respects a %YAML 1.1 directive in the document', () => {
    const r = yamlToJson('%YAML 1.1\n---\na: off\n', Y2J);
    expect(value(r)).toEqual({ a: false });
  });

  it('does not warn for ordinary numbers and strings', () => {
    const r = yamlToJson('a: 1\nb: -2.5\nc: hello world\nd: true\ne: null\nf: 1.5e3\n', Y2J);
    expect(r.ok && r.warnings).toEqual([]);
  });

  it('limits the number of listed differences', () => {
    const yaml = Array.from({ length: 30 }, (_, i) => `k${i}: no`).join('\n');
    const r = yamlToJson(yaml, Y2J);
    expect(r.ok && r.warnings.length).toBe(6);
    expect(r.ok && r.warnings[5]).toMatch(/and 25 more values/);
  });
});

describe('yamlToJson: comments, merge keys, tags and documents', () => {
  it('warns that comments are dropped', () => {
    const r = yamlToJson('# header\na: 1 # trailing\nb: "x # not a comment"\nc: |\n  # inside a block scalar\n', Y2J);
    expect(value(r)).toEqual({ a: 1, b: 'x # not a comment', c: '# inside a block scalar\n' });
    expect(r.ok && r.warnings).toContain('2 comments were dropped, because JSON has no comments.');
  });

  it('applies << merge keys', () => {
    const r = yamlToJson('base: &b {x: 1, y: 2}\nchild:\n  <<: *b\n  y: 3\n', Y2J);
    expect(value(r)).toEqual({ base: { x: 1, y: 2 }, child: { x: 1, y: 3 } });
  });

  it('keeps __proto__ as an ordinary key', () => {
    const r = yamlToJson('__proto__:\n  polluted: true\nsafe: 1\n', Y2J);
    expect(r.ok && r.value).toContain('"__proto__"');
    expect(value(r)).toEqual(JSON.parse('{"__proto__":{"polluted":true},"safe":1}'));
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('resolves CloudFormation short tags', () => {
    const yaml = [
      'Resources:',
      '  Bucket:',
      '    Properties:',
      '      Name: !Sub "${AWS::StackName}-data"',
      '      Arn: !GetAtt Role.Arn.Value',
      '      Ref: !Ref Env',
      '      Joined: !Join [",", [a, b]]',
      '      Pick: !Select [0, !GetAZs ""]',
      '      Cond: !If [IsProd, !Ref A, !Ref "AWS::NoValue"]',
      '      Map: !FindInMap { a: b }',
    ].join('\n');
    const r = yamlToJson(yaml, Y2J);
    expect(r.ok && r.warnings).toEqual([]);
    expect(value(r).Resources.Bucket.Properties).toEqual({
      Name: { 'Fn::Sub': '${AWS::StackName}-data' },
      Arn: { 'Fn::GetAtt': ['Role', 'Arn.Value'] },
      Ref: { Ref: 'Env' },
      Joined: { 'Fn::Join': [',', ['a', 'b']] },
      Pick: { 'Fn::Select': [0, { 'Fn::GetAZs': '' }] },
      Cond: { 'Fn::If': ['IsProd', { Ref: 'A' }, { Ref: 'AWS::NoValue' }] },
      Map: { 'Fn::FindInMap': { a: 'b' } },
    });
  });

  it('leaves CloudFormation tags unresolved (with a warning) when disabled', () => {
    const r = yamlToJson('a: !Ref Env\n', { indent: '2', cloudFormation: false });
    expect(value(r)).toEqual({ a: 'Env' });
    expect(r.ok && r.warnings[0]).toMatch(/Unresolved tag: !Ref \(line 1\)/);
  });

  it('can keep only the first document', () => {
    const r = yamlToJson('a: 1\n---\nb: 2\n---\nc: 3\n', { indent: '2', multiDoc: 'first' });
    expect(value(r)).toEqual({ a: 1 });
    expect(r.ok && r.warnings[0]).toBe('Only the first of 3 YAML documents was converted.');
  });

  it('can write JSON Lines', () => {
    const r = yamlToJson('a: 1\nlist: [1, 2]\n---\nb: "x y"\n', { indent: '4', multiDoc: 'lines' });
    expect(r.ok && r.value).toBe('{"a":1,"list":[1,2]}\n{"b":"x y"}\n');
  });

  it('turns empty documents into null', () => {
    expect(value(yamlToJson('---\n---\na: 1\n', Y2J))).toEqual([null, { a: 1 }]);
  });

  it('reports tabs used as indentation with a position', () => {
    const r = yamlToJson('a:\n\tb: 1\n', Y2J);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.message).toMatch(/Tabs are not allowed/);
      expect(r.error.line).toBe(2);
      expect(r.error.column).toBe(1);
    }
  });

  it('converts binary and sets to JSON types', () => {
    const r = yamlToJson('bin: !!binary aGk=\nset: !!set {a, b}\n', { indent: '2', yaml11: true });
    expect(value(r)).toEqual({ bin: 'aGk=', set: ['a', 'b'] });
  });
});

describe('jsonToYaml: more options', () => {
  it('keeps integers beyond 2^53 exact', () => {
    const r = jsonToYaml('{"id": 123456789012345678901234567890, "num": 1.5, "neg": -98765432109876543210}', J2Y);
    expect(r.ok && r.value).toBe('id: 123456789012345678901234567890\nnum: 1.5\nneg: -98765432109876543210\n');
  });

  it('quotes all string values when asked, but not keys', () => {
    const r = jsonToYaml('{"name":"x","count":1,"list":["a"]}', { indent: '2', quoteAll: true });
    expect(r.ok && r.value).toBe('name: "x"\ncount: 1\nlist:\n  - "a"\n');
  });

  it('quotes single-letter keys that YAML 1.1 reads as booleans', () => {
    const r = jsonToYaml('{"n":1,"x":2}', J2Y);
    expect(r.ok && r.value).toBe('"n": 1\nx: 2\n');
  });

  it('can write sequences without extra indentation', () => {
    const r = jsonToYaml('{"list":["a","b"]}', { indent: '2', indentSeq: false });
    expect(r.ok && r.value).toBe('list:\n- a\n- b\n');
  });

  it('writes multi-line strings as block scalars', () => {
    const r = jsonToYaml('{"script":"echo 1\\necho 2\\n"}', J2Y);
    expect(r.ok && r.value).toBe('script: |\n  echo 1\n  echo 2\n');
  });

  it('keeps __proto__ keys', () => {
    const r = jsonToYaml('{"__proto__":{"a":1}}', J2Y);
    expect(r.ok && r.value).toBe('__proto__:\n  a: 1\n');
  });

  it('quotes ambiguous keys too', () => {
    const r = jsonToYaml('{"on":{"push":null},"y":1}', J2Y);
    expect(r.ok && r.value).toBe('"on":\n  push: null\n"y": 1\n');
  });

  it('handles emoji and scalars at the top level', () => {
    expect(jsonToYaml('"😀"', J2Y)).toEqual({ ok: true, value: '😀\n', warnings: [] });
    expect(jsonToYaml('null', J2Y)).toEqual({ ok: true, value: 'null\n', warnings: [] });
    expect(jsonToYaml('[]', J2Y)).toEqual({ ok: true, value: '[]\n', warnings: [] });
  });
});

describe('validateYaml', () => {
  it('reports syntax errors with positions', () => {
    const v = validateYaml('a: [1, 2\nb: 3\n', { version: '1.2' });
    expect(v.errors.length).toBeGreaterThan(0);
    expect(v.errors[0].line).toBeGreaterThan(0);
    expect(v.stats).toBeNull();
  });

  it('counts documents and structure', () => {
    const v = validateYaml('# c\nbase: &b {x: 1}\nlist:\n  - *b\n  - [1, 2]\n---\nsecond: yes\n', { version: '1.2' });
    expect(v.errors).toEqual([]);
    expect(v.documents).toBe(2);
    expect(v.stats).toMatchObject({ documents: 2, anchors: 1, aliases: 1, comments: 1, mappings: 3, sequences: 2 });
    expect(v.differences.total).toBe(1);
    expect(v.differences.items[0]).toMatchObject({ text: 'yes', line: 7, column: 9 });
  });

  it('reports duplicate keys as errors', () => {
    const v = validateYaml('a: 1\nb: 2\na: 3\n', { version: '1.2' });
    expect(v.errors[0]).toMatchObject({ line: 3, column: 1 });
    expect(v.errors[0].message).toMatch(/unique/);
  });

  it('flags alias bombs', () => {
    const lines = ['a: &a ["x","x","x","x","x","x","x","x","x"]'];
    for (let i = 1; i < 9; i++) {
      const prev = String.fromCharCode(96 + i);
      const cur = String.fromCharCode(97 + i);
      lines.push(`${cur}: &${cur} [${Array(9).fill(`*${prev}`).join(',')}]`);
    }
    const v = validateYaml(lines.join('\n'), { version: '1.2' });
    expect(v.errors.some((e) => /billion laughs/.test(e.message))).toBe(true);
  });

  it('treats an empty stream as zero documents', () => {
    const v = validateYaml('# nothing here\n', { version: '1.2' });
    expect(v).toMatchObject({ documents: 0, errors: [] });
  });
});

describe('formatYaml', () => {
  const F = { indent: '2' as const, version: '1.2' as const };

  it('re-indents while keeping comments, anchors and quoting', () => {
    const r = formatYaml('# top\nroot:\n    child: &x "quoted"   # note\n    list:\n    - a\n    - *x\n', F);
    expect(r.ok && r.value).toBe('# top\nroot:\n  child: &x "quoted" # note\n  list:\n    - a\n    - *x\n');
  });

  it('sorts keys recursively', () => {
    const r = formatYaml('b: 1\na:\n  z: 1\n  y: 2\n', { ...F, sortKeys: true });
    expect(r.ok && r.value).toBe('a:\n  y: 2\n  z: 1\nb: 1\n');
  });

  it('can switch flow collections to block style', () => {
    const r = formatYaml('a: {x: 1, y: [1, 2]}\n', { ...F, blockStyle: true });
    expect(r.ok && r.value).toBe('a:\n  x: 1\n  y:\n    - 1\n    - 2\n');
  });

  it('keeps flow style by default, without padding inside brackets', () => {
    const r = formatYaml('a: {x: 1}\nb: [ 1, 2 ]\n', F);
    expect(r.ok && r.value).toBe('a: {x: 1}\nb: [1, 2]\n');
  });

  it('keeps merge keys first when sorting', () => {
    const r = formatYaml('base: &b {x: 1}\njob:\n  name: a\n  <<: *b\n  after: 1\n', { ...F, sortKeys: true });
    expect(r.ok && r.value).toBe('base: &b {x: 1}\njob:\n  <<: *b\n  after: 1\n  name: a\n');
  });

  it('keeps multiple documents separated', () => {
    const r = formatYaml('a: 1\n---\nb:   2\n', F);
    expect(r.ok && r.value).toBe('a: 1\n---\nb: 2\n');
  });

  it('uses 4 spaces, and "- " counts as indentation for non-indented sequences', () => {
    expect(formatYaml('a:\n  b:\n    - 1\n', { ...F, indent: '4' })).toMatchObject({ value: 'a:\n    b:\n        - 1\n' });
    expect(formatYaml('a:\n  b:\n    - 1\n', { ...F, indent: '4', indentSeq: false })).toMatchObject({ value: 'a:\n    b:\n      - 1\n' });
    expect(formatYaml('a:\n  b:\n    - 1\n', { ...F, indentSeq: false })).toMatchObject({ value: 'a:\n  b:\n  - 1\n' });
  });

  it('keeps custom tags', () => {
    const r = formatYaml('a:   !Ref Env\nb: !!str 1\n', F);
    expect(r.ok && r.value).toBe('a: !Ref Env\nb: !!str "1"\n');
  });

  it('reports errors with positions', () => {
    const r = formatYaml('a:\n  b: 1\n c: 2\n', F);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toMatchObject({ line: 3, column: 1 });
      expect(r.error.message).toMatch(/same column/);
    }
  });

  it('is idempotent', () => {
    const once = formatYaml('x:\n      - a: 1\n        b: [1,2]\n', F);
    expect(once.ok).toBe(true);
    if (once.ok) expect(formatYaml(once.value, F)).toEqual(once);
  });
});

describe('resolvePlainScalar', () => {
  it('resolves plain scalars per version', () => {
    expect(resolvePlainScalar('off', '1.1')).toBe(false);
    expect(resolvePlainScalar('off', '1.2')).toBe('off');
    expect(resolvePlainScalar('0x1F', '1.2')).toBe(31n);
    expect(resolvePlainScalar('~', '1.2')).toBeNull();
    expect(resolvePlainScalar('2024-01-02', '1.1')).toBeInstanceOf(Date);
  });
});

describe('alias expansion guard (regressions)', () => {
  const wideBomb = (items: number, aliases: number) =>
    `a: &a [${Array(items).fill('x').join(',')}]\nb: [${Array(aliases).fill('*a').join(',')}]\n`;

  it('refuses a wide alias bomb that stays under the per-anchor use limit', () => {
    // 43 KB of YAML that would expand into ~80 MB of JSON.
    const started = Date.now();
    const r = yamlToJson(wideBomb(20_000, 999), Y2J);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.message).toMatch(/billion laughs/);
    expect(Date.now() - started).toBeLessThan(3000);
  });

  it('refuses a doubling chain and a large anchored string used many times', () => {
    let chain = `a0: &a0 [${Array(1000).fill('"x"').join(',')}]\n`;
    for (let i = 1; i <= 20; i++) chain += `a${i}: &a${i} [*a${i - 1}, *a${i - 1}]\n`;
    expect(yamlToJson(chain, Y2J).ok).toBe(false);
    const big = `s: &s "${'y'.repeat(1_000_000)}"\nl: [${Array(30).fill('*s').join(', ')}]\n`;
    expect(yamlToJson(big, Y2J).ok).toBe(false);
  });

  it('still expands ordinary anchors, merge keys and many references to one anchor', () => {
    const jobs = Array.from({ length: 1500 }, (_, i) => `job${i}:\n  <<: *defaults\n  id: ${i}`).join('\n');
    const r = yamlToJson(`defaults: &defaults\n  retries: 2\n  image: node\n${jobs}\n`, Y2J);
    const out = value(r);
    expect(out.job1499).toEqual({ retries: 2, image: 'node', id: 1499 });
    expect(value(yamlToJson(wideBomb(100, 50), Y2J)).b).toHaveLength(50);
  });

  it('explains recursive aliases instead of reporting deep nesting', () => {
    const r = yamlToJson('a: &a\n  b: 1\n  c: *a\n', Y2J);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.message).toMatch(/\*a refers to a node that contains it/);
      expect(r.error.line).toBe(3);
    }
    const v = validateYaml('x: &x [1, *x]\n', { version: '1.2' });
    expect(v.errors).toEqual([]);
    expect(v.warnings.some((w) => /recursive/.test(w.message))).toBe(true);
  });

  it('flags the wide bomb in the validator but accepts many merges', () => {
    expect(validateYaml(wideBomb(20_000, 999), { version: '1.2' }).errors.some((e) => /billion laughs/.test(e.message))).toBe(true);
    const merges = `d: &d {a: 1}\n${Array.from({ length: 1200 }, (_, i) => `k${i}: {<<: *d}`).join('\n')}\n`;
    expect(validateYaml(merges, { version: '1.2' }).errors).toEqual([]);
  });
});

describe('formatYaml: binary values (regression)', () => {
  it('formats !!binary without folding and without a bogus nesting error', () => {
    const src = 'z: !!binary aGVsbG8gd29ybGQgdGhpcyBpcyBhIGxvbmdlciBiaW5hcnkgdmFsdWU=\nw: 1\n';
    const r = formatYaml(src, { indent: '2', version: '1.2' });
    expect(r.ok && r.value).toBe(src);
    const folded = formatYaml(src, { indent: '2', version: '1.2', foldLines: true });
    expect(folded.ok).toBe(true);
  });
});
