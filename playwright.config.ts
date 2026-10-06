import { defineConfig, devices } from '@playwright/test';

/** E2E_DEV=1 runs against an already running dev server (fast iteration); default is the production preview. */
const DEV = Boolean(process.env.E2E_DEV);
const PORT = Number(process.env.E2E_PORT ?? (DEV ? 5173 : 4317));
const TOOLBOX_PORT = Number(process.env.E2E_TOOLBOX_PORT ?? PORT + 1);

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : 4,
  reporter: [['list'], ['html', { open: 'never' }]],
  timeout: 45_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: `http://localhost:${PORT}`,
    // Optional installed Chrome uses the same device emulation and native CDP touch tests.
    channel: process.env.E2E_BROWSER_CHANNEL || undefined,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1360, height: 900 }, baseURL: `http://localhost:${TOOLBOX_PORT}` }, testIgnore: /mobile\.spec\.ts|standalone\.spec\.ts/ },
    { name: 'mobile', use: { ...devices['Pixel 7'] }, testMatch: /mobile\.spec\.ts/, testIgnore: /[\\/]mobile\.spec\.ts$/ },
    { name: 'toolbox-mobile', use: { ...devices['Pixel 7'], baseURL: `http://localhost:${TOOLBOX_PORT}` }, testMatch: /[\\/]mobile\.spec\.ts$/ },
    { name: 'pdf-desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1360, height: 900 } }, testMatch: /standalone\.spec\.ts/ },
  ],
  webServer: DEV
    ? undefined
    : [{
        command: `npm run build && npx vite preview --port ${PORT} --strictPort`,
        port: PORT,
        reuseExistingServer: !process.env.CI,
        timeout: 300_000,
      }, {
        command: `npx vite build --outDir dist-toolbox && npx vite preview --outDir dist-toolbox --port ${TOOLBOX_PORT} --strictPort`,
        env: { VITE_APP_MODE: 'toolbox' },
        port: TOOLBOX_PORT,
        reuseExistingServer: !process.env.CI,
        timeout: 300_000,
      }],
});
