import { describe, expect, it } from 'vitest';
import {
  AI_CRAWLERS,
  generateRobots,
  groupToken,
  isAllowed,
  matchesPattern,
  normalizePath,
  parseRobots,
  patternToRegExp,
  preset,
  productToken,
  selectGroups,
  toMatchTarget,
  validateConfig,
} from './robots';

const allowed = (robots: string, ua: string, path: string) => isAllowed(parseRobots(robots), ua, path).allowed;

describe('generateRobots', () => {
  it('generates presets', () => {
    expect(generateRobots(preset('allow-all'))).toBe('User-agent: *\nDisallow:\n');
    expect(generateRobots(preset('block-all', 'https://example.com/sitemap.xml'))).toBe(
      'User-agent: *\nDisallow: /\n\nSitemap: https://example.com/sitemap.xml\n',
    );
    const ai = generateRobots(preset('block-ai'));
    for (const c of AI_CRAWLERS) expect(ai).toContain(`User-agent: ${c.token}\n`);
    expect(ai).toContain('# AI crawlers');
  });

  it('writes rules, crawl-delay and skips empty parts', () => {
    const txt = generateRobots({
      groups: [
        {
          userAgents: ['Bingbot', ' '],
          rules: [
            { type: 'disallow', path: '/private/' },
            { type: 'allow', path: '  /private/ok ' },
            { type: 'disallow', path: '' },
          ],
          crawlDelay: 5,
        },
        { userAgents: [], rules: [], crawlDelay: null },
      ],
      sitemaps: ['', 'https://example.com/a.xml'],
    });
    expect(txt).toBe('User-agent: Bingbot\nDisallow: /private/\nAllow: /private/ok\nCrawl-delay: 5\n\nSitemap: https://example.com/a.xml\n');
    expect(generateRobots({ groups: [], sitemaps: [] })).toBe('');
  });

  it('round-trips through the parser', () => {
    const cfg = preset('standard', 'https://example.com/sitemap.xml');
    const parsed = parseRobots(generateRobots(cfg));
    expect(parsed.groups).toHaveLength(1);
    expect(parsed.groups[0].rules.map((r) => [r.type, r.path])).toEqual(cfg.groups[0].rules.map((r) => [r.type, r.path]));
    expect(parsed.sitemaps).toEqual(['https://example.com/sitemap.xml']);
  });
});

