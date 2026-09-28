import { base64ToBytes, bytesToHex, equalBytes, hexToBytes } from '../shared-a/bytes';
import { getAlgorithm, HASH_ALGORITHMS, type DigestMap, type HashAlgorithmId } from './hash';

/** Algorithms that could produce a digest of the given byte length, most common first. */
export function candidatesForLength(bytes: number): HashAlgorithmId[] {
  const order: HashAlgorithmId[] = [
    'sha256',
    'sha512',
    'sha1',
    'md5',
    'sha384',
    'sha224',
    'sha3-256',
    'sha3-512',
    'sha3-384',
    'sha3-224',
    'blake3',
    'blake2b',
    'blake2s',
    'keccak256',
    'ripemd160',
    'crc32',
    'xxhash64',
  ];
  const lengths = new Map(HASH_ALGORITHMS.map((a) => [a.id, a.bytes]));
  return order.filter((id) => lengths.get(id) === bytes);
}

/** Name hints found in checksum files ("SHA256 (file) = …", "sha256:…", "*.sha256"). */
const NAME_HINTS: Array<[RegExp, HashAlgorithmId]> = [
  [/^sha-?3-?224$/i, 'sha3-224'],
  [/^sha-?3-?256$/i, 'sha3-256'],
  [/^sha-?3-?384$/i, 'sha3-384'],
  [/^sha-?3-?512$/i, 'sha3-512'],
  [/^sha-?224$/i, 'sha224'],
  [/^sha-?256$/i, 'sha256'],
  [/^sha-?384$/i, 'sha384'],
  [/^sha-?512$/i, 'sha512'],
  [/^sha-?1$/i, 'sha1'],
  [/^md-?5$/i, 'md5'],
  [/^blake-?3$/i, 'blake3'],
  [/^blake-?2b(-?512)?$/i, 'blake2b'],
  [/^blake-?2s(-?256)?$/i, 'blake2s'],
  [/^keccak-?256$/i, 'keccak256'],
  [/^ripemd-?160$/i, 'ripemd160'],
  [/^crc-?32$/i, 'crc32'],
  [/^xxh(ash)?-?64$/i, 'xxhash64'],
];

export function algorithmFromName(name: string): HashAlgorithmId | undefined {
  const clean = name.trim();
  return NAME_HINTS.find(([re]) => re.test(clean))?.[1];
}

export interface ParsedExpected {
  bytes: Uint8Array;
  hex: string;
  encoding: 'hex' | 'base64';
  filename?: string;
  /** Algorithm named in the input itself (BSD tag or `algo:` prefix). */
  hint?: HashAlgorithmId;
  candidates: HashAlgorithmId[];
}

export type ParseExpectedResult = { ok: true; value: ParsedExpected } | { ok: false; error: string };

/**
 * Parses an expected hash as typed by a user or copied from a checksum file:
 * bare hex/base64, `sha256sum` lines ("hash  name" / "hash *name"), BSD tags
 * ("SHA256 (name) = hash") and `sha256:hash` / `sha256-base64` (SRI) prefixes.
 */
export function parseExpectedHash(input: string, forFileName?: string): ParseExpectedResult | null {
  const lines = input
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('#'));
  if (!lines.length) return null;
  const firstLine = (forFileName && lines.length > 1 && lineForFile(lines, forFileName)) || lines[0];

  let token = firstLine;
  let filename: string | undefined;
  let hint: HashAlgorithmId | undefined;

  const bsd = /^([A-Za-z0-9-]+)\s*\((.*)\)\s*=\s*(\S+)$/.exec(firstLine);
  const prefixed = /^([A-Za-z][A-Za-z0-9-]*?)(?::\s*|-)([A-Za-z0-9+/=_-]+)$/.exec(firstLine);
  const gnu = /^(\S+)\s+\*?(.+)$/.exec(firstLine);
  if (bsd) {
    hint = algorithmFromName(bsd[1]);
    filename = bsd[2];
    token = bsd[3];
  } else if (prefixed && algorithmFromName(prefixed[1])) {
    hint = algorithmFromName(prefixed[1]);
    token = prefixed[2];
  } else if (gnu) {
    token = gnu[1];
    filename = gnu[2].trim();
  }

  const hexCandidate = token.replace(/^0x/i, '');
  let bytes: Uint8Array | null = null;
  let encoding: 'hex' | 'base64' = 'hex';
  // A string made only of hex digits is always read as hex (a Base64 digest of that shape is vanishingly unlikely).
  if (/^[0-9a-fA-F]+$/.test(hexCandidate)) {
    if (hexCandidate.length % 2 !== 0 || !candidatesForLength(hexCandidate.length / 2).length) {
      return {
        ok: false,
        error: `That hex value is ${hexCandidate.length} characters long, which doesn't match any supported hash (MD5 is 32, SHA-1 40, SHA-256 64, SHA-512 128).`,
      };
    }
    bytes = hexToBytes(hexCandidate);
  } else {
    const b64 = base64ToBytes(token);
    if (b64 && candidatesForLength(b64.length).length) {
      bytes = b64;
      encoding = 'base64';
    }
  }
  if (!bytes) {
    return {
      ok: false,
      error: 'The expected hash should be hex (like the output of sha256sum) or Base64. Other characters were found.',
    };
  }
  let candidates = candidatesForLength(bytes.length);
  if (hint) {
    if (!candidates.includes(hint)) {
      return { ok: false, error: `The input names ${getAlgorithm(hint).label}, but the hash has the wrong length for it (${getAlgorithm(hint).bytes * 2} hex characters expected).` };
    }
    candidates = [hint];
  }
  return { ok: true, value: { bytes, hex: bytesToHex(bytes), encoding, filename, hint, candidates } };
}

function baseName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

/** In a multi-line checksum file (SHA256SUMS), the line that names the given file. */
function lineForFile(lines: string[], fileName: string): string | undefined {
  const target = fileName.toLowerCase();
  return lines.find((line) => {
    const bsd = /^[A-Za-z0-9-]+\s*\((.*)\)\s*=/.exec(line);
    const gnu = /^\S+\s+\*?(.+)$/.exec(line);
    const name = bsd?.[1] ?? gnu?.[1];
    return name !== undefined && baseName(name.trim()).toLowerCase() === target;
  });
}

export interface VerifyOutcome {
  match: boolean;
  /** Algorithm whose digest equals the expected value (if any). */
  matchedAlgorithm?: HashAlgorithmId;
  /** Digest per checked algorithm. */
  digests: DigestMap;
}

export function compareDigests(expected: Uint8Array, digests: DigestMap, order: HashAlgorithmId[]): VerifyOutcome {
  for (const id of order) {
    const d = digests[id];
    if (d && equalBytes(d, expected)) return { match: true, matchedAlgorithm: id, digests };
  }
  return { match: false, digests };
}
