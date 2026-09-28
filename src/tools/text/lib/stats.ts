import { countGraphemes, sentences, splitLines, utf8Length, words } from './common';

export interface TextStats {
  characters: number;
  charactersNoSpaces: number;
  graphemes: number;
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
  avgWordLength: number;
  avgSentenceWords: number;
  longestWord: string;
}

export const READING_WPM = 238;
export const SPEAKING_WPM = 150;

export function textStats(text: string): TextStats {
  let characters = 0;
  let nonSpace = 0;
  for (const ch of text) {
    characters++;
    if (!/\s/u.test(ch)) nonSpace++;
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
    charactersNoSpaces: nonSpace,
    graphemes: countGraphemes(text),
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
