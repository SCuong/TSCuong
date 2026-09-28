/**
 * IPv4 / IPv6 address and CIDR math. IPv4 uses unsigned 32-bit numbers,
 * IPv6 uses BigInt. All parsers throw `IpError` with a human-readable message.
 */

export class IpError extends Error {
  override name = 'IpError';
}

/* -------------------------------------------------------------------------- */
/* IPv4                                                                       */
/* -------------------------------------------------------------------------- */

export function parseIPv4(text: string): number {
  const s = text.trim();
  if (!s) throw new IpError('Enter an IPv4 address.');
  const parts = s.split('.');
  if (parts.length !== 4) {
    throw new IpError(`"${s}" is not an IPv4 address: expected 4 numbers separated by dots, found ${parts.length}.`);
  }
  let value = 0;
  for (const part of parts) {
    if (part === '') throw new IpError(`"${s}" has an empty octet.`);
    if (!/^\d+$/.test(part)) throw new IpError(`Octet "${part}" is not a number.`);
    if (part.length > 1 && part.startsWith('0')) {
      throw new IpError(`Octet "${part}" has a leading zero, which some systems read as octal. Write it without leading zeros.`);
    }
    const n = Number(part);
    if (n > 255) throw new IpError(`Octet ${part} is out of range (0–255).`);
    value = value * 256 + n;
  }
  return value >>> 0;
}

export function formatIPv4(value: number): string {
  const v = value >>> 0;
  return [v >>> 24, (v >>> 16) & 255, (v >>> 8) & 255, v & 255].join('.');
}

export function prefixToMask(prefix: number): number {
  if (prefix <= 0) return 0;
  if (prefix >= 32) return 0xffffffff;
  return (0xffffffff << (32 - prefix)) >>> 0;
}

/** Converts a dotted mask to a prefix length; throws if the mask is not contiguous. */
export function maskToPrefix(mask: number): number {
  const m = mask >>> 0;
  const inverted = ~m >>> 0;
  // A valid mask's inverse is 2^k - 1.
  if ((inverted & (inverted + 1)) !== 0) {
    throw new IpError(`${formatIPv4(m)} is not a valid subnet mask (the 1 bits must be contiguous).`);
  }
  let prefix = 0;
  for (let i = 31; i >= 0; i--) {
    if ((m >>> i) & 1) prefix++;
    else break;
  }
  return prefix;
}

export function toBinaryIPv4(value: number): string {
  const bits = (value >>> 0).toString(2).padStart(32, '0');
  return [bits.slice(0, 8), bits.slice(8, 16), bits.slice(16, 24), bits.slice(24)].join('.');
}

export type IPv4Class = 'A' | 'B' | 'C' | 'D (multicast)' | 'E (reserved)';

export function ipv4Class(value: number): IPv4Class {
  const first = value >>> 24;
  if (first < 128) return 'A';
  if (first < 192) return 'B';
  if (first < 224) return 'C';
  if (first < 240) return 'D (multicast)';
  return 'E (reserved)';
}

interface RangeRule {
  base: string;
  prefix: number;
  label: string;
}

const V4_TYPES: RangeRule[] = [
  { base: '255.255.255.255', prefix: 32, label: 'Limited broadcast' },
  { base: '0.0.0.0', prefix: 8, label: 'Unspecified / "this network" (RFC 1122)' },
  { base: '10.0.0.0', prefix: 8, label: 'Private (RFC 1918)' },
  { base: '172.16.0.0', prefix: 12, label: 'Private (RFC 1918)' },
  { base: '192.168.0.0', prefix: 16, label: 'Private (RFC 1918)' },
  { base: '100.64.0.0', prefix: 10, label: 'Shared address space / CGNAT (RFC 6598)' },
  { base: '127.0.0.0', prefix: 8, label: 'Loopback (RFC 1122)' },
  { base: '169.254.0.0', prefix: 16, label: 'Link-local (RFC 3927)' },
  { base: '192.0.0.0', prefix: 24, label: 'IETF protocol assignments (RFC 6890)' },
  { base: '192.0.2.0', prefix: 24, label: 'Documentation, TEST-NET-1 (RFC 5737)' },
  { base: '198.51.100.0', prefix: 24, label: 'Documentation, TEST-NET-2 (RFC 5737)' },
  { base: '203.0.113.0', prefix: 24, label: 'Documentation, TEST-NET-3 (RFC 5737)' },
  { base: '198.18.0.0', prefix: 15, label: 'Benchmarking (RFC 2544)' },
  { base: '192.88.99.0', prefix: 24, label: 'Deprecated 6to4 relay anycast (RFC 7526)' },
  { base: '224.0.0.0', prefix: 4, label: 'Multicast (RFC 5771)' },
  { base: '240.0.0.0', prefix: 4, label: 'Reserved for future use (RFC 1112)' },
];

