import { codePointLabel, countCodePoints, countGraphemes, graphemes, stripDiacritics, utf8Length } from './common';

export type NormalForm = 'NFC' | 'NFD' | 'NFKC' | 'NFKD' | 'none';

export interface NormalizeOptions {
  form: NormalForm;
  removeDiacritics: boolean;
}

/**
 * Remove Latin, Greek and Cyrillic accents (é → e) and recompose. Marks that belong to other
 * scripts (Devanagari, Hebrew points, Japanese voicing marks) and emoji selectors are kept.
 */
export function removeDiacritics(text: string): string {
  return stripDiacritics(text);
}

export function normalizeText(text: string, o: NormalizeOptions): string {
  let out = text;
  if (o.removeDiacritics) out = removeDiacritics(out);
  if (o.form !== 'none') out = out.normalize(o.form);
  return out;
}

export interface NormalizeSegment {
  before: string;
  after: string;
  changed: boolean;
}

/** Per-grapheme comparison used to highlight which characters changed. */
export function normalizeSegments(text: string, o: NormalizeOptions): NormalizeSegment[] {
  return graphemes(text).map((g) => {
    const after = normalizeText(g, o);
    return { before: g, after, changed: after !== g };
  });
}

export interface StringMeasure {
  codePoints: number;
  utf16: number;
  bytes: number;
  graphemes: number;
}

export function measure(text: string): StringMeasure {
  return { codePoints: countCodePoints(text), utf16: text.length, bytes: utf8Length(text), graphemes: countGraphemes(text) };
}

export function isNormalized(text: string, form: Exclude<NormalForm, 'none'>): boolean {
  return text.normalize(form) === text;
}

/** Characters inspected for the "changed characters" list and highlights. */
export const ANALYZE_LIMIT = 100_000;

export interface NormalizationReport {
  output: string;
  before: StringMeasure;
  after: StringMeasure;
  /** Changed characters within the first `analyzedChars` characters of the input. */
  ranges: Array<{ start: number; end: number; title: string }>;
  changes: Array<{ before: string; after: string; count: number }>;
  changed: number;
  /** How much of the input the ranges and changes cover (all of it for texts up to ANALYZE_LIMIT). */
  analyzedChars: number;
}

/** Normalize the text and describe what changed (the per-character analysis is capped for huge texts). */
export function analyzeNormalization(text: string, o: NormalizeOptions): NormalizationReport {
  const output = normalizeText(text, o);
  let limit = Math.min(text.length, ANALYZE_LIMIT);
  const code = text.charCodeAt(limit - 1);
  if (limit < text.length && code >= 0xd800 && code <= 0xdbff) limit--;
  const ranges: NormalizationReport['ranges'] = [];
  const changes = new Map<string, { before: string; after: string; count: number }>();
  let offset = 0;
  for (const s of normalizeSegments(text.slice(0, limit), o)) {
    if (s.changed) {
      ranges.push({ start: offset, end: offset + s.before.length, title: `${codePointLabel(s.before)} → ${codePointLabel(s.after) || 'removed'}` });
      const entry = changes.get(s.before);
      if (entry) entry.count++;
      else changes.set(s.before, { before: s.before, after: s.after, count: 1 });
    }
    offset += s.before.length;
  }
  return {
    output,
    before: measure(text),
    after: measure(output),
    ranges,
    changes: Array.from(changes.values()).sort((a, b) => b.count - a.count),
    changed: ranges.length,
    analyzedChars: limit,
  };
}
