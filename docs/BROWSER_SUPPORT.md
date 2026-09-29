# Browser support and limitations

LocalKit targets current Chromium browsers (Chrome, Edge, Brave, Opera) first and works in current Firefox and
Safari. Capabilities are feature-detected at runtime; a missing capability disables or replaces one feature and
never crashes the app. Tools whose core depends on a missing capability (Web Crypto, WebAssembly) show a clear
"your browser does not support this tool" message instead of the tool.

| Capability | Used by | Behavior without it |
| --- | --- | --- |
| File System Access API (`showDirectoryPicker`) — Chromium | Local File Search, Batch Renamer, File Splitter, ZIP tools (folder picking) | Folders are chosen with `<input webkitdirectory>` or drag and drop. File Search then keeps a snapshot that cannot be re-scanned without choosing the folder again. |
| EyeDropper API — Chromium | Color Converter ("pick from screen") | The eyedropper button is hidden; the native color input and text fields remain. |
| Native AVIF encoding (`canvas.toBlob('image/avif')`) | Image Converter, Image Compressor | A WebAssembly AVIF encoder (jSquash) is downloaded on first use and cached. |
| Camera (`getUserMedia`) — secure context (HTTPS or localhost) | QR & Barcode Scanner | Scan from an image file, a pasted image or a dropped image instead. |
| Clipboard API | Copy buttons, palette quick actions, paste into tools | Copy buttons report the failure; text can be selected and copied manually. |
| Web Crypto (`crypto.subtle`) — secure context | Hashes, HMAC, AES, JWT verification and signing, key pairs, TOTP | The tool shows that the browser (or an insecure http:// origin) does not provide Web Crypto. |
| IndexedDB | Notes, snippets, diagrams, API collections, file-search indexes | Data is kept in memory for the session and a warning explains that it will not persist (e.g. some private-browsing modes). |
| OffscreenCanvas in workers | Batch image processing | Images are processed on the main thread, one at a time, instead of in the worker pool. |
| Service workers | Offline use, installable PWA | The app works online; offline use and installation are unavailable. |

## Network-related limits (API client)

Browsers enforce CORS and forbid scripts from setting some headers (`Cookie`, `Host`, `Origin`, `Referer`,
`User-Agent`, …). When a request is blocked the API client says so honestly: the browser does not reveal whether
CORS, an unreachable server, a TLS problem or an extension caused it, so the UI lists those possibilities instead of
guessing. The optional local [companion](../companion/README.md) sends requests from Node on your machine and is not
subject to these browser rules.

## Other known limits

- **HEIC/HEIF images** are not decoded by Chromium or Firefox; the image tools say so when such a file is added.
- **OCR** bundles English recognition data only.
- **Very large files** are processed in chunks or workers where possible, but a single operation is still bounded by
  the memory available to the browser tab; tools report out-of-memory failures with an actionable message.
