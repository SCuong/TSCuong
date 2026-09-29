import { describe, expect, it } from 'vitest';
import {
  DerError,
  bitLength,
  decodeOid,
  encodeOid,
  encodeSequence,
  encodeSmallInteger,
  encodeTlv,
  oidOf,
  parseDer,
  smallInteger,
  tryParseDer,
  unsignedBytes,
} from './der';

const hex = (s: string) => Uint8Array.from(s.replace(/\s+/g, '').match(/../g)!.map((b) => parseInt(b, 16)));

describe('parseDer', () => {
  it('parses nested sequences with children and offsets', () => {
    // SEQUENCE { INTEGER 5, SEQUENCE { NULL } }
    const node = parseDer(hex('30 07 02 01 05 30 02 05 00'));
    expect(node.tag).toBe(0x30);
    expect(node.children).toHaveLength(2);
    expect(node.children[0].offset).toBe(2);
    expect(smallInteger(node.children[0])).toBe(5);
    expect(node.children[1].children[0].tag).toBe(0x05);
  });

  it('handles long-form lengths', () => {
    const content = new Uint8Array(300).fill(0xab);
    const der = encodeTlv(0x04, content);
    expect(Array.from(der.subarray(0, 4))).toEqual([0x04, 0x82, 0x01, 0x2c]);
    const node = parseDer(der);
    expect(node.length).toBe(300);
    expect(node.headerLength).toBe(4);
  });

  it('parses high tag numbers', () => {
    const node = parseDer(hex('9f 81 00 01 ff'));
    expect(node.cls).toBe(2);
    expect(node.number).toBe(128);
    expect(node.length).toBe(1);
  });

  it('rejects truncated data with an offset', () => {
    expect(() => parseDer(hex('30 05 02 01'))).toThrow(DerError);
    try {
      parseDer(hex('30 05 02 01'));
    } catch (e) {
      expect((e as DerError).offset).toBe(0);
      expect((e as DerError).message).toMatch(/truncated/);
    }
  });

  it('rejects indefinite lengths, trailing bytes and empty input', () => {
    expect(() => parseDer(hex('30 80 00 00'))).toThrow(/Indefinite/);
    expect(() => parseDer(hex('05 00 05 00'))).toThrow(/after the end/);
    expect(parseDer(hex('05 00 05 00'), { allowTrailing: true }).tag).toBe(5);
    expect(() => parseDer(new Uint8Array())).toThrow(/No data/);
  });

  it('limits nesting depth', () => {
    let der: Uint8Array = hex('05 00');
    for (let i = 0; i < 60; i++) der = encodeSequence(der);
    expect(() => parseDer(der)).toThrow(/too deep/);
  });

  it('tryParseDer returns null for garbage', () => {
    expect(tryParseDer(new TextEncoder().encode('hello world'))).toBeNull();
    expect(tryParseDer(hex('05 00'))).not.toBeNull();
  });
});

describe('object identifiers', () => {
  it.each([
    ['1.2.840.113549.1.1.1', '2a864886f70d010101'],
    ['1.2.840.10045.3.1.7', '2a8648ce3d030107'],
    ['1.3.101.112', '2b6570'],
    ['2.5.29.17', '551d11'],
    ['2.16.840.1.101.3.4.2.1', '608648016503040201'],
    ['0.9.2342.19200300.100.1.25', '0992268993f22c640119'],
  ])('round-trips %s', (oid, contentHex) => {
    expect(decodeOid(hex(contentHex))).toBe(oid);
    const encoded = encodeOid(oid);
    expect(Array.from(encoded.subarray(2))).toEqual(Array.from(hex(contentHex)));
    expect(oidOf(parseDer(encoded))).toBe(oid);
  });

  it('rejects malformed identifiers', () => {
    expect(() => decodeOid(new Uint8Array())).toThrow();
    expect(() => decodeOid(hex('2a 86'))).toThrow(/Truncated/);
    expect(() => decodeOid(hex('2a 80 01'))).toThrow(/Non-minimal/);
    expect(() => encodeOid('1')).toThrow();
    expect(() => encodeOid('1.2.x')).toThrow();
    expect(() => encodeOid('3.1')).toThrow();
    expect(oidOf(parseDer(hex('05 00')))).toBeNull();
  });
});

describe('integers', () => {
  it('computes bit lengths of unsigned big-endian integers', () => {
    expect(bitLength(hex('00'))).toBe(0);
    expect(bitLength(hex('01'))).toBe(1);
    expect(bitLength(hex('00 80'))).toBe(8);
    expect(bitLength(hex('00 ff ff'))).toBe(16);
    const modulus = new Uint8Array(257);
    modulus[1] = 0xc0;
    expect(bitLength(modulus)).toBe(2048);
    expect(Array.from(unsignedBytes(hex('00 00 12')))).toEqual([0x12]);
  });

  it('encodes small integers with a sign byte when needed', () => {
    expect(Array.from(encodeSmallInteger(0))).toEqual([2, 1, 0]);
    expect(Array.from(encodeSmallInteger(127))).toEqual([2, 1, 0x7f]);
    expect(Array.from(encodeSmallInteger(128))).toEqual([2, 2, 0, 0x80]);
    expect(Array.from(encodeSmallInteger(65537))).toEqual([2, 3, 1, 0, 1]);
    expect(() => encodeSmallInteger(-1)).toThrow();
    expect(smallInteger(parseDer(encodeSmallInteger(65537)))).toBe(65537);
    // negative / too large values are not "small"
    expect(smallInteger(parseDer(hex('02 01 ff')))).toBeNull();
  });
});
