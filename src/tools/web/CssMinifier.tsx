import { EditorPanel, SplitPanes, ToolBar, ToolStack } from '@/components/tool/EditorPanel';
import { Alert, ErrorMessage } from '@/components/ui/Alert';
import { Switch } from '@/components/ui/Field';
import { Spinner } from '@/components/ui/Feedback';
import { useDebouncedValue, useToolState } from '@/lib/hooks';
import { errorMessage, formatBytes } from '@/lib/utils';
import { minifyCss, type CssMinifyOptions } from './lib/cssMinify';
import { SizeSavingsBar, useAsyncResult } from './code/shared';

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
  const [opts, setOpts] = useToolState<CssMinifyOptions>('css-minifier', 'options', { restructure: true, keepLicense: true });
  const debounced = useDebouncedValue(input, 200);

  const result = useAsyncResult(debounced.trim() ? JSON.stringify([debounced, opts]) : null, () => minifyCss(debounced, opts));
  const done = input.trim() && result.status === 'done' ? result.value : null;
  const error = input.trim() && result.status === 'error' ? errorMessage(result.error) : null;
  const output = done?.css ?? '';

  return (
    <ToolStack>
      <ToolBar>
        <Switch label="Restructure rules" checked={opts.restructure} onChange={(v) => setOpts((o) => ({ ...o, restructure: v }))} />
        <Switch label="Keep /*! license */ comments" checked={opts.keepLicense} onChange={(v) => setOpts((o) => ({ ...o, keepLicense: v }))} />
        <p className="basis-full text-[12.5px] text-fg-muted sm:basis-auto">
          Restructuring merges and moves rules for smaller output; turn it off if rule order matters in unusual cascades.
        </p>
      </ToolBar>
      <ErrorMessage error={error} title="Could not minify" />
      {done && done.issues.length > 0 && (
        <Alert tone="warning" title={`${done.issues.length} syntax ${done.issues.length === 1 ? 'problem' : 'problems'} found`}>
          <ul className="list-disc space-y-0.5 pl-4">
            {done.issues.slice(0, 8).map((i, n) => (
              <li key={n}>
                Line {i.line}, column {i.column}: {i.message}
              </li>
            ))}
          </ul>
          <p className="mt-1">The output skips or repairs these parts, so check it before using it.</p>
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
          height="460px"
          footer={input ? <span>{formatBytes(new Blob([input]).size)}</span> : undefined}
        />
        <EditorPanel
          title="Minified"
          value={output}
          language="css"
          placeholder="Minified CSS appears here"
          downloadName="styles.min.css"
          downloadType="text/css"
          height="460px"
          footer={result.status === 'pending' && input.trim() ? <Spinner size={13} label="Minifying…" /> : undefined}
        />
      </SplitPanes>
    </ToolStack>
  );
}
