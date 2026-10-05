# LocalKit

A local-first toolbox of developer, document, media and data utilities that run entirely in your browser.
Open it, search for what you need (`Ctrl/⌘ K`), use the tool. Files never leave your device. There is no account and no backend, and it works offline once cached.

## Highlights

- **100+ tools** across PDF, images, JSON, text, encoding, data formats, web development, color, security/crypto,
  generators, date/time, networking, Git, QR/barcodes, math and files.
- **Workspaces**: Markdown notes, snippet manager, Mermaid diagram studio, SQLite studio, API client, local file search.
- **Universal search** with fuzzy matching, synonyms and natural phrases ("compress picture", "jpg to webp", "decode jwt"),
  plus a keyboard-first command palette.
- **Favorites, pins, recent tools, usage history, recent searches**, all stored locally, with backup/restore.
- **Dark, light and system themes** with no flash on startup.
- **Mobile PDF application** at `/read`: continuous reading, touch zoom, search, bookmarks and saved positions;
  a mobile toolkit for arranging, converting, cropping, compressing and exporting; persistent annotations,
  visual signatures, form filling and AES-256 password tools. English/Vietnamese UI and local device storage.
- **Installable PWA** with offline support. PDF reading, editing and password engines are precached for first use.
  English OCR has an explicit offline preparation workflow. Other heavy engines (SQLite WASM, Mermaid)
  are lazy-loaded and cached the first time you use them.

## Development

Requires Node 20+.

```sh
npm install
npm run dev          # http://localhost:5173
npm run build        # production build (dist/)
npm run preview      # serve the production build on :4317
npm run check        # typecheck + lint + unit tests + build
```

### Testing

```sh
npm run typecheck    # strict TypeScript
npm run lint         # ESLint (zero warnings)
npm test             # Vitest unit/component tests
npm run test:e2e     # Playwright E2E (builds and serves the production bundle)
E2E_DEV=1 npx playwright test   # E2E against a running dev server
```

On first use, install Playwright's browser with `npx playwright install chromium`.

See [the mobile reader guide](docs/MOBILE-PDF-READER.md) for Chrome DevTools device-emulation review and the
installed-Chrome e2e command, complete PDF workflows and HTTPS PWA installation. Validation requires no physical phone or ADB.

## Architecture

```
src/
  app/            shell: router, layout, sidebar, command palette, pages (home, all tools, category, tool, settings…)
  components/     shared UI primitives (ui/), CodeMirror editor (editor/), tool layout helpers (tool/)
  lib/            search, theme, persistence (localStorage stores + IndexedDB), backup, hooks, utils
  reader/         PDF library/reader/toolkit, annotations, forms, offline OCR, OPFS and editing drafts
  tools/
    types.ts      ToolDefinition — the registry contract
    categories.ts category metadata
    registry/     one metadata file per category; index.ts aggregates, searches and resolves routes
    <category>/   tool implementations (default-exported React components) + lib/ pure logic with tests
companion/        optional local proxy for the API client (see companion/README.md)
e2e/              Playwright specs
docs/             authoring guide
```

- **Tool registry.** Every tool is a `ToolDefinition` (id, name, description, category, icon, route, keywords, aliases,
  `load: () => import(...)`, network use, browser requirements, layout). The home page, category pages, sidebar,
  command palette, search and privacy page are all generated from the registry. Only metadata is in the main
  bundle; tool code loads on demand, and each tool is its own chunk. See [docs/TOOL_AUTHORING.md](docs/TOOL_AUTHORING.md) for
  how to add a tool.
- **Routing.** `/tools/<route>` (e.g. `/tools/json-formatter`, `/tools/pdf/merge`, `/tools/image/compress`,
  `/tools/sqlite`, `/tools/mermaid`). Routes are stable, because favorites and history reference tool ids.
- **Search** (`src/lib/search.ts`) is a deterministic scored scan with AND semantics, prefix/substring/typo matching,
  a synonym table and phrase/order bonuses. It is unit-tested against realistic queries.
- **Persistence.** Small state (theme, favorites, pins, recents, settings) lives in versioned localStorage stores with
  validation and migrations. Documents (notes, snippets, diagrams, API collections, file indexes) live in IndexedDB, and schema
  changes are expressed as ordered migrations. There is an in-memory fallback with a visible warning when IndexedDB is unavailable.
- **Heavy work** runs in Web Workers (PDF operations, SQLite, image batches, file indexing, OCR) with progress and
  cancellation.

## Privacy model

- Processing happens in the browser. Opened files are never uploaded.
- There are no analytics, trackers, accounts or remote logging.
- Tools that can touch the network are marked in the UI and listed on the in-app Privacy page. The API client
  sends requests only when you click Send, only to the URL you entered, either directly or through the optional
  local companion that you start yourself.
- The API client never stores authorization headers or auth settings in history. Saving a request with credentials
  shows a warning first.
- The service worker precaches the app shell and caches lazily loaded engine chunks. It never caches API-client traffic.

## Browser support and limitations

Current Chromium browsers are the primary target, and Firefox and Safari are supported with graceful fallbacks:

| Feature | Notes |
| --- | --- |
| Local File Search, repository inspector | Folder access uses the File System Access API (Chromium). Other browsers use a folder `<input>`, which works but cannot re-scan without re-selecting. |
| AVIF encoding | Uses the browser encoder when available and falls back to a WebAssembly encoder otherwise. |
| Camera QR scanning | Requires camera permission and a secure context (HTTPS or localhost). |
| API client | Browsers enforce CORS and forbid some headers. The UI explains CORS failures honestly, and the optional local companion removes this restriction. |
| OCR | English language data is bundled and served locally. |
| Eye dropper | The EyeDropper API is Chromium-only. The color tools fall back to a color input. |

## Optional local companion

`npm run companion` starts a small dependency-free Node proxy on `127.0.0.1` that the API client can use to bypass
browser CORS restrictions. It is token-protected and loopback-only. The rest of the app never needs it. See
`companion/README.md`.
