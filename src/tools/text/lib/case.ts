import { mapLines } from './common';

/**
 * Split an identifier or phrase into words. Handles separators (space, _, -, ., /),
 * camelCase and PascalCase boundaries, acronyms ("XMLHttpRequest" → XML, Http, Request)
 * and any Unicode letters.
 */
export function splitWords(input: string): string[] {
  const spaced = input
    // lower/digit → Upper: "fooBar" → "foo Bar"
    .replace(/([\p{Ll}\p{N}])(\p{Lu})/gu, '$1 $2')
    // acronym followed by a word: "XMLHttp" → "XML Http"
    .replace(/(\p{Lu})(\p{Lu}\p{Ll})/gu, '$1 $2');
  return spaced.split(/[^\p{L}\p{N}\p{M}]+/u).filter(Boolean);
}

/** Characters whose titlecase differs from their uppercase (Unicode "Lt" digraphs). */
const TITLECASE: Record<string, string> = {
  Ǆ: 'ǅ', ǅ: 'ǅ', ǆ: 'ǅ', Ǉ: 'ǈ', ǈ: 'ǈ', ǉ: 'ǈ', Ǌ: 'ǋ', ǋ: 'ǋ', ǌ: 'ǋ', Ǳ: 'ǲ', ǲ: 'ǲ', ǳ: 'ǲ', ŉ: 'ʼN',
};

/**
 * Titlecase of one character: "ǆ" → "ǅ", and characters that uppercase to several letters
 * keep only the first one capital ("ß" → "Ss", "ﬁ" → "Fi"), as Unicode's titlecase mapping does.
 */
export function toTitleChar(ch: string): string {
  const mapped = TITLECASE[ch];
  if (mapped) return mapped;
  const upper = ch.toUpperCase();
  const first = String.fromCodePoint(upper.codePointAt(0)!);
  return upper.length > first.length ? first + upper.slice(first.length).toLowerCase() : upper;
}

function upperFirst(word: string): string {
  if (!word) return word;
  const first = String.fromCodePoint(word.codePointAt(0)!);
  return toTitleChar(first) + word.slice(first.length);
}

function capitalize(word: string): string {
  return upperFirst(word.toLowerCase());
}

const perLine = (fn: (line: string) => string) => (text: string) => mapLines(text, fn);

export const camelCase = perLine((line) =>
  splitWords(line)
    .map((w, i) => (i === 0 ? w.toLowerCase() : capitalize(w)))
    .join(''),
);

export const pascalCase = perLine((line) => splitWords(line).map(capitalize).join(''));

export const snakeCase = perLine((line) =>
  splitWords(line)
    .map((w) => w.toLowerCase())
    .join('_'),
);

export const constantCase = perLine((line) =>
  splitWords(line)
    .map((w) => w.toUpperCase())
    .join('_'),
);

export const kebabCase = perLine((line) =>
  splitWords(line)
    .map((w) => w.toLowerCase())
    .join('-'),
);

export const dotCase = perLine((line) =>
  splitWords(line)
    .map((w) => w.toLowerCase())
    .join('.'),
);

export const pathCase = perLine((line) =>
  splitWords(line)
    .map((w) => w.toLowerCase())
    .join('/'),
);

export const lowerCase = (text: string) => text.toLowerCase();
export const upperCase = (text: string) => text.toUpperCase();

const SMALL_WORDS = new Set([
  'a', 'an', 'and', 'as', 'at', 'but', 'by', 'for', 'from', 'in', 'into', 'nor', 'of', 'on', 'onto', 'or', 'per',
  'the', 'to', 'via', 'vs', 'with',
]);

