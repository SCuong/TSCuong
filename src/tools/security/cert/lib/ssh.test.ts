import { describe, expect, it } from 'vitest';
import { parseOpenSshPrivateHeader, parseSshPublicKeyLine, sshFingerprint } from './ssh';
import { scanPem } from '../../shared-b/pem';
import { OPENSSH_ECDSA_PUBLIC, OPENSSH_ENCRYPTED_PRIVATE, OPENSSH_PRIVATE, OPENSSH_PUBLIC, OPENSSH_RSA_PUBLIC, SSH_FINGERPRINTS } from '../../shared-b/testFixtures';

describe('OpenSSH public keys', () => {
  it('reads Ed25519, RSA and ECDSA keys with ssh-keygen fingerprints', async () => {
    const ed = parseSshPublicKeyLine(OPENSSH_PUBLIC)!;
    expect(ed).toMatchObject({ type: 'ssh-ed25519', label: 'Ed25519', comment: 'test@localkit' });
    expect(await sshFingerprint(ed.blob)).toBe(SSH_FINGERPRINTS.ed25519);
    const rsa = parseSshPublicKeyLine(OPENSSH_RSA_PUBLIC)!;
    expect(rsa).toMatchObject({ type: 'ssh-rsa', label: 'RSA 3072-bit', bits: 3072 });
    expect(await sshFingerprint(rsa.blob)).toBe(SSH_FINGERPRINTS.rsa);
    const ec = parseSshPublicKeyLine(OPENSSH_ECDSA_PUBLIC)!;
    expect(ec).toMatchObject({ type: 'ecdsa-sha2-nistp256', label: 'ECDSA P-256', comment: '' });
    expect(await sshFingerprint(ec.blob)).toBe(SSH_FINGERPRINTS.ecdsa);
  });

  it('accepts authorized_keys options and rejects mismatched or broken lines', () => {
    expect(parseSshPublicKeyLine(`no-pty,from="10.0.0.1" ${OPENSSH_PUBLIC}`)?.type).toBe('ssh-ed25519');
    const [, blob] = OPENSSH_PUBLIC.split(' ');
    expect(parseSshPublicKeyLine(`ssh-rsa ${blob}`)).toBeNull();
    expect(parseSshPublicKeyLine('ssh-ed25519 AAAA')).toBeNull();
    expect(parseSshPublicKeyLine('hello world')).toBeNull();
    expect(parseSshPublicKeyLine('')).toBeNull();
  });
});

describe('OpenSSH private keys', () => {
  it('reads only the public header of unencrypted and encrypted keys', async () => {
    const plain = parseOpenSshPrivateHeader(scanPem(OPENSSH_PRIVATE).blocks[0].der!);
    expect(plain).toMatchObject({ cipher: 'none', kdf: 'none', encrypted: false, keyCount: 1 });
    expect(plain.publicKey?.label).toBe('Ed25519');
    expect(await sshFingerprint(plain.publicKey!.blob)).toBe(SSH_FINGERPRINTS.ed25519);
    const enc = parseOpenSshPrivateHeader(scanPem(OPENSSH_ENCRYPTED_PRIVATE).blocks[0].der!);
    expect(enc).toMatchObject({ cipher: 'aes256-ctr', kdf: 'bcrypt', encrypted: true });
    expect(await sshFingerprint(enc.publicKey!.blob)).toBe(SSH_FINGERPRINTS.ed25519Encrypted);
  });

  it('rejects other data', () => {
    expect(() => parseOpenSshPrivateHeader(new TextEncoder().encode('not a key'))).toThrow(/openssh-key-v1/);
  });
});
