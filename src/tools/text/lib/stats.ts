import { countGraphemes, forEachGrapheme, sentences, splitLines, utf8Length, words } from './common';

export interface TextStats {
  /** User-perceived characters (grapheme clusters): an emoji or an accented letter counts once. */
  characters: number;
  /** Characters that are not whitespace. */
  charactersNoSpaces: number;
  codePoints: number;
  utf16Units: number;
  words: number;
  uniqueWords: number;
  sentences: number;
  paragraphs: number;
  lines: number;
  bytes: number;
  /** Minutes at `READING_WPM`. */
  readingMinutes: number;
  /** Minutes at `SPEAKING_WPM`. */
  speakingMinutes: number;
  /** Average characters (graphemes) per word. */
  avgWordLength: number;
  avgSentenceWords: number;
  longestWord: string;
}

export const READING_WPM = 238;
export const SPEAKING_WPM = 150;

/** JavaScript's \s: the Unicode White_Space characters, line terminators and U+FEFF. */
export function isWhitespaceCode(c: number): boolean {
  return (
    c === 0x20 ||
    (c >= 0x09 && c <= 0x0d) ||
    c === 0xa0 ||
    c === 0x1680 ||
    (c >= 0x2000 && c <= 0x200a) ||
    c === 0x2028 ||
    c === 0x2029 ||
    c === 0x202f ||
    c === 0x205f ||
    c === 0x3000 ||
    c === 0xfeff
  );
}

function isWhitespaceOnly(segment: string): boolean {
  for (let i = 0; i < segment.length; i++) if (!isWhitespaceCode(segment.charCodeAt(i))) return false;
  return true;
}

export function textStats(text: string): TextStats {
  let characters = 0;
  let spaces = 0;
  forEachGrapheme(text, (segment) => {
    characters++;
    if (isWhitespaceOnly(segment)) spaces++;
  });
  let codePoints = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) i++;
    }
    codePoints++;
  }
  const wordList = words(text);
  let longestWord = '';
  let longestLen = 0;
  let letters = 0;
  const unique = new Set<string>();
  for (const { word } of wordList) {
    const len = countGraphemes(word);
    letters += len;
    unique.add(word.toLowerCase());
    if (len > longestLen) {
      longestLen = len;
      longestWord = word;
    }
  }
  const sentenceCount = sentences(text).length;
  const paragraphs = text.split(/(?:\r\n|\r|\n)[ \t]*(?:\r\n|\r|\n)\s*/).filter((p) => p.trim() !== '').length;
  return {
    characters,
    charactersNoSpaces: characters - spaces,
    codePoints,
    utf16Units: text.length,
    words: wordList.length,
    uniqueWords: unique.size,
    sentences: sentenceCount,
    paragraphs,
    lines: splitLines(text).lines.length,
    bytes: utf8Length(text),
    readingMinutes: wordList.length / READING_WPM,
    speakingMinutes: wordList.length / SPEAKING_WPM,
    avgWordLength: wordList.length ? letters / wordList.length : 0,
    avgSentenceWords: sentenceCount ? wordList.length / sentenceCount : 0,
    longestWord,
  };
}

/** "< 1 min", "3 min", "1 h 12 min", or seconds for short texts. */
export function formatMinutes(minutes: number): string {
  if (minutes <= 0) return '0 sec';
  const seconds = Math.round(minutes * 60);
  if (seconds < 60) return `${Math.max(1, seconds)} sec`;
  const total = Math.round(minutes);
  if (total < 60) return `${total} min`;
  const h = Math.floor(total / 60);
  const m = total % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}
