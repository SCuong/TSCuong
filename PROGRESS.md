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

## In progress (session 4 lead; resumed 19:13 after the second usage-limit stop)
Committed since 14:11 (all verified: tsc, eslint, vitest, audit crawler with --axe in both themes/viewports):
  - Groups: JSON Schema + JSON to Types (a5cfafd), data converters 8 tools (81b529d), date/time 7 tools (e57ae25)
  - Infra: offline engines + versioned /pdfjs /ocr + lazy workers, precache 6.3->3.9 MB (3995423); PWA E2E;
    remote-image blocking in Markdown previews (0fb441a); WCAG AA tokens + check:contrast (e9ec5eb, 5b2d70a);
    palette quick actions (4a4db6d); EditorPanel extensions/onReady, CodePanel removed (a1b9041);
    catalog generator npm run docs:tools (93e8005); docs ARCHITECTURE/TESTING
Background agents (they own these files; do NOT start duplicates; resume with SendMessage):
  - audit-data: src/tools/data/**, json/**, e2e/audit-data.spec.ts
  - audit-workspaces-a: src/tools/notes/**, diagrams/**, snippets/**, e2e/audit-workspaces-a.spec.ts
  - audit-workspaces-b: src/tools/sqlite/**, filesearch/**, api/**, companion/**, e2e/audit-workspaces-b.spec.ts
  - audit-utilities: src/tools/math/**, network/**, generators/**, files/**, e2e/audit-utilities.spec.ts
Done in session 4 (Sep 30 morning): text/encoding audit (8b81f11), image/QR audit 27 fixes (f9d3231),
Trojan-source guard check:invisible (31306d3), shared error/large-output/ToolBar fixes (e3149eb).
Done: web/color audit (7ab4415), drop guard + remote-content hardening (059b6f8).
Still to launch: audit security+git+datetime (security.ts, git.ts, datetime.ts).
Held uncommitted by the lead until security is verified: docs/PRIVACY.md, docs/BROWSER_SUPPORT.md, docs/TOOLS.md.
Briefs: scratchpad agent-brief.md (builders), audit-brief.md (auditors).

## Remaining
- Review + commit each agent group (tsc/eslint/vitest/audit crawler --axe/screenshots).
- Audit wave 2: web+color, data+json, math/network/generators/files, workspaces (6 apps), security+git+datetime.
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
