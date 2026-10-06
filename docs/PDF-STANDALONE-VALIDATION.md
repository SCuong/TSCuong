# Standalone PDF app acceptance — 2026-10-06

This redesign builds on the completed PDF product at `c03bf8a598d2c546198f52ddbd529a209eb4819c` on `codex/mobile-pdf-reader`. The default build opens LocalKit PDF at the domain root; shared toolbox code is preserved in an explicit `VITE_APP_MODE=toolbox` build. The original Phase 2–4 acceptance record remains in [PDF-VALIDATION.md](PDF-VALIDATION.md).

## Product and browser review

- One fixed Overview / Library / Tools / Settings navigation, with safe-area padding and active states. No LocalKit back link, hero, duplicate tabs or technical Home status.
- Routine offline-ready success toasts are disabled in the PDF shell; readiness remains visible in Settings and new-version prompts remain active. The shared toolbox keeps its existing announcements.
- Populated Overview shows compact utility shortcuts and actual recently added files with locally rendered first-page previews. Library includes search, favorite/availability filters, sorting and file action sheets.
- Installed Chrome screenshots reviewed at 320, 360, 390 and 412 pixels, landscape and tablet. English/Vietnamese and light/dark appearance reviewed. The first file appears near the top; no horizontal overflow was observed.
- Final Settings storage bar measures 6 pixels; the file sheet close button measures 44 by 44 pixels after its opening animation. The regression assertion awaits animation completion rather than measuring its temporary scale transform.
- Reader navigation is hidden while reading. Native Chrome DevTools Protocol touch scrolling hides reader chrome; controls can be restored. Existing touch pinch, drawing and organizer drag checks remain in the suite.

## File persistence and cleanup

- IndexedDB version-three upgrades preserve prior metadata, positions, bookmarks and editing drafts. OPFS PDF copies remain readable.
- Previews are cached JPEG blobs, generated through the existing PDF renderer one at a time, bounded to 43,200 pixels and 240 pixels per side. Visible/nearby rows request them lazily; object URLs are revoked on unmount.
- Reloading offline uses cached previews without starting a PDF rendering worker. Removal deletes PDF copies, metadata, editing drafts and previews. Cache clearing retains favorite files/previews and keeps reading positions.
- Rapid import/back/import navigation can destroy a borrowed reader worker while a preview is queued. The renderer recovers using an owned cached PDF and releases its canvas/document. A focused unit regression and real multi-import/cache-cleanup e2e cover this lifecycle.
- Background preview generation never requests passwords and avoids copying PDFs larger than 64 MiB into memory. Such files can gain a preview when opened in the reader.

## Reproduce validation

`npm run check` passed strict TypeScript, zero-warning ESLint, WCAG AA token contrast, invisible/bidi source checks, **215 unit/component files with 3,886 passing tests**, and the production build. The generated PDF service worker precaches 294 entries (8,372.36 KiB), including the local PDF editing/password engines; OCR retains its explicit preparation workflow.

All **172 production Playwright tests passed** in installed Chrome across the four projects (4.3 minutes, no retries). Tested PDF app screens had zero serious/critical Axe violations. Offline first-use reading/editing/password protection, prepared OCR, persistent previews, Share Target cleanup and original desktop/mobile toolbox regressions passed in the same final run.

Run in `C:\Users\scuong\.codex\worktrees\mobile-pdf-reader\TSCuong`:

```powershell
npm run check
$env:E2E_BROWSER_CHANNEL = 'chrome'
$env:E2E_PORT = '4318'
npm run test:e2e -- --workers=2
```

Playwright serves production PDF and toolbox builds on adjacent ports. Its four projects cover PDF mobile/desktop and the original toolbox mobile/desktop. Acceptance includes root/unrelated-route redirects, refresh/deep links, navigation, real PDF imports/exports, annotations/forms/passwords, accessibility, first-use offline engines, prepared offline OCR and Share Target staging cleanup.

## Delivery boundaries

Only the isolated feature checkout is changed; the original `A:\TSCuong` status and binary diff are compared with their preserved snapshots. Delivery stays on `codex/mobile-pdf-reader`, with no merge to `main` or native packaging.

The user-connected Cloudflare Pages deployment builds pushed commits with `npm run build`, output `dist`, Node 20+. Repository push success is distinct from verifying a finished Pages deployment. See [MOBILE-PDF-READER.md](MOBILE-PDF-READER.md) for exact run/install instructions and browser storage, share, OCR and PDF-format limitations.
