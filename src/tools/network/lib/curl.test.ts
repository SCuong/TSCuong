import { describe, expect, it } from 'vitest';
import { CurlParseError, curlEscape, isCmdStyle, parseCurl, shellQuote, toCurl, tokenizeBash, tokenizeCmd } from './curl';

const tok = (s: string) => tokenizeBash(s).tokens;

describe('tokenizeBash', () => {
  it.each([
    ['curl a b', ['curl', 'a', 'b']],
    ['curl   a\t\tb', ['curl', 'a', 'b']],
    ["curl 'a b'", ['curl', 'a b']],
    ['curl "a b"', ['curl', 'a b']],
    ["curl 'it'\\''s'", ['curl', "it's"]],
    ['curl "say \\"hi\\""', ['curl', 'say "hi"']],
    ['curl "back\\\\slash"', ['curl', 'back\\slash']],
    ['curl "keep \\n literal"', ['curl', 'keep \\n literal']],
    ["curl 'no $expansion \\n here'", ['curl', 'no $expansion \\n here']],
    ['curl a\\ b', ['curl', 'a b']],
    ['curl \\\n  -X POST', ['curl', '-X', 'POST']],
    ['curl "multi\\\nline"', ['curl', 'multiline']],
    ["curl ab'cd'\"ef\"", ['curl', 'abcdef']],
    ["curl ''", ['curl', '']],
    ['curl ""', ['curl', '']],
    ["curl $'a\\nb'", ['curl', 'a\nb']],
    ["curl $'tab\\there'", ['curl', 'tab\there']],
    ["curl $'\\x41\\u00e9\\U0001F600'", ['curl', 'Aé😀']],
    ["curl $'it\\'s'", ['curl', "it's"]],
    ["curl $'\\101'", ['curl', 'A']],
    ['curl a # comment', ['curl', 'a']],
    ['curl a#b', ['curl', 'a#b']],
    ['curl a\r\n  b', ['curl', 'a', 'b']],
    ['curl http://x/?a=1&b=2', ['curl', 'http://x/?a=1&b=2']],
    ['curl x `\n -v', ['curl', 'x', '-v']],
    ["curl 'héllo wörld 🎉'", ['curl', 'héllo wörld 🎉']],
  ])('%j', (input, expected) => {
    expect(tok(input)).toEqual(expected);
  });

  it('stops at pipes and warns', () => {
    const r = tokenizeBash("curl https://x | jq '.'");
    expect(r.tokens).toEqual(['curl', 'https://x']);
    expect(r.warnings[0]).toMatch(/Ignored everything after "\|"/);
  });

  it('stops at && and redirections', () => {
    expect(tok('curl https://x && echo done')).toEqual(['curl', 'https://x']);
    expect(tok('curl https://x > out.txt')).toEqual(['curl', 'https://x']);
    expect(tok('curl https://x; ls')).toEqual(['curl', 'https://x']);
  });

  it('warns about shell variables', () => {
    const r = tokenizeBash('curl -H "Authorization: Bearer $TOKEN" https://x');
    expect(r.tokens[2]).toBe('Authorization: Bearer $TOKEN');
    expect(r.warnings.join()).toMatch(/\$TOKEN/);
  });

  it('throws on unterminated quotes', () => {
    expect(() => tokenizeBash("curl 'abc")).toThrow(CurlParseError);
    expect(() => tokenizeBash('curl "abc')).toThrow(/not closed/);
    expect(() => tokenizeBash("curl $'abc")).toThrow(/not closed/);
  });
});

