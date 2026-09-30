import { countGraphemes, forEachGrapheme, words } from './common';

export const ENGLISH_STOP_WORDS = new Set(
  (
    'a about above after again against all am an and any are aren\'t as at be because been before being below between both but by ' +
    "can can't cannot could couldn't did didn't do does doesn't doing don't down during each few for from further had hadn't has " +
    "hasn't have haven't having he he'd he'll he's her here here's hers herself him himself his how how's i i'd i'll i'm i've if in " +
    "into is isn't it it's its itself let's me more most mustn't my myself no nor not of off on once only or other ought our ours " +
    "ourselves out over own same shan't she she'd she'll she's should shouldn't so some such than that that's the their theirs them " +
    "themselves then there there's these they they'd they'll they're they've this those through to too under until up very was " +
    "wasn't we we'd we'll we're we've were weren't what what's when when's where where's which while who who's whom why why's will " +
    "with won't would wouldn't you you'd you'll you're you've your yours yourself yourselves also just may might must shall us"
  ).split(' '),
);

export interface WordFrequencyOptions {
  excludeStopWords: boolean;
  minLength: number;
  caseFold: boolean;
  includeNumbers: boolean;
}

export const DEFAULT_WORD_FREQ_OPTIONS: WordFrequencyOptions = {
  excludeStopWords: true,
  minLength: 1,
  caseFold: true,
  includeNumbers: false,
};

export interface FrequencyRow {
  item: string;
  count: number;
  /** Share of all counted items, 0–100. */
  percent: number;
}

export interface FrequencyResult {
  rows: FrequencyRow[];
  total: number;
  unique: number;
}

let collator: Intl.Collator | null = null;

function toRows(counts: Map<string, number>, total: number): FrequencyRow[] {
  // One shared collator: String#localeCompare creates one per call, which is slow for big tables.
  collator ??= new Intl.Collator();
  const compare = collator.compare;
  return Array.from(counts, ([item, count]) => ({ item, count, percent: total ? (count / total) * 100 : 0 })).sort(
    (a, b) => b.count - a.count || compare(a.item, b.item),
  );
}

export function wordFrequency(text: string, opts: Partial<WordFrequencyOptions> = {}): FrequencyResult {
  const o = { ...DEFAULT_WORD_FREQ_OPTIONS, ...opts };
  // Count each distinct spelling once, then filter the (much smaller) set of distinct words.
  const raw = new Map<string, number>();
  for (const { word } of words(text)) raw.set(word, (raw.get(word) ?? 0) + 1);
  const counts = new Map<string, number>();
  let total = 0;
  for (const [rawWord, n] of raw) {
    const word = rawWord.includes('’') ? rawWord.replace(/’/g, "'") : rawWord;
    if (!o.includeNumbers && !/\p{L}/u.test(word)) continue;
    if (countGraphemes(word) < o.minLength) continue;
    const lower = word.toLowerCase();
    if (o.excludeStopWords && ENGLISH_STOP_WORDS.has(lower)) continue;
    const key = o.caseFold ? lower : word;
    counts.set(key, (counts.get(key) ?? 0) + n);
    total += n;
  }
  return { rows: toRows(counts, total), total, unique: counts.size };
}

export interface CharFrequencyOptions {
  includeWhitespace: boolean;
  caseFold: boolean;
  /** Letters and numbers only (skip punctuation and symbols). */
  lettersOnly: boolean;
}

export const DEFAULT_CHAR_FREQ_OPTIONS: CharFrequencyOptions = {
  includeWhitespace: false,
  caseFold: false,
  lettersOnly: false,
};

export function charFrequency(text: string, opts: Partial<CharFrequencyOptions> = {}): FrequencyResult {
  const o = { ...DEFAULT_CHAR_FREQ_OPTIONS, ...opts };
  // Count each distinct grapheme once, then filter the distinct set (texts reuse few characters).
  const raw = new Map<string, number>();
  forEachGrapheme(text, (g) => raw.set(g, (raw.get(g) ?? 0) + 1));
  const counts = new Map<string, number>();
  let total = 0;
  for (const [g, n] of raw) {
    if (!o.includeWhitespace && /^\s+$/u.test(g)) continue;
    if (o.lettersOnly && !/[\p{L}\p{N}]/u.test(g)) continue;
    const key = o.caseFold ? g.toLowerCase() : g;
    counts.set(key, (counts.get(key) ?? 0) + n);
    total += n;
  }
  return { rows: toRows(counts, total), total, unique: counts.size };
}

function csvField(value: string): string {
  return /[",\r\n]/.test(value) || /^\s|\s$/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function frequencyToCsv(rows: FrequencyRow[], header = 'item'): string {
  const lines = [`${header},count,percent`];
  for (const r of rows) lines.push(`${csvField(r.item)},${r.count},${r.percent.toFixed(2)}`);
  return lines.join('\r\n') + '\r\n';
}
