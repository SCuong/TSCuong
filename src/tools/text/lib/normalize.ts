import { graphemes, utf8Length } from './common';

export type NormalForm = 'NFC' | 'NFD' | 'NFKC' | 'NFKD' | 'none';

export interface NormalizeOptions {
  form: NormalForm;
  removeDiacritics: boolean;
}

/** Remove combining accent marks (Mn) while keeping base letters, then recompose. */
export function removeDiacritics(text: string): string {
  return text.normalize('NFD').replace(/\p{Mn}/gu, '').normalize('NFC');
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
  let codePoints = 0;
  for (const _ of text) codePoints++;
  return { codePoints, utf16: text.length, bytes: utf8Length(text), graphemes: graphemes(text).length };
}

export function isNormalized(text: string, form: Exclude<NormalForm, 'none'>): boolean {
  return text.normalize(form) === text;
}
