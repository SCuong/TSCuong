import { useDeferredValue, useMemo } from 'react';
import { EditorPanel, SplitPanes, ToolBar, ToolStack } from '@/components/tool/EditorPanel';
import { Input, NumberInput, Select, Switch } from '@/components/ui/Field';
import { Badge, Panel } from '@/components/ui/Panel';
import { Segmented } from '@/components/ui/Segmented';
import { useToolState } from '@/lib/hooks';
import { formatBytes, formatNumber, pluralize } from '@/lib/utils';
import { OutputPanel } from '@/tools/data/csv/components/OutputPanel';
import { utf8Bytes } from '../convert/lib/common';
import { DirectionHint, ErrorPanel, NotesPanel, Option, TextStats, useEditorView, useProblemMarkers } from '../convert/shared/ConvertUi';
import {
  datasetFromCsv,
  datasetFromJson,
  defaultQuoting,
  generateInserts,
  INSERT_DIALECTS,
  quoteIdentifier,
  sqlTypeName,
  type IdentifierQuoting,
  type InsertDialect,
  type InsertOptions,
} from './lib/sqlInsert';
import { t } from '@/lib/i18n';

const TOOL = 'sql-insert-generator';

const SAMPLE_JSON = `[
  { "id": 1, "name": "Ada Lovelace", "email": "ada@example.com", "active": true, "signup": "2024-01-15", "score": 98.5, "tags": ["admin", "beta"] },
  { "id": 2, "name": "O'Brien, Pat", "email": null, "active": false, "signup": "2024-02-01", "score": 71.25, "tags": [] },
  { "id": 3, "name": "Zoë Chen", "email": "zoe@example.com", "active": true, "signup": "2024-03-09", "score": 88, "notes": "Path: C:\\\\temp\\\\new" }
]`;

const SAMPLE_CSV = `id,name,email,active,signup,score
1,Ada Lovelace,ada@example.com,true,2024-01-15,98.5
2,"O'Brien, Pat",,false,2024-02-01,71.25
3,Zoë Chen,zoe@example.com,true,2024-03-09,88
`;

type InputFormat = 'json' | 'csv';

interface CsvSettings {
  delimiter: string;
  detectTypes: boolean;
  emptyAsNull: boolean;
}

const QUOTE_LABELS: Record<'double' | 'backtick' | 'bracket', string> = { double: '"name"', backtick: '`name`', bracket: '[name]' };

