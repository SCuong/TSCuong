# Authoring a LocalKit tool

Every tool is: **metadata in a registry file** + **a lazily loaded React component** + **pure logic with unit tests**.

## 1. Registry entry

Each category has one registry file: `src/tools/registry/<category>.ts`, exporting `<category>Tools: ToolDefinition[]`
(see `src/tools/types.ts`). Search, navigation, the home page and the command palette are generated from these lists.

```ts
{
  id: 'json-formatter',            // stable forever (favorites/history reference it), kebab-case, globally unique
  name: 'JSON Formatter',          // Title Case, short
  description: 'Pretty-print or minify JSON with validation, custom indentation and key sorting.', // one sentence
  category: 'json',
  icon: Braces,                    // lucide-react icon; verify it exists (grep node_modules/lucide-react/dist/lucide-react.d.ts)
  route: 'json-formatter',         // path under /tools/ ; may be nested: 'pdf/merge', 'image/compress'
  keywords: ['json', 'format', 'pretty', ...],  // formats, verbs, nouns people type
  aliases: ['format json', 'pretty print json'], // natural phrases
  load: () => import('../json/JsonFormatter'),   // default export = component, no props
  network?: 'none' | 'optional' | 'required', networkNote?: string,  // omit = 'none' (fully local)
  requires?: ['webCrypto' | 'webAssembly' | 'fileSystemAccess' | ...],
  layout?: 'standard' | 'wide' | 'full',          // workspaces use 'wide' or 'full'
}
```

Search quality matters: include the words a user would type ("jpg", "webp", "shrink", "decode"), both directions for
converters, and common misspellings are handled by the fuzzy matcher automatically.

## 2. Component

`src/tools/<category>/<ToolName>.tsx`, `export default function ToolName()`. The ToolPage already renders the title,
description, icon, favorite/pin buttons, error boundary and Suspense — the component renders only the working UI.

Use the shared primitives (do not restyle from scratch):

| Need | Use |
| --- | --- |
| Text/code in → out | `EditorPanel`, `SplitPanes`, `ToolBar`, `ToolStack` from `@/components/tool/EditorPanel` (`language` prop → CodeMirror; otherwise a textarea) |
| Options | `Segmented`, `Select`, `Input`, `NumberInput`, `Switch`, `Checkbox`, `Field`, `Label` from `@/components/ui/*` |
| Buttons | `Button` (`variant="primary"` for the main action), `IconButton` (always pass `label`) |
| Containers | `Panel`, `Badge`, `Kbd`, `KeyValueList`, `Stat` from `@/components/ui/Panel` |
| Feedback | `Alert`, `ErrorMessage`, `ProgressBar`, `Spinner`, `EmptyState`, `toast()` |
| Files | `FileDrop` (validates `accept`, supports drag/drop/paste/browse), `downloadBlob`, `DownloadButton`, `CopyButton` |
| Dialogs | `Dialog`, `ConfirmDialog` (use for destructive actions) |
| State | `useToolState(toolId, key, initial)` persists small inputs between visits; `useAsyncJob()` for cancellable progress jobs; `useObjectUrl(blob)` revokes URLs automatically |
| Persistence of documents | `collection<T>(name)` + `useCollection` from `@/lib/storage/db` (IndexedDB, versioned migrations) |
| Utils | `cn`, `formatBytes`, `errorMessage`, `copyText`, `withExtension`, `pluralize` from `@/lib/utils` |

Styling: Tailwind with semantic tokens only — `bg-bg bg-surface bg-surface-raised bg-surface-hover bg-surface-sunken
border-line border-line-strong text-fg text-fg-secondary text-fg-muted text-accent-text bg-accent bg-accent-soft
text-success text-warning text-danger bg-*-soft`. Never hard-code colors (both themes must work). Cards `rounded-xl`,
controls `rounded-lg`. Text sizes: body 13–14px. Must work at 390px width: stack columns, allow tables to scroll
horizontally inside their container (`overflow-x-auto`), never overflow the page.

## 3. Rules (definition of done for a tool)

- It really works and produces correct output. No placeholders, no "coming soon", no dead buttons, no fake results.
- Empty input → neutral empty state (not an error). Invalid input → a clear, human sentence (`ErrorMessage`), never a stack trace.
- Heavy libraries (`pdf-lib`, `pdfjs-dist`, `tesseract.js`, `sql.js`, `mermaid`, `xlsx`, `prettier`, `terser`, `svgo`, `zxing-wasm`,
  `@jsquash/*`, `@zxcvbn-ts/*`, `@peculiar/x509`, `mime-db`) must only be imported from tool modules (or dynamically), never from
  registry files or shared components.
- Long work: show progress (`ProgressBar`), keep the UI responsive (Web Worker via `new Worker(new URL('./x.worker.ts', import.meta.url), { type: 'module' })`
  or chunked loops with `await nextFrame()`), support cancel where practical, terminate workers on unmount.
- Files: validate type, catch corrupt input, handle large files gracefully (`errorMessage()` maps out-of-memory errors).
- Revoke object URLs (`useObjectUrl` or explicit cleanup).
- Never `eval`/`new Function` user input. Sanitize rendered HTML with DOMPurify. Render previews of untrusted HTML only in
  sandboxed iframes (`sandbox=""`).
- Accessibility: every control labelled; errors announced (`ErrorMessage` uses `role="alert"`); keyboard usable.
- Put pure logic in `src/tools/<category>/lib/*.ts` and cover it with Vitest tests (`*.test.ts` next to it), including edge
  cases: empty, invalid, Unicode/emoji, very long input.

## 4. Checking your work

```sh
npx tsc -p tsconfig.app.json --noEmit     # strict typecheck
npx vitest run src/tools/<category>        # unit tests
npx eslint src/tools/<category>            # lint
node scripts/shot.mjs <outDir> "/tools/<route>,/tools/<route2>" [--mobile] [--theme=dark|light|both] [--full]
                                           # screenshots in both themes via Playwright; prints console errors and horizontal overflow
```
The screenshot helper expects the dev server on http://localhost:5173.
