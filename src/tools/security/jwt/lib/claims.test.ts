import { describe, expect, it } from 'vitest';
import { evaluateClaims, readNumericDate } from './claims';

const NOW = 1_800_000_000; // 2027-01-15T08:00:00Z
const DAY = 86_400;

const row = (report: ReturnType<typeof evaluateClaims>, key: string) => report.rows.find((r) => r.key === key)!;

describe('evaluateClaims', () => {
  it('orders registered claims first and explains them', () => {
    const report = evaluateClaims({ name: 'Ada', exp: NOW + 60, iss: 'https://id.example', sub: '42', custom: [1, 2] }, NOW);
    expect(report.rows.map((r) => r.key)).toEqual(['iss', 'sub', 'exp', 'name', 'custom']);
    expect(row(report, 'iss').doc?.name).toBe('Issuer');
    expect(row(report, 'iss').registered).toBe(true);
    expect(row(report, 'name').registered).toBe(false);
    expect(row(report, 'name').doc?.name).toBe('Full name');
    expect(row(report, 'custom').doc).toBeUndefined();
    expect(row(report, 'custom').display).toBe('[1,2]');
  });

  it('reports expired tokens with a human delay', () => {
    const report = evaluateClaims({ exp: NOW - 3 * DAY, iat: NOW - 4 * DAY }, NOW);
    expect(report.summary).toMatchObject({ tone: 'danger', title: 'Expired 3 days ago' });
    expect(row(report, 'exp').status).toEqual({ tone: 'danger', text: 'Expired 3 days ago' });
    expect(row(report, 'exp').date?.iso).toBe('2027-01-12T08:00:00Z');
    expect(row(report, 'iat').status?.text).toBe('Issued 4 days ago');
    expect(report.lifetime).toBe('1 day');
  });

  it('treats exp equal to now as expired (RFC 7519 §4.1.4)', () => {
    expect(evaluateClaims({ exp: NOW }, NOW).summary.tone).toBe('danger');
  });

  it('reports valid tokens and time left', () => {
    const report = evaluateClaims({ exp: NOW + 2 * 3600 + 300, nbf: NOW - 10 }, NOW);
    expect(report.summary).toMatchObject({ tone: 'success', title: 'Not expired: expires in 2 hours 5 minutes' });
    expect(row(report, 'nbf').status?.tone).toBe('success');
  });

  it('reports tokens that are not valid yet', () => {
    const report = evaluateClaims({ nbf: NOW + 3600, exp: NOW + 7200 }, NOW);
    expect(report.summary).toMatchObject({ tone: 'warning', title: 'Not valid yet: becomes valid in 1 hour' });
    expect(row(report, 'nbf').status).toEqual({ tone: 'warning', text: 'Not valid for another 1 hour' });
  });

  it('reports tokens without expiry', () => {
    const report = evaluateClaims({ sub: 'x' }, NOW);
    expect(report.summary.tone).toBe('neutral');
    expect(report.issues.map((i) => i.message).join()).toMatch(/never expires/);
  });

  it('explains invalid time claims', () => {
    const report = evaluateClaims({ exp: '1800000000', iat: NOW * 1000, nbf: '2027-01-01' }, NOW);
    expect(row(report, 'exp').problem).toMatch(/string/);
    expect(row(report, 'iat').problem).toMatch(/milliseconds/);
    expect(row(report, 'nbf').problem).toMatch(/date string/);
    expect(report.summary).toMatchObject({ tone: 'warning', title: expect.stringMatching(/not a valid number/) });
    expect(report.issues.filter((i) => i.level === 'warning')).toHaveLength(3);
  });

  it('flags inconsistent and future times', () => {
    const report = evaluateClaims({ nbf: NOW + 100, exp: NOW + 50, iat: NOW + 3600 }, NOW);
    const text = report.issues.map((i) => i.message).join('\n');
    expect(text).toMatch(/“nbf” is not before “exp”/);
    expect(text).toMatch(/expired before it was issued/);
    expect(text).toMatch(/issued 1 hour in the future/);
    expect(row(report, 'iat').status?.tone).toBe('warning');
  });

  it('validates the types of string claims and audiences', () => {
    const report = evaluateClaims({ iss: 5, aud: ['a', 2], sub: 'ok', jti: null }, NOW);
    expect(row(report, 'iss').problem).toMatch(/must be a string/);
    expect(row(report, 'aud').problem).toMatch(/array of strings/);
    expect(row(report, 'sub').problem).toBeUndefined();
    expect(row(report, 'jti').problem).toBeDefined();
    expect(evaluateClaims({ aud: ['a', 'b'] }, NOW).rows[0].problem).toBeUndefined();
  });

  it('formats other date claims relatively', () => {
    const report = evaluateClaims({ auth_time: NOW - 300, updated_at: NOW + 60 }, NOW);
    expect(row(report, 'auth_time').status?.text).toBe('5 minutes ago');
    expect(row(report, 'updated_at').status?.text).toBe('In 1 minute');
  });

  it('handles empty claim sets and Unicode values', () => {
    expect(evaluateClaims({}, NOW).rows).toEqual([]);
    expect(evaluateClaims({ name: 'Zoë 😀' }, NOW).rows[0].display).toBe('Zoë 😀');
  });
});

describe('readNumericDate', () => {
  it('accepts fractional and negative seconds', () => {
    expect(readNumericDate(1.5)).toEqual({ seconds: 1.5 });
    expect(readNumericDate(-10)).toEqual({ seconds: -10 });
    expect(readNumericDate(Infinity)).toHaveProperty('problem');
    expect(readNumericDate(null)).toHaveProperty('problem');
  });
});
