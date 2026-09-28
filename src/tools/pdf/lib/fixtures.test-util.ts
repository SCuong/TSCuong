import { PDFDocument, StandardFonts, degrees } from 'pdf-lib';

/** Build a small PDF in memory for tests. Page i (0-based) is (200 + i) × 300 pt so tests can identify it by width. */
export async function makePdf(
  pageCount: number,
  options: { title?: string; rotate?: Record<number, number>; sizes?: Array<[number, number]> } = {},
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < pageCount; i++) {
    const size = options.sizes?.[i] ?? [200 + i, 300];
    const page = doc.addPage(size as [number, number]);
    page.drawText(`Page ${i + 1}`, { x: 20, y: 20, size: 18, font });
    const r = options.rotate?.[i];
    if (r) page.setRotation(degrees(r));
  }
  if (options.title) doc.setTitle(options.title);
  return doc.save();
}

/** Page identities (0-based source index, from the width) in document order. */
export async function pageIds(bytes: Uint8Array): Promise<number[]> {
  const doc = await PDFDocument.load(bytes);
  return doc.getPages().map((p) => Math.round(p.getMediaBox().width) - 200);
}

export async function load(bytes: Uint8Array) {
  return PDFDocument.load(bytes, { updateMetadata: false });
}
