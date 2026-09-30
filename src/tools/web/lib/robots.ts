// robots.txt generation and matching per RFC 9309 (Robots Exclusion Protocol),
// with Google's documented behavior for group selection and rule precedence.

export type RuleType = 'allow' | 'disallow';

export interface RobotsRule {
  type: RuleType;
  path: string;
}

export interface RobotsGroup {
  userAgents: string[];
  rules: RobotsRule[];
  /** Seconds; non-standard (ignored by Google), honored by Bing, Yandex and others. */
  crawlDelay: number | null;
  comment?: string;
}

export interface RobotsConfig {
  groups: RobotsGroup[];
  sitemaps: string[];
}

export interface AiCrawler {
  token: string;
  owner: string;
  purpose: string;
}

/** User-agent tokens of AI crawlers and AI-related fetchers, as documented by their operators. */
export const AI_CRAWLERS: AiCrawler[] = [
  { token: 'GPTBot', owner: 'OpenAI', purpose: 'Training data crawler' },
  { token: 'OAI-SearchBot', owner: 'OpenAI', purpose: 'ChatGPT search index' },
  { token: 'ChatGPT-User', owner: 'OpenAI', purpose: 'Fetches pages on behalf of ChatGPT users' },
  { token: 'ClaudeBot', owner: 'Anthropic', purpose: 'Training data crawler' },
  { token: 'Claude-SearchBot', owner: 'Anthropic', purpose: 'Search quality crawler' },
  { token: 'Claude-User', owner: 'Anthropic', purpose: 'Fetches pages on behalf of Claude users' },
  { token: 'anthropic-ai', owner: 'Anthropic', purpose: 'Legacy token' },
  { token: 'Google-Extended', owner: 'Google', purpose: 'Control token for Gemini training and grounding (Search is unaffected)' },
  { token: 'Applebot-Extended', owner: 'Apple', purpose: 'Control token for Apple AI training (Applebot search is unaffected)' },
  { token: 'CCBot', owner: 'Common Crawl', purpose: 'Open web archive widely used for AI training' },
  { token: 'PerplexityBot', owner: 'Perplexity', purpose: 'Search index crawler' },
  { token: 'Perplexity-User', owner: 'Perplexity', purpose: 'Fetches pages on behalf of users' },
  { token: 'Bytespider', owner: 'ByteDance', purpose: 'Training data crawler' },
  { token: 'Amazonbot', owner: 'Amazon', purpose: 'Crawler used for Alexa and AI services' },
  { token: 'meta-externalagent', owner: 'Meta', purpose: 'Training data crawler' },
  { token: 'FacebookBot', owner: 'Meta', purpose: 'Speech recognition training crawler' },
  { token: 'cohere-ai', owner: 'Cohere', purpose: 'AI crawler' },
  { token: 'Diffbot', owner: 'Diffbot', purpose: 'Knowledge graph crawler' },
  { token: 'AI2Bot', owner: 'Allen Institute for AI', purpose: 'Open research model training crawler' },
  { token: 'MistralAI-User', owner: 'Mistral AI', purpose: 'Fetches pages on behalf of Le Chat users' },
];

export const COMMON_AGENTS: string[] = [
  'Googlebot',
  'Googlebot-Image',
  'Googlebot-News',
  'Bingbot',
  'DuckDuckBot',
  'YandexBot',
  'Baiduspider',
  'Applebot',
  ...AI_CRAWLERS.map((c) => c.token),
];

export type PresetId = 'allow-all' | 'block-all' | 'block-ai' | 'standard';

export function preset(id: PresetId, sitemap = ''): RobotsConfig {
  const sitemaps = sitemap ? [sitemap] : [];
  switch (id) {
    case 'allow-all':
      return { groups: [{ userAgents: ['*'], rules: [], crawlDelay: null }], sitemaps };
    case 'block-all':
      return { groups: [{ userAgents: ['*'], rules: [{ type: 'disallow', path: '/' }], crawlDelay: null }], sitemaps };
    case 'block-ai':
      return {
        groups: [
          { userAgents: ['*'], rules: [], crawlDelay: null },
          {
            userAgents: AI_CRAWLERS.map((c) => c.token),
            rules: [{ type: 'disallow', path: '/' }],
            crawlDelay: null,
            comment: 'AI crawlers and AI training control tokens',
          },
        ],
        sitemaps,
      };
    case 'standard':
      return {
        groups: [
          {
            userAgents: ['*'],
            rules: [
              { type: 'disallow', path: '/admin/' },
              { type: 'disallow', path: '/cart' },
              { type: 'disallow', path: '/*?sessionid=' },
              { type: 'allow', path: '/admin/public/' },
            ],
            crawlDelay: null,
          },
        ],
        sitemaps,
      };
  }
}

