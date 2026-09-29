import { describe, expect, it } from 'vitest';
import { counterAt, hotp, secondsRemaining, totp, truncate, verifyTotp, type OtpAlgorithm } from './otp';
import { decodeBase32, encodeBase32, groupSecret } from './base32';
import { buildOtpauthUri, parseOtpauthUri } from './otpauth';

const ascii = (s: string) => new Uint8Array(Array.from(s, (c) => c.charCodeAt(0)));
const SEEDS: Record<OtpAlgorithm, Uint8Array> = {
  'SHA-1': ascii('12345678901234567890'),
  'SHA-256': ascii('12345678901234567890123456789012'),
  'SHA-512': ascii('1234567890123456789012345678901234567890123456789012345678901234'),
};

describe('HOTP (RFC 4226 Appendix D)', () => {
  it.each([
    [0, '755224'],
    [1, '287082'],
    [2, '359152'],
    [3, '969429'],
    [4, '338314'],
    [5, '254676'],
    [6, '287922'],
    [7, '162583'],
    [8, '399871'],
    [9, '520489'],
  ])('counter %i → %s', async (counter, code) => {
    expect(await hotp(SEEDS['SHA-1'], counter)).toBe(code);
  });

  it('truncates like the RFC example', () => {
    // RFC 4226 §5.4: HMAC-SHA-1 value with offset 0xa → 0x50ef7f19 → 872921 (6 digits)
    const mac = Uint8Array.from([0x1f, 0x86, 0x98, 0x69, 0x0e, 0x02, 0xca, 0x16, 0x61, 0x85, 0x50, 0xef, 0x7f, 0x19, 0xda, 0x8e, 0x94, 0x5b, 0x55, 0x5a]);
    expect(truncate(mac, 6)).toBe('872921');
  });

  it('rejects empty secrets and unsupported lengths', async () => {
    await expect(hotp(new Uint8Array(), 0)).rejects.toThrow(/empty/);
    await expect(hotp(SEEDS['SHA-1'], 0, 5)).rejects.toThrow(RangeError);
    await expect(hotp(SEEDS['SHA-1'], 0, 9)).rejects.toThrow(RangeError);
  });
});

describe('TOTP (RFC 6238 Appendix B)', () => {
  const vectors: Array<[number, string, OtpAlgorithm]> = [
    [59, '94287082', 'SHA-1'],
    [59, '46119246', 'SHA-256'],
    [59, '90693936', 'SHA-512'],
    [1111111109, '07081804', 'SHA-1'],
    [1111111109, '68084774', 'SHA-256'],
    [1111111109, '25091201', 'SHA-512'],
    [1111111111, '14050471', 'SHA-1'],
    [1111111111, '67062674', 'SHA-256'],
    [1111111111, '99943326', 'SHA-512'],
    [1234567890, '89005924', 'SHA-1'],
    [1234567890, '91819424', 'SHA-256'],
    [1234567890, '93441116', 'SHA-512'],
    [2000000000, '69279037', 'SHA-1'],
    [2000000000, '90698825', 'SHA-256'],
    [2000000000, '38618901', 'SHA-512'],
    [20000000000, '65353130', 'SHA-1'],
    [20000000000, '77737706', 'SHA-256'],
    [20000000000, '47863826', 'SHA-512'],
  ];
  it.each(vectors)('T=%i → %s (%s)', async (time, code, algorithm) => {
    expect(await totp(SEEDS[algorithm], time, { algorithm, digits: 8, period: 30 })).toBe(code);
  });

  it('computes counters and time left', () => {
    expect(counterAt(59)).toBe(1);
    expect(counterAt(1111111109)).toBe(37037036);
    expect(counterAt(20000000000)).toBe(666666666);
    expect(counterAt(100, 60, 50)).toBe(0);
    expect(secondsRemaining(59)).toBe(1);
    expect(secondsRemaining(60)).toBe(30);
    expect(secondsRemaining(61.5)).toBe(28.5);
  });

  it('verifies codes within ±1 step and reports the offset', async () => {
    const opts = { algorithm: 'SHA-1' as const, digits: 8, period: 30 };
    const seed = SEEDS['SHA-1'];
    expect(await verifyTotp(seed, '07081804', 1111111109, opts)).toBe(0);
    expect(await verifyTotp(seed, '14050471', 1111111109, opts)).toBe(1);
    expect(await verifyTotp(seed, '0708 1804', 1111111111, opts)).toBe(-1);
    expect(await verifyTotp(seed, '89005924', 1111111109, opts)).toBeNull();
    expect(await verifyTotp(seed, '1234', 1111111109, opts)).toBeNull();
    expect(await verifyTotp(seed, 'abcdefgh', 1111111109, opts)).toBeNull();
    expect(await verifyTotp(seed, '14050471', 1111111109, opts, 0)).toBeNull();
  });
});

