import { describe, expect, it } from 'vitest';
import { minify } from 'terser';
import { parseCurl } from './curl';
import { CODE_TARGETS, generateCode, goString, jsString, minifyJson, phpString, pyLiteral, pyString, type CodeTarget } from './curlCodegen';

async function assertValidJs(code: string) {
  // Parses as an ES module (top-level await allowed). Throws on syntax errors.
  await minify(code, { module: true, compress: false, mangle: false });
}

const SAMPLES = {
  get: 'curl https://api.example.com/users?page=2',
  json: `curl -X POST https://api.example.com/users -H 'Content-Type: application/json' -H 'Authorization: Bearer abc' -d '{"name":"Ada","admin":false,"tags":["x"],"meta":null,"n":1.5}'`,
  form: "curl -F 'title=Hello' -F 'file=@photo.jpg;type=image/jpeg' https://upload.example.com/files",
  tricky: `curl -X PUT 'https://x.test/a' -H $'X-Quote: it\\'s "q" \\\\ $var \${x}' -u $'us"er:p\\'w' -d $'line1\\nline2 \\'s' -k -L --compressed -m 5`,
  urlencoded: "curl -d 'a=1&b=two words' https://x.test/form",
  head: 'curl -I https://x.test',
  custom: 'curl -X PURGE https://x.test/cache',
};

describe('string literal helpers', () => {
  it('jsString escapes', () => {
    expect(jsString(`a'b\\c\nd\u2028`)).toBe(`'a\\'b\\\\c\\nd\\u2028'`);
    expect(jsString('\x01')).toBe(`'\\x01'`);
    expect(jsString('${x} `t`')).toBe("'${x} `t`'");
    expect(jsString('é🎉')).toBe("'é🎉'");
  });

  it('pyString escapes', () => {
    expect(pyString(`a'b\\c\nd`)).toBe(`'a\\'b\\\\c\\nd'`);
    expect(pyString('{x}')).toBe("'{x}'");
  });

  it('goString escapes', () => {
    expect(goString('a"b\\c\n')).toBe('"a\\"b\\\\c\\n"');
  });

  it('phpString escapes only \\ and \'', () => {
    expect(phpString(`it's $x \\ "q"\n`)).toBe(`'it\\'s $x \\\\ "q"\n'`);
  });

  it('pyLiteral converts JSON values', () => {
    expect(pyLiteral({ a: true, b: null, c: [1, 'x'], d: {} })).toBe(
      "{\n    'a': True,\n    'b': None,\n    'c': [\n        1,\n        'x',\n    ],\n    'd': {},\n}",
    );
    expect(pyLiteral([])).toBe('[]');
    expect(pyLiteral(false)).toBe('False');
  });
});

describe('generated JavaScript is valid', () => {
  const jsTargets: CodeTarget[] = ['fetch', 'axios', 'node'];
  for (const target of jsTargets) {
    for (const [name, cmd] of Object.entries(SAMPLES)) {
      it(`${target}: ${name}`, async () => {
        await expect(assertValidJs(generateCode(parseCurl(cmd), target))).resolves.toBeUndefined();
      });
    }
  }
});

describe('fetch', () => {
  it('simple GET', () => {
    expect(generateCode(parseCurl(SAMPLES.get), 'fetch')).toBe(
      "const response = await fetch('https://api.example.com/users?page=2');\n\nconsole.log(response.status, await response.text());\n",
    );
  });

  it('JSON POST', () => {
    const code = generateCode(parseCurl(SAMPLES.json), 'fetch');
    expect(code).toContain("method: 'POST',");
    expect(code).toContain("'Content-Type': 'application/json',");
    expect(code).toContain('body: JSON.stringify({\n    "name": "Ada",');
  });

  it('basic auth becomes a precomputed header', () => {
    const code = generateCode(parseCurl('curl -u ada:pässword https://x.test'), 'fetch');
    const b64 = code.match(/Basic ([A-Za-z0-9+/=]+)/)![1];
    expect(new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)))).toBe('ada:pässword');
  });

  it('multipart uses FormData and drops Content-Type', () => {
    const code = generateCode(parseCurl(`${SAMPLES.form} -H 'Content-Type: multipart/form-data'`), 'fetch');
    expect(code).toContain("form.append('title', 'Hello');");
    expect(code).toContain("form.append('file', new Blob([], { type: 'image/jpeg' }), 'photo.jpg');");
    expect(code).not.toMatch(/multipart\/form-data/);
    expect(code).toContain('body: form,');
  });

  it('urlencoded adds the implicit content type', () => {
    expect(generateCode(parseCurl(SAMPLES.urlencoded), 'fetch')).toContain(
      "'Content-Type': 'application/x-www-form-urlencoded',",
    );
  });

  it('timeouts use AbortSignal', () => {
    expect(generateCode(parseCurl('curl -m 2.5 https://x.test'), 'fetch')).toContain('signal: AbortSignal.timeout(2500),');
  });

  it('merges duplicate headers', () => {
    expect(generateCode(parseCurl("curl -H 'X-A: 1' -H 'x-a: 2' https://x.test"), 'fetch')).toContain("'X-A': '1, 2',");
  });
});

