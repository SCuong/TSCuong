import { describe, expect, it } from 'vitest';
import {
  FIELD_TYPES,
  SeededRandom,
  csvCell,
  cyrb128,
  defaultOptions,
  formatRows,
  generateRows,
  sqlIdent,
  sqlLiteral,
  toCsv,
  toSql,
  validateSchema,
  type FieldType,
  type MockField,
} from './mock';
import { parseUuid } from './uuid';

const field = (name: string, type: FieldType, options = defaultOptions(type)): MockField => ({ id: name, name, type, options });

const ALL: MockField[] = FIELD_TYPES.map((t) => field(t.type, t.type));

describe('SeededRandom', () => {
  it('is reproducible and seed-sensitive', () => {
    const a = new SeededRandom('abc');
    const b = new SeededRandom('abc');
    const c = new SeededRandom('abd');
    const sa = Array.from({ length: 5 }, () => a.uint32());
    expect(Array.from({ length: 5 }, () => b.uint32())).toEqual(sa);
    expect(Array.from({ length: 5 }, () => c.uint32())).not.toEqual(sa);
  });

  it('hash differs for similar strings', () => {
    expect(cyrb128('a')).not.toEqual(cyrb128('b'));
  });

  it('int is inclusive and roughly uniform', () => {
    const r = new SeededRandom('dist');
    const counts = new Array(5).fill(0);
    for (let i = 0; i < 10000; i++) counts[r.int(0, 4)]++;
    for (const cnt of counts) expect(Math.abs(cnt - 2000)).toBeLessThan(200);
  });
});

