import { EditorPanel, SplitPanes, ToolBar, ToolStack } from '@/components/tool/EditorPanel';
import { Alert, ErrorMessage } from '@/components/ui/Alert';
import { Switch } from '@/components/ui/Field';
import { useDebouncedValue, useToolState } from '@/lib/hooks';
import { formatBytes, pluralize } from '@/lib/utils';
import { DEFAULT_HTML_OPTIONS, type HtmlMinifyOptions } from './lib/htmlMinify';
import { useCodeJob } from './code/codeRunner';
import { JobStatus, SizeSavingsBar, settledOutcome, useByteSize } from './code/shared';
import { t } from '@/lib/i18n';

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
  const [stored, setOpts] = useToolState<HtmlMinifyOptions>('html-minifier', 'options', DEFAULT_HTML_OPTIONS);
  const opts = { ...DEFAULT_HTML_OPTIONS, ...stored };
  const debounced = useDebouncedValue(input, input.length > 200_000 ? 500 : 250);
  const set = <K extends keyof HtmlMinifyOptions>(k: K, v: HtmlMinifyOptions[K]) => setOpts((o) => ({ ...DEFAULT_HTML_OPTIONS, ...o, [k]: v }));

  // Runs in a worker: large pages with inline scripts never freeze the page.
  const key = debounced.trim() ? JSON.stringify([debounced, opts]) : null;
  const job = useCodeJob<'minify-html'>(key, () => ({ kind: 'minify-html', code: debounced, options: opts }));
  const empty = !input.trim();
  const settled = empty ? null : settledOutcome(job.state, job.previous);
  const output = settled?.status === 'done' ? settled.value.html : '';
  const warnings = settled?.status === 'done' ? settled.value.warnings : [];
  const error = settled?.status === 'error' ? settled.error.message : null;
  const inputBytes = useByteSize(input);
  const outputBytes = useByteSize(output);
  const status = empty ? 'idle' : job.state.status;

  return (
    <ToolStack>
      <ToolBar>
        <Switch label={t('Remove comments')} checked={opts.removeComments} onChange={(v) => set('removeComments', v)} />
        <Switch label={t('Keep “!” license comments')} checked={opts.keepBangComments} onChange={(v) => set('keepBangComments', v)} disabled={!opts.removeComments} />
        <Switch label={t('Collapse whitespace')} checked={opts.collapseWhitespace} onChange={(v) => set('collapseWhitespace', v)} />
        <Switch label={t('Minify inline CSS')} checked={opts.minifyCss} onChange={(v) => set('minifyCss', v)} />
        <Switch label={t('Minify inline JS')} checked={opts.minifyJs} onChange={(v) => set('minifyJs', v)} />
      </ToolBar>
      <ErrorMessage error={error} title={t('Could not minify')} />
      {warnings.length > 0 && (
        <Alert tone="warning" title={(warnings.length === 1) ? t('{count} could not be minified and was kept as written', { count: pluralize(warnings.length, t('block'), t('blocks')) }) : t('{count} could not be minified and were kept as written', { count: pluralize(warnings.length, t('block'), t('blocks')) })}>
          <ul className="list-disc space-y-0.5 pl-4">
            {warnings.slice(0, 8).map((w, n) => (
              <li key={n}>
                {t('Line {line}, column {column} (<{block}>): {message}', { line: w.line, column: w.column, block: w.block, message: w.message })}
              </li>
            ))}
          </ul>
          {warnings.length > 8 && <p className="mt-1">{t('…and {count} more.', { count: warnings.length - 8 })}</p>}
        </Alert>
      )}
      {output && <SizeSavingsBar before={input} after={output} />}
      <SplitPanes>
        <EditorPanel
          title="HTML"
          value={input}
          onChange={setInput}
          language="html"
          placeholder={t('Paste HTML here…')}
          sample={SAMPLE}
          fileAccept=".html,.htm,.xhtml,text/html,text/plain"
          invalid={Boolean(error)}
          height="480px"
          footer={input ? <span>{formatBytes(inputBytes)}</span> : undefined}
        />
        <EditorPanel
          title={t('Minified')}
          value={output}
          language="html"
          placeholder={t('Minified HTML appears here')}
          downloadName="index.min.html"
          downloadType="text/html"
          height="480px"
          footer={
            status === 'pending' || status === 'cancelled' ? (
              <JobStatus status={status} busyLabel={t('Minifying…')} onCancel={job.cancel} />
            ) : output ? (
              <span>{formatBytes(outputBytes)}</span>
            ) : undefined
          }
        />
      </SplitPanes>
      <p className="text-[12.5px] leading-relaxed text-fg-muted">
        {t('Conditional comments, server-side include directives (<!--#include …-->) and Knockout bindings are kept. The contents of <pre>, <textarea>, <script>, <style> and of elements styled with white-space: pre are never reflowed. Whitespace next to inline elements is kept as a single space so words never merge. Scripts with an unknown type (templates) are left untouched; JSON and JSON-LD scripts are compacted.')}
      </p>
    </ToolStack>
  );
}
