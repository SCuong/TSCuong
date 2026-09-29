/**
 * Minimal, defensive DER (ASN.1 Distinguished Encoding Rules) reader and writer.
 *
 * Used to classify PEM/DER blobs (certificate vs. CSR vs. key formats), to read key sizes and
 * curves, and to wrap legacy key formats (PKCS#1, SEC1) into the PKCS#8/SPKI containers that
 * Web Crypto understands. It never evaluates anything and rejects malformed input with an offset.
 */

export class DerError extends Error {
  readonly offset: number;
  constructor(message: string, offset: number) {
    super(message);
    this.name = 'DerError';
    this.offset = offset;
  }
}

export const TAG = {
  BOOLEAN: 0x01,
  INTEGER: 0x02,
  BIT_STRING: 0x03,
  OCTET_STRING: 0x04,
  NULL: 0x05,
  OID: 0x06,
  UTF8_STRING: 0x0c,
  SEQUENCE: 0x30,
  SET: 0x31,
  PRINTABLE_STRING: 0x13,
  IA5_STRING: 0x16,
  UTC_TIME: 0x17,
  GENERALIZED_TIME: 0x18,
} as const;

export interface Asn1 {
  /** The full identifier octet for low tag numbers (e.g. 0x30 for SEQUENCE, 0xa0 for [0]). */
  tag: number;
  /** 0 universal, 1 application, 2 context-specific, 3 private. */
  cls: number;
  constructed: boolean;
  /** Tag number within its class. */
  number: number;
  /** Offset of the identifier octet within the parsed buffer. */
  offset: number;
  headerLength: number;
  /** Length of the contents in bytes. */
  length: number;
  /** The contents octets (a view, not a copy). */
  content: Uint8Array;
  /** The whole TLV encoding (a view, not a copy). */
  raw: Uint8Array;
  /** Parsed children for constructed encodings. */
  children: Asn1[];
}

interface ParseState {
  nodes: number;
  maxNodes: number;
  maxDepth: number;
}

function readNode(bytes: Uint8Array, pos: number, end: number, depth: number, state: ParseState, base: number): Asn1 {
  if (pos >= end) throw new DerError('Unexpected end of data', base + pos);
  if (++state.nodes > state.maxNodes) throw new DerError('Too many ASN.1 elements', base + pos);
  const start = pos;
  const first = bytes[pos++];
  const cls = first >> 6;
  const constructed = (first & 0x20) !== 0;
  let number = first & 0x1f;
  if (number === 0x1f) {
    // High tag number form: base-128 digits.
    number = 0;
    for (let i = 0; ; i++) {
      if (pos >= end) throw new DerError('Truncated tag', base + pos);
      if (i > 3) throw new DerError('Tag number too large', base + pos);
      const b = bytes[pos++];
      number = number * 128 + (b & 0x7f);
      if ((b & 0x80) === 0) break;
    }
  }
  if (pos >= end) throw new DerError('Missing length', base + pos);
  let length = bytes[pos++];
  if (length === 0x80) throw new DerError('Indefinite length is not allowed in DER', base + pos - 1);
  if (length & 0x80) {
    const count = length & 0x7f;
    if (count > 4) throw new DerError('Length field too large', base + pos - 1);
    if (pos + count > end) throw new DerError('Truncated length', base + pos);
    length = 0;
    for (let i = 0; i < count; i++) length = length * 256 + bytes[pos++];
  }
  const headerLength = pos - start;
  if (pos + length > end) {
    throw new DerError(`Element claims ${length} bytes but only ${end - pos} remain (truncated data?)`, base + start);
  }
  const content = bytes.subarray(pos, pos + length);
  const node: Asn1 = {
    tag: first,
    cls,
    constructed,
    number,
    offset: base + start,
    headerLength,
    length,
    content,
    raw: bytes.subarray(start, pos + length),
    children: [],
  };
  if (constructed) {
    if (depth >= state.maxDepth) throw new DerError('ASN.1 nesting is too deep', base + start);
    let childPos = pos;
    const childEnd = pos + length;
    while (childPos < childEnd) {
      const child = readNode(bytes, childPos, childEnd, depth + 1, state, base);
      node.children.push(child);
      childPos += child.raw.length;
    }
  }
  return node;
}

/**
 * Parses one DER element that must span the whole buffer (unless `allowTrailing`).
 * Throws `DerError` with a byte offset for malformed input.
 */
export function parseDer(bytes: Uint8Array, options: { allowTrailing?: boolean; maxDepth?: number; maxNodes?: number } = {}): Asn1 {
  const state: ParseState = { nodes: 0, maxNodes: options.maxNodes ?? 200_000, maxDepth: options.maxDepth ?? 40 };
  if (bytes.length === 0) throw new DerError('No data', 0);
  const node = readNode(bytes, 0, bytes.length, 0, state, 0);
  if (!options.allowTrailing && node.raw.length !== bytes.length) {
    throw new DerError(`Unexpected ${bytes.length - node.raw.length} bytes after the end of the structure`, node.raw.length);
  }
  return node;
}

/** Like `parseDer` but returns null instead of throwing. */
export function tryParseDer(bytes: Uint8Array): Asn1 | null {
  try {
    return parseDer(bytes);
  } catch {
    return null;
  }
}