describe('generateRows', () => {
  it('same seed + schema = identical rows', () => {
    const a = generateRows(ALL, 'seed-1', 50);
    const b = generateRows(ALL, 'seed-1', 50);
    expect(a).toEqual(b);
    expect(generateRows(ALL, 'seed-2', 50)).not.toEqual(a);
  });

  it('produces every field type with sane values', () => {
    const rows = generateRows(ALL, 'types', 200);
    rows.forEach((r, i) => {
      expect(r.autoIncrement).toBe(1 + i);
      expect(typeof r.firstName).toBe('string');
      expect(r.fullName).toBe(`${r.firstName} ${r.lastName}`);
      expect(r.email).toMatch(/^[a-z0-9._]+@[a-z.]+$/);
      expect(r.username).toMatch(/^[a-z0-9._]+$/);
      expect(r.phone).toMatch(/^\+1 \(\d{3}\) 555-01\d{2}$/);
      expect(r.zip).toMatch(/^\d{5}$/);
      const u = parseUuid(String(r.uuid));
      expect(u.ok && u.info.version).toBe(4);
      expect(u.ok && u.info.variant).toBe('RFC 9562');
      expect(r.integer).toBeGreaterThanOrEqual(1);
      expect(r.integer).toBeLessThanOrEqual(100);
      expect(Number.isInteger(r.integer)).toBe(true);
      expect(r.float as number).toBeGreaterThanOrEqual(0);
      expect(r.float as number).toBeLessThanOrEqual(1000);
      expect(String(r.float)).toMatch(/^\d+(\.\d{1,2})?$/);
      expect(typeof r.boolean).toBe('boolean');
      expect(r.date).toMatch(/^202[0-5]-\d{2}-\d{2}$/);
      expect(['active', 'pending', 'suspended']).toContain(r.enum);
      expect(String(r.words).split(' ')).toHaveLength(3);
      expect(r.sentence).toMatch(/^[A-Z][a-z ]+\.$/);
      expect(r.url).toMatch(/^https:\/\/(www\.)?example\.(com|org|net)\//);
      expect(r.ipv4).toMatch(/^(\d{1,3}\.){3}\d{1,3}$/);
      expect(String(r.ipv4).split('.').every((p) => Number(p) <= 255)).toBe(true);
      expect(r.ipv6).toMatch(/^([0-9a-f]{1,4}:){7}[0-9a-f]{1,4}$/);
      expect(r.hexColor).toMatch(/^#[0-9a-f]{6}$/);
    });
  });

  it('keeps city and country consistent within a row', () => {
    const rows = generateRows([field('city', 'city'), field('country', 'country')], 'geo', 100);
    const tokyo = rows.find((r) => r.city === 'Tokyo');
    if (tokyo) expect(tokyo.country).toBe('Japan');
    expect(rows.every((r) => typeof r.country === 'string')).toBe(true);
  });

  it('honors options: auto-increment step, boolean probability, date formats, blank %', () => {
    const rows = generateRows(
      [
        field('id', 'autoIncrement', { start: 100, step: -5 }),
        field('always', 'boolean', { probability: 100 }),
        field('never', 'boolean', { probability: 0 }),
        field('ts', 'date', { from: '2024-02-29', to: '2024-02-29', dateFormat: 'unix' }),
        field('iso', 'date', { from: '2024-01-01', to: '2024-01-02', dateFormat: 'datetime' }),
        field('maybe', 'integer', { min: 1, max: 1, blank: 50 }),
        field('money', 'float', { min: 0.5, max: 0.51, decimals: 2 }),
      ],
      'opts',
      400,
    );
    expect(rows[0].id).toBe(100);
    expect(rows[3].id).toBe(85);
    expect(rows.every((r) => r.always === true && r.never === false)).toBe(true);
    const day = Date.UTC(2024, 1, 29) / 1000;
    expect(rows.every((r) => (r.ts as number) >= day && (r.ts as number) < day + 86400)).toBe(true);
    expect(rows.every((r) => /^2024-01-0[12]T/.test(String(r.iso)))).toBe(true);
    const blanks = rows.filter((r) => r.maybe === null).length;
    expect(blanks).toBeGreaterThan(140);
    expect(blanks).toBeLessThan(260);
    expect(rows.every((r) => r.money === 0.5 || r.money === 0.51)).toBe(true);
  });

  it('generates 10k rows quickly', () => {
    const t = performance.now();
    const rows = generateRows(ALL, 'big', 10_000);
    const out = formatRows('csv', ALL.map((f) => f.name), rows, 't');
    expect(rows).toHaveLength(10_000);
    expect(out.split('\r\n')).toHaveLength(10_001);
    expect(performance.now() - t).toBeLessThan(3000);
  });
});

describe('validateSchema', () => {
  it('accepts the default options for every type', () => {
    expect(validateSchema(ALL)).toEqual([]);
  });
  it('reports problems', () => {
    const errs = validateSchema([
      field('', 'firstName'),
      field('a', 'integer', { min: 5, max: 1 }),
      field('a', 'enum', { values: ' , ' }),
      field('d', 'date', { from: '2024-05-01', to: '2024-01-01' }),
      field('f', 'float', { min: 0, max: 1, decimals: 20 }),
      field('b', 'boolean', { probability: 120 }),
      field('w', 'words', { count: 0 }),
      field('id', 'autoIncrement', { start: 1, step: 0 }),
    ]);
    expect(errs.join('\n')).toMatch(/Field 1 needs a name/);
    expect(errs.join('\n')).toMatch(/minimum is greater/);
    expect(errs.join('\n')).toMatch(/used more than once/);
    expect(errs.join('\n')).toMatch(/at least one value/);
    expect(errs.join('\n')).toMatch(/start date is after/);
    expect(errs.join('\n')).toMatch(/decimals/);
    expect(errs.join('\n')).toMatch(/chance of true/);
    expect(errs.join('\n')).toMatch(/word count/);
    expect(errs.join('\n')).toMatch(/step/);
    expect(validateSchema([])).toEqual(['Add at least one field.']);
  });
});

describe('CSV', () => {
  it('escapes delimiters, quotes, newlines and edge spaces', () => {
    expect(csvCell('plain')).toBe('plain');
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('line\nbreak')).toBe('"line\nbreak"');
    expect(csvCell(' pad')).toBe('" pad"');
    expect(csvCell(null)).toBe('');
    expect(csvCell(true)).toBe('true');
    expect(csvCell(1.5)).toBe('1.5');
  });
  it('builds header + rows', () => {
    expect(toCsv(['name', 'x,y'], [{ name: "O'Brien", 'x,y': 'a"b' }])).toBe('name,"x,y"\r\nO\'Brien,"a""b"');
  });
});

describe('SQL', () => {
  it('quotes identifiers and literals', () => {
    expect(sqlIdent('users')).toBe('"users"');
    expect(sqlIdent('public.users')).toBe('"public"."users"');
    expect(sqlIdent('we"ird')).toBe('"we""ird"');
    expect(sqlLiteral("O'Brien")).toBe("'O''Brien'");
    expect(sqlLiteral('back\\slash')).toBe("'back\\slash'");
    expect(sqlLiteral(null)).toBe('NULL');
    expect(sqlLiteral(false)).toBe('FALSE');
    expect(sqlLiteral(42)).toBe('42');
    expect(sqlLiteral(NaN)).toBe('NULL');
  });
  it('builds INSERT statements', () => {
    const sql = toSql('people', ['id', 'name'], [
      { id: 1, name: "D'Arcy" },
      { id: 2, name: null },
    ]);
    expect(sql).toBe(`INSERT INTO "people" ("id", "name") VALUES (1, 'D''Arcy');\nINSERT INTO "people" ("id", "name") VALUES (2, NULL);`);
    expect(toSql('  ', ['a'], [{ a: 1 }])).toContain('"mock_data"');
  });

  it('writes SQL that MySQL/MariaDB and SQL Server accept', () => {
    // Regression: only ANSI quoting existed, a syntax error in MySQL's default mode ("id" is a string
    // there) and TRUE/FALSE do not exist in T-SQL.
    const rows = [{ id: 1, name: 'C:\\temp O\'Brien', city: 'São Paulo', active: true }];
    const cols = ['id', 'name', 'city', 'active'];
    expect(toSql('app.people', cols, rows, 'mysql')).toBe(
      "INSERT INTO `app`.`people` (`id`, `name`, `city`, `active`) VALUES (1, 'C:\\\\temp O''Brien', 'São Paulo', TRUE);",
    );
    expect(toSql('people', cols, rows, 'sqlserver')).toBe(
      "INSERT INTO [people] ([id], [name], [city], [active]) VALUES (1, 'C:\\temp O''Brien', N'São Paulo', 1);",
    );
    expect(sqlIdent('we`ird', 'mysql')).toBe('`we``ird`');
    expect(sqlIdent('we]ird', 'sqlserver')).toBe('[we]]ird]');
    expect(formatRows('sql', cols, rows, 'people', 'sqlserver')).toContain('[people]');
  });
});

describe('JSON / NDJSON', () => {
  it('round-trips', () => {
    const rows = generateRows(ALL.slice(0, 6), 'json', 5);
    expect(JSON.parse(formatRows('json', [], rows, ''))).toEqual(rows);
    const nd = formatRows('ndjson', [], rows, '').split('\n');
    expect(nd).toHaveLength(5);
    expect(nd.map((l) => JSON.parse(l))).toEqual(rows);
  });
});
