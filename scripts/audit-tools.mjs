/* global document, window -- used inside page.evaluate callbacks, which run in the browser */
// Audit helper: opens every registered tool and reports render failures,
// console errors/warnings, horizontal overflow and placeholder text.
//
// Usage:
//   node scripts/audit-tools.mjs [--base=http://localhost:5173] [--filter=pdf/]
//        [--files=pdf.ts,image.ts] [--skip-files=web.ts]
//        [--themes=dark,light] [--viewports=desktop,mobile] [--shots=dir]
//        [--concurrency=4] [--json=report.json]
import { chromium } from '@playwright/test';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, ...v] = a.replace(/^--/, '').split('=');
    return [k, v.length ? v.join('=') : 'true'];
  }),
);
const base = args.base ?? 'http://localhost:5173';
const themes = (args.themes ?? 'dark,light').split(',');
const viewports = (args.viewports ?? 'desktop,mobile').split(',');
const concurrency = Number(args.concurrency ?? 4);
const filter = args.filter ? new RegExp(args.filter) : null;
const shotsDir = args.shots;
if (shotsDir) mkdirSync(shotsDir, { recursive: true });

// --- discover tools from the registry source ---------------------------------
const registryDir = 'src/tools/registry';
const tools = [];
for (const file of readdirSync(registryDir).filter((f) => f.endsWith('.ts') && f !== 'index.ts')) {
  const src = readFileSync(join(registryDir, file), 'utf8');
  const re = /id:\s*'([^']+)'[\s\S]*?name:\s*'((?:[^'\\]|\\.)*)'[\s\S]*?route:\s*'([^']+)'/g;
  for (const m of src.matchAll(re)) tools.push({ id: m[1], name: m[2].replace(/\\'/g, "'"), route: m[3], file });
}
const onlyFiles = args.files ? args.files.split(',') : null;
const skipFiles = args['skip-files'] ? args['skip-files'].split(',') : [];
const selected = tools.filter(
  (t) =>
    (!filter || filter.test(t.route) || filter.test(t.id)) &&
    (!onlyFiles || onlyFiles.includes(t.file)) &&
    !skipFiles.includes(t.file),
);
console.log(`Auditing ${selected.length} of ${tools.length} tools × ${themes.length} themes × ${viewports.length} viewports`);

const PLACEHOLDER = /coming soon|not (?:yet )?implemented|\bTODO\b|\bFIXME\b|\bstub\b|lorem placeholder/i;
/** Tools whose legitimate content matches the placeholder pattern (e.g. HTTP 501 "Not Implemented"). */
const PLACEHOLDER_EXCEPTIONS = { 'http-status-codes': /not implemented/i };
const IGNORED_CONSOLE = [/Download the React DevTools/, /\[vite\]/, /\[HMR\]/];

const browser = await chromium.launch();
const results = [];

async function auditOne(context, tool, theme, viewport) {
  const page = await context.newPage();
  const logs = [];
  page.on('console', (m) => {
    if ((m.type() === 'error' || m.type() === 'warning') && !IGNORED_CONSOLE.some((r) => r.test(m.text())))
      logs.push(`${m.type()}: ${m.text().slice(0, 300)}`);
  });
  page.on('pageerror', (e) => logs.push(`pageerror: ${e.message.slice(0, 300)}`));
  const problems = [];
  const started = Date.now();
  try {
    await page.goto(`${base}/tools/${tool.route}`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await page.getByRole('heading', { level: 1 }).first().waitFor({ timeout: 20_000 });
    // Wait for the lazily loaded tool to replace the Suspense spinner.
    await page
      .waitForFunction(
        () =>
          ![...document.querySelectorAll('main [role="status"]')].some((el) =>
            /^\s*Loading/i.test(el.textContent ?? ''),
          ),
        null,
        { timeout: 25_000 },
      )
      .catch(() => problems.push('tool still loading after 25s'));
    await page.waitForTimeout(400);
    const info = await page.evaluate(() => {
      const main = document.querySelector('main');
      const text = main?.innerText ?? '';
      return {
        h1: document.querySelector('h1')?.textContent ?? '',
        overflow: document.documentElement.scrollWidth - window.innerWidth,
        crashed: /This tool ran into a problem|This tool could not be loaded/.test(text),
        notFound: /Page not found/.test(text),
        text: text.slice(0, 20_000),
      };
    });
    if (info.notFound) problems.push('not found');
    if (info.crashed) problems.push('ERROR BOUNDARY');
    if (info.h1.trim() !== tool.name) problems.push(`h1 "${info.h1}" != "${tool.name}"`);
    if (info.overflow > 1) problems.push(`horizontal overflow ${info.overflow}px`);
    const ph = info.text.match(PLACEHOLDER);
    if (ph && !/lorem/i.test(tool.id) && !PLACEHOLDER_EXCEPTIONS[tool.id]?.test(ph[0]))
      problems.push(`placeholder text "${ph[0]}"`);
    if (shotsDir) {
      const name = `${tool.route.replace(/[^a-z0-9]+/gi, '_')}-${theme}-${viewport}.png`;
      await page.screenshot({ path: join(shotsDir, name), fullPage: false });
    }
  } catch (error) {
    problems.push(`exception: ${String(error.message ?? error).split('\n')[0]}`);
  }
  await page.close();
  const all = [...problems, ...new Set(logs)];
  results.push({ route: tool.route, id: tool.id, theme, viewport, ms: Date.now() - started, problems: all });
  process.stdout.write(all.length ? 'x' : '.');
}

for (const viewport of viewports) {
  for (const theme of themes) {
    const context = await browser.newContext({
      viewport: viewport === 'mobile' ? { width: 390, height: 844 } : { width: 1440, height: 900 },
      deviceScaleFactor: 1,
      colorScheme: theme,
      isMobile: viewport === 'mobile',
      hasTouch: viewport === 'mobile',
    });
    await context.addInitScript((t) => {
      try {
        localStorage.setItem('localkit:theme', t);
      } catch {
        // sandboxed frames have no storage
      }
    }, theme);
    const queue = [...selected];
    await Promise.all(
      Array.from({ length: concurrency }, async () => {
        while (queue.length) await auditOne(context, queue.shift(), theme, viewport);
      }),
    );
    await context.close();
  }
}
await browser.close();
console.log('\n');

const failing = results.filter((r) => r.problems.length);
const byRoute = new Map();
for (const r of failing) {
  const list = byRoute.get(r.route) ?? [];
  list.push(r);
  byRoute.set(r.route, list);
}
for (const [route, list] of byRoute) {
  console.log(`✗ /tools/${route}`);
  const seen = new Set();
  for (const r of list) {
    for (const p of r.problems) {
      const key = p;
      if (seen.has(key)) continue;
      seen.add(key);
      const where = list.filter((x) => x.problems.includes(p)).map((x) => `${x.theme}/${x.viewport}`);
      console.log(`    [${where.join(' ')}] ${p}`);
    }
  }
}
const slow = results.filter((r) => r.ms > 8000).map((r) => `${r.route} ${r.ms}ms`);
if (slow.length) console.log(`\nSlow (>8s): ${[...new Set(slow)].slice(0, 20).join(', ')}`);
console.log(`\n${results.length - failing.length}/${results.length} page loads clean; ${byRoute.size} tools with problems.`);
if (args.json) writeFileSync(args.json, JSON.stringify(results, null, 2));
