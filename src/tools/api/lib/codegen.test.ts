import { describe, expect, it } from 'vitest';
import { bashQuote, cmdQuote, compactJsonText, generateCode, jsString, normalizeRequestUrl, prettyJson, pyString, toCodeRequest, type CodeRequest } from './codegen';
import { formatJsonBody } from './jsonBody';
import { prepareRequest } from './prepare';
import { emptyDraft, kv } from './model';
import { tokenizeBash, tokenizeCmd } from '@/tools/network/lib/curl';

const nasty = `it's "quoted" $HOME \`cmd\` \\ back %PATH% ^caret & | < > ! 👋\nnew line`;

describe('quoting', () => {
  it('bashQuote round-trips through a POSIX tokenizer', () => {
    for (const value of ['simple', '', nasty, "'", 'a b', 'ü']) {
      expect(tokenizeBash(`x ${bashQuote(value)}`).tokens[1]).toBe(value);
    }
    expect(bashQuote('https://a.test/p')).toBe('https://a.test/p');
  });

  it('cmdQuote round-trips through a cmd.exe tokenizer', () => {
    for (const value of ['simple', 'a b', 'say "hi"', 'back\\slash\\', '100% & more', '^caret', '<tag>|pipe', 'ü 👋']) {
      expect(tokenizeCmd(`curl ${cmdQuote(value)}`).tokens[1]).toBe(value);
    }
  });

  it('jsString escapes quotes, backslashes, line terminators and control characters', () => {
    const ls = String.fromCharCode(0x2028);
    const ps = String.fromCharCode(0x2029);
    expect(jsString("a'b\\c\n\r\t")).toBe("'a\\'b\\\\c\\n\\r\\t'");
    expect(jsString(`${ls}x${ps}`)).toBe("'\\" + 'u2028x\\' + "u2029'");
    expect(jsString(String.fromCharCode(0, 31, 127))).toBe("'\\x00\\x1f\\x7f'");
    expect(jsString('')).toBe(`''`);
    expect(jsString('👋')).toBe(`'👋'`);
  });

  it('pyString escapes quotes, backslashes and control characters', () => {
    expect(pyString(`a'b\\c\n\t\x01`)).toBe(`'a\\'b\\\\c\\n\\t\\x01'`);
    expect(pyString('👋')).toBe(`'👋'`);
  });
});

describe('JSON bodies in code', () => {
  it('pretty-prints only when re-serializing is lossless', () => {
    expect(prettyJson('{"a":1}')).toBe('{\n  "a": 1\n}');
    expect(prettyJson('{"big": 12345678901234567890}')).toBeNull();
    expect(prettyJson('{"n": 1.0}')).toBeNull();
    expect(prettyJson('{"a":1,"a":2}')).toBeNull();
    expect(prettyJson('"str"')).toBeNull();
    expect(prettyJson('{bad')).toBeNull();
    expect(compactJsonText('{ "a b" : [ 1, 2 ] }')).toBe('{"a b":[1,2]}');
  });
});

function code(patch: Partial<ReturnType<typeof emptyDraft>>, includeSecrets = false): CodeRequest {
  const r = prepareRequest({ ...emptyDraft(), url: 'https://api.example.com/items', ...patch }, new Map(), null);
  if (!r.ok) throw new Error(r.error);
  return toCodeRequest(r.request, includeSecrets);
}

describe('toCodeRequest secrets', () => {
  it('replaces auth values with placeholders unless secrets are included', () => {
    const patch = { auth: { ...emptyDraft().auth, type: 'bearer' as const, token: 'SECRET' }, headers: [kv('Cookie', 'sid=1')] };
    const hidden = code(patch);
    expect(JSON.stringify(hidden)).not.toMatch(/SECRET|sid=1/);
    expect(hidden.headers).toContainEqual(['Authorization', 'Bearer <token>']);
    expect(hidden.headers).toContainEqual(['Cookie', '<cookies>']);
    expect(JSON.stringify(code(patch, true))).toMatch(/SECRET/);
  });

  it('hides API keys sent as query parameters', () => {
    const r = code({ auth: { ...emptyDraft().auth, type: 'apikey', apiKeyName: 'key', apiKeyValue: 'SECRET', apiKeyIn: 'query' } });
    expect(r.url).toBe('https://api.example.com/items?key=<api-key>');
  });
});

