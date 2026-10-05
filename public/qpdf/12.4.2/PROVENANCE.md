# Local QPDF engine

QPDF 12.4.2 (Apache-2.0), compiled by the MIT-licensed [le0pard/qpdf-wasm](https://github.com/le0pard/qpdf-wasm) build.

Pinned build repository commit: `f79ba536a7520d38bb5b19fc918f85f5a19ce3d8`.
Pinned QPDF source commit: `4eba95899886e851cc41d76886483b347612f2a8`.
The Docker build pins Emscripten 6.0.10, zlib 1.3.2 and libjpeg-turbo 3.2.0. See the upstream `wasm/Dockerfile` and the included `build-source.sh` for reproduction. No upstream code has been changed.

SHA-256:

- `qpdf.js`: `36e279174f149658c371726b4789441cda1bbbd8d5827d1f310ab41e55ac41b9`
- `qpdf.wasm`: `d9378a1f1912e9f98f99e53bc8a2965273b86e0bdd047c1e3cda81bf4255fcd0`

The glue obtains random bytes from `crypto.getRandomValues` in browsers. LocalKit permits only 256-bit encryption, runs one job in a dedicated worker, suppresses worker diagnostics, and terminates the worker on completion/cancellation. Only these same-origin engine assets are fetched; document bytes and passwords are never sent to a server.

Upstream sources and license references:

- [QPDF](https://github.com/qpdf/qpdf/tree/4eba95899886e851cc41d76886483b347612f2a8), included `LICENSE-qpdf.txt`.
- [WASM build](https://github.com/le0pard/qpdf-wasm/tree/f79ba536a7520d38bb5b19fc918f85f5a19ce3d8/wasm), included `LICENSE-build.txt`.
- [zlib license](https://github.com/madler/zlib/blob/da607da739fa6047df13e66a2af6b8bec7c2a498/LICENSE).
- [libjpeg-turbo license](https://github.com/ImageMagick/jpeg-turbo/blob/8b678d394c47c5d7cef5b896dcb09085145d0d3e/LICENSE.md).