describe('tokenizeCmd', () => {
  it('handles caret continuations and escaped quotes (Chrome "Copy as cURL (cmd)")', () => {
    const cmd = 'curl ^"https://example.com/api?a=1^&b=2^" ^\n  -H ^"accept: */*^" ^\n  --data-raw ^"^{^\\^"name^\\^":^\\^"x^\\^"^}^" ^\n  --compressed';
    expect(tokenizeCmd(cmd).tokens).toEqual([
      'curl',
      'https://example.com/api?a=1&b=2',
      '-H',
      'accept: */*',
      '--data-raw',
      '{"name":"x"}',
      '--compressed',
    ]);
  });

  it('handles plain double quotes and doubled quotes', () => {
    expect(tokenizeCmd('curl "a b" "say ""hi"""').tokens).toEqual(['curl', 'a b', 'say "hi"']);
  });

  it('keeps backslashes not followed by quotes', () => {
    expect(tokenizeCmd('curl C:\\path\\file "x\\\\"').tokens).toEqual(['curl', 'C:\\path\\file', 'x\\']);
  });

  it('detects cmd style', () => {
    expect(isCmdStyle('curl ^"x^"')).toBe(true);
    expect(isCmdStyle('curl x ^\n -v')).toBe(true);
    expect(isCmdStyle("curl 'x'")).toBe(false);
  });

  it('throws on unterminated quotes', () => {
    expect(() => tokenizeCmd('curl "abc')).toThrow(/not closed/);
  });
});

describe('parseCurl basics', () => {
  it('parses a bare GET', () => {
    const r = parseCurl('curl https://example.com');
    expect(r).toMatchObject({ method: 'GET', url: 'https://example.com', headers: [], bodyType: 'none', body: null });
    expect(r.warnings).toEqual([]);
  });

  it('accepts a leading "$ " prompt and curl.exe', () => {
    expect(parseCurl('$ curl https://a.test').url).toBe('https://a.test');
    expect(parseCurl('curl.exe https://a.test').url).toBe('https://a.test');
    expect(parseCurl('/usr/bin/curl https://a.test').url).toBe('https://a.test');
  });

  it('rejects empty and non-curl input', () => {
    expect(() => parseCurl('')).toThrow(/Paste a curl command/);
    expect(() => parseCurl('   ')).toThrow(/Paste/);
    expect(() => parseCurl('wget https://x')).toThrow(/must start with "curl"/);
  });

  it('requires a URL', () => {
    expect(() => parseCurl('curl -X POST')).toThrow(/needs a value|no URL/);
    expect(() => parseCurl('curl -v')).toThrow(/no URL/);
  });

  it('reports invalid URLs', () => {
    expect(() => parseCurl('curl "http://exa mple.com"')).toThrow(/not a valid URL/);
  });

  it('adds http:// for scheme-less URLs', () => {
    const r = parseCurl('curl example.com/path');
    expect(r.url).toBe('http://example.com/path');
    expect(r.warnings.join()).toMatch(/http:\/\/ was assumed/);
  });

  it('uses --url', () => {
    expect(parseCurl('curl --url https://x.test/a').url).toBe('https://x.test/a');
  });

  it('warns on multiple URLs', () => {
    const r = parseCurl('curl https://a.test https://b.test');
    expect(r.url).toBe('https://a.test');
    expect(r.warnings.join()).toMatch(/Only the first URL/);
  });

  it('treats arguments after -- as URLs', () => {
    expect(parseCurl('curl -- https://a.test').url).toBe('https://a.test');
  });

  it('warns about non-HTTP schemes', () => {
    expect(parseCurl('curl ftp://files.test/x').warnings.join()).toMatch(/Only HTTP/);
  });
});

describe('methods', () => {
  it.each([
    ['curl -X POST https://x.test', 'POST'],
    ['curl -XPUT https://x.test', 'PUT'],
    ['curl --request delete https://x.test', 'DELETE'],
    ['curl -X PATCH -d a=1 https://x.test', 'PATCH'],
    ['curl -d a=1 https://x.test', 'POST'],
    ['curl -F a=1 https://x.test', 'POST'],
    ['curl -I https://x.test', 'HEAD'],
    ['curl --head https://x.test', 'HEAD'],
    ['curl -G -d a=1 https://x.test', 'GET'],
    ['curl -T file.bin https://x.test', 'PUT'],
    ['curl -X OPTIONS https://x.test', 'OPTIONS'],
  ])('%s -> %s', (cmd, method) => {
    expect(parseCurl(cmd).method).toBe(method);
  });

  it('warns when -I overrides -X', () => {
    expect(parseCurl('curl -I -X POST https://x.test').warnings.join()).toMatch(/overrides/);
  });

  it('warns about GET with a body', () => {
    expect(parseCurl('curl -X GET -d a=1 https://x.test').warnings.join()).toMatch(/GET request with a body/);
  });
});

