import { useMemo, useState } from 'react';
import { SplitPanes, ToolBar, ToolStack } from '@/components/tool/EditorPanel';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Checkbox, Label, Switch } from '@/components/ui/Field';
import { Stat } from '@/components/ui/Panel';
import { Segmented } from '@/components/ui/Segmented';
import { useToolState } from '@/lib/hooks';
import { formatNumber, pluralize, withExtension } from '@/lib/utils';
import { writeCsv } from './lib/csv';
import { dedupe } from './lib/dedupe';
import { CsvSourcePanel, dataNotes, useCsvSource } from './components/CsvSource';
import { OutputPanel } from './components/OutputPanel';
import { SAMPLE_DUPES } from './components/samples';
import { t } from '@/lib/i18n';

const TOOL = 'csv-dedupe';

export default function CsvDedupe() {
  const source = useCsvSource(TOOL);
  const [by, setBy] = useToolState<'row' | 'columns'>(TOOL, 'by', 'row');
  /** Column names chosen as the key (names survive re-parsing better than indices). */
  const [keyNames, setKeyNames] = useToolState<string[]>(TOOL, 'keys', []);
  const [keep, setKeep] = useToolState<'first' | 'last'>(TOOL, 'keep', 'first');
  const [ignoreCase, setIgnoreCase] = useToolState(TOOL, 'ignoreCase', false);
  const [trim, setTrim] = useToolState(TOOL, 'trim', true);
  const [collapse, setCollapse] = useToolState(TOOL, 'collapse', false);
  const [show, setShow] = useState<'kept' | 'removed'>('kept');

  const data = source.data;
  const headers = useMemo(() => data?.table.headers ?? [], [data]);
  const columns = useMemo(
    () => (by === 'columns' ? headers.map((h, i) => (keyNames.includes(h) ? i : -1)).filter((i) => i >= 0) : []),
    [by, headers, keyNames],
  );
  const needsColumns = by === 'columns' && columns.length === 0;

  const result = useMemo(() => {
    if (!data || !data.table.headers.length || needsColumns) return null;
    return dedupe(data.table, { columns, keep, ignoreCase, trim, collapseWhitespace: collapse });
  }, [data, needsColumns, columns, keep, ignoreCase, trim, collapse]);

  const output = useMemo(() => {
    if (!result || !data) return '';
    const table = show === 'kept' ? result.table : result.removed;
    return writeCsv(table, { delimiter: data.delimiter, includeHeader: source.header });
  }, [result, data, show, source.header]);

  const notes = data ? dataNotes(data) : [];
  const base = data?.fileName ?? 'data.csv';
  const fileName = withExtension(
    base.replace(/\.[^.]+$/, '') + (show === 'kept' ? '-deduped' : '-duplicates'),
    data?.delimiter === '\t' ? 'tsv' : 'csv',
  );

  function toggleKey(name: string, on: boolean) {
    setKeyNames((prev) => (on ? [...prev.filter((n) => n !== name), name] : prev.filter((n) => n !== name)));
  }

  return (
    <ToolStack>
      <ToolBar>
        <div>
          <Label>{t('Compare')}</Label>
          <Segmented
            label={t('Compare')}
            value={by}
            onChange={setBy}
            options={[
              { value: 'row', label: t('Whole row') },
              { value: 'columns', label: t('Selected columns') },
            ]}
          />
        </div>
        <div>
          <Label>{t('Keep')}</Label>
          <Segmented
            label={t('Keep')}
            value={keep}
            onChange={setKeep}
            options={[
              { value: 'first', label: t('First occurrence') },
              { value: 'last', label: t('Last occurrence') },
            ]}
          />
        </div>
        <Switch label={t('Ignore case')} checked={ignoreCase} onChange={setIgnoreCase} className="h-8" />
        <Switch label={t('Trim spaces')} checked={trim} onChange={setTrim} className="h-8" />
        <Switch label={t('Collapse inner spaces')} checked={collapse} onChange={setCollapse} className="h-8" />
      </ToolBar>

      {by === 'columns' && (
        <section className="rounded-xl border border-line bg-surface px-4 py-3 shadow-card">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-[13px] font-semibold text-fg">{t('Key columns')}</h2>
            {headers.length > 0 && (
              <div className="flex gap-1">
                <Button size="sm" variant="ghost" onClick={() => setKeyNames(headers.slice())}>
                  {t('All')}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setKeyNames([])}>
                  {t('None')}
                </Button>
              </div>
            )}
          </div>
          {headers.length ? (
            <div className="flex max-h-40 flex-wrap gap-x-5 gap-y-2 overflow-y-auto">
              {headers.map((h, i) => (
                <Checkbox
                  key={`${i}:${h}`}
                  label={h || <span className="text-fg-muted italic">{t('Column')}{' '}{i + 1}</span>}
                  checked={keyNames.includes(h)}
                  onChange={(on) => toggleKey(h, on)}
                />
              ))}
            </div>
          ) : (
            <p className="text-[13px] text-fg-muted">{t('Add CSV input to choose the columns that identify a duplicate.')}</p>
          )}
          {needsColumns && headers.length > 0 && <p className="mt-2 text-[13px] text-warning">{t('Select at least one column.')}</p>}
        </section>
      )}

      {notes.length > 0 && (
        <Alert tone="warning" title={t('Input notes')}>
          <ul className="list-disc pl-4">
            {notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </Alert>
      )}

      {result && data && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label={t('Rows in')} value={formatNumber(data.table.rows.length, 0)} />
          <Stat label={t('Duplicates removed')} value={formatNumber(result.removedCount, 0)} />
          <Stat label={t('Rows kept')} value={formatNumber(result.table.rows.length, 0)} />
          <Stat label={t('Duplicated keys')} value={formatNumber(result.duplicateGroups, 0)} />
        </div>
      )}

      <SplitPanes>
        <CsvSourcePanel source={source} sample={SAMPLE_DUPES} height="420px" />
        <OutputPanel
          title={show === 'kept' ? t('Deduplicated') : t('Removed rows')}
          value={output}
          actions={
            result ? (
              <Segmented
                label={t('Show')}
                size="sm"
                value={show}
                onChange={setShow}
                options={[
                  { value: 'kept', label: t('Kept') },
                  { value: 'removed', label: t('Removed ({removedCount})', { removedCount: formatNumber(result.removedCount, 0) }) },
                ]}
              />
            ) : undefined
          }
          downloadName={fileName}
          downloadType="text/csv"
          placeholder={
            source.busy ? t('Parsing…') : needsColumns && headers.length ? t('Choose key columns above') : t('The deduplicated CSV appears here')
          }
          height="420px"
          lineWrapping={false}
          footer={
            result ? (
              <span>
                {show === 'kept'
                  ? result.removedCount
                    ? t('{count} removed', { count: pluralize(result.removedCount, t('duplicate row'), t('duplicate rows')) })
                    : t('No duplicates found')
                  : pluralize(result.removed.rows.length, t('removed row'), t('removed rows'))}
              </span>
            ) : undefined
          }
        />
      </SplitPanes>
    </ToolStack>
  );
}
