/**
 * Deterministic fuzzy search for the tool registry.
 *
 * The registry is small (a few hundred entries at most), so a straightforward
 * scored scan is fast (< 1ms) and far easier to reason about than a generic
 * index. Every query token must match some field of a document (AND
 * semantics). A token can match exactly, as a prefix, as a substring, via a
 * synonym, or within a small edit distance (typos).
 */

export interface SearchDoc {
  id: string;
  name: string;
  description: string;
  category: string;
  keywords: string[];
  aliases?: string[];
  /** Tie-breaking prior for a family's flagship tool (see ToolDefinition.priority). */
  priority?: number;
}

export interface SearchResult<T extends SearchDoc> {
  item: T;
  score: number;
}

const STOP_WORDS = new Set([
  'a',
  'an',
  'the',
  'to',
  'into',
  'in',
  'of',
  'for',
  'my',
  'and',
  'from',
  'with',
  'i',
  'want',
  'how',
  'do',
  'online',
  'tool',
  'tools',
  'free',
  'me',
  'some',
  'on',
  'as',
]);

/** Common words people type mapped to the vocabulary used in tool metadata. */
const SYNONYMS: Record<string, string[]> = {
  picture: ['image', 'photo'],
  pictures: ['image', 'photo'],
  photo: ['image'],
  photos: ['image'],
  pic: ['image'],
  pics: ['image'],
  img: ['image'],
  jpg: ['jpeg'],
  jpeg: ['jpg'],
  shrink: ['compress', 'reduce'],
  reduce: ['compress'],
  smaller: ['compress'],
  optimise: ['optimize', 'compress'],
  optimize: ['compress'],
  combine: ['merge', 'join'],
  join: ['merge'],
  remove: ['delete', 'strip'],
  delete: ['remove'],
  erase: ['remove', 'delete'],
  cut: ['split', 'crop'],
  beautify: ['format', 'pretty'],
  prettify: ['format', 'pretty'],
  pretty: ['format'],
  indent: ['format'],
  uglify: ['minify'],
  compact: ['minify'],
  compare: ['diff'],
  difference: ['diff'],
  differences: ['diff'],
  checker: ['validate', 'validator'],
  check: ['validate', 'verify'],
  lint: ['validate'],
  convert: ['converter', 'to'],
  converter: ['convert'],
  decrypt: ['decode', 'encrypt'],
  hash: ['checksum', 'digest'],
  checksum: ['hash'],
  password: ['passphrase'],
  random: ['generate', 'generator'],
  generate: ['generator'],
  make: ['generate', 'create', 'generator'],
  create: ['generate', 'generator'],
  time: ['timestamp', 'date'],
  epoch: ['timestamp', 'unix'],
  unix: ['timestamp', 'epoch'],
  diagram: ['mermaid', 'flowchart'],
  chart: ['diagram', 'mermaid'],
  flowchart: ['mermaid', 'diagram'],
  notes: ['markdown', 'note'],
  note: ['markdown'],
  md: ['markdown'],
  db: ['database', 'sqlite'],
  database: ['sqlite', 'sql'],
  spreadsheet: ['excel', 'xlsx', 'csv'],
  excel: ['xlsx', 'spreadsheet'],
  http: ['api', 'request'],
  rest: ['api', 'http'],
  postman: ['api', 'request'],
  curl: ['api', 'request'],
  scan: ['read', 'reader', 'ocr'],
  scanner: ['reader', 'scan'],
  ocr: ['text', 'recognize'],
  colour: ['color'],
  colours: ['color'],
  grey: ['gray'],
  grayscale: ['greyscale'],
  words: ['word'],
  count: ['counter'],
  counter: ['count'],
  guid: ['uuid'],
  uuid: ['guid'],
  token: ['jwt'],
  regexp: ['regex'],
  regular: ['regex'],
  expression: ['regex'],
  subnet: ['cidr', 'ip'],
  ipv4: ['ip'],
  ipv6: ['ip'],
  yml: ['yaml'],
  txt: ['text'],
  favicon: ['icon'],
  icons: ['icon', 'favicon'],
  barcode: ['qr'],
  pages: ['page'],
  // Vietnamese (without diacritics, as normalize() leaves them).
  hinh: ['anh', 'image'],
  tep: ['file'],
  giam: ['nen', 'compress'],
  ghep: ['gop', 'merge'],
  noi: ['gop', 'merge'],
  tach: ['chia', 'split'],
  chia: ['tach', 'split'],
  xoay: ['rotate'],
  doi: ['chuyen', 'convert'],
  chuyen: ['doi', 'convert'],
  sang: ['to'],
  thanh: ['sang', 'to'],
  kiem: ['check', 'validate'],
};

