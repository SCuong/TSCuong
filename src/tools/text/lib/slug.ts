/** Letters that do not decompose under Unicode normalization but have common Latin spellings. */
const SPECIAL: Record<string, string> = {
  ß: 'ss', ẞ: 'SS', æ: 'ae', Æ: 'AE', œ: 'oe', Œ: 'OE', ø: 'o', Ø: 'O', ł: 'l', Ł: 'L', đ: 'd', Đ: 'D',
  ð: 'd', Ð: 'D', þ: 'th', Þ: 'TH', ı: 'i', ħ: 'h', Ħ: 'H', ŀ: 'l', Ŀ: 'L', ŧ: 't', Ŧ: 'T', ſ: 's', ĸ: 'k',
  ŉ: 'n', ŋ: 'ng', Ŋ: 'NG', ƒ: 'f',
};

const CYRILLIC: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'yo', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l',
  м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh',
  щ: 'shch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya', є: 'ye', і: 'i', ї: 'yi', ґ: 'g', ў: 'u',
};

const GREEK: Record<string, string> = {
  α: 'a', β: 'v', γ: 'g', δ: 'd', ε: 'e', ζ: 'z', η: 'i', θ: 'th', ι: 'i', κ: 'k', λ: 'l', μ: 'm', ν: 'n',
  ξ: 'x', ο: 'o', π: 'p', ρ: 'r', σ: 's', ς: 's', τ: 't', υ: 'y', φ: 'f', χ: 'ch', ψ: 'ps', ω: 'o',
};

const GERMAN: Record<string, string> = { ä: 'ae', ö: 'oe', ü: 'ue', Ä: 'Ae', Ö: 'Oe', Ü: 'Ue' };

const SYMBOLS: Record<string, string> = { '&': ' and ', '@': ' at ', '%': ' percent ', '+': ' plus ', '€': ' euro ', $: ' dollar ', '£': ' pound ' };

function mapScript(ch: string, table: Record<string, string>): string | undefined {
  const lower = ch.toLowerCase();
  const mapped = table[lower];
  if (mapped === undefined) return undefined;
  if (ch !== lower && mapped) return mapped.charAt(0).toUpperCase() + mapped.slice(1);
  return mapped;
}

export interface TransliterateOptions {
  germanUmlauts?: boolean;
  symbols?: boolean;
}

/** Convert accented and non-Latin letters to ASCII approximations where there is a common spelling. */
export function transliterate(text: string, options: TransliterateOptions = {}): string {
  let out = '';
  for (const ch of text.normalize('NFC')) {
    if (options.germanUmlauts && GERMAN[ch]) {
      out += GERMAN[ch];
      continue;
    }
    if (options.symbols && SYMBOLS[ch]) {
      out += SYMBOLS[ch];
      continue;
    }
    const special = SPECIAL[ch] ?? mapScript(ch, CYRILLIC) ?? mapScript(ch.normalize('NFD').replace(/\p{Mn}/gu, ''), GREEK);
    if (special !== undefined) {
      out += special;
      continue;
    }
    out += ch.normalize('NFKD').replace(/\p{Mn}/gu, '');
  }
  return out;
}

export interface SlugOptions {
  separator: string;
  lowercase: boolean;
  /** 0 or less = unlimited. Truncates at a word boundary when possible. */
  maxLength: number;
  transliterate: boolean;
  /** Keep letters outside ASCII (e.g. CJK) instead of dropping them. */
  keepUnicode: boolean;
  germanUmlauts: boolean;
  symbols: boolean;
}

export const DEFAULT_SLUG_OPTIONS: SlugOptions = {
  separator: '-',
  lowercase: true,
  maxLength: 0,
  transliterate: true,
  keepUnicode: false,
  germanUmlauts: false,
  symbols: true,
};

export function slugify(input: string, opts: Partial<SlugOptions> = {}): string {
  const o = { ...DEFAULT_SLUG_OPTIONS, ...opts };
  let text = o.transliterate ? transliterate(input, { germanUmlauts: o.germanUmlauts, symbols: o.symbols }) : input.normalize('NFC');
  // Apostrophes inside words vanish ("don't" → "dont") instead of splitting the word.
  text = text.replace(/(\p{L})['’](\p{L})/gu, '$1$2');
  const wordRe = o.keepUnicode ? /[\p{L}\p{N}\p{M}]+/gu : /[A-Za-z0-9]+/g;
  let parts: string[] = text.match(wordRe) ?? [];
  if (o.lowercase) parts = parts.map((p) => p.toLowerCase());
  const sep = o.separator;
  let slug = parts.join(sep);
  if (o.maxLength > 0 && slug.length > o.maxLength) {
    const chars = Array.from(slug);
    if (chars.length > o.maxLength) {
      let cut = chars.slice(0, o.maxLength).join('');
      const nextStartsWithSep = sep && slug.slice(cut.length).startsWith(sep);
      if (sep && !nextStartsWithSep && cut.includes(sep)) {
        // Avoid cutting a word in half when a shorter clean cut exists.
        cut = cut.slice(0, cut.lastIndexOf(sep));
      }
      while (sep && cut.endsWith(sep)) cut = cut.slice(0, -sep.length);
      slug = cut;
    }
  }
  return slug;
}

/** Slugify each non-empty line; empty lines stay empty so line numbers keep matching. */
export function slugifyLines(input: string, opts: Partial<SlugOptions> = {}): string {
  return input
    .split(/\r\n|\r|\n/)
    .map((line) => (line.trim() ? slugify(line, opts) : ''))
    .join('\n');
}
