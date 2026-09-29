import { describe, expect, it } from 'vitest';
import { assertPdfBytes, hasPdfHeader, headerVersion, isLinearized, looksEncrypted } from './bytes';
import { PdfError, toPdfError, unsupportedCharacterMessage } from './errors';
import { makePdf } from './fixtures.test-util';

const enc = (s: string) => new TextEncoder().encode(s);

describe('PDF byte checks', () => {
  it('finds the header, also after leading junk', () => {
    expect(hasPdfHeader(enc('%PDF-1.7\n...'))).toBe(true);
    expect(hasPdfHeader(enc('garbage\n%PDF-1.4\n'))).toBe(true);
    expect(hasPdfHeader(enc(' '.repeat(2000) + '%PDF-1.4'))).toBe(false);
    expect(headerVersion(enc('%PDF-2.0\n'))).toBe('2.0');
    expect(headerVersion(enc('nope'))).toBeNull();
  });

  it('detects linearization and encryption markers', () => {
    expect(isLinearized(enc('%PDF-1.7\n1 0 obj\n<< /Linearized 1 /L 1234 >>'))).toBe(true);
    expect(isLinearized(enc('%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>'))).toBe(false);
    expect(looksEncrypted(enc('%PDF-1.7\ntrailer\n<< /Root 1 0 R /Encrypt 5 0 R >>'))).toBe(true);
    expect(looksEncrypted(enc('%PDF-1.7\ntrailer\n<< /Root 1 0 R >>'))).toBe(false);
  });

  it('works on a real generated PDF', async () => {
    const pdf = await makePdf(2);
    expect(hasPdfHeader(pdf)).toBe(true);
    expect(looksEncrypted(pdf)).toBe(false);
    expect(() => assertPdfBytes(pdf)).not.toThrow();
  });

  it('explains empty and non-PDF files', () => {
    expect(() => assertPdfBytes(new Uint8Array(), 'a.pdf')).toThrow(/"a.pdf" is empty/);
    expect(() => assertPdfBytes(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 1, 2]), 'x.pdf')).toThrow(/looks like a PNG image/);
    expect(() => assertPdfBytes(enc('PK\u0003\u0004'), 'x.pdf')).toThrow(/ZIP/);
    expect(() => assertPdfBytes(enc('hello'), 'x.pdf')).toThrow(/not a PDF/);
  });
});

describe('toPdfError', () => {
  it('maps pdf.js password errors', () => {
    const need = Object.assign(new Error('No password given'), { name: 'PasswordException', code: 1 });
    const wrong = Object.assign(new Error('Incorrect Password'), { name: 'PasswordException', code: 2 });
    expect(toPdfError(need, 'a.pdf').kind).toBe('password');
    expect(toPdfError(wrong).kind).toBe('wrong-password');
  });

  it('maps pdf-lib encryption and font errors', () => {
    expect(toPdfError(new Error('Input document to `PDFDocument.load` is encrypted.')).kind).toBe('encrypted');
    const font = toPdfError(new Error('WinAnsi cannot encode "中" (0x4e2d)'));
    expect(font.kind).toBe('font');
    expect(font.message).toContain('"中" (U+4E2D)');
  });

  it('names look-alike and astral characters by code point', () => {
    // Greek capital epsilon looks exactly like "E": the code point makes the message understandable.
    expect(toPdfError(new Error('WinAnsi cannot encode "Ε" (0x0395)')).message).toContain('"Ε" (U+0395)');
    // pdf-lib quotes a broken character for emoji (String.fromCharCode); rebuild it from the hex code.
    expect(toPdfError(new Error('WinAnsi cannot encode "\uf389" (0x1f389)')).message).toContain('"🎉" (U+1F389)');
  });

  it('maps invalid PDFs and cancellation', () => {
    expect(toPdfError(Object.assign(new Error('Invalid PDF structure.'), { name: 'InvalidPDFException' }), 'b.pdf').message).toMatch(
      /"b.pdf" appears to be damaged/,
    );
    expect(toPdfError(new DOMException('x', 'AbortError')).kind).toBe('cancelled');
  });

  it('keeps PdfErrors and shortens long messages', () => {
    const e = new PdfError('empty', 'Empty');
    expect(toPdfError(e)).toBe(e);
    const long = toPdfError(new Error('x'.repeat(500) + '\nstack'));
    expect(long.message.length).toBeLessThanOrEqual(180);
    expect(toPdfError(undefined).message).toMatch(/Something went wrong/);
  });
});

describe('unsupportedCharacterMessage', () => {
  it('lists up to three characters with code points', () => {
    expect(unsupportedCharacterMessage(['中'])).toBe(
      'The built-in PDF font cannot draw the character "中" (U+4E2D). Use Latin letters, digits and common punctuation.',
    );
    expect(unsupportedCharacterMessage(['a', 'b', 'c', 'd'])).toContain('the characters "a" (U+0061), "b" (U+0062), "c" (U+0063)…');
    expect(unsupportedCharacterMessage([])).toMatch(/some of these characters/);
  });
});
