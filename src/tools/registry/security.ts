import {
  FileBadge,
  FileCheck,
  Gauge,
  Hash,
  KeyRound,
  KeySquare,
  LockKeyhole,
  RectangleEllipsis,
  Signature,
  Stamp,
  TicketCheck,
  Timer,
} from 'lucide-react';
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
  // --- sec-b: JWT, passwords, certificates, key pairs, TOTP ---
  {
    id: 'jwt-decoder',
    name: 'JWT Decoder & Verifier',
    description:
      'Decode JSON Web Tokens, explain their claims and expiry, and verify HS, RS, PS, ES and EdDSA signatures with a secret, public key, certificate or JWKS.',
    category: 'security',
    icon: TicketCheck,
    route: 'jwt',
    redirectFrom: ['jwt-decoder', 'security/jwt', 'security/jwt-decoder'],
    keywords: [
      'jwt', 'json web token', 'token', 'decode', 'decoder', 'debugger', 'verify', 'verifier', 'validate', 'signature',
      'jws', 'jwe', 'bearer', 'authorization', 'id token', 'id_token', 'access token', 'oauth', 'oauth2', 'openid',
      'oidc', 'claims', 'exp', 'expiry', 'expiration', 'iat', 'hs256', 'rs256', 'es256', 'ps256', 'eddsa', 'jwks', 'jwk',
      'public key', 'secret', 'auth0', 'cognito', 'keycloak', 'firebase', 'alg none',
    ],
    aliases: [
      'decode jwt', 'jwt decoder', 'jwt debugger', 'verify jwt', 'verify jwt signature', 'jwt.io', 'decode token',
      'parse jwt', 'inspect jwt', 'jwt viewer', 'check jwt expiry', 'is my jwt expired', 'decode bearer token',
      'id token decoder', 'access token decoder', 'validate jwt', 'jwt signature checker',
    ],
    load: () => import('../security/jwt/JwtDecoder'),
    requires: ['webCrypto'],
    priority: 2,
  },
  {
    id: 'password-generator',
    name: 'Password Generator',
    description:
      'Generate strong random passwords or memorable passphrases from the EFF word list, in bulk, with exact entropy and no modulo bias.',
    category: 'security',
    icon: RectangleEllipsis,
    route: 'password-generator',
    redirectFrom: ['security/password-generator', 'passphrase-generator'],
    keywords: [
      'password', 'passphrase', 'generator', 'generate', 'random', 'strong', 'secure', 'diceware', 'eff', 'wordlist',
      'word list', 'xkcd', 'entropy', 'symbols', 'characters', 'memorable', 'bulk', 'pwgen', 'credentials',
    ],
    aliases: [
      'strong password', 'random password', 'generate password', 'passphrase generator', 'diceware generator',
      'secure password generator', 'memorable password', 'xkcd password', 'make a password', 'strong password generator',
      'create password', 'password maker',
    ],
    load: () => import('../security/password/PasswordGenerator'),
    requires: ['webCrypto'],
    priority: 2,
  },
  {
    id: 'password-strength',
    name: 'Password Strength Checker',
    description:
      'See how guessable a password is with zxcvbn: score, crack times for four attacks, weak patterns and advice. It never leaves your device.',
    category: 'security',
    icon: Gauge,
    route: 'password-strength',
    redirectFrom: ['security/password-strength', 'password-checker', 'password-strength-checker'],
    keywords: [
      'password', 'strength', 'checker', 'meter', 'test', 'zxcvbn', 'entropy', 'crack', 'cracking', 'brute force', 'guess',
      'guessable', 'weak', 'strong', 'secure', 'dictionary', 'common password', 'audit',
    ],
    aliases: [
      'password strength checker', 'how strong is my password', 'test password strength', 'password meter',
      'is my password secure', 'check password', 'how long to crack password', 'password entropy calculator',
      'password tester',
    ],
    load: () => import('../security/password/PasswordStrength'),
  },
  {
    id: 'certificate-inspector',
    name: 'Certificate & PEM Inspector',
    description:
      'Decode X.509 certificates, chains, CSRs, CRLs and PEM keys: names, validity, SANs, key usage, fingerprints and chain order.',
    category: 'security',
    icon: FileBadge,
    route: 'certificate',
    redirectFrom: ['security/certificate', 'certificate-decoder', 'pem-decoder', 'csr-decoder', 'x509'],
    keywords: [
      'certificate', 'cert', 'x509', 'x.509', 'pem', 'der', 'crt', 'cer', 'csr', 'pkcs10', 'pkcs7', 'p7b', 'crl', 'ssl',
      'tls', 'https', 'san', 'subject alternative name', 'fingerprint', 'thumbprint', 'sha256', 'chain', 'intermediate',
      'root ca', 'expiry', 'expiration', 'openssl', 'public key', 'private key', 'rsa', 'ecdsa', 'ssh', 'key usage',
    ],
    aliases: [
      'decode certificate', 'certificate decoder', 'ssl certificate decoder', 'pem decoder', 'csr decoder',
      'x509 decoder', 'check certificate expiry', 'certificate chain checker', 'view certificate', 'openssl x509 text',
      'parse pem', 'certificate fingerprint', 'does my key match my certificate',
    ],
    load: () => import('../security/cert/CertificateInspector'),
    requires: ['webCrypto'],
  },
  {
    id: 'jwt-generator',
    name: 'JWT Generator & Signer',
    description:
      'Build and sign test JSON Web Tokens with HS, RS, PS, ES or EdDSA: edit the header and claims, set expiry, and create secrets or key pairs.',
    category: 'security',
    icon: Stamp,
    route: 'jwt/generate',
    redirectFrom: ['jwt-generator', 'security/jwt-generator', 'jwt/sign', 'jwt/encode'],
    keywords: [
      'jwt', 'json web token', 'generate', 'generator', 'create', 'sign', 'signer', 'encode', 'encoder', 'token', 'jws',
      'hs256', 'rs256', 'es256', 'ps256', 'eddsa', 'claims', 'exp', 'iat', 'private key', 'secret', 'test token',
      'mock token', 'bearer', 'auth',
    ],
    aliases: [
      'create jwt', 'generate jwt', 'sign jwt', 'jwt encoder', 'make a jwt', 'jwt builder', 'test jwt token',
      'jwt creator', 'encode jwt', 'sign token with private key',
    ],
    load: () => import('../security/jwt/JwtGenerator'),
    requires: ['webCrypto'],
  },
  {
    id: 'key-pair-generator',
    name: 'RSA / EC Key Pair Generator',
    description:
      'Generate RSA, ECDSA, ECDH, Ed25519 and X25519 key pairs with Web Crypto and export them as PEM, JWK, JWKS or OpenSSH.',
    category: 'security',
    icon: KeySquare,
    route: 'key-pair',
    redirectFrom: ['security/key-pair', 'key-pair-generator', 'rsa-key-generator', 'keygen'],
    keywords: [
      'key pair', 'keypair', 'keygen', 'generate', 'generator', 'rsa', 'ecdsa', 'ecdh', 'ec', 'elliptic curve', 'p-256',
      'p-384', 'p-521', 'ed25519', 'x25519', 'eddsa', 'public key', 'private key', 'pem', 'pkcs8', 'spki', 'jwk', 'jwks',
      'openssh', 'ssh', 'rsa-oaep', 'rsa-pss', '2048', '4096',
    ],
    aliases: [
      'generate rsa key', 'rsa key generator', 'generate key pair', 'ec key generator', 'generate public private key',
      'ed25519 key generator', 'generate jwk', 'jwks generator', 'ssh key generator', 'openssl genrsa',
      'create private key',
    ],
    load: () => import('../security/keys/KeyPairGenerator'),
    requires: ['webCrypto'],
  },
  {
    id: 'totp-generator',
    name: 'TOTP / 2FA Code Generator',
    description:
      'Generate and check time-based one-time passwords (RFC 6238) from a Base32 secret, and build otpauth:// setup links with a QR code.',
    category: 'security',
    icon: Timer,
    route: 'totp',
    redirectFrom: ['security/totp', 'totp-generator', '2fa'],
    keywords: [
      'totp', 'otp', '2fa', 'mfa', 'two-factor', 'one-time password', 'authenticator', 'google authenticator', 'authy',
      'hotp', 'rfc 6238', 'base32', 'otpauth', 'qr', 'verification code', 'secret', 'time-based',
    ],
    aliases: [
      '2fa code generator', 'totp generator', 'generate otp', 'authenticator code', 'google authenticator code',
      'test 2fa', 'verify totp code', 'otpauth uri', 'mfa code', 'two factor code',
    ],
    load: () => import('../security/totp/TotpGenerator'),
    requires: ['webCrypto'],
  },
  // --- end sec-b ---
];
