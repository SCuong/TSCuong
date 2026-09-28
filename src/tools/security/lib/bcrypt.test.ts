import { describe, expect, it } from 'vitest';
import { bcryptCheck, bcryptHash, clampCost, estimateMs, parseBcryptHash, preparePassword } from './bcrypt';

// OpenBSD / jBCrypt reference vectors.
const KNOWN: Array<[string, string]> = [
  ['a', '$2a$06$m0CrhHm10qJ3lXRY.5zDGO3rS2KdeeWLuGmsfGlMfOxih58VYVfxe'],
  ['abc', '$2a$06$If6bvum7DFjUnE9p2uDeDu0YHzrHM6tf.iqN8.yx.jNN1ILEf7h0i'],
  ['abcdefghijklmnopqrstuvwxyz', '$2a$06$.rCVZVOThsIa97pEDOxvGuRRgzG64bvtJ0938xuqzv18d3ZpQhstC'],
  ['~!@#$%^&*()      ~!@#$%^&*()PNBFRD', '$2a$06$fPIsBO8qRqkjj273rfaOI.HtSV9jLDpTbZn782DC6/t7qT67P6FfO'],
  ['U*U', '$2a$05$CCCCCCCCCCCCCCCCCCCCC.E5YPO9kmyuRGyh0XouQYb4YMJKvyOeW'],
];

describe('parseBcryptHash', () => {
  it('splits a valid hash', () => {
    const r = parseBcryptHash('$2b$12$R9h/cIPz0gi.URNNX3kh2OPST9/PgBkqquzi.Ss7KIUgO2t0jWMUW');
    expect(r).toEqual({
      ok: true,
      value: { version: '2b', cost: 12, salt: 'R9h/cIPz0gi.URNNX3kh2O', hash: 'PST9/PgBkqquzi.Ss7KIUgO2t0jWMUW' },
    });
  });

  it('accepts $2a$ and $2y$ and trims whitespace', () => {
    expect(parseBcryptHash(`  ${KNOWN[0][1]}\n`).ok).toBe(true);
    expect(parseBcryptHash(KNOWN[0][1].replace('$2a$', '$2y$'))).toMatchObject({ ok: true, value: { version: '2y' } });
  });

  it('explains malformed hashes', () => {
    const err = (s: string) => {
      const r = parseBcryptHash(s);
      return r.ok ? '' : r.error;
    };
    expect(err('hello')).toMatch(/starts with \$2a\$/);
    expect(err('$2x$10$' + 'a'.repeat(53))).toMatch(/buggy/);
    expect(err('$2c$10$' + 'a'.repeat(53))).toMatch(/Unsupported bcrypt version/);
    expect(err('$2b$1$' + 'a'.repeat(53))).toMatch(/two digits/);
    expect(err('$2b$03$' + 'a'.repeat(53))).toMatch(/out of range/);
    expect(err('$2b$10$' + 'a'.repeat(50))).toMatch(/53 characters, but it is 50/);
    expect(err('$2b$10$' + 'a'.repeat(52) + '!')).toMatch(/may only contain/);
  });
});

describe('bcrypt verify with known hashes', () => {
  for (const [password, hash] of KNOWN) {
    it(`verifies ${JSON.stringify(password)}`, async () => {
      expect(await bcryptCheck(password, hash)).toBe(true);
      expect(await bcryptCheck(password + 'x', hash)).toBe(false);
    });
  }

  it('treats $2b$ and $2y$ prefixes like $2a$', async () => {
    const [password, hash] = KNOWN[1];
    expect(await bcryptCheck(password, hash.replace('$2a$', '$2b$'))).toBe(true);
    expect(await bcryptCheck(password, hash.replace('$2a$', '$2y$'))).toBe(true);
  });

  it('throws a readable error for malformed hashes and empty passwords', async () => {
    await expect(bcryptCheck('a', '$2b$10$short')).rejects.toThrow(/53 characters/);
    await expect(bcryptCheck('', KNOWN[0][1])).rejects.toThrow(/Enter the password/);
  });
});

describe('bcryptHash', () => {
  it('produces a $2b$ hash that verifies', async () => {
    const hash = await bcryptHash('correct horse battery staple', 4);
    expect(hash).toMatch(/^\$2b\$04\$[./A-Za-z0-9]{53}$/);
    expect(await bcryptCheck('correct horse battery staple', hash)).toBe(true);
    expect(await bcryptCheck('Correct horse battery staple', hash)).toBe(false);
  });

  it('uses a random salt', async () => {
    const a = await bcryptHash('same', 4);
    const b = await bcryptHash('same', 4);
    expect(a).not.toBe(b);
  });

  it('is deterministic for a fixed salt', async () => {
    const salt = new Uint8Array(16).fill(7);
    expect(await bcryptHash('pw', 4, salt)).toBe(await bcryptHash('pw', 4, salt));
  });

  it('handles Unicode passwords', async () => {
    const hash = await bcryptHash('pässwörd 🔐', 4);
    expect(await bcryptCheck('pässwörd 🔐', hash)).toBe(true);
    expect(await bcryptCheck('passwort 🔐', hash)).toBe(false);
  });

  it('only uses the first 72 bytes', async () => {
    const long = 'a'.repeat(72);
    const hash = await bcryptHash(long + 'EXTRA', 4);
    expect(await bcryptCheck(long, hash)).toBe(true);
    expect(await bcryptCheck(long + 'different', hash)).toBe(true);
    expect(preparePassword(long + 'EXTRA')).toMatchObject({ truncated: true, byteLength: 77 });
    expect(preparePassword('é'.repeat(36)).truncated).toBe(false);
    expect(preparePassword('é'.repeat(37)).truncated).toBe(true);
  });

  it('validates input', async () => {
    await expect(bcryptHash('', 10)).rejects.toThrow(/Enter a password/);
    await expect(bcryptHash('x', 3)).rejects.toThrow(/between 4 and 15/);
    await expect(bcryptHash('x', 16)).rejects.toThrow(/between 4 and 15/);
  });
});

describe('helpers', () => {
  it('clamps cost and estimates time', () => {
    expect(clampCost(2)).toBe(4);
    expect(clampCost(20)).toBe(15);
    expect(clampCost(10.4)).toBe(10);
    expect(estimateMs(12, 100)).toBe(400);
    expect(estimateMs(9, 100)).toBe(50);
  });
});
