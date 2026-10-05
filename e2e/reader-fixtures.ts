import { PDFDocument, PDFName, PDFString, StandardFonts, rgb, degrees } from 'pdf-lib';
import type { FilePayload } from './files';

export async function readingPdf(
  pages = 12,
  options: { mixed?: boolean; outline?: boolean; scanned?: boolean } = {},
): Promise<FilePayload> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  for (let n = 1; n <= pages; n++) {
    const page = doc.addPage(options.mixed && n === 2 ? [842, 595] : [595, 842]);
    if (options.mixed && n === 3) page.setRotation(degrees(90));
    const height = page.getHeight();
    page.drawRectangle({ x: 0, y: height - 16, width: page.getWidth(), height: 16, color: rgb(0.15, 0.39, 0.92) });
    if (!options.scanned) {
      page.drawText('FIELD NOTES / LOCALKIT', {
        x: 48,
        y: height - 60,
        size: 10,
        font: bold,
        color: rgb(0.2, 0.4, 0.7),
      });
      page.drawText(n === 1 ? 'A quieter way to read' : 'Chapter ' + n, {
        x: 48,
        y: height - 115,
        size: 27,
        font: bold,
      });
      const lines = [
        'Keep your documents close and your reading simple.',
        'LocalKit is a private space for the pages that matter.',
        'Take your time. Every page is yours to explore.',
        '',
        'A good reading experience makes room for the words.',
        'Scroll naturally, bookmark a thought, and return',
        'exactly where you left off. Your files stay with you.',
        '',
        'Offline reading means you can keep going anywhere:',
        'on a train, at home, or somewhere far from a signal.',
      ];
      lines.forEach((line, i) => page.drawText(line, { x: 48, y: height - 180 - i * 27, size: 15, font }));
      page.drawText('LocalKit reader guide - page ' + n, { x: 48, y: 40, size: 10, font, color: rgb(0.4, 0.45, 0.5) });
    }
  }
  if (options.outline !== false) {
    const ctx = doc.context;
    const outlines = ctx.obj({});
    const rootRef = ctx.register(outlines);
    const first = ctx.obj({
      Title: PDFString.of('Start reading'),
      Parent: rootRef,
      Dest: [doc.getPages()[0].ref, 'Fit'],
    });
    const second = ctx.obj({
      Title: PDFString.of('Continue exploring'),
      Parent: rootRef,
      Dest: [doc.getPages()[Math.min(4, pages - 1)].ref, 'Fit'],
    });
    const firstRef = ctx.register(first),
      secondRef = ctx.register(second);
    first.set(PDFName.of('Next'), secondRef);
    second.set(PDFName.of('Prev'), firstRef);
    outlines.set(PDFName.of('First'), firstRef);
    outlines.set(PDFName.of('Last'), secondRef);
    outlines.set(PDFName.of('Count'), ctx.obj(2));
    doc.catalog.set(PDFName.of('Outlines'), rootRef);
  }
  return {
    name: 'Reading guide.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from(await doc.save({ useObjectStreams: false })),
  };
}