export function normalize(text: string): string {
  return text
    .toLowerCase()
    // NFKD does not decompose the Vietnamese letter đ.
    .replace(/đ/g, 'd')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/→|->|=>/g, ' to ')
    .replace(/[^a-z0-9+#.]+/g, ' ')
    .replace(/(^|\s)\.+|\.+(\s|$)/g, ' ')
    .trim();
}

export function tokenize(text: string): string[] {
  const words = normalize(text).split(/\s+/).filter(Boolean);
  const meaningful = words.filter((w) => !STOP_WORDS.has(w));
  // "to" alone or queries made only of stop words still deserve a search.
  return meaningful.length > 0 ? meaningful : words;
}

/** Optimal string alignment distance with an early exit once `max` is exceeded. */
export function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const rows = a.length + 1;
  const cols = b.length + 1;
  let prevPrev: number[] = [];
  let prev = Array.from({ length: cols }, (_, j) => j);
  for (let i = 1; i < rows; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let value = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        value = Math.min(value, prevPrev[j - 2] + 1);
      }
      cur.push(value);
      if (value < rowMin) rowMin = value;
    }
    if (rowMin > max) return max + 1;
    prevPrev = prev;
    prev = cur;
  }
  return prev[cols - 1];
}

/** Minimal English plural folding for search tokens (not a general stemmer). */
export function singularize(word: string): string {
  if (word.length < 4 || !word.endsWith('s') || word.endsWith('ss') || word.endsWith('us') || word.endsWith('is')) return word;
  if (word.endsWith('ies') && word.length > 4) return `${word.slice(0, -3)}y`;
  if (/(?:ch|sh|x|z)es$/.test(word)) return word.slice(0, -2);
  return word.slice(0, -1);
}

interface Field {
  words: string[];
  text: string;
  weight: number;
}

interface IndexedDoc<T extends SearchDoc> {
  item: T;
  fields: Field[];
  nameText: string;
  phrases: string[];
}

const FIELD_WEIGHTS = { name: 10, alias: 8, keyword: 6, category: 3, description: 1.5 };

function field(text: string, weight: number): Field {
  const normalized = normalize(text);
  return { text: normalized, words: normalized.split(/\s+/).filter(Boolean), weight };
}

/** Score how well one query token matches one field (0 = no match). */
function matchToken(token: string, f: Field): number {
  let best = 0;
  for (const word of f.words) {
    let s = 0;
    if (word === token) s = 1;
    else if (word.startsWith(token)) s = token.length >= 2 ? 0.8 : 0.45;
    else if (token.length >= 3 && word.includes(token)) s = 0.5;
    else if (token.length >= 4 && token.startsWith(word) && word.length >= 3) s = 0.55;
    else if (token.length >= 4 && word.length >= 4) {
      const maxDist = token.length >= 7 ? 2 : 1;
      const d = editDistance(token, word.slice(0, Math.max(word.length, token.length)), maxDist);
      if (d <= maxDist) s = 0.4 - d * 0.08;
      else if (word.length > token.length) {
        // Typo inside a prefix, e.g. "formatr" -> "formatter".
        const dp = editDistance(token, word.slice(0, token.length), 1);
        if (dp <= 1) s = 0.35;
      }
    }
    if (s > best) best = s;
    if (best === 1) break;
  }
  return best * f.weight;
}

