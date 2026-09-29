import { useMemo, useState } from 'react';
import { ToolBar, ToolStack } from '@/components/tool/EditorPanel';
import { Alert } from '@/components/ui/Alert';
import { Input, Label, Switch } from '@/components/ui/Field';
import { Panel } from '@/components/ui/Panel';
import { Segmented } from '@/components/ui/Segmented';
import { useToolState } from '@/lib/hooks';
import { formatBytes } from '@/lib/utils';
import type { Table } from './lib/csv';
import { toHtmlTable, type HtmlTableOptions } from './lib/htmlTable';
import { blankTable, normalizeTable } from './lib/importTable';
import type { Align } from './lib/markdownTable';
import { CsvSourcePanel, useCsvSource } from './components/CsvSource';
import { SAMPLE_CSV } from './components/samples';
import { OutputPanel } from './components/OutputPanel';
import { TableEditor } from './components/TableEditor';

const TOOL = 'html-table-generator';
const PREVIEW_MAX_CHARS = 2_000_000;

const INITIAL: Table = {
  headers: ['Plan', 'Price', 'Seats'],
  rows: [
    ['Free', '$0', '1'],
    ['Pro', '$12', '5'],
    ['Team', '$49', 'Unlimited'],
  ],
};

type Indent = NonNullable<HtmlTableOptions['indent']>;

/** Colors for the sandboxed preview, read from the app's current theme tokens. */
function previewCss(): string {
  const css = getComputedStyle(document.documentElement);
  const v = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
  const fg = v('--lk-text-primary', '#0e1420');
  const muted = v('--lk-text-muted', '#5f6b7e');
  const bg = v('--lk-surface', '#ffffff');
  const line = v('--lk-border-strong', '#cdd3dc');
  const head = v('--lk-surface-hover', '#f1f3f6');
  return `body{margin:0;padding:16px;background:${bg};color:${fg};font:14px/1.5 system-ui,-apple-system,'Segoe UI',sans-serif}
table{border-collapse:collapse}th,td{border:1px solid ${line};padding:6px 12px;vertical-align:top}
thead th{background:${head};font-weight:600}caption{caption-side:top;padding-bottom:8px;color:${muted};text-align:left}`;
}

