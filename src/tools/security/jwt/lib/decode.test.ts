import { describe, expect, it } from 'vitest';
import { decodeToken, extractToken, findDuplicateKeys, type DecodedJwe, type DecodedJws, type DecodeResult } from './decode';
import { encodeBase64Url, encodeBase64UrlText } from './base64url';

const JWT_IO =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
/** RFC 7515 Appendix A.1 (header and payload contain CRLF line breaks). */
const RFC7515_A1 =
  'eyJ0eXAiOiJKV1QiLA0KICJhbGciOiJIUzI1NiJ9.eyJpc3MiOiJqb2UiLA0KICJleHAiOjEzMDA4MTkzODAsDQogImh0dHA6Ly9leGFtcGxlLmNvbS9pc19yb290Ijp0cnVlfQ.dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';

const part = (value: unknown) => encodeBase64UrlText(typeof value === 'string' ? value : JSON.stringify(value));
const sig = (n: number) => encodeBase64Url(new Uint8Array(n).fill(7));

function ok(result: DecodeResult | null): DecodedJws {
  if (!result || !result.ok) throw new Error(`expected success, got ${result && !result.ok ? result.error : 'null'}`);
  if (result.value.kind !== 'jws') throw new Error('expected a JWS');
  return result.value;
}

function err(result: DecodeResult | null): string {
  if (!result || result.ok) throw new Error('expected an error');
  return result.error;
}

const messages = (d: { issues: Array<{ message: string }> }) => d.issues.map((i) => i.message).join('\n');

describe('decodeToken: well-formed tokens', () => {
  it('returns null for empty input', () => {
    expect(decodeToken('')).toBeNull();
    expect(decodeToken('   \n ')).toBeNull();
  });

  it('decodes the jwt.io example', () => {
    const d = ok(decodeToken(JWT_IO));
    expect(d.header).toEqual({ alg: 'HS256', typ: 'JWT' });
    expect(d.alg).toBe('HS256');
    expect(d.payload.kind).toBe('claims');
    expect(d.payload.kind === 'claims' && d.payload.claims).toEqual({ sub: '1234567890', name: 'John Doe', iat: 1516239022 });
    expect(d.signature.length).toBe(32);
    expect(d.segments.map((s) => s.name)).toEqual(['header', 'payload', 'signature']);
    expect(d.segments[2].byteLength).toBe(32);
    expect(d.issues.filter((i) => i.level !== 'info')).toEqual([]);
  });

  it('keeps the exact header bytes (CRLF) of RFC 7515 A.1', () => {
    const d = ok(decodeToken(RFC7515_A1));
    expect(d.headerText).toBe('{"typ":"JWT",\r\n "alg":"HS256"}');
    expect(d.payload.kind === 'claims' && d.payload.claims['http://example.com/is_root']).toBe(true);
  });

  it('cleans Bearer prefixes, quotes, headers and line breaks', () => {
    const wrapped = `Authorization: Bearer ${JWT_IO.slice(0, 40)}\n${JWT_IO.slice(40)}`;
    const d = ok(decodeToken(wrapped));
    expect(d.token).toBe(JWT_IO);
    expect(d.notes.join(' ')).toMatch(/Authorization/);
    expect(d.notes.join(' ')).toMatch(/Bearer/);
    expect(d.notes.join(' ')).toMatch(/line breaks/);
    expect(ok(decodeToken(`"${JWT_IO}"`)).notes).toEqual(['Removed surrounding quotes.']);
    expect(ok(decodeToken(`'${JWT_IO}',`)).token).toBe(JWT_IO);
  });

  it('extracts tokens from JSON token responses', () => {
    const json = JSON.stringify({ access_token: 'opaque', token_type: 'Bearer', id_token: JWT_IO, expires_in: 3600 });
    const d = ok(decodeToken(json));
    expect(d.token).toBe(JWT_IO);
    expect(d.notes[0]).toMatch(/“id_token”/);
    expect(err(decodeToken('{"a": 1}'))).toMatch(/does not contain anything that looks like a JWT/);
    expect(err(decodeToken('{"a": '))).toMatch(/does not parse/);
  });

  it('converts JWS JSON serializations to compact form', () => {
    const [p, pl, s] = JWT_IO.split('.');
    const flat = ok(decodeToken(JSON.stringify({ protected: p, payload: pl, signature: s, header: { kid: '1' } })));
    expect(flat.token).toBe(JWT_IO);
    expect(flat.notes.join(' ')).toMatch(/flattened/);
    const general = ok(decodeToken(JSON.stringify({ payload: pl, signatures: [{ protected: p, signature: s }, { protected: p, signature: s }] })));
    expect(general.token).toBe(JWT_IO);
    expect(general.notes[0]).toMatch(/first of 2 signatures/);
  });

  it('handles Unicode claims', () => {
    const token = `${part({ alg: 'HS256' })}.${part({ name: 'Zoë 😀', city: '東京' })}.${sig(32)}`;
    const d = ok(decodeToken(token));
    expect(d.payload.kind === 'claims' && d.payload.claims.name).toBe('Zoë 😀');
  });

  it('decodes very long tokens', () => {
    const big = { data: 'x'.repeat(50_000) };
    const d = ok(decodeToken(`${part({ alg: 'HS256' })}.${part(big)}.${sig(32)}`));
    expect(d.payload.kind === 'claims' && (d.payload.claims.data as string).length).toBe(50_000);
    expect(messages(d)).toMatch(/KB/);
  });

  it('decodes JWE protected headers only', () => {
    const header = part({ alg: 'RSA-OAEP-256', enc: 'A256GCM', kid: 'k1' });
    const r = decodeToken(`${header}.${sig(256)}.${sig(12)}.${sig(100)}.${sig(16)}`);
    expect(r?.ok).toBe(true);
    const jwe = (r as { value: DecodedJwe }).value;
    expect(jwe.kind).toBe('jwe');
    expect(jwe.enc).toBe('A256GCM');
    expect(jwe.alg).toBe('RSA-OAEP-256');
    expect(jwe.segments.map((s) => s.byteLength)).toEqual([expect.any(Number), 256, 12, 100, 16]);
    expect(jwe.segments.map((s) => s.name)).toEqual(['header', 'encryptedKey', 'iv', 'ciphertext', 'tag']);
  });

  it('flags JWE problems', () => {
    const r = decodeToken(`${part({ alg: 'RSA1_5' })}.${sig(10)}.${sig(12)}..${sig(16)}`);
    const jwe = (r as { value: DecodedJwe }).value;
    const text = messages(jwe);
    expect(text).toMatch(/no “enc”/);
    expect(text).toMatch(/RSA1_5/);
    expect(text).toMatch(/ciphertext \(part 4\) is empty/);
  });
});

