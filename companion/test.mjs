#!/usr/bin/env node
/**
 * End-to-end check of the companion: starts `companion/server.mjs` as a child
 * process plus a local target HTTP server, then verifies the token, origin and
 * Host checks, proxying, self-proxy refusal, size limits and timeouts.
 *
 * Usage: node companion/test.mjs   (uses ports 17901 and 17902 by default;
 *        override with COMPANION_TEST_PORT / TARGET_TEST_PORT)
 */
import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const TARGET_PORT = Number(process.env.TARGET_TEST_PORT || 17901);
const PORT = Number(process.env.COMPANION_TEST_PORT || 17902);
const TOKEN = 'test-token-0123456789';
const BASE = `http://127.0.0.1:${PORT}`;

// ---------------------------------------------------------------- target server
const target = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const body = Buffer.concat(chunks);
    if (req.url === '/slow') {
      setTimeout(() => res.end('late'), 2000);
      return;
    }
    if (req.url === '/big') {
      res.writeHead(200, { 'Content-Type': 'application/octet-stream' });
      res.end(Buffer.alloc(4096, 1));
      return;
    }
    if (req.url === '/redirect') {
      res.writeHead(302, { Location: '/echo?from=redirect' });
      res.end();
      return;
    }
    res.writeHead(201, [
      ['Content-Type', 'application/json'],
      ['Set-Cookie', 'a=1'],
      ['Set-Cookie', 'b=2'],
      ['X-Echo', 'yes'],
    ]);
    res.end(JSON.stringify({ method: req.method, url: req.url, headers: req.headers, bodyBase64: body.toString('base64') }));
  });
});

// ---------------------------------------------------------------- helpers
function request(path, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(`${BASE}${path}`, { method, headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try {
          json = JSON.parse(text);
        } catch {
          /* not JSON */
        }
        resolve({ status: res.statusCode, headers: res.headers, text, json });
      });
    });
    req.on('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

const auth = { 'x-localkit-token': TOKEN };
const proxy = (envelope, headers = {}) =>
  request('/proxy', { method: 'POST', headers: { ...auth, 'content-type': 'application/json', ...headers }, body: JSON.stringify(envelope) });

function startCompanion(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join(here, 'server.mjs'), ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    const timer = setTimeout(() => reject(new Error(`Companion did not start:\n${out}`)), 8000);
    child.stdout.on('data', (d) => {
      out += d;
      if (out.includes('listening on')) {
        clearTimeout(timer);
        resolve({ child, output: () => out });
      }
    });
    child.stderr.on('data', (d) => (out += d));
    child.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`Companion exited with ${code}:\n${out}`));
    });
  });
}

// ---------------------------------------------------------------- tests
const results = [];
async function test(name, fn) {
  try {
    await fn();
    results.push([true, name]);
    console.log(`  ok   ${name}`);
  } catch (error) {
    results.push([false, name]);
    console.log(`  FAIL ${name}\n       ${error.message.split('\n').join('\n       ')}`);
  }
}

await new Promise((r) => target.listen(TARGET_PORT, '127.0.0.1', r));
const { child, output } = await startCompanion(['--port', String(PORT), '--token', TOKEN, '--allow-origin', 'https://tools.example.com', '--max-bytes', '1024', '--timeout', '500']);