export interface AddressType {
  label: string;
  /** True for globally routable unicast space. */
  isPublic: boolean;
}

export function ipv4Type(value: number): AddressType {
  for (const rule of V4_TYPES) {
    const mask = prefixToMask(rule.prefix);
    if (((value & mask) >>> 0) === parseIPv4(rule.base)) return { label: rule.label, isPublic: false };
  }
  return { label: 'Public (globally routable)', isPublic: true };
}

export interface IPv4Cidr {
  ip: number;
  prefix: number;
}

/**
 * Parses `a.b.c.d/nn`, `a.b.c.d nn`, `a.b.c.d/255.255.255.0`, `a.b.c.d 255.255.255.0`
 * or a bare address (treated as /32 unless `defaultPrefix` is given).
 */
export function parseIPv4Cidr(text: string, defaultPrefix = 32): IPv4Cidr {
  const s = text.trim();
  if (!s) throw new IpError('Enter an IPv4 address or CIDR block, e.g. 192.168.1.10/24.');
  const m = /^([^\s/]+)(?:\s*\/\s*|\s+)(\S+)$/.exec(s);
  const ipText = m ? m[1] : s;
  const ip = parseIPv4(ipText);
  if (!m) return { ip, prefix: defaultPrefix };
  const suffix = m[2];
  if (/^\d+$/.test(suffix)) {
    const prefix = Number(suffix);
    if (prefix > 32) throw new IpError(`Prefix /${suffix} is out of range for IPv4 (0–32).`);
    return { ip, prefix };
  }
  if (suffix.includes('.')) return { ip, prefix: maskToPrefix(parseIPv4(suffix)) };
  throw new IpError(`"${suffix}" is not a prefix length or subnet mask.`);
}

export interface IPv4Info {
  ip: string;
  prefix: number;
  cidr: string;
  network: string;
  broadcast: string | null;
  mask: string;
  wildcard: string;
  firstHost: string;
  lastHost: string;
  totalAddresses: number;
  usableHosts: number;
  ipClass: IPv4Class;
  type: AddressType;
  binary: { ip: string; mask: string; network: string };
  integer: number;
  hex: string;
  reverseDns: string;
  note?: string;
}

export function ipv4Info(input: IPv4Cidr): IPv4Info {
  const { ip, prefix } = input;
  const mask = prefixToMask(prefix);
  const network = (ip & mask) >>> 0;
  const broadcast = (network | (~mask >>> 0)) >>> 0;
  const total = 2 ** (32 - prefix);
  let first: number;
  let last: number;
  let usable: number;
  let note: string | undefined;
  if (prefix === 32) {
    first = last = network;
    usable = 1;
    note = 'A /32 describes a single host.';
  } else if (prefix === 31) {
    first = network;
    last = broadcast;
    usable = 2;
    note = 'A /31 is a point-to-point link (RFC 3021): both addresses are usable and there is no broadcast address.';
  } else {
    first = network + 1;
    last = broadcast - 1;
    usable = total - 2;
  }
  const octets = formatIPv4(ip).split('.');
  return {
    ip: formatIPv4(ip),
    prefix,
    cidr: `${formatIPv4(network)}/${prefix}`,
    network: formatIPv4(network),
    broadcast: prefix >= 31 ? null : formatIPv4(broadcast),
    mask: formatIPv4(mask),
    wildcard: formatIPv4(~mask >>> 0),
    firstHost: formatIPv4(first),
    lastHost: formatIPv4(last),
    totalAddresses: total,
    usableHosts: usable,
    ipClass: ipv4Class(ip),
    type: ipv4Type(ip),
    binary: { ip: toBinaryIPv4(ip), mask: toBinaryIPv4(mask), network: toBinaryIPv4(network) },
    integer: ip >>> 0,
    hex: `0x${(ip >>> 0).toString(16).padStart(8, '0').toUpperCase()}`,
    reverseDns: `${octets.reverse().join('.')}.in-addr.arpa`,
    note,
  };
}

