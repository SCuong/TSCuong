import { matchingFlags } from './flags';
import { parsePattern } from './parser';

export interface GroupMatch {
  /** 1-based group number. */
  index: number;
  name?: string;
  /** `undefined` when the group did not participate in the match. */
  value: string | undefined;
  start: number | null;
  end: number | null;
}

export interface MatchResult {
  /** Offset of the match in UTF-16 code units (JavaScript string indices). */
  index: number;
  end: number;
  text: string;
  groups: GroupMatch[];
}

export interface MatchSummary {
  /** Detailed matches, at most `maxDetails`. */
  matches: MatchResult[];
  /** Number of matches found (stops counting at `maxCount`). */
  total: number;
  /** `true` when counting stopped at `maxCount`, so `total` is a lower bound. */
  capped: boolean;
  /** Number of capture groups in the pattern. */
  groupCount: number;
}

export interface MatchOptions {
  maxDetails?: number;
  maxCount?: number;
}

export const DEFAULT_MAX_DETAILS = 1000;
export const DEFAULT_MAX_COUNT = 100_000;

/** Next index after a zero-length match (steps over a whole surrogate pair in unicode mode). */
export function advanceIndex(text: string, index: number, unicode: boolean): number {
  if (!unicode || index + 1 >= text.length) return index + 1;
  const code = text.charCodeAt(index);
  if (code >= 0xd800 && code <= 0xdbff) {
    const next = text.charCodeAt(index + 1);
    if (next >= 0xdc00 && next <= 0xdfff) return index + 2;
  }
  return index + 1;
}

/**
 * Run a pattern over text and collect matches with group values and spans.
 * Without the `g` flag only the first match is returned, like `RegExp.prototype.exec`.
 * Zero-length matches advance by one character, so the loop always terminates.
 * Throws the engine's SyntaxError for invalid patterns (callers validate first).
 */
export function findMatches(pattern: string, flags: string, text: string, options: MatchOptions = {}): MatchSummary {
  const maxDetails = options.maxDetails ?? DEFAULT_MAX_DETAILS;
  const maxCount = Math.max(options.maxCount ?? DEFAULT_MAX_COUNT, 1);
  const re = new RegExp(pattern, matchingFlags(flags));
  const unicode = re.unicode || re.unicodeSets;
  const { groups: groupInfo } = parsePattern(pattern, { unicode, unicodeSets: re.unicodeSets });
  const names = new Map(groupInfo.map((g) => [g.index, g.name]));

  const matches: MatchResult[] = [];
  let total = 0;
  let capped = false;
  let groupCount = 0;

  for (;;) {
    const m = re.exec(text);
    if (!m) break;
    total++;
    groupCount = m.length - 1;
    const start = m.index;
    const end = start + m[0].length;
    if (matches.length < maxDetails) {
      const groups: GroupMatch[] = [];
      for (let i = 1; i < m.length; i++) {
        const span = m.indices?.[i];
        groups.push({
          index: i,
          name: names.get(i) || undefined,
          value: m[i],
          start: span ? span[0] : null,
          end: span ? span[1] : null,
        });
      }
      matches.push({ index: start, end, text: m[0], groups });
    }
    if (!re.global) break;
    if (total >= maxCount) {
      // Is there at least one more match? Then the count is a lower bound.
      if (m[0].length === 0) re.lastIndex = advanceIndex(text, re.lastIndex, unicode);
      capped = re.lastIndex <= text.length && re.exec(text) !== null;
      break;
    }
    if (m[0].length === 0) {
      if (re.lastIndex >= text.length) break;
      re.lastIndex = advanceIndex(text, re.lastIndex, unicode);
    }
  }

  if (!total) {
    // Still report the number of groups so the UI can explain them.
    groupCount = groupInfo.length;
  }
  return { matches, total, capped, groupCount };
}