describe('headers', () => {
  it('keeps order and duplicates', () => {
    const r = parseCurl("curl -H 'Accept: a' -H 'X-A: 1' -H 'X-A: 2' https://x.test");
    expect(r.headers).toEqual([
      { name: 'Accept', value: 'a' },
      { name: 'X-A', value: '1' },
      { name: 'X-A', value: '2' },
    ]);
  });

  it('trims whitespace and keeps colons in values', () => {
    expect(parseCurl("curl -H '  Referer :   https://a.test:8080/x  ' https://x.test").headers[0]).toEqual({
      name: 'Referer',
      value: 'https://a.test:8080/x',
    });
  });

  it('supports empty headers via "Name;"', () => {
    expect(parseCurl("curl -H 'X-Empty;' https://x.test").headers).toEqual([{ name: 'X-Empty', value: '' }]);
  });

  it('drops "Name:" (header removal) with a note', () => {
    const r = parseCurl("curl -H 'Accept:' https://x.test");
    expect(r.headers).toEqual([]);
    expect(r.warnings.join()).toMatch(/remove that header/);
  });

  it('warns about malformed headers and header files', () => {
    expect(parseCurl("curl -H 'nocolon' https://x.test").warnings.join()).toMatch(/no ":"/);
    expect(parseCurl("curl -H ': value' https://x.test").warnings.join()).toMatch(/no name/);
    expect(parseCurl('curl -H @headers.txt https://x.test').warnings.join()).toMatch(/from a file/);
  });

  it('attached header value -HAccept:x', () => {
    expect(parseCurl("curl '-HAccept: text/html' https://x.test").headers).toEqual([{ name: 'Accept', value: 'text/html' }]);
  });

  it('maps -A, -e, -b, -r and --oauth2-bearer to headers', () => {
    const r = parseCurl(
      "curl -A 'MyAgent/1.0' -e https://ref.test -b 'a=1' -b 'b=2' -r 0-99 --oauth2-bearer tok https://x.test",
    );
    expect(r.headers).toEqual([
      { name: 'Range', value: 'bytes=0-99' },
      { name: 'Authorization', value: 'Bearer tok' },
      { name: 'User-Agent', value: 'MyAgent/1.0' },
      { name: 'Referer', value: 'https://ref.test' },
      { name: 'Cookie', value: 'a=1; b=2' },
    ]);
  });

  it('explicit headers win over -A / -b', () => {
    const r = parseCurl("curl -H 'User-Agent: X' -A Y -H 'Cookie: c=1' -b d=2 https://x.test");
    expect(r.headers.filter((h) => h.name === 'User-Agent')).toEqual([{ name: 'User-Agent', value: 'X' }]);
    expect(r.headers.filter((h) => h.name === 'Cookie')).toEqual([{ name: 'Cookie', value: 'c=1' }]);
  });

  it('warns about cookie files', () => {
    expect(parseCurl('curl -b cookies.txt https://x.test').warnings.join()).toMatch(/cookies.txt/);
  });
});

