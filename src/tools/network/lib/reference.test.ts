import { describe, expect, it } from 'vitest';
import mimeDb from 'mime-db';
import { CACHEABLE_BY_DEFAULT, HTTP_STATUSES, filterStatuses, redirectMethodNote, statusClass } from './httpStatus';
import { classifyQuery, lookupExtension, lookupType, mimeScore, normalizeExtension, searchMime, toEntries, type MimeDb } from './mime';
import { PORTS, filterPorts, parsePortQuery, portRange } from './ports';
import { parseUserAgent, SAMPLE_USER_AGENTS } from './userAgent';
import { HTTP_HEADERS, filterHeaders } from './httpHeaders';

describe('HTTP status codes', () => {
  it('has unique codes and all standard ones', () => {
    const codes = HTTP_STATUSES.map((s) => s.code);
    expect(new Set(codes).size).toBe(codes.length);
    const required = [
      100, 101, 102, 103, 200, 201, 202, 203, 204, 205, 206, 207, 208, 226, 300, 301, 302, 303, 304, 305, 306, 307, 308, 400, 401,
      402, 403, 404, 405, 406, 407, 408, 409, 410, 411, 412, 413, 414, 415, 416, 417, 418, 421, 422, 423, 424, 425, 426, 428, 429,
      431, 451, 500, 501, 502, 503, 504, 505, 506, 507, 508, 510, 511,
    ];
    for (const code of required) expect(codes).toContain(code);
  });

  it('is sorted and every entry is complete', () => {
    for (let i = 1; i < HTTP_STATUSES.length; i++) expect(HTTP_STATUSES[i].code).toBeGreaterThan(HTTP_STATUSES[i - 1].code);
    for (const s of HTTP_STATUSES) {
      expect(s.name).toBeTruthy();
      expect(s.summary.length).toBeGreaterThan(10);
      expect(s.details.length).toBeGreaterThan(10);
      expect(s.spec).toBeTruthy();
    }
  });

  it('marks unofficial codes', () => {
    expect(HTTP_STATUSES.find((s) => s.code === 499)?.unofficial).toBe(true);
    expect(HTTP_STATUSES.find((s) => s.code === 404)?.unofficial).toBeUndefined();
  });

  it('classifies', () => {
    expect(statusClass(101)).toBe('1xx');
    expect(statusClass(451)).toBe('4xx');
    expect(CACHEABLE_BY_DEFAULT.has(404)).toBe(true);
    expect(CACHEABLE_BY_DEFAULT.has(302)).toBe(false);
    expect(redirectMethodNote(307)).toMatch(/preserved/);
    expect(redirectMethodNote(200)).toBeNull();
  });

  it('filters by number prefix, class and words', () => {
    expect(filterStatuses(HTTP_STATUSES, { query: '404', group: 'all' }).map((s) => s.code)).toEqual([404]);
    expect(filterStatuses(HTTP_STATUSES, { query: '30', group: 'all' }).every((s) => String(s.code).startsWith('30'))).toBe(true);
    expect(filterStatuses(HTTP_STATUSES, { query: '5xx', group: 'all' }).every((s) => s.code >= 500)).toBe(true);
    expect(filterStatuses(HTTP_STATUSES, { query: 'rate limited', group: 'all' }).map((s) => s.code)).toContain(429);
    expect(filterStatuses(HTTP_STATUSES, { query: 'NOT FOUND', group: '4xx' }).map((s) => s.code)).toContain(404);
    expect(filterStatuses(HTTP_STATUSES, { query: 'not found', group: '2xx' })).toEqual([]);
    expect(filterStatuses(HTTP_STATUSES, { query: '', group: '1xx' })).toHaveLength(4);
    expect(filterStatuses(HTTP_STATUSES, { query: '999', group: 'all' })).toEqual([]);
  });
});

