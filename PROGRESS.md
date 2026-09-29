# LocalKit — Progress Log

## Original goal
Build **LocalKit**, a polished, production-quality, local-first web toolbox (React + TypeScript + Vite, no Electron, no paid APIs) with 100+ genuinely working tools: PDF studio, image studio, JSON/text/encoding/data/web/color/security/generator/date/network/Git/QR/math/file utilities, plus workspaces (Markdown notes, snippets, Mermaid diagrams, SQLite viewer, API client, local file search). Universal fuzzy search + Ctrl/Cmd+K palette, favorites/pins/recents persisted locally, dark/light/system themes without flash, PWA/offline, lazy-loaded heavy engines, strict TS, Vitest + Playwright tests, and multiple audit passes. No placeholders, no "coming soon", no fake controls. Full instruction: see the recovery brief (scratchpad `toolbox_brief.md`).

## Completed
- [x] Phase A: scaffold, toolchain, design tokens, theme, storage (7ee6436)
- [x] Phase B: app shell, registry, fuzzy search, command palette, home, settings/backup, UI primitives, JSON formatter, authoring guide, core unit tests, E2E shell suite, PWA icons (df80652 … 97ec0d6)
- [x] Phase C groups committed (recovery run 2026-09-29):
  - JSON tools: validator, tree viewer, diff, JSONPath (47c5b69)
  - Snippets workspace (67aaab4)
  - SQLite viewer + local file search workspaces (2659a03)
  - Security (hash, checksum, HMAC, AES, bcrypt) + generators (UUID, ULID/NanoID, lorem, random string, mock data, random picker) (4040565)

## In progress (session 4 lead, from 2026-09-29 07:11; resumed 14:11 after a usage-limit stop)
Session 3's lead and agents stopped ~06:51. Session 4 verified and committed what they left:
  - Files 8 tools (8d4f1f4), Git 6 tools (aa3335c), API client + companion (31e6c04), CSV/data 9 tools (5bfafe3)
Session 4 fixes/infra (all committed): audit crawler scripts/audit-tools.mjs (f043bed); cn() via tailwind-merge
(62f61fe); useToolState flush on unmount (bc85223); API client imports typed curl on Send (4e17769); SQLite nested
<main> -> region (4d750c2); home copy (2cf5166); E2E suites tools/api-client (6e1fda8); search plural folding +
flagship `priority` (a1029bd); `redirectFrom` route aliases (53e2ad0).

Background builder agents (resumed 14:12, own their dirs; do NOT start duplicates):
  - datetime: src/tools/datetime/**, registry/datetime.ts (timestamp, timezone, date diff/calc, duration, cron, week number)
  - security: new dirs under src/tools/security/**, append to registry/security.ts (JWT decode/verify + generate,
    password generator + strength, certificate/PEM inspector, key pair, TOTP)
  - data-convert: src/tools/data/convert/**, src/tools/data/sql/**, append to registry/data.ts (JSON<->YAML, YAML
    formatter, XML formatter, XML<->JSON, TOML<->JSON, SQL formatter/minify, JSON/CSV->SQL INSERT, list->SQL IN)
  - json-extra: src/tools/json/schema/**, src/tools/json/typegen/**, append to registry/json.ts (+ priority 3 on json-formatter)
Shared brief for agents: scratchpad agent-brief.md (copy of rules = docs/TOOL_AUTHORING.md + ownership/verification).

Uncommitted lead files waiting on agents: src/tools/registry/registry.test.ts (needs datetime tools),
src/lib/search.registry.test.ts (needs json-formatter priority), e2e/pwa.spec.ts (run against a production build).

## Remaining
- Review + commit each agent group (tsc/eslint/vitest/audit crawler/screenshots), then commit the held tests.
- Phase E-H: full suite + production build + PWA spec, bundle audit, functional audit per category, UI audit
  (both themes, desktop + 390px), adversarial QA, polish (duplicate hashing tools, `shared-a` naming, API client
  reachability diagnosis), docs pass verifying every README claim (e.g. "repository inspector" does not exist).

## Decisions
- Product name: LocalKit. Stack: React 19, React Router 8, Tailwind 4, CodeMirror 6, Vite 8.
- TypeScript pinned to 6.0.x for typescript-eslint compatibility.
- `bowser` instead of AGPL ua-parser-js v2. SheetJS from official CDN tarball. tailwind-merge for cn().
- Tool metadata separated from implementation (`load: () => import(...)`) so search never loads tool code.
- Recovery: commit groups one by one with explicit paths (shared working tree); never two leads at once —
  check `git log` times and file mtimes before acting.

## Next action
Wait for agent reports (they notify on completion); review and commit each group; then Phase E.
