import { useMemo } from 'react';
import { EditorPanel, SplitPanes, ToolBar, ToolStack } from '@/components/tool/EditorPanel';
import { Label, Switch } from '@/components/ui/Field';
import { Segmented } from '@/components/ui/Segmented';
import { ErrorMessage } from '@/components/ui/Alert';
import { useDebouncedValue, useToolState } from '@/lib/hooks';
import { errorMessage } from '@/lib/utils';
import { DEFAULT_TURNDOWN, htmlToMarkdown, type HtmlToMarkdownOptions } from './lib/turndown';

const SAMPLE = `<article>
  <h1>Getting started</h1>
  <p>LocalKit is a <strong>local-first</strong> toolbox. Read the <a href="https://example.com/docs">documentation</a> or <em>just try it</em>.</p>
  <h2>Features</h2>
  <ul>
    <li>Works offline</li>
    <li>No uploads, <del>no tracking</del> no accounts</li>
  </ul>
  <h2>Formats</h2>
  <table>
    <thead><tr><th>Input</th><th>Output</th></tr></thead>
    <tbody>
      <tr><td>HTML</td><td>Markdown</td></tr>
      <tr><td>JSON</td><td>YAML</td></tr>
    </tbody>
  </table>
  <blockquote>Tip: paste rich text from a web page.</blockquote>
  <pre><code class="language-bash">npm run build</code></pre>
  <script>alert('scripts are removed')</script>
</article>`;

export default function HtmlToMarkdown() {
  const [input, setInput] = useToolState('html-to-markdown', 'input', '');
  const [opts, setOpts] = useToolState<HtmlToMarkdownOptions>('html-to-markdown', 'options', DEFAULT_TURNDOWN);
  const debounced = useDebouncedValue(input, 150);
  const set = <K extends keyof HtmlToMarkdownOptions>(k: K, v: HtmlToMarkdownOptions[K]) => setOpts((o) => ({ ...o, [k]: v }));

  const result = useMemo(() => {
    if (!debounced.trim()) return { md: '', error: null };
    try {
      return { md: htmlToMarkdown(debounced, opts), error: null };
    } catch (error) {
      return { md: '', error: errorMessage(error, 'This HTML could not be converted.') };
    }
  }, [debounced, opts]);

  return (
    <ToolStack>
      <ToolBar>
        <div>
          <Label>Headings</Label>
          <Segmented label="Heading style" value={opts.headingStyle} onChange={(v) => set('headingStyle', v)} options={[{ value: 'atx', label: '# ATX' }, { value: 'setext', label: 'Underline' }]} />
        </div>
        <div>
          <Label>Bullets</Label>
          <Segmented label="Bullet marker" value={opts.bulletListMarker} onChange={(v) => set('bulletListMarker', v)} options={[{ value: '-', label: '-' }, { value: '*', label: '*' }, { value: '+', label: '+' }]} />
        </div>
        <div>
          <Label>Code blocks</Label>
          <Segmented
            label="Code block style"
            value={opts.codeBlockStyle === 'indented' ? 'indented' : opts.fence}
            onChange={(v) => setOpts((o) => (v === 'indented' ? { ...o, codeBlockStyle: 'indented' } : { ...o, codeBlockStyle: 'fenced', fence: v }))}
            options={[{ value: '```', label: '```' }, { value: '~~~', label: '~~~' }, { value: 'indented', label: 'Indented' }]}
          />
        </div>
        <div>
          <Label>Emphasis</Label>
          <Segmented
            label="Emphasis delimiters"
            value={opts.emDelimiter === '*' ? 'star' : 'underscore'}
            onChange={(v) => setOpts((o) => (v === 'star' ? { ...o, emDelimiter: '*', strongDelimiter: '**' } : { ...o, emDelimiter: '_', strongDelimiter: '__' }))}
            options={[{ value: 'star', label: '*em* **strong**' }, { value: 'underscore', label: '_em_ __strong__' }]}
          />
        </div>
        <div>
          <Label>Links</Label>
          <Segmented label="Link style" value={opts.linkStyle} onChange={(v) => set('linkStyle', v)} options={[{ value: 'inlined', label: 'Inline' }, { value: 'referenced', label: 'Reference' }]} />
        </div>
        <Switch label="GFM tables & strikethrough" checked={opts.gfm} onChange={(v) => set('gfm', v)} className="h-8" />
      </ToolBar>
      <ErrorMessage error={result.error} />
      <SplitPanes>
        <EditorPanel
          title="HTML"
          value={input}
          onChange={setInput}
          language="html"
          placeholder="Paste HTML here…"
          sample={SAMPLE}
          fileAccept=".html,.htm,text/html,text/plain"
          height="520px"
        />
        <EditorPanel title="Markdown" value={input.trim() ? result.md : ''} language="markdown" placeholder="Markdown appears here" downloadName="document.md" downloadType="text/markdown" height="520px" />
      </SplitPanes>
      <p className="text-[12.5px] text-fg-muted">The HTML is sanitized first: scripts, styles and event handlers are dropped before conversion.</p>
    </ToolStack>
  );
}
