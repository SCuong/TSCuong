import type { CurlFormPart, CurlHeader, ParsedCurl } from './curl';

export type CodeTarget = 'fetch' | 'axios' | 'python' | 'go' | 'php' | 'node';

export const CODE_TARGETS: Array<{ id: CodeTarget; label: string; language: 'javascript' | 'python' | 'go' | 'php' }> = [
  { id: 'fetch', label: 'JavaScript fetch', language: 'javascript' },
  { id: 'axios', label: 'axios', language: 'javascript' },
  { id: 'node', label: 'Node.js http', language: 'javascript' },
  { id: 'python', label: 'Python requests', language: 'python' },
  { id: 'go', label: 'Go net/http', language: 'go' },
  { id: 'php', label: 'PHP cURL', language: 'php' },
];

/* -------------------------------------------------------------------------- */
/* String literals                                                            */
/* -------------------------------------------------------------------------- */

function escapeControl(ch: string): string {
  return `\\x${ch.charCodeAt(0).toString(16).padStart(2, '0')}`;
}

/** Single-quoted JavaScript string literal. */
export function jsString(value: string): string {
  let out = "'";
  for (const ch of value) {
    if (ch === '\\') out += '\\\\';
    else if (ch === "'") out += "\\'";
    else if (ch === '\n') out += '\\n';
    else if (ch === '\r') out += '\\r';
    else if (ch === '\t') out += '\\t';
    else if (ch === ' ') out += '\\u2028';
    else if (ch === ' ') out += '\\u2029';
    else if (ch < ' ' || ch === '\x7f') out += escapeControl(ch);
    else out += ch;
  }
  return out + "'";
}

/** Single-quoted Python 3 string literal. */
export function pyString(value: string): string {
  let out = "'";
  for (const ch of value) {
    if (ch === '\\') out += '\\\\';
    else if (ch === "'") out += "\\'";
    else if (ch === '\n') out += '\\n';
    else if (ch === '\r') out += '\\r';
    else if (ch === '\t') out += '\\t';
    else if (ch < ' ' || ch === '\x7f') out += escapeControl(ch);
    else out += ch;
  }
  return out + "'";
}

/** Interpreted Go string literal (JSON escapes are a subset of Go's). */
export function goString(value: string): string {
  return JSON.stringify(value);
}

/** Single-quoted PHP string literal (only \ and ' are special). */
export function phpString(value: string): string {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

/** A JSON value rendered as a Python literal. */
export function pyLiteral(value: unknown, indent = 0): string {
  const pad = '    '.repeat(indent + 1);
  const end = '    '.repeat(indent);
  if (value === null) return 'None';
  if (value === true) return 'True';
  if (value === false) return 'False';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'None';
  if (typeof value === 'string') return pyString(value);
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    return `[\n${value.map((v) => `${pad}${pyLiteral(v, indent + 1)},`).join('\n')}\n${end}]`;
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) return '{}';
    return `{\n${entries.map(([k, v]) => `${pad}${pyString(k)}: ${pyLiteral(v, indent + 1)},`).join('\n')}\n${end}}`;
  }
  return 'None';
}

