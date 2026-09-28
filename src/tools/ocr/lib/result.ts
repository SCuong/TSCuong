/** Pure helpers for tesseract.js results (unit tested without the engine). */

export interface OcrBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface OcrWordResult {
  text: string;
  confidence: number;
  bbox: OcrBox;
}

export interface OcrLineResult {
  text: string;
  confidence: number;
  bbox: OcrBox;
  words: OcrWordResult[];
}

export interface OcrPageResult {
  text: string;
  /** Mean word confidence, 0–100 (NaN-safe: 0 when there are no words). */
  confidence: number;
  lines: OcrLineResult[];
  width: number;
  height: number;
}

/** Minimal structural type of tesseract.js blocks output. */
export interface TesseractBlock {
  paragraphs?: Array<{
    lines?: Array<{
      text?: string;
      confidence?: number;
      bbox: OcrBox;
      words?: Array<{ text?: string; confidence?: number; bbox: OcrBox }>;
    }>;
  }>;
}

export function flattenBlocks(blocks: TesseractBlock[] | null | undefined): OcrLineResult[] {
  const lines: OcrLineResult[] = [];
  for (const block of blocks ?? []) {
    for (const para of block.paragraphs ?? []) {
      for (const line of para.lines ?? []) {
        const words = (line.words ?? [])
          .map((w) => ({ text: (w.text ?? '').trim(), confidence: w.confidence ?? 0, bbox: w.bbox }))
          .filter((w) => w.text.length > 0);
        if (!words.length) continue;
        lines.push({
          text: words.map((w) => w.text).join(' '),
          confidence: line.confidence ?? meanConfidence(words),
          bbox: line.bbox,
          words,
        });
      }
    }
  }
  return lines;
}

export function meanConfidence(words: Array<{ confidence: number }>): number {
  if (!words.length) return 0;
  return words.reduce((sum, w) => sum + (Number.isFinite(w.confidence) ? w.confidence : 0), 0) / words.length;
}

export type ConfidenceLevel = 'high' | 'medium' | 'low';

export function confidenceLevel(confidence: number): ConfidenceLevel {
  if (confidence >= 85) return 'high';
  if (confidence >= 60) return 'medium';
  return 'low';
}

/** Tidy text from tesseract: trim trailing spaces, collapse 3+ blank lines. */
export function cleanText(text: string): string {
  return text
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
