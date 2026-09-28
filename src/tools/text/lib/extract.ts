/* URL and e-mail extraction. */

const URL_RE = /\b(?:(?:https?|ftp):\/\/|www\.)[^\s<>"'`{}|\\^\u00a0\u3000]+/giu;

/** Trim trailing punctuation that is almost always sentence punctuation, keeping balanced brackets. */
export function trimUrl(url: string): string {
  let u = url;
  for (;;) {
    const last = u.slice(-1);
    if (/[.,;:!?*'"’”»]/.test(last)) {
      u = u.slice(0, -1);
      continue;
    }
    const pairs: Record<string, string> = { ')': '(', ']': '[', '}': '{' };
    if (pairs[last]) {
      const open = pairs[last];
      const opens = u.split(open).length - 1;
      const closes = u.split(last).length - 1;
      if (closes > opens) {
        u = u.slice(0, -1);
        continue;
      }
    }
    return u;
  }
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
  if (o.sort) urls = urls.slice().sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true }));
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
// "?email=john@example.com" in a URL yields "john@example.com".
const EMAIL_RE = /(?<![\p{L}\p{N}._%+-])[\p{L}\p{N}_%+-]+(?:\.[\p{L}\p{N}_%+-]+)*@(?:[\p{L}\p{N}](?:[\p{L}\p{N}-]*[\p{L}\p{N}])?\.)+[\p{L}]{2,63}(?![\p{L}\p{N}-])/gu;

export interface EmailExtractOptions {
  dedupe: boolean;
  lowercase: boolean;
  sort: boolean;
}

export const DEFAULT_EMAIL_OPTIONS: EmailExtractOptions = { dedupe: true, lowercase: true, sort: false };

export function findEmails(text: string): string[] {
  return Array.from(text.matchAll(EMAIL_RE), (m) => m[0]);
}

export function extractEmails(text: string, opts: Partial<EmailExtractOptions> = {}): string[] {
  const o = { ...DEFAULT_EMAIL_OPTIONS, ...opts };
  let emails = findEmails(text).map((e) => {
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
  if (o.sort) emails = emails.slice().sort((a, b) => a.localeCompare(b));
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
  return Array.from(groups, ([domain, list]) => ({ domain, emails: list })).sort(
    (a, b) => b.emails.length - a.emails.length || a.domain.localeCompare(b.domain),
  );
}
