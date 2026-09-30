import { useMemo, useRef } from 'react';
import type { EditorView } from '@codemirror/view';
import { CircleCheck, CircleX, Crosshair, FileCheck, TriangleAlert } from 'lucide-react';
import { EditorPanel, ToolStack } from '@/components/tool/EditorPanel';
import { Panel, Stat } from '@/components/ui/Panel';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/Feedback';
import { useDebouncedValue, useToolState } from '@/lib/hooks';
import { cn, formatBytes, formatNumber, pluralize } from '@/lib/utils';
import { problemMarkers, revealPosition, type EditorProblem } from './shared/errorMarkers';
import { scanJson } from './lib/jsonScan';
import { jsonStats, stripBom } from './lib/json';
import { t } from '@/lib/i18n';

const SAMPLE = `{
  "id": 42,
  "name": "LocalKit",
  "active": true,
  "tags": ["json", "validator"],
  "owner": { "name": "Ada", "email": "ada@example.com" },
  "name": "Duplicate key: JSON.parse silently keeps this one"
}`;

function rootType(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return `array (${formatNumber(value.length)} items)`;
  if (typeof value === 'object') return `object (${formatNumber(Object.keys(value).length)} keys)`;
  return typeof value;
}

export default function JsonValidator() {
  const [input, setInput] = useToolState('json-validator', 'input', '');
  const viewRef = useRef<EditorView | null>(null);
  const debounced = useDebouncedValue(input, input.length > 200_000 ? 400 : 120);

  const result = useMemo(() => {
    if (!debounced.trim()) return null;
    const scan = scanJson(debounced);
    let value: unknown = undefined;
    if (scan.ok) {
      try {
        value = JSON.parse(stripBom(debounced));
      } catch {
        // The scanner and JSON.parse agree on validity; this is only a safeguard.
      }
    }
    const stats = scan.ok ? jsonStats(value) : null;
    let lines = 1;
    for (let i = 0; i < debounced.length; i++) if (debounced.charCodeAt(i) === 10) lines++;
    return { scan, value, stats, lines, bytes: new Blob([debounced]).size };
  }, [debounced]);

  const extensions = useMemo(() => {
    // Markers are rebuilt for each validated text; in between they follow edits.
    const problems: EditorProblem[] = [];
    if (result) {
      const { error, duplicates } = result.scan;
      if (error) problems.push({ line: error.line, column: error.column, length: error.length || 1, message: error.message });
      for (const d of duplicates) {
        problems.push({ line: d.line, column: d.column, length: d.key.length + 2, severity: 'warning', message: t('Duplicate key "{key}"', { key: d.key }) });
      }
    }
    return [problemMarkers(problems)];
  }, [result]);

  const error = result?.scan.error ?? null;
  const duplicates = result?.scan.duplicates ?? [];

  return (
    <ToolStack>
      <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <EditorPanel code
          title="JSON"
          value={input}
          onChange={setInput}
          language="json"
          placeholder={t('Paste or type JSON to validate…')}
          sample={SAMPLE}
          fileAccept=".json,application/json,text/plain"
          invalid={Boolean(error)}
          height="560px"
          extensions={extensions}
          onReady={(v) => (viewRef.current = v)}
          footer={
            result ? (
              <>
                <span>{formatBytes(result.bytes)}</span>
                <span>{pluralize(result.lines, t('line'), t('lines'))}</span>
              </>
            ) : undefined
          }
        />
        <div className="flex min-w-0 flex-col gap-4">
          {!result ? (
            <Panel title={t('Result')}>
              <EmptyState icon={FileCheck} title={t('Nothing to validate yet')}>
                {t('Paste JSON, open a file or load the sample. Errors are pinpointed to the exact line and column.')}
              </EmptyState>
            </Panel>
          ) : (
            <>
              <div
                role={error ? 'alert' : 'status'}
                className={cn(
                  'rounded-xl border px-4 py-3.5',
                  error ? 'border-transparent bg-danger-soft' : 'border-transparent bg-success-soft',
                )}
              >
                <div className="flex items-center gap-2">
                  {error ? (
                    <CircleX size={18} className="shrink-0 text-danger" aria-hidden />
                  ) : (
                    <CircleCheck size={18} className="shrink-0 text-success" aria-hidden />
                  )}
                  <p className="text-sm font-semibold text-fg">{error ? t('Invalid JSON') : t('Valid JSON')}</p>
                </div>
                {error ? (
                  <>
                    <p className="mt-1.5 text-[13px] break-words text-fg">{error.message}</p>
                    <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2">
                      <span className="font-mono text-[12.5px] text-fg-secondary">
                        {t('Line {line}, column {column}', { line: error.line, column: error.column })}
                      </span>
                      <Button size="sm" icon={Crosshair} onClick={() => revealPosition(viewRef.current, error.line, error.column)}>
                        {t('Go to error')}
                      </Button>
                    </div>
                  </>
                ) : (
                  <p className="mt-1 text-[13px] text-fg-secondary">
                    {t('Root is {rootType}.', { rootType: rootType(result.value) })}
                    {duplicates.length === 0 && ' No duplicate keys.'}
                  </p>
                )}
              </div>

              {duplicates.length > 0 && (
                <Panel
                  title={
                    <span className="inline-flex items-center gap-1.5">
                      <TriangleAlert size={14} className="text-warning" aria-hidden />
                      {pluralize(duplicates.length, t('duplicate key'), t('duplicate keys'))}
                    </span>
                  }
                  description={t('JSON.parse keeps only the last value for each.')}
                  bodyClassName="p-0"
                >
                  <ul className="max-h-64 divide-y divide-line overflow-y-auto">
                    {duplicates.map((d, i) => (
                      <li key={i}>
                        <button
                          type="button"
                          onClick={() => revealPosition(viewRef.current, d.line, d.column)}
                          className="flex w-full items-start justify-between gap-3 px-4 py-2 text-left hover:bg-surface-hover"
                        >
                          <span className="min-w-0">
                            <span className="block truncate font-mono text-[12.5px] text-fg">"{d.key}"</span>
                            <span className="block truncate font-mono text-[11.5px] text-fg-muted">{t('in {path}', { path: d.path })}</span>
                          </span>
                          <span className="shrink-0 text-[12px] text-fg-muted tabular-nums">
                            {t('line {line}', { line: d.line })}{' '}<span className="text-fg-muted">{t('(first {firstLine})', { firstLine: d.firstLine })}</span>
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </Panel>
              )}
              {result.scan.truncated && (
                <p className="text-[12.5px] text-fg-muted">
                  {t('Nesting is very deep; duplicate keys were checked only in the first 1,500 levels.')}
                </p>
              )}

              {result.stats && (
                <Panel title={t('Statistics')}>
                  <div className="grid grid-cols-2 gap-2">
                    <Stat label={t('Objects')} value={formatNumber(result.stats.objects)} />
                    <Stat label={t('Arrays')} value={formatNumber(result.stats.arrays)} />
                    <Stat label={t('Keys')} value={formatNumber(result.stats.keys)} />
                    <Stat label={t('Max depth')} value={formatNumber(result.stats.maxDepth)} />
                    <Stat label={t('Strings')} value={formatNumber(result.stats.strings)} />
                    <Stat label={t('Numbers')} value={formatNumber(result.stats.numbers)} />
                    <Stat label={t('Booleans')} value={formatNumber(result.stats.booleans)} />
                    <Stat label={t('Nulls')} value={formatNumber(result.stats.nulls)} />
                  </div>
                </Panel>
              )}
            </>
          )}
        </div>
      </div>
    </ToolStack>
  );
}
