import { EditorPanel, SplitPanes, ToolBar, ToolStack } from '@/components/tool/EditorPanel';
import { ErrorMessage } from '@/components/ui/Alert';
import { Switch } from '@/components/ui/Field';
import { Spinner } from '@/components/ui/Feedback';
import { useDebouncedValue, useToolState } from '@/lib/hooks';
import { errorMessage, formatBytes } from '@/lib/utils';
import { DEFAULT_HTML_OPTIONS, defaultHooks, minifyHtml, type HtmlMinifyOptions } from './lib/htmlMinify';
import { SizeSavingsBar, useAsyncResult } from './code/shared';

const SAMPLE = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>  My   landing page  </title>
    <!-- Main styles -->
    <style>
      body { margin: 0; font-family: system-ui, sans-serif; color: #111827; }
      .hero { padding: 48px 24px; background: #eff6ff; }
    </style>
    <!--[if lt IE 9]><script src="html5shiv.js"></script><![endif]-->
  </head>
  <body>
    <section class="  hero  main ">
      <h1>Build <em>faster</em> with LocalKit</h1>
      <p style="margin-top: 0px; color: #ff0000">
        Everything runs   in your browser.
        <a href="/start">Get started</a> or <a href="/docs">read the docs</a>.
      </p>
      <pre>
  indentation   is
    preserved here
      </pre>
    </section>
    <script>
      // Greet the visitor
      const greeting = 'Hello';
      document.querySelector('h1').addEventListener('click', function () {
        console.log(greeting + ', world');
      });
    </script>
  </body>
</html>
`;

export default function HtmlMinifier() {
  const [input, setInput] = useToolState('html-minifier', 'input', '');
  const [opts, setOpts] = useToolState<HtmlMinifyOptions>('html-minifier', 'options', DEFAULT_HTML_OPTIONS);
  const debounced = useDebouncedValue(input, 250);
  const set = <K extends keyof HtmlMinifyOptions>(k: K, v: HtmlMinifyOptions[K]) => setOpts((o) => ({ ...o, [k]: v }));

  const result = useAsyncResult(debounced.trim() ? JSON.stringify([debounced, opts]) : null, () =>
    minifyHtml(debounced, opts, defaultHooks()),
  );
  const output = input.trim() && result.status === 'done' ? result.value : '';
  const error = input.trim() && result.status === 'error' ? errorMessage(result.error) : null;

  return (
    <ToolStack>
      <ToolBar>
        <Switch label="Remove comments" checked={opts.removeComments} onChange={(v) => set('removeComments', v)} />
        <Switch label="Keep “!” license comments" checked={opts.keepBangComments} onChange={(v) => set('keepBangComments', v)} disabled={!opts.removeComments} />
        <Switch label="Collapse whitespace" checked={opts.collapseWhitespace} onChange={(v) => set('collapseWhitespace', v)} />
        <Switch label="Minify inline CSS" checked={opts.minifyCss} onChange={(v) => set('minifyCss', v)} />
        <Switch label="Minify inline JS" checked={opts.minifyJs} onChange={(v) => set('minifyJs', v)} />
      </ToolBar>
      <ErrorMessage error={error} title="Could not minify" />
      {output && <SizeSavingsBar before={input} after={output} />}
      <SplitPanes>
        <EditorPanel
          title="HTML"
          value={input}
          onChange={setInput}
          language="html"
          placeholder="Paste HTML here…"
          sample={SAMPLE}
          fileAccept=".html,.htm,text/html,text/plain"
          invalid={Boolean(error)}
          height="480px"
          footer={input ? <span>{formatBytes(new Blob([input]).size)}</span> : undefined}
        />
        <EditorPanel
          title="Minified"
          value={output}
          language="html"
          placeholder="Minified HTML appears here"
          downloadName="index.min.html"
          downloadType="text/html"
          height="480px"
          footer={result.status === 'pending' && input.trim() ? <Spinner size={13} label="Minifying…" /> : undefined}
        />
      </SplitPanes>
      <p className="text-[12.5px] leading-relaxed text-fg-muted">
        Conditional comments and the contents of &lt;pre&gt;, &lt;textarea&gt;, &lt;script&gt; and &lt;style&gt; are never
        reflowed. Whitespace next to inline elements is kept as a single space so words never merge. Scripts with an unknown
        type (templates) are left untouched; JSON and JSON-LD scripts are compacted.
      </p>
    </ToolStack>
  );
}
