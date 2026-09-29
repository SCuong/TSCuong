import { useEffect, useMemo, useRef, useState } from 'react';
import { Code, Eye } from 'lucide-react';
import { EditorPanel, SplitPanes, ToolBar, ToolStack } from '@/components/tool/EditorPanel';
import { Label, Switch } from '@/components/ui/Field';
import { Segmented } from '@/components/ui/Segmented';
import { CopyButton, DownloadButton } from '@/components/ui/Actions';
import { EmptyState } from '@/components/ui/Feedback';
import { useDebouncedValue, useToolState } from '@/lib/hooks';
import { blockRemoteContent } from '@/lib/remoteContent';
import { RemoteContentNotice } from '@/components/RemoteContentNotice';
import { firstHeading, markdownToHtml, standaloneDocument } from './lib/markdown';

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

export default function MarkdownToHtml() {
  const [input, setInput] = useToolState('markdown-to-html', 'input', '');
  const [view, setView] = useToolState<'preview' | 'html'>('markdown-to-html', 'view', 'preview');
  const [breaks, setBreaks] = useToolState('markdown-to-html', 'breaks', false);
  const [standalone, setStandalone] = useToolState('markdown-to-html', 'standalone', false);
  const debounced = useDebouncedValue(input, 150);

  const fragment = useMemo(() => (debounced.trim() ? markdownToHtml(debounced, { breaks }) : ''), [debounced, breaks]);
  const html = input.trim() ? (standalone ? standaloneDocument(fragment, firstHeading(debounced) ?? 'Document') : fragment) : '';
  // The preview (not the HTML output) keeps remote images blocked until the user opts in.
  const [allowRemote, setAllowRemote] = useState(false);
  const preview = useMemo(
    () => (allowRemote ? { html: fragment, blocked: 0, hosts: [] } : blockRemoteContent(fragment)),
    [fragment, allowRemote],
  );
  // Code blocks in the preview scroll horizontally: make them keyboard-reachable (preview DOM only,
  // the generated HTML is untouched).
  const previewRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    for (const pre of previewRef.current?.querySelectorAll<HTMLPreElement>('pre') ?? []) {
      pre.tabIndex = 0;
      if (!pre.hasAttribute('aria-label')) pre.setAttribute('aria-label', 'Code block');
    }
  }, [preview.html]);

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
            <div className="h-[560px] overflow-auto p-5">
              {fragment ? (
                <>
                  <RemoteContentNotice
                    blocked={preview.blocked}
                    hosts={preview.hosts}
                    onAllow={() => setAllowRemote(true)}
                    className="mb-4"
                  />
                  {/* Sanitized by DOMPurify in markdownToHtml; remote media neutralized by blockRemoteContent. */}
                  <div ref={previewRef} className="lk-prose" dangerouslySetInnerHTML={{ __html: preview.html }} />
                </>
              ) : (
                <EmptyState icon={Eye} title="Nothing to preview yet">
                  Type Markdown on the left, or load the sample.
                </EmptyState>
              )}
            </div>
          </section>
        )}
      </SplitPanes>
      <p className="text-[12.5px] text-fg-muted">
        GitHub-flavored Markdown: tables, task lists, strikethrough and autolinks. The HTML is sanitized, so scripts, event
        handlers and javascript: links are removed.
      </p>
    </ToolStack>
  );
}