export interface RobotsIssue {
  level: 'error' | 'warning';
  message: string;
}

export function validateConfig(config: RobotsConfig): RobotsIssue[] {
  const issues: RobotsIssue[] = [];
  config.groups.forEach((g, gi) => {
    const label = `Group ${gi + 1}`;
    const agents = g.userAgents.map((a) => a.trim()).filter(Boolean);
    if (!agents.length) issues.push({ level: 'error', message: `${label} has no user-agent. Add one, or * for all crawlers.` });
    for (const a of agents) {
      if (/[\s:#]/.test(a)) issues.push({ level: 'warning', message: `${label}: user-agent “${a}” should be a single product token without spaces, colons or #.` });
    }
    for (const r of g.rules) {
      const p = r.path.trim();
      if (!p) continue;
      if (!p.startsWith('/') && !p.startsWith('*')) {
        issues.push({ level: 'warning', message: `${label}: “${p}” should start with / (paths are matched from the start of the URL path).` });
      }
      if (/\s/.test(p)) issues.push({ level: 'warning', message: `${label}: “${p}” contains whitespace; encode spaces as %20.` });
      if (p.includes('#')) issues.push({ level: 'error', message: `${label}: “${p}” contains #, which starts a comment in robots.txt.` });
    }
    if (g.crawlDelay !== null && (!(g.crawlDelay >= 0) || !Number.isFinite(g.crawlDelay))) {
      issues.push({ level: 'error', message: `${label}: crawl-delay must be a positive number of seconds.` });
    }
  });
  const seen = new Map<string, number>();
  config.groups.forEach((g, gi) => {
    for (const a of g.userAgents.map((x) => x.trim().toLowerCase()).filter(Boolean)) {
      if (seen.has(a) && seen.get(a) !== gi) {
        issues.push({ level: 'warning', message: `User-agent “${a}” appears in more than one group; crawlers combine those groups' rules.` });
      }
      seen.set(a, gi);
    }
  });
  for (const s of config.sitemaps) {
    const t = s.trim();
    if (!t) continue;
    if (!/^https?:\/\/[^/\s]+/i.test(t)) issues.push({ level: 'error', message: `Sitemap “${t}” must be an absolute URL, e.g. https://example.com/sitemap.xml.` });
  }
  return issues;
}

export function generateRobots(config: RobotsConfig): string {
  const blocks: string[] = [];
  for (const g of config.groups) {
    const agents = g.userAgents.map((a) => a.trim()).filter(Boolean);
    if (!agents.length) continue;
    const lines: string[] = [];
    if (g.comment) lines.push(`# ${g.comment.replace(/\s*\n\s*/g, ' ')}`);
    for (const a of agents) lines.push(`User-agent: ${a}`);
    const rules = g.rules.filter((r) => r.path.trim());
    // An empty Disallow means "nothing is disallowed"; it keeps an otherwise empty group valid.
    if (!rules.length) lines.push('Disallow:');
    for (const r of rules) lines.push(`${r.type === 'allow' ? 'Allow' : 'Disallow'}: ${r.path.trim()}`);
    if (g.crawlDelay !== null && g.crawlDelay >= 0 && Number.isFinite(g.crawlDelay)) lines.push(`Crawl-delay: ${g.crawlDelay}`);
    blocks.push(lines.join('\n'));
  }
  const sitemaps = config.sitemaps.map((s) => s.trim()).filter(Boolean);
  if (sitemaps.length) blocks.push(sitemaps.map((s) => `Sitemap: ${s}`).join('\n'));
  return blocks.length ? `${blocks.join('\n\n')}\n` : '';
}

// ---------------------------------------------------------------------------
// Parsing and matching
// ---------------------------------------------------------------------------

export interface ParsedRule extends RobotsRule {
  line: number;
}

export interface ParsedGroup {
  userAgents: string[];
  rules: ParsedRule[];
  crawlDelay: number | null;
  line: number;
}

export interface ParsedRobots {
  groups: ParsedGroup[];
  sitemaps: string[];
  /** Lines that could not be understood (1-based line numbers). */
  unknown: Array<{ line: number; text: string }>;
}

const KEY_ALIASES: Record<string, string> = {
  'user-agent': 'user-agent',
  useragent: 'user-agent',
  'user agent': 'user-agent',
  allow: 'allow',
  disallow: 'disallow',
  dissallow: 'disallow',
  dissalow: 'disallow',
  disalow: 'disallow',
  'crawl-delay': 'crawl-delay',
  sitemap: 'sitemap',
  'site-map': 'sitemap',
};

/** Parses robots.txt leniently, as crawlers do (unknown lines are ignored but reported). */
export function parseRobots(text: string): ParsedRobots {
  const result: ParsedRobots = { groups: [], sitemaps: [], unknown: [] };
  let current: ParsedGroup | null = null;
  let lastWasAgent = false;
  const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const lines = body.split(/\r\n|\r|\n/);
  lines.forEach((raw, i) => {
    const lineNo = i + 1;
    const hash = raw.indexOf('#');
    const line = (hash === -1 ? raw : raw.slice(0, hash)).trim();
    if (!line) return;
    const colon = line.indexOf(':');
    if (colon === -1) {
      result.unknown.push({ line: lineNo, text: raw.trim() });
      return;
    }
    const key = KEY_ALIASES[line.slice(0, colon).trim().toLowerCase()];
    const value = line.slice(colon + 1).trim();
    if (!key) {
      result.unknown.push({ line: lineNo, text: raw.trim() });
      return;
    }
    if (key === 'sitemap') {
      if (value) result.sitemaps.push(value);
      return;
    }
    if (key === 'user-agent') {
      if (!current || !lastWasAgent) {
        current = { userAgents: [], rules: [], crawlDelay: null, line: lineNo };
        result.groups.push(current);
      }
      if (value) current.userAgents.push(value);
      lastWasAgent = true;
      return;
    }
    lastWasAgent = false;
    if (!current) {
      result.unknown.push({ line: lineNo, text: raw.trim() });
      return;
    }
    if (key === 'crawl-delay') {
      const n = Number(value);
      if (Number.isFinite(n) && n >= 0) current.crawlDelay = n;
      return;
    }
    current.rules.push({ type: key as RuleType, path: value, line: lineNo });
  });
  return result;
}

/** Product token of a crawler's user-agent string, e.g. "Googlebot/2.1 (+http://…)" → "googlebot". */
export function productToken(userAgent: string): string {
  const t = userAgent.trim();
  const compatible = /compatible;\s*([A-Za-z0-9_-]+)/.exec(t);
  if (compatible) return compatible[1].toLowerCase();
  return (/^[A-Za-z0-9_-]+/.exec(t)?.[0] ?? '').toLowerCase();
}

/**
 * Normalizes a path for comparison (RFC 9309 §2.2.2): non-ASCII characters and spaces are percent-encoded
 * as UTF-8, escapes are upper-cased, and escaped unreserved characters are decoded (`%62%61%7A` → `baz`).
 */
export function normalizePath(path: string): string {
  let out = '';
  for (const ch of path) {
    const code = ch.codePointAt(0)!;
    if (code > 0x7e || code <= 0x20) {
      out += Array.from(new TextEncoder().encode(ch), (b) => `%${b.toString(16).toUpperCase().padStart(2, '0')}`).join('');
    } else out += ch;
  }
  return out.replace(/%[0-9a-f]{2}/gi, (m) => {
    const ch = String.fromCharCode(parseInt(m.slice(1), 16));
    return /[A-Za-z0-9\-._~]/.test(ch) ? ch : m.toUpperCase();
  });
}

/**
 * Whether a normalized path matches a normalized robots.txt pattern: `*` matches any run of characters and a
 * trailing `$` anchors the end. Runs in O(pattern × path) like Google's reference parser, so patterns such as
 * `/*a*a*a*a*b` cannot hang the page the way a backtracking regular expression would.
 */
export function matchesPattern(pattern: string, path: string): boolean {
  // Every position in `path` where the pattern read so far can end, in ascending order.
  let positions = [0];
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === '$' && i === pattern.length - 1) return positions[positions.length - 1] === path.length;
    if (c === '*') {
      const from = positions[0];
      positions = [];
      for (let p = from; p <= path.length; p++) positions.push(p);
      continue;
    }
    const next: number[] = [];
    for (const p of positions) if (p < path.length && path[p] === c) next.push(p + 1);
    if (!next.length) return false;
    positions = next;
  }
  return true;
}

