import { useMemo, useState } from 'react';
import { Code, Eye } from 'lucide-react';
import { EditorPanel, SplitPanes, ToolBar, ToolStack } from '@/components/tool/EditorPanel';
import { Label, Switch } from '@/components/ui/Field';
import { Segmented } from '@/components/ui/Segmented';
import { CopyButton, DownloadButton } from '@/components/ui/Actions';
import { EmptyState } from '@/components/ui/Feedback';
import { useDebouncedValue, useToolState } from '@/lib/hooks';
import { blockRemoteContent } from '@/lib/remoteContent';
import { useTheme } from '@/lib/theme';
import { RemoteContentNotice } from '@/components/RemoteContentNotice';
import { firstHeading, markdownToHtml, previewDocument, standaloneDocument, type PreviewPalette } from './lib/markdown';

const SAMPLE = `# Release notes

LocalKit **2.0** is out — faster, smaller and still *100% local*.

## Highlights

- [x] Offline support
- [x] New color tools
- [ ] Plugin API (coming later)

| Tool | Status |
| --- | --- |
| Formatter | ✅ Stable |
| Minifier | 🧪 Beta |

> Nothing you paste ever leaves your device.

\`\`\`js
const greet = (name) => \`Hello, \${name}!\`;
\`\`\`

Visit https://example.com or read the ~~old~~ new [docs](https://example.com/docs).
`;

/** The app theme's colors, so the isolated preview looks like the rest of the page. */
function readPalette(scheme: 'light' | 'dark'): PreviewPalette {
  const style = getComputedStyle(document.documentElement);
  const v = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback;
  const dark = scheme === 'dark';
  return {
    scheme,
    background: v('--lk-surface', dark ? '#10141c' : '#ffffff'),
    text: v('--lk-text-primary', dark ? '#e6eaf2' : '#0e1420'),
    textSecondary: v('--lk-text-secondary', dark ? '#a7b1c2' : '#475266'),
    textMuted: v('--lk-text-muted', dark ? '#8d98ab' : '#5f6b7e'),
    border: v('--lk-border', dark ? '#1f2633' : '#e3e7ed'),
    borderStrong: v('--lk-border-strong', dark ? '#2d3646' : '#cdd3dc'),
    soft: v('--lk-surface-hover', dark ? '#1b2130' : '#f1f3f6'),
    sunken: v('--lk-surface-sunken', dark ? '#0d1118' : '#f8f9fb'),
    link: v('--lk-accent-text', dark ? '#7aa7ff' : '#1d57dc'),
    accent: v('--lk-accent', '#2563eb'),
  };
}

export default function MarkdownToHtml() {
  const [input, setInput] = useToolState('markdown-to-html', 'input', '');
  const [view, setView] = useToolState<'preview' | 'html'>('markdown-to-html', 'view', 'preview');
  const [breaks, setBreaks] = useToolState('markdown-to-html', 'breaks', false);
  const [standalone, setStandalone] = useToolState('markdown-to-html', 'standalone', false);
  const debounced = useDebouncedValue(input, input.length > 200_000 ? 400 : 150);
  const theme = useTheme().resolved;

  const fragment = useMemo(() => (debounced.trim() ? markdownToHtml(debounced, { breaks }) : ''), [debounced, breaks]);
  const html = input.trim() ? (standalone ? standaloneDocument(fragment, firstHeading(debounced) ?? 'Document') : fragment) : '';
  // The preview (not the HTML output) keeps remote images blocked until the user opts in.
  const [allowRemote, setAllowRemote] = useState(false);
  const preview = useMemo(
    () => (allowRemote ? { html: fragment, blocked: 0, hosts: [] } : blockRemoteContent(fragment)),
    [fragment, allowRemote],
  );
  // Rendered in a sandboxed frame whose Content-Security-Policy blocks all requests (images until "Load images"):
  // pasted <style> blocks, fixed-position elements or CSS url() values cannot affect or leave this page.
  const previewSrc = useMemo(
    () => (fragment ? previewDocument(preview.html, readPalette(theme), allowRemote) : ''),
    [fragment, preview.html, theme, allowRemote],
  );

  return (
    <ToolStack>
      <ToolBar>
        <div>
          <Label>Output</Label>
          <Segmented
            label="Output view"
            value={view}
            onChange={setView}
            options={[
              { value: 'preview', label: 'Preview', icon: Eye },
              { value: 'html', label: 'HTML', icon: Code },
            ]}
          />
        </div>
        <Switch label="Line breaks become <br>" checked={breaks} onChange={setBreaks} className="h-8" />
        <Switch label="Full HTML document" checked={standalone} onChange={setStandalone} className="h-8" />
      </ToolBar>
      <SplitPanes>
        <EditorPanel
          title="Markdown"
          value={input}
          onChange={setInput}
          language="markdown"
          placeholder="Write or paste Markdown…"
          sample={SAMPLE}
          fileAccept=".md,.markdown,.txt,text/markdown,text/plain"
          height="560px"
        />
        {view === 'html' ? (
          <EditorPanel title="HTML" value={html} language="html" placeholder="HTML appears here" downloadName="document.html" downloadType="text/html" height="560px" />
        ) : (
          <section className="flex min-w-0 flex-col rounded-xl border border-line bg-surface shadow-card">
            <header className="flex min-h-11 items-center justify-between gap-2 border-b border-line py-1.5 pr-2 pl-4">
              <h2 className="text-[13px] font-semibold tracking-tight text-fg">Preview</h2>
              <div className="flex items-center gap-1">
                <DownloadButton data={html} filename="document.html" type="text/html" label="Save" variant="ghost" />
                <CopyButton value={html} iconOnly label="Copy HTML" />
              </div>
            </header>
            <div className="flex h-[560px] min-h-0 flex-col">
              {fragment ? (
                <>
                  <RemoteContentNotice
                    blocked={preview.blocked}
                    hosts={preview.hosts}
                    onAllow={() => setAllowRemote(true)}
                    className="mx-3 mt-3"
                  />
                  {/*
                    Sanitized by DOMPurify in markdownToHtml, then isolated: the frame has its own opaque origin (never
                    allow-same-origin) and its CSP forbids every script and request. `allow-scripts` only lets browser
                    tooling (e.g. Playwright's trace snapshots) inspect the frame; the page's own CSP still blocks all
                    scripts, inline handlers and javascript: URLs. Popups are allowed so links open in a new tab.
                  */}
                  <iframe
                    title="Rendered Markdown preview"
                    sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"
                    srcDoc={previewSrc}
                    referrerPolicy="no-referrer"
                    className="min-h-0 w-full flex-1 rounded-b-xl border-0 bg-surface"
                  />
                </>
              ) : (
                <div className="p-5">
                  <EmptyState icon={Eye} title="Nothing to preview yet">
                    Type Markdown on the left, or load the sample.
                  </EmptyState>
                </div>
              )}
            </div>
          </section>
        )}
      </SplitPanes>
      <p className="text-[12.5px] text-fg-muted">
        GitHub-flavored Markdown: tables, task lists, strikethrough and autolinks. The HTML is sanitized, so scripts, event
        handlers and javascript: links are removed. The preview is isolated from this page and makes no network requests; links
        open in a new tab.
      </p>
    </ToolStack>
  );
}
