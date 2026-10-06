import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PDFDocumentProxy } from '@/tools/pdf/lib/pdfjs';
const mocks = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn(), readFile: vi.fn(), openPdf: vi.fn(), render: vi.fn(), toBlob: vi.fn(), release: vi.fn() }));
vi.mock('./storage', () => ({ readerThumbnails: { get: mocks.get, put: mocks.put }, readerRepository: { readFile: mocks.readFile } }));
vi.mock('@/tools/pdf/lib/pdfjs', () => ({ openPdf: mocks.openPdf, renderPageToCanvas: mocks.render, canvasToBlob: mocks.toBlob, releaseCanvas: mocks.release }));
import { libraryThumbnail } from './libraryThumbnails';
beforeEach(() => { vi.clearAllMocks(); mocks.get.mockResolvedValue(undefined); mocks.put.mockResolvedValue(undefined); });
describe('persistent first-page previews', () => {
  it('reuses a cached preview without opening or rendering its PDF', async () => {
    const blob = new Blob(['preview'], { type: 'image/jpeg' }); mocks.get.mockResolvedValue(blob);
    expect(await libraryThumbnail('cached')).toBe(blob);
    expect(mocks.readFile).not.toHaveBeenCalled(); expect(mocks.render).not.toHaveBeenCalled();
  });
  it('recovers when rapid navigation destroys a borrowed reader and shares the recovered preview', async () => {
    const borrowed = { getPage: vi.fn().mockRejectedValue(new Error('Worker destroyed')) } as unknown as PDFDocumentProxy;
    const owned = { getPage: vi.fn().mockResolvedValue({ getViewport: () => ({ width: 595, height: 842 }) }) };
    const destroy = vi.fn(); const blob = new Blob(['rendered'], { type: 'image/jpeg' });
    mocks.readFile.mockResolvedValue({ size: 100, arrayBuffer: async () => new Uint8Array([1, 2]).buffer });
    mocks.openPdf.mockResolvedValue({ doc: owned, destroy }); mocks.render.mockResolvedValue(document.createElement('canvas')); mocks.toBlob.mockResolvedValue(blob);
    const first = libraryThumbnail('rapid-import', borrowed), row = libraryThumbnail('rapid-import');
    expect(await first).toBe(blob); expect(await row).toBe(blob);
    expect(mocks.openPdf).toHaveBeenCalledTimes(1); expect(mocks.put).toHaveBeenCalledWith('rapid-import', blob);
    expect(destroy).toHaveBeenCalledOnce(); expect(mocks.release).toHaveBeenCalledOnce();
  });
  it('does not copy a very large file just to create a background preview', async () => {
    const arrayBuffer = vi.fn(); mocks.readFile.mockResolvedValue({ size: 65 * 1048576, arrayBuffer });
    expect(await libraryThumbnail('large')).toBeUndefined();
    expect(arrayBuffer).not.toHaveBeenCalled(); expect(mocks.openPdf).not.toHaveBeenCalled();
  });
});
