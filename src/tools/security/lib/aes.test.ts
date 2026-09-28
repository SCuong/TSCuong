import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ITERATIONS,
  WRONG_PASSPHRASE,
  decryptBytes,
  decryptText,
  encryptFile,
  encryptText,
  envelopeIterations,
  isBinaryEnvelope,
  parseText,
} from './aes';
import { base64ToBytes, bytesToBase64Url, utf8 } from '../shared-a/bytes';

const FAST = { iterations: 1000 };

describe('AES text mode', () => {
  it('round-trips text', async () => {
    const enc = await encryptText('hello world', 'correct horse', FAST);
    expect(enc).toMatch(/^lkaes1\.pbkdf2-sha256\.1000\.[\w-]+\.[\w-]+\.[\w-]+$/);
    expect(await decryptText(enc, 'correct horse')).toBe('hello world');
  });

  it('round-trips Unicode, emoji and passphrases with emoji', async () => {
    const text = 'Grüße, мир, 世界 👋🏽🎉\nline 2\ttab';
    const enc = await encryptText(text, 'pässwörd 🔐', FAST);
    expect(await decryptText(enc, 'pässwörd 🔐')).toBe(text);
  });

  it('treats composed and decomposed passphrases the same (NFC)', async () => {
    const enc = await encryptText('x', 'café', FAST);
    expect(await decryptText(enc, 'café')).toBe('x');
  });

  it('round-trips empty text', async () => {
    const enc = await encryptText('', 'pw', FAST);
    expect(await decryptText(enc, 'pw')).toBe('');
  });

  it('round-trips long text', async () => {
    const text = 'abc🙂'.repeat(50_000);
    expect(await decryptText(await encryptText(text, 'pw', FAST), 'pw')).toBe(text);
  });

  it('uses a random salt and IV each time', async () => {
    const a = parseText(await encryptText('same', 'pw', FAST));
    const b = parseText(await encryptText('same', 'pw', FAST));
    expect(a.salt).toHaveLength(16);
    expect(a.iv).toHaveLength(12);
    expect(bytesToBase64Url(a.salt)).not.toBe(bytesToBase64Url(b.salt));
    expect(bytesToBase64Url(a.iv)).not.toBe(bytesToBase64Url(b.iv));
    expect(bytesToBase64Url(a.ciphertext)).not.toBe(bytesToBase64Url(b.ciphertext));
  });

  it('rejects a wrong passphrase', async () => {
    const enc = await encryptText('secret', 'right', FAST);
    await expect(decryptText(enc, 'wrong')).rejects.toThrow(WRONG_PASSPHRASE);
  });

  it('detects tampered ciphertext', async () => {
    const enc = await encryptText('secret message', 'pw', FAST);
    const parts = enc.split('.');
    const ct = base64ToBytes(parts[5])!;
    ct[0] ^= 1;
    parts[5] = bytesToBase64Url(ct);
    await expect(decryptText(parts.join('.'), 'pw')).rejects.toThrow(WRONG_PASSPHRASE);
  });

  it('detects a tampered header (authenticated as additional data)', async () => {
    const enc = await encryptText('secret', 'pw', FAST);
    const parts = enc.split('.');
    const iv = base64ToBytes(parts[4])!;
    iv[3] ^= 0x80;
    parts[4] = bytesToBase64Url(iv);
    await expect(decryptText(parts.join('.'), 'pw')).rejects.toThrow(WRONG_PASSPHRASE);
    parts[2] = '1001';
    await expect(decryptText(parts.join('.'), 'pw')).rejects.toThrow(WRONG_PASSPHRASE);
  });

  it('explains malformed input', async () => {
    await expect(decryptText('hello', 'pw')).rejects.toThrow(/should start with "lkaes1\."/);
    await expect(decryptText('lkaes1.pbkdf2-sha256.1000.abc', 'pw')).rejects.toThrow(/incomplete/);
    await expect(decryptText('lkaes1.pbkdf2-sha256.1000.abc.def.ghi', 'pw')).rejects.toThrow(/damaged/);
    await expect(decryptText('lkaes1.scrypt.1000.a.b.c', 'pw')).rejects.toThrow(/Unsupported key derivation/);
    await expect(decryptText('lkaes1.pbkdf2-sha256.99999999999.a.b.c', 'pw')).rejects.toThrow(/outside the supported range/);
  });

  it('tolerates whitespace/line breaks from copy-paste', async () => {
    const enc = await encryptText('wrapped', 'pw', FAST);
    const wrapped = `  ${enc.slice(0, 30)}\n${enc.slice(30, 60)}\r\n${enc.slice(60)}  `;
    expect(await decryptText(wrapped, 'pw')).toBe('wrapped');
  });

  it('requires a passphrase', async () => {
    await expect(encryptText('x', '', FAST)).rejects.toThrow(/passphrase/);
  });

  it('defaults to 600k iterations (full strength)', async () => {
    expect(DEFAULT_ITERATIONS).toBe(600_000);
    const enc = await encryptText('full strength', 'pw');
    expect(envelopeIterations(enc)).toBe(600_000);
    expect(await decryptText(enc, 'pw')).toBe('full strength');
  }, 30_000);
});

describe('AES file mode', () => {
  it('round-trips binary data and preserves the file name and type', async () => {
    const data = new Uint8Array(70_000);
    for (let i = 0; i < data.length; i++) data[i] = (i * 7) & 0xff;
    const enc = await encryptFile({ name: 'report 📄.pdf', type: 'application/pdf', data }, 'pw', FAST);
    expect(isBinaryEnvelope(enc)).toBe(true);
    expect(envelopeIterations(enc)).toBe(1000);
    const dec = await decryptBytes(enc, 'pw');
    expect(dec.kind).toBe('file');
    if (dec.kind === 'file') {
      expect(dec.name).toBe('report 📄.pdf');
      expect(dec.type).toBe('application/pdf');
      expect(dec.data).toEqual(data);
    }
  });

  it('round-trips an empty file', async () => {
    const enc = await encryptFile({ name: 'empty.txt', type: '', data: new Uint8Array(0) }, 'pw', FAST);
    const dec = await decryptBytes(enc, 'pw');
    expect(dec).toMatchObject({ kind: 'file', name: 'empty.txt', type: '' });
  });

  it('does not leak the file name in the envelope', async () => {
    const enc = await encryptFile({ name: 'secret-plans.txt', type: 'text/plain', data: utf8('x') }, 'pw', FAST);
    expect(new TextDecoder().decode(enc)).not.toContain('secret-plans');
  });

  it('detects tampering and wrong passphrases in files', async () => {
    const enc = await encryptFile({ name: 'a.bin', type: '', data: utf8('payload') }, 'pw', FAST);
    await expect(decryptBytes(enc, 'nope')).rejects.toThrow(WRONG_PASSPHRASE);
    const tampered = enc.slice();
    tampered[tampered.length - 1] ^= 1;
    await expect(decryptBytes(tampered, 'pw')).rejects.toThrow(WRONG_PASSPHRASE);
    await expect(decryptBytes(enc.slice(0, 40), 'pw')).rejects.toThrow(/truncated/);
  });

  it('rejects files that are not envelopes', async () => {
    await expect(decryptBytes(utf8('just some text'), 'pw')).rejects.toThrow(/not encrypted with this tool/);
  });

  it('decrypts a text envelope saved as a file', async () => {
    const enc = await encryptText('from a .txt file', 'pw', FAST);
    const dec = await decryptBytes(utf8(enc + '\n'), 'pw');
    expect(dec).toEqual({ kind: 'text', text: 'from a .txt file' });
  });
});
