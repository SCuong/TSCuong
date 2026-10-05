/// <reference types="vitest/config" />
import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import { engineAssetDirs } from './scripts/engine-assets.mjs';

const engineDirs = engineAssetDirs();

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
  'hash-wasm',
  'exifr',
  'jsbarcode',
  'jose',
  // Editor grammars for less common languages; the editor falls back to plain text offline.
  '@lezer/cpp',
  '@lezer/php',
  '@lezer/rust',
  '@lezer/java',
  '@lezer/go',
  '@lezer/python',
  '@codemirror/lang-cpp',
  '@codemirror/lang-php',
  '@codemirror/lang-rust',
  '@codemirror/lang-java',
  '@codemirror/lang-go',
  '@codemirror/lang-python',
  '@codemirror/legacy-modes',
];

const lazyName = (moduleIds: string[], fallback: string) =>
  isHeavyChunk(moduleIds) ? fallback.replace(/^assets\//, 'assets/lazy/') : fallback;

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
      includeAssets: ['favicon.svg', 'favicon.ico', 'apple-touch-icon.png', 'reader-share.js'],
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
        shortcuts: [{ name: 'PDF Reader', short_name: 'Reader', url: '/read', icons: [{ src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' }] }],
        share_target: {
          action: '/read/share',
          method: 'POST',
          enctype: 'multipart/form-data',
          params: { files: [{ name: 'pdf', accept: ['application/pdf', '.pdf'] }] },
        },
        categories: ['developer', 'productivity', 'utilities'],
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,mjs,css,html,svg,png,ico,woff2}', 'pdfjs/**/*.{bcmap,wasm,pfb,ttf}'],
        globIgnores: ['assets/lazy/**', 'ocr/**'],
        importScripts: ['/reader-share.js'],
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
        navigateFallback: '/index.html',
        cleanupOutdatedCaches: true,
        runtimeCaching: [
          {
            // Heavy engines (PDF, OCR, SQLite, Mermaid, WASM decoders, ...) are cached
            // the first time a tool loads them, so they keep working offline afterwards.
            // Only same-origin, immutable URLs match: everything under /assets/ is
            // content-hashed (lazy chunks, workers, .wasm, .mjs) and the engine folders
            // are versioned. Requests made by the API client are never cached.
            // NOTE: this function is serialized into sw.js, so it must not reference
            // anything outside its own body.
            urlPattern: ({ url, sameOrigin }) =>
              sameOrigin &&
              (url.pathname.startsWith('/assets/') ||
                url.pathname.startsWith('/ocr/') ||
                url.pathname.startsWith('/pdfjs/')),
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
    // Linked dependencies in isolated worktrees must keep their local asset URLs.
    preserveSymlinks: true,
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  define: {
    __PDFJS_ASSET_DIR__: JSON.stringify(engineDirs.pdfjs),
    __OCR_ASSET_DIR__: JSON.stringify(engineDirs.ocr),
  },
  worker: {
    format: 'es',
    // Workers that bundle heavy engines (pdf-lib, SheetJS, hash-wasm, ...) are cached on first use, not precached.
    rolldownOptions: {
      output: {
        entryFileNames: (chunk) => lazyName(chunk.moduleIds, 'assets/[name]-[hash].js'),
        chunkFileNames: (chunk) => lazyName(chunk.moduleIds, 'assets/[name]-[hash].js'),
      },
    },
  },
  optimizeDeps: {
    exclude: ['@jsquash/avif', 'zxing-wasm', 'sql.js'],
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1500,
    rolldownOptions: {
      output: {
        chunkFileNames: (chunk) => lazyName(chunk.moduleIds, 'assets/[name]-[hash].js'),
      },
    },
  },
  test: {
    // Bound jsdom/PDF concurrency on development machines and CI.
    maxWorkers: 4,
    environment: 'jsdom',
    globals: false,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    css: false,
    restoreMocks: true,
  },
});
