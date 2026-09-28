/// <reference types="vitest/config" />
import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

/**
 * Libraries that are large enough that we do not want them in the service
 * worker precache. Chunks containing them are emitted under `assets/lazy/`
 * and cached at runtime the first time a tool actually needs them.
 */
const HEAVY_MODULES = [
  'mermaid',
  '@mermaid-js',
  'cytoscape',
  'katex',
  'dagre',
  'langium',
  'chevrotain',
  'd3-',
  'pdfjs-dist',
  'pdf-lib',
  'tesseract',
  'sql.js',
  'prettier',
  'terser',
  'svgo',
  'csso',
  'xlsx',
  '@zxcvbn-ts',
  'zxing-wasm',
  '@jsquash',
  '@peculiar',
  'asn1js',
  'mime-db',
  'sql-formatter',
  'upng-js',
  'pako',
];

function isHeavyChunk(moduleIds: string[]): boolean {
  return moduleIds.some((id) => {
    const normalized = id.replace(/\\/g, '/');
    const idx = normalized.lastIndexOf('/node_modules/');
    if (idx === -1) return false;
    const pkgPath = normalized.slice(idx + '/node_modules/'.length);
    return HEAVY_MODULES.some((name) => pkgPath.startsWith(name));
  });
}

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: ['favicon.svg', 'favicon.ico', 'apple-touch-icon.png'],
      manifest: {
        name: 'LocalKit — Local-first toolbox',
        short_name: 'LocalKit',
        description:
          'Developer, document, image and data tools that run entirely on your device. No uploads, no accounts.',
        theme_color: '#0b0e14',
        background_color: '#0b0e14',
        display: 'standalone',
        start_url: '/',
        scope: '/',
        categories: ['developer', 'productivity', 'utilities'],
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
        globIgnores: ['assets/lazy/**', 'ocr/**'],
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
        navigateFallback: '/index.html',
        cleanupOutdatedCaches: true,
        runtimeCaching: [
          {
            // Heavy engines (PDF, OCR, SQLite, Mermaid, ...) are cached the first
            // time a tool loads them, so they keep working offline afterwards.
            // Only same-origin, content-hashed build assets match this rule, so
            // requests made by the API client are never cached.
            urlPattern: ({ url, sameOrigin }) =>
              sameOrigin && (url.pathname.startsWith('/assets/lazy/') || url.pathname.startsWith('/ocr/')),
            handler: 'CacheFirst',
            options: {
              cacheName: 'localkit-engines',
              expiration: { maxEntries: 300, maxAgeSeconds: 60 * 60 * 24 * 120 },
              cacheableResponse: { statuses: [200] },
            },
          },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  worker: {
    format: 'es',
  },
  optimizeDeps: {
    exclude: ['@jsquash/avif', 'zxing-wasm', 'sql.js'],
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1500,
    rolldownOptions: {
      output: {
        chunkFileNames: (chunk) =>
          isHeavyChunk(chunk.moduleIds) ? 'assets/lazy/[name]-[hash].js' : 'assets/[name]-[hash].js',
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: false,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    css: false,
    restoreMocks: true,
  },
});
