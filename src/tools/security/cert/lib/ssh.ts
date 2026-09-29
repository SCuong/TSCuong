/** OpenSSH public key lines and "openssh-key-v1" private key headers (metadata only). */

import { base64ToBytes, bytesToBase64 } from '../../shared-a/bytes';
import { bitLength } from '../../shared-b/der';

export interface SshKeyInfo {
  /** Key type as written in the key, e.g. "ssh-ed25519". */
  type: string;
  /** "RSA 3072-bit", "Ed25519", "ECDSA P-256", ... */
  label: string;
  bits?: number;
  /** The public key blob (SSH wire format). */
  blob: Uint8Array;
}

class Reader {
  private pos = 0;
  private readonly data: Uint8Array;
  constructor(data: Uint8Array) {
    this.data = data;
  }
  uint32(): number {
    if (this.pos + 4 > this.data.length) throw new Error('truncated');
    const v = ((this.data[this.pos] << 24) | (this.data[this.pos + 1] << 16) | (this.data[this.pos + 2] << 8) | this.data[this.pos + 3]) >>> 0;
    this.pos += 4;
    return v;
  }
  bytes(): Uint8Array {
    const len = this.uint32();
    if (len > this.data.length - this.pos) throw new Error('truncated');
    const out = this.data.subarray(this.pos, this.pos + len);
    this.pos += len;
    return out;
  }
  string(): string {
    return new TextDecoder().decode(this.bytes());
  }
}

const ECDSA_CURVES: Record<string, string> = { nistp256: 'P-256', nistp384: 'P-384', nistp521: 'P-521' };

/** Reads the key type and size from an SSH wire-format public key blob. */
export function parseSshPublicBlob(blob: Uint8Array): SshKeyInfo {
  const r = new Reader(blob);
  const type = r.string();
  if (type === 'ssh-rsa') {
    r.bytes(); // e
    const bits = bitLength(r.bytes());
    return { type, label: `RSA ${bits}-bit`, bits, blob };
  }
  if (type === 'ssh-ed25519' || type === 'sk-ssh-ed25519@openssh.com') {
    if (r.bytes().length !== 32) throw new Error('bad ed25519 key');
    return { type, label: type.startsWith('sk-') ? 'Ed25519 (FIDO security key)' : 'Ed25519', bits: 256, blob };
  }
  if (type.startsWith('ecdsa-sha2-') || type.startsWith('sk-ecdsa-sha2-')) {
    const curve = r.string();
    r.bytes();
    const name = ECDSA_CURVES[curve] ?? curve;
    return { type, label: `ECDSA ${name}${type.startsWith('sk-') ? ' (FIDO security key)' : ''}`, bits: Number(name.slice(2)) || undefined, blob };
  }
  if (type === 'ssh-dss') {
    const bits = bitLength(r.bytes());
    return { type, label: `DSA ${bits}-bit (deprecated)`, bits, blob };
  }
  return { type, label: type, blob };
}

/** ssh-keygen style fingerprint: "SHA256:" + unpadded Base64 of SHA-256(blob). */
export async function sshFingerprint(blob: Uint8Array): Promise<string> {
  const copy = new Uint8Array(blob);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', copy));
  return `SHA256:${bytesToBase64(digest).replace(/=+$/, '')}`;
}

export interface SshPublicKeyLine extends SshKeyInfo {
  comment: string;
}

const LINE_RE = /^(?:(?:[^\s"]|"[^"]*")+\s+)?((?:ssh|ecdsa|sk)-[a-z0-9@.-]+)\s+([A-Za-z0-9+/]+={0,2})(?:\s+(.*))?$/;

/** Parses "ssh-ed25519 AAAA… comment" lines (authorized_keys style options are tolerated). */
export function parseSshPublicKeyLine(line: string): SshPublicKeyLine | null {
  const m = LINE_RE.exec(line.trim());
  if (!m) return null;
  const blob = base64ToBytes(m[2]);
  if (!blob) return null;
  try {
    const info = parseSshPublicBlob(blob);
    if (info.type !== m[1]) return null;
    return { ...info, comment: (m[3] ?? '').trim() };
  } catch {
    return null;
  }
}

export interface OpenSshPrivateInfo {
  cipher: string;
  kdf: string;
  encrypted: boolean;
  keyCount: number;
  publicKey: SshKeyInfo | null;
}

/** Reads the unencrypted header of an "openssh-key-v1" private key (never the private part). */
export function parseOpenSshPrivateHeader(der: Uint8Array): OpenSshPrivateInfo {
  const magic = 'openssh-key-v1\0';
  const head = new TextDecoder().decode(der.subarray(0, magic.length));
  if (head !== magic) throw new Error('This is not an openssh-key-v1 private key.');
  const r = new Reader(der.subarray(magic.length));
  const cipher = r.string();
  const kdf = r.string();
  r.bytes(); // kdf options
  const keyCount = r.uint32();
  let publicKey: SshKeyInfo | null;
  try {
    publicKey = parseSshPublicBlob(r.bytes());
  } catch {
    publicKey = null;
  }
  return { cipher, kdf, encrypted: cipher !== 'none', keyCount, publicKey };
}