describe('data', () => {
  it('-d is urlencoded by default', () => {
    const r = parseCurl("curl -d 'a=1' https://x.test");
    expect(r).toMatchObject({ method: 'POST', body: 'a=1', bodyType: 'urlencoded' });
  });

  it('joins multiple -d with &', () => {
    expect(parseCurl('curl -d a=1 -d b=2 --data c=3 https://x.test').body).toBe('a=1&b=2&c=3');
  });

  it('--data-raw keeps @ literally', () => {
    const r = parseCurl("curl --data-raw '@not-a-file' https://x.test");
    expect(r.body).toBe('@not-a-file');
    expect(r.bodyFile).toBeUndefined();
  });

  it('-d @file uses a placeholder and warns', () => {
    const r = parseCurl('curl -d @body.txt https://x.test');
    expect(r.body).toBe('<contents of body.txt>');
    expect(r.bodyFile).toBe('body.txt');
    expect(r.warnings.join()).toMatch(/body.txt/);
  });

  it('--data-binary @file is binary', () => {
    const r = parseCurl("curl --data-binary @img.png -H 'Content-Type: image/png' https://x.test");
    expect(r.bodyType).toBe('binary');
    expect(r.bodyFile).toBe('img.png');
  });

  it('--data-binary with text keeps newlines', () => {
    expect(parseCurl("curl --data-binary $'line1\\nline2' https://x.test").body).toBe('line1\nline2');
  });

  it('detects JSON by content type', () => {
    const r = parseCurl(`curl -H 'Content-Type: application/json' -d '{"a":1}' https://x.test`);
    expect(r.bodyType).toBe('json');
    expect(r.body).toBe('{"a":1}');
  });

  it('detects +json content types', () => {
    expect(parseCurl(`curl -H 'content-type: application/vnd.api+json' -d '{}' https://x.test`).bodyType).toBe('json');
  });

  it('other content types are raw', () => {
    expect(parseCurl(`curl -H 'Content-Type: text/plain' -d 'hello' https://x.test`).bodyType).toBe('raw');
  });

  it('warns about JSON sent without a content type', () => {
    const r = parseCurl(`curl -d '{"a":1}' https://x.test`);
    expect(r.bodyType).toBe('urlencoded');
    expect(r.warnings.join()).toMatch(/looks like JSON/);
  });

  it('--json sets headers and concatenates', () => {
    const r = parseCurl(`curl --json '{"a":' --json '1}' https://x.test`);
    expect(r.body).toBe('{"a":1}');
    expect(r.bodyType).toBe('json');
    expect(r.method).toBe('POST');
    expect(r.headers).toEqual([
      { name: 'Content-Type', value: 'application/json' },
      { name: 'Accept', value: 'application/json' },
    ]);
  });

  it('--json respects existing headers', () => {
    const r = parseCurl(`curl -H 'Accept: text/plain' --json '{}' https://x.test`);
    expect(r.headers.filter((h) => h.name.toLowerCase() === 'accept')).toHaveLength(1);
  });

  it('empty -d gives an empty POST body', () => {
    const r = parseCurl("curl -d '' https://x.test");
    expect(r.method).toBe('POST');
    expect(r.body).toBe('');
  });

  it('preserves unicode and emoji', () => {
    expect(parseCurl(`curl -H 'Content-Type: application/json' -d '{"msg":"héllo 👋"}' https://x.test`).body).toBe('{"msg":"héllo 👋"}');
  });
});