export function decodeOid(content: Uint8Array): string {
  if (content.length === 0) throw new DerError('Empty object identifier', 0);
  const arcs: number[] = [];
  let value = 0;
  let started = false;
  for (let i = 0; i < content.length; i++) {
    const b = content[i];
    if (!started && b === 0x80) throw new DerError('Non-minimal object identifier encoding', i);
    started = true;
    value = value * 128 + (b & 0x7f);
    if (value > Number.MAX_SAFE_INTEGER / 128) throw new DerError('Object identifier arc too large', i);
    if ((b & 0x80) === 0) {
      arcs.push(value);
      value = 0;
      started = false;
    } else if (i === content.length - 1) {
      throw new DerError('Truncated object identifier', i);
    }
  }
  const first = arcs[0];
  const head = first < 40 ? [0, first] : first < 80 ? [1, first - 40] : [2, first - 80];
  return [...head, ...arcs.slice(1)].join('.');
}

/** Reads the OID of a node, or null when the node is not an OBJECT IDENTIFIER. */
export function oidOf(node: Asn1 | undefined): string | null {
  if (!node || node.tag !== TAG.OID) return null;
  try {
    return decodeOid(node.content);
  } catch {
    return null;
  }
}

/** Unsigned big-endian integer contents with leading zero bytes removed. */
export function unsignedBytes(content: Uint8Array): Uint8Array {
  let i = 0;
  while (i < content.length - 1 && content[i] === 0) i++;
  return content.subarray(i);
}

/** Bit length of an unsigned big-endian integer (0 for zero). */
export function bitLength(bytes: Uint8Array): number {
  const trimmed = unsignedBytes(bytes);
  if (trimmed.length === 0 || (trimmed.length === 1 && trimmed[0] === 0)) return 0;
  return (trimmed.length - 1) * 8 + (32 - Math.clz32(trimmed[0]));
}

/** Small non-negative INTEGER value (throws for values that do not fit in a double exactly). */
export function smallInteger(node: Asn1 | undefined): number | null {
  if (!node || node.tag !== TAG.INTEGER || node.length === 0 || node.length > 6) return null;
  if (node.content[0] & 0x80) return null;
  let value = 0;
  for (const b of node.content) value = value * 256 + b;
  return value;
}

/** Contents of a BIT STRING without the leading "unused bits" byte. */
export function bitStringBytes(node: Asn1): Uint8Array {
  if (node.tag !== TAG.BIT_STRING || node.length === 0) throw new DerError('Expected a BIT STRING', node.offset);
  return node.content.subarray(1);
}

// --- encoding -------------------------------------------------------------------------------

function encodeLength(length: number): Uint8Array {
  if (length < 0x80) return Uint8Array.of(length);
  const bytes: number[] = [];
  let n = length;
  while (n > 0) {
    bytes.unshift(n & 0xff);
    n = Math.floor(n / 256);
  }
  return Uint8Array.of(0x80 | bytes.length, ...bytes);
}

export function concatBytes(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const total = parts.reduce((sum, p) => sum + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

export function encodeTlv(tag: number, content: Uint8Array): Uint8Array<ArrayBuffer> {
  return concatBytes(Uint8Array.of(tag), encodeLength(content.length), content);
}

export function encodeSequence(...items: Uint8Array[]): Uint8Array<ArrayBuffer> {
  return encodeTlv(TAG.SEQUENCE, concatBytes(...items));
}

export function encodeOid(dotted: string): Uint8Array<ArrayBuffer> {
  const arcs = dotted.split('.').map((a) => {
    if (!/^\d+$/.test(a)) throw new Error(`Invalid OID "${dotted}"`);
    return Number(a);
  });
  if (arcs.length < 2 || arcs[0] > 2 || (arcs[0] < 2 && arcs[1] >= 40)) throw new Error(`Invalid OID "${dotted}"`);
  const values = [arcs[0] * 40 + arcs[1], ...arcs.slice(2)];
  const bytes: number[] = [];
  for (const v of values) {
    const chunk: number[] = [v & 0x7f];
    let n = Math.floor(v / 128);
    while (n > 0) {
      chunk.unshift((n & 0x7f) | 0x80);
      n = Math.floor(n / 128);
    }
    bytes.push(...chunk);
  }
  return encodeTlv(TAG.OID, Uint8Array.from(bytes));
}

export const DER_NULL = Uint8Array.of(0x05, 0x00);

export function encodeSmallInteger(value: number): Uint8Array<ArrayBuffer> {
  if (!Number.isInteger(value) || value < 0 || value > 0x7fffffff) throw new Error('Unsupported integer');
  const bytes: number[] = [];
  let n = value;
  do {
    bytes.unshift(n & 0xff);
    n = Math.floor(n / 256);
  } while (n > 0);
  if (bytes[0] & 0x80) bytes.unshift(0);
  return encodeTlv(TAG.INTEGER, Uint8Array.from(bytes));
}

export function encodeOctetString(content: Uint8Array): Uint8Array<ArrayBuffer> {
  return encodeTlv(TAG.OCTET_STRING, content);
}

export function encodeBitString(content: Uint8Array): Uint8Array<ArrayBuffer> {
  return encodeTlv(TAG.BIT_STRING, concatBytes(Uint8Array.of(0), content));
}
