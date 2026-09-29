/**
 * Identifier helpers shared by the type inference and every language emitter:
 * word splitting, case conversion, singularization for array item names and
 * collision-safe name allocation.
 */

/**
 * Splits a JSON key into ASCII words on separators and case boundaries.
 * `userID` → [user, ID], `HTMLParser` → [HTML, Parser], `first-name` → [first, name],
 * `userIDs` → [user, IDs], `line1Text` → [line1, Text]. Non-ASCII characters are dropped.
 */
export function splitWords(input: string): string[] {
  const words: string[] = [];
  for (const chunk of input.split(/[^A-Za-z0-9]+/)) {
    if (!chunk) continue;
    const parts = chunk.match(/[A-Z]{2,}s(?![a-z])|[A-Z]+(?![a-z])[0-9]*|[A-Z]?[a-z]+[0-9]*|[0-9]+[a-z]*/g);
    if (parts) words.push(...parts);
  }
  return words;
}

function capitalize(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

/** Go-style initialisms kept upper case in exported names (from golint). */
export const GO_INITIALISMS = new Set([
  'ACL', 'API', 'ASCII', 'CPU', 'CSS', 'DNS', 'EOF', 'GUID', 'HTML', 'HTTP', 'HTTPS', 'ID', 'IP', 'JSON', 'LHS',
  'QPS', 'RAM', 'RHS', 'RPC', 'SLA', 'SMTP', 'SQL', 'SSH', 'TCP', 'TLS', 'TTL', 'UDP', 'UI', 'UID', 'UUID', 'URI',
  'URL', 'UTF8', 'VM', 'XML', 'XMPP', 'XSRF', 'XSS',
]);

function initialism(word: string, initialisms: ReadonlySet<string>): string | null {
  const upper = word.toUpperCase();
  if (initialisms.has(upper)) return upper;
  // Plural initialisms: IDs, URLs, APIs.
  if (/s$/i.test(word) && initialisms.has(upper.slice(0, -1))) return `${upper.slice(0, -1)}s`;
  return null;
}

export function pascalCase(words: readonly string[], initialisms?: ReadonlySet<string>): string {
  return words.map((w) => (initialisms && initialism(w, initialisms)) || capitalize(w)).join('');
}

export function camelCase(words: readonly string[]): string {
  return words.map((w, i) => (i === 0 ? w.toLowerCase() : capitalize(w))).join('');
}

export function snakeCase(words: readonly string[]): string {
  return words.map((w) => w.toLowerCase()).join('_');
}

// --- singularization -----------------------------------------------------------

const IRREGULAR: Record<string, string> = {
  people: 'person', persons: 'person', children: 'child', men: 'man', women: 'woman', mice: 'mouse',
  geese: 'goose', teeth: 'tooth', feet: 'foot', oxen: 'ox', indices: 'index', matrices: 'matrix',
  vertices: 'vertex', appendices: 'appendix', criteria: 'criterion', phenomena: 'phenomenon',
  analyses: 'analysis', diagnoses: 'diagnosis', theses: 'thesis', crises: 'crisis', axes: 'axis',
  parentheses: 'parenthesis', synopses: 'synopsis', hypotheses: 'hypothesis', leaves: 'leaf', wives: 'wife',
  knives: 'knife', lives: 'life', halves: 'half', wolves: 'wolf', shelves: 'shelf', thieves: 'thief',
  calves: 'calf', loaves: 'loaf', scarves: 'scarf', elves: 'elf', selves: 'self', quizzes: 'quiz',
  buses: 'bus', statuses: 'status', bonuses: 'bonus', viruses: 'virus', campuses: 'campus', censuses: 'census',
  choruses: 'chorus', focuses: 'focus', radiuses: 'radius', surpluses: 'surplus', syllabuses: 'syllabus',
  octopuses: 'octopus', cactuses: 'cactus', geniuses: 'genius', walruses: 'walrus', apparatuses: 'apparatus',
  corpuses: 'corpus', aliases: 'alias', biases: 'bias', canvases: 'canvas', atlases: 'atlas', gases: 'gas',
  lenses: 'lens', movies: 'movie', cookies: 'cookie', zombies: 'zombie', rookies: 'rookie', ties: 'tie',
  pies: 'pie', lies: 'lie', dies: 'die', calories: 'calorie', selfies: 'selfie', hoodies: 'hoodie',
  smoothies: 'smoothie', brownies: 'brownie', goalies: 'goalie', freebies: 'freebie', prairies: 'prairie',
  genies: 'genie', caches: 'cache', niches: 'niche', headaches: 'headache', shoes: 'shoe', toes: 'toe',
  canoes: 'canoe', oboes: 'oboe', foes: 'foe', heroes: 'hero', potatoes: 'potato', tomatoes: 'tomato',
  echoes: 'echo', vetoes: 'veto', cargoes: 'cargo', volcanoes: 'volcano', mosquitoes: 'mosquito',
  dominoes: 'domino', torpedoes: 'torpedo',
};

/** Words that are not plural or have no distinct singular; array items get an "Item" suffix instead. */
const INVARIANT = new Set([
  'data', 'metadata', 'info', 'information', 'news', 'series', 'species', 'sheep', 'fish', 'deer', 'moose',
  'aircraft', 'software', 'hardware', 'firmware', 'middleware', 'equipment', 'feedback', 'media', 'chaos',
  'kudos', 'staff', 'stuff', 'traffic', 'music', 'advice', 'evidence', 'furniture', 'luggage', 'knowledge',
  'research', 'progress', 'access', 'analytics', 'physics', 'mathematics', 'economics', 'ethics', 'politics',
  'logistics', 'canvas', 'alias', 'bias', 'atlas', 'gas', 'lens', 'yes', 'bus', 'ios', 'macos', 'always',
  'perhaps', 'thus', 'has', 'was', 'this', 'its', 'his', 'hers', 'ours', 'yours', 'theirs',
]);

/**
 * Singular form of a (lower- or mixed-case) English word, or `null` when the word
 * is not a recognizable plural. Only the patterns common in API field names are handled.
 */
export function singularize(word: string): string | null {
  const w = word.toLowerCase();
  if (w.length <= 2 || INVARIANT.has(w)) return null;
  const irregular = IRREGULAR[w];
  if (irregular) return irregular;
  if (/(?:ss|us|is)$/.test(w)) return null;
  if (w.endsWith('ies') && w.length > 4) return `${w.slice(0, -3)}y`;
  if (w.endsWith('ves')) return w.slice(0, -1);
  if (/(?:sses|xes|zzes|ches|shes|oes)$/.test(w)) return w.slice(0, -2);
  if (w.endsWith('s')) return w.slice(0, -1);
  return null;
}

/**
 * Name words for the items of an array stored under `words`:
 * users → User, categories → Category, data → DataItem, matrix → MatrixItem.
 */
export function itemWords(words: readonly string[]): string[] {
  if (words.length === 0) return ['Item'];
  const last = words[words.length - 1];
  const single = /^[0-9]/.test(last) ? null : singularize(last);
  return single ? [...words.slice(0, -1), single] : [...words, 'Item'];
}

// --- allocation ------------------------------------------------------------------

/**
 * Hands out unique names. Names in `reserved` (compared case-sensitively, or
 * case-insensitively when `ignoreCase`) are never returned; `escape` turns a
 * reserved name into an allowed one (e.g. `type` → `r#type`), otherwise a
 * numeric suffix is appended.
 */
export class Namer {
  private readonly used = new Set<string>();
  constructor(
    private readonly reserved: ReadonlySet<string> = new Set(),
    private readonly options: { ignoreCase?: boolean; escape?: (name: string) => string; separator?: string } = {},
  ) {}

  private norm(name: string) {
    return this.options.ignoreCase ? name.toLowerCase() : name;
  }

  isTaken(name: string): boolean {
    const n = this.norm(name);
    return this.used.has(n) || this.reserved.has(n);
  }

  /** Marks a name as used without checking it (for names fixed by the caller). */
  block(name: string) {
    this.used.add(this.norm(name));
  }

  claim(base: string): string {
    let name = base;
    if (this.reserved.has(this.norm(name)) && this.options.escape) name = this.options.escape(name);
    if (this.isTaken(name)) {
      const sep = this.options.separator ?? '';
      let i = 2;
      while (this.isTaken(`${base}${sep}${i}`)) i++;
      name = `${base}${sep}${i}`;
    }
    this.used.add(this.norm(name));
    return name;
  }
}

/** Longest common trailing run of words (case-insensitive) shared by every list. */
export function commonSuffix(lists: ReadonlyArray<readonly string[]>): string[] {
  if (lists.length === 0) return [];
  const first = lists[0];
  let n = 0;
  outer: while (n < first.length) {
    const word = first[first.length - 1 - n].toLowerCase();
    for (const list of lists) {
      if (list.length <= n || list[list.length - 1 - n].toLowerCase() !== word) break outer;
    }
    n++;
  }
  return first.slice(first.length - n);
}

/** True for identifiers made of ASCII letters, digits, `_` (and `$` when allowed) not starting with a digit. */
export function isAsciiIdentifier(name: string, allowDollar = false): boolean {
  return allowDollar ? /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name) : /^[A-Za-z_][A-Za-z0-9_]*$/.test(name);
}
