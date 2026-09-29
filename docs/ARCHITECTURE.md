# Architecture

LocalKit is a static, client-side React application. There is no backend: every tool runs in the browser, and the
only optional server component is the loopback-only [companion](../companion/README.md) used by the API client.

## Layers

```
index.html             pre-paint theme script (no light/dark flash), root element
src/main.tsx           fonts, global CSS, theme bootstrap, <App/>
src/app/               router, shell layout, sidebar, command palette, pages, update prompt
src/components/        shared UI primitives (ui/), CodeMirror wrapper (editor/), tool layout helpers (tool/)
src/lib/               search, theme, persistence, backup, hooks, utilities, remote-content blocking
src/tools/types.ts     ToolDefinition — the registry contract
src/tools/registry/    one metadata file per category + index.ts (aggregation, routing, search)
src/tools/<category>/  tool components (default export) + lib/ (pure, unit-tested logic) + workers
```

## Tool registry

Every tool is a `ToolDefinition` (`src/tools/types.ts`): stable `id`, `name`, one-sentence `description`, `category`,
`icon`, `route` (path below `/tools/`), `keywords`, `aliases`, `load: () => import('…')`, optional `network`,
`networkNote`, `requires`, `layout`, `priority` (search tie-breaker for a family's flagship tool) and `redirectFrom`
(alias paths that redirect to the canonical route).

Only metadata lives in the registry, so the home page, sidebar, all-tools page, category pages, command palette,
privacy page and search are generated from it without loading any tool code. `src/tools/registry/registry.test.ts`
enforces unique ids, names and routes, valid redirects, known categories, searchable metadata, existing lazy modules
with default exports, and that registry files never import heavy engines. See [TOOL_AUTHORING.md](TOOL_AUTHORING.md).

## Routing

React Router data routes (`src/app/App.tsx`), each page lazily loaded. `/tools/*` resolves a tool by route (or
`redirectFrom` alias, answered with a replace navigation) and renders it inside:

- an error boundary that distinguishes failed chunk loads (offer reload) from runtime errors (offer retry),
- a `Suspense` fallback while the tool chunk loads,
- a browser-capability gate for hard requirements (Web Crypto, WebAssembly).

## Search

`src/lib/search.ts` is a deterministic scored scan over the registry (sub-millisecond for a few hundred tools):
AND semantics with one tolerated miss for long natural-language queries; exact, prefix, substring, plural-folded,
synonym and typo matches (Damerau distance) weighted by field (name > alias > keyword > category > description);
phrase and word-order bonuses ("csv json" prefers CSV → JSON); and a small `priority` prior that only breaks ties.
`src/lib/search.registry.test.ts` asserts the top result for real queries against the real registry.

## Persistence

| Data | Where | Notes |
| --- | --- | --- |
| Theme | `localStorage` (`localkit:theme`, raw) | Read by the pre-paint script in `index.html`. |
| Favorites, pins, recents, usage, searches, settings | Versioned `localStorage` stores (`createPersistentStore`) | Validation + migrations; cross-tab sync via `storage` events. |
| Small per-tool inputs and options | `useToolState` | Debounced, flushed on unmount/pagehide, size-capped, can be disabled in Settings. |
| Notes, snippets, diagrams, API collections/environments/history, file indexes | IndexedDB (`src/lib/storage/db.ts`) | Ordered schema migrations, BroadcastChannel change notifications, in-memory fallback with a visible warning. |

Settings → Backup exports/imports everything except file-search indexes (they hold file handles).

## Heavy work and engines

Large dependencies (pdf.js, pdf-lib, Tesseract, sql.js, Mermaid, Prettier, Terser, SVGO, SheetJS, zxing, hash-wasm,
jose, zxcvbn, …) are only imported by tool modules or workers, never by the shell. CPU-heavy operations run in Web
Workers (PDF operations, SQLite, CSV parsing, spreadsheets, image batches, hashing, bcrypt, regex matching, diffs,
file indexing, JSON Schema validation, type generation) with progress, cancellation and cleanup on unmount.

Engine files that are fetched by URL at runtime (pdf.js fonts/CMaps/WASM decoders, Tesseract worker/core/language
data) are copied from `node_modules` by `scripts/copy-engine-assets.mjs` into versioned folders
(`/pdfjs/<version>/`, `/ocr/<versions>/`, see `scripts/engine-assets.mjs`), so their URLs are immutable.

## Build, bundles and offline

- `vite.config.ts` routes chunks and workers that contain heavy engines to `assets/lazy/`.
- The service worker (vite-plugin-pwa / Workbox, `registerType: 'prompt'`) precaches the shell and every light
  chunk (~3.9 MB) and runtime-caches everything else under `/assets/`, `/pdfjs/` and `/ocr/` cache-first on first use.
  Those URLs are content-hashed or versioned, so cache-first is always safe. API-client traffic is never cached.
- `scripts/analyze-bundle.mjs` attributes the bytes of any chunk to source packages using source maps.
- `e2e/pwa.spec.ts` verifies the manifest, the offline shell, and that Mermaid, SQLite and pdf-lib keep working
  offline after their first use.

## Security and privacy boundaries

- User-provided HTML is sanitized with DOMPurify; Markdown previews additionally block remote images and media until
  the user explicitly loads them (`src/lib/remoteContent.ts`).
- Untrusted HTML/JS previews run in `sandbox` iframes without `allow-same-origin` (opaque origin, no access to app storage).
- No `eval`/`new Function` on user input (the JSON Schema engine was chosen because it does not compile schemas to code).
- Secrets (JWTs, passwords, keys, API credentials) are never persisted by default; the API client strips credentials
  from history.
- The optional companion binds to 127.0.0.1, requires a random token, allowlists loopback origins and checks the Host
  header (DNS-rebinding protection).
