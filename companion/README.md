# LocalKit companion

An optional, zero-dependency local proxy for the LocalKit **API Client**. Nothing else in LocalKit uses it,
and the API client works without it.

## Why

The API client normally sends requests straight from your browser. Browsers enforce rules that a
desktop API client does not have:

- **CORS**: the browser only shows a cross-origin response when the server allows it with
  `Access-Control-Allow-Origin`. Many APIs do not, so the browser blocks the response and gives the page
  no details about why.
- **Mixed content**: an `https://` page cannot call a plain `http://` server (localhost excepted).
- **Forbidden headers**: `Cookie`, `Host`, `Origin`, `Referer`, `User-Agent` and a few others cannot
  be set from JavaScript.

The companion runs on your computer and sends the request with Node's `fetch` on the app's behalf, so none
of these browser rules apply. The request still goes directly from your machine to the API; no third-party
server is involved.

## How

Requires Node.js 20 or newer. From the LocalKit folder:

```sh
npm run companion
# or with options:
npm run companion -- --port 17878 --allow-origin https://tools.example.com
node companion/server.mjs --help
```

It prints a token, for example:

```
LocalKit companion 1.0.0 listening on http://127.0.0.1:17878

  Token: 3q2-7b...
```

In the API client, set **Send via** to **Local companion**, open **Companion settings**, paste the token,
and check that the status says **Connected**. The token is stored in this browser's localStorage.

| Option | Default | Environment variable |
| --- | --- | --- |
| `--port <n>` | `17878` | `LOCALKIT_COMPANION_PORT` |
| `--token <t>` | random each start | `LOCALKIT_COMPANION_TOKEN` |
| `--allow-origin <origin>` (repeatable) | none | `LOCALKIT_COMPANION_ALLOW_ORIGIN` (comma-separated) |
| `--max-bytes <n>` | `52428800` (50 MB) | |
| `--timeout <ms>` | `30000` | |

Set a fixed token with `--token` if you do not want to paste a new one after every restart.

## Protocol

`GET /health` returns `{ "name": "localkit-companion", "version": "1.0.0" }`.

`POST /proxy` takes a JSON envelope and answers with one:

```jsonc
// request
{ "method": "POST", "url": "https://api.example.com/items",
  "headers": [["Content-Type", "application/json"]], "bodyBase64": "eyJhIjoxfQ==", "timeoutMs": 30000 }
// response (HTTP 200 whenever the target answered, whatever its status)
{ "status": 201, "statusText": "Created", "headers": [["content-type", "application/json"]],
  "bodyBase64": "...", "timeMs": 84.2, "url": "https://api.example.com/items", "redirected": false,
  "droppedHeaders": [] }
```

When the target cannot be reached the companion answers `502` or `504` with `{ "error": "..." }`
describing what happened (DNS failure, connection refused, TLS problem, timeout). It never invents a
response. Both calls need the `X-LocalKit-Token` header.

## Security model

The companion can make requests to anything your computer can reach, including your local network, so it
is locked down:

- **Loopback only.** It binds to `127.0.0.1` and is not reachable from other machines.
- **Token.** Every call must carry the random token printed at startup (compared in constant time).
  Other local programs and web pages cannot use it without the token.
- **Origin allowlist.** CORS is granted only to `http(s)://localhost`, `127.0.0.1` and `[::1]` on any
  port, plus origins you add with `--allow-origin`. Requests from any other page are rejected with `403`.
- **DNS rebinding defense.** The `Host` header must be `127.0.0.1`, `localhost` or `[::1]` with the
  companion's port.
- **No loops.** It refuses to proxy to its own address and port.
- **Limits.** Request and response bodies are capped (`--max-bytes`), and upstream requests time out
  (at most 5 minutes).
- Only `http:` and `https:` targets are accepted. Certificates are always verified.
- It logs one line per request (method, URL, status, time, size) to the terminal and stores nothing.

Stop it with `Ctrl+C` when you do not need it.

## Tests

`node companion/test.mjs` starts the companion and a local target server (ports 17901 and 17902) and
checks the token, origin and Host checks, proxying, self-proxy refusal, limits and timeouts.
