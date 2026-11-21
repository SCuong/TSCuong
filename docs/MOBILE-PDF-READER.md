# LocalKit PDF application

The default build is **LocalKit PDF**, a standalone local-first browser/PWA application. Opening the domain alone enters the PDF app. `/read` remains supported; unrelated routes redirect into the app. The general toolbox shell and its tools remain shared internally, with an explicit `VITE_APP_MODE=toolbox` build for regression testing or the original product.

## App navigation and files

There is one fixed, safe-area-aware bottom navigation: **Overview, Library, Tools, Settings**. It disappears in the reader; real scrolling hides reader controls, and the page indicator or a tap restores them. Tool workspace back buttons stay within PDF tools.

- **Overview**: compact import/search app bar, Open PDF / Images → PDF / Merge / OCR shortcuts, then recently added files. No hero, promotional copy or technical cache status.
- **Library**: filename search, recently added/last opened/name/size sorting, favorites and saved/missing-file filters. Tap a file to read; use its overflow sheet to favorite or remove it.
- **Tools**: compact categorized PDF workspaces, using the existing local PDF engines.
- **Settings**: language, system/light/dark theme, reading paper, OCR preparation, storage, installation and privacy.

First-page previews are rendered locally through the existing PDF renderer and cached as bounded JPEG blobs in IndexedDB. Only visible/nearby rows request previews, with one render at a time and at most 43,200 pixels/240 pixels per side. Object URLs are revoked when rows unmount. Previews survive reload and work offline; file removal/eviction clears their previews. Favorites retain cached files/previews during cache clearing. Existing version-two libraries migrate without losing document metadata, bookmarks or editing drafts. Encrypted or very large older PDFs receive a preview when actually opened; background preview generation never asks for a password or copies files larger than 64 MiB into memory.

Routes: `/read` (Overview), `/read/library`, `/read/tools`, `/read/tools/<workspace>`, `/read/settings`, `/read/doc?id=<fingerprint>`. Deep links and refresh work with the production SPA/service worker.

## Run locally

Requires Node 20 or newer.

```sh
npm ci
npm run dev
```

Open `http://localhost:5173/`. To serve the production PWA instead:

```sh
npm run build
npm run preview
```

Open `http://localhost:4317/`. The development server intentionally has no service worker; offline testing uses the production build.

## Install and use on Android

1. In Chrome, open the **HTTPS URL where the app is deployed**. No path or toolbox selection is needed. Use the same hostname consistently: libraries belong to a browser origin.
2. Import a PDF from Files or Downloads. **Settings** shows when offline reading is ready.
3. Open Chrome's menu (⋮), choose **Add to Home screen**, then **Install** when offered.
4. Launch **LocalKit PDF** from the home screen; Overview shows your recent files immediately.
5. Share a PDF from Files to LocalKit when Chrome/Android registers the installed app as a share target. **Open PDF** works when the OS does not offer LocalKit.
6. Before going offline, open **Settings → Prepare English OCR for offline use** if you need OCR. Wait for **English OCR is ready offline**. Reading, page tools, annotation, forms and password protection are prepared with the application itself.
7. Read and edit offline. Download or share exported files to keep durable copies outside browser storage.
8. For updates, open the same site online and accept LocalKit's update prompt after exporting pending work. Refresh the offline OCR pack when a new engine/build requires it.

The app is a set of static files (build command `npm run build`, output directory `dist`, Node 20+). PDF bytes, passwords, images, form values and OCR results are processed on the device; there is no document backend.

Plain LAN HTTP (such as `http://192.168.x.x`) does not provide the secure context needed for installation, OPFS and full offline support. Use HTTPS for phone installation; localhost works for computer testing. Physical Android hardware or ADB is not an acceptance prerequisite.

## Phase 1 — Read and navigate

