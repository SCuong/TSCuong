# LocalKit mobile PDF Reader

Phase 1 adds a mobile reading experience to LocalKit. The desktop PDF Viewer and editing tools remain available at their existing routes. LocalKit still starts at its normal home page.

## Run this worktree

The completed feature lives at:

```powershell
Set-Location 'C:\Users\scuong\.codex\worktrees\mobile-pdf-reader\TSCuong'
npm run build
npm run preview -- --host 127.0.0.1
```

Open http://localhost:4317/read. Node 20 or newer is required. Dependencies are already available in this worktree. For a fresh clone without installed dependencies, run `npm ci` before building.

Development: `npm run dev`. Use the production preview for installation, offline operation, and Share Target testing; Vite development mode intentionally has no service worker.

## Install on Android without publishing the site

1. Download Google's [SDK Platform Tools for Windows](https://developer.android.com/tools/releases/platform-tools). Extract the `platform-tools` folder into `C:\Android`.
2. On the phone, enable Developer options (tap Build number seven times) and USB debugging. Connect it by USB and accept the computer's debugging authorization.
3. Keep the production preview running on the computer. In a second PowerShell window, run:

```powershell
& 'C:\Android\platform-tools\adb.exe' devices
& 'C:\Android\platform-tools\adb.exe' reverse tcp:4317 tcp:4317
```

4. In Chrome on the phone, visit **http://localhost:4317/read**. This is the phone's localhost, forwarded to the computer; it qualifies as a secure context.
5. Wait until the library says **Ready for offline reading**. Open a PDF to check it.
6. In Chrome's **⋮** menu, choose **Add to Home screen**, then **Install** (or the offered shortcut option).
7. Open LocalKit from the home-screen icon. Its normal home page includes a prominent **PDF Reader** entry. Where supported, long-press the icon to use the reader shortcut.
8. Disconnect USB and turn off the phone's internet connection. The cached application, PDF engine, and device file picker keep working. Reopen a saved PDF from Recents.

To obtain a newer build later, reconnect USB, repeat port forwarding, rebuild, and open LocalKit online. Accept LocalKit's update prompt when ready. Keep the same origin and port to retain the same library.

A localhost installation may be a home-screen shortcut rather than an Android WebAPK. For Android OS Share Target registration, install from a stable, trusted **HTTPS** static-hosting URL when available. Some browsers/installations do not register share targets; **Open PDF** always provides the supported fallback. No document server is needed: only the compiled application files are served.

