import { describe, expect, it } from 'vitest';
import { qrSvg } from './qr';
import { buildOtpauthUri } from './otpauth';

describe('qrSvg', () => {
  it('renders an otpauth URI as a black-on-white SVG QR code', async () => {
    const uri = buildOtpauthUri({ type: 'totp', issuer: 'LocalKit Test', account: 'you@example.com', secret: 'JBSWY3DPEHPK3PXP', algorithm: 'SHA-1', digits: 6, period: 30 });
    const svg = await qrSvg(uri);
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain('#000000');
    expect(svg).toContain('#ffffff');
    expect(svg).toMatch(/viewBox="0 0 (\d+) \1"/);
  });

  it('rejects empty input', async () => {
    await expect(qrSvg('')).rejects.toThrow(/Nothing to encode/);
  });
});
