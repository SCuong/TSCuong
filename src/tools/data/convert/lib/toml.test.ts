import { describe, expect, it } from 'vitest';
import { countTomlComments, isTomlDateString, jsonToToml, tomlToJson } from './toml';

const T2J = { indent: '2' as const };

function json(r: ReturnType<typeof tomlToJson>) {
  if (!r.ok) throw new Error(r.error.message);
  return JSON.parse(r.value);
}

function toml(r: ReturnType<typeof jsonToToml>) {
  if (!r.ok) throw new Error(r.error.message);
  return r.value;
}

const SAMPLE = `# This is a TOML document
title = "TOML Example"

[owner]
name = "Tom Preston-Werner"
dob = 1979-05-27T07:32:00-08:00

[database]
enabled = true
ports = [ 8000, 8001, 8002 ]
data = [ ["delta", "phi"], [3.14] ]
temp_targets = { cpu = 79.5, case = 72.0 }

[servers.alpha]
ip = "10.0.0.1"
role = "frontend"

[[products]]
name = "Hammer"
sku = 738594937

[[products]]  # empty table within the array

[[products]]
name = "Nail"
sku = 284758393
color = "gray"
`;

describe('tomlToJson', () => {
  it('converts the TOML example document', () => {
    const r = tomlToJson(SAMPLE, T2J);
    expect(json(r)).toEqual({
      title: 'TOML Example',
      owner: { name: 'Tom Preston-Werner', dob: '1979-05-27T07:32:00-08:00' },
      database: { enabled: true, ports: [8000, 8001, 8002], data: [['delta', 'phi'], [3.14]], temp_targets: { cpu: 79.5, case: 72 } },
      servers: { alpha: { ip: '10.0.0.1', role: 'frontend' } },
      products: [{ name: 'Hammer', sku: 738594937 }, {}, { name: 'Nail', sku: 284758393, color: 'gray' }],
    });
    expect(r.ok && r.warnings).toEqual([
      '1 date or time was written as a string, because JSON has no date type.',
      '2 comments were dropped, because JSON has no comments.',
    ]);
  });

  it('writes every kind of date and time without spurious milliseconds', () => {
    const r = tomlToJson('odt = 1979-05-27T07:32:00Z\nodt2 = 1979-05-27 07:32:00.999+05:30\nldt = 1979-05-27T07:32:00\nld = 1979-05-27\nlt = 07:32:00\nlt2 = 00:32:00.5\n', T2J);
    expect(json(r)).toEqual({
      odt: '1979-05-27T07:32:00Z',
      odt2: '1979-05-27T07:32:00.999+05:30',
      ldt: '1979-05-27T07:32:00',
      ld: '1979-05-27',
      lt: '07:32:00',
      lt2: '00:32:00.500',
    });
  });

  it('keeps 64-bit integers exact', () => {
    const r = tomlToJson('big = 9223372036854775807\nneg = -9223372036854775808\nhex = 0xDEAD_BEEF\n', T2J);
    expect(r.ok && r.value).toBe('{\n  "big": 9223372036854775807,\n  "neg": -9223372036854775808,\n  "hex": 3735928559\n}');
  });

  it('writes inf and nan as strings with a warning', () => {
    const r = tomlToJson('a = inf\nb = -inf\nc = nan\n', T2J);
    expect(json(r)).toEqual({ a: 'Infinity', b: '-Infinity', c: 'NaN' });
    expect(r.ok && r.warnings[0]).toMatch(/3 infinite or NaN values/);
  });

  it('handles dotted keys, quoted keys and inline tables', () => {
    const r = tomlToJson('a.b.c = 1\n"key with space" = "x"\nsite."google.com" = true\npoint = { x = 1, y = { z = 2 } }\n', T2J);
    expect(json(r)).toEqual({ a: { b: { c: 1 } }, 'key with space': 'x', site: { 'google.com': true }, point: { x: 1, y: { z: 2 } } });
  });

  it('handles multi-line strings', () => {
    const r = tomlToJson('a = """\nRoses are red\n  # not a comment\nViolets are blue"""\nb = \'\'\'C:\\path\\\'\'\'\n', T2J);
    expect(json(r)).toEqual({ a: 'Roses are red\n  # not a comment\nViolets are blue', b: 'C:\\path\\' });
    expect(r.ok && r.warnings).toEqual([]);
  });

  it('reports errors with line and column', () => {
    const r = tomlToJson('a = 1\nb = [1, 2\nc = 3\n', T2J);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.line).toBeGreaterThanOrEqual(2);
      expect(r.error.message).not.toMatch(/Invalid TOML document/);
      expect(r.error.message.charAt(0)).toMatch(/[A-Z]/);
    }
  });

  it('rejects duplicate keys and tables', () => {
    const dup = tomlToJson('a = 1\na = 2\n', T2J);
    expect(dup.ok).toBe(false);
    if (!dup.ok) expect(dup.error).toMatchObject({ line: 2, column: 1 });
    expect(tomlToJson('[t]\nx = 1\n[t]\ny = 2\n', T2J).ok).toBe(false);
  });

  it('rejects invalid dates', () => {
    expect(tomlToJson('d = 1979-13-01\n', T2J).ok).toBe(false);
  });

  it('reports empty input', () => {
    expect(tomlToJson('  \n', T2J)).toEqual({ ok: false, error: { message: 'Input is empty', line: undefined, column: undefined } });
  });

  it('converts a comment-only document to an empty object', () => {
    const r = tomlToJson('# nothing\n', T2J);
    expect(r.ok && r.value).toBe('{}');
  });

  it('handles BOM, CRLF, Unicode and emoji', () => {
    expect(json(tomlToJson('\uFEFFname = "😀 café"\r\n"名前" = "x"\r\n', T2J))).toEqual({ name: '😀 café', 名前: 'x' });
  });

  it('keeps __proto__ as an ordinary key', () => {
    const r = tomlToJson('[__proto__]\npolluted = true\n', T2J);
    expect(r.ok && r.value).toContain('"__proto__"');
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('uses tabs', () => {
    expect(tomlToJson('[a]\nb = 1\n', { indent: 'tab' })).toMatchObject({ value: '{\n\t"a": {\n\t\t"b": 1\n\t}\n}' });
  });

  it('handles large documents', () => {
    const src = Array.from({ length: 3000 }, (_, i) => `[[item]]\nid = ${i}\nname = "item ${i}"\n`).join('\n');
    const out = json(tomlToJson(src, T2J));
    expect(out.item).toHaveLength(3000);
    expect(out.item[2999]).toEqual({ id: 2999, name: 'item 2999' });
  });
});

