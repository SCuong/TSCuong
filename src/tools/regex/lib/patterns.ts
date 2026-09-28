export type PatternCategory = 'Web' | 'Network' | 'Identifiers' | 'Dates & times' | 'Numbers' | 'Text';

export interface CommonPattern {
  id: string;
  name: string;
  category: PatternCategory;
  pattern: string;
  flags: string;
  description: string;
  /**
   * `validate`: the pattern is anchored and tests a whole value; `examples` lists
   * values that must and must not match. `find`: the pattern searches inside text;
   * `sample` is searched and must yield exactly `expected`.
   */
  kind: 'validate' | 'find';
  examples?: { match: string[]; noMatch: string[] };
  sample?: string;
  expected?: string[];
  /** Honest limits of the pattern. */
  note?: string;
}

const OCTET = '(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)';
const H = '[0-9A-Fa-f]{1,4}';
const DATE = '\\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\\d|3[01])';
const SEMVER_ID = '(?:0|[1-9]\\d*|\\d*[a-zA-Z-][0-9a-zA-Z-]*)';

export const COMMON_PATTERNS: CommonPattern[] = [
  {
    id: 'email',
    name: 'Email address',
    category: 'Web',
    pattern:
      "^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$",
    flags: '',
    description: 'The address syntax browsers use for <input type="email">, requiring a dot in the domain.',
    kind: 'validate',
    examples: {
      match: ['alice@example.com', 'first.last+tag@mail.example.co.uk', 'x_y@sub-domain.io'],
      noMatch: ['alice@', '@example.com', 'alice example.com', 'alice@-example.com', 'alice@localhost'],
    },
    note: 'Does not accept quoted local parts or internationalized domains; the only real check is sending a message.',
  },
  {
    id: 'url',
    name: 'URL (http/https)',
    category: 'Web',
    pattern:
      '^https?:\\/\\/(?:localhost|(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?\\.)+[a-zA-Z]{2,}|(?:\\d{1,3}\\.){3}\\d{1,3})(?::\\d{1,5})?(?:[/?#]\\S*)?$',
    flags: 'i',
    description: 'An absolute web address with host name, localhost or IPv4 host, optional port, path, query and fragment.',
    kind: 'validate',
    examples: {
      match: ['https://example.com', 'http://localhost:5173/tools?q=1#top', 'https://sub.example.co.uk/a/b.html', 'http://192.168.1.10:8080/'],
      noMatch: ['ftp://example.com', 'https://', 'example.com', 'https://exa mple.com', 'https://-bad.com'],
    },
    note: 'For full validation use the URL parser (new URL(...)); this is a quick syntactic check.',
  },
  {
    id: 'domain',
    name: 'Domain name',
    category: 'Web',
    pattern: '^(?=.{1,253}$)(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\\.)+[a-zA-Z]{2,63}$',
    flags: '',
    description: 'A fully qualified host name: labels of up to 63 characters, no leading or trailing hyphen.',
    kind: 'validate',
    examples: {
      match: ['example.com', 'a.b.example.org', 'xn--bcher-kva.example'],
      noMatch: ['example', '-example.com', 'example-.com', 'exa_mple.com', 'example.c'],
    },
  },
  {
    id: 'slug',
    name: 'URL slug',
    category: 'Web',
    pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$',
    flags: '',
    description: 'Lowercase letters and digits separated by single hyphens.',
    kind: 'validate',
    examples: { match: ['hello-world', 'post-42', 'a'], noMatch: ['Hello-World', 'hello--world', '-hello', 'hello_world'] },
  },
  {
    id: 'hex-color',
    name: 'Hex colour',
    category: 'Web',
    pattern: '^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$',
    flags: '',
    description: 'CSS hex colours: #rgb, #rgba, #rrggbb or #rrggbbaa.',
    kind: 'validate',
    examples: { match: ['#fff', '#FFFA', '#1d4fd7', '#1d4fd780'], noMatch: ['fff', '#ff', '#12345', '#gggggg', '#1234567'] },
  },
  {
    id: 'html-tag',
    name: 'HTML element with content',
    category: 'Web',
    pattern: '<([a-z][a-z0-9-]*)\\b[^>]*>(.*?)<\\/\\1>',
    flags: 'gi',
    description: 'An opening tag, its content and the matching closing tag (via the back-reference \\1).',
    kind: 'find',
    sample: 'Say <b>hello</b> to <a href="/x">the link</a> and <br> <em>you</em>.',
    expected: ['<b>hello</b>', '<a href="/x">the link</a>', '<em>you</em>'],
    note: 'Regular expressions cannot parse nested HTML; use DOMParser for real documents.',
  },
  {
    id: 'ipv4',
    name: 'IPv4 address',
    category: 'Network',
    pattern: `^(?:${OCTET}\\.){3}${OCTET}$`,
    flags: '',
    description: 'Four decimal octets from 0 to 255, without leading zeros.',
    kind: 'validate',
    examples: {
      match: ['192.168.0.1', '255.255.255.255', '0.0.0.0', '10.0.12.9'],
      noMatch: ['256.1.1.1', '1.2.3', '01.2.3.4', '1.2.3.4.5', '1.2.3.-4'],
    },
  },
  {
    id: 'ipv6',
    name: 'IPv6 address',
    category: 'Network',
    pattern:
      `^(?:(?:${H}:){7}${H}|(?:${H}:){1,7}:|(?:${H}:){1,6}:${H}|(?:${H}:){1,5}(?::${H}){1,2}|(?:${H}:){1,4}(?::${H}){1,3}` +
      `|(?:${H}:){1,3}(?::${H}){1,4}|(?:${H}:){1,2}(?::${H}){1,5}|${H}:(?::${H}){1,6}|:(?:(?::${H}){1,7}|:))$`,
    flags: '',
    description: 'Full and "::"-compressed IPv6 notation.',
    kind: 'validate',
    examples: {
      match: ['2001:0db8:85a3:0000:0000:8a2e:0370:7334', '2001:db8::1', '::1', '::', 'fe80::1:2', '1::'],
      noMatch: ['2001:db8::1::2', '12345::1', 'gggg::1', '1:2:3:4:5:6:7:8:9', '192.168.0.1'],
    },
    note: 'Does not accept embedded IPv4 (::ffff:1.2.3.4) or zone ids (%eth0).',
  },
  {
    id: 'mac',
    name: 'MAC address',
    category: 'Network',
    pattern: '^[0-9A-Fa-f]{2}([:-])(?:[0-9A-Fa-f]{2}\\1){4}[0-9A-Fa-f]{2}$',
    flags: '',
    description: 'Six hex pairs separated consistently by ":" or "-" (the back-reference \\1 repeats the first separator).',
    kind: 'validate',
    examples: {
      match: ['00:1A:2b:3C:4d:5E', '00-1a-2b-3c-4d-5e'],
      noMatch: ['00:1A-2b:3C:4d:5E', '001A2b3C4d5E', '00:1A:2b:3C:4d', 'GG:1A:2b:3C:4d:5E'],
    },
  },
  {
    id: 'port',
    name: 'Port number',
    category: 'Network',
    pattern: '^(?:6553[0-5]|655[0-2]\\d|65[0-4]\\d{2}|6[0-4]\\d{3}|[1-5]\\d{4}|[1-9]\\d{0,3}|0)$',
    flags: '',
    description: 'A TCP/UDP port from 0 to 65535, without leading zeros.',
    kind: 'validate',
    examples: { match: ['0', '80', '443', '8080', '65535'], noMatch: ['65536', '080', '-1', '99999'] },
  },
  {
    id: 'uuid',
    name: 'UUID',
    category: 'Identifiers',
    pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',
    flags: 'i',
    description: 'RFC 9562 UUID, versions 1 to 8, with the standard variant bits.',
    kind: 'validate',
    examples: {
      match: ['123e4567-e89b-12d3-a456-426614174000', '0190a6f2-7c4b-7e1d-8f3a-2b5c6d7e8f90', 'F47AC10B-58CC-4372-A567-0E02B2C3D479'],
      noMatch: ['123e4567e89b12d3a456426614174000', '123e4567-e89b-02d3-a456-426614174000', '123e4567-e89b-12d3-c456-426614174000'],
    },
    note: 'The nil (all zeros) and max (all f) UUIDs are not matched.',
  },
  {
    id: 'semver',
    name: 'Semantic version',
    category: 'Identifiers',
    pattern:
      `^(?<major>0|[1-9]\\d*)\\.(?<minor>0|[1-9]\\d*)\\.(?<patch>0|[1-9]\\d*)` +
      `(?:-(?<prerelease>${SEMVER_ID}(?:\\.${SEMVER_ID})*))?(?:\\+(?<build>[0-9a-zA-Z-]+(?:\\.[0-9a-zA-Z-]+)*))?$`,
    flags: '',
    description: 'semver.org 2.0.0 versions, with named groups for each part.',
    kind: 'validate',
    examples: {
      match: ['1.0.0', '0.2.10', '1.0.0-alpha.1', '2.3.4-rc.1+build.5', '1.0.0+20240101'],
      noMatch: ['1.0', 'v1.0.0', '01.0.0', '1.0.0-01', '1.0.0-'],
    },
  },
  {
    id: 'username',
    name: 'Username',
    category: 'Identifiers',
    pattern: '^[a-zA-Z0-9_]{3,16}$',
    flags: '',
    description: '3 to 16 letters, digits or underscores.',
    kind: 'validate',
    examples: { match: ['alice', 'bob_42', 'ABC'], noMatch: ['al', 'this_name_is_way_too_long', 'bad name', 'émile'] },
  },
  {
    id: 'password',
    name: 'Strong password rule',
    category: 'Identifiers',
    pattern: '^(?=.*[a-z])(?=.*[A-Z])(?=.*\\d)(?=.*[^A-Za-z0-9\\s]).{8,}$',
    flags: '',
    description:
      'At least 8 characters with a lowercase letter, an uppercase letter, a digit and a symbol (one lookahead per rule).',
    kind: 'validate',
    examples: { match: ['Passw0rd!', 'a1!Bcdefg'], noMatch: ['password', 'Password1', 'Sh0rt!', 'PASSWORD1!'] },
    note: 'Length matters more than character classes; prefer a strength estimator for real sign-up forms.',
  },
  {
    id: 'jwt',
    name: 'JSON Web Token',
    category: 'Identifiers',
    pattern: '^[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]*$',
    flags: '',
    description: 'Three base64url segments separated by dots (the signature may be empty for unsigned tokens).',
    kind: 'validate',
    examples: {
      match: ['eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl', 'eyJhbGciOiJub25lIn0.eyJzdWIiOiIxIn0.'],
      noMatch: ['eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0', 'a.b.c.d', 'a+b.c.d'],
    },
  },
  {
    id: 'base64',
    name: 'Base64',
    category: 'Identifiers',
    pattern: '^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$',
    flags: '',
    description: 'Standard padded Base64 (RFC 4648 alphabet); the empty string is valid Base64.',
    kind: 'validate',
    examples: { match: ['SGVsbG8=', 'SGVsbG8h', 'SGk=', 'YQ=='], noMatch: ['SGVsbG8', 'SGVsbG8==', 'SGV$bG8=', 'YQ='] },
  },
  {
    id: 'iso-date',
    name: 'ISO 8601 date',
    category: 'Dates & times',
    pattern: `^${DATE}$`,
    flags: '',
    description: 'A calendar date written YYYY-MM-DD.',
    kind: 'validate',
    examples: { match: ['2024-02-29', '1999-12-31', '2026-01-01'], noMatch: ['2024-13-01', '2024-00-10', '2024-1-5', '24-01-01', '2024/01/01'] },
    note: 'Checks the shape only: 2023-02-30 still matches, so confirm real dates with a date library.',
  },
  {
    id: 'iso-datetime',
    name: 'ISO 8601 date and time',
    category: 'Dates & times',
    pattern: `^${DATE}T(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|[+-](?:[01]\\d|2[0-3]):?[0-5]\\d)?$`,
    flags: '',
    description: 'Date, "T", time with optional seconds and fraction, and an optional Z or ±hh:mm offset.',
    kind: 'validate',
    examples: {
      match: ['2024-05-01T13:45', '2024-05-01T13:45:30Z', '2024-05-01T13:45:30.123+02:00', '2024-05-01T00:00:00-0530'],
      noMatch: ['2024-05-01 13:45', '2024-05-01T24:00', '2024-05-01T13:60', '2024-05-01T13:45+2'],
    },
  },
  {
    id: 'time-24h',
    name: 'Time (24-hour)',
    category: 'Dates & times',
    pattern: '^(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d)?$',
    flags: '',
    description: 'HH:MM or HH:MM:SS from 00:00 to 23:59:59.',
    kind: 'validate',
    examples: { match: ['00:00', '09:30', '23:59:59'], noMatch: ['24:00', '9:30', '12:60', '12:30:60'] },
  },
  {
    id: 'number',
    name: 'Decimal number',
    category: 'Numbers',
    pattern: '^[+-]?(?:\\d+\\.?\\d*|\\.\\d+)(?:[eE][+-]?\\d+)?$',
    flags: '',
    description: 'Integers and decimals with an optional sign and exponent.',
    kind: 'validate',
    examples: { match: ['42', '-3.14', '+.5', '1e10', '6.02E-23', '7.'], noMatch: ['.', '1.2.3', 'e5', '1e', '12a'] },
  },
  {
    id: 'phone-e164',
    name: 'Phone number (E.164)',
    category: 'Numbers',
    pattern: '^\\+[1-9]\\d{1,14}$',
    flags: '',
    description: 'International format: "+", country code and up to 15 digits in total, no spaces.',
    kind: 'validate',
    examples: { match: ['+14155552671', '+442071838750', '+84912345678'], noMatch: ['14155552671', '+0123456', '+1 415 555 2671', '+1234567890123456'] },
  },
  {
    id: 'zip-us',
    name: 'US ZIP code',
    category: 'Numbers',
    pattern: '^\\d{5}(?:-\\d{4})?$',
    flags: '',
    description: 'Five digits with an optional ZIP+4 extension.',
    kind: 'validate',
    examples: { match: ['94103', '94103-1234'], noMatch: ['9410', '941031', '94103-12', 'ABCDE'] },
  },
  {
    id: 'duplicate-words',
    name: 'Repeated words',
    category: 'Text',
    pattern: '\\b(\\w+)\\s+\\1\\b',
    flags: 'gi',
    description: 'A word immediately repeated, like "the the" (the back-reference \\1 must equal the first word).',
    kind: 'find',
    sample: 'This is is a test of the the tool. Then then we stop; this his is fine.',
    expected: ['is is', 'the the', 'Then then'],
  },
  {
    id: 'quoted-string',
    name: 'Double-quoted string',
    category: 'Text',
    pattern: '"(?:[^"\\\\\\n]|\\\\.)*"',
    flags: 'g',
    description: 'Text between double quotes, allowing backslash escapes such as \\" inside.',
    kind: 'find',
    sample: 'say "hello" and "a \\"quoted\\" word" but not "unclosed',
    expected: ['"hello"', '"a \\"quoted\\" word"'],
  },
  {
    id: 'trailing-space',
    name: 'Trailing whitespace',
    category: 'Text',
    pattern: '[ \\t]+$',
    flags: 'gm',
    description: 'Spaces and tabs at the end of each line (the m flag makes $ match at every line end).',
    kind: 'find',
    sample: 'clean line\nline with spaces   \nline with tab\t\nlast',
    expected: ['   ', '\t'],
  },
  {
    id: 'emoji',
    name: 'Emoji',
    category: 'Text',
    pattern: '\\p{Extended_Pictographic}(?:\\uFE0F|\\u200D\\p{Extended_Pictographic})*',
    flags: 'gu',
    description: 'Pictographic emoji, including ZWJ sequences like 👩‍💻 (needs the u flag for \\p{...}).',
    kind: 'find',
    sample: 'Ship it 🚀, then celebrate 🎉 with the team 👩‍💻 ❤️!',
    expected: ['🚀', '🎉', '👩‍💻', '❤️'],
    note: 'Skin-tone modifiers, flags and keycaps need \\p{RGI_Emoji} with the v flag.',
  },
  {
    id: 'hashtag',
    name: 'Hashtags',
    category: 'Text',
    pattern: '(?<![\\p{L}\\p{N}_])#[\\p{L}\\p{N}_]+',
    flags: 'gu',
    description: 'A # followed by letters, digits or underscores in any script, not preceded by a word character.',
    kind: 'find',
    sample: 'Loving #LocalKit and #café_2024! Not a#tag, but #日本 works.',
    expected: ['#LocalKit', '#café_2024', '#日本'],
  },
];

export const PATTERN_CATEGORIES: PatternCategory[] = ['Web', 'Network', 'Identifiers', 'Dates & times', 'Numbers', 'Text'];

/** Text to load into the tester: the examples one per line, or the find sample. */
export function patternSampleText(p: CommonPattern): string {
  if (p.kind === 'find') return p.sample ?? '';
  return [...(p.examples?.match ?? []), ...(p.examples?.noMatch ?? [])].join('\n');
}

/**
 * Flags to use in the tester. Anchored validation patterns are tested one
 * example per line, which needs `g` (all lines) and `m` (^ and $ per line).
 */
export function patternTesterFlags(p: CommonPattern): string {
  if (p.kind === 'find') return p.flags;
  const set = new Set(p.flags + 'gm');
  return 'dgimsuvy'.split('').filter((f) => set.has(f)).join('');
}
