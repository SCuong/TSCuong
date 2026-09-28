/**
 * Branch name generation and validation against the rules of
 * `git check-ref-format` (as applied to `refs/heads/<name>`).
 */

/** Letters that Unicode normalization does not decompose into ASCII + combining marks. */
const SPECIAL_LETTERS: Record<string, string> = {
  đ: 'd',
  Đ: 'D',
  ð: 'd',
  Ð: 'D',
  ß: 'ss',
  ẞ: 'SS',
  æ: 'ae',
  Æ: 'AE',
  ø: 'o',
  Ø: 'O',
  œ: 'oe',
  Œ: 'OE',
  ł: 'l',
  Ł: 'L',
  þ: 'th',
  Þ: 'TH',
  ı: 'i',
  ħ: 'h',
  Ħ: 'H',
};

const COMBINING_MARKS = /\p{Mn}/gu;

/** Transliterate to ASCII: strips diacritics (Vietnamese, French, German, ...) and maps a few special letters. */
export function toAscii(input: string): string {
  let out = '';
  for (const ch of input.normalize('NFD').replace(COMBINING_MARKS, '')) {
    out += SPECIAL_LETTERS[ch] ?? ch;
  }
  return out.normalize('NFC');
}

export interface RefIssue {
  message: string;
}

/**
 * Check a branch name against git's reference name rules. Returns an empty
 * list when `git check-ref-format --branch` would accept it.
 */
export function validateBranchName(name: string): RefIssue[] {
  const issues: RefIssue[] = [];
  const add = (message: string) => issues.push({ message });
  if (name.length === 0) {
    add('The name is empty.');
    return issues;
  }
  if (name === '@') add('The name cannot be the single character “@”.');
  if (name === 'HEAD') add('“HEAD” is reserved and cannot be used as a branch name.');
  if (name.startsWith('-')) add('A branch name cannot start with “-” (it would be read as an option).');
  if (name.startsWith('/') || name.endsWith('/')) add('The name cannot start or end with “/”.');
  if (name.includes('//')) add('The name cannot contain consecutive slashes “//”.');
  if (name.endsWith('.')) add('The name cannot end with “.”.');
  if (name.includes('..')) add('The name cannot contain “..”.');
  if (name.includes('@{')) add('The name cannot contain the sequence “@{”.');
  const components = name.split('/');
  if (components.some((c) => c.startsWith('.'))) add('No path component may start with “.”.');
  if (components.some((c) => c.endsWith('.lock'))) add('No path component may end with “.lock”.');
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(name)) add('The name contains control characters.');
  if (name.includes(' ')) add('The name cannot contain spaces.');
  const forbidden = [...new Set(name.match(/[~^:?*[\\]/g) ?? [])];
  if (forbidden.length) add(`The name contains characters git does not allow: ${forbidden.map((c) => `“${c}”`).join(' ')}.`);
  return issues;
}

export interface BranchOptions {
  title: string;
  ticket: string;
  /** e.g. "feature"; empty for none. */
  prefix: string;
  /** Between the prefix and the rest. */
  prefixSeparator: '/' | '-' | '_';
  /** Between words. */
  wordSeparator: '-' | '_' | '.';
  lowercase: boolean;
  /** Keep the ticket id's original case (ABC-123) even when lowercasing the title. */
  keepTicketCase: boolean;
  /** Total maximum length, 0 = unlimited. */
  maxLength: number;
  /** Drop filler words such as "a", "the", "of". */
  dropStopWords: boolean;
}

const STOP_WORDS = new Set(['a', 'an', 'the', 'of', 'to', 'for', 'in', 'on', 'and', 'or', 'with', 'is', 'be', 'at', 'by']);

/** Split text into ASCII words suitable for a ref name. */
export function slugWords(text: string, dropStopWords = false): string[] {
  const ascii = toAscii(text)
    // camelCase boundaries become word breaks (but not short prefixes such as iPhone, eBay)
    .replace(/([a-z0-9]{2})(?=[A-Z][a-z])/g, '$1 ')
    .replace(/'/g, '');
  const words = ascii.split(/[^A-Za-z0-9]+/).filter(Boolean);
  if (!dropStopWords) return words;
  const kept = words.filter((w) => !STOP_WORDS.has(w.toLowerCase()));
  return kept.length ? kept : words;
}

/** Normalise a ticket id ("#123", "abc 123", "PROJ-42") into a ref-safe token. */
export function normalizeTicket(ticket: string): string {
  const trimmed = toAscii(ticket.trim()).replace(/^#+/, '');
  return trimmed
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function generateBranchName(options: BranchOptions): string {
  const { prefix, prefixSeparator, wordSeparator, lowercase, keepTicketCase, maxLength, dropStopWords } = options;
  let ticket = normalizeTicket(options.ticket);
  if (lowercase && !keepTicketCase) ticket = ticket.toLowerCase();
  let words = slugWords(options.title, dropStopWords);
  if (lowercase) words = words.map((w) => w.toLowerCase());
  const cleanPrefix = slugWords(prefix)
    .map((w) => (lowercase ? w.toLowerCase() : w))
    .join('-');

  const head = cleanPrefix ? cleanPrefix + prefixSeparator : '';
  const ticketPart = ticket ? ticket : '';
  const joinTicket = ticketPart && words.length ? wordSeparator : '';

  const build = (ws: string[]) => head + ticketPart + (ws.length ? joinTicket : '') + ws.join(wordSeparator);
  let name = build(words);
  if (maxLength > 0 && name.length > maxLength) {
    // Drop whole words from the end first.
    while (words.length > 1 && build(words).length > maxLength) words = words.slice(0, -1);
    name = build(words);
    if (name.length > maxLength) name = name.slice(0, maxLength);
  }
  // Tidy: no trailing separators or dots, no ".lock" suffix, no "..".
  name = name.replace(/\.{2,}/g, '.');
  name = name.replace(/[-_./]+$/, '');
  if (name.endsWith('.lock')) name = name.slice(0, -5).replace(/[-_./]+$/, '');
  return name;
}