/** Compiles a robots.txt path pattern (* wildcard, $ end anchor) into a RegExp anchored at the start. */
export function patternToRegExp(pattern: string): RegExp {
  const p = normalizePath(pattern);
  const anchored = p.endsWith('$');
  const body = anchored ? p.slice(0, -1) : p;
  const source = body
    .split('*')
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');
  return new RegExp(`^${source}${anchored ? '$' : ''}`);
}

/** Converts a URL or path to the string robots rules are matched against (path + query). */
export function toMatchTarget(urlOrPath: string): string {
  const t = urlOrPath.trim();
  if (!t) return '/';
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(t)) {
    try {
      const u = new URL(t);
      return normalizePath(u.pathname + u.search);
    } catch {
      /* fall through: treat as a path */
    }
  }
  const noHash = t.split('#')[0];
  return normalizePath(noHash.startsWith('/') ? noHash : `/${noHash}`);
}

export interface MatchResult {
  allowed: boolean;
  /** The winning rule, or null when no rule matched (allowed by default). */
  rule: ParsedRule | null;
  /** User-agent values of the group(s) that applied, or empty when no group applies. */
  groupAgents: string[];
  target: string;
  reason: string;
}

/**
 * The product token a `User-agent:` line names, lower-cased: `Googlebot/2.1` names `googlebot` (crawlers
 * compare only the token, as Google's parser does). `*` stays `*`.
 */
