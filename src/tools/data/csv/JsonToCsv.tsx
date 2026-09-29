import { useMemo, useState } from 'react';
import { EditorPanel, SplitPanes, ToolBar, ToolStack } from '@/components/tool/EditorPanel';
import { Alert, ErrorMessage } from '@/components/ui/Alert';
import { CopyButton, DownloadButton } from '@/components/ui/Actions';
import { Input, Label, Select, Switch } from '@/components/ui/Field';
import { Segmented } from '@/components/ui/Segmented';
import { useDebouncedValue, useToolState } from '@/lib/hooks';
import { errorMessage, formatBytes, pluralize } from '@/lib/utils';
import { formatJsonError, parseJson } from '@/tools/json/lib/json';
import { DELIMITERS, writeCsv } from './lib/csv';
import { jsonToTable, type ArrayMode } from './lib/csvJson';
import { CsvGrid, type GridCell } from './components/CsvGrid';
import { OutputPanel } from './components/OutputPanel';
import { SAMPLE_JSON } from './components/samples';

const TOOL = 'json-to-csv';

export default function JsonToCsv() {
  const [input, setInput] = useToolState(TOOL, 'input', '');
  const [flatten, setFlatten] = useToolState(TOOL, 'flatten', true);
  const [arrays, setArrays] = useToolState<ArrayMode>(TOOL, 'arrays', 'json');
  const [separator, setSeparator] = useToolState(TOOL, 'separator', '.');
  const [delimiter, setDelimiter] = useToolState(TOOL, 'delimiter', ',');
  const [firstRowHeader, setFirstRowHeader] = useToolState(TOOL, 'firstRowHeader', true);
  const [view, setView] = useState<'text' | 'table'>('text');
  const [selected, setSelected] = useState<GridCell | null>(null);

  const debounced = useDebouncedValue(input, input.length > 1_000_000 ? 400 : 150);

  const result = useMemo(() => {
    if (!debounced.trim()) return null;
    const parsed = parseJson(debounced);
    if (!parsed.ok) return { ok: false as const, title: 'Invalid JSON', error: formatJsonError(parsed.error) };
    try {
      const value = parsed.value;
      const conv = jsonToTable(value, { flatten, arrays, separator: separator || '.', firstRowHeader });
      const rowsAreArrays = Array.isArray(value) && value.length > 0 && value.every(Array.isArray);
      const csv = conv.table.headers.length ? writeCsv(conv.table, { delimiter }) : '';
      return { ok: true as const, ...conv, csv, rowsAreArrays, bytes: new Blob([csv]).size };
    } catch (error) {
      return { ok: false as const, title: 'Cannot convert', error: errorMessage(error, 'Could not convert this JSON.') };
    }
  }, [debounced, flatten, arrays, separator, firstRowHeader, delimiter]);

  const ok = result?.ok ? result : null;
  const output = ok?.csv ?? '';
  const ext = delimiter === '\t' ? 'tsv' : 'csv';
  const viewIndex = useMemo(() => (ok ? Array.from({ length: ok.table.rows.length }, (_, i) => i) : []), [ok]);

  return (
    <ToolStack>
      <ToolBar>
        <Switch label="Flatten nested objects" checked={flatten} onChange={setFlatten} className="h-8" />
        <div>
          <Label>Arrays</Label>
          <Segmented
            label="Arrays"
            value={arrays}
            onChange={setArrays}
            options={[
              { value: 'json', label: 'As JSON', title: 'Keep arrays as JSON text in one cell' },
              { value: 'join', label: 'Join', title: 'Join arrays of plain values with “; ”' },
              { value: 'index', label: 'Columns', title: 'One column per index: tags.0, tags.1…' },
            ]}
          />
        </div>
        <div className="w-24">
          <Label htmlFor="j2c-sep">Key separator</Label>
          <Input
            id="j2c-sep"
            value={separator}
            onChange={(e) => setSeparator(e.target.value.slice(0, 3))}
            className="h-8 py-1 font-mono text-[13px]"
            placeholder="."
          />
        </div>
        <div className="w-36">
          <Label htmlFor="j2c-delim">Output delimiter</Label>
          <Select id="j2c-delim" value={delimiter} onChange={(e) => setDelimiter(e.target.value)} className="h-8 py-1 text-[13px]">
            {DELIMITERS.map((d) => (
              <option key={d.label} value={d.value}>
                {d.label}
              </option>
            ))}
          </Select>
        </div>
        {ok?.rowsAreArrays && (
          <Switch label="First inner array is the header" checked={firstRowHeader} onChange={setFirstRowHeader} className="h-8" />
        )}
      </ToolBar>
      {result && !result.ok && <ErrorMessage error={result.error} title={result.title} />}
      {ok && ok.notes.length > 0 && (
        <Alert tone="info">
          {ok.notes.map((n) => (
            <p key={n}>{n}</p>
          ))}
        </Alert>
      )}
      <SplitPanes>
        <EditorPanel
          title="JSON input"
          value={input}
          onChange={setInput}
          language="json"
          placeholder="Paste a JSON array of objects (or an object that contains one)…"
          sample={SAMPLE_JSON}
          fileAccept=".json,application/json,text/plain"
          invalid={Boolean(result && !result.ok)}
          height="480px"
        />
        {view === 'text' || !ok ? (
          <OutputPanel
            title="CSV"
            value={output}
            actions={<ViewToggle view={view} onChange={setView} disabled={!ok?.table.headers.length} />}
            downloadName={`data.${ext}`}
            downloadType={ext === 'tsv' ? 'text/tab-separated-values' : 'text/csv'}
            placeholder="CSV appears here"
            height="480px"
            lineWrapping={false}
            footer={ok && output ? <Summary rows={ok.table.rows.length} cols={ok.table.headers.length} bytes={ok.bytes} /> : undefined}
          />
        ) : (
          <section className="flex min-w-0 flex-col rounded-xl border border-line bg-surface shadow-card">
            <header className="flex min-h-11 flex-wrap items-center justify-between gap-2 border-b border-line py-1.5 pr-2 pl-4">
              <h2 className="text-[13px] font-semibold tracking-tight text-fg">CSV</h2>
              <div className="flex flex-wrap items-center gap-1">
                <ViewToggle view={view} onChange={setView} />
                <DownloadButton
                  data={output}
                  filename={`data.${ext}`}
                  type={ext === 'tsv' ? 'text/tab-separated-values' : 'text/csv'}
                  label="Save"
                  variant="ghost"
                />
                <CopyButton value={output} iconOnly />
              </div>
            </header>
            <div className="h-[480px] p-2">
              <CsvGrid table={ok.table} view={viewIndex} label="CSV preview" selected={selected} onSelect={setSelected} height={464} />
            </div>
            <footer className="flex min-h-9 flex-wrap items-center gap-x-4 gap-y-1 border-t border-line px-4 py-1.5 text-[12.5px] text-fg-muted">
              <Summary rows={ok.table.rows.length} cols={ok.table.headers.length} bytes={ok.bytes} />
            </footer>
          </section>
        )}
      </SplitPanes>
    </ToolStack>
  );
}

function Summary({ rows, cols, bytes }: { rows: number; cols: number; bytes: number }) {
  return (
    <>
      <span>
        {pluralize(rows, 'row')} × {pluralize(cols, 'column')}
      </span>
      <span>{formatBytes(bytes)}</span>
    </>
  );
}

function ViewToggle({ view, onChange, disabled }: { view: 'text' | 'table'; onChange: (v: 'text' | 'table') => void; disabled?: boolean }) {
  if (disabled) return null;
  return (
    <Segmented
      label="Output view"
      size="sm"
      value={view}
      onChange={onChange}
      options={[
        { value: 'text', label: 'Text' },
        { value: 'table', label: 'Table' },
      ]}
    />
  );
}