export default function HtmlTableGenerator() {
  const [mode, setMode] = useToolState<'grid' | 'csv'>(TOOL, 'mode', 'grid');
  const [stored, setTable] = useToolState<Table>(TOOL, 'table', INITIAL);
  const [align, setAlign] = useToolState<Align[]>(TOOL, 'align', []);
  const [thead, setThead] = useToolState(TOOL, 'thead', true);
  const [rowHeaders, setRowHeaders] = useToolState(TOOL, 'rowHeaders', false);
  const [className, setClassName] = useToolState(TOOL, 'className', '');
  const [id, setId] = useToolState(TOOL, 'id', '');
  const [caption, setCaption] = useToolState(TOOL, 'caption', '');
  const [escape, setEscape] = useToolState(TOOL, 'escape', true);
  const [lineBreaks, setLineBreaks] = useToolState(TOOL, 'lineBreaks', true);
  const [indent, setIndent] = useToolState<Indent>(TOOL, 'indent', '2');
  const [view, setView] = useState<'html' | 'preview'>('html');
  const source = useCsvSource(TOOL);

  const gridTable = useMemo(() => normalizeTable(stored?.headers?.length ? stored : blankTable(3, 3)), [stored]);
  const table = mode === 'grid' ? gridTable : (source.data?.table ?? null);
  const useThead = mode === 'grid' ? thead : thead && source.header;

  const html = useMemo(() => {
    if (!table || !table.headers.length) return '';
    return toHtmlTable(table, {
      thead: useThead,
      rowHeaders,
      className,
      id,
      caption,
      escape,
      lineBreaks,
      indent,
      align: mode === 'grid' ? align : [],
    });
  }, [table, useThead, rowHeaders, className, id, caption, escape, lineBreaks, indent, align, mode]);

  const srcDoc =
    view === 'preview' && html.length <= PREVIEW_MAX_CHARS
      ? `<!doctype html><meta charset="utf-8"><style>${previewCss()}</style>${html}`
      : '';

  return (
    <ToolStack>
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-[13px] font-medium text-fg-secondary">Data source</span>
        <Segmented
          label="Data source"
          value={mode}
          onChange={setMode}
          options={[
            { value: 'grid', label: 'Edit a table' },
            { value: 'csv', label: 'From CSV' },
          ]}
        />
      </div>
      {mode === 'grid' ? (
        <Panel title="Table" bodyClassName="p-3">
          <TableEditor table={gridTable} onChange={setTable} align={align} onAlignChange={setAlign} />
        </Panel>
      ) : (
        <CsvSourcePanel source={source} sample={SAMPLE_CSV} height="260px" />
      )}

      <ToolBar>
        {(mode === 'grid' || source.header) && <Switch label="Header row in <thead>" checked={thead} onChange={setThead} className="h-8" />}
        <Switch label="First column as row headers" checked={rowHeaders} onChange={setRowHeaders} className="h-8" />
        <Switch label="Escape HTML in cells" checked={escape} onChange={setEscape} className="h-8" />
        <Switch label="Line breaks → <br>" checked={lineBreaks} onChange={setLineBreaks} className="h-8" />
        <div>
          <Label>Indent</Label>
          <Segmented
            label="Indent"
            value={indent}
            onChange={setIndent}
            options={[
              { value: '2', label: '2' },
              { value: '4', label: '4' },
              { value: 'tab', label: 'Tab' },
              { value: 'none', label: 'Minify' },
            ]}
          />
        </div>
        <div className="w-40">
          <Label htmlFor="ht-class">Class</Label>
          <Input
            id="ht-class"
            value={className}
            onChange={(e) => setClassName(e.target.value)}
            placeholder="e.g. table striped"
            className="h-8 py-1 text-[13px]"
            mono
          />
        </div>
        <div className="w-32">
          <Label htmlFor="ht-id">ID</Label>
          <Input
            id="ht-id"
            value={id}
            onChange={(e) => setId(e.target.value)}
            placeholder="e.g. pricing"
            className="h-8 py-1 text-[13px]"
            mono
          />
        </div>
        <div className="w-full sm:w-56">
          <Label htmlFor="ht-caption">Caption</Label>
          <Input
            id="ht-caption"
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            placeholder="Optional"
            className="h-8 py-1 text-[13px]"
          />
        </div>
      </ToolBar>

      {!escape && (
        <Alert tone="warning" title="Cells are inserted as raw HTML">
          Only turn escaping off for content you trust. Markup such as &lt;script&gt; in a cell would run on the page where you paste this
          table.
        </Alert>
      )}

      {view === 'html' ? (
        <OutputPanel
          title="HTML"
          value={html}
          language="html"
          actions={<ViewToggle view={view} onChange={setView} />}
          downloadName="table.html"
          downloadType="text/html"
          placeholder={source.busy ? 'Parsing…' : 'HTML appears here'}
          height="360px"
          lineWrapping={false}
          footer={html ? <span>{formatBytes(new Blob([html]).size)}</span> : undefined}
        />
      ) : (
        <Panel
          title="Preview"
          description="Rendered in a sandboxed frame"
          actions={<ViewToggle view={view} onChange={setView} />}
          bodyClassName="p-0"
        >
          {html.length > PREVIEW_MAX_CHARS ? (
            <p className="p-4 text-[13px] text-fg-muted">This table is too large to preview. Copy or download the HTML instead.</p>
          ) : html ? (
            <iframe title="Table preview" sandbox="" srcDoc={srcDoc} className="block h-[360px] w-full rounded-b-xl border-0 bg-surface" />
          ) : (
            <p className="p-4 text-[13px] text-fg-muted">Add data to see a preview.</p>
          )}
        </Panel>
      )}
    </ToolStack>
  );
}

function ViewToggle({ view, onChange }: { view: 'html' | 'preview'; onChange: (v: 'html' | 'preview') => void }) {
  return (
    <Segmented
      label="Output view"
      size="sm"
      value={view}
      onChange={onChange}
      options={[
        { value: 'html', label: 'HTML' },
        { value: 'preview', label: 'Preview' },
      ]}
    />
  );
}
