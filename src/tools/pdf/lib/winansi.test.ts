import { describe, expect, it } from 'vitest';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { isWinAnsi, unsupportedCharacters } from './winansi';

describe('WinAnsi (standard PDF font) check', () => {
  it('agrees with what pdf-lib can actually encode with Helvetica', async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const mismatches: string[] = [];
    for (let cp = 0; cp <= 0x3000; cp++) {
      let encodable = true;
      try {
        font.encodeText(String.fromCodePoint(cp));
      } catch {
        encodable = false;
      }
      if (encodable !== isWinAnsi(cp)) mismatches.push(`U+${cp.toString(16)} pdf-lib=${encodable}`);
    }
    expect(mismatches).toEqual([]);
  });

  it('lists each unsupported character once, in order', () => {
    expect(unsupportedCharacters('Page {n} of {total}')).toEqual([]);
    expect(unsupportedCharacters('Página {n} — “ok” €')).toEqual([]);
    expect(unsupportedCharacters('第 {n} 页 第')).toEqual(['第', '页']);
    expect(unsupportedCharacters('ΕΛΛΑΣ')).toEqual(['Ε', 'Λ', 'Α', 'Σ']);
    expect(unsupportedCharacters('Draft 🎉')).toEqual(['🎉']);
    expect(unsupportedCharacters('tab\there')).toEqual(['\t']);
  });
});
