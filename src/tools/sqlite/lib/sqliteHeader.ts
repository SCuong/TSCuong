/** Parsing of the 100-byte SQLite database header. https://www.sqlite.org/fileformat.html */

export const SQLITE_MAGIC = 'SQLite format 3\u0000';

export interface SqliteHeader {
  pageSize: number;
  writeVersion: number;
  readVersion: number;
  pageCount: number;
  encoding: 'UTF-8' | 'UTF-16le' | 'UTF-16be' | 'unknown';
  userVersion: number;
  applicationId: number;
  sqliteVersionNumber: number;
}

export type HeaderResult = { ok: true; header: SqliteHeader } | { ok: false; error: string };

export function hasSqliteMagic(bytes: Uint8Array): boolean {
  if (bytes.length < 16) return false;
  for (let i = 0; i < 16; i++) if (bytes[i] !== SQLITE_MAGIC.charCodeAt(i)) return false;
  return true;
}

export function parseSqliteHeader(bytes: Uint8Array, fileSize = bytes.length): HeaderResult {
  if (fileSize === 0) return { ok: false, error: 'The file is empty.' };
  if (bytes.length < 100 || fileSize < 100) {
    return { ok: false, error: 'The file is too small to be a SQLite database (the header alone is 100 bytes).' };
  }
  if (!hasSqliteMagic(bytes)) {
    const text = new TextDecoder().decode(bytes.subarray(0, 64));
    if (/^\s*(CREATE|INSERT|BEGIN|PRAGMA|--)/i.test(text)) {
      return {
        ok: false,
        error: 'This looks like a SQL text script, not a SQLite database file. Create a new database and run it in the SQL editor instead.',
      };
    }
    return {
      ok: false,
      error: 'This is not a SQLite database: the file does not start with the "SQLite format 3" header. It may be encrypted, compressed or a different format.',
    };
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const rawPage = view.getUint16(16);
  const pageSize = rawPage === 1 ? 65536 : rawPage;
  if (pageSize < 512 || pageSize > 65536 || (pageSize & (pageSize - 1)) !== 0) {
    return { ok: false, error: `The database header is corrupt (invalid page size ${rawPage}).` };
  }
  const enc = view.getUint32(56);
  return {
    ok: true,
    header: {
      pageSize,
      writeVersion: bytes[18],
      readVersion: bytes[19],
      pageCount: view.getUint32(28),
      encoding: enc === 1 ? 'UTF-8' : enc === 2 ? 'UTF-16le' : enc === 3 ? 'UTF-16be' : enc === 0 ? 'UTF-8' : 'unknown',
      userVersion: view.getInt32(60),
      applicationId: view.getInt32(68),
      sqliteVersionNumber: view.getUint32(96),
    },
  };
}

/** 3045001 → "3.45.1" */
export function formatSqliteVersionNumber(n: number): string {
  if (!n) return 'unknown';
  return `${Math.floor(n / 1_000_000)}.${Math.floor((n % 1_000_000) / 1000)}.${n % 1000}`;
}
