import type { SnippetDraft } from './model';

export interface SnippetTemplate extends SnippetDraft {
  id: string;
}

/** A starter set of genuinely useful snippets across common languages. */
export const SNIPPET_TEMPLATES: SnippetTemplate[] = [
  {
    id: 'js-debounce',
    title: 'Debounce a function',
    description: 'Delay calling fn until wait ms have passed without another call.',
    language: 'typescript',
    tags: ['utility', 'performance'],
    code: `export function debounce<A extends unknown[]>(fn: (...args: A) => void, wait = 200) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const debounced = (...args: A) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
  debounced.cancel = () => clearTimeout(timer);
  return debounced;
}`,
  },
  {
    id: 'js-fetch-timeout',
    title: 'fetch with timeout and JSON errors',
    description: 'Abort a request after a timeout and surface HTTP errors with the response body.',
    language: 'typescript',
    tags: ['http', 'fetch', 'async'],
    code: `export async function fetchJson<T>(url: string, init: RequestInit = {}, timeoutMs = 10_000): Promise<T> {
  const signal = AbortSignal.timeout(timeoutMs);
  const res = await fetch(url, { ...init, signal, headers: { Accept: 'application/json', ...init.headers } });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(\`HTTP \${res.status} \${res.statusText}: \${body.slice(0, 200)}\`);
  }
  return (await res.json()) as T;
}`,
  },
  {
    id: 'react-local-storage-hook',
    title: 'useLocalStorage React hook',
    description: 'useState that persists to localStorage and survives JSON errors.',
    language: 'tsx',
    tags: ['react', 'hooks', 'storage'],
    code: `import { useEffect, useState } from 'react';

export function useLocalStorage<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? initial : (JSON.parse(raw) as T);
    } catch {
      return initial;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // Storage full or disabled: keep the in-memory value.
    }
  }, [key, value]);

  return [value, setValue] as const;
}`,
  },
  {
    id: 'js-group-by',
    title: 'Group an array by key',
    description: 'Object.groupBy with a fallback for older runtimes.',
    language: 'javascript',
    tags: ['array', 'utility'],
    code: `export function groupBy(items, keyFn) {
  if (typeof Object.groupBy === 'function') return Object.groupBy(items, keyFn);
  return items.reduce((groups, item, index) => {
    const key = keyFn(item, index);
    (groups[key] ??= []).push(item);
    return groups;
  }, {});
}

// groupBy(users, (u) => u.role) → { admin: [...], member: [...] }`,
  },
  {
    id: 'python-cli',
    title: 'Python CLI with argparse',
    description: 'A script entry point with arguments, logging and a proper exit code.',
    language: 'python',
    tags: ['cli', 'script'],
    code: `#!/usr/bin/env python3
import argparse
import logging
import sys


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Describe what this tool does.")
    parser.add_argument("paths", nargs="+", help="files to process")
    parser.add_argument("-o", "--output", default="-", help="output file (default: stdout)")
    parser.add_argument("-v", "--verbose", action="store_true", help="enable debug logging")
    args = parser.parse_args(argv)

    logging.basicConfig(level=logging.DEBUG if args.verbose else logging.INFO, format="%(levelname)s %(message)s")
    for path in args.paths:
        logging.debug("processing %s", path)
    return 0


if __name__ == "__main__":
    sys.exit(main())`,
  },
  {
    id: 'python-dataclass-json',
    title: 'Dataclass to and from JSON',
    description: 'Serialize a dataclass with asdict and load it back.',
    language: 'python',
    tags: ['json', 'dataclass'],
    code: `import json
from dataclasses import asdict, dataclass, field


@dataclass
class Config:
    name: str
    retries: int = 3
    tags: list[str] = field(default_factory=list)

    def to_json(self) -> str:
        return json.dumps(asdict(self), indent=2)

    @classmethod
    def from_json(cls, text: str) -> "Config":
        return cls(**json.loads(text))


cfg = Config("api", tags=["prod"])
assert Config.from_json(cfg.to_json()) == cfg`,
  },
  {
    id: 'go-http-server',
    title: 'Go HTTP server with graceful shutdown',
    description: 'net/http server that drains connections on Ctrl+C.',
    language: 'go',
    tags: ['http', 'server'],
    code: `package main

import (
	"context"
	"errors"
	"log"
	"net/http"
	"os/signal"
	"syscall"
	"time"
)

func main() {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("ok"))
	})

	srv := &http.Server{Addr: ":8080", Handler: mux, ReadHeaderTimeout: 5 * time.Second}
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	go func() {
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatal(err)
		}
	}()
	<-ctx.Done()

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := srv.Shutdown(shutdownCtx); err != nil {
		log.Printf("shutdown: %v", err)
	}
}`,
  },
  {
    id: 'rust-read-lines',
    title: 'Read a file line by line (Rust)',
    description: 'Buffered reading with error propagation via ?.',
    language: 'rust',
    tags: ['io', 'file'],
    code: `use std::fs::File;
use std::io::{self, BufRead, BufReader};

fn count_non_empty(path: &str) -> io::Result<usize> {
    let reader = BufReader::new(File::open(path)?);
    let mut count = 0;
    for line in reader.lines() {
        if !line?.trim().is_empty() {
            count += 1;
        }
    }
    Ok(count)
}

fn main() -> io::Result<()> {
    println!("{}", count_non_empty("Cargo.toml")?);
    Ok(())
}`,
  },
  {
    id: 'bash-strict-script',
    title: 'Bash script skeleton (strict mode)',
    description: 'set -euo pipefail, usage text, argument parsing and cleanup trap.',
    language: 'shell',
    tags: ['bash', 'cli', 'script'],
    code: `#!/usr/bin/env bash
set -euo pipefail
IFS=$'\\n\\t'

usage() {
  echo "Usage: $(basename "$0") [-v] <input>" >&2
  exit 1
}

verbose=0
while getopts ":vh" opt; do
  case "$opt" in
    v) verbose=1 ;;
    h|*) usage ;;
  esac
done
shift $((OPTIND - 1))
[[ $# -ge 1 ]] || usage

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

[[ $verbose -eq 1 ]] && echo "Working in $tmp"
echo "Processing $1"`,
  },
  {
    id: 'bash-find-replace',
    title: 'Find and replace across files',
    description: 'Replace text in all tracked files, portable between GNU and BSD sed.',
    language: 'shell',
    tags: ['sed', 'refactor', 'git'],
    code: `# Replace "oldName" with "newName" in every tracked .ts file
git ls-files -z '*.ts' | xargs -0 sed -i.bak 's/oldName/newName/g'
find . -name '*.bak' -type f -delete`,
  },
  {
    id: 'powershell-files-by-size',
    title: 'Largest files in a folder (PowerShell)',
    description: 'List the 20 biggest files recursively with human readable sizes.',
    language: 'powershell',
    tags: ['files', 'disk'],
    code: `Get-ChildItem -Path . -Recurse -File -ErrorAction SilentlyContinue |
  Sort-Object Length -Descending |
  Select-Object -First 20 @{ Name = 'SizeMB'; Expression = { [math]::Round($_.Length / 1MB, 2) } }, FullName |
  Format-Table -AutoSize`,
  },
  {
    id: 'sql-upsert',
    title: 'Upsert (PostgreSQL / SQLite)',
    description: 'Insert a row or update it when the unique key already exists.',
    language: 'sql',
    tags: ['postgres', 'sqlite', 'upsert'],
    code: `INSERT INTO users (email, name, updated_at)
VALUES ('ada@example.com', 'Ada Lovelace', CURRENT_TIMESTAMP)
ON CONFLICT (email) DO UPDATE
SET name = EXCLUDED.name,
    updated_at = EXCLUDED.updated_at;`,
  },
  {
    id: 'sql-top-n-per-group',
    title: 'Top N rows per group',
    description: 'Window function to keep the 3 most recent orders per customer.',
    language: 'sql',
    tags: ['window-function', 'analytics'],
    code: `SELECT *
FROM (
  SELECT o.*,
         ROW_NUMBER() OVER (PARTITION BY customer_id ORDER BY created_at DESC) AS rn
  FROM orders AS o
) ranked
WHERE rn <= 3
ORDER BY customer_id, created_at DESC;`,
  },
  {
    id: 'css-center',
    title: 'Center anything with grid',
    description: 'Horizontally and vertically center a child element.',
    language: 'css',
    tags: ['layout', 'grid'],
    code: `.center {
  display: grid;
  place-items: center;
  min-height: 100dvh;
}`,
  },
  {
    id: 'css-visually-hidden',
    title: 'Visually hidden (screen-reader only)',
    description: 'Hide content visually while keeping it available to assistive technology.',
    language: 'css',
    tags: ['a11y', 'accessibility'],
    code: `.visually-hidden:not(:focus):not(:active) {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
  border: 0;
}`,
  },
  {
    id: 'html-boilerplate',
    title: 'HTML5 page boilerplate',
    description: 'Minimal, modern document with viewport, color-scheme and deferred script.',
    language: 'html',
    tags: ['boilerplate', 'starter'],
    code: `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="light dark" />
    <title>Page title</title>
    <link rel="stylesheet" href="/styles.css" />
    <script type="module" src="/main.js" defer></script>
  </head>
  <body>
    <main>
      <h1>Hello</h1>
    </main>
  </body>
</html>`,
  },
  {
    id: 'dockerfile-node',
    title: 'Node.js multi-stage Dockerfile',
    description: 'Build with dev dependencies, ship a slim image running as a non-root user.',
    language: 'dockerfile',
    tags: ['docker', 'node', 'deploy'],
    code: `FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
USER node
EXPOSE 3000
CMD ["node", "dist/server.js"]`,
  },
  {
    id: 'gha-node-ci',
    title: 'GitHub Actions: Node CI',
    description: 'Install, lint, test and build on every push and pull request.',
    language: 'yaml',
    tags: ['ci', 'github-actions'],
    code: `name: CI
on:
  push:
    branches: [main]
  pull_request:

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npm run lint
      - run: npm test
      - run: npm run build`,
  },
  {
    id: 'nginx-reverse-proxy',
    title: 'Nginx reverse proxy with WebSockets',
    description: 'Proxy a local app and pass the headers apps usually need.',
    language: 'nginx',
    tags: ['proxy', 'server'],
    code: `server {
    listen 80;
    server_name example.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}`,
  },
  {
    id: 'java-record-stream',
    title: 'Java records and streams',
    description: 'Group and sum with the Stream API using a record.',
    language: 'java',
    tags: ['streams', 'collections'],
    code: `import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

public class Totals {
    record Order(String customer, double amount) {}

    public static void main(String[] args) {
        List<Order> orders = List.of(new Order("ada", 12.5), new Order("linus", 3), new Order("ada", 7.5));
        Map<String, Double> totals = orders.stream()
            .collect(Collectors.groupingBy(Order::customer, Collectors.summingDouble(Order::amount)));
        System.out.println(totals); // {ada=20.0, linus=3.0}
    }
}`,
  },
  {
    id: 'csharp-retry',
    title: 'Retry with exponential backoff (C#)',
    description: 'Retry an async operation with jittered exponential delays.',
    language: 'csharp',
    tags: ['async', 'resilience'],
    code: `public static async Task<T> RetryAsync<T>(Func<Task<T>> action, int attempts = 4, int baseDelayMs = 200)
{
    for (var attempt = 1; ; attempt++)
    {
        try
        {
            return await action();
        }
        catch when (attempt < attempts)
        {
            var delay = baseDelayMs * Math.Pow(2, attempt - 1) + Random.Shared.Next(0, 100);
            await Task.Delay(TimeSpan.FromMilliseconds(delay));
        }
    }
}`,
  },
  {
    id: 'git-aliases',
    title: 'Handy git aliases',
    description: 'Short log graph, last commit, and undo helpers for ~/.gitconfig.',
    language: 'ini',
    tags: ['git', 'config'],
    code: `[alias]
  st = status -sb
  co = switch
  lg = log --graph --pretty=format:'%C(yellow)%h%Creset %s %C(dim)(%cr) <%an>%Creset%C(auto)%d' --abbrev-commit
  last = log -1 HEAD --stat
  undo = reset --soft HEAD~1
  amend = commit --amend --no-edit`,
  },
  {
    id: 'makefile-phony',
    title: 'Makefile with phony targets',
    description: 'Self-documenting Makefile: run "make help" to list targets.',
    language: 'makefile',
    tags: ['build', 'make'],
    code: `.PHONY: help install test build clean
.DEFAULT_GOAL := help

help: ## Show this help
\t@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "%-12s %s\\n", $$1, $$2}'

install: ## Install dependencies
\tnpm ci

test: ## Run the test suite
\tnpm test

build: ## Build for production
\tnpm run build

clean: ## Remove build output
\trm -rf dist`,
  },
];
