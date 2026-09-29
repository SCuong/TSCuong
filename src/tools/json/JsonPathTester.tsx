import { useMemo, useState } from 'react';
import { BookOpen, Route } from 'lucide-react';
import { EditorPanel, SplitPanes, ToolStack } from '@/components/tool/EditorPanel';
import { Input } from '@/components/ui/Field';
import { Segmented } from '@/components/ui/Segmented';
import { ErrorMessage } from '@/components/ui/Alert';
import { Badge, Panel } from '@/components/ui/Panel';
import { CopyButton } from '@/components/ui/Actions';
import { EmptyState } from '@/components/ui/Feedback';
import { useDebouncedValue, useToolState } from '@/lib/hooks';
import { cn, formatNumber, pluralize } from '@/lib/utils';
import { CodeEditor } from '@/components/editor/CodeEditor';
import { formatJsonError, parseJson } from './lib/json';
import { JSONPATH_EXAMPLES, runJsonPath } from './lib/jsonpath';

const SAMPLE = JSON.stringify(
  {
    store: {
      book: [
        { category: 'reference', author: 'Nigel Rees', title: 'Sayings of the Century', price: 8.95, tags: ['quotes'] },
        { category: 'fiction', author: 'Evelyn Waugh', title: 'Sword of Honour', price: 12.99, tags: [] },
        { category: 'fiction', author: 'Herman Melville', title: 'Moby Dick', isbn: '0-553-21311-3', price: 8.99, tags: ['sea'] },
        { category: 'fiction', author: 'J. R. R. Tolkien', title: 'The Lord of the Rings', isbn: '0-395-19395-8', price: 22.99, tags: ['fantasy', 'epic'] },
      ],
      bicycle: { color: 'red', price: 399 },
    },
  },
  null,
  2,
);

function preview(value: unknown): string {
  const s = JSON.stringify(value);
  return s.length > 200 ? `${s.slice(0, 200)}…` : s;
}