describe('jsonToToml', () => {
  it('writes tables, arrays of tables and inline values', () => {
    const r = jsonToToml('{"title":"x","owner":{"name":"Tom"},"ports":[8000,8001],"products":[{"name":"Hammer"},{"name":"Nail"}]}');
    expect(toml(r)).toBe('title = "x"\nports = [ 8000, 8001 ]\n\n[owner]\nname = "Tom"\n\n[[products]]\nname = "Hammer"\n\n[[products]]\nname = "Nail"\n');
  });

  it('turns date strings into TOML dates by default', () => {
    const r = jsonToToml('{"dob":"1979-05-27T07:32:00-08:00","day":"1979-05-27","at":"07:32:00","local":"1979-05-27T07:32:00.5","text":"1979-05-27 is a date","bad":"1979-02-30"}');
    expect(toml(r)).toBe(
      'dob = 1979-05-27T07:32:00-08:00\nday = 1979-05-27\nat = 07:32:00\nlocal = 1979-05-27T07:32:00.5\ntext = "1979-05-27 is a date"\nbad = "1979-02-30"\n',
    );
    expect(r.ok && r.warnings).toEqual(['4 strings that look like a date or time were written as TOML date/time values.']);
  });

  it('can keep date strings as strings', () => {
    expect(toml(jsonToToml('{"day":"1979-05-27"}', { detectDates: false }))).toBe('day = "1979-05-27"\n');
  });

  it('round-trips dates through TOML → JSON → TOML', () => {
    const src = 'odt = 1979-05-27T07:32:00-08:00\nld = 1979-05-27\nlt = 07:32:00\n';
    const j = tomlToJson(src, T2J);
    expect(j.ok).toBe(true);
    if (j.ok) expect(toml(jsonToToml(j.value))).toBe(src);
  });

  it('leaves out nulls with a warning, or writes empty strings', () => {
    const r = jsonToToml('{"a":null,"b":1,"list":[1,null,2],"t":{"c":null}}');
    expect(toml(r)).toBe('b = 1\nlist = [ 1, 2 ]\n\n[t]\n');
    expect(r.ok && r.warnings).toEqual(['3 null values were left out, because TOML has no null.']);
    const e = jsonToToml('{"a":null,"list":[null]}', { nulls: 'empty' });
    expect(toml(e)).toBe('a = ""\nlist = [ "" ]\n');
  });

  it('wraps a top-level array or scalar', () => {
    const arr = jsonToToml('[{"a":1},{"a":2}]');
    expect(toml(arr)).toBe('[[items]]\na = 1\n\n[[items]]\na = 2\n');
    expect(arr.ok && arr.warnings[0]).toMatch(/under the key "items"/);
    expect(toml(jsonToToml('42'))).toBe('value = 42\n');
  });

  it('quotes keys that are not bare', () => {
    expect(toml(jsonToToml('{"key with space":1,"ünï":2,"":3,"a.b":4}'))).toBe('"key with space" = 1\n"ünï" = 2\n"" = 3\n"a.b" = 4\n');
  });

  it('escapes strings', () => {
    expect(toml(jsonToToml('{"s":"quote \\" backslash \\\\ newline \\n tab \\t 😀"}'))).toBe('s = "quote \\" backslash \\\\ newline \\n tab \\t 😀"\n');
  });

  it('keeps 64-bit integers and turns larger ones into strings', () => {
    const r = jsonToToml('{"max":9223372036854775807,"huge":123456789012345678901234567890}');
    expect(toml(r)).toBe('max = 9223372036854775807\nhuge = "123456789012345678901234567890"\n');
    expect(r.ok && r.warnings).toEqual(['1 integer outside the 64-bit range was written as a string.']);
  });

  it('sorts keys when asked', () => {
    expect(toml(jsonToToml('{"b":1,"a":{"d":1,"c":2}}', { sortKeys: true }))).toBe('b = 1\n\n[a]\nc = 2\nd = 1\n');
  });

  it('writes empty objects, empty arrays and mixed arrays', () => {
    expect(toml(jsonToToml('{"e":{},"arr":[],"mixed":[1,"a",{"x":1}]}'))).toBe('arr = []\nmixed = [ 1, "a", { x = 1 } ]\n\n[e]\n');
  });

  it('keeps __proto__ keys', () => {
    expect(toml(jsonToToml('{"__proto__":{"a":1}}'))).toBe('[__proto__]\na = 1\n');
  });

  it('reports invalid JSON with a position', () => {
    const r = jsonToToml('{"a": }');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.line).toBe(1);
  });

  it('reports empty input', () => {
    expect(jsonToToml('').ok).toBe(false);
  });

  it('reports JSON that is nested too deeply', () => {
    const deep = '{"a":'.repeat(1200) + '1' + '}'.repeat(1200);
    const r = jsonToToml(deep);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.message).toMatch(/nested too deeply/);
  });

  it('round-trips a document through JSON', () => {
    const j = tomlToJson(SAMPLE, T2J);
    expect(j.ok).toBe(true);
    if (!j.ok) return;
    const back = jsonToToml(j.value);
    expect(back.ok).toBe(true);
    if (back.ok) expect(json(tomlToJson(back.value, T2J))).toEqual(JSON.parse(j.value));
  });
});

describe('helpers', () => {
  it('detects TOML date strings strictly', () => {
    for (const s of ['2024-02-29', '1979-05-27T07:32:00Z', '1979-05-27t07:32:00z', '1979-05-27 07:32:00.123456', '23:59:59', '1979-05-27T07:32:00+14:00']) {
      expect(isTomlDateString(s), s).toBe(true);
    }
    for (const s of ['2023-02-29', '2024-1-1', '24:00:00', '12:30', '1979-05-27T07:32', 'today', '1979-05-27T07:32:00+25:00', '']) {
      expect(isTomlDateString(s), s).toBe(false);
    }
  });

  it('counts comments outside strings', () => {
    expect(countTomlComments('# a\nx = "# no" # yes\ny = \'#no\'\nz = """\n# no\n"""\n')).toBe(2);
    expect(countTomlComments('x = 1')).toBe(0);
  });
});