- Continuous vertical reading with only nearby pages rendered, selectable PDF text and full-document search.
- Pinch and double-tap zoom, horizontal panning while zoomed, fit width/page and immersive controls.
- Page jump, thumbnails, document contents and page bookmarks.
- Original, sepia and night paper; light/dark/system interface.
- Local recent PDFs, favorites, saved page/offset, fingerprint-based reopening, password prompts and English/Vietnamese UI.
- Read-only draft annotations appear when reopening the original in the reader. Original download/share explicitly exports the original bytes; use annotation export to include edits.

## Phase 2 — Mobile toolkit

Use **Tools** in bottom navigation or **View → Edit and export this PDF** while reading. The current source carries into other PDF tools; **Read source PDF** returns to it. **Read exported PDF** opens the new result as a separate document.

- Merge multiple PDFs; choose/order inputs and page ranges.
- Split into files, extract/delete selected pages, rotate, duplicate and organize pages.
- Organizer supports touch multi-selection, drag handles, accessible move buttons, undo/redo and bulk actions. Moving with buttons works without dragging.
- Images to PDF with ordering/layout settings; PDF to PNG/JPEG/WebP and multi-file ZIP download.
- Lossless compression and explicit strong rasterization, page crop with preview, text/image watermarks and page numbers.
- Metadata editing, PDF inspection, selectable text extraction and embedded image extraction.
- Native file sharing when supported, download/ZIP fallback, and immediate reading of exported PDFs.

Every export creates a new file. Originals are never silently overwritten. Cropping hides page margins; it is **not secure redaction**. Strong rasterization can remove selectable text, forms and document structure; its warning and opt-in are intentional. Lossless compression reports when it cannot reduce size. Built-in text watermark/page-number fonts use WinAnsi; use a PNG image watermark for Vietnamese/other unsupported glyphs. Unicode notes support Vietnamese directly.

## Phase 3 — Advanced editing

### Annotate and sign

Select actual PDF text, then highlight, underline or strike through it. Drawing modes also support marking scans, freehand strokes and visual signatures. Use **Select text / scroll** to navigate when a drawing mode would capture touch input; the sticky tool controls remain reachable. Annotation zoom supports fit width through 300%, with scrolling/panning inside the page. Text notes support Vietnamese/Unicode, placement on the page, editing, deletion and undo/redo. Page bookmarks integrate with the reader. Language changes inside the PDF application keep its active file and editing state.

Drafts save locally by the source PDF's SHA-256 fingerprint. Reopen the same source to continue editing. **Export annotated copy** embeds visible marks into page content and stores text notes as native PDF comments. The local source draft remains editable; exported strokes are flattened page artwork. Export does not claim cryptographic signing, redaction or a universal editable annotation interchange format. Existing digital signatures can become invalid after editing.

### Fill forms

Fill supported AcroForm text/multiline fields, checkboxes, radio groups and choice lists; read-only fields remain protected. Export preserves interactive fields and values. Values save locally as a form draft; password field values are deliberately excluded. Flat/scanned forms can use visible text notes. XFA, cryptographic signature fields, action buttons, embedded JavaScript and automatic form calculations require an appropriate desktop PDF application.

### PDF passwords

Protect a new copy with AES-256, change its open password, or export an unlocked copy using the password you know. QPDF runs in a dedicated cancellable WebAssembly worker with browser cryptographic random bytes. The result is verified locally before download. Text, images and forms are preserved; passwords are neither persisted nor logged. Use a strong unique password; there is no password recovery. Unicode passwords are limited to 127 UTF-8 bytes.

Before operations that cannot safely edit encrypted page content, unlock a copy in **PDF passwords**. Structural tools that preserve encryption verify their output. Passwords and new password fields are cleared when their workspace is closed or protection export completes. See the pinned engine, hashes, reproduction and licenses in `public/qpdf/12.4.2/PROVENANCE.md`.

### OCR

Existing on-device Tesseract OCR recognizes photos/images and scanned PDF pages. PDF OCR can create a searchable copy or export recognized text, with page scopes, DPI settings, progress/cancellation and confidence feedback. It reads existing selectable text directly when appropriate.

