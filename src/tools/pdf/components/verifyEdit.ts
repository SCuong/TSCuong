import { PdfError } from '../lib/errors';
import { openPdf } from '../lib/pdfjs';
import type { LoadedPdf } from './usePdfFile';

/**
 * pdf-lib edits encrypted files without being able to decrypt them. For those, re-open the
 * edited copy with pdf.js (and the same password) and make sure it still has every page before
 * it is offered for download, so a broken file is reported instead of handed out.
 */
export async function verifyEncryptedEdit(pdf: LoadedPdf, bytes: Uint8Array, expectedPages = pdf.pageCount): Promise<void> {
  if (!pdf.encrypted) return;
  const fail = () =>
    new PdfError(
      'encrypted',
      'This encrypted PDF could not be edited reliably in the browser. Remove the protection in your PDF app first, then try again.',
    );
  let opened: Awaited<ReturnType<typeof openPdf>>;
  try {
    opened = await openPdf(bytes, { password: pdf.password });
  } catch {
    throw fail();
  }
  try {
    if (opened.doc.numPages !== expectedPages) throw fail();
    const page = await opened.doc.getPage(1);
    await page.getOperatorList();
  } catch (error) {
    if (error instanceof PdfError) throw error;
    throw fail();
  } finally {
    opened.destroy();
  }
}