/**
 * `translate` gives the name and description in the interface language; both languages are
 * indexed, so English terms keep working in a translated interface.
 */
export function createSearchIndex<T extends SearchDoc>(
  items: T[],
  categoryName: (id: string) => string,
  translate: (text: string) => string = (text) => text,
) {
  const docs: IndexedDoc<T>[] = items.map((item) => {
    const localName = translate(item.name);
    const localDescription = translate(item.description);
    const fields: Field[] = [
      field(item.name, FIELD_WEIGHTS.name),
      ...(localName !== item.name ? [field(localName, FIELD_WEIGHTS.name)] : []),
      ...(item.aliases ?? []).map((a) => field(a, FIELD_WEIGHTS.alias)),
      field(item.keywords.join(' '), FIELD_WEIGHTS.keyword),
      field(`${categoryName(item.category)} ${item.category}`, FIELD_WEIGHTS.category),
      field(localDescription === item.description ? item.description : `${localDescription} ${item.description}`, FIELD_WEIGHTS.description),
    ];
    return {
      item,
      fields,
      nameText: normalize(localName),
      phrases: [item.name, ...(localName !== item.name ? [localName] : []), ...(item.aliases ?? [])].map(normalize),
    };
  });

  function scoreToken(token: string, doc: IndexedDoc<T>): number {
    let best = 0;
    for (const f of doc.fields) {
      const s = matchToken(token, f);
      if (s > best) best = s;
    }
    // Plural folding: "images", "pdfs", "files" also match "image", "pdf", "file".
    const singular = singularize(token);
    if (singular !== token) {
      for (const f of doc.fields) {
        const s = matchToken(singular, f) * 0.95;
        if (s > best) best = s;
      }
    }
    const synonyms = SYNONYMS[token];
    if (synonyms) {
      for (const syn of synonyms) {
        for (const f of doc.fields) {
          const s = matchToken(syn, f) * 0.85;
          if (s > best) best = s;
        }
      }
    }
    return best;
  }

  function search(query: string, limit = 50): SearchResult<T>[] {
    const tokens = tokenize(query);
    if (tokens.length === 0) return [];
    const normalizedQuery = normalize(query);
    const results: SearchResult<T>[] = [];

    for (const doc of docs) {
      let total = 0;
      let matched = 0;
      for (const token of tokens) {
        const s = scoreToken(token, doc);
        if (s > 0) {
          matched++;
          total += s;
        }
      }
      // AND semantics, but tolerate one unmatched word in longer natural-language queries.
      const required = tokens.length >= 3 ? tokens.length - 1 : tokens.length;
      if (matched < required) continue;
      total *= matched / tokens.length;

      // Whole-phrase bonuses: exact name, name prefix, alias phrase.
      if (doc.nameText === normalizedQuery) total += 30;
      else if (doc.nameText.startsWith(normalizedQuery)) total += 12;
      else if (doc.phrases.some((p) => p === normalizedQuery)) total += 20;
      else if (normalizedQuery.length >= 4 && doc.phrases.some((p) => p.includes(normalizedQuery))) total += 8;

      // Order bonus: "csv json" prefers "CSV to JSON" over "JSON to CSV".
      if (tokens.length >= 2) {
        const positions = tokens.map((t) => doc.nameText.indexOf(t));
        if (positions.every((p) => p >= 0) && positions.every((p, i) => i === 0 || p > positions[i - 1])) {
          total += 6;
        }
      }
      // Flagship prior: breaks ties between tools that match a family name equally well.
      total += Math.min(Math.max(doc.item.priority ?? 0, 0), 3);
      results.push({ item: doc.item, score: total });
    }

    results.sort((a, b) => b.score - a.score || a.item.name.localeCompare(b.item.name));
    return results.slice(0, limit);
  }

  return { search };
}
