/* global document, window -- used inside page.evaluate callbacks, which run in the browser */
// Dev helper: screenshot pages in both themes and report console errors.
// Usage: node scripts/shot.mjs <outDir> <path>[,<path>...] [--mobile] [--theme=dark|light|both] [--base=http://localhost:5173]
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const [outDir, pathsArg = '/', ...flags] = process.argv.slice(2);
const mobile = flags.includes('--mobile');
const themeFlag = (flags.find((f) => f.startsWith('--theme=')) ?? '--theme=both').split('=')[1];
const base = (flags.find((f) => f.startsWith('--base=')) ?? '--base=http://localhost:5173').split('=')[1];
const full = flags.includes('--full');
const themes = themeFlag === 'both' ? ['dark', 'light'] : [themeFlag];
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch();
for (const theme of themes) {
  const context = await browser.newContext({
    viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    colorScheme: theme,
    isMobile: mobile,
    hasTouch: mobile,
  });
  await context.addInitScript((t) => localStorage.setItem('localkit:theme', t), theme);
  const page = await context.newPage();
  const errors = [];
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') errors.push(`${m.type()}: ${m.text()}`);
  });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  for (const path of pathsArg.split(',')) {
    await page.goto(base + path, { waitUntil: 'networkidle' });
    await page.waitForTimeout(600);
    const name = `${path.replace(/[^a-z0-9]+/gi, '_') || 'home'}-${theme}${mobile ? '-m' : ''}.png`;
    await page.screenshot({ path: join(outDir, name), fullPage: full });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    console.log(`${name}${overflow > 0 ? ` HORIZONTAL OVERFLOW ${overflow}px` : ''}`);
  }
  if (errors.length) console.log(`[${theme}] console:\n  ` + [...new Set(errors)].join('\n  '));
  await context.close();
}
await browser.close();