describe('MIME lookup', () => {
  const fixture: MimeDb = {
    'application/mp4': { source: 'iana', extensions: ['mp4', 'mpg4'] },
    'video/mp4': { source: 'iana', compressible: false, extensions: ['mp4', 'mp4v'] },
    'image/png': { source: 'iana', compressible: false, extensions: ['png'] },
    'image/x-png': { source: 'apache', extensions: ['png'] },
    'application/json': { source: 'iana', charset: 'UTF-8', compressible: true, extensions: ['json', 'map'] },
    'application/gzip': { source: 'iana', compressible: false, extensions: ['gz'] },
    'text/plain': { source: 'iana', compressible: true, extensions: ['txt', 'text'] },
    'application/vnd.foo': { source: 'iana', extensions: ['foo'] },
    'application/x-foo': { extensions: ['foo'] },
    'application/no-ext': { source: 'iana' },
  };
  const entries = toEntries(fixture);

  it('normalizes extensions', () => {
    expect(normalizeExtension('.PNG')).toBe('png');
    expect(normalizeExtension('photo.JPG')).toBe('jpg');
    expect(normalizeExtension('archive.tar.gz')).toBe('gz');
    expect(normalizeExtension('C:\\files\\a.b\\report.pdf')).toBe('pdf');
    expect(normalizeExtension('  ')).toBe('');
  });

  it('prefers the best-scored type', () => {
    expect(lookupExtension(entries, 'mp4').preferred?.type).toBe('video/mp4');
    expect(lookupExtension(entries, '.png').preferred?.type).toBe('image/png');
    expect(lookupExtension(entries, 'x.foo').preferred?.type).toBe('application/vnd.foo');
    expect(lookupExtension(entries, 'archive.tar.gz').preferred?.type).toBe('application/gzip');
    expect(lookupExtension(entries, 'nope').preferred).toBeNull();
    expect(lookupExtension(entries, 'mp4').candidates).toHaveLength(2);
  });

  it('scores', () => {
    expect(mimeScore({ type: 'image/png', source: 'iana' })).toBeGreaterThan(mimeScore({ type: 'image/x-png', source: 'apache' }));
    expect(mimeScore({ type: 'audio/wav', source: null })).toBeGreaterThan(mimeScore({ type: 'audio/x-wav', source: 'apache' }));
  });

  it('looks up types case-insensitively, ignoring parameters', () => {
    expect(lookupType(entries, 'Application/JSON; charset=utf-8')?.extensions).toEqual(['json', 'map']);
    expect(lookupType(entries, 'application/unknown')).toBeNull();
    expect(lookupType(entries, '')).toBeNull();
  });

  it('classifies queries', () => {
    expect(classifyQuery('application/json')).toBe('type');
    expect(classifyQuery('image/')).toBe('type');
    expect(classifyQuery('png')).toBe('extension');
    expect(classifyQuery('.tar.gz')).toBe('extension');
    expect(classifyQuery('my photo.jpg')).toBe('text');
    expect(classifyQuery('photo.jpg')).toBe('extension');
    expect(classifyQuery('')).toBe('text');
  });

  it('searches with exact matches first', () => {
    const r = searchMime(entries, 'json');
    expect(r[0].type).toBe('application/json');
    expect(searchMime(entries, 'mp4').slice(0, 2).map((e) => e.type)).toEqual(['video/mp4', 'application/mp4']);
    expect(searchMime(entries, 'zzz')).toEqual([]);
    expect(searchMime(entries, '')).toHaveLength(entries.length);
  });

  it('works with the real mime-db', () => {
    const real = toEntries(mimeDb);
    expect(real.length).toBeGreaterThan(2000);
    const pick = (ext: string) => lookupExtension(real, ext).preferred?.type;
    expect(pick('png')).toBe('image/png');
    expect(pick('mp4')).toBe('video/mp4');
    expect(pick('js')).toBe('text/javascript');
    expect(pick('json')).toBe('application/json');
    expect(pick('mp3')).toBe('audio/mpeg');
    expect(pick('xml')).toBe('application/xml');
    expect(pick('wav')).toBe('audio/wav');
    expect(pick('zip')).toBe('application/zip');
    expect(pick('svg')).toBe('image/svg+xml');
    expect(pick('woff2')).toBe('font/woff2');
    expect(pick('pdf')).toBe('application/pdf');
    expect(lookupType(real, 'text/html')?.compressible).toBe(true);
  });
});

