/** Pure text outputs for the favicon generator: web manifest and HTML tags. */

export interface ManifestOptions {
  name: string;
  shortName: string;
  themeColor: string;
  backgroundColor: string;
  path: string;
}

export const FAVICON_FILES = {
  ico: 'favicon.ico',
  png16: 'favicon-16x16.png',
  png32: 'favicon-32x32.png',
  apple: 'apple-touch-icon.png',
  android192: 'android-chrome-192x192.png',
  android512: 'android-chrome-512x512.png',
  maskable: 'maskable-icon-512x512.png',
  svg: 'favicon.svg',
  manifest: 'site.webmanifest',
} as const;

/** Normalize a URL path prefix: "" → "/", "icons" → "/icons/". */
export function normalizePath(path: string): string {
  let p = path.trim();
  if (!p) return '/';
  if (/^https?:\/\//i.test(p)) return p.endsWith('/') ? p : `${p}/`;
  if (!p.startsWith('/')) p = `/${p}`;
  if (!p.endsWith('/')) p = `${p}/`;
  return p.replace(/\/{2,}/g, '/');
}

export function buildManifest(o: ManifestOptions): string {
  const base = normalizePath(o.path);
  return JSON.stringify(
    {
      name: o.name || 'My site',
      short_name: o.shortName || o.name || 'Site',
      icons: [
        { src: `${base}${FAVICON_FILES.android192}`, sizes: '192x192', type: 'image/png' },
        { src: `${base}${FAVICON_FILES.android512}`, sizes: '512x512', type: 'image/png' },
        { src: `${base}${FAVICON_FILES.maskable}`, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      ],
      theme_color: o.themeColor,
      background_color: o.backgroundColor,
      display: 'standalone',
    },
    null,
    2,
  );
}

const escapeAttr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

export function buildHtml(o: { path: string; themeColor: string; hasSvg: boolean }): string {
  const base = normalizePath(o.path);
  const lines = [
    `<link rel="icon" href="${base}${FAVICON_FILES.ico}" sizes="48x48">`,
    ...(o.hasSvg ? [`<link rel="icon" href="${base}${FAVICON_FILES.svg}" type="image/svg+xml">`] : []),
    `<link rel="icon" type="image/png" sizes="32x32" href="${base}${FAVICON_FILES.png32}">`,
    `<link rel="icon" type="image/png" sizes="16x16" href="${base}${FAVICON_FILES.png16}">`,
    `<link rel="apple-touch-icon" sizes="180x180" href="${base}${FAVICON_FILES.apple}">`,
    `<link rel="manifest" href="${base}${FAVICON_FILES.manifest}">`,
    `<meta name="theme-color" content="${escapeAttr(o.themeColor)}">`,
  ];
  return lines.join('\n');
}

function graphemes(text: string): string[] {
  const Seg = (Intl as unknown as { Segmenter?: new (l?: string, o?: { granularity: string }) => { segment(s: string): Iterable<{ segment: string }> } }).Segmenter;
  return Seg ? Array.from(new Seg(undefined, { granularity: 'grapheme' }).segment(text), (s) => s.segment) : Array.from(text);
}

/** Up to 3 visible characters for a letter mark (grapheme-aware). */
export function letterMarkText(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return '';
  return graphemes(trimmed).slice(0, 3).join('');
}

/**
 * The manifest `short_name` (shown under home-screen icons): at most 12 visible
 * characters, never splitting an emoji or accented letter, without trailing spaces.
 */
export function shortNameFor(name: string, max = 12): string {
  return graphemes(name.trim()).slice(0, max).join('').trim();
}
