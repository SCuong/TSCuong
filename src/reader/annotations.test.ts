import { describe, expect, it } from 'vitest';
import { PDFDocument, PDFDict, PDFHexString, PDFName, PDFRawStream, decodePDFRawStream, degrees } from 'pdf-lib';
import { annotate } from '@/tools/pdf/lib/ops';
import { clampPoint, markBounds } from './annotations';
describe('local PDF annotations', () => {
  it('bounds strokes and clips pointer positions to the page', () => {
    expect(markBounds([[10, 90], [80, 20]])).toEqual({ x: 10, y: 20, width: 70, height: 70 });
    expect(clampPoint(-5, 400, 100, 300)).toEqual([0, 300]);
  });
  it('exports marks and Unicode PDF comments without mutating the original or its rotation/crop', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([300, 400]);
    page.setRotation(degrees(90)); page.setCropBox(10, 20, 280, 360);
    const bytes = await doc.save(); const original = bytes.slice();
    const result = await annotate({ bytes, marks: [
      { id: 'highlight', page: 1, kind: 'highlight', color: '#facc15', points: [[20, 40], [50, 40], [50, 60], [20, 60]] },
      { id: 'note', page: 1, kind: 'note', color: '#2563eb', points: [[100, 120], [120, 120], [120, 140], [100, 140]], text: 'Ghi chú tiếng Việt' },
      { id: 'ink', page: 1, kind: 'ink', color: '#2563eb', points: [[20, 20], [40, 40], [90, 50]] },
    ] });
    expect(bytes).toEqual(original);
    const exported = await PDFDocument.load(result);
    expect(exported.getPage(0).getRotation().angle).toBe(90);
    expect(exported.getPage(0).getCropBox()).toEqual(page.getCropBox());
    const annots = exported.getPage(0).node.Annots()!;
    const comment = annots.lookup(0, PDFDict);
    expect(comment.lookup(PDFName.of('Contents'), PDFHexString).decodeText()).toBe('Ghi chú tiếng Việt');
    expect(exported.getPage(0).node.Contents()).toBeDefined();
  });
  it('isolates original drawing transforms before adding markup', async () => {
    const source = await PDFDocument.create(); const page = source.addPage([300, 400]);
    page.node.set(PDFName.of('Contents'), source.context.register(source.context.flateStream('2 0 0 2 100 100 cm\n')));
    const bytes = await annotate({ bytes: await source.save(), marks: [{ id: 'line', page: 1, kind: 'ink', color: '#2563eb', points: [[10, 10], [40, 40]] }] });
    const output = await PDFDocument.load(bytes); const streams = output.getPage(0).node.Contents()!;
    expect('size' in streams).toBe(true);
    if (!('size' in streams)) return;
    const text = Array.from({ length: streams.size() }, (_, index) => new TextDecoder().decode(decodePDFRawStream(streams.lookup(index, PDFRawStream)).decode())).join('\n');
    const originalTransform = text.indexOf('2 0 0 2 100 100 cm');
    const stroke = text.indexOf('10 10 m');
    expect(originalTransform).toBeGreaterThan(-1); expect(stroke).toBeGreaterThan(originalTransform);
    expect(text.slice(originalTransform, stroke)).toMatch(/\bQ\b/);
  });
});
