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
import { t } from '@/lib/i18n';

const TOOL = 'csv-delimiter-converter';

const TARGETS = [
  { value: ',', label: t('Comma') },
  { value: ';', label: t('Semicolon') },
  { value: '\t', label: 'Tab' },
  { value: '|', label: t('Pipe') },
  { value: 'custom', label: t('Custom') },
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
          <Label>{t('Output delimiter')}</Label>
          <Segmented
            label={t('Output delimiter')}
            value={target}
            onChange={setTarget}
            options={TARGETS.map((t) => ({ value: t.value, label: t.label }))}
          />
        </div>
        {target === 'custom' && (
          <div className="w-28">
            <Label htmlFor="dc-custom">{t('Custom')}</Label>
            <Input
              id="dc-custom"
              value={custom}
              onChange={(e) => setCustom(e.target.value.slice(0, 8))}
              className="h-8 py-1 font-mono text-[13px]"
              placeholder={t('e.g. ~ or \\t')}
              aria-invalid={Boolean(delimiterError) || undefined}
            />
          </div>
        )}
        <div className="w-44">
          <Label htmlFor="dc-quote">{t('Quoting')}</Label>
          <Select id="dc-quote" value={quote} onChange={(e) => setQuote(e.target.value as QuoteMode)} className="h-8 py-1 text-[13px]">
            <option value="minimal">{t('Only when needed')}</option>
            <option value="all">{t('Quote every field')}</option>
            <option value="nonnumeric">{t('Quote non-numeric')}</option>
            <option value="none">{t('Never quote')}</option>
          </Select>
        </div>
        <div>
          <Label>{t('Quote char')}</Label>
          <Segmented
            label={t('Quote character')}
            value={quoteChar}
            onChange={setQuoteChar}
            options={[
              { value: '"', label: t('" Double') },
              { value: "'", label: t('\' Single') },
            ]}
          />
        </div>
        <div>
          <Label>{t('Line endings')}</Label>
          <Segmented
            label={t('Line endings')}
            value={newline}
            onChange={setNewline}
            options={[
              { value: '\n', label: 'LF' },
              { value: '\r\n', label: 'CRLF' },
            ]}
          />
        </div>
        {source.header && <Switch label={t('Include header')} checked={includeHeader} onChange={setIncludeHeader} className="h-8" />}
        <Switch label={t('UTF-8 BOM (Excel)')} checked={bom} onChange={setBom} className="h-8" />
        <Switch label={t('Escape formulas')} checked={escapeFormulae} onChange={setEscapeFormulae} className="h-8" />
      </ToolBar>
      {delimiterError && <ErrorMessage error={delimiterError} title={t('Invalid delimiter')} />}
      {result && result.unsafe > 0 && (
        <Alert tone="warning" title={t('Output may not read back correctly')}>
          {result.unsafe === 1
            ? t('{count} contains the delimiter, a quote or a line break. Without quoting, other programs will split it into extra fields or rows.', { count: pluralize(result.unsafe, t('cell'), t('cells')) })
            : t('{count} contain the delimiter, a quote or a line break. Without quoting, other programs will split them into extra fields or rows.', { count: pluralize(result.unsafe, t('cell'), t('cells')) })}
        </Alert>
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
      <SplitPanes>
        <CsvSourcePanel source={source} sample={SAMPLE_CSV} height="440px" />
        <OutputPanel
          title={t('Output · {value}', { value: delimiterError ? '—' : t(delimiterName(delimiter)) })}
          value={result?.text ?? ''}
          downloadName={fileName}
          downloadType={ext === 'tsv' ? 'text/tab-separated-values' : ext === 'csv' ? 'text/csv' : 'text/plain'}
          placeholder={source.busy ? t('Parsing…') : t('Converted text appears here')}
          height="440px"
          lineWrapping={false}
          footer={
            result && data ? (
              <>
                <span>{pluralize(data.table.rows.length, t('row'), t('rows'))}</span>
                <span>{formatBytes(result.bytes)}</span>
              </>
            ) : undefined
          }
        />
      </SplitPanes>
    </ToolStack>
  );
}