describe('decodeToken: malformed tokens', () => {
  it('explains wrong part counts', () => {
    expect(err(decodeToken('hello'))).toMatch(/no dots/);
    expect(err(decodeToken(part({ alg: 'HS256' })))).toMatch(/single Base64URL-encoded JSON object/);
    expect(err(decodeToken('a.b'))).toMatch(/Only 2 parts/);
    expect(err(decodeToken('a.b.c.d'))).toMatch(/Found 4 parts/);
    expect(err(decodeToken('a.b.c.d.e.f'))).toMatch(/Found 6 parts/);
  });

  it('pinpoints invalid Base64URL characters', () => {
    expect(err(decodeToken(`eyJhb%ciOiJIUzI1NiJ9.${part({})}.${sig(32)}`))).toMatch(/header \(part 1\) contains “%” at character 6/);
    expect(err(decodeToken(`${part({ alg: 'HS256' })}.abc$.${sig(32)}`))).toMatch(/payload \(part 2\) contains “\$”/);
    expect(err(decodeToken(`${part({ alg: 'HS256' })}.${part({})}.sig!`))).toMatch(/signature \(part 3\) contains “!”/);
  });

  it('detects truncated parts', () => {
    expect(err(decodeToken(`eyJhbGciOiJIUzI1N.${part({})}.${sig(32)}`))).toMatch(/impossible Base64URL length \(17 characters/);
  });

  it('rejects headers that are not JSON objects', () => {
    expect(err(decodeToken(`.${part({})}.${sig(32)}`))).toMatch(/header \(part 1\) is empty/);
    expect(err(decodeToken(`${part('not json')}.${part({})}.${sig(32)}`))).toMatch(/not valid JSON/);
    expect(err(decodeToken(`${part([1, 2])}.${part({})}.${sig(32)}`))).toMatch(/must be a JSON object, but it is an array/);
    expect(err(decodeToken(`${part('null')}.${part({})}.${sig(32)}`))).toMatch(/but it is null/);
    expect(err(decodeToken(`${encodeBase64Url(Uint8Array.of(0xff, 0xfe, 0xfd))}.${part({})}.${sig(32)}`))).toMatch(/not UTF-8/);
  });

  it('shows non-JSON payloads as text or binary with an explanation', () => {
    const text = ok(decodeToken(`${part({ alg: 'HS256' })}.${part('hello world')}.${sig(32)}`));
    expect(text.payload).toEqual({ kind: 'text', text: 'hello world' });
    expect(messages(text)).toMatch(/plain text, not JSON/);
    const broken = ok(decodeToken(`${part({ alg: 'HS256' })}.${part('{"a":1,}')}.${sig(32)}`));
    expect(broken.issues[0].level).toBe('danger');
    expect(broken.issues[0].message).toMatch(/looks like JSON but does not parse/);
    const bin = ok(decodeToken(`${part({ alg: 'HS256' })}.${encodeBase64Url(Uint8Array.of(0xff, 0x00, 0x81))}.${sig(32)}`));
    expect(bin.payload.kind).toBe('binary');
    const arr = ok(decodeToken(`${part({ alg: 'HS256' })}.${part([1])}.${sig(32)}`));
    expect(arr.payload.kind).toBe('json');
    expect(messages(arr)).toMatch(/must be a JSON object/);
  });

  it('recognises detached payloads', () => {
    const d = ok(decodeToken(`${part({ alg: 'HS256' })}..${sig(32)}`));
    expect(d.payload.kind).toBe('detached');
    expect(messages(d)).toMatch(/detached payload/);
  });
});

describe('decodeToken: security observations', () => {
  it('warns loudly about alg none and its case variants', () => {
    const none = ok(decodeToken(`${part({ alg: 'none' })}.${part({ sub: 'x' })}.`));
    expect(none.issues[0]).toMatchObject({ level: 'danger' });
    expect(none.issues[0].message).toMatch(/unsecured/);
    const variant = ok(decodeToken(`${part({ alg: 'nOnE' })}.${part({ sub: 'x' })}.`));
    expect(messages(variant)).toMatch(/case variation/);
    const withSig = ok(decodeToken(`${part({ alg: 'none' })}.${part({})}.${sig(32)}`));
    expect(messages(withSig)).toMatch(/still carries a signature/);
  });

  it('flags missing algorithms, empty signatures and unknown algorithms', () => {
    expect(messages(ok(decodeToken(`${part({ typ: 'JWT' })}.${part({})}.${sig(32)}`)))).toMatch(/no “alg”/);
    expect(messages(ok(decodeToken(`${part({ alg: 5 })}.${part({})}.${sig(32)}`)))).toMatch(/must be a string/);
    expect(messages(ok(decodeToken(`${part({ alg: 'HS256' })}.${part({})}.`)))).toMatch(/signature part is empty/);
    expect(messages(ok(decodeToken(`${part({ alg: 'XYZ' })}.${part({})}.${sig(32)}`)))).toMatch(/Unknown algorithm “XYZ”/);
    expect(messages(ok(decodeToken(`${part({ alg: 'RSA-OAEP' })}.${part({})}.${sig(32)}`)))).toMatch(/key-management/);
  });

  it('checks signature lengths, including DER-encoded ECDSA', () => {
    expect(messages(ok(decodeToken(`${part({ alg: 'HS256' })}.${part({})}.${sig(20)}`)))).toMatch(/HS256 signature is 20 bytes/);
    const der = new Uint8Array(71);
    der[0] = 0x30;
    expect(messages(ok(decodeToken(`${part({ alg: 'ES256' })}.${part({})}.${encodeBase64Url(der)}`)))).toMatch(/DER-encoded/);
    expect(messages(ok(decodeToken(`${part({ alg: 'ES256' })}.${part({})}.${sig(64)}`)))).not.toMatch(/bytes/);
    expect(messages(ok(decodeToken(`${part({ alg: 'RS256' })}.${part({})}.${sig(128)}`)))).toMatch(/only 1024 bits/);
  });

  it('warns about key URLs, embedded keys and suspicious kids', () => {
    const text = messages(ok(decodeToken(`${part({ alg: 'RS256', jku: 'https://evil.example/jwks', jwk: { kty: 'RSA' }, kid: '../../dev/null' })}.${part({})}.${sig(256)}`)));
    expect(text).toMatch(/key URL \(jku\)/);
    expect(text).toMatch(/embeds its own key/);
    expect(text).toMatch(/path or quote characters/);
  });

  it('warns about padding, the standard alphabet and duplicate keys', () => {
    const padded = `${part({ alg: 'HS256' })}.${part({ a: 1 })}==.${sig(32)}`;
    expect(messages(ok(decodeToken(padded)))).toMatch(/must not be padded/);
    const dupHeader = encodeBase64UrlText('{"alg":"HS256","alg":"none"}');
    const d = ok(decodeToken(`${dupHeader}.${part({})}.${sig(32)}`));
    expect(d.alg).toBe('none');
    expect(messages(d)).toMatch(/header repeats “alg”/);
  });

  it('warns about sensitive-looking payload fields', () => {
    const d = ok(decodeToken(`${part({ alg: 'HS256' })}.${part({ user: 'a', password: 'hunter2', apiKey: 'k' })}.${sig(32)}`));
    expect(messages(d)).toMatch(/“password”, “apiKey”/);
  });
});

describe('extractToken', () => {
  it('leaves clean tokens alone', () => {
    expect(extractToken(JWT_IO)).toEqual({ token: JWT_IO, notes: [] });
  });
});

describe('findDuplicateKeys', () => {
  it('finds duplicates per object, including escaped keys', () => {
    expect(findDuplicateKeys('{"a":1,"b":{"a":2},"a":3}')).toEqual(['a']);
    expect(findDuplicateKeys('{"a":1,"b":{"c":2,"c":3}}')).toEqual(['c']);
    expect(findDuplicateKeys('{"\\u0061":1,"a":2}')).toEqual(['a']);
    expect(findDuplicateKeys('{"a":"x,\\"a\\":1","b":[{"a":1},{"a":2}]}')).toEqual([]);
    expect(findDuplicateKeys('[]')).toEqual([]);
  });
});
