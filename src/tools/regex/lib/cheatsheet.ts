export interface CheatRow {
  token: string;
  description: string;
  /** Pattern to try in the tester (defaults to `token`). */
  example?: string;
  /** Flags the example needs. */
  flags?: string;
}

export interface CheatSection {
  title: string;
  rows: CheatRow[];
}

export const CHEAT_SHEET: CheatSection[] = [
  {
    title: 'Characters',
    rows: [
      { token: '.', description: 'Any character except line breaks (with s: any character)' },
      { token: '\\d  \\D', description: 'Digit 0-9 / not a digit', example: '\\d' },
      { token: '\\w  \\W', description: 'Word character [A-Za-z0-9_] / not a word character', example: '\\w' },
      { token: '\\s  \\S', description: 'Whitespace (incl. Unicode spaces) / not whitespace', example: '\\s' },
      { token: '\\t  \\n  \\r', description: 'Tab, line feed, carriage return', example: '\\n' },
      { token: '\\xHH', description: 'Character by two hex digits, e.g. \\x41 = "A"', example: '\\x41' },
      { token: '\\uHHHH', description: 'Character by four hex digits, e.g. \\u00e9 = "é"', example: '\\u00e9' },
      { token: '\\u{HHHHH}', description: 'Any code point, e.g. \\u{1F600} (needs u or v)', example: '\\u{1F600}', flags: 'u' },
      { token: '\\. \\* \\\\', description: 'Escape a special character to match it literally', example: '\\.' },
    ],
  },
  {
    title: 'Character classes',
    rows: [
      { token: '[abc]', description: 'One of a, b or c' },
      { token: '[^abc]', description: 'Any character except a, b or c' },
      { token: '[a-z]', description: 'A character in the range a to z' },
      { token: '[a-z0-9_-]', description: 'Ranges and single characters combined (a trailing - is literal)' },
      { token: '\\p{L}', description: 'Any Unicode letter (needs u or v); \\P{L} is the negation', flags: 'u' },
      { token: '\\p{Script=Greek}', description: 'Characters of a script (needs u or v)', flags: 'u' },
      { token: '[\\w--\\d]', description: 'Set subtraction: word characters except digits (v flag)', flags: 'v' },
      { token: '[\\p{L}&&\\p{ASCII}]', description: 'Set intersection: ASCII letters (v flag)', flags: 'v' },
      { token: '[\\q{abc|xy}]', description: 'Match one of several strings inside a class (v flag)', flags: 'v' },
    ],
  },
  {
    title: 'Anchors and boundaries',
    rows: [
      { token: '^', description: 'Start of the text (with m: start of each line)' },
      { token: '$', description: 'End of the text (with m: end of each line)' },
      { token: '\\b', description: 'Word boundary' },
      { token: '\\B', description: 'Not a word boundary' },
    ],
  },
  {
    title: 'Quantifiers',
    rows: [
      { token: 'a*', description: '0 or more' },
      { token: 'a+', description: '1 or more' },
      { token: 'a?', description: '0 or 1 (optional)' },
      { token: 'a{3}', description: 'Exactly 3' },
      { token: 'a{2,}', description: '2 or more' },
      { token: 'a{2,5}', description: 'Between 2 and 5' },
      { token: 'a+?', description: 'Lazy: add ? to any quantifier to match as few as possible' },
    ],
  },
  {
    title: 'Groups and references',
    rows: [
      { token: '(abc)', description: 'Capture group, numbered from 1 by its opening parenthesis' },
      { token: '(?<name>abc)', description: 'Named capture group' },
      { token: '(?:abc)', description: 'Group without capturing' },
      { token: 'a|b', description: 'Alternation: a or b' },
      { token: '(\\w)\\1', description: 'Back-reference to group 1 (the same text again)' },
      { token: '(?<q>["\'])\\k<q>', description: 'Back-reference to a named group' },
      { token: '(?i:abc)', description: 'Inline flags for part of the pattern (i, m, s; newest browsers)' },
    ],
  },
  {
    title: 'Lookaround',
    rows: [
      { token: 'a(?=b)', description: 'Lookahead: a only if followed by b' },
      { token: 'a(?!b)', description: 'Negative lookahead: a only if not followed by b' },
      { token: '(?<=b)a', description: 'Lookbehind: a only if preceded by b' },
      { token: '(?<!b)a', description: 'Negative lookbehind: a only if not preceded by b' },
    ],
  },
];
