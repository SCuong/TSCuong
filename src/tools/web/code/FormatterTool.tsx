import { useMemo } from 'react';
import type { EditorLanguage } from '@/components/editor/languages';
import { EditorPanel, SplitPanes, ToolBar, ToolStack } from '@/components/tool/EditorPanel';
import { Alert } from '@/components/ui/Alert';
import { Label, Select, Switch } from '@/components/ui/Field';
import { Segmented } from '@/components/ui/Segmented';
import { useDebouncedValue, useToolState } from '@/lib/hooks';
import { formatBytes } from '@/lib/utils';
import { DEFAULT_OPTIONS, formatErrorText, type FormatOptions, type PrettierParser } from '../lib/prettier';
import { useCodeJob } from './codeRunner';
import { JobStatus, settledOutcome, useByteSize } from './shared';
import { t } from '@/lib/i18n';

export interface ParserOption {
  value: PrettierParser;
  label: string;
  language: EditorLanguage;
  ext: string;
  sample: string;
}

export function FormatterTool({
  toolId,
  parsers,
  scriptOptions,
  markupOptions,
  fileAccept,
}: {
  toolId: string;
  parsers: ParserOption[];
  /** Show semicolons / trailing commas (JavaScript-like languages). */
  scriptOptions?: boolean;
  /** Show the "bracket on same line" option (HTML/JSX). */
  markupOptions?: boolean;
  fileAccept: string;
}) {
  const [input, setInput] = useToolState(toolId, 'input', '');
  const [parser, setParser] = useToolState<PrettierParser>(toolId, 'parser', parsers[0].value);
  const [stored, setOpts] = useToolState<FormatOptions>(toolId, 'options', DEFAULT_OPTIONS);
  const opts = { ...DEFAULT_OPTIONS, ...stored };
  const debounced = useDebouncedValue(input, input.length > 200_000 ? 500 : 250);
  const current = parsers.find((p) => p.value === parser) ?? parsers[0];
  const set = <K extends keyof FormatOptions>(key: K, value: FormatOptions[K]) => setOpts((o) => ({ ...DEFAULT_OPTIONS, ...o, [key]: value }));

  // Prettier runs in a worker: megabytes of input never freeze the page, and a newer edit cancels the old job.
  const jobKey = debounced.trim() ? JSON.stringify([debounced, current.value, opts]) : null;
  const job = useCodeJob<'format'>(jobKey, () => ({ kind: 'format', code: debounced, parser: current.value, options: opts }));

  const empty = !input.trim();
  const settled = empty ? null : settledOutcome(job.state, job.previous);
  const output = settled?.status === 'done' ? settled.value : '';
  const error = settled?.status === 'error' ? settled.error : null;
  const inputBytes = useByteSize(input);
  const outputBytes = useByteSize(output);
  const outputLines = useMemo(() => (output ? output.split('\n').length - 1 : 0), [output]);
  const status = empty ? 'idle' : job.state.status;

  return (
    <ToolStack>
      <ToolBar>
        {parsers.length > 1 && (
          <div>
            <Label htmlFor={`${toolId}-parser`}>{t('Language')}</Label>
            <Select id={`${toolId}-parser`} value={current.value} onChange={(e) => setParser(e.target.value as PrettierParser)} className="w-auto min-w-36">
              {parsers.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </Select>
          </div>
        )}
        <div>
          <Label htmlFor={`${toolId}-width`}>{t('Print width')}</Label>
          <Select id={`${toolId}-width`} value={opts.printWidth} onChange={(e) => set('printWidth', Number(e.target.value))} className="w-auto min-w-24">
            {[40, 60, 80, 100, 120, 160].map((w) => (
              <option key={w} value={w}>
                {w}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label>{t('Indent')}</Label>
          <Segmented
            label={t('Indent')}
            value={opts.useTabs ? 'tab' : String(opts.tabWidth)}
            onChange={(v) => setOpts((o) => (v === 'tab' ? { ...o, useTabs: true } : { ...o, useTabs: false, tabWidth: Number(v) }))}
            options={[
              { value: '2', label: t('2 spaces') },
              { value: '4', label: t('4 spaces') },
              { value: 'tab', label: t('Tabs') },
            ]}
          />
        </div>
        <div>
          <Label>{t('Quotes')}</Label>
          <Segmented
            label={t('Quotes')}
            value={opts.singleQuote ? 'single' : 'double'}
            onChange={(v) => set('singleQuote', v === 'single')}
            options={[
              { value: 'double', label: t('"Double"') },
              { value: 'single', label: t('\'Single\'') },
            ]}
          />
        </div>
        {scriptOptions && (
          <>
            <div>
              <Label htmlFor={`${toolId}-trailing`}>{t('Trailing commas')}</Label>
              <Select
                id={`${toolId}-trailing`}
                value={opts.trailingComma}
                onChange={(e) => set('trailingComma', e.target.value as FormatOptions['trailingComma'])}
                className="w-auto min-w-28"
              >
                <option value="all">{t('All')}</option>
                <option value="es5">ES5</option>
                <option value="none">{t('None')}</option>
              </Select>
            </div>
            <Switch label={t('Semicolons')} checked={opts.semi} onChange={(v) => set('semi', v)} className="h-9" />
          </>
        )}
        {markupOptions && (
          <Switch label={t('Closing > on same line')} checked={opts.bracketSameLine} onChange={(v) => set('bracketSameLine', v)} className="h-9" />
        )}
      </ToolBar>
      {error && (
        <Alert tone="danger" title={t('Syntax error')}>
          <p>{formatErrorText(error)}</p>
          {error.frame && (
            <pre className="mt-2 overflow-x-auto rounded-md bg-surface-sunken p-2 font-mono text-[12px] leading-relaxed text-fg">{error.frame}</pre>
          )}
        </Alert>
      )}
      <SplitPanes>
        <EditorPanel
          title={t('Input')}
          value={input}
          onChange={setInput}
          language={current.language}
          code
          placeholder={t('Paste {label} here…', { label: current.label })}
          sample={current.sample}
          fileAccept={fileAccept}
          invalid={Boolean(error)}
          height="520px"
          lineWrapping={false}
          footer={input ? <span>{formatBytes(inputBytes)}</span> : undefined}
        />
        <EditorPanel
          title={t('Formatted')}
          value={output}
          language={current.language}
          code
          placeholder={empty ? t('Formatted code appears here') : ''}
          downloadName={`formatted.${current.ext}`}
          height="520px"
          lineWrapping={false}
          footer={
            status === 'pending' || status === 'cancelled' ? (
              <JobStatus status={status} busyLabel={t('Formatting…')} onCancel={job.cancel} />
            ) : output ? (
              <>
                <span className="text-success">{t('Formatted with Prettier')}</span>
                <span>{t('{outputLines} lines', { outputLines: outputLines.toLocaleString() })}</span>
                <span>{formatBytes(outputBytes)}</span>
              </>
            ) : undefined
          }
        />
      </SplitPanes>
    </ToolStack>
  );
}