describe('ports', () => {
  it('has about 150 valid, unique entries', () => {
    expect(PORTS.length).toBeGreaterThanOrEqual(140);
    const keys = PORTS.map((p) => `${p.port}/${p.protocol}/${p.service}`);
    expect(new Set(keys).size).toBe(keys.length);
    for (const p of PORTS) {
      expect(p.port).toBeGreaterThanOrEqual(0);
      expect(p.port).toBeLessThanOrEqual(65535);
      expect(p.description.length).toBeGreaterThan(5);
    }
  });

  it('knows the essentials', () => {
    const find = (port: number) => PORTS.filter((p) => p.port === port).map((p) => p.service);
    expect(find(22)).toContain('SSH / SFTP / SCP');
    expect(find(443)).toEqual(expect.arrayContaining(['HTTPS', 'HTTP/3 (QUIC)']));
    expect(find(5432)).toContain('PostgreSQL');
    expect(PORTS.find((p) => p.port === 53)?.protocol).toBe('TCP/UDP');
    expect(PORTS.find((p) => p.port === 51820)?.protocol).toBe('UDP');
  });

  it('matches the IANA registry on assignment status', () => {
    // 1521 is IANA's ncube-lm and 2181 is eforward, so Oracle and ZooKeeper use them by convention;
    // 8008 is registered as http-alt.
    expect(PORTS.find((p) => p.port === 1521)?.unofficial).toBe(true);
    expect(PORTS.find((p) => p.port === 2181)?.unofficial).toBe(true);
    expect(PORTS.find((p) => p.port === 8008)?.unofficial).toBeUndefined();
  });

  it('parses queries', () => {
    expect(parsePortQuery('')).toEqual({ kind: 'empty' });
    expect(parsePortQuery(' 443 ')).toEqual({ kind: 'port', port: 443 });
    expect(parsePortQuery('8100-8000')).toEqual({ kind: 'range', from: 8000, to: 8100 });
    expect(parsePortQuery('70000').kind).toBe('invalid');
    expect(parsePortQuery('1-70000').kind).toBe('invalid');
    expect(parsePortQuery('Postgres DB')).toEqual({ kind: 'text', words: ['postgres', 'db'] });
  });

  it('filters by number, range, text, protocol and category', () => {
    expect(filterPorts(PORTS, { text: '443', protocol: 'all', category: 'all' })).toHaveLength(2);
    expect(filterPorts(PORTS, { text: '443', protocol: 'UDP', category: 'all' }).map((p) => p.service)).toEqual(['HTTP/3 (QUIC)']);
    const range = filterPorts(PORTS, { text: '8000-8100', protocol: 'all', category: 'all' });
    expect(range.length).toBeGreaterThan(3);
    expect(range.every((p) => p.port >= 8000 && p.port <= 8100)).toBe(true);
    expect(filterPorts(PORTS, { text: 'redis', protocol: 'all', category: 'all' }).map((p) => p.port)).toEqual([6379]);
    expect(filterPorts(PORTS, { text: '', protocol: 'all', category: 'Mail' }).every((p) => p.category === 'Mail')).toBe(true);
    expect(filterPorts(PORTS, { text: '99999', protocol: 'all', category: 'all' })).toEqual([]);
    // 53 is TCP/UDP so it matches both protocol filters.
    expect(filterPorts(PORTS, { text: '53', protocol: 'TCP', category: 'all' })).toHaveLength(1);
  });

  it('classifies ranges', () => {
    expect(portRange(0)).toBe('Well-known');
    expect(portRange(1023)).toBe('Well-known');
    expect(portRange(1024)).toBe('Registered');
    expect(portRange(49151)).toBe('Registered');
    expect(portRange(49152)).toBe('Dynamic / private');
    expect(portRange(65535)).toBe('Dynamic / private');
  });
});

