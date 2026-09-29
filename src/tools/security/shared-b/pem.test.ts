import { describe, expect, it } from 'vitest';
import { decodePemBase64, encodePem, hasPemMarker, scanPem } from './pem';
import { LEAF_CERT, INTERMEDIATE_CA, RSA_LEGACY_ENCRYPTED } from './testFixtures';

describe('scanPem', () => {
  it('finds several blocks with offsets and decodes them', () => {
    const text = `Bag Attributes: junk\n${LEAF_CERT}\n\n${INTERMEDIATE_CA}`;
    const scan = scanPem(text);
    expect(scan.blocks).toHaveLength(2);
    expect(scan.blocks.map((b) => b.label)).toEqual(['CERTIFICATE', 'CERTIFICATE']);
    expect(scan.blocks[0].der?.[0]).toBe(0x30);
    expect(text.slice(scan.blocks[0].start, scan.blocks[0].start + 27)).toBe('-----BEGIN CERTIFICATE-----');
    expect(scan.hasStrayText).toBe(true);
    expect(scan.problems).toEqual([]);
  });

  it('handles CRLF line endings and indentation', () => {
    const crlf = LEAF_CERT.replace(/\n/g, '\r\n').replace(/^/gm, '  ');
    const scan = scanPem(crlf);
    expect(scan.blocks).toHaveLength(1);
    expect(scan.blocks[0].error).toBeNull();
    expect(scan.hasStrayText).toBe(false);
  });

  it('reads RFC 1421 headers of legacy encrypted keys', () => {
    const scan = scanPem(RSA_LEGACY_ENCRYPTED);
    expect(scan.blocks[0].label).toBe('RSA PRIVATE KEY');
    expect(scan.blocks[0].headers.find((h) => h.key === 'Proc-Type')?.value).toBe('4,ENCRYPTED');
    expect(scan.blocks[0].headers.find((h) => h.key === 'DEK-Info')?.value).toMatch(/^AES-256-CBC,/);
    expect(scan.blocks[0].der).not.toBeNull();
  });

  it('reports missing and mismatched END lines', () => {
    expect(scanPem('-----BEGIN CERTIFICATE-----\nMIIB\n').problems[0]).toMatch(/no matching “-----END CERTIFICATE-----”/);
    expect(scanPem('-----BEGIN CERTIFICATE-----\nMIIB\n-----END PUBLIC KEY-----').problems[0]).toMatch(/labels must match/);
  });

  it('reports invalid Base64 bodies per block', () => {
    const scan = scanPem('-----BEGIN PUBLIC KEY-----\nMII%%%\n-----END PUBLIC KEY-----');
    expect(scan.blocks[0].der).toBeNull();
    expect(scan.blocks[0].error).toMatch(/invalid character “%”/);
    expect(scanPem('-----BEGIN X-----\n\n-----END X-----').blocks[0].error).toMatch(/empty/);
  });

  it('returns nothing for plain text', () => {
    const scan = scanPem('hello world');
    expect(scan.blocks).toEqual([]);
    expect(scan.hasStrayText).toBe(true);
    expect(hasPemMarker('hello')).toBe(false);
    expect(hasPemMarker(LEAF_CERT)).toBe(true);
  });
});

describe('decodePemBase64', () => {
  it('validates padding and length', () => {
    expect(decodePemBase64('AQID').ok).toBe(true);
    expect(decodePemBase64('AQ==').ok).toBe(true);
    const mid = decodePemBase64('AQ==AQID');
    expect(mid.ok).toBe(false);
    expect(!mid.ok && mid.error).toMatch(/padding in the middle/);
    const short = decodePemBase64('AQIDB');
    expect(!short.ok && short.error).toMatch(/impossible length/);
  });
});

describe('encodePem', () => {
  it('wraps at 64 characters and round-trips', () => {
    const der = new Uint8Array(100).map((_, i) => i);
    const pem = encodePem('TEST DATA', der);
    const lines = pem.trim().split('\n');
    expect(lines[0]).toBe('-----BEGIN TEST DATA-----');
    expect(lines[1]).toHaveLength(64);
    expect(lines.at(-1)).toBe('-----END TEST DATA-----');
    expect(Array.from(scanPem(pem).blocks[0].der!)).toEqual(Array.from(der));
  });
});
