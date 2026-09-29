# Testing

| Layer | Tool | Where | Command |
| --- | --- | --- | --- |
| Types | TypeScript 6 (strict) | whole project | `npm run typecheck` |
| Lint | ESLint 10 + typescript-eslint + react-hooks | whole project, zero warnings | `npm run lint` |
| Design tokens | `scripts/check-contrast.mjs` | every text token × surface/tint, both themes | `npm run check:contrast` |
| Unit / component | Vitest 5 + jsdom + Testing Library | `src/**/*.test.ts(x)` next to the code | `npm test` |
| End-to-end | Playwright (Chromium) | `e2e/*.spec.ts` | `npm run test:e2e` |
| Everything | | | `npm run check` (typecheck, lint, contrast, unit tests, build) |

First-time setup for E2E: `npx playwright install chromium`.

## Unit tests

Pure logic lives in `src/tools/<category>/lib/*.ts` with a `*.test.ts` beside it: converters, parsers, encoders,
calculators, generators, search, storage, and so on. They cover normal cases, edge cases (empty, invalid, Unicode,
emoji, very long input, boundary values) and regressions for fixed bugs.

Registry-level guarantees:

- `src/tools/registry/registry.test.ts`: unique ids, names and routes; valid redirect aliases; known categories;
  searchable metadata; every `load()` points at an existing module with a default export; no heavy engine imported by a
  registry file; palette suggestions reference real tools.
- `src/lib/search.registry.test.ts`: the top search result for the queries people actually type ("format json",
  "jpg to webp", "compress picture", "remove pdf page", "compare files", "decode jwt", …), typo tolerance, and that
  every tool is found by its own name.

## End-to-end tests

`npm run test:e2e` builds the production bundle and serves it with `vite preview` on port **4317** (deliberately not
Vite's default 4173, which other local projects often use). The `consoleErrors` fixture (`e2e/fixtures.ts`) fails any
test that logs a console error or throws.

| Spec | Covers |
| --- | --- |
| `shell.spec.ts` | home, search, Ctrl+K palette (keyboard-only, Escape/focus return, quick actions), themes without flash, system theme, favorites/pins/recents persistence, redirects, not-found, backup export |
| `mobile.spec.ts` | 390 px: no horizontal overflow on core pages, tool usage, header search, navigation drawer |
| `tools.spec.ts` | JSON formatter, Base64, regex, text tools, PDF merge (page count of the download) and corrupt PDFs, PNG → WebP (dimensions of the download), Mermaid rendering and syntax errors, SQLite read-only enforcement and bad files, Markdown notes persistence, remote-image blocking, tool-state persistence |
| `api-client.spec.ts` | success/404 responses, cURL paste and typed import, honest CORS and unreachable-server errors, credentials never stored in history (asserted in IndexedDB) — against local echo servers |
| `pwa.spec.ts` | manifest and icons, offline app shell, Mermaid / SQLite (WASM) / pdf-lib working offline after first use (production build only) |
| `audit-*.spec.ts` | per-category regression tests added by the audit passes |

Fast iteration against a running dev server: `E2E_DEV=1 npx playwright test e2e/tools.spec.ts --workers=2`
(the PWA spec skips itself in dev mode).

## Audit helpers

- `node scripts/audit-tools.mjs [--axe] [--files=pdf.ts] [--themes=dark,light] [--viewports=desktop,mobile]` opens
  every registered tool and reports crashes, console errors, horizontal overflow, placeholder text and, with `--axe`,
  WCAG 2.1 A/AA violations. It expects the dev server on http://localhost:5173.
- `node scripts/shot.mjs <dir> "/tools/<route>" [--mobile] [--theme=both]` captures screenshots for visual review.
- `node scripts/analyze-bundle.mjs dist-analyze [chunk]` attributes chunk bytes to packages
  (build first with `npx vite build --sourcemap=hidden --outDir dist-analyze`).