describe('generateCode', () => {
  const post = code({
    method: 'POST',
    headers: [kv('X-Note', `it's`)],
    body: { ...emptyDraft().body, mode: 'raw', raw: '{"name":"Zoë 👋"}', rawLanguage: 'json' },
  });

  it('cURL bash is parseable and keeps the body byte-exact', () => {
    const out = generateCode(post, 'curl');
    expect(out).toContain("curl https://api.example.com/items");
    const tokens = tokenizeBash(out.replace(/\\\n/g, ' ')).tokens;
    expect(tokens).toContain('X-Note: it\'s');
    expect(tokens).toContain('{"name":"Zoë 👋"}');
    expect(tokens).not.toContain('-X');
  });

  it('cURL cmd uses caret continuations', () => {
    const out = generateCode(post, 'curl-cmd');
    expect(out).toMatch(/\^\n/);
    expect(out.startsWith('curl ^"https://api.example.com/items^"')).toBe(true);
  });

  it('fetch uses JSON.stringify for lossless JSON and a timeout signal', () => {
    const out = generateCode(post, 'fetch');
    expect(out).toContain("method: 'POST'");
    expect(out).toContain('JSON.stringify({');
    expect(out).toContain('"name": "Zoë 👋"');
    expect(out).toContain("'X-Note': 'it\\'s'");
    expect(out).toContain('AbortSignal.timeout(30000)');
  });

  it('node fetch reads files with openAsBlob', () => {
    const r = code({
      method: 'POST',
      body: { ...emptyDraft().body, mode: 'form-data', form: [{ ...kv('f', ''), kind: 'file', file: new Blob(['x']), fileName: 'photo.png' }] },
    });
    const out = generateCode(r, 'node');
    expect(out).toContain("import { openAsBlob } from 'node:fs';");
    expect(out).toContain("form.append('f', await openAsBlob('photo.png'), 'photo.png');");
    expect(generateCode(r, 'curl')).toContain("-F f=@photo.png");
    expect(generateCode(r, 'python')).toContain("('f', ('photo.png', open('photo.png', 'rb')))");
    expect(generateCode(r, 'httpie')).toContain('--multipart');
  });

  it('axios passes lossless JSON as an object and validates every status', () => {
    const out = generateCode(post, 'axios');
    expect(out).toContain("method: 'post'");
    expect(out).toContain('data: {');
    expect(out).toContain('validateStatus: () => true');
  });

  it('python sends the exact text body', () => {
    const out = generateCode(post, 'python');
    expect(out).toContain("data = '{\"name\":\"Zoë 👋\"}'");
    expect(out).toContain("requests.request('POST', url, headers=headers, data=data.encode('utf-8'), timeout=30)");
  });

  it('HTTPie sends raw bodies and quoted header items', () => {
    const out = generateCode(post, 'httpie');
    expect(out.startsWith("http --raw '{\"name\":\"Zoë 👋\"}' --timeout=30 POST https://api.example.com/items")).toBe(true);
    expect(out).toContain(`'X-Note:it'\\''s'`);
  });

  it('HEAD uses --head and GET omits -X', () => {
    expect(generateCode(code({ method: 'HEAD', timeoutMs: 0 }), 'curl')).toBe('curl https://api.example.com/items \\\n  --head');
    expect(generateCode(code({ timeoutMs: 0 }), 'curl')).toBe('curl https://api.example.com/items');
  });

  it('empty header values use curl\'s "Name;" syntax', () => {
    expect(generateCode(code({ headers: [kv('X-Empty', '')], timeoutMs: 0 }), 'curl')).toContain("-H 'X-Empty;'");
  });
});

describe('code that runs as sent', () => {
  it('percent-encodes the URL like the browser and turns off curl globbing for [] and {}', () => {
    const req = code({ url: 'https://api.example.com/items?filter[name]=a b&emoji=😀', timeoutMs: 0 });
    expect(req.url).toBe('https://api.example.com/items?filter[name]=a%20b&emoji=%F0%9F%98%80');
    expect(generateCode(req, 'curl')).toContain('--globoff');
    expect(generateCode(code({ timeoutMs: 0 }), 'curl')).not.toContain('--globoff');
  });

  it('quotes -F file names that contain curl option characters', () => {
    const form = code({
      method: 'POST',
      timeoutMs: 0,
      body: { ...emptyDraft().body, mode: 'form-data', form: [{ ...kv('f', ''), kind: 'file', file: new Blob(['x']), fileName: 'a;b "c".txt' }] },
    });
    expect(generateCode(form, 'curl')).toContain(`-F 'f=@"a;b \\"c\\".txt"'`);
  });

  it('escapes HTTPie values that would change the item type', () => {
    const req = code({
      method: 'POST',
      timeoutMs: 0,
      headers: [kv('X-Val', '=start')],
      body: { ...emptyDraft().body, mode: 'form-data', form: [{ ...kv('handle', '@john'), kind: 'text' }, { ...kv('eq', '=x'), kind: 'text' }] },
    });
    const out = generateCode(req, 'httpie');
    expect(out).toContain(`'X-Val:\\=start'`);
    expect(out).toContain(`'handle=\\@john'`);
    expect(out).toContain(`'eq=\\=x'`);
  });

  it('keeps <placeholders> readable in URLs', () => {
    expect(normalizeRequestUrl('https://a.test/x?key=<apiKey>')).toBe('https://a.test/x?key=<apiKey>');
  });
});

describe('JSON body formatting', () => {
  it('re-indents without rounding numbers or rewriting escapes, with {{variables}} as values', () => {
    expect(formatJsonBody('{"id":12345678901234567890,"price":1.0,"s":"\u00e9","v":{{id}},"t":"Bearer {{tok}}"}')).toBe(
      '{\n  "id": 12345678901234567890,\n  "price": 1.0,\n  "s": "\u00e9",\n  "v": {{id}},\n  "t": "Bearer {{tok}}"\n}',
    );
    expect(formatJsonBody('{bad')).toBeNull();
  });
});
