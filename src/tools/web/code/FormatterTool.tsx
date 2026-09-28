import { useEffect, useState } from 'react';
import type { EditorLanguage } from '@/components/editor/languages';
import { EditorPanel, SplitPanes, ToolBar, ToolStack } from '@/components/tool/EditorPanel';
import { Alert } from '@/components/ui/Alert';
import { Label, Select, Switch } from '@/components/ui/Field';
import { Segmented } from '@/components/ui/Segmented';
import { Spinner } from '@/components/ui/Feedback';
import { useDebouncedValue, useToolState } from '@/lib/hooks';
import { formatBytes } from '@/lib/utils';
import { DEFAULT_OPTIONS, describeFormatError, formatCode, formatErrorText, type FormatError, type FormatOptions, type PrettierParser } from '../lib/prettier';

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
  const [opts, setOpts] = useToolState<FormatOptions>(toolId, 'options', DEFAULT_OPTIONS);
  const debounced = useDebouncedValue(input, 250);
  const [state, setState] = useState<{ output: string; error: FormatError | null; key: string }>({ output: '', error: null, key: '' });
  const current = parsers.find((p) => p.value === parser) ?? parsers[0];
  const set = <K extends keyof FormatOptions>(key: K, value: FormatOptions[K]) => setOpts((o) => ({ ...o, [key]: value }));

  const jobKey = JSON.stringify([debounced, current.value, opts]);
  useEffect(() => {
    if (!debounced.trim()) return;
    let cancelled = false;
    formatCode(debounced, current.value, opts)
      .then((output) => !cancelled && setState({ output, error: null, key: jobKey }))
      .catch((error: unknown) => !cancelled && setState({ output: '', error: describeFormatError(error), key: jobKey }));
    return () => {
      cancelled = true;
    };
    // jobKey captures every input of the job.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobKey]);

  const empty = !input.trim();
  const pending = !empty && state.key !== jobKey;
  const output = empty ? '' : state.output;
  const error = empty ? null : state.error;

  return (
    <ToolStack>
      <ToolBar>
        {parsers.length > 1 && (
          <div>
            <Label htmlFor={`${toolId}-parser`}>Language</Label>
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
          <Label htmlFor={`${toolId}-width`}>Print width</Label>
          <Select id={`${toolId}-width`} value={opts.printWidth} onChange={(e) => set('printWidth', Number(e.target.value))} className="w-auto min-w-24">
            {[40, 60, 80, 100, 120, 160].map((w) => (
              <option key={w} value={w}>
                {w}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label>Indent</Label>
          <Segmented
            label="Indent"
            value={opts.useTabs ? 'tab' : String(opts.tabWidth)}
            onChange={(v) => setOpts((o) => (v === 'tab' ? { ...o, useTabs: true } : { ...o, useTabs: false, tabWidth: Number(v) }))}
            options={[
              { value: '2', label: '2 spaces' },
              { value: '4', label: '4 spaces' },
              { value: 'tab', label: 'Tabs' },
            ]}
          />
        </div>
        <div>
          <Label>Quotes</Label>
          <Segmented
            label="Quotes"
            value={opts.singleQuote ? 'single' : 'double'}
            onChange={(v) => set('singleQuote', v === 'single')}
            options={[
              { value: 'double', label: '"Double"' },
              { value: 'single', label: "'Single'" },
            ]}
          />
        </div>
        {scriptOptions && (
          <>
            <div>
              <Label htmlFor={`${toolId}-trailing`}>Trailing commas</Label>
              <Select
                id={`${toolId}-trailing`}
                value={opts.trailingComma}
                onChange={(e) => set('trailingComma', e.target.value as FormatOptions['trailingComma'])}
                className="w-auto min-w-28"
              >
                <option value="all">All</option>
                <option value="es5">ES5</option>
                <option value="none">None</option>
              </Select>
            </div>
            <Switch label="Semicolons" checked={opts.semi} onChange={(v) => set('semi', v)} className="h-9" />
          </>
        )}
        {markupOptions && (
          <Switch label="Closing > on same line" checked={opts.bracketSameLine} onChange={(v) => set('bracketSameLine', v)} className="h-9" />
        )}
      </ToolBar>
      {error && (
        <Alert tone="danger" title="Syntax error">
          <p>{formatErrorText(error)}</p>
          {error.frame && (
            <pre className="mt-2 overflow-x-auto rounded-md bg-surface-sunken p-2 font-mono text-[12px] leading-relaxed text-fg">{error.frame}</pre>
          )}
        </Alert>
      )}
      <SplitPanes>
        <EditorPanel
          title="Input"
          value={input}
          onChange={setInput}
          language={current.language}
          code
          placeholder={`Paste ${current.label} here…`}
          sample={current.sample}
          fileAccept={fileAccept}
          invalid={Boolean(error)}
          height="520px"
          lineWrapping={false}
          footer={input ? <span>{formatBytes(new Blob([input]).size)}</span> : undefined}
        />
        <EditorPanel
          title="Formatted"
          value={output}
          language={current.language}
          code
          placeholder={empty ? 'Formatted code appears here' : ''}
          downloadName={`formatted.${current.ext}`}
          height="520px"
          lineWrapping={false}
          footer={
            pending ? (
              <Spinner size={13} label="Formatting…" />
            ) : output ? (
              <>
                <span className="text-success">Formatted with Prettier</span>
                <span>{output.split('\n').length - 1} lines</span>
                <span>{formatBytes(new Blob([output]).size)}</span>
              </>
            ) : undefined
          }
        />
      </SplitPanes>
    </ToolStack>
  );
}
