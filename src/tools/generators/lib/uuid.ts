import { MAX, NIL, v1, v4, v6, v7 } from 'uuid';

export type UuidKind = 'v1' | 'v4' | 'v6' | 'v7' | 'nil' | 'max';

export interface UuidFormat {
  uppercase: boolean;
  braces: boolean;
  hyphens: boolean;
}

export const MAX_UUIDS = 10_000;

export function formatUuid(id: string, { uppercase, braces, hyphens }: UuidFormat): string {
  let s = hyphens ? id : id.replace(/-/g, '');
  if (uppercase) s = s.toUpperCase();
  return braces ? `{${s}}` : s;
}

export function generateUuids(kind: UuidKind, count: number, format: UuidFormat): string[] {
  const n = Math.max(1, Math.min(MAX_UUIDS, Math.floor(count)));
  const make =
    kind === 'v1' ? () => v1() : kind === 'v6' ? () => v6() : kind === 'v7' ? () => v7() : kind === 'nil' ? () => NIL : kind === 'max' ? () => MAX : () => v4();
  const out = new Array<string>(n);
  for (let i = 0; i < n; i++) out[i] = formatUuid(make(), format);
  return out;
}

// ---------------------------------------------------------------------------
// Parsing / inspection
// ---------------------------------------------------------------------------

export type UuidVariant = 'NCS (reserved)' | 'RFC 9562' | 'Microsoft (reserved)' | 'Future (reserved)';

export interface UuidTimestamp {
  /** Milliseconds since the Unix epoch (may be fractional for 100 ns precision). */
  unixMs: number;
  /** ISO 8601, with 100 ns precision for v1/v6 and ms precision for v7. */
  iso: string;
  date: Date;
}

export interface UuidInfo {
  input: string;
  canonical: string;
  version: number;
  versionLabel: string;
  variant: UuidVariant;
  special?: 'nil' | 'max';
  timestamp?: UuidTimestamp;
  clockSeq?: number;
  node?: string;
  /** True when the node's multicast bit is set, meaning it is random rather than a MAC address. */
  nodeIsRandom?: boolean;
}

export type UuidParseResult = { ok: true; info: UuidInfo } | { ok: false; input: string; error: string };

const VERSION_LABELS: Record<number, string> = {
  1: 'Version 1 (time-based, Gregorian)',
  2: 'Version 2 (DCE security)',
  3: 'Version 3 (name-based, MD5)',
  4: 'Version 4 (random)',
  5: 'Version 5 (name-based, SHA-1)',
  6: 'Version 6 (reordered time-based)',
  7: 'Version 7 (Unix time-ordered)',
  8: 'Version 8 (custom)',
};

/** 100 ns intervals between 1582-10-15 (Gregorian epoch) and 1970-01-01. */
const GREGORIAN_OFFSET = 0x01b21dd213814000n;

function variantOf(nibble: number): UuidVariant {
  if ((nibble & 0b1000) === 0) return 'NCS (reserved)';
  if ((nibble & 0b1100) === 0b1000) return 'RFC 9562';
  if ((nibble & 0b1110) === 0b1100) return 'Microsoft (reserved)';
  return 'Future (reserved)';
}

/** Turns 100 ns ticks since the Unix epoch into a timestamp with 7 fractional digits. */
function fromUnixTicks(ticks: bigint): UuidTimestamp {
  const ms = ticks / 10_000n;
  const sub = ticks % 10_000n; // remainder in 100 ns
  const msNum = Number(ms);
  const date = new Date(msNum);
  const base = Number.isNaN(date.getTime()) ? '' : date.toISOString();
  const frac = sub < 0n ? -sub : sub;
  const iso = base ? base.replace(/\.(\d{3})Z$/, (_m, d: string) => `.${d}${frac.toString().padStart(4, '0')}Z`) : 'Out of range';
  return { unixMs: msNum + Number(sub) / 10_000, iso, date };
}