describe('Base32', () => {
  it('encodes and decodes RFC 4648 test vectors', () => {
    const vectors: Array<[string, string]> = [
      ['', ''],
      ['f', 'MY'],
      ['fo', 'MZXQ'],
      ['foo', 'MZXW6'],
      ['foob', 'MZXW6YQ'],
      ['fooba', 'MZXW6YTB'],
      ['foobar', 'MZXW6YTBOI'],
    ];
    for (const [plain, encoded] of vectors) {
      expect(encodeBase32(ascii(plain))).toBe(encoded);
      if (encoded) expect(Array.from((decodeBase32(encoded) as { bytes: Uint8Array }).bytes)).toEqual(Array.from(ascii(plain)));
    }
    expect(encodeBase32(ascii('foobar'), true)).toBe('MZXW6YTBOI======');
  });

  it('accepts lower case, spaces, dashes and padding', () => {
    const r = decodeBase32('jbsw y3dp-ehpk 3pxp==');
    expect(r.ok && r.normalized).toBe('JBSWY3DPEHPK3PXP');
    expect(r.ok && Array.from(r.bytes)).toEqual([0x48, 0x65, 0x6c, 0x6c, 0x6f, 0x21, 0xde, 0xad, 0xbe, 0xef]);
  });

  it('explains invalid secrets', () => {
    expect(decodeBase32('')).toMatchObject({ ok: false, error: expect.stringMatching(/empty/) });
    expect(decodeBase32('JBSW0')).toMatchObject({ ok: false, error: expect.stringMatching(/“0” at position 5.*Did you mean “O”/) });
    expect(decodeBase32('AB=CD')).toMatchObject({ ok: false, error: expect.stringMatching(/padding may only appear at the end/) });
    expect(decodeBase32('ABC')).toMatchObject({ ok: false, error: expect.stringMatching(/cannot be 3 characters/) });
    expect(decodeBase32('😀')).toMatchObject({ ok: false });
  });

  it('round-trips random secrets and groups them', () => {
    for (let n = 1; n < 40; n++) {
      const bytes = crypto.getRandomValues(new Uint8Array(n));
      const r = decodeBase32(encodeBase32(bytes));
      expect(r.ok && Array.from(r.bytes)).toEqual(Array.from(bytes));
    }
    expect(groupSecret('JBSWY3DPEHPK3PXP')).toBe('JBSW Y3DP EHPK 3PXP');
    expect(groupSecret('ABCDE')).toBe('ABCD E');
  });
});

describe('otpauth URIs', () => {
  const base = { type: 'totp' as const, issuer: 'ACME Co', account: 'jane@example.com', secret: 'JBSWY3DPEHPK3PXP', algorithm: 'SHA-1' as const, digits: 6, period: 30 };

  it('builds Key URI Format links', () => {
    expect(buildOtpauthUri(base)).toBe(
      'otpauth://totp/ACME%20Co:jane%40example.com?secret=JBSWY3DPEHPK3PXP&issuer=ACME%20Co&algorithm=SHA1&digits=6&period=30',
    );
    expect(buildOtpauthUri({ ...base, issuer: '', account: '' })).toBe('otpauth://totp/user?secret=JBSWY3DPEHPK3PXP&algorithm=SHA1&digits=6&period=30');
    expect(buildOtpauthUri({ ...base, type: 'hotp', counter: 7, algorithm: 'SHA-512', digits: 8 })).toMatch(/^otpauth:\/\/hotp\/.*algorithm=SHA512&digits=8&counter=7$/);
  });

  it('parses what it builds, including Unicode labels', () => {
    for (const data of [base, { ...base, issuer: 'Zoë & Co', account: 'zoë@例え.jp', algorithm: 'SHA-256' as const, digits: 8, period: 60 }]) {
      const parsed = parseOtpauthUri(buildOtpauthUri(data));
      expect(parsed).toEqual({ ok: true, value: { ...data, counter: undefined } });
    }
  });

  it('reads Google-style URIs and falls back to the label issuer', () => {
    const r = parseOtpauthUri('otpauth://totp/Example:alice@google.com?secret=jbswy3dpehpk3pxp');
    expect(r).toEqual({
      ok: true,
      value: { type: 'totp', issuer: 'Example', account: 'alice@google.com', secret: 'JBSWY3DPEHPK3PXP', algorithm: 'SHA-1', digits: 6, period: 30, counter: undefined },
    });
  });

  it('explains broken URIs', () => {
    expect(parseOtpauthUri('https://example.com')).toMatchObject({ ok: false, error: expect.stringMatching(/starts with otpauth/) });
    expect(parseOtpauthUri('otpauth://motp/x?secret=AAAA')).toMatchObject({ ok: false, error: expect.stringMatching(/Unsupported OTP type/) });
    expect(parseOtpauthUri('otpauth://totp/x')).toMatchObject({ ok: false, error: expect.stringMatching(/no secret/) });
    expect(parseOtpauthUri('otpauth://totp/x?secret=1234')).toMatchObject({ ok: false, error: expect.stringMatching(/secret parameter is invalid/) });
    expect(parseOtpauthUri('otpauth://totp/x?secret=JBSWY3DP&algorithm=MD5')).toMatchObject({ ok: false, error: expect.stringMatching(/MD5/) });
    expect(parseOtpauthUri('otpauth://totp/x?secret=JBSWY3DP&digits=4')).toMatchObject({ ok: false, error: expect.stringMatching(/digits/) });
    expect(parseOtpauthUri('otpauth://totp/x?secret=JBSWY3DP&period=0')).toMatchObject({ ok: false, error: expect.stringMatching(/period/) });
    expect(parseOtpauthUri('otpauth://hotp/x?secret=JBSWY3DP')).toMatchObject({ ok: false, error: expect.stringMatching(/counter/) });
    expect(parseOtpauthUri('otpauth://totp/%E0%A4%A?secret=JBSWY3DP')).toMatchObject({ ok: false, error: expect.stringMatching(/percent-encoded/) });
  });
});
