import { EditorPanel, SplitPanes, ToolBar, ToolStack } from '@/components/tool/EditorPanel';
import { Alert, ErrorMessage } from '@/components/ui/Alert';
import { Switch } from '@/components/ui/Field';
import { useDebouncedValue, useToolState } from '@/lib/hooks';
import { formatBytes, pluralize } from '@/lib/utils';
import type { CssMinifyOptions } from './lib/cssMinify';
import { useCodeJob } from './code/codeRunner';
import { JobStatus, SizeSavingsBar, settledOutcome, useByteSize } from './code/shared';

const DEFAULTS: CssMinifyOptions = { restructure: true, keepLicense: true };

const SAMPLE = `/*! Theme v2.1 | MIT License */
:root {
  --accent: #2563eb;
  --radius: 12px;
}

/* Buttons */
.button {
  display: inline-flex;
  align-items: center;
  padding: 8px 16px 8px 16px;
  border-radius: var(--radius);
  background-color: #ffffff;
  color: #000000;
  font-weight: bold;
  margin: 0px 0px 0px 0px;
}

.link {
  color: #ff0000;
  font-weight: bold;
}

.button:hover,
.button:focus-visible {
  background-color: rgb(239, 246, 255);
}

@media (max-width: 640px) {
  .button { padding: 6px 12px; }
}
`;

export default function CssMinifier() {
  const [input, setInput] = useToolState('css-minifier', 'input', '');
  const [stored, setOpts] = useToolState<CssMinifyOptions>('css-minifier', 'options', DEFAULTS);
  const opts = { ...DEFAULTS, ...stored };
  const debounced = useDebouncedValue(input, input.length > 200_000 ? 500 : 250);

  // Runs in a worker: megabytes of CSS never freeze the page.
  const key = debounced.trim() ? JSON.stringify([debounced, opts]) : null;
  const job = useCodeJob<'minify-css'>(key, () => ({ kind: 'minify-css', code: debounced, options: opts }));
  const empty = !input.trim();
  const settled = empty ? null : settledOutcome(job.state, job.previous);
  const done = settled?.status === 'done' ? settled.value : null;
  const error = settled?.status === 'error' ? settled.error.message : null;
  const output = done?.css ?? '';
  const inputBytes = useByteSize(input);
  const outputBytes = useByteSize(output);
  const status = empty ? 'idle' : job.state.status;

  return (
    <ToolStack>
      <ToolBar>
        <Switch label="Restructure rules" checked={opts.restructure} onChange={(v) => setOpts((o) => ({ ...DEFAULTS, ...o, restructure: v }))} />
        <Switch label="Keep /*! license */ comments" checked={opts.keepLicense} onChange={(v) => setOpts((o) => ({ ...DEFAULTS, ...o, keepLicense: v }))} />
        <p className="basis-full text-[12.5px] text-fg-muted sm:basis-auto">
          Restructuring merges and moves rules for smaller output; turn it off if rule order matters in unusual cascades.
        </p>
      </ToolBar>
      <ErrorMessage error={error} title="Could not minify" />
      {done?.engine === 'compact' && (
        <Alert tone="info" title="CSS nesting detected">
          CSSO cannot optimize nested rules, so this stylesheet was compacted instead: comments and unneeded whitespace were
          removed and every rule was kept as written.
        </Alert>
      )}
      {done && done.issues.length > 0 && (
        <Alert
          tone="warning"
          title={
            done.engine === 'compact'
              ? `${pluralize(done.issues.length, 'syntax problem')} found`
              : `${pluralize(done.issues.length, 'part')} of the stylesheet could not be parsed`
          }
        >
          <ul className="list-disc space-y-0.5 pl-4">
            {done.issues.slice(0, 8).map((i, n) => (
              <li key={n}>
                Line {i.line}, column {i.column}: {i.message}
              </li>
            ))}
          </ul>
          <p className="mt-1">
            {done.engine === 'compact'
              ? 'Check these lines: browsers will ignore or misread them.'
              : 'This is either a syntax error or CSS syntax newer than the minifier. Such parts may be repaired or dropped, so compare the output before using it.'}
          </p>
        </Alert>
      )}
      {output && <SizeSavingsBar before={input} after={output} />}
      <SplitPanes>
        <EditorPanel
          title="CSS"
          value={input}
          onChange={setInput}
          language="css"
          placeholder="Paste CSS here…"
          sample={SAMPLE}
          fileAccept=".css,text/css,text/plain"
          invalid={Boolean(error)}
          height="460px"
          footer={input ? <span>{formatBytes(inputBytes)}</span> : undefined}
        />
        <EditorPanel
          title="Minified"
          value={output}
          language="css"
          placeholder="Minified CSS appears here"
          downloadName="styles.min.css"
          downloadType="text/css"
          height="460px"
          footer={
            status === 'pending' || status === 'cancelled' ? (
              <JobStatus status={status} busyLabel="Minifying…" onCancel={job.cancel} />
            ) : output ? (
              <span>{formatBytes(outputBytes)}</span>
            ) : undefined
          }
        />
      </SplitPanes>
    </ToolStack>
  );
}