function fromUnixMs(ms: number): UuidTimestamp {
  const date = new Date(ms);
  return { unixMs: ms, iso: Number.isNaN(date.getTime()) ? 'Out of range' : date.toISOString(), date };
}

/** Normalize common UUID spellings (braces, urn:uuid:, no hyphens, any case) to 32 lowercase hex digits. */
export function normalizeUuid(input: string): string | null {
  let s = input.trim();
  s = s.replace(/^urn:uuid:/i, '');
  if (s.startsWith('{') && s.endsWith('}')) s = s.slice(1, -1);
  else if (s.startsWith('(') && s.endsWith(')')) s = s.slice(1, -1);
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)) return s.replace(/-/g, '').toLowerCase();
  if (/^[0-9a-f]{32}$/i.test(s)) return s.toLowerCase();
  return null;
}

function hyphenate(hex: string): string {
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function parseUuid(input: string): UuidParseResult {
  const trimmed = input.trim();
  if (!trimmed) return { ok: false, input, error: 'Empty input.' };
  const hex = normalizeUuid(trimmed);
  if (!hex) {
    const core = trimmed.replace(/^urn:uuid:/i, '').replace(/[{}()-]/g, '');
    const error = /[^0-9a-f]/i.test(core)
      ? 'Contains characters that are not hexadecimal digits.'
      : core.length === 32
        ? 'The hyphens are not in the 8-4-4-4-12 positions.'
        : `Expected 32 hex digits, found ${core.length}.`;
    return { ok: false, input: trimmed, error };
  }
  const canonical = hyphenate(hex);
  if (hex === '0'.repeat(32)) {
    return { ok: true, info: { input: trimmed, canonical, version: 0, versionLabel: 'Nil UUID', variant: 'NCS (reserved)', special: 'nil' } };
  }
  if (hex === 'f'.repeat(32)) {
    return { ok: true, info: { input: trimmed, canonical, version: 15, versionLabel: 'Max UUID', variant: 'Future (reserved)', special: 'max' } };
  }
  const version = parseInt(hex[12], 16);
  const variant = variantOf(parseInt(hex[16], 16));
  const info: UuidInfo = {
    input: trimmed,
    canonical,
    version,
    versionLabel: VERSION_LABELS[version] ?? `Unknown version ${version}`,
    variant,
  };
  const rfc = variant === 'RFC 9562';
  if (rfc && (version === 1 || version === 6)) {
    let ticks: bigint;
    if (version === 1) {
      const low = BigInt(`0x${hex.slice(0, 8)}`);
      const mid = BigInt(`0x${hex.slice(8, 12)}`);
      const high = BigInt(`0x${hex.slice(13, 16)}`);
      ticks = (high << 48n) | (mid << 32n) | low;
    } else {
      const high = BigInt(`0x${hex.slice(0, 8)}`);
      const mid = BigInt(`0x${hex.slice(8, 12)}`);
      const low = BigInt(`0x${hex.slice(13, 16)}`);
      ticks = (high << 28n) | (mid << 12n) | low;
    }
    info.timestamp = fromUnixTicks(ticks - GREGORIAN_OFFSET);
    info.clockSeq = parseInt(hex.slice(16, 20), 16) & 0x3fff;
    const node = hex.slice(20);
    info.node = node.match(/../g)!.join(':');
    info.nodeIsRandom = (parseInt(node.slice(0, 2), 16) & 1) === 1;
  } else if (rfc && version === 7) {
    info.timestamp = fromUnixMs(parseInt(hex.slice(0, 12), 16));
  }
  return { ok: true, info };
}

/** Parse every UUID-ish token in a pasted block (split on whitespace, commas and semicolons). */
export function parseMany(text: string): UuidParseResult[] {
  return text
    .split(/[\s,;]+/)
    .map((t) => t.replace(/^["'`]+|["'`]+$/g, ''))
    .filter(Boolean)
    .map(parseUuid);
}
