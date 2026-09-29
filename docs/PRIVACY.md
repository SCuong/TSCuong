# Privacy model

LocalKit is local-first by construction: there is no LocalKit server to send anything to. The site is a set of
static files; after they load, every tool runs in your browser.

## What never happens

- Files you open are never uploaded. They are read in the browser tab (and its Web Workers) and discarded when you
  leave the tool or close the tab.
- There are no accounts, analytics, trackers, error reporting or remote logging.
- Heavy engines (PDF, OCR, SQLite, Mermaid, formatters, …) are served from this same site, never from a CDN.

## What is stored, and where

| Data | Storage | Control |
| --- | --- | --- |
| Theme, favorites, pins, recent tools, usage counts, recent searches, settings | `localStorage` | Command palette → "Clear recent tools and searches"; Settings → recent-search toggle and "Delete all data" |
| Small tool inputs and options (so a tool looks the same next time) | `localStorage` (size-capped) | Settings → "Remember input in simple tools" |
| Notes, snippets, diagrams, API collections, environments and history, local file-search indexes | IndexedDB | Delete in each workspace, or Settings → "Delete all data" |

Secrets are not remembered by default: password, JWT, key and certificate tools do not persist their inputs, and the
API client never stores authorization settings, sensitive headers (Authorization, Cookie, API-key headers, …) or
credential-like query parameters in its history. Saving a request that contains credentials is a deliberate action
and shows a warning. Backups (Settings → Export) contain whatever you saved, so keep backup files private.

## When the network is used

Only when you explicitly trigger it:

| Tool | What goes over the network |
| --- | --- |
| API Client | Exactly the request you send, to the URL you entered, directly from your browser or via the optional local companion that you start yourself. The "Try an example request" button calls httpbin.org, a public test service, and says so. |
| HTML Live Preview | Resources your own HTML/CSS links to (images, fonts, scripts) load from the servers you reference, inside a sandboxed frame. |
| Meta Tag Generator | The preview image loads from the image URL you enter. |
| Markdown Notes, Markdown to HTML | Nothing by default: remote images and media in your Markdown are **blocked** in the preview until you click **Load images**, which then loads them from their servers. |

Opening a link (for example "Open in OpenStreetMap" in the EXIF viewer) is a normal navigation you start yourself.

## Offline cache

The service worker stores the app's own files (and engine files the first time a tool uses them) so tools work
offline. It never caches API-client traffic or any third-party responses.

## Companion

`npm run companion` runs a small proxy on your own machine for the API client. It listens on 127.0.0.1 only, requires
a random token, accepts requests only from local origins (or origins you allow explicitly), rejects non-loopback
`Host` headers and never proxies to itself. See [companion/README.md](../companion/README.md).
