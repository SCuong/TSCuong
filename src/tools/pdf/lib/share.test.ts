import { afterEach, expect, it, vi } from 'vitest';
import { outputToFile, shareOutputs, supportsFileSharing } from './share';
afterEach(() => vi.unstubAllGlobals());
it('creates a named, typed export without mutating its bytes', async () => {
  const bytes = new Uint8Array([1, 2, 3]);
  const file = outputToFile({ name: 'new.pdf', type: 'application/pdf', data: bytes });
  expect(file.name).toBe('new.pdf');
  expect(file.size).toBe(3);
  expect(file.type).toBe('application/pdf');
  expect(bytes).toEqual(new Uint8Array([1, 2, 3]));
});
it('shares the actual named output and checks browser support', async () => {
  const share = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal('navigator', { share, canShare: vi.fn().mockReturnValue(true) });
  expect(supportsFileSharing()).toBe(true);
  expect(await shareOutputs([{ name: 'export.pdf', type: 'application/pdf', data: new Blob(['PDF']) }])).toBe(true);
  expect(share.mock.calls[0][0].files[0].name).toBe('export.pdf');
  expect(share.mock.calls[0][0].files[0].size).toBe(3);
});
it('provides a download fallback for unsupported sharing', async () => {
  vi.stubGlobal('navigator', {});
  expect(supportsFileSharing()).toBe(false);
  expect(await shareOutputs([])).toBe(false);
});
