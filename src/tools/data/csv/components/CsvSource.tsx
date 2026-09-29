import { useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import { ClipboardPaste, Eraser, FileSpreadsheet, FileUp, FlaskConical, X } from 'lucide-react';
import { IconButton } from '@/components/ui/Button';
import { Label, Select, Switch, Textarea } from '@/components/ui/Field';
import { FileDrop } from '@/components/ui/FileDrop';
import { ProgressBar } from '@/components/ui/Feedback';
import { Segmented } from '@/components/ui/Segmented';
import { useAsyncJob, useDebouncedValue, useToolState } from '@/lib/hooks';
import { cn, errorMessage, formatBytes, pluralize } from '@/lib/utils';
import { buildTable, DELIMITERS, delimiterName, parseCsv, type ParseIssue, type Table } from '../lib/csv';
import { MAX_ROWS, parseCsvFile, type ParsedFile } from './parseFile';

export const CSV_ACCEPT = '.csv,.tsv,.tab,.txt,.dsv,.psv,text/csv,text/tab-separated-values,text/plain';

export const ENCODINGS = [
  { value: 'utf-8', label: 'UTF-8' },
  { value: 'windows-1252', label: 'Windows-1252 (Western)' },
  { value: 'iso-8859-15', label: 'ISO-8859-15 (Latin-9)' },
  { value: 'utf-16le', label: 'UTF-16 LE' },
  { value: 'utf-16be', label: 'UTF-16 BE' },
  { value: 'windows-1250', label: 'Windows-1250 (Central European)' },
  { value: 'windows-1251', label: 'Windows-1251 (Cyrillic)' },
  { value: 'shift_jis', label: 'Shift JIS (Japanese)' },
  { value: 'gbk', label: 'GBK (Chinese)' },
  { value: 'euc-kr', label: 'EUC-KR (Korean)' },
];

export interface CsvData {
  table: Table;
  /** Delimiter actually used (detected when set to auto). */
  delimiter: string;
  linebreak: string;
  issues: ParseIssue[];
  raggedRows: number;
  /** True when a file had more rows than MAX_ROWS and was cut off. */
  truncated: boolean;
  /** File name, or null for pasted text. */
  fileName: string | null;
}

export interface CsvSource {
  mode: 'paste' | 'file';
  setMode: (mode: 'paste' | 'file') => void;
  text: string;
  setText: (text: string) => void;
  file: File | null;
  setFile: (file: File | null) => void;
  delimiter: string;
  setDelimiter: (d: string) => void;
  header: boolean;
  setHeader: (h: boolean) => void;
  encoding: string;
  setEncoding: (e: string) => void;
  data: CsvData | null;
  error: string | null;
  busy: boolean;
  progress: number | null;
  progressLabel: string;
  cancel: () => void;
}

/**
 * CSV input state shared by the CSV tools: pasted text (parsed on the main
 * thread, debounced) or a file (parsed in a Web Worker with progress).
 */
export function useCsvSource(toolId: string): CsvSource {
  const [mode, setMode] = useToolState<'paste' | 'file'>(toolId, 'source', 'paste');
  const [text, setText] = useToolState(toolId, 'csv', '');
  const [delimiter, setDelimiter] = useToolState(toolId, 'delimiter', '');
  const [header, setHeader] = useToolState(toolId, 'header', true);
  const [encoding, setEncoding] = useToolState(toolId, 'encoding', 'utf-8');
  const [file, setFile] = useState<File | null>(null);
  const [parsedFile, setParsedFile] = useState<ParsedFile | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const job = useAsyncJob();
  const { run } = job;

  const debounced = useDebouncedValue(text, text.length > 1_000_000 ? 400 : 150);
  const pasted = useMemo(() => {
    if (mode !== 'paste' || !debounced.trim()) return null;
    const parsed = parseCsv(debounced, { delimiter, header });
    return { ...parsed, truncated: false, fileName: null } satisfies CsvData;
  }, [mode, debounced, delimiter, header]);

  useEffect(() => {
    if (!file) return;
    let active = true;
    run(async ({ signal, progress }) => {
      setFileError(null);
      progress(0, 'Reading file…');
      const parsed = await parseCsvFile(file, { delimiter, encoding, signal, onProgress: progress });
      if (active) setParsedFile(parsed);
    }).catch((error: unknown) => {
      if (!active || (error instanceof DOMException && error.name === 'AbortError')) return;
      setFileError(errorMessage(error, 'Could not read the file.'));
    });
    return () => {
      active = false;
    };
  }, [file, delimiter, encoding, run]);

  const fromFile = useMemo(() => {
    if (mode !== 'file' || !file || !parsedFile) return null;
    const { table, raggedRows } = buildTable(parsedFile.records, header);
    return {
      table,
      raggedRows,
      delimiter: parsedFile.delimiter,
      linebreak: parsedFile.linebreak,
      issues: parsedFile.issues,
      truncated: parsedFile.truncated,
      fileName: file.name,
    } satisfies CsvData;
  }, [mode, file, parsedFile, header]);

  return {
    mode,
    setMode,
    text,
    setText,
    file,
    setFile: (next) => {
      setParsedFile(null);
      setFileError(null);
      if (!next) job.cancel();
      setFile(next);
    },
    delimiter,
    setDelimiter: (d) => {
      if (d !== delimiter) setParsedFile(null);
      setDelimiter(d);
    },
    header,
    setHeader,
    encoding,
    setEncoding: (e) => {
      if (e !== encoding) setParsedFile(null);
      setEncoding(e);
    },
    data: mode === 'paste' ? pasted : fromFile,
    error: mode === 'file' ? fileError : null,
    busy: mode === 'file' && job.running,
    progress: job.progress,
    progressLabel: job.label,
    cancel: () => {
      job.cancel();
      setFile(null);
      setParsedFile(null);
    },
  };
}

/** Status text such as "120 rows × 4 columns · Comma". */
export function describeData(data: CsvData): string {
  const { table } = data;
  return `${pluralize(table.rows.length, 'row')} × ${pluralize(table.headers.length, 'column')} · ${delimiterName(data.delimiter)}`;
}

/** Warnings about how the input was read (ragged rows, unclosed quotes, truncation). */
export function dataNotes(data: CsvData): string[] {
  const notes: string[] = [];
  if (data.truncated) notes.push(`Only the first ${MAX_ROWS.toLocaleString()} rows were loaded.`);
  if (data.raggedRows) {
    notes.push(
      `${pluralize(data.raggedRows, 'row')} had a different number of fields and ${data.raggedRows === 1 ? 'was' : 'were'} padded with empty cells.`,
    );
  }
  for (const issue of data.issues.slice(0, 3)) notes.push(issue.row ? `Row ${issue.row}: ${issue.message}` : issue.message);
  if (data.issues.length > 3) notes.push(`…and ${data.issues.length - 3} more parse warnings.`);
  return notes;
}

export function DelimiterSelect({
  value,
  onChange,
  detected,
  id,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  detected?: string;
  id?: string;
  className?: string;
}) {
  return (
    <Select id={id} value={value} onChange={(e) => onChange(e.target.value)} className={cn('h-8 py-1 text-[13px]', className)}>
      <option value="">{detected && !value ? `Auto (${delimiterName(detected)})` : 'Auto-detect'}</option>
      {DELIMITERS.map((d) => (
        <option key={d.label} value={d.value}>
          {d.label}
        </option>
      ))}
    </Select>
  );
}

/** Input card for CSV tools: paste or open a file, with delimiter and header options. */
export function CsvSourcePanel({
  source,
  title = 'CSV input',
  sample,
  height = '360px',
  footerExtra,
}: {
  source: CsvSource;
  title?: ReactNode;
  sample?: string;
  height?: string;
  footerExtra?: ReactNode;
}) {
  const { mode, data } = source;
  const id = useId();
  const delimiterId = `${id}-delimiter`;
  const encodingId = `${id}-encoding`;

  return (
    <section
      className={cn('flex min-w-0 flex-col rounded-xl border bg-surface shadow-card', source.error ? 'border-danger/60' : 'border-line')}
    >
      <header className="flex min-h-11 flex-wrap items-center justify-between gap-2 border-b border-line py-1.5 pr-2 pl-4">
        <h2 className="text-[13px] font-semibold tracking-tight text-fg">{title}</h2>
        <div className="flex flex-wrap items-center gap-1">
          <Segmented
            label="Input source"
            size="sm"
            value={mode}
            onChange={source.setMode}
            options={[
              { value: 'paste', label: 'Paste', icon: ClipboardPaste },
              { value: 'file', label: 'File', icon: FileUp },
            ]}
          />
          {mode === 'paste' && sample !== undefined && (
            <IconButton icon={FlaskConical} label="Load sample" size="sm" onClick={() => source.setText(sample)} />
          )}
          {mode === 'paste' && (
            <IconButton icon={Eraser} label="Clear" size="sm" disabled={!source.text} onClick={() => source.setText('')} />
          )}
        </div>
      </header>

      <div
        className={cn('min-h-0 p-2', mode === 'file' && source.file && 'flex-1')}
        style={mode === 'file' && source.file ? undefined : { height }}
      >
        {mode === 'paste' ? (
          <Textarea
            value={source.text}
            onChange={(e) => source.setText(e.target.value)}
            placeholder="Paste CSV, TSV or other delimited text…"
            aria-label="CSV text"
            className="h-full resize-none whitespace-pre"
            wrap="off"
          />
        ) : source.file ? (
          <div className="flex h-full flex-col justify-center gap-4 rounded-lg border border-line bg-surface-sunken p-4">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-line bg-surface-raised text-fg-secondary">
                <FileSpreadsheet size={19} aria-hidden />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-fg" title={source.file.name}>
                  {source.file.name}
                </p>
                <p className="text-[12.5px] text-fg-muted">
                  {formatBytes(source.file.size)}
                  {data ? ` · ${describeData(data)}` : ''}
                </p>
              </div>
              <IconButton icon={X} label="Remove file" size="sm" onClick={() => source.setFile(null)} />
            </div>
            {source.busy && <ProgressBar value={source.progress} label={source.progressLabel || 'Parsing…'} onCancel={source.cancel} />}
            {source.error && (
              <p role="alert" className="text-[13px] text-danger">
                {source.error}
              </p>
            )}
          </div>
        ) : (
          <FileDrop
            className="h-full [&>div]:h-full"
            accept={CSV_ACCEPT}
            onFiles={(files) => source.setFile(files[0] ?? null)}
            title="Drop a CSV or TSV file"
            hint="Parsed on this device in a background thread. Large files are fine."
          />
        )}
      </div>

      <footer className="flex flex-wrap items-end gap-x-4 gap-y-2 border-t border-line px-4 py-2.5">
        <div className="w-40">
          <Label htmlFor={delimiterId} className="mb-1 text-[12px]">
            Delimiter
          </Label>
          <DelimiterSelect id={delimiterId} value={source.delimiter} onChange={source.setDelimiter} detected={data?.delimiter} />
        </div>
        {mode === 'file' && (
          <div className="w-48">
            <Label htmlFor={encodingId} className="mb-1 text-[12px]">
              Encoding
            </Label>
            <Select
              id={encodingId}
              value={source.encoding}
              onChange={(e) => source.setEncoding(e.target.value)}
              className="h-8 py-1 text-[13px]"
            >
              {ENCODINGS.map((e) => (
                <option key={e.value} value={e.value}>
                  {e.label}
                </option>
              ))}
            </Select>
          </div>
        )}
        <Switch label="First row is header" checked={source.header} onChange={source.setHeader} className="h-8" />
        {footerExtra}
        {data && mode === 'paste' && <span className="ml-auto self-center text-[12.5px] text-fg-muted">{describeData(data)}</span>}
      </footer>
    </section>
  );
}
