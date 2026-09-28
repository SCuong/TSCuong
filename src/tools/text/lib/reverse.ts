import { graphemes, joinLines, splitLines } from './common';

export type ReverseMode = 'characters' | 'words' | 'lines' | 'wordLetters';

export interface ReverseOptions {
  mode: ReverseMode;
  /** For character and word modes: reverse each line on its own instead of the whole text. */
  perLine: boolean;
}

/** Reverse user-perceived characters, so emoji (👩‍👩‍👧, 🇻🇳) and accents stay intact. */
export function reverseGraphemes(text: string): string {
  return graphemes(text).reverse().join('');
}

/** Reverse the order of words; whitespace runs move with the tokens so spacing stays symmetric. */
export function reverseWords(text: string): string {
  const tokens = text.split(/(\s+)/u).filter((t) => t !== '');
  return tokens.reverse().join('');
}

/** Reverse the letters of each word but keep word order and punctuation positions. */
export function reverseEachWord(text: string): string {
  return text.replace(/[\p{L}\p{N}\p{M}]+/gu, (w) => reverseGraphemes(w));
}

export function reverseText(text: string, o: ReverseOptions): string {
  if (!text) return '';
  const { lines, trailingNewline, eol } = splitLines(text);
  switch (o.mode) {
    case 'lines':
      return joinLines(lines.slice().reverse(), eol, trailingNewline);
    case 'wordLetters':
      return reverseEachWord(text);
    case 'characters':
      if (o.perLine) return joinLines(lines.map(reverseGraphemes), eol, trailingNewline);
      // Treat CRLF as one unit so line endings survive reversal.
      return reverseGraphemes(text);
    case 'words':
      if (o.perLine) return joinLines(lines.map(reverseWords), eol, trailingNewline);
      return reverseWords(text);
  }
}
