import { hostnameToUnicode } from './urlPunycode';

// Meta tag generation for SEO, Open Graph and Twitter/X cards.

export interface MetaInput {
  title: string;
  description: string;
  /** Canonical page URL; also used for og:url. */
  url: string;
  siteName: string;
  image: string;
  imageAlt: string;
  locale: string;
  ogType: 'website' | 'article' | 'product' | 'profile';
  twitterCard: 'summary' | 'summary_large_image';
  twitterSite: string;
  twitterCreator: string;
  robotsIndex: boolean;
  robotsFollow: boolean;
  /** Allow large image previews in search results (max-image-preview:large). */
  largeImagePreview: boolean;
  themeColor: string;
  includeCharset: boolean;
  includeViewport: boolean;
  includeCanonical: boolean;
  includeOpenGraph: boolean;
  includeTwitter: boolean;
}

export const DEFAULT_META: MetaInput = {
  title: 'Trail Running Shoes for Every Terrain | Northfield',
  description:
    'Compare lightweight trail running shoes with grippy outsoles, rock plates and waterproof options. Free returns within 60 days and expert fit advice.',
  url: 'https://www.example.com/shoes/trail-running',
  siteName: 'Northfield Outfitters',
  image: '',
  imageAlt: '',
  locale: 'en_US',
  ogType: 'website',
  twitterCard: 'summary_large_image',
  twitterSite: '',
  twitterCreator: '',
  robotsIndex: true,
  robotsFollow: true,
  largeImagePreview: true,
  themeColor: '#1f6f50',
  includeCharset: true,
  includeViewport: true,
  includeCanonical: true,
  includeOpenGraph: true,
  includeTwitter: true,
};

export interface LengthGuide {
  /** Below this, the text is probably too short to be useful. */
  min: number;
  /** Above this, it is likely truncated. */
  max: number;
}

/** Common guidance (search engines truncate by pixel width, so these are approximations). */
export const LENGTHS = {
  title: { min: 30, max: 60 },
  description: { min: 70, max: 160 },
} satisfies Record<string, LengthGuide>;

export type LengthStatus = 'empty' | 'short' | 'good' | 'long';

/** Counts user-perceived characters (emoji and combining marks count once). */
export function charCount(text: string): number {
  if (typeof Intl !== 'undefined' && 'Segmenter' in Intl) {
    return Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)).length;
  }
  return Array.from(text).length;
}

export function lengthStatus(text: string, guide: LengthGuide): LengthStatus {
  const n = charCount(text.trim());
  if (n === 0) return 'empty';
  if (n < guide.min) return 'short';
  if (n > guide.max) return 'long';
  return 'good';
}

/** Escapes a value for use inside a double-quoted HTML attribute. */
export function escapeAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function escapeText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const clean = (s: string) => s.replace(/\s+/g, ' ').trim();