export function groupToken(value: string): string {
  const v = value.trim();
  if (v === '*' || /^\*\s/.test(v)) return '*';
  return (/^[A-Za-z0-9_-]+/.exec(v)?.[0] ?? '').toLowerCase();
}

/** Picks the groups for a crawler: the most specific user-agent match, else `*`. All groups with that value are combined. */
export function selectGroups(robots: ParsedRobots, userAgent: string): ParsedGroup[] {
  const token = productToken(userAgent);
  let best = '';
  if (token) {
    for (const g of robots.groups) {
      for (const a of g.userAgents) {
        const v = groupToken(a);
        // Exact product token, or a more general token of the same family (googlebot-news → googlebot).
        const matches = token === v || token.startsWith(`${v}-`);
        if (v !== '*' && matches && v.length > best.length) best = v;
      }
    }
  }
  const wanted = best || '*';
  return robots.groups.filter((g) => g.userAgents.some((a) => groupToken(a) === wanted));
}

/**
 * Decides whether `urlOrPath` may be crawled by `userAgent`.
 * The longest matching pattern wins; on a tie between allow and disallow, allow wins (RFC 9309 §2.2.2).
 */
export function isAllowed(robots: ParsedRobots, userAgent: string, urlOrPath: string): MatchResult {
  const target = toMatchTarget(urlOrPath);
  if (target === '/robots.txt') {
    return { allowed: true, rule: null, groupAgents: [], target, reason: '/robots.txt itself is always allowed.' };
  }
  const groups = selectGroups(robots, userAgent);
  if (!groups.length) {
    return { allowed: true, rule: null, groupAgents: [], target, reason: 'No group applies to this crawler, so everything is allowed.' };
  }
  let winner: ParsedRule | null = null;
  let winnerLen = -1;
  for (const g of groups) {
    for (const r of g.rules) {
      if (!r.path) continue;
      const pattern = normalizePath(r.path);
      if (!matchesPattern(pattern, target)) continue;
      const len = pattern.length;
      if (len > winnerLen || (len === winnerLen && r.type === 'allow' && winner?.type === 'disallow')) {
        winner = r;
        winnerLen = len;
      }
    }
  }
  const groupAgents = [...new Set(groups.flatMap((g) => g.userAgents))];
  if (!winner) return { allowed: true, rule: null, groupAgents, target, reason: 'No rule matches this path, so it is allowed.' };
  const allowed = winner.type === 'allow';
  return {
    allowed,
    rule: winner,
    groupAgents,
    target,
    reason: `${allowed ? 'Allow' : 'Disallow'}: ${winner.path} (line ${winner.line}) is the most specific matching rule.`,
  };
}