export default function JsonPathTester() {
  const [input, setInput] = useToolState('jsonpath-tester', 'input', '');
  const [expr, setExpr] = useToolState('jsonpath-tester', 'expr', '$.store.book[?@.price < 10].title');
  const [view, setView] = useToolState<'values' | 'paths'>('jsonpath-tester', 'view', 'values');
  const [pathForm, setPathForm] = useState<'pretty' | 'path' | 'pointer'>('pretty');
  const doc = useDebouncedValue(input, 150);
  const q = useDebouncedValue(expr, 120);

  const parsed = useMemo(() => (doc.trim() ? parseJson(doc) : null), [doc]);
  const result = useMemo(() => (parsed?.ok ? runJsonPath(q, parsed.value) : null), [parsed, q]);

  const valuesText = useMemo(
    () => (result?.ok ? JSON.stringify(result.matches.map((m) => m.value), null, 2) : ''),
    [result],
  );
  const pathsText = useMemo(
    () => (result?.ok ? result.matches.map((m) => (pathForm === 'path' ? m.path : pathForm === 'pointer' ? m.pointer : m.pretty)).join('\n') : ''),
    [result, pathForm],
  );

  const trimmed = q.trim();
  const queryError = result && !result.ok ? result : null;

  return (
    <ToolStack>
      <div className="rounded-xl border border-line bg-surface px-4 py-3 shadow-card">
        <label htmlFor="jsonpath-expr" className="mb-1.5 block text-[13px] font-medium text-fg-secondary">
          JSONPath expression <span className="font-normal text-fg-muted">(RFC 9535)</span>
        </label>
        <Input
          id="jsonpath-expr"
          mono
          value={expr}
          onChange={(e) => setExpr(e.target.value)}
          placeholder="$.store.book[*].title"
          aria-invalid={Boolean(queryError) || undefined}
          spellCheck={false}
          autoComplete="off"
        />
        {queryError && (
          <div role="alert" className="mt-2 rounded-lg bg-danger-soft px-3 py-2 text-[13px]">
            <p className="text-fg">{queryError.message}</p>
            {queryError.index !== null && trimmed && (
              <pre className="mt-1.5 overflow-x-auto font-mono text-[12.5px] leading-5 text-fg-secondary">
                {trimmed}
                {'\n'}
                <span className="text-danger">{' '.repeat(Math.min(queryError.index, trimmed.length)) + '^'}</span>
              </pre>
            )}
          </div>
        )}
      </div>

      <SplitPanes>
        <EditorPanel code
          title="JSON document"
          value={input}
          onChange={setInput}
          language="json"
          placeholder="Paste JSON to query…"
          sample={SAMPLE}
          fileAccept=".json,application/json,text/plain"
          invalid={Boolean(parsed && !parsed.ok)}
          height="460px"
        />
        <section className="flex min-w-0 flex-col rounded-xl border border-line bg-surface shadow-card">
          <header className="flex min-h-11 flex-wrap items-center justify-between gap-2 border-b border-line py-1.5 pr-2 pl-4">
            <h2 className="flex items-center gap-2 text-[13px] font-semibold tracking-tight text-fg">
              Result
              {result?.ok && <Badge tone={result.matches.length ? 'accent' : 'neutral'}>{pluralize(result.matches.length, 'match', 'matches')}</Badge>}
            </h2>
            <div className="flex flex-wrap items-center gap-1.5">
              <Segmented
                label="Result view"
                size="sm"
                value={view}
                onChange={setView}
                options={[
                  { value: 'values', label: 'Values' },
                  { value: 'paths', label: 'Paths' },
                ]}
              />
              <CopyButton value={view === 'values' ? valuesText : pathsText} iconOnly label={view === 'values' ? 'Copy values' : 'Copy paths'} />
            </div>
          </header>
          <div className="min-h-0 flex-1 p-2" style={{ height: 460 }}>
            {parsed && !parsed.ok ? (
              <div className="p-2">
                <ErrorMessage title="Invalid JSON" error={formatJsonError(parsed.error)} />
              </div>
            ) : !result ? (
              <EmptyState icon={Route} title="Paste a JSON document">
                Results update live as you type the expression.
              </EmptyState>
            ) : !result.ok ? (
              <EmptyState title="Fix the expression to see results" />
            ) : result.matches.length === 0 ? (
              <EmptyState title="No matches">The expression is valid but selects nothing in this document.</EmptyState>
            ) : view === 'values' ? (
              <CodePanelInline value={valuesText} />
            ) : (
              <div className="flex h-full flex-col">
                <div className="mb-2 flex items-center gap-2 px-1">
                  <Segmented
                    label="Path format"
                    size="sm"
                    value={pathForm}
                    onChange={setPathForm}
                    options={[
                      { value: 'pretty', label: 'Shorthand' },
                      { value: 'path', label: 'Normalized' },
                      { value: 'pointer', label: 'JSON Pointer' },
                    ]}
                  />
                </div>
                <ul className="min-h-0 flex-1 divide-y divide-line overflow-auto rounded-lg border border-line-strong bg-surface-sunken font-mono text-[12.5px]">
                  {result.matches.map((m, i) => (
                    <li key={i} className="px-3 py-1.5">
                      <div className="break-all text-accent-text">{pathForm === 'path' ? m.path : pathForm === 'pointer' ? m.pointer || '(root)' : m.pretty}</div>
                      <div className="truncate text-fg-secondary">{preview(m.value)}</div>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
          {result?.ok && result.truncated && (
            <footer className="border-t border-line px-4 py-1.5 text-[12.5px] text-fg-muted">
              Showing the first {formatNumber(result.matches.length)} matches.
            </footer>
          )}
        </section>
      </SplitPanes>

      <Panel
        title={
          <span className="inline-flex items-center gap-1.5">
            <BookOpen size={14} aria-hidden className="text-fg-muted" /> Cheat sheet
          </span>
        }
        description="Click an example to try it (they match the sample document)."
        bodyClassName="p-2"
      >
        <ul className="grid grid-cols-1 gap-1 sm:grid-cols-2 xl:grid-cols-3">
          {JSONPATH_EXAMPLES.map((ex) => (
            <li key={ex.expr}>
              <button
                type="button"
                onClick={() => setExpr(ex.expr)}
                className={cn(
                  'flex w-full flex-col items-start rounded-lg px-3 py-2 text-left hover:bg-surface-hover',
                  ex.expr === expr && 'bg-accent-soft',
                )}
              >
                <code className="font-mono text-[12.5px] break-all text-accent-text">{ex.expr}</code>
                <span className="text-[12.5px] text-fg-muted">{ex.description}</span>
              </button>
            </li>
          ))}
        </ul>
      </Panel>
    </ToolStack>
  );
}

function CodePanelInline({ value }: { value: string }) {
  return <CodeEditor value={value} language="json" readOnly ariaLabel="Query result" className="h-full" />;
}
