/**
 * Turn engine SyntaxError messages (Chrome/V8, Firefox/SpiderMonkey, Safari/JSC)
 * into one clear sentence. The engine is the source of truth for validity; this
 * only rewrites how the problem is described.
 */

interface Rule {
  test: RegExp;
  message: (ctx: { flags: string }) => string;
}

const RULES: Rule[] = [
  {
    test: /invalid flags? supplied|invalid regular expression flag|invalid flags/i,
    message: ({ flags }) =>
      flags.includes('u') && flags.includes('v')
        ? 'The u and v flags cannot be used together. Choose one (v is the newer superset of u).'
        : 'The flags are not valid. Each flag may appear once, and only d, g, i, m, s, u, v and y exist.',
  },
  {
    test: /unterminated group|unterminated parenthetical|missing \)/i,
    message: () => 'A group is never closed: there is a "(" without a matching ")".',
  },
  {
    test: /unmatched '?\)'?|unmatched parenthes/i,
    message: () => 'There is a ")" without a matching "(". Escape it as \\) to match a literal parenthesis.',
  },
  {
    test: /unterminated character class|missing terminating \] for character class/i,
    message: () => 'A character class is never closed: there is a "[" without a matching "]".',
  },
  {
    test: /nothing to repeat/i,
    message: () =>
      'A quantifier (*, +, ?, {n}) has nothing to repeat. It must follow a character, class or group; escape it (e.g. \\* or \\+) to match it literally.',
  },
  {
    test: /numbers out of order in \{\} quantifier/i,
    message: () => 'In a {min,max} quantifier the minimum is larger than the maximum.',
  },
  {
    test: /incomplete quantifier/i,
    message: () => 'A {n,m} quantifier is not complete. Close it with "}" or escape the "{" as \\{.',
  },
  {
    test: /lone quantifier brackets|raw bracket is not allowed/i,
    message: () =>
      'With the u or v flag a lone {, }, or ] must be escaped (\\{, \\}, \\]) to match it literally.',
  },
  {
    test: /invalid quantifier|quantifier .*not allowed|can't be quantified/i,
    message: () => 'This element cannot be repeated with a quantifier (for example a lookahead in u or v mode).',
  },
  {
    test: /\\ at end of pattern/i,
    message: () => 'The pattern ends with a lone backslash. Use \\\\ to match a backslash.',
  },
  {
    test: /duplicate (capture group|group specifier) name/i,
    message: () =>
      'Two capture groups have the same name. Names must be unique, except in different alternatives of the same "|".',
  },
  {
    test: /invalid named (capture )?reference|invalid named capture referenced|invalid named reference/i,
    message: () => 'A \\k<name> back-reference points to a group name that does not exist in the pattern.',
  },
  {
    test: /invalid capture group name|invalid group specifier name/i,
    message: () => 'A group name is not valid. Names must start with a letter, $ or _ and look like (?<name>...).',
  },
  {
    test: /range out of order/i,
    message: () => 'A character range is backwards, like [z-a]. Put the lower character first, e.g. [a-z].',
  },
  {
    test: /invalid property name|invalid unicode property/i,
    message: () =>
      'Unknown Unicode property in \\p{...} or \\P{...}. Examples of valid ones: \\p{L}, \\p{Lu}, \\p{Script=Greek}, \\p{Emoji}.',
  },
  {
    test: /invalid unicode escape|malformed unicode/i,
    message: () =>
      'A Unicode escape is not valid. Use \\uXXXX with four hex digits or \\u{X...} up to 10FFFF (braces need the u or v flag).',
  },
  {
    test: /invalid decimal escape|invalid class escape|invalid identity escape|invalid escape/i,
    message: ({ flags }) =>
      /[uv]/.test(flags)
        ? 'An escape sequence is not valid in u/v mode. Only syntax characters like \\. \\* \\( can be escaped; back-references must point to an existing group.'
        : 'An escape sequence is not valid.',
  },
  {
    test: /repeated flag in flag group|repeated flags? in modifier/i,
    message: () => 'An inline modifier group like (?i-m:...) lists the same flag more than once.',
  },
  {
    test: /invalid group|invalid regular expression group|unknown group/i,
    message: () =>
      'Unknown group syntax after "(?". Use (?:...), (?<name>...), (?=...), (?!...), (?<=...), (?<!...) or inline flags like (?i:...).',
  },
  {
    test: /invalid character in character class|invalid set operation|invalid class set|invalid character class/i,
    message: ({ flags }) =>
      flags.includes('v')
        ? 'This character class is not valid in v mode. Characters like ( ) [ { } / - | must be escaped inside [...], and && or -- cannot be mixed with plain ranges.'
        : 'This character class is not valid. A shorthand like \\d or \\w cannot be one end of a range.',
  },
  {
    test: /regular expression too large|too many/i,
    message: () => 'The pattern is too large for the regular expression engine.',
  },
];

/** Returns a human sentence describing why a pattern/flags pair is invalid. */
export function describeRegexError(error: unknown, flags = ''): string {
  const raw = error instanceof Error ? error.message : String(error);
  for (const rule of RULES) {
    if (rule.test.test(raw)) return rule.message({ flags });
  }
  // Unknown engine message: strip the "Invalid regular expression: /.../: " prefix and capitalise.
  const cleaned = raw
    .replace(/^invalid regular expression:\s*\/[\s\S]*\/[a-z]*:\s*/i, '')
    .replace(/^SyntaxError:\s*/i, '')
    .trim();
  const text = cleaned || 'The pattern is not a valid regular expression.';
  return text.charAt(0).toUpperCase() + text.slice(1) + (/[.!?]$/.test(text) ? '' : '.');
}

export type CompileResult = { ok: true; regex: RegExp } | { ok: false; error: string };

/** Compile a pattern, returning a human error instead of throwing. */
export function compileRegex(pattern: string, flags: string): CompileResult {
  try {
    return { ok: true, regex: new RegExp(pattern, flags) };
  } catch (error) {
    return { ok: false, error: describeRegexError(error, flags) };
  }
}
