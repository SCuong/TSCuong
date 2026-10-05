# PDF product acceptance — 2026-10-05

Phases 2–4 extend approved Phase 1 commit `38dc6465c50da5ef3a09dc875ae0e3afaa70f8ca` on `codex/mobile-pdf-reader`. The implementation milestone is `4415d8e15bd6479b65c69ff3a342362e8dd7b563`; the final follow-up fixes exported note proportions and records acceptance here. No merge to `main`, backend, cloud document processing or native packaging is included.

## Final checks

Run from the isolated feature checkout:

```powershell
npm run check
$env:E2E_BROWSER_CHANNEL = 'chrome'
$env:E2E_PORT = '4318'
npm run test:e2e -- --workers=2
```

- Strict TypeScript application/config checks passed.
- ESLint passed with zero warnings.
- Design-token contrast checks passed WCAG AA; invisible/bidi source checks passed.
- All 213 unit/component test files passed: **3,877 tests**.
- All **156 production desktop/mobile Playwright tests** passed in installed Chrome with Pixel 7 and desktop profiles.
- Production build and generated service worker succeeded. The PDF editing worker and pinned QPDF AES-256 engine are available offline; the English OCR pack is prepared explicitly.

## Browser, UI and exported-file evidence

- Actual Chrome viewport screenshots inspected for reader, toolkit, annotations, filled forms and Vietnamese metadata. Checked small phones (320/360/412 pixels), landscape, tablet and desktop. Serious/critical Axe violations were zero on the tested PDF workspaces.
- Chrome DevTools Protocol touch emulation exercised pinch zoom, freehand drawing and organizer dragging. Accessible move controls were also exercised, and exported page order was read back.
- Real exports were reopened/inspected for toolkit operations, Unicode native PDF comments, annotation artwork, editable AcroForm values and AES-256 password changes. Note image proportions have an export regression assertion; the exported Unicode note was also visually inspected in the reader without a local draft overlay.
- Large-document tests verified nearby-page rendering and bounded raster output rather than unbounded canvas allocation.
- English/Vietnamese switching retained the open source and updated page controls, metadata and validation messages on a small phone.
- Existing desktop LocalKit tests passed, including original PDF tools and unrelated toolbox functionality.

## Offline acceptance

Production service-worker tests use a fresh browser context and explicit network disconnection:

- First-ever local PDF opens offline, persists and reopens after reload.
- First-ever page organization and AES-256 protection work offline after app preparation.
- A prepared OCR pack recognizes a local image offline and exports a searchable scanned PDF with selectable recognized text after reload.
- Installed-app Share Target POST is intercepted locally and its temporary staging copy is removed.
- An incomplete/cancelled OCR pack never reports ready.

## Delivery and preservation

Build before pushing each stable milestone to `origin/codex/mobile-pdf-reader`. The feature worktree is isolated at `C:\Users\scuong\.codex\worktrees\mobile-pdf-reader\TSCuong`; the original `A:\TSCuong` status and binary diff are compared against their pre-work snapshots. Final handoff verifies a clean feature checkout and equality between local HEAD and the remote branch.

Cloudflare Pages is connected by the user to this branch. Git push success confirms repository delivery; it does not by itself establish the Pages deployment status. Phone installation uses that deployment's HTTPS hostname and `/read`.

## Practical limits and operating instructions

See [the complete PDF guide](MOBILE-PDF-READER.md) for run commands, Android installation, offline OCR preparation, original/draft/export behavior and storage management. Genuine browser/product limits include browser-controlled install/share/storage persistence, device memory limits, English-only bundled OCR, visual rather than certified signatures, unsupported XFA/JavaScript-driven form behavior, flattened exported drawing marks and WinAnsi-only built-in watermark/page-number text fonts. Unicode notes and PNG watermarks provide local alternatives.

Keep PWA delivery as the primary target. Consider Capacitor only when a specific native requirement warrants it.