export interface Subnet {
  cidr: string;
  network: string;
  firstHost: string;
  lastHost: string;
  broadcast: string | null;
}

export interface SubnetSplit {
  count: number;
  subnets: Subnet[];
  truncated: boolean;
}

/** Splits `input`'s network into subnets of `newPrefix`, listing at most `limit` of them. */
export function splitIPv4(input: IPv4Cidr, newPrefix: number, limit = 1024): SubnetSplit {
  if (!Number.isInteger(newPrefix) || newPrefix < input.prefix || newPrefix > 32) {
    throw new IpError(`The new prefix must be between /${input.prefix} and /32.`);
  }
  const count = 2 ** (newPrefix - input.prefix);
  const size = 2 ** (32 - newPrefix);
  const base = (input.ip & prefixToMask(input.prefix)) >>> 0;
  const subnets: Subnet[] = [];
  const shown = Math.min(count, limit);
  for (let i = 0; i < shown; i++) {
    const info = ipv4Info({ ip: base + i * size, prefix: newPrefix });
    subnets.push({
      cidr: info.cidr,
      network: info.network,
      firstHost: info.firstHost,
      lastHost: info.lastHost,
      broadcast: info.broadcast,
    });
  }
  return { count, subnets, truncated: count > shown };
}

/* -------------------------------------------------------------------------- */
/* IPv6                                                                       */
/* -------------------------------------------------------------------------- */

const MAX128 = (1n << 128n) - 1n;

export interface ParsedIPv6 {
  value: bigint;
  /** Zone id (e.g. "eth0" from fe80::1%eth0), stripped from the value. */
  zone?: string;
}

export function parseIPv6(text: string): ParsedIPv6 {
  let s = text.trim();
  if (!s) throw new IpError('Enter an IPv6 address.');
  if (s.startsWith('[') && s.endsWith(']')) s = s.slice(1, -1);
  let zone: string | undefined;
  const pct = s.indexOf('%');
  if (pct >= 0) {
    zone = s.slice(pct + 1);
    s = s.slice(0, pct);
    if (!zone) throw new IpError('The zone id after "%" is empty.');
  }
  if (/[^0-9a-fA-F:.]/.test(s)) throw new IpError(`"${s}" contains characters that are not valid in an IPv6 address.`);
  if (s.includes(':::')) throw new IpError('":::" is not valid; use "::" once to compress zeros.');
  const doubles = s.split('::').length - 1;
  if (doubles > 1) throw new IpError('"::" may appear only once in an IPv6 address.');

  let tail4: number[] = [];
  const lastColon = s.lastIndexOf(':');
  if (s.slice(lastColon + 1).includes('.')) {
    const v4 = parseIPv4(s.slice(lastColon + 1));
    tail4 = [v4 >>> 16, v4 & 0xffff];
    s = s.slice(0, lastColon + 1);
    // "::1.2.3.4" leaves "::" which is fine; "1:2:3:4:5:6:" needs its trailing colon dropped.
    if (s.endsWith(':') && !s.endsWith('::')) s = s.slice(0, -1);
  }

  const parseGroups = (part: string): number[] => {
    if (part === '') return [];
    return part.split(':').map((g) => {
      if (g === '') throw new IpError('An IPv6 address cannot start or end with a single ":".');
      if (g.length > 4) throw new IpError(`Group "${g}" has more than 4 hex digits.`);
      if (!/^[0-9a-fA-F]+$/.test(g)) throw new IpError(`Group "${g}" is not hexadecimal.`);
      return parseInt(g, 16);
    });
  };

  let groups: number[];
  const needed = 8 - tail4.length;
  if (doubles === 1) {
    const [head, tail] = s.split('::');
    const h = parseGroups(head);
    const t = parseGroups(tail);
    const missing = needed - h.length - t.length;
    if (missing < 1) throw new IpError('Too many groups for an address that uses "::".');
    groups = [...h, ...new Array<number>(missing).fill(0), ...t];
  } else {
    groups = parseGroups(s);
    if (groups.length !== needed) {
      throw new IpError(`An IPv6 address needs 8 groups of hex digits; found ${groups.length + tail4.length}.`);
    }
  }
  groups = [...groups, ...tail4];
  let value = 0n;
  for (const g of groups) value = (value << 16n) | BigInt(g);
  return { value, zone };
}