/** A JSON value rendered as a JavaScript expression with 2-space indentation. */
function jsLiteral(value: unknown, indent: number): string {
  const text = JSON.stringify(value, null, 2);
  return text
    .split('\n')
    .map((line, i) => (i === 0 ? line : '  '.repeat(indent) + line))
    .join('\n');
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function base64Utf8(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

/** Headers to send, including the implicit ones curl adds. */
function effectiveHeaders(req: ParsedCurl): CurlHeader[] {
  let headers = [...req.headers];
  if (req.bodyType === 'urlencoded' && !headers.some((h) => h.name.toLowerCase() === 'content-type')) {
    headers.push({ name: 'Content-Type', value: 'application/x-www-form-urlencoded' });
  }
  if (req.bodyType === 'multipart') {
    // The library must generate the boundary itself.
    headers = headers.filter((h) => h.name.toLowerCase() !== 'content-type');
  }
  return headers;
}

/** Merges duplicate header names (HTTP allows combining with ", "; Cookie uses "; "). */
function mergedHeaders(headers: CurlHeader[]): CurlHeader[] {
  const out: CurlHeader[] = [];
  for (const h of headers) {
    const existing = out.find((o) => o.name.toLowerCase() === h.name.toLowerCase());
    if (existing) existing.value += h.name.toLowerCase() === 'cookie' ? `; ${h.value}` : `, ${h.value}`;
    else out.push({ ...h });
  }
  return out;
}

function parsedJson(req: ParsedCurl): { ok: true; value: unknown } | { ok: false } {
  if (req.bodyType !== 'json' || req.body == null) return { ok: false };
  try {
    return { ok: true, value: JSON.parse(req.body) };
  } catch {
    return { ok: false };
  }
}

function partFilename(part: CurlFormPart): string {
  return part.filename ?? (part.file ?? '').split(/[\\/]/).pop() ?? 'file';
}

function partText(part: CurlFormPart): string {
  return part.valueFile !== undefined ? `<contents of ${part.valueFile}>` : (part.value ?? '');
}

function timeoutMs(req: ParsedCurl): number | undefined {
  const s = req.maxTime ?? req.connectTimeout;
  return s === undefined ? undefined : Math.round(s * 1000);
}

/* -------------------------------------------------------------------------- */
/* JavaScript fetch                                                           */
/* -------------------------------------------------------------------------- */

function toFetch(req: ParsedCurl): string {
  const lines: string[] = [];
  const pre: string[] = [];
  const headers = mergedHeaders(effectiveHeaders(req));
  if (req.auth) {
    headers.push({ name: 'Authorization', value: `Basic ${base64Utf8(`${req.auth.user}:${req.auth.password}`)}` });
  }
  const opts: string[] = [];
  if (req.method !== 'GET') opts.push(`  method: ${jsString(req.method)},`);
  if (headers.length) {
    opts.push('  headers: {');
    for (const h of headers) opts.push(`    ${jsString(h.name)}: ${jsString(h.value)},`);
    opts.push('  },');
  }
  if (req.bodyType === 'multipart') {
    pre.push('const form = new FormData();');
    for (const part of req.formParts) {
      if (part.file !== undefined) {
        const type = part.contentType ? `, { type: ${jsString(part.contentType)} }` : '';
        pre.push(`// Replace the empty Blob with the contents of ${part.file} (e.g. a File from <input type="file">).`);
        pre.push(`form.append(${jsString(part.name)}, new Blob([]${type}), ${jsString(partFilename(part))});`);
      } else {
        pre.push(`form.append(${jsString(part.name)}, ${jsString(partText(part))});`);
      }
    }
    pre.push('');
    opts.push('  body: form,');
  } else if (req.body != null && req.bodyType !== 'none') {
    const json = parsedJson(req);
    opts.push(json.ok ? `  body: JSON.stringify(${jsLiteral(json.value, 1)}),` : `  body: ${jsString(req.body)},`);
  }
  const ms = timeoutMs(req);
  if (ms !== undefined) opts.push(`  signal: AbortSignal.timeout(${ms}),`);
  if (req.insecure) lines.push('// --insecure: browsers cannot skip TLS certificate checks.');
  if (req.compressed) lines.push('// --compressed: fetch decompresses gzip/deflate/br responses automatically.');
  lines.push(...pre);
  if (opts.length) lines.push(`const response = await fetch(${jsString(req.url)}, {`, ...opts, '});');
  else lines.push(`const response = await fetch(${jsString(req.url)});`);
  lines.push('', 'console.log(response.status, await response.text());');
  return lines.join('\n') + '\n';
}

/* -------------------------------------------------------------------------- */
/* axios                                                                      */
/* -------------------------------------------------------------------------- */

function toAxios(req: ParsedCurl): string {
  const lines: string[] = ["import axios from 'axios';"];
  if (req.insecure) lines.push("import https from 'node:https';");
  lines.push('');
  const headers = mergedHeaders(effectiveHeaders(req));
  const opts: string[] = [`  method: ${jsString(req.method.toLowerCase())},`, `  url: ${jsString(req.url)},`];
  if (headers.length) {
    opts.push('  headers: {');
    for (const h of headers) opts.push(`    ${jsString(h.name)}: ${jsString(h.value)},`);
    opts.push('  },');
  }
  if (req.auth) {
    opts.push(`  auth: { username: ${jsString(req.auth.user)}, password: ${jsString(req.auth.password)} },`);
  }
  if (req.bodyType === 'multipart') {
    lines.push('const form = new FormData();');
    for (const part of req.formParts) {
      if (part.file !== undefined) {
        const type = part.contentType ? `, { type: ${jsString(part.contentType)} }` : '';
        lines.push(`// Replace the empty Blob with the contents of ${part.file}.`);
        lines.push(`form.append(${jsString(part.name)}, new Blob([]${type}), ${jsString(partFilename(part))});`);
      } else {
        lines.push(`form.append(${jsString(part.name)}, ${jsString(partText(part))});`);
      }
    }
    lines.push('');
    opts.push('  data: form,');
  } else if (req.body != null && req.bodyType !== 'none') {
    const json = parsedJson(req);
    opts.push(json.ok ? `  data: ${jsLiteral(json.value, 1)},` : `  data: ${jsString(req.body)},`);
  }
  const ms = timeoutMs(req);
  if (ms !== undefined) opts.push(`  timeout: ${ms},`);
  if (!req.followRedirects) opts.push('  maxRedirects: 0, // curl does not follow redirects without -L');
  if (req.insecure) opts.push('  httpsAgent: new https.Agent({ rejectUnauthorized: false }), // --insecure (Node.js only)');
  if (req.compressed) opts.push("  decompress: true, // --compressed (Node.js; browsers decompress automatically)");
  lines.push('const response = await axios({', ...opts, '});', '', 'console.log(response.status, response.data);');
  return lines.join('\n') + '\n';
}

/* -------------------------------------------------------------------------- */
/* Node.js http / https                                                       */
/* -------------------------------------------------------------------------- */

function toNode(req: ParsedCurl): string {
  const isHttps = /^https:/i.test(req.url);
  const mod = isHttps ? 'https' : 'http';
  const lines: string[] = [`import ${mod} from 'node:${mod}';`];
  const needsFs = req.bodyType === 'multipart' && req.formParts.some((p) => p.file !== undefined);
  if (needsFs) lines.push("import fs from 'node:fs';");
  lines.push('');

  const headerLines: string[] = [];
  const grouped = new Map<string, { name: string; values: string[] }>();
  for (const h of effectiveHeaders(req)) {
    const key = h.name.toLowerCase();
    const g = grouped.get(key);
    if (g) g.values.push(h.value);
    else grouped.set(key, { name: h.name, values: [h.value] });
  }
  for (const { name, values } of grouped.values()) {
    const value = values.length === 1 ? jsString(values[0]) : `[${values.map(jsString).join(', ')}]`;
    headerLines.push(`    ${jsString(name)}: ${value},`);
  }
  if (req.auth) {
    headerLines.push(
      `    Authorization: 'Basic ' + Buffer.from(${jsString(`${req.auth.user}:${req.auth.password}`)}).toString('base64'),`,
    );
  }

  let hasBody = false;
  if (req.bodyType === 'multipart') {
    hasBody = true;
    lines.push("const boundary = '----LocalKitFormBoundary' + Math.random().toString(16).slice(2);");
    lines.push('const body = Buffer.concat([');
    for (const part of req.formParts) {
      const name = part.name.replace(/"/g, '%22');
      if (part.file !== undefined) {
        const disp = `Content-Disposition: form-data; name="${name}"; filename="${partFilename(part).replace(/"/g, '%22')}"\r\nContent-Type: ${part.contentType ?? 'application/octet-stream'}\r\n\r\n`;
        lines.push(`  Buffer.from('--' + boundary + ${jsString(`\r\n${disp}`)}),`);
        lines.push(`  fs.readFileSync(${jsString(part.file)}),`);
        lines.push(`  Buffer.from('\\r\\n'),`);
      } else {
        const type = part.contentType ? `\r\nContent-Type: ${part.contentType}` : '';
        lines.push(
          `  Buffer.from('--' + boundary + ${jsString(`\r\nContent-Disposition: form-data; name="${name}"${type}\r\n\r\n${partText(part)}\r\n`)}),`,
        );
      }
    }
    lines.push("  Buffer.from('--' + boundary + '--\\r\\n'),", ']);', '');
    headerLines.push("    'Content-Type': 'multipart/form-data; boundary=' + boundary,");
  } else if (req.body != null && req.bodyType !== 'none') {
    hasBody = true;
    const json = parsedJson(req);
    lines.push(json.ok ? `const body = JSON.stringify(${jsLiteral(json.value, 0)});` : `const body = ${jsString(req.body)};`, '');
  }
  if (hasBody) headerLines.push("    'Content-Length': Buffer.byteLength(body),");

  const opts: string[] = [`  method: ${jsString(req.method)},`];
  if (headerLines.length) opts.push('  headers: {', ...headerLines, '  },');
  if (req.insecure && isHttps) opts.push('  rejectUnauthorized: false, // --insecure');
  const ms = timeoutMs(req);
  if (ms !== undefined) opts.push(`  timeout: ${ms},`);

  if (req.followRedirects) lines.push('// -L: node:http does not follow redirects; handle 3xx responses and the Location header yourself.');
  if (req.compressed) lines.push("// --compressed: add an Accept-Encoding header and decompress with node:zlib if you need it.");
  lines.push(
    'const options = {',
    ...opts,
    '};',
    '',
    `const req = ${mod}.request(${jsString(req.url)}, options, (res) => {`,
    "  let data = '';",
    "  res.setEncoding('utf8');",
    "  res.on('data', (chunk) => {",
    '    data += chunk;',
    '  });',
    "  res.on('end', () => {",
    '    console.log(res.statusCode, data);',
    '  });',
    '});',
    '',
    "req.on('error', (error) => {",
    '  console.error(error);',
    '});',
  );
  if (ms !== undefined) lines.push("req.on('timeout', () => {", "  req.destroy(new Error('Request timed out'));", '});');
  if (hasBody) lines.push('req.write(body);');
  lines.push('req.end();');
  return lines.join('\n') + '\n';
}

/* -------------------------------------------------------------------------- */
/* Python requests                                                            */
/* -------------------------------------------------------------------------- */

const PY_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']);

function pyPairs(pairs: Array<[string, string]>, indent: number): string {
  const pad = '    '.repeat(indent + 1);
  const end = '    '.repeat(indent);
  const unique = new Set(pairs.map(([k]) => k)).size === pairs.length;
  if (unique) return `{\n${pairs.map(([k, v]) => `${pad}${pyString(k)}: ${v},`).join('\n')}\n${end}}`;
  return `[\n${pairs.map(([k, v]) => `${pad}(${pyString(k)}, ${v}),`).join('\n')}\n${end}]`;
}

function toPython(req: ParsedCurl): string {
  const lines: string[] = ['import requests', ''];
  const args: string[] = [pyString(req.url)];
  const headers = mergedHeaders(effectiveHeaders(req));
  const json = parsedJson(req);
  // requests sets Content-Type itself when json= is used.
  const shownHeaders = json.ok
    ? headers.filter((h) => !(h.name.toLowerCase() === 'content-type' && h.value.toLowerCase() === 'application/json'))
    : headers;
  if (shownHeaders.length) {
    lines.push(`headers = ${pyPairs(shownHeaders.map((h) => [h.name, pyString(h.value)]), 0)}`, '');
    args.push('headers=headers');
  }
  if (req.bodyType === 'multipart') {
    const fields = req.formParts.filter((p) => p.file === undefined);
    const files = req.formParts.filter((p) => p.file !== undefined);
    if (fields.length) {
      lines.push(`data = ${pyPairs(fields.map((p) => [p.name, pyString(partText(p))]), 0)}`, '');
      args.push('data=data');
    }
    if (files.length) {
      lines.push(
        `files = ${pyPairs(
          files.map((p) => {
            const tuple = [pyString(partFilename(p)), `open(${pyString(p.file!)}, 'rb')`];
            if (p.contentType) tuple.push(pyString(p.contentType));
            return [p.name, `(${tuple.join(', ')})`];
          }),
          0,
        )}`,
        '',
      );
      args.push('files=files');
    }
  } else if (req.body != null && req.bodyType !== 'none') {
    if (json.ok) {
      lines.push(`json_data = ${pyLiteral(json.value)}`, '');
      args.push('json=json_data');
    } else {
      lines.push(`data = ${pyString(req.body)}`, '');
      args.push(req.bodyType === 'binary' || /[^\p{ASCII}]/u.test(req.body) ? "data=data.encode('utf-8')" : 'data=data');
    }
  }
  if (req.auth) args.push(`auth=(${pyString(req.auth.user)}, ${pyString(req.auth.password)})`);
  if (req.maxTime !== undefined && req.connectTimeout !== undefined) args.push(`timeout=(${req.connectTimeout}, ${req.maxTime})`);
  else if (req.maxTime !== undefined || req.connectTimeout !== undefined) args.push(`timeout=${req.maxTime ?? req.connectTimeout}`);
  if (req.insecure) args.push('verify=False');
  if (!req.followRedirects && req.method !== 'HEAD') args.push('allow_redirects=False');
  if (req.followRedirects && req.method === 'HEAD') args.push('allow_redirects=True');

  const callArgs = PY_METHODS.has(req.method) ? args : [pyString(req.method), ...args];
  const fn = PY_METHODS.has(req.method) ? `requests.${req.method.toLowerCase()}` : 'requests.request';
  const oneLine = `response = ${fn}(${callArgs.join(', ')})`;
  if (oneLine.length <= 88) lines.push(oneLine);
  else lines.push(`response = ${fn}(`, ...callArgs.map((a) => `    ${a},`), ')');
  if (req.compressed) lines.unshift('# --compressed: requests decompresses gzip/deflate responses automatically.');
  lines.push('', 'print(response.status_code)', 'print(response.text)');
  return lines.join('\n') + '\n';
}

/* -------------------------------------------------------------------------- */
/* Go net/http                                                                */
/* -------------------------------------------------------------------------- */

function goRawOrQuoted(value: string): string {
  return !value.includes('`') && !value.includes('\r') && value.includes('"') ? `\`${value}\`` : goString(value);
}

function toGo(req: ParsedCurl): string {
  const imports = new Set(['fmt', 'io', 'log', 'net/http']);
  const body: string[] = [];
  let bodyVar = 'nil';
  if (req.bodyType === 'multipart') {
    imports.add('bytes');
    imports.add('mime/multipart');
    body.push('\tbody := &bytes.Buffer{}', '\twriter := multipart.NewWriter(body)');
    let i = 0;
    for (const part of req.formParts) {
      i++;
      if (part.file !== undefined) {
        imports.add('os');
        const f = `file${i}`;
        body.push(
          `\t${f}, err := os.Open(${goString(part.file)})`,
          '\tif err != nil {',
          '\t\tlog.Fatal(err)',
          '\t}',
          `\tdefer ${f}.Close()`,
        );
        if (part.contentType) {
          imports.add('net/textproto');
          body.push(
            `\th${i} := make(textproto.MIMEHeader)`,
            `\th${i}.Set("Content-Disposition", ${goString(`form-data; name="${part.name.replace(/"/g, '%22')}"; filename="${partFilename(part).replace(/"/g, '%22')}"`)})`,
            `\th${i}.Set("Content-Type", ${goString(part.contentType)})`,
            `\tpart${i}, err := writer.CreatePart(h${i})`,
          );
        } else {
          body.push(`\tpart${i}, err := writer.CreateFormFile(${goString(part.name)}, ${goString(partFilename(part))})`);
        }
        body.push('\tif err != nil {', '\t\tlog.Fatal(err)', '\t}', `\tif _, err := io.Copy(part${i}, ${f}); err != nil {`, '\t\tlog.Fatal(err)', '\t}');
      } else {
        body.push(`\tif err := writer.WriteField(${goString(part.name)}, ${goString(partText(part))}); err != nil {`, '\t\tlog.Fatal(err)', '\t}');
      }
    }
    body.push('\tif err := writer.Close(); err != nil {', '\t\tlog.Fatal(err)', '\t}', '');
    bodyVar = 'body';
  } else if (req.body != null && req.bodyType !== 'none') {
    imports.add('strings');
    body.push(`\tbody := strings.NewReader(${goRawOrQuoted(req.body)})`, '');
    bodyVar = 'body';
  }

  const client: string[] = [];
  const clientFields: string[] = [];
  const ms = timeoutMs(req);
  if (ms !== undefined) {
    imports.add('time');
    clientFields.push(`\t\tTimeout: ${ms} * time.Millisecond,`);
  }
  if (req.insecure) {
    imports.add('crypto/tls');
    clientFields.push('\t\tTransport: &http.Transport{', '\t\t\tTLSClientConfig: &tls.Config{InsecureSkipVerify: true}, // --insecure', '\t\t},');
  }
  if (!req.followRedirects) {
    clientFields.push(
      '\t\t// curl does not follow redirects without -L.',
      '\t\tCheckRedirect: func(req *http.Request, via []*http.Request) error {',
      '\t\t\treturn http.ErrUseLastResponse',
      '\t\t},',
    );
  }
  client.push('\tclient := &http.Client{', ...clientFields, '\t}');

  const lines: string[] = [];
  lines.push(`\treq, err := http.NewRequest(${goString(req.method)}, ${goString(req.url)}, ${bodyVar})`, '\tif err != nil {', '\t\tlog.Fatal(err)', '\t}');
  const seen = new Set<string>();
  for (const h of effectiveHeaders(req)) {
    const key = h.name.toLowerCase();
    if (key === 'host') {
      lines.push(`\treq.Host = ${goString(h.value)}`);
      continue;
    }
    lines.push(`\treq.Header.${seen.has(key) ? 'Add' : 'Set'}(${goString(h.name)}, ${goString(h.value)})`);
    seen.add(key);
  }
  if (req.bodyType === 'multipart') lines.push('\treq.Header.Set("Content-Type", writer.FormDataContentType())');
  if (req.auth) lines.push(`\treq.SetBasicAuth(${goString(req.auth.user)}, ${goString(req.auth.password)})`);
  lines.push('');
  const comment = req.compressed ? ['\t// --compressed: Go\'s transport requests and decodes gzip automatically.'] : [];
  const sortedImports = [...imports].sort();
  return [
    'package main',
    '',
    'import (',
    ...sortedImports.map((i) => `\t"${i}"`),
    ')',
    '',
    'func main() {',
    ...body,
    ...client,
    '',
    ...comment,
    ...lines,
    '\tresp, err := client.Do(req)',
    '\tif err != nil {',
    '\t\tlog.Fatal(err)',
    '\t}',
    '\tdefer resp.Body.Close()',
    '',
    '\tdata, err := io.ReadAll(resp.Body)',
    '\tif err != nil {',
    '\t\tlog.Fatal(err)',
    '\t}',
    '\tfmt.Println(resp.StatusCode)',
    '\tfmt.Println(string(data))',
    '}',
    '',
  ].join('\n');
}

/* -------------------------------------------------------------------------- */
/* PHP cURL                                                                   */
/* -------------------------------------------------------------------------- */

function toPhp(req: ParsedCurl): string {
  const opts: string[] = [`    CURLOPT_URL => ${phpString(req.url)},`, '    CURLOPT_RETURNTRANSFER => true,'];
  const notes: string[] = [];
  const hasBody = req.bodyType === 'multipart' || (req.body != null && req.bodyType !== 'none');
  if (req.method === 'HEAD') opts.push('    CURLOPT_NOBODY => true,');
  else if (req.method === 'POST' && hasBody) {
    /* POSTFIELDS implies POST */
  } else if (req.method !== 'GET') opts.push(`    CURLOPT_CUSTOMREQUEST => ${phpString(req.method)},`);
  const headers = effectiveHeaders(req);
  if (headers.length) {
    opts.push('    CURLOPT_HTTPHEADER => [');
    for (const h of headers) opts.push(`        ${phpString(`${h.name}: ${h.value}`)},`);
    opts.push('    ],');
  }
  if (req.bodyType === 'multipart') {
    const names = req.formParts.map((p) => p.name);
    if (new Set(names).size !== names.length) {
      notes.push('// Note: PHP arrays cannot hold duplicate keys; repeated form fields keep only the last value.');
    }
    opts.push('    CURLOPT_POSTFIELDS => [');
    for (const part of req.formParts) {
      if (part.file !== undefined) {
        opts.push(
          `        ${phpString(part.name)} => new CURLFile(${phpString(part.file)}, ${phpString(part.contentType ?? '')}, ${phpString(partFilename(part))}),`,
        );
      } else {
        opts.push(`        ${phpString(part.name)} => ${phpString(partText(part))},`);
      }
    }
    opts.push('    ],');
  } else if (req.body != null && req.bodyType !== 'none') {
    opts.push(`    CURLOPT_POSTFIELDS => ${phpString(req.body)},`);
  }
  if (req.auth) opts.push(`    CURLOPT_USERPWD => ${phpString(`${req.auth.user}:${req.auth.password}`)},`);
  if (req.compressed) opts.push("    CURLOPT_ENCODING => '', // --compressed");
  if (req.followRedirects) opts.push('    CURLOPT_FOLLOWLOCATION => true,');
  if (req.insecure) opts.push('    CURLOPT_SSL_VERIFYPEER => false, // --insecure', '    CURLOPT_SSL_VERIFYHOST => 0,');
  if (req.maxTime !== undefined) opts.push(`    CURLOPT_TIMEOUT => ${Math.ceil(req.maxTime)},`);
  if (req.connectTimeout !== undefined) opts.push(`    CURLOPT_CONNECTTIMEOUT => ${Math.ceil(req.connectTimeout)},`);
  return [
    '<?php',
    '',
    ...notes,
    '$ch = curl_init();',
    'curl_setopt_array($ch, [',
    ...opts,
    ']);',
    '',
    '$response = curl_exec($ch);',
    'if ($response === false) {',
    "    echo 'Request failed: ' . curl_error($ch) . PHP_EOL;",
    '} else {',
    "    echo curl_getinfo($ch, CURLINFO_RESPONSE_CODE) . PHP_EOL;",
    '    echo $response;',
    '}',
    '',
  ].join('\n');
}

/* -------------------------------------------------------------------------- */

export function generateCode(req: ParsedCurl, target: CodeTarget): string {
  switch (target) {
    case 'fetch':
      return toFetch(req);
    case 'axios':
      return toAxios(req);
    case 'node':
      return toNode(req);
    case 'python':
      return toPython(req);
    case 'go':
      return toGo(req);
    case 'php':
      return toPhp(req);
  }
}