const WORD_RE = /[\p{L}\p{N}\p{M}]+(?:['’][\p{L}\p{N}\p{M}]+)*/gu;

/**
 * Title Case: capitalize each word, keep short function words lowercase unless they
 * start or end a line or follow a colon. Punctuation and spacing are preserved.
 */
/**
 * Capitalize a word for titles. Words with deliberate inner capitals (iPhone, XMLHttpRequest,
 * NASA in mixed-case text) are kept as written.
 */
function titleWord(word: string, lineIsUpper: boolean): string {
  if (!lineIsUpper && /.\p{Lu}/u.test(word)) return word;
  return capitalize(word);
}

function isAllUpper(line: string): boolean {
  return /\p{Lu}/u.test(line) && !/\p{Ll}/u.test(line);
}

export const titleCase = perLine((line) => {
  const upper = isAllUpper(line);
  const matches = Array.from(line.matchAll(WORD_RE));
  let out = '';
  let last = 0;
  matches.forEach((m, i) => {
    const start = m.index ?? 0;
    const before = line.slice(last, start);
    const word = m[0];
    const lower = word.toLowerCase();
    const afterColon = /[:—–!?]\s*$/.test(line.slice(0, start));
    const keepSmall = i > 0 && i < matches.length - 1 && !afterColon && SMALL_WORDS.has(lower);
    out += before + (keepSmall ? lower : titleWord(word, upper));
    last = start + word.length;
  });
  return out + line.slice(last);
});

/** Capitalize the first letter of every word (words with inner capitals are kept). */
export const capitalizedCase = perLine((line) => {
  const upper = isAllUpper(line);
  return line.replace(WORD_RE, (w) => titleWord(w, upper));
});

/** Abbreviations whose period does not end a sentence ("i.e. this", "Dr. Smith"). */
const ABBREVIATION_BEFORE = /(?:^|[^\p{L}])(?:i\.e|e\.g|vs|cf|approx|fig|mr|mrs|ms|dr|prof|jr|sr)$/u;

/** Sentence case: lowercase everything, then uppercase the first letter of each sentence and the pronoun "I". */
export function sentenceCase(text: string): string {
  let result = text.toLowerCase();
  result = result.replace(
    /(^|[.!?…]\s+|\n\s*)(\P{L}*?)(\p{L})/gu,
    (match: string, lead: string, mid: string, letter: string, offset: number, whole: string) => {
      if (lead.startsWith('.') && ABBREVIATION_BEFORE.test(whole.slice(Math.max(0, offset - 12), offset))) return match;
      return lead + mid + toTitleChar(letter);
    },
  );
  // The pronoun "i" (also in "i'm"), but not the abbreviation "i.e.".
  result = result.replace(/(^|[^\p{L}\p{N}])i(?=$|[^\p{L}\p{N}])(?!\.\p{L})/gu, '$1I');
  return result;
}

/** aLtErNaTiNg case: alternates on letters only, restarting on each line. */
export const alternatingCase = perLine((line) => {
  let upper = false;
  let out = '';
  for (const ch of line) {
    if (/\p{L}/u.test(ch) && ch.toLowerCase() !== ch.toUpperCase()) {
      out += upper ? ch.toUpperCase() : ch.toLowerCase();
      upper = !upper;
    } else out += ch;
  }
  return out;
});

/** Swap the case of every letter. */
export function inverseCase(text: string): string {
  let out = '';
  for (const ch of text) {
    const lower = ch.toLowerCase();
    const upper = ch.toUpperCase();
    out += ch === lower && ch !== upper ? upper : ch === upper && ch !== lower ? lower : ch;
  }
  return out;
}

export interface CaseVariant {
  id: string;
  label: string;
  convert: (text: string) => string;
}

export const CASE_VARIANTS: CaseVariant[] = [
  { id: 'camel', label: 'camelCase', convert: camelCase },
  { id: 'pascal', label: 'PascalCase', convert: pascalCase },
  { id: 'snake', label: 'snake_case', convert: snakeCase },
  { id: 'constant', label: 'CONSTANT_CASE', convert: constantCase },
  { id: 'kebab', label: 'kebab-case', convert: kebabCase },
  { id: 'dot', label: 'dot.case', convert: dotCase },
  { id: 'path', label: 'path/case', convert: pathCase },
  { id: 'title', label: 'Title Case', convert: titleCase },
  { id: 'capitalized', label: 'Capitalized Words', convert: capitalizedCase },
  { id: 'sentence', label: 'Sentence case', convert: sentenceCase },
  { id: 'lower', label: 'lower case', convert: lowerCase },
  { id: 'upper', label: 'UPPER CASE', convert: upperCase },
  { id: 'alternating', label: 'aLtErNaTiNg cAsE', convert: alternatingCase },
  { id: 'inverse', label: 'iNVERSE cASE', convert: inverseCase },
];