export default function SqlInsertGenerator() {
  const [input, setInput] = useToolState(TOOL, 'input', '');
  const [format, setFormat] = useToolState<InputFormat>(TOOL, 'format', 'json');
  const [o, setO] = useToolState<InsertOptions>(TOOL, 'options', {
    table: 'my_table',
    dialect: 'postgresql',
    quoting: 'auto',
    batchSize: 1,
    createTable: true,
    includeColumns: true,
    transaction: false,
    detectDates: true,
  });
  const [c, setC] = useToolState<CsvSettings>(TOOL, 'csv', { delimiter: '', detectTypes: true, emptyAsNull: true });
  const set = <K extends keyof InsertOptions>(key: K, value: InsertOptions[K]) => setO((prev) => ({ ...prev, [key]: value }));
  const setCsv = <K extends keyof CsvSettings>(key: K, value: CsvSettings[K]) => setC((prev) => ({ ...prev, [key]: value }));
  const editor = useEditorView();

  const deferred = useDeferredValue(input);
  const dataset = useMemo(() => {
    if (!deferred.trim()) return null;
    return format === 'json' ? datasetFromJson(deferred) : datasetFromCsv(deferred, c);
  }, [deferred, format, c]);
  const result = useMemo(() => (dataset?.ok ? generateInserts(dataset.data, o) : null), [dataset, o]);

  const inputError = dataset && !dataset.ok ? dataset.error : null;
  const markers = useProblemMarkers(inputError);
  const output = result?.ok ? result.sql : '';
  const notes = [...(dataset?.ok ? dataset.data.notes : []), ...(result?.ok ? result.warnings : [])];
  const outBytes = useMemo(() => utf8Bytes(output), [output]);
  const looksLikeCsv = format === 'json' && Boolean(inputError) && !/^\s*[[{]/.test(deferred) && /[,;\t]/.test(deferred.split('\n', 1)[0] ?? '');
  const looksLikeJsonInput = format === 'csv' && /^\s*[[{]/.test(deferred);
  const autoStyle = defaultQuoting(o.dialect);

  return (
    <ToolStack>
      <ToolBar>
        <Option label={t('Input')}>
          <Segmented
            label={t('Input')}
            value={format}
            onChange={setFormat}
            options={[
              { value: 'json', label: 'JSON' },
              { value: 'csv', label: 'CSV' },
            ]}
          />
        </Option>
        <Option label={t('Database')} htmlFor="ins-dialect" className="w-40">
          <Select id="ins-dialect" value={o.dialect} onChange={(e) => set('dialect', e.target.value as InsertDialect)} className="h-8 py-1 text-[13px]">
            {INSERT_DIALECTS.map((d) => (
              <option key={d.value} value={d.value}>
                {d.label}
              </option>
            ))}
          </Select>
        </Option>
        <Option label={t('Table')} htmlFor="ins-table" className="w-40">
          <Input
            id="ins-table"
            value={o.table}
            onChange={(e) => set('table', e.target.value)}
            placeholder="schema.table"
            spellCheck={false}
            className="h-8 py-1 font-mono text-[13px]"
          />
        </Option>
        <Option label={t('Quote names')} htmlFor="ins-quote" className="w-40">
          <Select id="ins-quote" value={o.quoting} onChange={(e) => set('quoting', e.target.value as IdentifierQuoting)} className="h-8 py-1 text-[13px]">
            <option value="auto">{t('Always {QUOTE_LABELS}', { QUOTE_LABELS: QUOTE_LABELS[autoStyle] })}</option>
            <option value="minimal">{t('Only when needed')}</option>
            <option value="double">{t('Always "name"')}</option>
            <option value="backtick">{t('Always `name`')}</option>
            <option value="bracket">{t('Always [name]')}</option>
          </Select>
        </Option>
        <Option label={t('Rows per INSERT')} htmlFor="ins-batch" className="w-32">
          <NumberInput
            id="ins-batch"
            min={1}
            max={10000}
            step={1}
            value={o.batchSize}
            onChange={(v) => set('batchSize', v === '' ? 1 : Math.min(10000, Math.max(1, Math.round(v))))}
            className="h-8 py-1 text-[13px]"
          />
        </Option>
        <div className="flex w-full min-w-0 flex-wrap items-center gap-x-5 gap-y-2">
          <Switch label={t('CREATE TABLE with inferred types')} checked={o.createTable} onChange={(v) => set('createTable', v)} />
          <Switch label={t('Column list')} checked={o.includeColumns} onChange={(v) => set('includeColumns', v)} />
          <Switch label={t('Wrap in a transaction')} checked={o.transaction} onChange={(v) => set('transaction', v)} />
          <Switch label={t('Detect dates')} checked={o.detectDates} onChange={(v) => set('detectDates', v)} />
          {format === 'csv' && (
            <>
              <Switch label={t('Numbers & booleans')} checked={c.detectTypes} onChange={(v) => setCsv('detectTypes', v)} />
              <Switch label={t('Empty cells as NULL')} checked={c.emptyAsNull} onChange={(v) => setCsv('emptyAsNull', v)} />
              <div className="flex items-center gap-2">
                <label htmlFor="ins-delim" className="text-sm text-fg">
                  {t('Delimiter')}
                </label>
                <Select id="ins-delim" value={c.delimiter} onChange={(e) => setCsv('delimiter', e.target.value)} className="h-8 w-32 py-1 text-[13px]">
                  <option value="">{t('Auto-detect')}</option>
                  <option value=",">{t('Comma')}</option>
                  <option value=";">{t('Semicolon')}</option>
                  <option value={'\t'}>Tab</option>
                  <option value="|">{t('Pipe')}</option>
                </Select>
              </div>
            </>
          )}
        </div>
      </ToolBar>

      {looksLikeCsv && (
        <DirectionHint actionLabel={t('Read as CSV')} onAction={() => setFormat('csv')}>
          {t('This input looks like CSV rather than JSON.')}
        </DirectionHint>
      )}
      {looksLikeJsonInput && (
        <DirectionHint actionLabel={t('Read as JSON')} onAction={() => setFormat('json')}>
          {t('This input looks like JSON rather than CSV.')}
        </DirectionHint>
      )}
      <ErrorPanel title={format === 'json' ? t('Invalid JSON') : t('Cannot read this CSV')} error={inputError} onReveal={() => editor.reveal(inputError?.line, inputError?.column)} />
      <ErrorPanel title={t('Cannot generate SQL')} error={result && !result.ok ? { message: result.error } : null} />
      <NotesPanel notes={notes} title={t('Notes')} />

      <SplitPanes>
        <EditorPanel code
          title={format === 'json' ? t('JSON records') : t('CSV with a header row')}
          value={input}
          onChange={setInput}
          language={format === 'json' ? 'json' : 'plain'}
          placeholder={format === 'json' ? t('Paste a JSON array of objects…') : t('Paste CSV (first row = column names)…')}
          sample={format === 'json' ? SAMPLE_JSON : SAMPLE_CSV}
          fileAccept={format === 'json' ? '.json,application/json,text/plain' : '.csv,.tsv,.txt,text/csv,text/plain'}
          invalid={Boolean(inputError)}
          height="480px"
          lineWrapping={false}
          extensions={markers}
          onReady={editor.onReady}
          footer={input ? <TextStats text={input} /> : undefined}
        />
        <OutputPanel
          title="SQL"
          value={output}
          language="sql"
          downloadName={`${(o.table.trim() || 'data').replace(/[^\w.-]+/g, '_')}.sql`}
          downloadType="application/sql"
          placeholder={t('INSERT statements appear here')}
          height="480px"
          bytes={outBytes}
          footer={
            result?.ok ? (
              <>
                <span>{pluralize(result.rows, t('row'), t('rows'))}</span>
                <span>{pluralize(result.statements, t('INSERT statement'), t('INSERT statements'))}</span>
                <span>{formatBytes(outBytes)}</span>
              </>
            ) : undefined
          }
        />
      </SplitPanes>

      {result?.ok && dataset?.ok && dataset.data.columns.length > 0 && (
        <Panel title={t('Columns')} description={t('Types are inferred from every value; nested objects and arrays are stored as JSON text.')} bodyClassName="p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[420px] text-left text-[13px]">
              <thead className="border-b border-line text-[12px] text-fg-muted">
                <tr>
                  <th scope="col" className="px-4 py-2 font-medium">
                    {t('Column')}
                  </th>
                  <th scope="col" className="px-4 py-2 font-medium">
                    {t('SQL type ({label})', { label: INSERT_DIALECTS.find((d) => d.value === o.dialect)?.label })}
                  </th>
                  <th scope="col" className="px-4 py-2 font-medium">
                    {t('Values')}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {dataset.data.columns.slice(0, 200).map((name, i) => {
                  const colType = result.types[i];
                  return (
                    <tr key={`${name}-${i}`}>
                      <td className="px-4 py-1.5 font-mono text-[12.5px] break-all text-fg">{quoteIdentifier(name, o.dialect, o.quoting)}</td>
                      <td className="px-4 py-1.5 font-mono text-[12.5px] text-fg-secondary">{sqlTypeName(colType, o.dialect)}</td>
                      <td className="px-4 py-1.5">
                        {colType.kind === 'unknown' ? (
                          <Badge tone="warning">{t('all NULL')}</Badge>
                        ) : colType.nullable ? (
                          <Badge>{t('has NULLs')}</Badge>
                        ) : (
                          <Badge tone="success">{t('no NULLs')}</Badge>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {dataset.data.columns.length > 200 && (
            <p className="border-t border-line px-4 py-2 text-[12.5px] text-fg-muted">
              {t('Showing 200 of {count} columns.', { count: formatNumber(dataset.data.columns.length) })}
            </p>
          )}
        </Panel>
      )}
    </ToolStack>
  );
}
