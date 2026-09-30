// sitemap.xml generation following the sitemaps.org 0.9 protocol.

export const MAX_URLS = 50_000;
export const MAX_BYTES = 50 * 1024 * 1024;
/** A <loc> must be shorter than this (sitemaps.org: "less than 2,048 characters"). */
export const MAX_URL_LENGTH = 2048;

export const CHANGEFREQS = ['always', 'hourly', 'daily', 'weekly', 'monthly', 'yearly', 'never'] as const;
export type Changefreq = (typeof CHANGEFREQS)[number];

export interface SitemapOptions {
  /** Resolve relative paths against this URL (optional). */
  baseUrl: string;
  lastmod: 'none' | 'date';
  /** W3C Datetime: YYYY-MM-DD, or a full timestamp with timezone. */
  lastmodValue: string;
  changefreq: Changefreq | 'none';
  priority: 'none' | 'fixed' | 'depth';
  priorityValue: number;
  removeDuplicates: boolean;
  /** Drop `#fragment` parts (fragments are ignored by crawlers). */
  stripFragments: boolean;
}

export interface SitemapEntry {
  loc: string;
  lastmod?: string;
  changefreq?: Changefreq;
  priority?: number;
}

export interface LineIssue {
  line: number;
  input: string;
  message: string;
  level: 'error' | 'warning';
}

export interface SitemapBuild {
  entries: SitemapEntry[];
  issues: LineIssue[];
  /** Problems affecting the whole file (limits, invalid options). */
  errors: string[];
  warnings: string[];
  xml: string;
  bytes: number;
}

/** Escapes the five XML special characters (required in <loc>). */
export function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!);
}

const W3C_DATE = /^\d{4}(-\d{2}(-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2}))?)?)?$/;

export function isValidW3cDate(value: string): boolean {
  const v = value.trim();
  if (!W3C_DATE.test(v)) return false;
  const [y, m = '01', d = '01'] = v.slice(0, 10).split('-');
  const date = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
  return date.getUTCFullYear() === Number(y) && date.getUTCMonth() === Number(m) - 1 && date.getUTCDate() === Number(d);
}

