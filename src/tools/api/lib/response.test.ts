import { describe, expect, it } from 'vitest';
import {
  classifyBody,
  dispositionFilename,
  explainFailure,
  extensionFor,
  looksLikeText,
  prettyPrintJson,
  responseFilename,
  statusReason,
  statusTone,
} from './response';

const enc = (s: string) => new TextEncoder().encode(s);

describe('status', () => {
  it('uses the server reason or the standard one', () => {
    expect(statusReason(404)).toBe('Not Found');
    expect(statusReason(200, 'Fine')).toBe('Fine');
    expect(statusReason(799)).toBe('');
    expect([statusTone(101), statusTone(204), statusTone(302), statusTone(418), statusTone(503)]).toEqual([
      'info',
      'success',
      'redirect',
      'client',
      'server',
    ]);
  });
});

describe('classifyBody', () => {
  it('uses the content type', () => {
    expect(classifyBody('application/json; charset=utf-8', 2, enc('{}'))).toBe('json');
    expect(classifyBody('application/vnd.api+json', 2, enc('{}'))).toBe('json');
    expect(classifyBody('text/html', 1, enc('<'))).toBe('html');
    expect(classifyBody('application/atom+xml', 1, enc('<'))).toBe('xml');
    expect(classifyBody('image/svg+xml', 1, enc('<'))).toBe('image');
    expect(classifyBody('image/png', 1, new Uint8Array([0x89]))).toBe('image');
    expect(classifyBody('application/pdf', 1, enc('%'))).toBe('pdf');
    expect(classifyBody('text/csv', 1, enc('a'))).toBe('text');
    expect(classifyBody('application/json', 0, new Uint8Array())).toBe('empty');
  });

  it('sniffs generic or missing types', () => {
    expect(classifyBody('', 5, enc('%PDF-'))).toBe('pdf');
    expect(classifyBody('application/octet-stream', 4, new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBe('image');
    expect(classifyBody(undefined, 8, enc('  {"a":1}'))).toBe('json');
    expect(classifyBody(undefined, 8, enc('<!DOCTYPE html>'))).toBe('html');
    expect(classifyBody(undefined, 8, enc('héllo 👋'))).toBe('text');
    expect(classifyBody(undefined, 3, new Uint8Array([1, 0, 2]))).toBe('binary');
  });

  it('looksLikeText tolerates a cut multi-byte character at the end', () => {
    const bytes = enc('ab👋');
    expect(looksLikeText(bytes.subarray(0, bytes.length - 1))).toBe(true);
    expect(looksLikeText(new Uint8Array([0xff, 0xfe, 0x41]))).toBe(false);
  });
});

describe('prettyPrintJson', () => {
  it('indents without changing values', () => {
    expect(prettyPrintJson('{"a":[1,2],"b":{}}')).toBe('{\n  "a": [\n    1,\n    2\n  ],\n  "b": {}\n}');
    expect(prettyPrintJson('{"big":12345678901234567890,"f":1.50}')).toContain('12345678901234567890');
    expect(prettyPrintJson('{"f":1.50}')).toContain('1.50');
  });

  it('keeps strings with structural characters and escapes intact', () => {
    const text = '{"s":"a,b:{c}[d] \\" \\\\","e":"👋"}';
    const pretty = prettyPrintJson(text)!;
    expect(JSON.parse(pretty)).toEqual(JSON.parse(text));
    expect(pretty).toContain('"a,b:{c}[d] \\" \\\\"');
  });

  it('returns null for invalid JSON and handles scalars and empty arrays', () => {
    expect(prettyPrintJson('{bad')).toBeNull();
    expect(prettyPrintJson('')).toBeNull();
    expect(prettyPrintJson('42')).toBe('42');
    expect(prettyPrintJson('[ ]')).toBe('[]');
  });

  it('handles large input', () => {
    const big = JSON.stringify(Array.from({ length: 20_000 }, (_, i) => ({ i })));
    expect(JSON.parse(prettyPrintJson(big)!)).toHaveLength(20_000);
  });
});

describe('download names', () => {
  it('maps content types to extensions', () => {
    expect(extensionFor('application/json; charset=utf-8')).toBe('json');
    expect(extensionFor('application/hal+json')).toBe('json');
    expect(extensionFor('image/jpeg')).toBe('jpg');
    expect(extensionFor('', 'text')).toBe('txt');
    expect(extensionFor('weird/type')).toBe('bin');
  });

  it('reads Content-Disposition safely', () => {
    expect(dispositionFilename('attachment; filename="report.csv"')).toBe('report.csv');
    expect(dispositionFilename("attachment; filename*=UTF-8''na%C3%AFve%20file.txt")).toBe('naïve file.txt');
    expect(dispositionFilename('attachment; filename="../../etc/passwd"')).toBe('passwd');
    expect(dispositionFilename('inline')).toBeNull();
    expect(dispositionFilename(undefined)).toBeNull();
  });

  it('falls back to the URL path and adds an extension', () => {
    expect(responseFilename('https://a.test/api/users', [['Content-Type', 'application/json']], 'json')).toBe('users.json');
    expect(responseFilename('https://a.test/files/photo.png', [], 'image')).toBe('photo.png');
    expect(responseFilename('https://a.test/', [], 'text')).toBe('response.txt');
    expect(responseFilename('https://a.test/x', [['content-disposition', 'attachment; filename=a.pdf']], 'pdf')).toBe('a.pdf');
  });
});

describe('explainFailure', () => {
  const ctx = { url: 'https://api.example.com/x', pageProtocol: 'http:', online: true, via: 'browser' as const };

  it('explains a generic TypeError honestly without claiming a single cause', () => {
    const e = explainFailure(new TypeError('Failed to fetch'), ctx);
    expect(e.kind).toBe('blocked-or-unreachable');
    expect(e.causes.join(' ')).toMatch(/CORS/);
    expect(e.causes.join(' ')).toMatch(/unreachable/);
  });

  it('detects offline, mixed content, timeout and cancel', () => {
    expect(explainFailure(new TypeError('x'), { ...ctx, online: false }).kind).toBe('offline');
    expect(explainFailure(new TypeError('x'), { ...ctx, url: 'http://api.example.com', pageProtocol: 'https:' }).kind).toBe('mixed-content');
    expect(explainFailure(new TypeError('x'), { ...ctx, url: 'http://localhost:3000', pageProtocol: 'https:' }).kind).toBe(
      'blocked-or-unreachable',
    );
    expect(explainFailure(new DOMException('t', 'TimeoutError'), ctx).kind).toBe('timeout');
    expect(explainFailure(new DOMException('a', 'AbortError'), ctx).kind).toBe('cancelled');
    expect(explainFailure(new Error('Could not connect'), { ...ctx, via: 'companion' })).toMatchObject({
      kind: 'companion',
      detail: 'Could not connect',
    });
  });
});