export function ipv6Groups(value: bigint): number[] {
  const groups: number[] = [];
  for (let i = 7; i >= 0; i--) groups.push(Number((value >> BigInt(i * 16)) & 0xffffn));
  return groups;
}

export function expandIPv6(value: bigint): string {
  return ipv6Groups(value)
    .map((g) => g.toString(16).padStart(4, '0'))
    .join(':');
}

/** RFC 5952 canonical text form. */
export function compressIPv6(value: bigint): string {
  const groups = ipv6Groups(value);
  let bestStart = -1;
  let bestLen = 0;
  for (let i = 0; i < 8; ) {
    if (groups[i] !== 0) {
      i++;
      continue;
    }
    let j = i;
    while (j < 8 && groups[j] === 0) j++;
    if (j - i > bestLen) {
      bestStart = i;
      bestLen = j - i;
    }
    i = j;
  }
  const hex = groups.map((g) => g.toString(16));
  // IPv4-mapped addresses are conventionally shown with a dotted quad tail.
  if (groups.slice(0, 5).every((g) => g === 0) && groups[5] === 0xffff) {
    return `::ffff:${formatIPv4(Number(value & 0xffffffffn))}`;
  }
  if (bestLen < 2) return hex.join(':');
  const head = hex.slice(0, bestStart).join(':');
  const tail = hex.slice(bestStart + bestLen).join(':');
  return `${head}::${tail}`;
}

export function ipv6Mask(prefix: number): bigint {
  if (prefix <= 0) return 0n;
  return (MAX128 << BigInt(128 - prefix)) & MAX128;
}

const V6_TYPES: Array<{ base: string; prefix: number; label: string; isPublic?: boolean }> = [
  { base: '::', prefix: 128, label: 'Unspecified' },
  { base: '::1', prefix: 128, label: 'Loopback' },
  { base: '::ffff:0:0', prefix: 96, label: 'IPv4-mapped (RFC 4291)' },
  { base: '64:ff9b::', prefix: 96, label: 'IPv4/IPv6 translation (RFC 6052)' },
  { base: '100::', prefix: 64, label: 'Discard-only (RFC 6666)' },
  { base: '2001:db8::', prefix: 32, label: 'Documentation (RFC 3849)' },
  { base: '2001::', prefix: 32, label: 'Teredo (RFC 4380)' },
  { base: '2002::', prefix: 16, label: '6to4 (RFC 3056)' },
  { base: 'fe80::', prefix: 10, label: 'Link-local unicast (RFC 4291)' },
  { base: 'fc00::', prefix: 7, label: 'Unique local address (RFC 4193)' },
  { base: 'ff00::', prefix: 8, label: 'Multicast (RFC 4291)' },
  { base: '2000::', prefix: 3, label: 'Global unicast', isPublic: true },
];

export function ipv6Type(value: bigint): AddressType {
  for (const rule of V6_TYPES) {
    const mask = ipv6Mask(rule.prefix);
    if ((value & mask) === parseIPv6(rule.base).value) return { label: rule.label, isPublic: Boolean(rule.isPublic) };
  }
  return { label: 'Reserved by IETF', isPublic: false };
}