try {
  await test('prints the port and token at startup', () => {
    assert.match(output(), new RegExp(`127\\.0\\.0\\.1:${PORT}`));
    assert.match(output(), new RegExp(`Token: ${TOKEN}`));
  });

  await test('health requires the token', async () => {
    assert.equal((await request('/health')).status, 401);
    assert.equal((await request('/health', { headers: { 'x-localkit-token': 'wrong' } })).status, 401);
    const ok = await request('/health', { headers: auth });
    assert.equal(ok.status, 200);
    assert.deepEqual(ok.json, { name: 'localkit-companion', version: ok.json.version });
  });

  await test('proxy requires the token', async () => {
    const r = await request('/proxy', { method: 'POST', body: '{}' });
    assert.equal(r.status, 401);
  });

  await test('rejects foreign origins without CORS headers', async () => {
    const r = await request('/health', { headers: { ...auth, origin: 'https://evil.example' } });
    assert.equal(r.status, 403);
    assert.equal(r.headers['access-control-allow-origin'], undefined);
    const pre = await request('/proxy', { method: 'OPTIONS', headers: { origin: 'https://evil.example', 'access-control-request-method': 'POST' } });
    assert.equal(pre.status, 403);
  });

  await test('allows localhost origins and --allow-origin with CORS preflight', async () => {
    for (const origin of ['http://localhost:5173', 'http://127.0.0.1:4173', 'https://tools.example.com']) {
      const pre = await request('/proxy', {
        method: 'OPTIONS',
        headers: { origin, 'access-control-request-method': 'POST', 'access-control-request-private-network': 'true' },
      });
      assert.equal(pre.status, 204, origin);
      assert.equal(pre.headers['access-control-allow-origin'], origin);
      assert.match(pre.headers['access-control-allow-headers'], /x-localkit-token/);
      assert.equal(pre.headers['access-control-allow-private-network'], 'true');
      const r = await request('/health', { headers: { ...auth, origin } });
      assert.equal(r.status, 200);
      assert.equal(r.headers['access-control-allow-origin'], origin);
    }
    assert.equal((await request('/health', { headers: { ...auth, origin: 'http://localhost.evil.example' } })).status, 403);
  });

  await test('rejects non-loopback Host headers (DNS rebinding)', async () => {
    const r = await request('/health', { headers: { ...auth, host: `evil.example:${PORT}` } });
    assert.equal(r.status, 403);
  });

  await test('proxies a POST with headers and a UTF-8 body', async () => {
    const body = Buffer.from('{"name":"Zoë 👋"}');
    const r = await proxy({
      method: 'POST',
      url: `http://127.0.0.1:${TARGET_PORT}/echo?q=1`,
      headers: [
        ['Content-Type', 'application/json'],
        ['Cookie', 'session=abc'],
        ['Connection', 'close'],
      ],
      bodyBase64: body.toString('base64'),
      timeoutMs: 2000,
    });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.status, 201);
    assert.equal(r.json.statusText, 'Created');
    assert.ok(r.json.timeMs >= 0);
    const echoed = JSON.parse(Buffer.from(r.json.bodyBase64, 'base64').toString('utf8'));
    assert.equal(echoed.method, 'POST');
    assert.equal(echoed.url, '/echo?q=1');
    assert.equal(echoed.headers.cookie, 'session=abc');
    assert.equal(Buffer.from(echoed.bodyBase64, 'base64').toString('utf8'), '{"name":"Zoë 👋"}');
    assert.deepEqual(r.json.droppedHeaders, ['Connection']);
    const setCookies = r.json.headers.filter(([n]) => n === 'set-cookie').map(([, v]) => v);
    assert.deepEqual(setCookies, ['a=1', 'b=2']);
    assert.ok(r.json.headers.some(([n, v]) => n === 'x-echo' && v === 'yes'));
  });

  await test('follows redirects and reports the final URL', async () => {
    const r = await proxy({ method: 'GET', url: `http://127.0.0.1:${TARGET_PORT}/redirect`, headers: [], bodyBase64: null });
    assert.equal(r.json.status, 201);
    assert.equal(r.json.redirected, true);
    assert.match(r.json.url, /from=redirect/);
  });

  await test('refuses to proxy to itself', async () => {
    for (const host of ['127.0.0.1', 'localhost', '[::1]']) {
      const r = await proxy({ method: 'GET', url: `http://${host}:${PORT}/health`, headers: [], bodyBase64: null });
      assert.equal(r.status, 400, host);
      assert.match(r.json.error, /itself/);
    }
  });

  await test('validates envelopes', async () => {
    assert.equal((await request('/proxy', { method: 'POST', headers: auth, body: 'not json' })).status, 400);
    assert.equal((await proxy({ method: 'TRACE', url: 'http://127.0.0.1/' })).status, 400);
    assert.equal((await proxy({ method: 'GET', url: 'file:///etc/passwd' })).status, 400);
    assert.equal((await proxy({ method: 'GET', url: 'http://x.test', headers: 'nope' })).status, 400);
    assert.equal((await proxy({ method: 'GET', url: 'http://x.test', bodyBase64: 'eA==' })).status, 400);
  });

  await test('enforces the size limits', async () => {
    const big = Buffer.alloc(4096, 65).toString('base64');
    const r = await proxy({ method: 'POST', url: `http://127.0.0.1:${TARGET_PORT}/echo`, headers: [], bodyBase64: big });
    assert.equal(r.status, 413);
    const res = await proxy({ method: 'GET', url: `http://127.0.0.1:${TARGET_PORT}/big`, headers: [] });
    assert.equal(res.status, 502);
    assert.match(res.json.error, /larger/);
  });

  await test('times out slow targets', async () => {
    const r = await proxy({ method: 'GET', url: `http://127.0.0.1:${TARGET_PORT}/slow`, headers: [], timeoutMs: 300 });
    assert.equal(r.status, 504);
    assert.match(r.json.error, /300 ms/);
  });

  await test('reports unreachable targets honestly', async () => {
    const r = await proxy({ method: 'GET', url: 'http://127.0.0.1:17999/', headers: [] });
    assert.equal(r.status, 502);
    assert.match(r.json.error, /refused/);
  });

  await test('listens on loopback only', async () => {
    const external = Object.values(os.networkInterfaces())
      .flat()
      .find((i) => i && i.family === 'IPv4' && !i.internal);
    if (!external) return;
    const reachable = await new Promise((resolve) => {
      const req = http.get({ host: external.address, port: PORT, path: '/health', timeout: 1500 }, () => resolve(true));
      req.on('error', () => resolve(false));
      req.on('timeout', () => {
        req.destroy();
        resolve(false);
      });
    });
    assert.equal(reachable, false, `reachable on ${external.address}`);
  });
} finally {
  child.kill();
  target.close();
  target.closeAllConnections?.();
}

const failed = results.filter(([ok]) => !ok).length;
console.log(`\n${results.length - failed}/${results.length} companion checks passed.`);
process.exit(failed ? 1 : 0);
