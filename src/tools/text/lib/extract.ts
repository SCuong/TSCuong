/* URL and e-mail extraction. */

// A link ends at whitespace, quotes and angle brackets, and at CJK / full-width punctuation
// (、。〈〉《》「」『』【】！（），：；？), which is never part of a URL written in running text.
const URL_RE =
  /\b(?:(?:https?|ftp):\/\/|www\.)[^\s<>"'`{}|\\^\u00a0\u3000\u3001\u3002\u3008-\u3011\uff01\uff08\uff09\uff0c\uff1a\uff1b\uff1f]+/giu;

/** Sentence punctuation that is almost never the last character of a real URL. */
const TRAILING_PUNCTUATION = new Set([...'.,;:!?*\'"’”»…']);
const CLOSERS: Record<string, string> = { ')': '(', ']': '[', '}': '{' };

/** Trim trailing punctuation that is almost always sentence punctuation, keeping balanced brackets. */
export function trimUrl(url: string): string {
  const counts: Record<string, number> = { '(': 0, ')': 0, '[': 0, ']': 0, '{': 0, '}': 0 };
  for (let i = 0; i < url.length; i++) {
    const ch = url[i];
    if (ch in counts) counts[ch]++;
  }
  let end = url.length;
  while (end > 0) {
    const last = url[end - 1];
    if (TRAILING_PUNCTUATION.has(last)) {
      end--;
      continue;
    }
    const open = CLOSERS[last];
    if (open && counts[last] > counts[open]) {
      counts[last]--;
      end--;
      continue;
    }
    break;
  }
  return url.slice(0, end);
}

export interface UrlExtractOptions {
  dedupe: boolean;
  sort: boolean;
  /** Add "https://" to links that start with "www.". */
  addProtocol: boolean;
  protocols: { http: boolean; ftp: boolean; www: boolean };
}

export const DEFAULT_URL_OPTIONS: UrlExtractOptions = {
  dedupe: true,
  sort: false,
  addProtocol: true,
  protocols: { http: true, ftp: true, www: true },
};

export interface UrlMatch {
  url: string;
  index: number;
}

export function findUrls(text: string): UrlMatch[] {
  const out: UrlMatch[] = [];
  for (const m of text.matchAll(URL_RE)) {
    const url = trimUrl(m[0]);
    // Needs something after the scheme or "www." to be a link.
    if (/^(?:(?:https?|ftp):\/\/|www\.)$/i.test(url)) continue;
    if (/^www\.[^.]*$/i.test(url)) continue;
    out.push({ url, index: m.index ?? 0 });
  }
  return out;
}

export function extractUrls(text: string, opts: Partial<UrlExtractOptions> = {}): string[] {
  const o = { ...DEFAULT_URL_OPTIONS, ...opts, protocols: { ...DEFAULT_URL_OPTIONS.protocols, ...opts.protocols } };
  let urls = findUrls(text)
    .map((m) => m.url)
    .filter((u) => {
      if (/^https?:/i.test(u)) return o.protocols.http;
      if (/^ftp:/i.test(u)) return o.protocols.ftp;
      return o.protocols.www;
    })
    .map((u) => (o.addProtocol && /^www\./i.test(u) ? `https://${u}` : u));
  if (o.dedupe) {
    const seen = new Set<string>();
    urls = urls.filter((u) => {
      const key = u.replace(/^[a-z]+:\/\/[^/?#]+/i, (host) => host.toLowerCase());
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
  if (o.sort) {
    const compare = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true }).compare;
    urls = urls.slice().sort(compare);
  }
  return urls;
}

export function urlHost(url: string): string {
  try {
    return new URL(/^www\./i.test(url) ? `https://${url}` : url).hostname;
  } catch {
    return '';
  }
}

/* ------------------------------------------------------------------------ */

// Practical address syntax: the rarely used local-part symbols (!#$/=?...) are excluded so that
// "?email=john@example.com" in a URL yields "john@example.com". Letters may carry combining
// accents (a decomposed "é"), a quoted local part ("john doe"@example.com) is accepted, and the
// top-level domain is letters or an internationalized one in Punycode (xn--p1ai).
const EMAIL_RE = new RegExp(
  String.raw`(?:"(?:[^"\\\r\n]|\\.){1,64}"|(?<![\p{L}\p{N}\p{M}._%+-])[\p{L}\p{N}\p{M}_%+-]+(?:\.[\p{L}\p{N}\p{M}_%+-]+)*)` +
    String.raw`@(?:[\p{L}\p{N}](?:[\p{L}\p{N}\p{M}-]*[\p{L}\p{N}\p{M}])?\.)+` +
    String.raw`(?:\p{L}[\p{L}\p{M}]{1,62}|[xX][nN]--[a-zA-Z0-9-]{1,59})(?![\p{L}\p{N}\p{M}-])`,
  'gu',
);

export interface EmailExtractOptions {
  dedupe: boolean;
  lowercase: boolean;
  sort: boolean;
}

export const DEFAULT_EMAIL_OPTIONS: EmailExtractOptions = { dedupe: true, lowercase: true, sort: false };

export function findEmails(text: string): string[] {
  return Array.from(text.matchAll(EMAIL_RE), (m) => m[0].normalize('NFC'));
}

export function extractEmails(text: string, opts: Partial<EmailExtractOptions> = {}): string[] {
  return processEmails(findEmails(text), opts);
}

function processEmails(found: string[], opts: Partial<EmailExtractOptions>): string[] {
  const o = { ...DEFAULT_EMAIL_OPTIONS, ...opts };
  let emails = found.map((e) => {
    if (o.lowercase) return e.toLowerCase();
    // Domains are case-insensitive: normalize them even when keeping the local part.
    const at = e.lastIndexOf('@');
    return e.slice(0, at + 1) + e.slice(at + 1).toLowerCase();
  });
  if (o.dedupe) {
    const seen = new Set<string>();
    emails = emails.filter((e) => {
      const key = e.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
  if (o.sort) emails = emails.slice().sort(new Intl.Collator().compare);
  return emails;
}

export function groupByDomain(emails: string[]): Array<{ domain: string; emails: string[] }> {
  const groups = new Map<string, string[]>();
  for (const e of emails) {
    const domain = e.slice(e.lastIndexOf('@') + 1).toLowerCase();
    const list = groups.get(domain);
    if (list) list.push(e);
    else groups.set(domain, [e]);
  }
  const compare = new Intl.Collator().compare;
  return Array.from(groups, ([domain, list]) => ({ domain, emails: list })).sort(
    (a, b) => b.emails.length - a.emails.length || compare(a.domain, b.domain),
  );
}

export interface EmailReport {
  emails: string[];
  groups: Array<{ domain: string; emails: string[] }>;
  /** Addresses found before de-duplication and the domain filter. */
  found: number;
}

/** Everything the E-mail Extractor shows, in one pass (runs in a worker for large texts). */
export function emailReport(text: string, opts: Partial<EmailExtractOptions>, domainFilter: string): EmailReport {
  const found = findEmails(text);
  const all = processEmails(found, opts);
  const filter = domainFilter.trim().toLowerCase().replace(/^@/, '');
  const emails = filter ? all.filter((e) => e.slice(e.lastIndexOf('@') + 1).toLowerCase().includes(filter)) : all;
  return { emails, groups: groupByDomain(emails), found: found.length };
}