/** Normalizes a Twitter/X handle to "@name", or '' if empty. */
export function normalizeHandle(value: string): string {
  const v = value.trim().replace(/^https?:\/\/(www\.)?(twitter|x)\.com\//i, '').replace(/^@+/, '').replace(/[/?#].*$/, '');
  return v ? `@${v}` : '';
}

export function isAbsoluteHttpUrl(value: string): boolean {
  try {
    const u = new URL(value.trim());
    return (u.protocol === 'http:' || u.protocol === 'https:') && Boolean(u.hostname);
  } catch {
    return false;
  }
}

const HEX = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const FUNC = /^(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\([^()]*\)$/i;

/** Accepts hex, functional notations and named colors (validated by the browser when available). */
export function isValidColor(value: string): boolean {
  const v = value.trim();
  if (!v) return false;
  if (typeof CSS !== 'undefined' && typeof CSS.supports === 'function') return CSS.supports('color', v);
  return HEX.test(v) || FUNC.test(v) || /^[a-z]+$/i.test(v);
}

export interface MetaIssue {
  field: keyof MetaInput;
  level: 'error' | 'warning';
  message: string;
}

export function validateMeta(m: MetaInput): MetaIssue[] {
  const issues: MetaIssue[] = [];
  if (!clean(m.title)) issues.push({ field: 'title', level: 'warning', message: 'Add a title: it is the headline of search results and link previews.' });
  if (!clean(m.description)) issues.push({ field: 'description', level: 'warning', message: 'Add a description so search engines and social apps can show a summary.' });
  if (m.url.trim() && !isAbsoluteHttpUrl(m.url)) issues.push({ field: 'url', level: 'error', message: 'The page URL must be absolute, e.g. https://example.com/page.' });
  if (!m.url.trim() && (m.includeCanonical || m.includeOpenGraph)) {
    issues.push({ field: 'url', level: 'warning', message: 'Add the page URL for the canonical link and og:url.' });
  }
  if (m.image.trim() && !isAbsoluteHttpUrl(m.image)) issues.push({ field: 'image', level: 'error', message: 'The image URL must be absolute (http or https); relative URLs do not work in social previews.' });
  if (m.image.trim() && !m.imageAlt.trim()) issues.push({ field: 'imageAlt', level: 'warning', message: 'Describe the image for people using screen readers.' });
  if (m.themeColor.trim() && !isValidColor(m.themeColor)) issues.push({ field: 'themeColor', level: 'error', message: 'Enter a CSS color such as #1f6f50 or rgb(31 111 80).' });
  if (m.locale.trim() && !/^[a-z]{2,3}_[A-Z]{2}$/.test(m.locale.trim())) issues.push({ field: 'locale', level: 'warning', message: 'Open Graph locales look like en_US or fr_FR.' });
  for (const field of ['twitterSite', 'twitterCreator'] as const) {
    const h = normalizeHandle(m[field]);
    if (h && !/^@\w{1,15}$/.test(h)) issues.push({ field, level: 'warning', message: 'X handles are up to 15 letters, digits or underscores.' });
  }
  return issues;
}

/** Generates the <head> meta tags. Empty fields are omitted. */
export function generateMetaTags(m: MetaInput): string {
  const lines: string[] = [];
  const title = clean(m.title);
  const description = clean(m.description);
  const url = m.url.trim();
  const image = m.image.trim();
  const imageAlt = clean(m.imageAlt);
  const meta = (attr: 'name' | 'property', key: string, value: string) => lines.push(`<meta ${attr}="${key}" content="${escapeAttr(value)}" />`);

  if (m.includeCharset) lines.push('<meta charset="utf-8" />');
  if (m.includeViewport) lines.push('<meta name="viewport" content="width=device-width, initial-scale=1" />');
  if (title) lines.push(`<title>${escapeText(title)}</title>`);
  if (description) meta('name', 'description', description);
  const robots = [m.robotsIndex ? 'index' : 'noindex', m.robotsFollow ? 'follow' : 'nofollow'];
  if (m.robotsIndex && m.largeImagePreview) robots.push('max-image-preview:large');
  // "index, follow" is the default; only emit the tag when it says something.
  if (!m.robotsIndex || !m.robotsFollow || robots.length > 2) meta('name', 'robots', robots.join(', '));
  if (m.includeCanonical && url) lines.push(`<link rel="canonical" href="${escapeAttr(url)}" />`);
  if (m.themeColor.trim()) meta('name', 'theme-color', m.themeColor.trim());

  if (m.includeOpenGraph) {
    lines.push('');
    lines.push('<!-- Open Graph -->');
    meta('property', 'og:type', m.ogType);
    if (title) meta('property', 'og:title', title);
    if (description) meta('property', 'og:description', description);
    if (url) meta('property', 'og:url', url);
    if (clean(m.siteName)) meta('property', 'og:site_name', clean(m.siteName));
    if (m.locale.trim()) meta('property', 'og:locale', m.locale.trim());
    if (image) {
      meta('property', 'og:image', image);
      if (imageAlt) meta('property', 'og:image:alt', imageAlt);
    }
  }

  if (m.includeTwitter) {
    lines.push('');
    lines.push('<!-- Twitter / X -->');
    meta('name', 'twitter:card', image ? m.twitterCard : 'summary');
    const site = normalizeHandle(m.twitterSite);
    const creator = normalizeHandle(m.twitterCreator);
    if (site) meta('name', 'twitter:site', site);
    if (creator) meta('name', 'twitter:creator', creator);
    // X falls back to og:title/og:description/og:image, so only repeat them when Open Graph is off.
    if (!m.includeOpenGraph) {
      if (title) meta('name', 'twitter:title', title);
      if (description) meta('name', 'twitter:description', description);
      if (image) meta('name', 'twitter:image', image);
      if (image && imageAlt) meta('name', 'twitter:image:alt', imageAlt);
    } else if (image && imageAlt) {
      meta('name', 'twitter:image:alt', imageAlt);
    }
  }

  while (lines.length && lines[0] === '') lines.shift();
  return lines.join('\n');
}

/** Cuts text to `max` characters at a word boundary and adds an ellipsis. */
export function truncate(text: string, max: number): string {
  const t = clean(text);
  const chars = Array.from(t);
  if (chars.length <= max) return t;
  const cut = chars.slice(0, max).join('');
  const space = cut.lastIndexOf(' ');
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,.;:–—-]+$/, '')}…`;
}

/** "example.com › shoes › trail-running" style breadcrumb for search previews. */
export function breadcrumbUrl(url: string): { host: string; path: string[] } | null {
  try {
    const u = new URL(url.trim());
    if (!/^https?:$/.test(u.protocol)) return null;
    const path = u.pathname
      .split('/')
      .filter(Boolean)
      .map((s) => {
        try {
          return decodeURIComponent(s);
        } catch {
          return s;
        }
      });
    return { host: hostnameToUnicode(u.hostname).replace(/^www\./, ''), path };
  } catch {
    return null;
  }
}

export function displayHost(url: string): string {
  return breadcrumbUrl(url)?.host ?? '';
}
