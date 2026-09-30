import { useMemo, useState } from 'react';
import { EyeOff, FileSpreadsheet, Sheet, X } from 'lucide-react';
import { ToolStack } from '@/components/tool/EditorPanel';
import { ErrorMessage } from '@/components/ui/Alert';
import { CopyButton, DownloadButton } from '@/components/ui/Actions';
import { IconButton } from '@/components/ui/Button';
import { EmptyState, ProgressBar } from '@/components/ui/Feedback';
import { Switch } from '@/components/ui/Field';
import { FileDrop } from '@/components/ui/FileDrop';
import { Badge } from '@/components/ui/Panel';
import { useAsyncJob, useToolState } from '@/lib/hooks';
import { baseName, cn, errorMessage, formatBytes, pluralize } from '@/lib/utils';
import { buildTable } from './lib/csv';
import { SPREADSHEET_ACCEPT, type SheetData } from './lib/spreadsheet';
import { CsvGrid, type GridCell } from './components/CsvGrid';
import { parseWorkbook } from './components/parseWorkbook';
import { EXPORT_TYPES, exportTable, FilterBar, useTableView, viewSummary, type ExportFormat } from './components/TableTools';
import { t } from '@/lib/i18n';

const TOOL = 'spreadsheet-viewer';
const MAX_FILE = 200 * 1024 * 1024;

export default function SpreadsheetViewer() {
  const [file, setFile] = useState<File | null>(null);
  const [sheets, setSheets] = useState<SheetData[] | null>(null);
  const [active, setActive] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [header, setHeader] = useToolState(TOOL, 'header', true);
  const [selected, setSelected] = useState<GridCell | null>(null);
  const job = useAsyncJob();

  async function open(next: File) {
    setFile(next);
    setSheets(null);
    setError(null);
    setSelected(null);
    try {
      const parsed = await job.run(({ signal, progress }) => {
        progress(null, t('Reading workbook…'));
        return parseWorkbook(next, signal);
      });
      setSheets(parsed);
      const firstVisible = parsed.findIndex((s) => !s.hidden && s.records.length > 0);
      setActive(firstVisible >= 0 ? firstVisible : 0);
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return;
      setError(errorMessage(e, t('Could not read the workbook.')));
    }
  }

  function close() {
    job.cancel();
    setFile(null);
    setSheets(null);
    setError(null);
    setSelected(null);
  }

  const sheet = sheets?.[active] ?? null;
  const table = useMemo(() => (sheet ? buildTable(sheet.records, header).table : null), [sheet, header]);
  const view = useTableView(table);

  if (!file) {
    return (
      <ToolStack>
        <FileDrop
          accept={SPREADSHEET_ACCEPT}
          maxSize={MAX_FILE}
          onFiles={(files) => files[0] && void open(files[0])}
          icon={FileSpreadsheet}
          title={t('Drop an Excel or OpenDocument spreadsheet')}
          hint={t('XLSX, XLSM, XLSB, XLS and ODS up to 200 MB. Read on this device, never uploaded.')}
        />
      </ToolStack>
    );
  }

  const exportName = (format: ExportFormat) =>
    `${baseName(file.name)}${sheets && sheets.length > 1 && sheet ? `-${sheet.name.replace(/[\\/:*?"<>|]+/g, '_')}` : ''}.${format}`;
  const exportIndices = view.active ? view.indices : undefined;

  return (
    <ToolStack>
      <section className="flex min-w-0 flex-col rounded-xl border border-line bg-surface shadow-card">
        <header className="flex min-h-12 flex-wrap items-center gap-3 border-b border-line px-4 py-2">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-line bg-surface-raised text-fg-secondary">
            <FileSpreadsheet size={16} aria-hidden />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13.5px] font-medium text-fg" title={file.name}>
              {file.name}
            </p>
            <p className="text-[12px] text-fg-muted">
              {formatBytes(file.size)}
              {sheets && ` · ${pluralize(sheets.length, t('sheet'), t('sheets'))}`}
            </p>
          </div>
          <IconButton icon={X} label={t('Close file')} size="sm" onClick={close} />
        </header>

        {job.running && (
          <div className="p-4">
            <ProgressBar value={job.progress} label={job.label || t('Reading workbook…')} onCancel={close} />
          </div>
        )}
        {error && (
          <div className="p-4">
            <ErrorMessage error={error} title={t('Could not open this file')} />
          </div>
        )}

        {sheets && (
          <div role="tablist" aria-label={t('Sheets')} className="flex gap-1 overflow-x-auto border-b border-line px-2 pt-2">
            {sheets.map((s, i) => (
              <button
                key={`${i}:${s.name}`}
                type="button"
                role="tab"
                aria-selected={i === active}
                onClick={() => {
                  setActive(i);
                  setSelected(null);
                }}
                className={cn(
                  '-mb-px inline-flex shrink-0 items-center gap-1.5 rounded-t-lg border px-3 py-1.5 text-[13px] font-medium whitespace-nowrap transition-colors',
                  i === active
                    ? 'border-line border-b-surface bg-surface text-fg'
                    : 'border-transparent text-fg-muted hover:bg-surface-hover hover:text-fg',
                )}
              >
                <Sheet size={13} aria-hidden />
                {s.name}
                {s.hidden && <EyeOff size={12} aria-label={t('Hidden sheet')} className="text-fg-muted" />}
              </button>
            ))}
          </div>
        )}

        {sheet && table && (
          <div className="flex min-w-0 flex-col gap-3 p-3">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <FilterBar view={view} headers={table.headers} className="w-full min-w-0 md:w-auto md:flex-1" />
              <Switch label={t('First row is header')} checked={header} onChange={setHeader} />
            </div>
            {table.headers.length === 0 ? (
              <EmptyState icon={Sheet} title={t('This sheet is empty')} />
            ) : (
              <CsvGrid
                table={table}
                view={view.indices}
                label={t('Sheet {name}', { name: sheet.name })}
                selected={selected}
                onSelect={setSelected}
                sort={view.sort}
                onSort={view.toggleSort}
                height={560}
              />
            )}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[12.5px] text-fg-muted">
              <span>
                {viewSummary(view, table.rows.length)} × {pluralize(table.headers.length, t('column'), t('columns'))}
              </span>
              {sheet.range && <span className="font-mono">{t('Range {range}', { range: sheet.range })}</span>}
              {sheet.hidden && <Badge>{t('Hidden sheet')}</Badge>}
              {table.headers.length > 0 && (
                <div className="ml-auto flex flex-wrap items-center gap-1.5">
                  {view.active && <span className="mr-1">{t('Exports use the filtered, sorted rows')}</span>}
                  {(['csv', 'tsv', 'json'] as const).map((format) => (
                    <DownloadButton
                      key={format}
                      data={() => exportTable(table, format, header, exportIndices)}
                      filename={() => exportName(format)}
                      type={EXPORT_TYPES[format]}
                      label={format.toUpperCase()}
                    />
                  ))}
                  <CopyButton value={() => exportTable(table, 'tsv', header, exportIndices)} label={t('Copy')} />
                </div>
              )}
            </div>
          </div>
        )}
      </section>
    </ToolStack>
  );
}