export interface IPv6Cidr {
  value: bigint;
  prefix: number;
  zone?: string;
}

export function parseIPv6Cidr(text: string, defaultPrefix = 128): IPv6Cidr {
  const s = text.trim();
  if (!s) throw new IpError('Enter an IPv6 address or CIDR block, e.g. 2001:db8::/32.');
  const slash = s.indexOf('/');
  if (slash < 0) return { ...parseIPv6(s), prefix: defaultPrefix };
  const suffix = s.slice(slash + 1).trim();
  if (!/^\d+$/.test(suffix)) throw new IpError(`"/${suffix}" is not a valid prefix length.`);
  const prefix = Number(suffix);
  if (prefix > 128) throw new IpError(`Prefix /${suffix} is out of range for IPv6 (0–128).`);
  return { ...parseIPv6(s.slice(0, slash)), prefix };
}

export interface IPv6Info {
  address: string;
  expanded: string;
  prefix: number;
  cidr: string;
  network: string;
  networkExpanded: string;
  first: string;
  last: string;
  lastExpanded: string;
  mask: string;
  totalAddresses: bigint;
  totalPower: number;
  type: AddressType;
  zone?: string;
  reverseDns: string;
}

export function ipv6Info(input: IPv6Cidr): IPv6Info {
  const mask = ipv6Mask(input.prefix);
  const network = input.value & mask;
  const last = network | (~mask & MAX128);
  const nibbles = expandIPv6(input.value).replace(/:/g, '').split('').reverse().join('.');
  return {
    address: compressIPv6(input.value),
    expanded: expandIPv6(input.value),
    prefix: input.prefix,
    cidr: `${compressIPv6(network)}/${input.prefix}`,
    network: compressIPv6(network),
    networkExpanded: expandIPv6(network),
    first: compressIPv6(network),
    last: compressIPv6(last),
    lastExpanded: expandIPv6(last),
    mask: compressIPv6(mask),
    totalAddresses: 1n << BigInt(128 - input.prefix),
    totalPower: 128 - input.prefix,
    type: ipv6Type(input.value),
    zone: input.zone,
    reverseDns: `${nibbles}.ip6.arpa`,
  };
}

/* -------------------------------------------------------------------------- */
/* Shared                                                                     */
/* -------------------------------------------------------------------------- */

export type IpFamily = 4 | 6;

export function detectFamily(text: string): IpFamily {
  return text.includes(':') ? 6 : 4;
}

export interface ContainsResult {
  contains: boolean;
  family: IpFamily;
  network: string;
}

/** Does `cidrText` contain `ipText`? Both must be the same family. */
export function cidrContains(cidrText: string, ipText: string): ContainsResult {
  const cf = detectFamily(cidrText);
  const af = detectFamily(ipText);
  if (!cidrText.trim()) throw new IpError('Enter a CIDR block.');
  if (!ipText.trim()) throw new IpError('Enter an IP address to check.');
  if (cf !== af) {
    throw new IpError(`The CIDR block is IPv${cf} but the address is IPv${af}; they can never match.`);
  }
  if (cf === 4) {
    const block = parseIPv4Cidr(cidrText);
    const ip = parseIPv4(ipText);
    const mask = prefixToMask(block.prefix);
    return {
      contains: ((ip & mask) >>> 0) === ((block.ip & mask) >>> 0),
      family: 4,
      network: `${formatIPv4((block.ip & mask) >>> 0)}/${block.prefix}`,
    };
  }
  const block = parseIPv6Cidr(cidrText);
  const ip = parseIPv6(ipText).value;
  const mask = ipv6Mask(block.prefix);
  return {
    contains: (ip & mask) === (block.value & mask),
    family: 6,
    network: `${compressIPv6(block.value & mask)}/${block.prefix}`,
  };
}

/** Formats a BigInt with thousands separators. */
export function formatBig(value: bigint): string {
  return value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}
