import { useMemo, useState } from 'react';
import { ToolBar, ToolStack } from '@/components/tool/EditorPanel';
import { Panel } from '@/components/ui/Panel';
import { Label } from '@/components/ui/Field';
import { Segmented } from '@/components/ui/Segmented';
import { useToolState } from '@/lib/hooks';
import { cn } from '@/lib/utils';
import type { Table } from './lib/csv';
import { blankTable, normalizeTable } from './lib/importTable';
import { toMarkdownTable, type Align } from './lib/markdownTable';
import { OutputPanel } from './components/OutputPanel';
import { TableEditor } from './components/TableEditor';
import { t } from '@/lib/i18n';

const TOOL = 'markdown-table-generator';

const INITIAL: Table = {
  headers: ['Feature', 'Status', 'Owner'],
  rows: [
    ['CSV import', 'Done', 'Ada'],
    ['Alignment', 'In progress', 'Grace'],
    ['', '', ''],
  ],
};

export default function MarkdownTableGenerator() {
  const [stored, setTable] = useToolState<Table>(TOOL, 'table', INITIAL);
  const [align, setAlign] = useToolState<Align[]>(TOOL, 'align', ['left', 'center', 'none']);
  const [style, setStyle] = useToolState<'pretty' | 'compact'>(TOOL, 'style', 'pretty');
  const [view, setView] = useState<'markdown' | 'preview'>('markdown');
  const table = useMemo(() => normalizeTable(stored?.headers?.length ? stored : blankTable(3, 3)), [stored]);

  const markdown = useMemo(() => toMarkdownTable(table, { align, pretty: style === 'pretty' }), [table, align, style]);

  return (
    <ToolStack>
      <Panel title={t('Table')} bodyClassName="p-3">
        <TableEditor table={table} onChange={setTable} align={align} onAlignChange={setAlign} />
      </Panel>
      <ToolBar>
        <div>
          <Label>{t('Source style')}</Label>
          <Segmented
            label={t('Source style')}
            value={style}
            onChange={setStyle}
            options={[
              { value: 'pretty', label: t('Aligned columns') },
              { value: 'compact', label: t('Compact') },
            ]}
          />
        </div>
        <p className="self-center text-[12.5px] text-fg-muted">
          {t('Click the alignment icon in a header to cycle default → left → center → right. Pipes are escaped and line breaks become <br>.')}
        </p>
      </ToolBar>
      {view === 'markdown' ? (
        <OutputPanel
          title={t('Markdown')}
          value={markdown}
          actions={<ViewToggle view={view} onChange={setView} />}
          downloadName="table.md"
          downloadType="text/markdown"
          height="320px"
          lineWrapping={false}
        />
      ) : (
        <Panel title={t('Preview')} actions={<ViewToggle view={view} onChange={setView} />} bodyClassName="p-4">
          <div className="overflow-x-auto">
            <table className="border-collapse text-[14px]">
              <thead>
                <tr>
                  {table.headers.map((h, i) => (
                    <th key={i} className={cn('border border-line bg-surface-hover px-3 py-1.5 font-semibold', alignClass(align[i]))}>
                      {h || t('Column {i}', { i: i + 1 })}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {table.rows.slice(0, 500).map((r, ri) => (
                  <tr key={ri}>
                    {table.headers.map((_, i) => (
                      <td key={i} className={cn('border border-line px-3 py-1.5 whitespace-pre-line', alignClass(align[i]))}>
                        {r[i]}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {table.rows.length > 500 && (
            <p className="mt-3 text-[12.5px] text-fg-muted">
              {t('The preview shows the first 500 rows; the Markdown includes all {count}.', { count: table.rows.length.toLocaleString() })}
            </p>
          )}
        </Panel>
      )}
    </ToolStack>
  );
}

function alignClass(a: Align | undefined) {
  return a === 'right' ? 'text-right' : a === 'center' ? 'text-center' : 'text-left';
}

function ViewToggle({ view, onChange }: { view: 'markdown' | 'preview'; onChange: (v: 'markdown' | 'preview') => void }) {
  return (
    <Segmented
      label={t('Output view')}
      size="sm"
      value={view}
      onChange={onChange}
      options={[
        { value: 'markdown', label: t('Markdown') },
        { value: 'preview', label: t('Preview') },
      ]}
    />
  );
}
