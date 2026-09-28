/** Incremental, chunked file hashing (hash-wasm) and expected-hash comparison. */

export type HashAlgo = 'md5' | 'sha1' | 'sha256' | 'sha384' | 'sha512' | 'crc32';

export const HASH_ALGOS: Array<{
  id: HashAlgo;
  label: string;
  hexLength: number;
}> = [
  { id: 'md5', label: 'MD5', hexLength: 32 },
  { id: 'sha1', label: 'SHA-1', hexLength: 40 },
  { id: 'sha256', label: 'SHA-256', hexLength: 64 },
  { id: 'sha384', label: 'SHA-384', hexLength: 96 },
  { id: 'sha512', label: 'SHA-512', hexLength: 128 },
  { id: 'crc32', label: 'CRC32', hexLength: 8 },
];

export const algoLabel = (id: HashAlgo) => HASH_ALGOS.find((a) => a.id === id)?.label ?? id;

export interface Hasher {
  update(data: Uint8Array): unknown;
  digest(): string;
}

export async function createHasher(id: HashAlgo): Promise<Hasher> {
  const hw = await import('hash-wasm');
  switch (id) {
    case 'md5':
      return hw.createMD5();
    case 'sha1':
      return hw.createSHA1();
    case 'sha256':
      return hw.createSHA256();
    case 'sha384':
      return hw.createSHA384();
    case 'sha512':
      return hw.createSHA512();
    case 'crc32':
      return hw.createCRC32();
  }
}

export type ReadRange = (start: number, end: number) => Promise<Uint8Array>;

export const blobReader =
  (blob: Blob): ReadRange =>
  async (start, end) =>
    new Uint8Array(await blob.slice(start, end).arrayBuffer());

export interface HashOptions {
  chunkSize?: number;
  signal?: AbortSignal;
  /** Bytes processed so far. */
  onProgress?: (bytesDone: number) => void;
}

/** Hash `size` bytes from `read` with several algorithms in one pass. Returns lower-case hex digests. */
export async function hashRange(
  read: ReadRange,
  size: number,
  algos: HashAlgo[],
  opts: HashOptions = {},
): Promise<Record<HashAlgo, string>> {
  const unique = [...new Set(algos)];
  const hashers = await Promise.all(unique.map(createHasher));
  const chunk = Math.max(1, opts.chunkSize ?? 4 * 1024 * 1024);
  for (let pos = 0; pos < size; pos += chunk) {
    if (opts.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const data = await read(pos, Math.min(size, pos + chunk));
    for (const h of hashers) h.update(data);
    opts.onProgress?.(Math.min(size, pos + chunk));
  }
  const out = {} as Record<HashAlgo, string>;
  unique.forEach((id, i) => (out[id] = hashers[i].digest().toLowerCase()));
  return out;
}

export function hashBlob(blob: Blob, algos: HashAlgo[], opts?: HashOptions) {
  return hashRange(blobReader(blob), blob.size, algos, opts);
}

export interface ExpectedHash {
  hash: string;
  name?: string;
}

/**
 * Parse pasted expected hashes: a bare hex digest, "algo:hex", or checksum
 * files in GNU ("hash  name", "hash *name") or BSD ("SHA256 (name) = hash") format.
 */
export function parseExpected(input: string): ExpectedHash[] {
  const out: ExpectedHash[] = [];
  for (const raw of input.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const bsd = /^[\w-]+\s*\((.+)\)\s*=\s*([0-9a-f]+)$/i.exec(line);
    if (bsd) {
      out.push({ hash: bsd[2].toLowerCase(), name: bsd[1] });
      continue;
    }
    const gnu = /^\\?([0-9a-f]{8,})\s+[* ]?(.+)$/i.exec(line);
    if (gnu) {
      out.push({ hash: gnu[1].toLowerCase(), name: gnu[2].trim() });
      continue;
    }
    const bare = /^(?:[\w-]+[:=])?\s*([0-9a-f\s]{8,})$/i.exec(line);
    if (bare) {
      const hash = bare[1].replace(/\s+/g, '').toLowerCase();
      if (/^[0-9a-f]+$/.test(hash)) out.push({ hash });
    }
  }
  return out;
}

/** Algorithms whose digest length matches a hex string. */
export function algosForLength(hex: string): HashAlgo[] {
  return HASH_ALGOS.filter((a) => a.hexLength === hex.length).map((a) => a.id);
}

export type Verdict =
  { status: 'match'; algo: HashAlgo } | { status: 'mismatch'; algo: HashAlgo | null; computed: boolean } | { status: 'none' };

/**
 * Compare a file's digests with the expected hashes. An entry whose name
 * equals the file name wins; otherwise any matching value counts.
 */
export function verify(fileName: string, digests: Partial<Record<HashAlgo, string>>, expected: ExpectedHash[]): Verdict {
  if (!expected.length) return { status: 'none' };
  const values = Object.entries(digests) as Array<[HashAlgo, string]>;
  const byValue = expected.flatMap((e) => values.filter(([, v]) => v === e.hash).map(([algo]) => ({ e, algo })));
  const base = (n: string) => n.replace(/^.*[\\/]/, '');
  const named = expected.filter((e) => e.name && base(e.name) === fileName);
  if (named.length) {
    const hit = byValue.find((m) => named.includes(m.e));
    if (hit) return { status: 'match', algo: hit.algo };
    const algo = algosForLength(named[0].hash)[0] ?? null;
    return {
      status: 'mismatch',
      algo,
      computed: algo !== null && algo in digests,
    };
  }
  // Only unnamed entries (or entries for other files) apply by value.
  const unnamed = expected.filter((e) => !e.name);
  const hit = byValue.find((m) => !m.e.name);
  if (hit) return { status: 'match', algo: hit.algo };
  if (!unnamed.length) return { status: 'none' };
  const algo = algosForLength(unnamed[0].hash)[0] ?? null;
  return {
    status: 'mismatch',
    algo,
    computed: algo !== null && algo in digests,
  };
}

/** "hash  name" lines, compatible with `sha256sum -c`. */
export function checksumFile(rows: Array<{ name: string; hash: string }>): string {
  return rows.map((r) => `${r.hash}  ${r.name}`).join('\n') + (rows.length ? '\n' : '');
}
