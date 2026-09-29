import { describe, expect, it } from 'vitest';
import { groupHistory, historyOverflow, makeHistoryEntry, sanitizeForHistory } from './history';
import { emptyDraft, findSecrets, kv, stripSecrets, draftsEqual, cloneDraft, normalizeDraft, type RequestDraft } from './model';

function secretDraft(): RequestDraft {
  const d = emptyDraft();
  d.method = 'POST';
  d.url = 'https://api.test/items?page=1&api_key=abc123&token={{tok}}';
  d.params = [kv('page', '1'), kv('api_key', 'abc123'), kv('token', '{{tok}}')];
  d.headers = [
    kv('Authorization', 'Bearer real-secret'),
    kv('Cookie', 'sid=1'),
    kv('X-API-Key', 'k'),
    kv('proxy-authorization', 'Basic xyz'),
    kv('Accept', 'application/json'),
  ];
  d.auth = { ...d.auth, type: 'basic', username: 'me', password: 'hunter2', token: 'tkn' };
  d.body = {
    ...d.body,
    mode: 'form-data',
    form: [
      { ...kv('file', ''), kind: 'file', file: new Blob(['data']), fileName: 'a.txt' },
      { ...kv('name', 'x'), kind: 'text' },
    ],
  };
  return d;
}

describe('sanitizeForHistory', () => {
  it('never stores auth config or sensitive headers', () => {
    const s = sanitizeForHistory(secretDraft());
    expect(s.auth.type).toBe('none');
    expect(s.auth.password).toBe('');
    expect(s.auth.token).toBe('');
    expect(s.headers.map((h) => h.key)).toEqual(['Accept']);
    expect(JSON.stringify(s)).not.toMatch(/real-secret|hunter2|sid=1|Basic xyz/);
  });

  it('drops file contents but keeps file names', () => {
    const s = sanitizeForHistory(secretDraft());
    expect(s.body.form[0].file).toBeNull();
    expect(s.body.form[0].fileName).toBe('a.txt');
    expect(s.body.binary).toBeNull();
  });

  it('blanks literal credential query params but keeps variable references', () => {
    const s = sanitizeForHistory(secretDraft());
    expect(s.url).toBe('https://api.test/items?page=1&api_key&token={{tok}}');
    expect(s.params.find((p) => p.key === 'api_key')?.value).toBe('');
    expect(s.params.find((p) => p.key === 'token')?.value).toBe('{{tok}}');
  });

  it('does not mutate the input', () => {
    const d = secretDraft();
    sanitizeForHistory(d);
    expect(d.auth.password).toBe('hunter2');
    expect(d.headers).toHaveLength(5);
  });

  it('makeHistoryEntry stores the sanitized request', () => {
    const e = makeHistoryEntry(secretDraft(), { status: 200, timeMs: 12, size: 3 }, 'browser', 'id1', 1000);
    expect(e).toMatchObject({ id: 'id1', at: 1000, method: 'POST', status: 200, via: 'browser' });
    expect(JSON.stringify(e)).not.toMatch(/abc123|hunter2|real-secret/);
    expect(e.error).toBeUndefined();
  });
});

describe('historyOverflow', () => {
  it('returns ids beyond the newest N', () => {
    const entries = Array.from({ length: 5 }, (_, i) => ({ id: `e${i}`, at: i }));
    expect(historyOverflow(entries, 3).sort()).toEqual(['e0', 'e1']);
    expect(historyOverflow(entries, 10)).toEqual([]);
  });
});

describe('groupHistory', () => {
  it('groups by day, newest first', () => {
    const now = new Date(2026, 8, 29, 12).getTime();
    const mk = (at: number, id: string) => makeHistoryEntry(emptyDraft(), { status: 200, timeMs: 1, size: 1 }, 'browser', id, at);
    const groups = groupHistory([mk(now - 1000, 'a'), mk(now - 86_400_000, 'b'), mk(now - 5 * 86_400_000, 'c'), mk(now, 'd')], now);
    expect(groups[0].label).toBe('Today');
    expect(groups[0].entries.map((e) => e.id)).toEqual(['d', 'a']);
    expect(groups[1].label).toBe('Yesterday');
    expect(groups).toHaveLength(3);
  });
});

describe('secrets in saved requests', () => {
  it('finds literal secrets and ignores variable references', () => {
    const d = secretDraft();
    expect(findSecrets(d).map((f) => f.label)).toEqual([
      'Basic auth password',
      'Header Authorization',
      'Header Cookie',
      'Header X-API-Key',
      'Header proxy-authorization',
    ]);
    d.auth = { ...d.auth, type: 'bearer', token: '{{token}}' };
    d.headers = [kv('Authorization', 'Bearer {{token}}')];
    expect(findSecrets(d)).toEqual([]);
  });

  it('stripSecrets blanks values but keeps structure', () => {
    const s = stripSecrets(secretDraft());
    expect(s.auth.type).toBe('basic');
    expect(s.auth.username).toBe('me');
    expect(s.auth.password).toBe('');
    expect(s.headers.find((h) => h.key === 'Authorization')?.value).toBe('');
    expect(s.headers.find((h) => h.key === 'Accept')?.value).toBe('application/json');
  });
});

describe('model helpers', () => {
  it('draftsEqual ignores row ids', () => {
    const d = secretDraft();
    expect(draftsEqual(d, cloneDraft(d))).toBe(true);
    const c = cloneDraft(d);
    c.headers[0].value = 'changed';
    expect(draftsEqual(d, c)).toBe(false);
  });

  it('normalizeDraft fills defaults for junk input', () => {
    const n = normalizeDraft({ method: 'FETCH' as never, url: 5 as never, params: 'x' as never });
    expect(n.method).toBe('GET');
    expect(n.url).toBe('');
    expect(n.params).toEqual([]);
    expect(n.body.mode).toBe('none');
    expect(normalizeDraft(null).name).toBe('Untitled request');
  });
});
