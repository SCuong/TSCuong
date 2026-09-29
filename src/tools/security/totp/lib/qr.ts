/** QR code (SVG) for an otpauth:// URI, via the `qrcode` package loaded on demand. */

export async function qrSvg(text: string): Promise<string> {
  if (!text) throw new Error('Nothing to encode.');
  const QR = (await import('qrcode')).default;
  // Black on white with a quiet zone: what phone cameras scan most reliably, in either theme.
  return QR.toString(text, { type: 'svg', errorCorrectionLevel: 'M', margin: 2, color: { dark: '#000000', light: '#ffffff' } });
}
