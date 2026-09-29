import { afterEach, describe, expect, it, vi } from 'vitest';
import { base64ToBytes, bytesToBase64, checkCompanion, decodeResponse, encodeRequest, sendViaCompanion, TOKEN_HEADER } from './companion';
import type { PreparedRequest } from './prepare';

function prepared(patch: Partial<PreparedRequest> = {}): PreparedRequest {
  return {
    method: 'POST',
    url: 'https://api.example.com/x',
    headers: [['Accept', 'application/json']],
    body: { kind: 'none' },
    timeoutMs: 1000,
    authHeaderNames: [],
    authQueryParam: null,
    ...patch,
  };
}

describe('base64', () => {
  it('round-trips arbitrary bytes, including large buffers', () => {
    const bytes = new Uint8Array(200_000).map((_, i) => (i * 7) % 256);
    expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes);
    expect(bytesToBase64(new Uint8Array())).toBe('');
    expect(bytesToBase64(new TextEncoder().encode('hi'))).toBe('aGk=');
  });
});

describe('encodeRequest', () => {
  it('encodes text bodies as UTF-8', async () => {
    const env = await encodeRequest(prepared({ body: { kind: 'text', text: 'Zoë 👋' } }));
    expect(env).toMatchObject({ method: 'POST', url: 'https://api.example.com/x', timeoutMs: 1000 });
    expect(new TextDecoder().decode(base64ToBytes(env.bodyBase64!))).toBe('Zoë 👋');
  });

  it('encodes blobs byte-exact and uses null for no body', async () => {
    const bytes = new Uint8Array([0, 255, 1, 254]);
    const env = await encodeRequest(prepared({ body: { kind: 'blob', blob: new Blob([bytes]), fileName: 'b.bin' } }));
    expect(base64ToBytes(env.bodyBase64!)).toEqual(bytes);
    expect((await encodeRequest(prepared())).bodyBase64).toBeNull();
  });
});

describe('decodeResponse', () => {
  it('decodes a valid envelope', () => {
    const r = decodeResponse({
      status: 201,
      statusText: 'Created',
      headers: [['Content-Type', 'application/json']],
      bodyBase64: bytesToBase64(new TextEncoder().encode('{"ok":true}')),
      timeMs: 12.5,
      url: 'https://api.example.com/x',
      redirected: false,
    });
    expect(r.status).toBe(201);
    expect(r.body.type).toBe('application/json');
    expect(r.body.size).toBe(11);
    expect(r.timeMs).toBe(12.5);
  });

  it('rejects malformed envelopes with readable errors', () => {
    expect(() => decodeResponse(null)).toThrow(/unreadable/);
    expect(() => decodeResponse({ status: 'x' })).toThrow(/status/);
    expect(() => decodeResponse({ status: 200, headers: [['a']], bodyBase64: '' })).toThrow(/headers/);
    expect(() => decodeResponse({ status: 200, headers: [], bodyBase64: 5 })).toThrow(/body/);
    expect(() => decodeResponse({ status: 200, headers: [], bodyBase64: '%%%' })).toThrow(/base64/);
  });
});

describe('client', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('reports connected, wrong token and not running', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ name: 'localkit-companion', version: '1.0.0' }), { status: 200 }));
    expect(await checkCompanion(17878, 'tok')).toEqual({ state: 'connected', version: '1.0.0' });
    expect(fetchMock.mock.calls[0][0]).toBe('http://127.0.0.1:17878/health');
    expect(fetchMock.mock.calls[0][1].headers[TOKEN_HEADER]).toBe('tok');

    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 401 }));
    expect(await checkCompanion(17878, 'bad')).toEqual({ state: 'wrong-token' });

    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    expect(await checkCompanion(17878, 'tok')).toEqual({ state: 'not-running' });

    fetchMock.mockResolvedValueOnce(new Response('<html>', { status: 200 }));
    expect(await checkCompanion(17878, 'tok')).toEqual({ state: 'not-companion' });
  });

  it('sends the envelope and surfaces companion errors', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ status: 200, statusText: 'OK', headers: [], bodyBase64: 'aGk=', timeMs: 1, url: 'u', redirected: false })),
    );
    const res = await sendViaCompanion(prepared({ body: { kind: 'text', text: 'x' } }), 17900, 'tok', new AbortController().signal);
    expect(await res.body.text()).toBe('hi');
    const sent = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(sent).toMatchObject({ method: 'POST', url: 'https://api.example.com/x', bodyBase64: 'eA==' });

    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: 'Could not connect to api.example.com.' }), { status: 502 }));
    await expect(sendViaCompanion(prepared(), 17900, 'tok', new AbortController().signal)).rejects.toThrow(/Could not connect/);

    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: 'bad token' }), { status: 401 }));
    await expect(sendViaCompanion(prepared(), 17900, 'tok', new AbortController().signal)).rejects.toThrow(/token/);

    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await expect(sendViaCompanion(prepared(), 17900, 'tok', new AbortController().signal)).rejects.toThrow(/npm run companion/);
  });
});