export function todayIso(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** Priority from URL depth: the home page gets 1.0, each level down 0.2 less, never below 0.1. */
export function depthPriority(url: URL): number {
  const depth = url.pathname.split('/').filter(Boolean).length;
  return Math.max(0.1, Math.round((1 - depth * 0.2) * 10) / 10);
}

/** 0.5 → "0.5", 1 → "1.0", 0.25 → "0.25" (at most two decimals). */
export function formatPriority(p: number): string {
  const r = Math.round(p * 100) / 100;
  return Number.isInteger(r * 10) ? r.toFixed(1) : r.toFixed(2);
}

export function buildSitemap(text: string, options: SitemapOptions): SitemapBuild {
  const issues: LineIssue[] = [];
  const errors: string[] = [];
  const warnings: string[] = [];

  let base: URL | null = null;
  if (options.baseUrl.trim()) {
    try {
      base = new URL(options.baseUrl.trim());
      if (!/^https?:$/.test(base.protocol)) {
        errors.push('The base URL must start with http:// or https://.');
        base = null;
      }
    } catch {
      errors.push('The base URL is not valid. Use an absolute URL such as https://example.com/.');
    }
  }
  const lastmod = options.lastmod === 'date' ? options.lastmodValue.trim() : '';
  if (options.lastmod === 'date' && !isValidW3cDate(lastmod)) {
    errors.push('The last-modified date must be a valid W3C date such as 2026-09-29 or 2026-09-29T10:00:00+00:00.');
  }
  const fixedPriority = options.priority === 'fixed' ? options.priorityValue : null;
  if (fixedPriority !== null && !(fixedPriority >= 0 && fixedPriority <= 1)) errors.push('Priority must be between 0.0 and 1.0.');

  const entries: SitemapEntry[] = [];
  const seen = new Set<string>();
  let host: string | null = null;
  const lines = text.split(/\r\n|\r|\n/);
  lines.forEach((raw, i) => {
    const line = i + 1;
    const input = raw.trim();
    if (!input || input.startsWith('#')) return;
    // The URL parser would silently delete tabs and encode spaces, turning "url<TAB>date" or two URLs on
    // one line into a single wrong URL.
    if (/\s/.test(input)) {
      issues.push({ line, input, level: 'error', message: 'Contains spaces or tabs. Put one URL per line and encode spaces as %20.' });
      return;
    }
    let url: URL;
    const absolute = /^[a-z][a-z0-9+.-]*:/i.test(input);
    try {
      if (!absolute && !base) throw new Error('relative');
      url = new URL(input, base ?? undefined);
    } catch {
      issues.push({
        line,
        input,
        level: 'error',
        message: absolute || base ? 'Not a valid URL.' : 'Relative URL. Enter a full URL, or set a base URL to resolve paths.',
      });
      return;
    }
    if (!/^https?:$/.test(url.protocol)) {
      issues.push({ line, input, level: 'error', message: 'Only http:// and https:// URLs belong in a sitemap.' });
      return;
    }
    if (options.stripFragments) url.hash = '';
    const loc = url.href;
    if (loc.length >= MAX_URL_LENGTH) {
      issues.push({ line, input, level: 'error', message: `${loc.length.toLocaleString('en-US')} characters long; sitemap URLs must be shorter than ${MAX_URL_LENGTH.toLocaleString('en-US')}.` });
      return;
    }
    if (seen.has(loc)) {
      if (options.removeDuplicates) {
        issues.push({ line, input, level: 'warning', message: 'Duplicate URL removed.' });
        return;
      }
      issues.push({ line, input, level: 'warning', message: 'Duplicate URL.' });
    }
    seen.add(loc);
    if (host === null) host = url.host;
    else if (url.host !== host) {
      issues.push({ line, input, level: 'warning', message: `Different host than ${host}. A sitemap should list URLs from one site only.` });
    }
    if (!options.stripFragments && url.hash) {
      issues.push({ line, input, level: 'warning', message: 'Contains a #fragment, which search engines ignore.' });
    }
    const entry: SitemapEntry = { loc };
    if (lastmod) entry.lastmod = lastmod;
    if (options.changefreq !== 'none') entry.changefreq = options.changefreq;
    if (options.priority === 'fixed' && fixedPriority !== null) entry.priority = fixedPriority;
    if (options.priority === 'depth') entry.priority = depthPriority(url);
    entries.push(entry);
  });

  if (entries.length > MAX_URLS) {
    errors.push(`A sitemap may hold at most ${MAX_URLS.toLocaleString('en-US')} URLs; this list has ${entries.length.toLocaleString('en-US')}. Split it into several sitemaps and list them in a sitemap index.`);
  }
  const xml = errors.length || !entries.length ? '' : toXml(entries);
  const bytes = new TextEncoder().encode(xml).length;
  if (bytes > MAX_BYTES) errors.push('The sitemap is larger than 50 MB uncompressed, the protocol limit. Split it into several files.');
  if (entries.some((e) => e.loc.startsWith('http:')) && entries.some((e) => e.loc.startsWith('https:'))) {
    warnings.push('The list mixes http:// and https:// URLs. Use the canonical scheme for every URL.');
  }
  return { entries, issues, errors, warnings, xml: errors.length ? '' : xml, bytes: errors.length ? 0 : bytes };
}

export function toXml(entries: SitemapEntry[]): string {
  const parts = ['<?xml version="1.0" encoding="UTF-8"?>', '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'];
  for (const e of entries) {
    parts.push('  <url>');
    parts.push(`    <loc>${escapeXml(e.loc)}</loc>`);
    if (e.lastmod) parts.push(`    <lastmod>${escapeXml(e.lastmod)}</lastmod>`);
    if (e.changefreq) parts.push(`    <changefreq>${e.changefreq}</changefreq>`);
    if (e.priority !== undefined) parts.push(`    <priority>${formatPriority(e.priority)}</priority>`);
    parts.push('  </url>');
  }
  parts.push('</urlset>');
  return `${parts.join('\n')}\n`;
}
