/**
 * Friendly, typed errors for PDF input. Everything thrown to the UI from the PDF
 * pipeline is (or is mapped to) a `PdfError` with a human sentence.
 */
export type PdfErrorKind =
  | 'empty'
  | 'not-pdf'
  | 'encrypted'
  | 'password'
  | 'wrong-password'
  | 'corrupt'
  | 'font'
  | 'memory'
  | 'cancelled'
  | 'invalid-input'
  | 'unknown';

export class PdfError extends Error {
  readonly kind: PdfErrorKind;
  constructor(kind: PdfErrorKind, message: string) {
    super(message);
    this.name = 'PdfError';
    this.kind = kind;
  }
}

/** Serializable form used by the worker protocol. */
export interface PdfErrorData {
  kind: PdfErrorKind;
  message: string;
}

export function isPdfError(error: unknown): error is PdfError {
  return error instanceof PdfError;
}

const ENCRYPTED_MESSAGE =
  'This PDF is encrypted (it has a password or permission restrictions). The in-browser PDF editor cannot decrypt it, so edited output may be blank or unreadable.';

/**
 * Map anything thrown by pdf-lib, pdf.js or the browser into a PdfError with a
 * user-facing message. Never exposes stack traces.
 */
export function toPdfError(error: unknown, fileName?: string): PdfError {
  if (error instanceof PdfError) return error;
  const subject = fileName ? `"${fileName}"` : 'This file';
  const name = (error as { name?: string } | null)?.name ?? '';
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  const code = (error as { code?: number } | null)?.code;

  if (name === 'AbortError' || name === 'AbortException' || name === 'RenderingCancelledException') {
    return new PdfError('cancelled', 'The operation was cancelled.');
  }
  if (name === 'PasswordException') {
    return code === 2
      ? new PdfError('wrong-password', 'That password is not correct. Try again.')
      : new PdfError('password', `${subject} is protected with a password. Enter it to open the document.`);
  }
  if (/is encrypted/i.test(message) || name === 'EncryptedPDFError') {
    return new PdfError('encrypted', ENCRYPTED_MESSAGE);
  }
  if (name === 'InvalidPDFException' || /Invalid PDF structure|No PDF header|Failed to parse PDF/i.test(message)) {
    return new PdfError('corrupt', `${subject} appears to be damaged and could not be read as a PDF.`);
  }
  if (/cannot encode|WinAnsi cannot encode/i.test(message)) {
    const ch = /cannot encode "(.+?)"/.exec(message)?.[1];
    return new PdfError(
      'font',
      `The built-in PDF font cannot draw ${ch ? `the character "${ch}"` : 'some of these characters'}. Use Latin letters, digits and common punctuation.`,
    );
  }
  if (
    (error instanceof RangeError && /array buffer|allocation|memory|invalid array length/i.test(message)) ||
    /out of memory/i.test(message)
  ) {
    return new PdfError('memory', 'The file is too large to process in this browser (it ran out of memory).');
  }
  if (
    /Expected instance of|Failed to parse|parse|Invalid object|Unexpected|Trying to parse|Invalid (PDF )?(stream|dictionary|xref)|MissingCatalog|PDFParsing|not found in/i.test(
      message,
    ) ||
    /Parsing|Catalog|PageTree/i.test(name)
  ) {
    return new PdfError('corrupt', `${subject} appears to be damaged: ${shorten(message)}`);
  }
  return new PdfError('unknown', message ? shorten(message) : 'Something went wrong while processing the PDF.');
}

function shorten(message: string): string {
  const firstLine = message.split('\n')[0].trim();
  return firstLine.length > 180 ? `${firstLine.slice(0, 177)}…` : firstLine;
}

export function serializeError(error: unknown): PdfErrorData {
  const e = toPdfError(error);
  return { kind: e.kind, message: e.message };
}

export function deserializeError(data: PdfErrorData): PdfError {
  return new PdfError(data.kind, data.message);
}