[Chrome's local-server forwarding guide](https://developer.chrome.com/docs/devtools/remote-debugging/local-server) and the [Android Debug Bridge documentation](https://developer.android.com/tools/adb) describe the connection setup. A plain Wi-Fi address such as `http://192.168.x.x:4317` is not a secure context and cannot provide a fully functioning installed offline PWA. HTTPS or localhost is required.

## Read and navigate

- Open a PDF from Files or Downloads. Password-protected PDFs prompt locally; passwords are never stored.
- Scroll vertically. Pages render only around the viewport; portrait and landscape pages each fit the screen.
- Pinch with two fingers or double-tap to zoom. A fast visual preview is followed by a sharper PDF render. Drag horizontally when zoomed.
- Long-press real PDF text to select/copy it. Scanned image-only PDFs have no selectable/searchable text.
- Tap once to hide/show controls. The floating page pill also restores controls.
- Tap the page indicator to jump. **Pages** opens thumbnails, document contents, and page bookmarks.
- Use the ribbon button to bookmark the current page.
- Search the whole document; use the arrows to move through highlighted matches.
- **View** offers fit width, fit page, zoom, original/sepia/night paper, interface theme, favorites, and immersive reading.
- Reading positions include the offset within the page and survive reloads. Picking the same bytes under a different filename restores the same position and bookmarks.
- Switch English/Vietnamese from the library header. The language setting is shared with LocalKit.

## Storage and privacy

PDF bytes are stored only in the origin-private file system (OPFS), in `reader-files/`. Recent metadata, SHA-256 fingerprints, position, favorites, and bookmarks live in the separate `localkit-reader` IndexedDB database.

The saved-file cache has a **20-PDF / 500 MiB** maximum. New documents evict the least recently opened non-favorites first. Favorites are never automatically evicted by the application. If favorites prevent a new file from fitting, it remains readable in the current session without being cached, with a clear message.

Eviction keeps metadata, position, and bookmarks. Manual removal deletes both the OPFS copy and the recent record. Clearing saved copies in settings preserves favorites and all reading metadata. The storage indicator shows the saved PDF count and size.

Incoming Android shares are handled by a service-worker navigation POST and staged temporarily in OPFS. They never go to a backend. The staging copy is consumed and removed after its bytes have been read; stale abandoned shares are cleaned on a later share.

Neither PDF bytes nor the reader database are included in LocalKit's existing backup/export. Original files in Files/Downloads are never overwritten. Keep the originals: the browser/OS can clear site storage, even favorites, and a persistence request is a browser decision.

## Implementation

- `src/reader/ReaderApp.tsx`: library, recents, favorites, opening/restoring files, storage/settings, localization, install help.
- `src/reader/MobileReader.tsx`: continuous virtualized reading, touch gestures, search, navigation sheets, bookmarks, viewing modes.
- `src/reader/PageSurface.tsx`: cancellable PDF canvas and selectable/search-highlighted text layers; bounded render memory.
- `src/reader/storage.ts`: OPFS/IndexedDB repository, serialized writes, cache policy, fingerprints, write rollback.
- `src/reader/platform.ts`: browser platform adapter, shared-file handoff, persistence, fullscreen.
- `src/reader/geometry.ts`, `errorMessage.ts`, `reader.css`: page layout, translated errors, responsive styling.
- `src/i18n/vi/reader.ts`: Vietnamese reader strings.
- `public/reader-share.js`: local Android Share Target service-worker handler.
- `src/app/App.tsx`: independent `/read` and `/read/doc?id=…` routes.
- `src/app/pages/HomePage.tsx`: reader entry card.
- `vite.config.ts`: reader shortcut/share manifest, PDF engine/font/CMap/WASM precache, linked-worktree resolution, bounded test concurrency.
- `e2e/reader-mobile.spec.ts`, `e2e/reader-fixtures.ts`, and reader unit tests: mobile interactions, real Chromium touch input, offline operation, storage recovery, mixed sizes, password handling.

The reader reuses the existing `usePdfFile`, PDF.js worker/engine assets, PDF search helpers, and thumbnail subsystem. It introduces no PDF engine or dependency, no analytics, ads, accounts, native wrapper, or PDF editing UI.

## Validation commands

```powershell
npm run check
$env:E2E_PORT = '4318'
npm run test:e2e -- e2e/reader-mobile.spec.ts e2e/mobile.spec.ts e2e/pwa.spec.ts e2e/shell.spec.ts e2e/audit-pdf.spec.ts e2e/tools.spec.ts --workers=2
```

The default e2e configuration builds and serves the production application automatically. The mobile project uses Chromium with Pixel 7 viewport/touch emulation. Native Chromium multi-touch input verifies pinch behavior; screenshots are inspected separately. This is browser emulation, not a claimed physical-phone test.

Final validation passed: **207 unit-test files / 3,858 tests**, typecheck, ESLint with zero warnings, contrast/source checks, production build, and **65 production mobile/desktop e2e tests**. The first-ever offline PDF/reload scenario also passed five consecutive repeats. The reader accessibility scan reported no serious or critical violations. Portrait, landscape, Vietnamese, night, search, and thumbnail views were inspected from actual browser screenshots.

The broad regression run exposed an existing Diagram Studio assertion that expected `Line 2:` while the current parser reports `Line 2, column 10:`. That failure was reproduced on the unchanged base commit. Only the test assertion was corrected to accept the column detail; no unrelated tool implementation changed.

Generated logs, HTML reports, screenshots, and traces remain in the worktree's ignored log/report directories. The mobile suite creates `test-results/reader-library-mobile.png`, `reader-document-mobile.png`, `reader-landscape.png`, and `reader-vietnamese.png`. Additional visual review saved `reader-night.png`, `reader-search.png`, and `reader-thumbnails.png`. Final logs are `reader-check-final.log` and `reader-release-e2e.log`.

## Platform boundaries

Installation, service workers, OPFS, and OS sharing require supported browser APIs and a secure origin. Android Chrome is the first target. Private mode or storage quota denial can prevent persistence; reading remains possible when file access is available. OS Share Target availability depends on the installed browser/PWA packaging.

Native fullscreen can be unavailable; the reader still hides its interface for immersive reading. Rotation follows the screen without requiring orientation-lock permission.

The shared LocalKit loader caps input at 512 MiB. Canvas renders are capped at 6 megapixels and 8192 pixels per side to keep phone memory bounded; exceptionally large pages at extreme zoom may be less sharp. Search shows at most the first 10,000 matches. Editing, annotations, signatures, OCR, and Capacitor are outside the approved Phase 1 scope.

The original `A:\TSCuong` uncommitted changes are kept separate; this branch was based on `93550f345551d34816495f7efab744ba6247f769`.

References: [Web Share Target](https://developer.chrome.com/docs/capabilities/web-apis/web-share-target), [offline browser storage](https://web.dev/learn/pwa/offline-data), [installability](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable).
