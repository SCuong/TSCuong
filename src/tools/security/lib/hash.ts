import {
  createBLAKE2b,
  createBLAKE2s,
  createBLAKE3,
  createCRC32,
  createKeccak,
  createMD5,
  createRIPEMD160,
  createSHA1,
  createSHA224,
  createSHA256,
  createSHA3,
  createSHA384,
  createSHA512,
  createXXHash64,
  type IHasher,
} from 'hash-wasm';
import { bytesToBase64, bytesToHex, readInChunks, utf8 } from '../shared-a/bytes';

export type HashAlgorithmId =
  | 'md5'
  | 'sha1'
  | 'sha224'
  | 'sha256'
  | 'sha384'
  | 'sha512'
  | 'sha3-224'
  | 'sha3-256'
  | 'sha3-384'
  | 'sha3-512'
  | 'keccak256'
  | 'blake2b'
  | 'blake2s'
  | 'blake3'
  | 'ripemd160'
  | 'crc32'
  | 'xxhash64';

export interface HashAlgorithm {
  id: HashAlgorithmId;
  label: string;
  /** Digest length in bytes. */
  bytes: number;
  group: 'SHA-2' | 'SHA-3' | 'BLAKE' | 'Legacy' | 'Checksum';
  /** Broken or non-cryptographic: never use for security purposes. */
  note?: string;
  create: () => Promise<IHasher>;
}

const BROKEN = 'Broken: collisions are practical. Fine for checksums, not for security.';
const NON_CRYPTO = 'Not a cryptographic hash. Detects accidental corruption only.';

export const HASH_ALGORITHMS: HashAlgorithm[] = [
  { id: 'sha256', label: 'SHA-256', bytes: 32, group: 'SHA-2', create: () => createSHA256() },
  { id: 'sha512', label: 'SHA-512', bytes: 64, group: 'SHA-2', create: () => createSHA512() },
  { id: 'sha384', label: 'SHA-384', bytes: 48, group: 'SHA-2', create: () => createSHA384() },
  { id: 'sha224', label: 'SHA-224', bytes: 28, group: 'SHA-2', create: () => createSHA224() },
  { id: 'sha3-256', label: 'SHA3-256', bytes: 32, group: 'SHA-3', create: () => createSHA3(256) },
  { id: 'sha3-512', label: 'SHA3-512', bytes: 64, group: 'SHA-3', create: () => createSHA3(512) },
  { id: 'sha3-384', label: 'SHA3-384', bytes: 48, group: 'SHA-3', create: () => createSHA3(384) },
  { id: 'sha3-224', label: 'SHA3-224', bytes: 28, group: 'SHA-3', create: () => createSHA3(224) },
  { id: 'keccak256', label: 'Keccak-256', bytes: 32, group: 'SHA-3', create: () => createKeccak(256) },
  { id: 'blake3', label: 'BLAKE3', bytes: 32, group: 'BLAKE', create: () => createBLAKE3(256) },
  { id: 'blake2b', label: 'BLAKE2b-512', bytes: 64, group: 'BLAKE', create: () => createBLAKE2b(512) },
  { id: 'blake2s', label: 'BLAKE2s-256', bytes: 32, group: 'BLAKE', create: () => createBLAKE2s(256) },
  { id: 'md5', label: 'MD5', bytes: 16, group: 'Legacy', note: BROKEN, create: () => createMD5() },
  { id: 'sha1', label: 'SHA-1', bytes: 20, group: 'Legacy', note: BROKEN, create: () => createSHA1() },
  { id: 'ripemd160', label: 'RIPEMD-160', bytes: 20, group: 'Legacy', create: () => createRIPEMD160() },
  { id: 'crc32', label: 'CRC32', bytes: 4, group: 'Checksum', note: NON_CRYPTO, create: () => createCRC32() },
  { id: 'xxhash64', label: 'xxHash64', bytes: 8, group: 'Checksum', note: NON_CRYPTO, create: () => createXXHash64() },
];

const BY_ID = new Map(HASH_ALGORITHMS.map((a) => [a.id, a]));

export function getAlgorithm(id: HashAlgorithmId): HashAlgorithm {
  const algo = BY_ID.get(id);
  if (!algo) throw new Error(`Unknown hash algorithm: ${id}`);
  return algo;
}

export function isAlgorithmId(value: string): value is HashAlgorithmId {
  return BY_ID.has(value as HashAlgorithmId);
}

export type DigestFormat = 'hex' | 'HEX' | 'base64';

export function formatDigest(bytes: Uint8Array, format: DigestFormat): string {
  if (format === 'base64') return bytesToBase64(bytes);
  const hex = bytesToHex(bytes);
  return format === 'HEX' ? hex.toUpperCase() : hex;
}

export type DigestMap = Partial<Record<HashAlgorithmId, Uint8Array>>;

async function createAll(ids: HashAlgorithmId[]): Promise<Array<[HashAlgorithmId, IHasher]>> {
  return Promise.all(
    ids.map(async (id) => {
      const hasher = await getAlgorithm(id).create();
      hasher.init();
      return [id, hasher] as [HashAlgorithmId, IHasher];
    }),
  );
}

function finish(hashers: Array<[HashAlgorithmId, IHasher]>): DigestMap {
  const out: DigestMap = {};
  for (const [id, hasher] of hashers) out[id] = hasher.digest('binary');
  return out;
}

/** Hashes in-memory bytes (or UTF-8 text) with several algorithms at once. */
export async function hashBytes(data: Uint8Array | string, ids: HashAlgorithmId[]): Promise<DigestMap> {
  const bytes = typeof data === 'string' ? utf8(data) : data;
  const hashers = await createAll(ids);
  for (const [, hasher] of hashers) hasher.update(bytes);
  return finish(hashers);
}

/** Convenience: one algorithm, hex output. */
export async function hashHex(data: Uint8Array | string, id: HashAlgorithmId): Promise<string> {
  const map = await hashBytes(data, [id]);
  return bytesToHex(map[id]!);
}

export interface StreamOptions {
  signal?: AbortSignal;
  onProgress?: (fraction: number, done: number, total: number) => void;
  chunkSize?: number;
}

/**
 * Hashes a Blob/File incrementally (never loads the whole file) with every
 * requested algorithm in a single pass.
 */
export async function hashBlob(blob: Blob, ids: HashAlgorithmId[], options: StreamOptions = {}): Promise<DigestMap> {
  const hashers = await createAll(ids);
  await readInChunks(
    blob,
    (chunk) => {
      for (const [, hasher] of hashers) hasher.update(chunk);
    },
    {
      chunkSize: options.chunkSize ?? (ids.length > 6 ? 2 : 4) * 1024 * 1024,
      signal: options.signal,
      onProgress: (done, total) => options.onProgress?.(total === 0 ? 1 : done / total, done, total),
    },
  );
  return finish(hashers);
}
