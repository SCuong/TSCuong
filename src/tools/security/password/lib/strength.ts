/**
 * Password strength helpers: a lazily loaded zxcvbn-ts estimator plus a naive charset entropy for
 * comparison and human descriptions of zxcvbn's matched patterns.
 */

import type { MatchExtended, ZxcvbnResult } from '@zxcvbn-ts/core';

export type StrengthResult = ZxcvbnResult;
export type Estimator = (password: string, userInputs?: string[]) => StrengthResult;

let pending: Promise<Estimator> | null = null;

/** Loads zxcvbn-ts with the common + English dictionaries once (≈1 MB, only when needed). */
export function loadEstimator(): Promise<Estimator> {
  if (!pending) {
    pending = (async () => {
      const [{ ZxcvbnFactory }, common, en] = await Promise.all([
        import('@zxcvbn-ts/core'),
        import('@zxcvbn-ts/language-common'),
        import('@zxcvbn-ts/language-en'),
      ]);
      const factory = new ZxcvbnFactory({
        translations: en.translations,
        graphs: common.adjacencyGraphs,
        dictionary: { ...common.dictionary, ...en.dictionary },
        useLevenshteinDistance: true,
      });
      return (password: string, userInputs: string[] = []) => factory.check(password, userInputs);
    })();
    pending.catch(() => {
      pending = null;
    });
  }
  return pending;
}

/** zxcvbn only analyses this many characters (longer passwords are strong anyway). */
export const ANALYSED_LENGTH = 256;

export const SCORE_INFO = [
  { label: 'Too guessable', tone: 'danger', description: 'Risky: found in the first ~1,000 guesses.' },
  { label: 'Very guessable', tone: 'danger', description: 'Only protects against throttled online guessing.' },
  { label: 'Somewhat guessable', tone: 'warning', description: 'Protects against unthrottled online guessing, not against a leaked hash.' },
  { label: 'Safely unguessable', tone: 'success', description: 'Moderate protection if a slow-hashed password database leaks.' },
  { label: 'Very unguessable', tone: 'success', description: 'Strong protection even if a slow-hashed password database leaks.' },
] as const;

export const ATTACK_SCENARIOS: Array<{ key: keyof ZxcvbnResult['crackTimes']; label: string; rate: string }> = [
  { key: 'onlineThrottlingXPerHour', label: 'Online, rate-limited', rate: '100 guesses per hour' },
  { key: 'onlineNoThrottlingXPerSecond', label: 'Online, no rate limit', rate: '10 guesses per second' },
  { key: 'offlineSlowHashingXPerSecond', label: 'Offline, slow hash (bcrypt, scrypt, Argon2)', rate: '10,000 guesses per second' },
  { key: 'offlineFastHashingXPerSecond', label: 'Offline, fast hash (MD5, SHA-1, unsalted)', rate: '10 billion guesses per second' },
];

export interface CharsetEntropy {
  /** Number of code points. */
  length: number;
  /** Size of the character pool implied by the classes used. */
  pool: number;
  bits: number;
  classes: string[];
}

const POOLS: Array<{ name: string; size: number; test: (ch: string) => boolean }> = [
  { name: 'lowercase', size: 26, test: (c) => c >= 'a' && c <= 'z' },
  { name: 'uppercase', size: 26, test: (c) => c >= 'A' && c <= 'Z' },
  { name: 'digits', size: 10, test: (c) => c >= '0' && c <= '9' },
  { name: 'symbols & space', size: 33, test: (c) => c.length === 1 && c.charCodeAt(0) >= 32 && c.charCodeAt(0) < 127 && !/[A-Za-z0-9]/.test(c) },
  { name: 'other Unicode', size: 100, test: (c) => c.codePointAt(0)! > 126 },
];

/**
 * The textbook "length × log2(pool size)" estimate. It assumes every character was picked at
 * random, so it wildly overrates human-chosen passwords like "Password1!".
 */