describe('axios', () => {
  it('JSON POST uses an object for data and auth', () => {
    const code = generateCode(parseCurl(`${SAMPLES.json} -u a:b`), 'axios');
    expect(code).toContain("import axios from 'axios';");
    expect(code).toContain("method: 'post',");
    expect(code).toContain('data: {\n    "name": "Ada",');
    expect(code).toContain("auth: { username: 'a', password: 'b' },");
    expect(code).toContain('maxRedirects: 0');
  });

  it('insecure imports https', () => {
    const code = generateCode(parseCurl('curl -k -L https://x.test'), 'axios');
    expect(code).toContain("import https from 'node:https';");
    expect(code).toContain('rejectUnauthorized: false');
    expect(code).not.toContain('maxRedirects');
  });
});

describe('node', () => {
  it('uses https for https URLs and sets Content-Length', () => {
    const code = generateCode(parseCurl(SAMPLES.json), 'node');
    expect(code).toContain("import https from 'node:https';");
    expect(code).toContain("'Content-Length': Buffer.byteLength(body),");
    expect(code).toContain('req.write(body);');
  });

  it('uses http for http URLs and keeps duplicate headers as arrays', () => {
    const code = generateCode(parseCurl("curl -H 'X-A: 1' -H 'X-A: 2' http://x.test"), 'node');
    expect(code).toContain("import http from 'node:http';");
    expect(code).toContain("'X-A': ['1', '2'],");
    expect(code).not.toContain('req.write');
  });

  it('builds multipart bodies manually', () => {
    const code = generateCode(parseCurl(SAMPLES.form), 'node');
    expect(code).toContain("import fs from 'node:fs';");
    expect(code).toContain("fs.readFileSync('photo.jpg'),");
    expect(code).toContain("'Content-Type': 'multipart/form-data; boundary=' + boundary,");
  });
});