describe('user agent', () => {
  it('parses the samples', () => {
    const get = (label: string) => parseUserAgent(SAMPLE_USER_AGENTS.find((s) => s.label === label)!.ua);
    expect(get('Chrome · Windows')).toMatchObject({ browser: { name: 'Chrome', version: '129.0.0.0' }, os: { name: 'Windows' }, platform: { type: 'desktop' } });
    expect(get('Safari · iPhone')).toMatchObject({ browser: { name: 'Safari' }, os: { name: 'iOS', version: '17.6' }, platform: { type: 'mobile', vendor: 'Apple' } });
    expect(get('Firefox · Linux')).toMatchObject({ browser: { name: 'Firefox' }, engine: { name: 'Gecko' }, os: { name: 'Linux' } });
    // Browsers freeze macOS at 10.15.7, so "Catalina" would usually be wrong: no version name, and a note says why.
    expect(get('Edge · macOS')).toMatchObject({ browser: { name: 'Microsoft Edge' }, os: { name: 'macOS', version: '10.15.7', versionName: null } });
    expect(get('Edge · macOS').notes.join(' ')).toMatch(/freeze the macOS version/);
    expect(get('Safari · iPad').platform.type).toBe('tablet');
    expect(get('Googlebot').platform.type).toBe('bot');
  });

  it('falls back to product tokens', () => {
    const r = parseUserAgent('curl/8.9.1');
    expect(r.fromProductToken).toBe(true);
    expect(r.browser).toEqual({ name: 'curl', version: '8.9.1' });
    expect(parseUserAgent('python-requests/2.32.3').browser.name).toBe('python-requests');
  });

  it('handles unknown and empty input', () => {
    const r = parseUserAgent('garbage 🎉');
    expect(r.browser.name).toBeNull();
    expect(r.fromProductToken).toBe(false);
    expect(r.notes).toEqual([]);
    expect(() => parseUserAgent('  ')).toThrow(/Enter a User-Agent/);
  });

  it('corrects engines that the underlying parser gets wrong', () => {
    // Regression: Edge on Android/iOS was reported with the retired EdgeHTML engine.
    const edgeAndroid = parseUserAgent(
      'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36 EdgA/140.0.0.0',
    );
    expect(edgeAndroid.browser.name).toBe('Microsoft Edge');
    expect(edgeAndroid.engine.name).toBe('Blink');
    expect(edgeAndroid.notes.join(' ')).toMatch(/Android 10; K/);
    const edgeIos = parseUserAgent(
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 EdgiOS/140.0.3485.94 Mobile/15E148 Safari/605.1.15',
    );
    expect(edgeIos.engine).toEqual({ name: 'WebKit', version: '605.1.15' });
    // Regression: Firefox's frozen "Gecko/20100101" build date was shown as the engine version.
    const firefox = parseUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:143.0) Gecko/20100101 Firefox/143.0');
    expect(firefox.engine).toEqual({ name: 'Gecko', version: '143.0' });
    expect(firefox.os.versionName).toBe('10 or 11');
    expect(firefox.notes.join(' ')).toMatch(/Windows 11 still says/);
    const chromebook = parseUserAgent('Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36');
    expect(chromebook.platform.type).toBe('desktop');
  });
});

describe('HTTP headers', () => {
  it('has unique, complete entries', () => {
    expect(HTTP_HEADERS.length).toBeGreaterThanOrEqual(80);
    const names = HTTP_HEADERS.map((h) => h.name.toLowerCase());
    expect(new Set(names).size).toBe(names.length);
    for (const h of HTTP_HEADERS) {
      expect(h.examples.length).toBeGreaterThan(0);
      expect(h.description.length).toBeGreaterThan(20);
      expect(h.name).toMatch(/^[A-Za-z0-9-]+$/);
    }
  });

  it('covers the security headers', () => {
    const security = filterHeaders(HTTP_HEADERS, { query: '', direction: 'all', category: 'Security' }).map((h) => h.name);
    for (const name of ['Content-Security-Policy', 'Strict-Transport-Security', 'X-Content-Type-Options', 'Referrer-Policy', 'Permissions-Policy']) {
      expect(security).toContain(name);
    }
    expect(HTTP_HEADERS.find((h) => h.name === 'X-XSS-Protection')?.status).toBe('deprecated');
  });

  it('ranks name matches first', () => {
    expect(filterHeaders(HTTP_HEADERS, { query: 'cache-control', direction: 'all', category: 'all' })[0].name).toBe('Cache-Control');
    expect(filterHeaders(HTTP_HEADERS, { query: 'COOKIE', direction: 'all', category: 'all' })[0].name).toBe('Cookie');
  });

  it('filters by direction (both-direction headers always match)', () => {
    const req = filterHeaders(HTTP_HEADERS, { query: '', direction: 'request', category: 'all' });
    expect(req.every((h) => h.direction !== 'response')).toBe(true);
    expect(req.map((h) => h.name)).toContain('Content-Type');
    expect(filterHeaders(HTTP_HEADERS, { query: 'zzzz', direction: 'all', category: 'all' })).toEqual([]);
  });
});
