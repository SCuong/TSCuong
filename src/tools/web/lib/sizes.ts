export interface SizeSavings {
  before: number;
  after: number;
  saved: number;
  /** Fraction saved, 0–1 (negative when the output grew). */
  ratio: number;
}

export function byteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

export function sizeSavings(before: string, after: string): SizeSavings {
  const b = byteLength(before);
  const a = byteLength(after);
  return { before: b, after: a, saved: b - a, ratio: b === 0 ? 0 : (b - a) / b };
}

/** 1-based line and column of a character offset. */
export function lineColumn(text: string, offset: number): { line: number; column: number } {
  let line = 1;
  let lastBreak = -1;
  for (let i = 0; i < offset && i < text.length; i++) {
    if (text.charCodeAt(i) === 10) {
      line++;
      lastBreak = i;
    }
  }
  return { line, column: offset - lastBreak };
}
