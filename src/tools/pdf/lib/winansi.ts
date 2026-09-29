/**
 * Characters the standard PDF fonts (Helvetica & co., WinAnsiEncoding) can draw: printable ASCII,
 * Latin-1 and the Windows-1252 extras in 0x80–0x9F. Used to validate page-number formats and
 * watermark text before running, so the user sees the problem while typing.
 */
const CP1252_EXTRAS = '€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ';
const EXTRA = new Set(Array.from(CP1252_EXTRAS, (ch) => ch.codePointAt(0)!));

export function isWinAnsi(codePoint: number): boolean {
  return (codePoint >= 0x20 && codePoint <= 0x7e) || (codePoint >= 0xa0 && codePoint <= 0xff) || EXTRA.has(codePoint);
}

/** Distinct characters of `text` that the standard fonts cannot draw, in order of appearance. */
export function unsupportedCharacters(text: string): string[] {
  const out: string[] = [];
  for (const ch of text) {
    if (!isWinAnsi(ch.codePointAt(0)!) && !out.includes(ch)) out.push(ch);
  }
  return out;
}