describe('--data-urlencode', () => {
  it.each([
    ['hello world', 'hello%20world'],
    ['=a b&c', 'a%20b%26c'],
    ['name=a b&c', 'name=a%20b%26c'],
    ['q=é', 'q=%C3%A9'],
    ['q=~._-', 'q=~._-'],
    ["q=!*'()", 'q=%21%2A%27%28%29'],
  ])('%s -> %s', (arg, expected) => {
    expect(parseCurl(`curl --data-urlencode '${arg.replace(/'/g, `'\\''`)}' https://x.test`).body).toBe(expected);
  });

  it('handles file forms with placeholders', () => {
    const a = parseCurl("curl --data-urlencode '@file.txt' https://x.test");
    expect(a.body).toBe('<urlencoded contents of file.txt>');
    const b = parseCurl("curl --data-urlencode 'name@file.txt' https://x.test");
    expect(b.body).toBe('name=<urlencoded contents of file.txt>');
    expect(b.warnings.join()).toMatch(/file.txt/);
  });

  it('mixes with -d', () => {
    expect(parseCurl("curl -d a=1 --data-urlencode 'b=x y' https://x.test").body).toBe('a=1&b=x%20y');
  });

  it('curlEscape encodes all but unreserved characters', () => {
    expect(curlEscape('a b/c?d=é😀')).toBe('a%20b%2Fc%3Fd%3D%C3%A9%F0%9F%98%80');
  });
});

describe('-G', () => {
  it('moves data to the query string', () => {
    const r = parseCurl("curl -G -d 'q=1' --data-urlencode 'name=a b' https://x.test/search");
    expect(r.url).toBe('https://x.test/search?q=1&name=a%20b');
    expect(r.body).toBeNull();
    expect(r.bodyType).toBe('none');
  });

  it('appends with & when a query exists', () => {
    expect(parseCurl('curl -G -d b=2 "https://x.test/?a=1"').url).toBe('https://x.test/?a=1&b=2');
  });

  it('combined with -I is HEAD', () => {
    expect(parseCurl('curl -G -I -d a=1 https://x.test').method).toBe('HEAD');
  });
});

describe('forms', () => {
  it('parses text fields and files', () => {
    const r = parseCurl("curl -F 'name=Ada' -F 'avatar=@photo.jpg;type=image/jpeg' -F 'doc=@/tmp/a b.pdf;filename=report.pdf' https://x.test");
    expect(r.bodyType).toBe('multipart');
    expect(r.formParts).toEqual([
      { name: 'name', value: 'Ada' },
      { name: 'avatar', file: 'photo.jpg', contentType: 'image/jpeg' },
      { name: 'doc', file: '/tmp/a b.pdf', filename: 'report.pdf' },
    ]);
  });

  it('parses <file values', () => {
    const r = parseCurl("curl -F 'bio=<bio.txt' https://x.test");
    expect(r.formParts).toEqual([{ name: 'bio', valueFile: 'bio.txt' }]);
    expect(r.warnings.join()).toMatch(/bio.txt/);
  });

  it('--form-string keeps @ literally', () => {
    expect(parseCurl("curl --form-string 'handle=@ada' https://x.test").formParts).toEqual([{ name: 'handle', value: '@ada' }]);
  });

  it('parses ;type= on text values', () => {
    expect(parseCurl(`curl -F 'meta={"a":1};type=application/json' https://x.test`).formParts[0]).toEqual({
      name: 'meta',
      value: '{"a":1}',
      contentType: 'application/json',
    });
  });

  it('parses quoted text values containing ;', () => {
    expect(parseCurl(`curl -F 'a="x;y";type=text/plain' https://x.test`).formParts[0]).toEqual({
      name: 'a',
      value: 'x;y',
      contentType: 'text/plain',
    });
  });

  it('parses quoted filename parameters', () => {
    expect(parseCurl(`curl -F 'f=@a.txt;filename="my;file.txt"' https://x.test`).formParts[0].filename).toBe('my;file.txt');
  });

  it('rejects malformed form fields and mixing with -d', () => {
    expect(() => parseCurl("curl -F 'novalue' https://x.test")).toThrow(/name=value/);
    expect(() => parseCurl('curl -F a=1 -d b=2 https://x.test')).toThrow(/cannot mix/);
  });
});

describe('auth and flags', () => {
  it('parses -u user:password', () => {
    expect(parseCurl('curl -u ada:s3cr:et https://x.test').auth).toEqual({ type: 'basic', user: 'ada', password: 's3cr:et' });
  });

  it('warns when the password is missing', () => {
    const r = parseCurl('curl -u ada https://x.test');
    expect(r.auth).toEqual({ type: 'basic', user: 'ada', password: '' });
    expect(r.warnings.join()).toMatch(/prompt/);
  });

  it('parses boolean flags, including combined short flags', () => {
    const r = parseCurl('curl -sSLk --compressed https://x.test');
    expect(r).toMatchObject({ followRedirects: true, insecure: true, compressed: true });
    expect(r.warnings).toEqual([]);
  });

  it('parses a combined flag group ending with a value flag', () => {
    const r = parseCurl('curl -sLX POST https://x.test');
    expect(r.method).toBe('POST');
    expect(r.followRedirects).toBe(true);
  });

  it('supports --no-* negation', () => {
    expect(parseCurl('curl -L --no-location https://x.test').followRedirects).toBe(false);
  });

  it('parses timeouts', () => {
    const r = parseCurl('curl -m 30 --connect-timeout 2.5 https://x.test');
    expect(r.maxTime).toBe(30);
    expect(r.connectTimeout).toBe(2.5);
    expect(parseCurl('curl --max-time soon https://x.test').warnings.join()).toMatch(/expects a number/);
  });

  it('ignores output flags silently', () => {
    const r = parseCurl('curl -o out.json -w "%{http_code}" -v -i -s https://x.test');
    expect(r.warnings).toEqual([]);
    expect(r.url).toBe('https://x.test');
  });

  it('warns about unsupported and unknown options', () => {
    expect(parseCurl('curl -x http://proxy:3128 https://x.test').warnings.join()).toMatch(/Proxy/);
    expect(parseCurl('curl --digest -u a:b https://x.test').warnings.join()).toMatch(/Digest/);
    expect(parseCurl('curl --frobnicate https://x.test').warnings.join()).toMatch(/Unknown option "--frobnicate"/);
    expect(parseCurl('curl -Z https://x.test').warnings.join()).toMatch(/Unknown option "-Z"/);
    expect(parseCurl('curl --header=X:1 https://x.test').warnings.join()).toMatch(/--option=value/);
  });

  it('throws when a value is missing', () => {
    expect(() => parseCurl('curl https://x.test -H')).toThrow(/needs a value/);
  });
});

describe('real-world commands', () => {
  it('Chrome "Copy as cURL (bash)"', () => {
    const cmd = `curl 'https://api.example.com/v1/items?page=2' \\
  -H 'accept: application/json, text/plain, */*' \\
  -H 'accept-language: en-US,en;q=0.9' \\
  -H 'authorization: Bearer eyJhbGciOi.abc.def' \\
  -H 'content-type: application/json' \\
  -H 'origin: https://app.example.com' \\
  -b 'session=abc123; theme=dark' \\
  --data-raw '{"name":"Widget","tags":["a","b"],"price":9.99}' \\
  --compressed`;
    const r = parseCurl(cmd);
    expect(r.method).toBe('POST');
    expect(r.url).toBe('https://api.example.com/v1/items?page=2');
    expect(r.headers).toHaveLength(6);
    expect(r.headers[5]).toEqual({ name: 'Cookie', value: 'session=abc123; theme=dark' });
    expect(r.bodyType).toBe('json');
    expect(JSON.parse(r.body!)).toEqual({ name: 'Widget', tags: ['a', 'b'], price: 9.99 });
    expect(r.compressed).toBe(true);
    expect(r.warnings).toEqual([]);
  });

  it('Chrome "Copy as cURL (cmd)"', () => {
    const cmd = `curl ^"https://api.example.com/v1/items?a=1^&b=2^" ^
  -H ^"accept: application/json^" ^
  -H ^"content-type: application/json^" ^
  --data-raw ^"^{^\\^"q^\\^":^\\^"100^%^\\^"^}^" ^
  --compressed`;
    const r = parseCurl(cmd);
    expect(r.url).toBe('https://api.example.com/v1/items?a=1&b=2');
    expect(r.headers).toEqual([
      { name: 'accept', value: 'application/json' },
      { name: 'content-type', value: 'application/json' },
    ]);
    expect(r.body).toBe('{"q":"100%"}');
    expect(r.compressed).toBe(true);
  });

  it('Windows cmd with plain quotes and ^ continuation', () => {
    const r = parseCurl('curl -X POST "https://x.test/a" ^\r\n -H "Content-Type: application/json" ^\r\n -d "{\\"a\\":1}"');
    expect(r.method).toBe('POST');
    expect(r.body).toBe('{"a":1}');
  });

  it('PowerShell backtick continuation', () => {
    const r = parseCurl('curl.exe https://x.test `\n  -H "X-A: 1"');
    expect(r.headers).toEqual([{ name: 'X-A', value: '1' }]);
  });

  it('multi-line JSON body in single quotes', () => {
    const r = parseCurl(`curl -X POST https://x.test -H 'Content-Type: application/json' -d '{
  "a": 1,
  "b": "two"
}'`);
    expect(JSON.parse(r.body!)).toEqual({ a: 1, b: 'two' });
  });

  it('URL with unquoted & (common copy mistake) is kept whole', () => {
    expect(parseCurl('curl https://x.test/?a=1&b=2 -v').url).toBe('https://x.test/?a=1&b=2');
  });
});

describe('toCurl', () => {
  it('prints a bare GET', () => {
    expect(toCurl({ url: 'https://x.test/a' })).toBe('curl https://x.test/a');
  });

  it('quotes URLs with special characters', () => {
    expect(toCurl({ url: 'https://x.test/?a=1&b=2' })).toBe("curl 'https://x.test/?a=1&b=2'");
  });

  it('prints method, headers, auth and body', () => {
    expect(
      toCurl({
        method: 'PUT',
        url: 'https://x.test/a',
        headers: [
          { name: 'Content-Type', value: 'application/json' },
          { name: 'X-Empty', value: '' },
        ],
        body: `{"it's":true}`,
        bodyType: 'json',
        auth: { type: 'basic', user: 'u', password: 'p w' },
        followRedirects: true,
      }),
    ).toBe(
      [
        'curl https://x.test/a \\',
        '  -X PUT \\',
        "  -H 'Content-Type: application/json' \\",
        "  -H 'X-Empty;' \\",
        "  -u 'u:p w' \\",
        `  --data-raw '{"it'\\''s":true}' \\`,
        '  --location',
      ].join('\n'),
    );
  });

  it('omits -X POST when there is a body', () => {
    expect(toCurl({ method: 'POST', url: 'https://x.test', body: 'a=1', bodyType: 'urlencoded' })).not.toMatch(/-X/);
    expect(toCurl({ method: 'POST', url: 'https://x.test' })).toMatch(/-X POST/);
  });

  it('prints multipart parts', () => {
    const out = toCurl({
      method: 'POST',
      url: 'https://x.test',
      bodyType: 'multipart',
      formParts: [
        { name: 'a', value: '@literal' },
        { name: 'f', file: 'x.png', contentType: 'image/png' },
      ],
    });
    expect(out).toContain("--form-string a=@literal");
    expect(out).toContain("-F 'f=@x.png;type=image/png'");
  });

  it('shellQuote', () => {
    expect(shellQuote('abc')).toBe('abc');
    expect(shellQuote('')).toBe("''");
    expect(shellQuote('a b')).toBe("'a b'");
    expect(shellQuote("it's")).toBe(`'it'\\''s'`);
    expect(shellQuote('$HOME')).toBe("'$HOME'");
  });

  const roundTrips = [
    'curl https://x.test',
    "curl -X DELETE 'https://x.test/items/1?force=true' -H 'Authorization: Bearer t'",
    `curl https://x.test -H 'Content-Type: application/json' --data-raw '{"a":"it\\'s"}'`.replace("\\'", "'\\''"),
    "curl -F 'name=Ada' -F 'f=@a b.png;type=image/png' https://x.test",
    'curl -u user:pa:ss -k -L --compressed -m 10 https://x.test',
    "curl -d 'a=1' -d 'b=2' https://x.test",
    "curl -H 'X-Empty;' https://x.test",
    `curl -H 'Content-Type: application/json' -d $'{"emoji":"🎉","nl":"a\\nb"}' https://x.test`,
  ];

  it.each(roundTrips)('round-trips %s', (cmd) => {
    const first = parseCurl(cmd);
    const second = parseCurl(toCurl(first));
    expect({ ...second, warnings: [] }).toEqual({ ...first, warnings: [] });
  });
});
