import type { MatchResult } from './match';

export interface SubstitutionContext {
  /** The whole input string. */
  input: string;
  match: MatchResult;
  /** Whether the pattern has named groups; without them `$<` is literal text. */
  hasNamedGroups: boolean;
}

/**
 * Expand a replacement template for one match, following the ECMAScript
 * GetSubstitution rules used by `String.prototype.replace`:
 * `$$`, `$&`, `` $` ``, `$'`, `$1`–`$99` and `$<name>`.
 */
export function expandReplacement(template: string, ctx: SubstitutionContext): string {
  const { input, match, hasNamedGroups } = ctx;
  const groupCount = match.groups.length;
  let out = '';
  let i = 0;
  while (i < template.length) {
    const c = template[i];
    if (c !== '$' || i + 1 >= template.length) {
      out += c;
      i++;
      continue;
    }
    const n = template[i + 1];
    if (n === '$') {
      out += '$';
      i += 2;
    } else if (n === '&') {
      out += match.text;
      i += 2;
    } else if (n === '`') {
      out += input.slice(0, match.index);
      i += 2;
    } else if (n === "'") {
      out += input.slice(match.end);
      i += 2;
    } else if (n >= '0' && n <= '9') {
      const two = template[i + 2];
      const twoDigit = two !== undefined && two >= '0' && two <= '9' ? Number(n + two) : NaN;
      if (twoDigit >= 1 && twoDigit <= groupCount) {
        out += match.groups[twoDigit - 1].value ?? '';
        i += 3;
      } else if (Number(n) >= 1 && Number(n) <= groupCount) {
        out += match.groups[Number(n) - 1].value ?? '';
        i += 2;
      } else {
        out += '$' + n;
        i += 2;
      }
    } else if (n === '<' && hasNamedGroups) {
      const close = template.indexOf('>', i + 2);
      if (close === -1) {
        out += '$<';
        i += 2;
      } else {
        const name = template.slice(i + 2, close);
        // With duplicate names (in different alternatives) the participating group wins.
        const group = match.groups.find((g) => g.name === name && g.value !== undefined);
        out += group?.value ?? '';
        i = close + 1;
      }
    } else {
      out += '$';
      i++;
    }
  }
  return out;
}

export interface ReplacementToken {
  token: string;
  description: string;
}

export const REPLACEMENT_TOKENS: ReplacementToken[] = [
  { token: '$1 … $99', description: 'Text of the numbered capture group' },
  { token: '$<name>', description: 'Text of the named capture group' },
  { token: '$&', description: 'The whole match' },
  { token: '$`', description: 'Text before the match' },
  { token: "$'", description: 'Text after the match' },
  { token: '$$', description: 'A literal dollar sign' },
];
