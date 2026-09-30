/**
 * Keeps previews of user-provided HTML (rendered Markdown) from contacting other
 * servers. Remote images, media and CSS `url()` references are neutralized until
 * the user explicitly chooses to load them, like a privacy-conscious mail client.
 *
 * Run it on HTML that is already sanitized (DOMPurify). Local sources (data:, blob:,
 * relative URLs on this origin) are left alone.
 */

import { t } from './i18n';

export interface RemoteContentResult {
  html: string;
  /** Number of remote references that were blocked. */
  blocked: number;
  /** Distinct host names that would have been contacted. */
  hosts: string[];
}

const REMOTE_URL = /^\s*(?:https?:)?\/\//i;
const CSS_REMOTE_URL = /url\(\s*(['"]?)\s*((?:https?:)?\/\/[^'")\s]+)\1\s*\)/gi;
/**
 * CSS that can fetch in ways a simple url() match cannot see reliably: @import, image-set(),
 * and escapes (e.g. `u\72l(` is `url(`). Styles containing these are removed outright.
 */
const CSS_FETCH_RISK = /@import|image-set\s*\(|\\/i;
const CSS_ANY_URL = /url\s*\(|@import/i;
const FIRST_URL = /(?:url\(\s*['"]?|@import\s+['"]|image-set\(\s*['"]?)\s*((?:https?:)?\/\/[^'")\s]+)/i;

function hostOf(url: string): string | null {
  if (!REMOTE_URL.test(url)) return null;
  try {
    return new URL(url.trim(), 'https://localkit.invalid').hostname || null;
  } catch {
    return null;
  }
}

export function blockRemoteContent(html: string): RemoteContentResult {
  if (!html || typeof document === 'undefined') return { html, blocked: 0, hosts: [] };
  // <template> content is inert: nothing is fetched while it is inspected here.
  const template = document.createElement('template');
  template.innerHTML = html;
  const root = template.content;
  const hosts = new Set<string>();
  let blocked = 0;
  const record = (url: string) => {
    blocked++;
    const host = hostOf(url);
    if (host) hosts.add(host);
  };

  for (const el of root.querySelectorAll<HTMLElement>('[src], [poster], [background], [srcset], [style]')) {
    for (const attr of ['src', 'poster', 'background'] as const) {
      const value = el.getAttribute(attr);
      if (value && REMOTE_URL.test(value)) {
        record(value);
        el.removeAttribute(attr);
        el.setAttribute(`data-lk-remote-${attr}`, value);
      }
    }
    const srcset = el.getAttribute('srcset');
    if (srcset) {
      const remote = srcset
        .split(',')
        .map((candidate) => candidate.trim().split(/\s+/)[0] ?? '')
        .filter((url) => REMOTE_URL.test(url));
      if (remote.length) {
        remote.forEach(record);
        el.removeAttribute('srcset');
        el.setAttribute('data-lk-remote-srcset', srcset);
      }
    }
    const style = el.getAttribute('style');
    if (style) {
      if (CSS_FETCH_RISK.test(style)) {
        // Cannot be neutralized reliably: drop the whole inline style.
        record(style.match(FIRST_URL)?.[1] ?? '');
        el.removeAttribute('style');
      } else {
        let found = false;
        const cleaned = style.replace(CSS_REMOTE_URL, (_match, _quote: string, url: string) => {
          found = true;
          record(url);
          return 'none';
        });
        if (found) el.setAttribute('style', cleaned);
      }
    }
  }

  // <style> elements that reference anything external (or hide it behind escapes) are removed.
  for (const styleEl of root.querySelectorAll('style')) {
    const css = styleEl.textContent ?? '';
    if (CSS_ANY_URL.test(css) || CSS_FETCH_RISK.test(css)) {
      record(css.match(FIRST_URL)?.[1] ?? '');
      styleEl.remove();
    }
  }

  // Blocked images become a labelled placeholder instead of a broken-image icon.
  for (const img of root.querySelectorAll<HTMLImageElement>('img[data-lk-remote-src]')) {
    const url = img.getAttribute('data-lk-remote-src') ?? '';
    const alt = img.getAttribute('alt')?.trim();
    const placeholder = document.createElement('span');
    placeholder.className = 'lk-remote-img';
    placeholder.setAttribute('role', 'img');
    const host = hostOf(url);
    placeholder.setAttribute('aria-label', `Remote image not loaded${alt ? `: ${alt}` : ''}`);
    placeholder.textContent = `${alt || 'Image'} (not loaded${host ? ` from ${host}` : ''})`;
    placeholder.title = url;
    img.replaceWith(placeholder);
  }

  return { html: template.innerHTML, blocked, hosts: [...hosts].sort() };
}

/** "cdn.example.com", "a.com and b.com", "a.com, b.com and 3 more". */
export function describeHosts(hosts: string[]): string {
  if (hosts.length === 0) return t('other servers');
  if (hosts.length === 1) return hosts[0]!;
  if (hosts.length <= 3) return t('{hosts} and {last}', { hosts: hosts.slice(0, -1).join(', '), last: hosts.at(-1)! });
  return t('{hosts} and {count} more', { hosts: hosts.slice(0, 2).join(', '), count: hosts.length - 2 });
}
