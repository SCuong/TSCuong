import { FileCheck, Hash, KeyRound, LockKeyhole, Signature } from 'lucide-react';
import type { ToolDefinition } from '../types';

export const securityTools: ToolDefinition[] = [
  // --- sec-a: hashing, checksums, HMAC, AES, bcrypt ---
  {
    id: 'hash-generator',
    name: 'Hash Generator',
    description: 'Compute MD5, SHA-1, SHA-2, SHA-3, BLAKE2/3, Keccak, RIPEMD, CRC32 and xxHash digests of text or large files.',
    category: 'security',
    icon: Hash,
    route: 'security/hash-generator',
    keywords: [
      'hash', 'digest', 'checksum', 'md5', 'sha1', 'sha-1', 'sha256', 'sha-256', 'sha224', 'sha384', 'sha512', 'sha-512',
      'sha3', 'sha-3', 'keccak', 'keccak256', 'blake2', 'blake2b', 'blake2s', 'blake3', 'ripemd160', 'crc32', 'xxhash',
      'xxh64', 'fingerprint', 'file hash', 'text hash',
    ],
    aliases: [
      'md5 generator', 'sha256 generator', 'sha256 hash', 'md5 hash', 'sha1 hash', 'file checksum', 'hash a file',
      'online hash calculator', 'sha512 generator', 'md5sum', 'sha256sum',
    ],
    load: () => import('../security/HashGenerator'),
    requires: ['webAssembly'],
  },
  {
    id: 'checksum-verifier',
    name: 'Checksum Verifier',
    description: 'Check a downloaded file against its expected hash, with the algorithm detected automatically.',
    category: 'security',
    icon: FileCheck,
    route: 'security/checksum-verifier',
    keywords: [
      'checksum', 'verify', 'hash', 'compare', 'integrity', 'sha256', 'sha256sum', 'md5', 'md5sum', 'sha1', 'sha512',
      'sha256sums', 'download', 'iso', 'match', 'validate', 'file integrity',
    ],
    aliases: [
      'verify checksum', 'check sha256', 'verify file hash', 'compare hash', 'check md5', 'verify download',
      'sha256 checker', 'checksum checker', 'hash checker',
    ],
    load: () => import('../security/ChecksumVerifier'),
    requires: ['webAssembly'],
  },
  {
    id: 'hmac-generator',
    name: 'HMAC Generator',
    description: 'Compute and verify HMAC-SHA256/384/512, HMAC-SHA1 and HMAC-MD5 with text, hex or Base64 keys.',
    category: 'security',
    icon: Signature,
    route: 'security/hmac-generator',
    keywords: [
      'hmac', 'mac', 'sha256', 'sha512', 'sha384', 'sha1', 'md5', 'signature', 'sign', 'webhook', 'secret', 'key',
      'message authentication', 'verify signature', 'hash',
    ],
    aliases: [
      'hmac sha256', 'hmac-sha256', 'hmac generator', 'webhook signature', 'verify webhook signature', 'hmac calculator',
      'sign message', 'hmac sha512',
    ],
    load: () => import('../security/HmacGenerator'),
    requires: ['webCrypto'],
  },
  {
    id: 'aes-encrypt',
    name: 'AES Encrypt / Decrypt',
    description: 'Encrypt text or files with a passphrase using AES-256-GCM and PBKDF2, and decrypt them again.',
    category: 'security',
    icon: LockKeyhole,
    route: 'security/aes-encrypt',
    keywords: [
      'aes', 'aes-256', 'aes-gcm', 'gcm', 'encrypt', 'decrypt', 'encryption', 'decryption', 'cipher', 'password',
      'passphrase', 'pbkdf2', 'secure', 'protect', 'file encryption', 'text encryption', 'secret',
    ],
    aliases: [
      'encrypt text', 'decrypt text', 'encrypt file', 'decrypt file', 'password protect file', 'aes encryption',
      'aes decryption', 'encrypt with password',
    ],
    load: () => import('../security/AesEncrypt'),
    requires: ['webCrypto'],
  },
  {
    id: 'bcrypt',
    name: 'Bcrypt Hash & Verify',
    description: 'Hash passwords with bcrypt at a chosen cost and check a password against an existing bcrypt hash.',
    category: 'security',
    icon: KeyRound,
    route: 'security/bcrypt',
    keywords: [
      'bcrypt', 'password hash', 'password', 'hash', 'verify', 'check', 'cost', 'salt', '$2a$', '$2b$', '$2y$',
      'blowfish', 'login', 'credential',
    ],
    aliases: [
      'bcrypt generator', 'bcrypt hash generator', 'bcrypt verify', 'bcrypt checker', 'hash password',
      'check bcrypt hash', 'bcrypt compare',
    ],
    load: () => import('../security/BcryptTool'),
    requires: ['webAssembly'],
  },
  // --- end sec-a ---
];
