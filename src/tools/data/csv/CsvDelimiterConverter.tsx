import { useMemo } from 'react';
import { SplitPanes, ToolBar, ToolStack } from '@/components/tool/EditorPanel';
import { Alert, ErrorMessage } from '@/components/ui/Alert';
import { Input, Label, Select, Switch } from '@/components/ui/Field';
import { Segmented } from '@/components/ui/Segmented';
import { useToolState } from '@/lib/hooks';
import { formatBytes, pluralize, withExtension } from '@/lib/utils';
import { countUnsafeUnquoted, delimiterName, normalizeCustomDelimiter, validateDelimiter, writeCsv, type QuoteMode } from './lib/csv';
import { CsvSourcePanel, dataNotes, useCsvSource } from './components/CsvSource';
import { OutputPanel } from './components/OutputPanel';
import { SAMPLE_CSV } from './components/samples';

const TOOL = 'csv-delimiter-converter';

const TARGETS = [
  { value: ',', label: 'Comma' },
  { value: ';', label: 'Semicolon' },
  { value: '\t', label: 'Tab' },
  { value: '|', label: 'Pipe' },
  { value: 'custom', label: 'Custom' },
] as const;

export default function CsvDelimiterConverter() {
  const source = useCsvSource(TOOL);
  const [target, setTarget] = useToolState<string>(TOOL, 'target', '\t');
  const [custom, setCustom] = useToolState(TOOL, 'custom', '~');
  const [quote, setQuote] = useToolState<QuoteMode>(TOOL, 'quote', 'minimal');
  const [quoteChar, setQuoteChar] = useToolState<'"' | "'">(TOOL, 'quoteChar', '"');
  const [newline, setNewline] = useToolState<'\n' | '\r\n'>(TOOL, 'newline', '\n');
  const [includeHeader, setIncludeHeader] = useToolState(TOOL, 'includeHeader', true);
  const [bom, setBom] = useToolState(TOOL, 'bom', false);
  const [escapeFormulae, setEscapeFormulae] = useToolState(TOOL, 'escapeFormulae', false);

  const delimiter = target === 'custom' ? normalizeCustomDelimiter(custom) : target;
  const delimiterError = validateDelimiter(delimiter, quoteChar);
  const data = source.data;

  const result = useMemo(() => {
    if (!data || !data.table.headers.length || delimiterError) return null;
    const text = writeCsv(data.table, {
      delimiter,
      quote,
      quoteChar,
      newline,
      includeHeader: includeHeader && source.header,
      bom,
      escapeFormulae,
    });
    const unsafe = quote === 'none' ? countUnsafeUnquoted(data.table, delimiter, quoteChar, includeHeader && source.header) : 0;
    return { text, unsafe, bytes: new Blob([text]).size };
  }, [data, delimiter, delimiterError, quote, quoteChar, newline, includeHeader, source.header, bom, escapeFormulae]);

  const ext = delimiter === '\t' ? 'tsv' : delimiter === ',' || delimiter === ';' ? 'csv' : 'txt';
  const fileName = withExtension(data?.fileName ?? 'data', ext);
  const notes = data ? dataNotes(data) : [];

  return (
    <ToolStack>
      <ToolBar>
        <div>
          <Label>Output delimiter</Label>
          <Segmented
            label="Output delimiter"
            value={target}
            onChange={setTarget}
            options={TARGETS.map((t) => ({ value: t.value, label: t.label }))}
          />
        </div>
        {target === 'custom' && (
          <div className="w-28">
            <Label htmlFor="dc-custom">Custom</Label>
            <Input
              id="dc-custom"
              value={custom}
              onChange={(e) => setCustom(e.target.value.slice(0, 8))}
              className="h-8 py-1 font-mono text-[13px]"
              placeholder="e.g. ~ or \t"
              aria-invalid={Boolean(delimiterError) || undefined}
            />
          </div>
        )}
        <div className="w-44">
          <Label htmlFor="dc-quote">Quoting</Label>
          <Select id="dc-quote" value={quote} onChange={(e) => setQuote(e.target.value as QuoteMode)} className="h-8 py-1 text-[13px]">
            <option value="minimal">Only when needed</option>
            <option value="all">Quote every field</option>
            <option value="nonnumeric">Quote non-numeric</option>
            <option value="none">Never quote</option>
          </Select>
        </div>
        <div>
          <Label>Quote char</Label>
          <Segmented
            label="Quote character"
            value={quoteChar}
            onChange={setQuoteChar}
            options={[
              { value: '"', label: '" Double' },
              { value: "'", label: "' Single" },
            ]}
          />
        </div>
        <div>
          <Label>Line endings</Label>
          <Segmented
            label="Line endings"
            value={newline}
            onChange={setNewline}
            options={[
              { value: '\n', label: 'LF' },
              { value: '\r\n', label: 'CRLF' },
            ]}
          />
        </div>
        {source.header && <Switch label="Include header" checked={includeHeader} onChange={setIncludeHeader} className="h-8" />}
        <Switch label="UTF-8 BOM (Excel)" checked={bom} onChange={setBom} className="h-8" />
        <Switch label="Escape formulas" checked={escapeFormulae} onChange={setEscapeFormulae} className="h-8" />
      </ToolBar>
      {delimiterError && <ErrorMessage error={delimiterError} title="Invalid delimiter" />}
      {result && result.unsafe > 0 && (
        <Alert tone="warning" title="Output may not read back correctly">
          {pluralize(result.unsafe, 'cell')} contain{result.unsafe === 1 ? 's' : ''} the delimiter, a quote or a line break. Without
          quoting, other programs will split {result.unsafe === 1 ? 'it' : 'them'} into extra fields or rows.
        </Alert>
      )}
      {notes.length > 0 && (
        <Alert tone="warning" title="Input notes">
          <ul className="list-disc pl-4">
            {notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </Alert>
      )}
      <SplitPanes>
        <CsvSourcePanel source={source} sample={SAMPLE_CSV} height="440px" />
        <OutputPanel
          title={`Output · ${delimiterError ? '—' : delimiterName(delimiter)}`}
          value={result?.text ?? ''}
          downloadName={fileName}
          downloadType={ext === 'tsv' ? 'text/tab-separated-values' : ext === 'csv' ? 'text/csv' : 'text/plain'}
          placeholder={source.busy ? 'Parsing…' : 'Converted text appears here'}
          height="440px"
          lineWrapping={false}
          footer={
            result && data ? (
              <>
                <span>{pluralize(data.table.rows.length, 'row')}</span>
                <span>{formatBytes(result.bytes)}</span>
              </>
            ) : undefined
          }
        />
      </SplitPanes>
    </ToolStack>
  );
}
