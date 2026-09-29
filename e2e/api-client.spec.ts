import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Page } from '@playwright/test';
import { test as base, expect } from './fixtures';

interface Servers {
  /** Echo server that allows cross-origin requests. */
  cors: string;
  /** Echo server without CORS headers: the browser must refuse to show its responses. */
  plain: string;
}

function startEcho(cors: boolean): Promise<Server> {
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk: Buffer) => (body += chunk.toString('utf8')));
    req.on('end', () => {
      if (cors) {
        res.setHeader('Access-Control-Allow-Origin', '*');
        // `*` does not cover Authorization, which must be listed explicitly.
        res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, *');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
      }
      if (req.method === 'OPTIONS') {
        res.statusCode = 204;
        res.end();
        return;
      }
      res.setHeader('Content-Type', 'application/json');
      if (req.url?.startsWith('/missing')) {
        res.statusCode = 404;
        res.end(JSON.stringify({ error: 'not found' }));
        return;
      }
      res.end(
        JSON.stringify({
          method: req.method,
          path: req.url,
          contentType: req.headers['content-type'] ?? null,
          hasAuth: Boolean(req.headers.authorization),
          body,
        }),
      );
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

const test = base.extend<object, { servers: Servers }>({
  servers: [
    // eslint-disable-next-line no-empty-pattern -- Playwright fixtures must destructure their dependencies.
    async ({}, use) => {
      const cors = await startEcho(true);
      const plain = await startEcho(false);
      const url = (s: Server) => `http://127.0.0.1:${(s.address() as AddressInfo).port}`;
      await use({ cors: url(cors), plain: url(plain) });
      cors.close();
      plain.close();
    },
    { scope: 'worker' },
  ],
});

/** Chromium logs blocked/failed fetches as console errors; those are the expected outcome in failure tests. */
function acceptNetworkErrors(errors: string[]) {
  const unexpected = errors.filter(
    (e) => !/CORS|ERR_FAILED|ERR_CONNECTION_REFUSED|Failed to load resource|Failed to fetch|responded with a status of/i.test(e),
  );
  expect(unexpected).toEqual([]);
  errors.length = 0;
}

async function send(page: Page, url: string) {
  await page.getByRole('textbox', { name: 'Request URL' }).fill(url);
  await page.getByRole('button', { name: 'Send', exact: true }).click();
}

const response = (page: Page) => page.getByRole('region', { name: 'Response' });

test('shows status, timing, size and a pretty JSON body for a successful request', async ({ page, servers }) => {
  await page.goto('/tools/api');
  await send(page, `${servers.cors}/items?page=2`);
  await expect(response(page)).toContainText('200 OK');
  await expect(response(page)).toContainText('"path": "/items?page=2"');
  await expect(response(page)).toContainText(/\d+ ms/);
});

test('shows HTTP errors as real responses, not failures', async ({ page, servers, consoleErrors }) => {
  await page.goto('/tools/api');
  await send(page, `${servers.cors}/missing`);
  await expect(response(page)).toContainText('404 Not Found');
  await expect(response(page)).toContainText('"error": "not found"');
  await expect(response(page).getByRole('alert')).toHaveCount(0);
  // Chromium logs every non-2xx fetch to the console; that is not an app error.
  acceptNetworkErrors(consoleErrors);
});

const curlCommand = (base: string) =>
  `curl -X POST '${base}/echo' -H 'Content-Type: application/json' -d '{"a":1,"b":"ü"}'`;

test('imports a cURL command pasted into the URL field', async ({ page, context, servers }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/tools/api');
  await page.evaluate((text) => navigator.clipboard.writeText(text), curlCommand(servers.cors));
  await page.getByRole('textbox', { name: 'Request URL' }).focus();
  await page.keyboard.press('ControlOrMeta+v');
  await expect(page.getByRole('combobox', { name: 'HTTP method' })).toHaveValue('POST');
  await expect(page.getByRole('textbox', { name: 'Request URL' })).toHaveValue(`${servers.cors}/echo`);
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(response(page)).toContainText('"method": "POST"');
  await expect(response(page)).toContainText('"contentType": "application/json"');
  await expect(response(page)).toContainText('\\"b\\":\\"ü\\"');
});

test('a typed cURL command is imported for review on Send instead of being sent as a URL', async ({ page, servers }) => {
  await page.goto('/tools/api');
  await page.getByRole('textbox', { name: 'Request URL' }).fill(curlCommand(servers.cors));
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByText('Imported from curl. Review the request, then press Send.')).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'HTTP method' })).toHaveValue('POST');
  await expect(response(page)).not.toContainText('200 OK');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(response(page)).toContainText('"method": "POST"');
});

test('explains a CORS-blocked request honestly instead of faking a response', async ({ page, servers, consoleErrors }) => {
  await page.goto('/tools/api');
  await send(page, `${servers.plain}/items`);
  const alert = response(page).getByRole('alert');
  await expect(alert).toContainText('The browser could not get a response');
  await expect(alert).toContainText('CORS');
  await expect(response(page)).not.toContainText('200 OK');
  await expect(response(page).getByRole('button', { name: /companion/i })).toBeVisible();
  acceptNetworkErrors(consoleErrors);
});

test('reports an unreachable server as a failure', async ({ page, consoleErrors }) => {
  await page.goto('/tools/api');
  await send(page, 'http://127.0.0.1:9/nothing');
  await expect(response(page).getByRole('alert')).toContainText('could not get a response');
  acceptNetworkErrors(consoleErrors);
});

test('history never stores bearer tokens or credential query parameters', async ({ page, servers }) => {
  await page.goto('/tools/api');
  await page.getByRole('tab', { name: 'Auth' }).click();
  await page.getByRole('radio', { name: 'Bearer' }).click();
  await page.getByRole('textbox', { name: 'Token' }).fill('SECRET-TOKEN-123');
  await send(page, `${servers.cors}/items?api_key=SECRET-KEY-456&page=2`);
  await expect(response(page)).toContainText('"hasAuth": true');

  await expect(page.getByRole('tab', { name: /History 1/ })).toBeVisible();
  const stored = await page.evaluate(
    () =>
      new Promise<string>((resolve, reject) => {
        const open = indexedDB.open('localkit');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const tx = open.result.transaction('apiHistory');
          const all = tx.objectStore('apiHistory').getAll();
          all.onsuccess = () => resolve(JSON.stringify(all.result));
          all.onerror = () => reject(all.error);
        };
      }),
  );
  expect(stored).toContain('page=2');
  expect(stored).not.toContain('SECRET-TOKEN-123');
  expect(stored).not.toContain('SECRET-KEY-456');
});