The bundled recognition model is **English**. The interface and Unicode notes support Vietnamese; Vietnamese OCR is not claimed. Other recognition models are not bundled. Prepare the explicit offline pack while online; its completion marker checks both language/core assets and the build's required JavaScript dependencies. An interrupted or incomplete download never reports ready.

## Phase 4 — Reliability, accessibility and storage

- Unified responsive reader/toolkit navigation, touch controls of at least 44 pixels, 16-pixel mobile text inputs, narrow-screen form/date fields and responsive export cards.
- Keyboard-accessible alternatives for page selection/reordering; labelled controls, native dialog focus management, live status and error messages, and English/Vietnamese instructions.
- Worker-based PDF editing/protection with cancellation, sequential rasterization, lazy thumbnails and released page canvases/documents on navigation.
- Reader page surfaces are capped at 6 megapixels/8192 pixels per side. Mobile toolkit rasterization is capped at 12 megapixels/8192 pixels per side, with a visible explanation when effective DPI is lower. Desktop rasterization keeps its existing limits.
- Input limit is 512 MiB. Device memory still limits complex/large documents and accumulated output images. Use page ranges, smaller batches, lower DPI or splitting when necessary; a file-size limit does not promise every device can process that size.
- Library cache: up to 20 PDFs/500 MiB. Least-recently-opened non-favorites can be evicted; favorites are protected. Eviction retains reading positions, bookmarks and editing drafts.
- Settings show document cache usage, browser storage/quota estimates and draft count; allow clearing non-favorite cached copies, clearing editing drafts separately and requesting persistent storage.
- Removing a library document explicitly removes its saved PDF, metadata and edits. Clearing drafts keeps PDFs, positions, bookmarks and exported copies.

PDF copies use OPFS and document metadata/drafts use a separate IndexedDB database. Site-data deletion, uninstall/browser cleanup, private browsing or browser eviction can remove local data. Persistent storage is a browser request, not a guarantee. PDFs and editing drafts are separate from the toolbox preference backup; export finished work and keep originals in Files/Downloads. Different domains, browsers and profiles have separate libraries.

## Acceptance and regression validation

```powershell
npm run check
$env:E2E_BROWSER_CHANNEL = 'chrome'
$env:E2E_PORT = '4318'
npm run test:e2e -- --workers=2
Remove-Item Env:E2E_BROWSER_CHANNEL
Remove-Item Env:E2E_PORT
```

`check` runs strict typecheck, zero-warning lint, contrast/invisible-source checks, all unit/component tests and a production build. Playwright serves a production build and covers desktop tools, mobile reading/editing, real output PDFs, touch drag/drawing/pinch through Chrome DevTools Protocol, accessibility, service workers, incoming Share Target and offline operation. No physical phone is required. Omit `E2E_BROWSER_CHANNEL` to use Playwright's bundled Chromium instead.

The production suite serves both the default PDF application and an explicit toolbox build on adjacent ports. Its four projects cover standalone PDF mobile/desktop and original toolbox mobile/desktop behavior.

For manual inspection in installed Chrome, open the production preview, press **F12**, then **Ctrl+Shift+M**. Review 320/360/390/412-pixel phones, landscape, tablet and desktop in English/Vietnamese. Check actual page rendering, selection, touch ordering, notes, form inputs and export controls; inspect viewport screenshots, not only assertions. Wait for offline readiness, choose **Offline** in DevTools Network, reload, reopen saved PDFs and try new local files. Prepare OCR before testing recognition offline.

## Packaging recommendation

Keep PWA delivery first. Capacitor/APK is unnecessary for the completed browser workflows. Consider it later only for specific native needs such as more predictable Android share registration, native file access, store distribution or OS background behavior. Browser OS integration and storage policies remain platform-dependent; downloads/file picking provide practical fallbacks.