describe('python', () => {
  it('simple GET', () => {
    expect(generateCode(parseCurl(SAMPLES.get), 'python')).toBe(
      "import requests\n\nresponse = requests.get('https://api.example.com/users?page=2', allow_redirects=False)\n\nprint(response.status_code)\nprint(response.text)\n",
    );
  });

  it('JSON POST uses json= and omits the JSON content type', () => {
    const code = generateCode(parseCurl(SAMPLES.json), 'python');
    expect(code).toContain("json_data = {\n    'name': 'Ada',\n    'admin': False,");
    expect(code).toContain("'meta': None,");
    expect(code).not.toContain("'Content-Type': 'application/json'");
    expect(code).toContain("'Authorization': 'Bearer abc',");
    expect(code).toMatch(/requests\.post\(/);
    expect(code).toContain('json=json_data');
  });

  it('invalid JSON body falls back to data=', () => {
    const code = generateCode(parseCurl(`curl -H 'Content-Type: application/json' -d '{oops' https://x.test`), 'python');
    expect(code).toContain("data = '{oops'");
    expect(code).toContain("'Content-Type': 'application/json',");
  });

  it('multipart uses data= and files=', () => {
    const code = generateCode(parseCurl(SAMPLES.form), 'python');
    expect(code).toContain("data = {\n    'title': 'Hello',\n}");
    expect(code).toContain("files = {\n    'file': ('photo.jpg', open('photo.jpg', 'rb'), 'image/jpeg'),\n}");
  });

  it('duplicate field names use a list of tuples', () => {
    const code = generateCode(parseCurl("curl -F 'a=1' -F 'a=2' https://x.test"), 'python');
    expect(code).toContain("data = [\n    ('a', '1'),\n    ('a', '2'),\n]");
  });

  it('flags map to keyword arguments', () => {
    const code = generateCode(parseCurl(SAMPLES.tricky), 'python');
    expect(code).toContain('verify=False');
    expect(code).toContain('timeout=5');
    expect(code).toContain(`auth=('us"er', 'p\\'w')`);
    expect(code).toContain("data = 'line1\\nline2 \\'s'");
    expect(code).toContain("'X-Quote': 'it\\'s \"q\" \\\\ $var ${x}',");
    expect(code).not.toContain('allow_redirects');
  });

  it('custom methods use requests.request', () => {
    expect(generateCode(parseCurl(SAMPLES.custom), 'python')).toContain("requests.request('PURGE', 'https://x.test/cache'");
  });

  it('non-ASCII bodies are encoded', () => {
    expect(generateCode(parseCurl("curl -H 'Content-Type: text/plain' -d 'héllo' https://x.test"), 'python')).toContain(
      "data=data.encode('utf-8')",
    );
  });
});

describe('go', () => {
  it('JSON POST', () => {
    const code = generateCode(parseCurl(SAMPLES.json), 'go');
    expect(code).toContain('package main');
    expect(code).toContain('\t"strings"');
    expect(code).toContain('body := strings.NewReader(`{"name":"Ada","admin":false,"tags":["x"],"meta":null,"n":1.5}`)');
    expect(code).toContain('req, err := http.NewRequest("POST", "https://api.example.com/users", body)');
    expect(code).toContain('req.Header.Set("Content-Type", "application/json")');
  });

  it('imports are sorted and only what is needed', () => {
    const code = generateCode(parseCurl(SAMPLES.get), 'go');
    expect(code).toContain('import (\n\t"fmt"\n\t"io"\n\t"log"\n\t"net/http"\n)');
  });

  it('flags', () => {
    const code = generateCode(parseCurl(SAMPLES.tricky), 'go');
    expect(code).toContain('InsecureSkipVerify: true');
    expect(code).toContain('Timeout: 5000 * time.Millisecond,');
    expect(code).toContain('req.SetBasicAuth("us\\"er", "p\'w")');
    expect(code).toContain('body := strings.NewReader("line1\\nline2 \'s")');
    expect(code).not.toContain('CheckRedirect');
  });

  it('multipart', () => {
    const code = generateCode(parseCurl(SAMPLES.form), 'go');
    expect(code).toContain('writer.WriteField("title", "Hello")');
    expect(code).toContain('h2.Set("Content-Type", "image/jpeg")');
    expect(code).toContain('req.Header.Set("Content-Type", writer.FormDataContentType())');
    expect(code).toContain('\t"net/textproto"');
    expect(code).toContain('\t"os"');
  });

  it('duplicate headers use Add', () => {
    const code = generateCode(parseCurl("curl -H 'X-A: 1' -H 'X-A: 2' https://x.test"), 'go');
    expect(code).toContain('req.Header.Set("X-A", "1")\n\treq.Header.Add("X-A", "2")');
  });
});

describe('php', () => {
  it('JSON POST', () => {
    const code = generateCode(parseCurl(SAMPLES.json), 'php');
    expect(code.startsWith('<?php\n')).toBe(true);
    expect(code).toContain(`CURLOPT_POSTFIELDS => '{"name":"Ada","admin":false,"tags":["x"],"meta":null,"n":1.5}',`);
    expect(code).not.toContain('CURLOPT_CUSTOMREQUEST');
    expect(code).toContain("'Content-Type: application/json',");
  });

  it('flags and escaping', () => {
    const code = generateCode(parseCurl(SAMPLES.tricky), 'php');
    expect(code).toContain("CURLOPT_CUSTOMREQUEST => 'PUT',");
    expect(code).toContain(`CURLOPT_USERPWD => 'us"er:p\\'w',`);
    expect(code).toContain("CURLOPT_POSTFIELDS => 'line1\nline2 \\'s',");
    expect(code).toContain('CURLOPT_SSL_VERIFYPEER => false');
    expect(code).toContain('CURLOPT_FOLLOWLOCATION => true,');
    expect(code).toContain("CURLOPT_ENCODING => ''");
    expect(code).toContain('CURLOPT_TIMEOUT => 5,');
  });

  it('multipart uses CURLFile', () => {
    expect(generateCode(parseCurl(SAMPLES.form), 'php')).toContain(
      "'file' => new CURLFile('photo.jpg', 'image/jpeg', 'photo.jpg'),",
    );
  });

  it('HEAD uses NOBODY', () => {
    expect(generateCode(parseCurl(SAMPLES.head), 'php')).toContain('CURLOPT_NOBODY => true,');
  });

  it('keeps GET when a body is sent', () => {
    // Regression: CURLOPT_POSTFIELDS alone turned `curl -X GET -d …` into a POST.
    const code = generateCode(parseCurl("curl -X GET https://x.test/search -d 'q=1'"), 'php');
    expect(code).toContain("CURLOPT_CUSTOMREQUEST => 'GET',");
  });
});

describe('JSON bodies are never altered', () => {
  const bigInt = `curl https://x.test -H 'Content-Type: application/json' -d '{"id": 12345678901234567890, "n": 1}'`;

  it('sends bodies verbatim when parsing would change them', () => {
    // Regression: JSON.parse rounded 12345678901234567890 to 12345678901234567000 in every generator.
    for (const target of ['fetch', 'axios', 'node', 'python'] as CodeTarget[]) {
      const code = generateCode(parseCurl(bigInt), target);
      expect(code, target).toContain('12345678901234567890');
      expect(code, target).not.toContain('12345678901234567000');
    }
    const dup = generateCode(parseCurl(`curl https://x.test -H 'Content-Type: application/json' -d '{"a":1,"a":2}'`), 'python');
    expect(dup).toContain(`data = '{"a":1,"a":2}'`);
    expect(dup).toContain("'Content-Type': 'application/json'");
  });

  it('still pretty-prints bodies that survive a round trip', () => {
    const code = generateCode(parseCurl(SAMPLES.json), 'python');
    expect(code).toContain('json_data = {');
    expect(minifyJson(' { "a" : [1, 2] , "s": "x y\\" z" } ')).toBe('{"a":[1,2],"s":"x y\\" z"}');
  });
});

describe('every target handles every sample', () => {
  for (const { id } of CODE_TARGETS) {
    it(id, () => {
      for (const cmd of Object.values(SAMPLES)) {
        const code = generateCode(parseCurl(cmd), id);
        expect(code.length).toBeGreaterThan(20);
        expect(code.endsWith('\n')).toBe(true);
      }
    });
  }
});