export function charsetEntropy(password: string): CharsetEntropy {
  const chars = Array.from(password);
  const used = POOLS.filter((p) => chars.some((c) => p.test(c)));
  const pool = used.reduce((sum, p) => sum + p.size, 0);
  return {
    length: chars.length,
    pool,
    bits: pool > 0 ? chars.length * Math.log2(pool) : 0,
    classes: used.map((p) => p.name),
  };
}

/** log10(guesses) → bits. */
export function guessesToBits(log10: number): number {
  return log10 * Math.log2(10);
}

const DICTIONARY_NAMES: Record<string, string> = {
  passwords: 'common passwords',
  'passwords-common': 'common passwords',
  commonWords: 'common English words',
  'commonWords-en': 'common English words',
  firstnames: 'first names',
  'firstnames-en': 'first names',
  lastnames: 'last names',
  'lastnames-en': 'last names',
  wikipedia: 'Wikipedia words',
  'wikipedia-en': 'Wikipedia words',
  'diceware-common': 'the EFF diceware list',
  userInputs: 'your personal words',
};

const GRAPH_NAMES: Record<string, string> = {
  qwerty: 'QWERTY keyboard',
  qwertz: 'QWERTZ keyboard',
  azerty: 'AZERTY keyboard',
  dvorak: 'Dvorak keyboard',
  keypad: 'number pad',
  keypadMac: 'Mac number pad',
};

export interface MatchDescription {
  pattern: string;
  detail: string;
}

/** Human description of one zxcvbn match (without repeating the matched text itself). */
export function describeMatch(match: MatchExtended): MatchDescription {
  switch (match.pattern) {
    case 'dictionary': {
      const source = DICTIONARY_NAMES[match.dictionaryName as string] ?? String(match.dictionaryName).replace(/-\w+$/, '');
      const parts = [`#${Number(match.rank).toLocaleString('en-US')} in ${source}`];
      if (match.l33t) parts.push('with l33t substitutions');
      if (match.reversed) parts.push('reversed');
      if (match.levenshteinDistance) parts.push(`${match.levenshteinDistance} edit${match.levenshteinDistance === 1 ? '' : 's'} away`);
      return { pattern: 'Dictionary word', detail: parts.join(', ') };
    }
    case 'spatial': {
      const graph = GRAPH_NAMES[match.graph as string] ?? String(match.graph);
      const turns = Number(match.turns);
      return {
        pattern: 'Keyboard pattern',
        detail: `On a ${graph}, ${turns} turn${turns === 1 ? '' : 's'}${match.shiftedCount ? `, ${match.shiftedCount} shifted` : ''}`,
      };
    }
    case 'repeat': {
      const base = Array.isArray(match.baseToken) ? match.baseToken.join('') : String(match.baseToken);
      return { pattern: 'Repetition', detail: `${Array.from(base).length}-character block repeated ${match.repeatCount}×` };
    }
    case 'sequence': {
      const name = match.sequenceName === 'digits' ? 'digits' : match.sequenceName === 'upper' ? 'uppercase letters' : match.sequenceName === 'lower' ? 'lowercase letters' : 'characters';
      return { pattern: 'Sequence', detail: `${match.ascending ? 'Ascending' : 'Descending'} ${name}` };
    }
    case 'regex':
      return { pattern: match.regexName === 'recentYear' ? 'Recent year' : 'Pattern', detail: match.regexName === 'recentYear' ? 'Years are among the first things attackers try' : String(match.regexName) };
    case 'date':
      return { pattern: 'Date', detail: `${match.year}-${String(match.month).padStart(2, '0')}-${String(match.day).padStart(2, '0')}` };
    case 'separator':
      return { pattern: 'Separator', detail: 'Word separator' };
    case 'wordSequence':
      return {
        pattern: 'Word sequence',
        detail: `${match.wordCount} words in ${match.ascending ? 'natural' : 'reverse'} order (${String(match.dictionaryName).replace(/-\w+$/, '').replace(/([A-Z])/g, ' $1').toLowerCase()})`,
      };
    case 'bruteforce':
      return { pattern: 'Random characters', detail: 'No pattern found, must be brute-forced' };
    default:
      return { pattern: String(match.pattern), detail: '' };
  }
}
