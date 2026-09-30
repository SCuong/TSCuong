// Fails if source files contain literal bidirectional controls ("Trojan Source",
// CVE-2021-42574) or other invisible characters. Write them as escapes instead
// (e.g. backslash-u-FEFF). A zero-width joiner is allowed only inside an emoji
// sequence, where it is part of one visible glyph (family and profession emoji).
//
// This file deliberately builds every character from its numeric code point so
// that it contains none of the characters it looks for.
// Usage: node scripts/check-invisible.mjs
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOTS = ['src', 'e2e', 'scripts', 'companion', 'docs'];
const EXTENSIONS = /\.(?:[cm]?[jt]sx?|css|html|md|json)$/;

const range = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => from + i);
/** Embeddings, overrides, isolates: can visually reorder code. Never allowed. */
const BIDI = new Set([...range(0x202a, 0x202e), ...range(0x2066, 0x2069)]);
/** Invisible characters that must be written as escapes. */
const INVISIBLE = new Set([0x200b, 0x200c, 0x200d, 0x200e, 0x200f, 0x2060, 0xfeff, 0x00ad]);
const ZWJ = 0x200d;
const VARIATION_SELECTOR_16 = 0xfe0f;
const isSkinTone = (cp) => cp >= 0x1f3fb && cp <= 0x1f3ff;
const pictographic = /\p{Extended_Pictographic}/u;

function isEmojiJoiner(chars, i) {
  let before = i - 1;
  while (before >= 0 && (chars[before] === VARIATION_SELECTOR_16 || isSkinTone(chars[before]))) before--;
  const after = chars[i + 1];
  return (
    before >= 0 &&
    after !== undefined &&
    pictographic.test(String.fromCodePoint(chars[before])) &&
    pictographic.test(String.fromCodePoint(after))
  );
}

const root = fileURLToPath(new URL('..', import.meta.url));
const problems = [];

function scan(path) {
  const lines = readFileSync(path, 'utf8').split('\n');
  lines.forEach((line, lineIndex) => {
    const chars = Array.from(line, (c) => c.codePointAt(0));
    chars.forEach((cp, i) => {
      if (!BIDI.has(cp) && !INVISIBLE.has(cp)) return;
      if (cp === ZWJ && isEmojiJoiner(chars, i)) return;
      const hex = cp.toString(16).toUpperCase().padStart(4, '0');
      problems.push(`${relative(root, path)}:${lineIndex + 1}:${i + 1} U+${hex}${BIDI.has(cp) ? ' (bidi control)' : ''}`);
    });
  });
}

function walk(dir) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path);
    else if (EXTENSIONS.test(name)) scan(path);
  }
}

for (const dir of ROOTS) {
  try {
    walk(join(root, dir));
  } catch {
    // folder not present
  }
}

if (problems.length) {
  console.log(`Literal invisible or bidi characters found (write them as escapes):\n  ${problems.join('\n  ')}`);
  process.exitCode = 1;
} else {
  console.log('No literal invisible or bidi characters in source.');
}