describe('validateConfig', () => {
  it('flags problems', () => {
    const issues = validateConfig({
      groups: [
        { userAgents: [], rules: [], crawlDelay: null },
        { userAgents: ['Bad Bot'], rules: [{ type: 'disallow', path: 'admin' }, { type: 'allow', path: '/a#b' }], crawlDelay: -1 },
        { userAgents: ['bad bot'], rules: [], crawlDelay: null },
      ],
      sitemaps: ['/sitemap.xml'],
    });
    const text = issues.map((i) => i.message).join('\n');
    expect(text).toMatch(/no user-agent/);
    expect(text).toMatch(/single product token/);
    expect(text).toMatch(/should start with \//);
    expect(text).toMatch(/contains #/);
    expect(text).toMatch(/crawl-delay/);
    expect(text).toMatch(/more than one group/);
    expect(text).toMatch(/absolute URL/);
    expect(validateConfig(preset('block-ai', 'https://example.com/sitemap.xml'))).toEqual([]);
  });
});

describe('parseRobots', () => {
  it('groups consecutive user-agents and ignores comments', () => {
    const p = parseRobots(String.fromCharCode(0xfeff) + '# hi\nUser-agent: a\nuser-agent: b # both\nDisallow: /x\r\n\nUser-agent: c\nAllow: /\nCrawl-delay: 2\nSitemap: https://e.com/s.xml\nnonsense\nFoo: bar');
    expect(p.groups.map((g) => g.userAgents)).toEqual([['a', 'b'], ['c']]);
    expect(p.groups[0].rules[0]).toEqual({ type: 'disallow', path: '/x', line: 4 });
    expect(p.groups[1].crawlDelay).toBe(2);
    expect(p.sitemaps).toEqual(['https://e.com/s.xml']);
    expect(p.unknown.map((u) => u.line)).toEqual([10, 11]);
  });

  it('starts a new group when a user-agent follows rules', () => {
    const p = parseRobots('User-agent: a\nDisallow: /\nUser-agent: b\nDisallow: /b');
    expect(p.groups).toHaveLength(2);
  });

  it('reports rules before any user-agent', () => {
    expect(parseRobots('Disallow: /').unknown).toHaveLength(1);
  });

  it('parses empty input', () => {
    expect(parseRobots('')).toEqual({ groups: [], sitemaps: [], unknown: [] });
  });
});

describe('matching', () => {
  it('extracts product tokens', () => {
    expect(productToken('Googlebot/2.1 (+http://www.google.com/bot.html)')).toBe('googlebot');
    expect(productToken('Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)')).toBe('bingbot');
    expect(productToken('GPTBot')).toBe('gptbot');
    expect(productToken('')).toBe('');
  });

  it('compiles wildcards and end anchors', () => {
    expect(patternToRegExp('/*.php$').test('/a/b.php')).toBe(true);
    expect(patternToRegExp('/*.php$').test('/a/b.php?x=1')).toBe(false);
    expect(patternToRegExp('/fish*').test('/fish.html')).toBe(true);
    expect(patternToRegExp('/fish').test('/Fish.asp')).toBe(false);
    expect(patternToRegExp('/a.b(c)').test('/a.b(c)/d')).toBe(true);
    expect(patternToRegExp('/a.b').test('/axb')).toBe(false);
  });

  it('uses longest match with allow winning ties (Google examples)', () => {
    const r = 'User-agent: *\nAllow: /p\nDisallow: /';
    expect(allowed(r, 'Googlebot', '/page')).toBe(true);
    expect(allowed(r, 'Googlebot', '/other')).toBe(false);
    expect(allowed('User-agent: *\nAllow: /folder\nDisallow: /folder', 'x', '/folder/page')).toBe(true);
    expect(allowed('User-agent: *\nAllow: /page\nDisallow: /*.htm', 'x', '/page.htm')).toBe(false);
    expect(allowed('User-agent: *\nAllow: /$\nDisallow: /', 'x', '/')).toBe(true);
    expect(allowed('User-agent: *\nAllow: /$\nDisallow: /', 'x', '/page.htm')).toBe(false);
  });

  it('treats empty disallow as allow-all and handles no groups', () => {
    expect(allowed('User-agent: *\nDisallow:', 'x', '/anything')).toBe(true);
    expect(allowed('', 'x', '/anything')).toBe(true);
    expect(isAllowed(parseRobots(''), 'x', '/a').reason).toMatch(/No group/);
  });

  it('always allows /robots.txt', () => {
    expect(allowed('User-agent: *\nDisallow: /', 'x', 'https://example.com/robots.txt')).toBe(true);
  });

  it('selects the most specific group and combines duplicates', () => {
    const r = parseRobots(
      'User-agent: *\nDisallow: /\n\nUser-agent: googlebot\nDisallow: /private\n\nUser-agent: Googlebot-News\nDisallow: /news-only\n\nUser-agent: googlebot\nDisallow: /tmp',
    );
    expect(selectGroups(r, 'Googlebot')).toHaveLength(2);
    expect(isAllowed(r, 'Googlebot', '/public').allowed).toBe(true);
    expect(isAllowed(r, 'Googlebot', '/tmp/x').allowed).toBe(false);
    expect(isAllowed(r, 'Googlebot-News', '/private').allowed).toBe(true);
    expect(isAllowed(r, 'Googlebot-News', '/news-only/a').allowed).toBe(false);
    expect(isAllowed(r, 'Googlebot-Image', '/private').allowed).toBe(false);
    expect(isAllowed(r, 'Googlebot-Image', '/public').allowed).toBe(true);
    expect(isAllowed(r, 'Bingbot', '/public').allowed).toBe(false);
    expect(isAllowed(r, 'googlebotx', '/public').allowed).toBe(false);
  });

  it('blocks AI crawlers with the preset but allows search engines', () => {
    const r = parseRobots(generateRobots(preset('block-ai')));
    for (const c of AI_CRAWLERS) expect(isAllowed(r, c.token, '/blog/post').allowed).toBe(false);
    expect(isAllowed(r, 'Googlebot', '/blog/post').allowed).toBe(true);
    expect(isAllowed(r, 'Mozilla/5.0 (compatible; GPTBot/1.2; +https://openai.com/gptbot)', '/').allowed).toBe(false);
  });

  it('matches query strings and full URLs', () => {
    const r = 'User-agent: *\nDisallow: /*?sessionid=\nDisallow: /search?q=';
    expect(allowed(r, 'x', 'https://example.com/cart?sessionid=1')).toBe(false);
    expect(allowed(r, 'x', '/search?q=shoes')).toBe(false);
    expect(allowed(r, 'x', '/search')).toBe(true);
    expect(toMatchTarget('https://example.com/a?b=1#frag')).toBe('/a?b=1');
    expect(toMatchTarget('a/b#x')).toBe('/a/b');
    expect(toMatchTarget('')).toBe('/');
  });

  it('compares Unicode and percent-encoded paths equally', () => {
    expect(normalizePath('/café')).toBe('/caf%C3%A9');
    expect(normalizePath('/caf%c3%a9')).toBe('/caf%C3%A9');
    expect(allowed('User-agent: *\nDisallow: /café', 'x', '/caf%C3%A9/menu')).toBe(false);
    expect(allowed('User-agent: *\nDisallow: /caf%C3%A9', 'x', 'https://example.com/café')).toBe(false);
    expect(allowed('User-agent: *\nDisallow: /😀', 'x', '/%F0%9F%98%80')).toBe(false);
  });

  it('reports the winning rule and line', () => {
    const m = isAllowed(parseRobots('User-agent: *\nDisallow: /a\nAllow: /a/b'), 'x', '/a/b/c');
    expect(m.allowed).toBe(true);
    expect(m.rule).toEqual({ type: 'allow', path: '/a/b', line: 3 });
    expect(m.reason).toMatch(/line 3/);
  });

  it('is fast on large files', () => {
    const big = `User-agent: *\n${Array.from({ length: 5000 }, (_, i) => `Disallow: /p${i}/`).join('\n')}`;
    const r = parseRobots(big);
    expect(r.groups[0].rules).toHaveLength(5000);
    expect(isAllowed(r, 'x', '/p4999/x').allowed).toBe(false);
    expect(isAllowed(r, 'x', '/q').allowed).toBe(true);
  });

  // Regression: patterns were compiled to backtracking regular expressions, so a pattern with many
  // wildcards froze the tab (catastrophic backtracking) when tested against a long path.
  it('matches pathological wildcard patterns in linear time', () => {
    const r = parseRobots(`User-agent: *\nDisallow: /${'*a'.repeat(30)}b\n`);
    const started = Date.now();
    expect(isAllowed(r, 'x', `/${'a'.repeat(5000)}`).allowed).toBe(true);
    expect(isAllowed(r, 'x', `/${'a'.repeat(40)}b`).allowed).toBe(false);
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it('matches wildcards and end anchors like the reference parser', () => {
    expect(matchesPattern('/fish*', '/fish.html')).toBe(true);
    expect(matchesPattern('/*.php$', '/a/b.php')).toBe(true);
    expect(matchesPattern('/*.php$', '/a/b.php?x=1')).toBe(false);
    expect(matchesPattern('/a$b', '/a$b/c')).toBe(true);
    expect(matchesPattern('/$', '/')).toBe(true);
    expect(matchesPattern('/$', '/x')).toBe(false);
    expect(matchesPattern('*', '')).toBe(true);
    expect(matchesPattern('/a**b', '/ab')).toBe(true);
  });

  // Regression (RFC 9309 §2.2.2): escaped unreserved characters must be decoded before comparing.
  it('decodes percent-encoded unreserved characters', () => {
    expect(normalizePath('/foo/bar/%62%61%7A')).toBe('/foo/bar/baz');
    expect(normalizePath('/a%2Fb%2a%7e')).toBe('/a%2Fb%2A~');
    expect(allowed('User-agent: *\nDisallow: /foo/bar/baz', 'x', '/foo/bar/%62%61%7A')).toBe(false);
    expect(allowed('User-agent: *\nDisallow: /foo/bar/%62az', 'x', '/foo/bar/baz')).toBe(false);
  });

  // Regression: a group line such as "User-agent: Googlebot/2.1" did not apply to Googlebot.
  it('matches group lines by product token', () => {
    expect(groupToken('Googlebot/2.1')).toBe('googlebot');
    expect(groupToken(' * ')).toBe('*');
    expect(allowed('User-agent: Googlebot/2.1\nDisallow: /g\n\nUser-agent: *\nDisallow: /s', 'Googlebot', '/g')).toBe(false);
    expect(allowed('User-agent: Googlebot/2.1\nDisallow: /g\n\nUser-agent: *\nDisallow: /s', 'Googlebot', '/s')).toBe(true);
  });
});
