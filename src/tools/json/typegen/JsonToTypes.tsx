import { useEffect, useMemo, useState } from 'react';
import { SplitPanes, ToolBar, ToolStack } from '@/components/tool/EditorPanel';
import { Input, Label, Select, Switch } from '@/components/ui/Field';
import { Segmented } from '@/components/ui/Segmented';
import { Alert, ErrorMessage } from '@/components/ui/Alert';
import { Spinner } from '@/components/ui/Feedback';
import { useDebouncedValue, useToolState } from '@/lib/hooks';
import { formatBytes, pluralize } from '@/lib/utils';
import type { EditorLanguage } from '@/components/editor/languages';
import { CodePanel } from '../shared/CodePanel';
import { problemMarkers } from '../shared/errorMarkers';
import { formatJsonError } from '../lib/json';
import { TARGETS, targetInfo, type GenerateOptions, type GenerateResult, type TargetId } from './lib/generate';
import type { NullMode } from './lib/infer';
import type { TypegenRequest } from './lib/typegen.worker';
import { useExtraLanguage, useLatestJobRunner } from './hooks';

const ID = 'json-to-types';

const SAMPLE = JSON.stringify(
  {
    id: 1024,
    username: 'ada',
    email: 'ada@example.com',
    isActive: true,
    createdAt: '2024-03-18T09:30:00Z',
    score: 98.5,
    tags: ['admin', 'beta'],
    profile: { displayName: 'Ada Lovelace', avatarUrl: 'https://example.com/ada.png', bio: null },
    addresses: [
      { type: 'home', street: '12 Analytical Way', city: 'London', postalCode: 'NW1 6XE' },
      { type: 'work', street: '1 Engine Road', city: 'London', postalCode: null, unit: '4B' },
    ],
    settings: { theme: 'dark', 'email-digest': 'weekly', notifications: { email: true, push: false } },
    recentLogins: [],
  },
  null,
  2,
);

const NULL_MODES: Array<{ value: NullMode; label: string }> = [
  { value: 'exact', label: 'Optional if missing, nullable if null' },
  { value: 'loose', label: 'Optional and nullable if either' },
  { value: 'all-optional', label: 'Every field optional' },
];

function createWorker() {
  return new Worker(new URL('./lib/typegen.worker.ts', import.meta.url), { type: 'module', name: 'json-to-types' });
}

type Output = { result: GenerateResult } | { failure: string };

export default function JsonToTypes() {
  const [input, setInput] = useToolState(ID, 'input', '');
  const [target, setTarget] = useToolState<TargetId>(ID, 'target', 'typescript');
  const [rootName, setRootName] = useToolState(ID, 'rootName', 'Root');
  const [nullMode, setNullMode] = useToolState<NullMode>(ID, 'nullMode', 'exact');
  const [formats, setFormats] = useToolState(ID, 'formats', true);
  const [exportTypes, setExportTypes] = useToolState(ID, 'export', true);
  const [readonly, setReadonly] = useToolState(ID, 'readonly', false);
  const [idiomaticNames, setIdiomaticNames] = useToolState(ID, 'idiomaticNames', true);
  const [csharpStyle, setCsharpStyle] = useToolState<'record' | 'class'>(ID, 'csharpStyle', 'record');
  const [goPackage, setGoPackage] = useToolState(ID, 'goPackage', 'main');

  const text = useDebouncedValue(input, input.length > 500_000 ? 500 : input.length > 50_000 ? 250 : 120);
  const root = useDebouncedValue(rootName, 250);
  const pkg = useDebouncedValue(goPackage, 250);
  const info = targetInfo(target);
  const nullModeValue = NULL_MODES.some((m) => m.value === nullMode) ? nullMode : 'exact';

  const options = useMemo<GenerateOptions>(
    () => ({
      target: info.id,
      rootName: root,
      nullMode: nullModeValue,
      formats,
      exportTypes,
      readonly,
      idiomaticNames,
      csharpStyle,
      goPackage: pkg,
    }),
    [info.id, root, nullModeValue, formats, exportTypes, readonly, idiomaticNames, csharpStyle, pkg],
  );

  const runner = useLatestJobRunner<TypegenRequest, GenerateResult>(createWorker, 30_000);
  const [output, setOutput] = useState<Output | null>(null);
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    if (!text.trim()) {
      runner.dispose();
      setOutput(null);
      setSlow(false);
      return;
    }
    let active = true;
    const timer = setTimeout(() => active && setSlow(true), 250);
    void runner.run({ text, options }).then((outcome) => {
      if (!active || outcome.status === 'superseded') return;
      clearTimeout(timer);
      setSlow(false);
      if (outcome.status === 'done') setOutput({ result: outcome.result });
      else if (outcome.status === 'timeout') setOutput({ failure: 'Generating the types took longer than 30 seconds. Try a smaller sample.' });
      else setOutput({ failure: 'The type generator stopped unexpectedly. The input may be too large for this browser.' });
    });
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [runner, text, options]);

  const hasInput = Boolean(input.trim());
  const result = hasInput && output && 'result' in output ? output.result : null;
  const failure = hasInput && output && 'failure' in output ? output.failure : null;
  const parseError = result && !result.ok ? result.error : null;
  const code = result?.ok ? result.code : '';

  const inputExtensions = useMemo(
    () => [problemMarkers(parseError ? [{ line: parseError.line, column: parseError.column, message: parseError.message }] : [])],
    [parseError],
  );
  const extraLanguage = info.language === 'csharp' || info.language === 'kotlin' ? info.language : null;
  const editorLanguage: EditorLanguage = info.language === 'csharp' || info.language === 'kotlin' ? 'plain' : info.language;
  const outputExtensions = useExtraLanguage(extraLanguage);

  return (
    <ToolStack>
      <ToolBar>
        <div className="w-full min-w-0 sm:w-60">
          <Label htmlFor="typegen-target">Language</Label>
          <Select id="typegen-target" value={info.id} onChange={(e) => setTarget(e.target.value as TargetId)}>
            {TARGETS.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </Select>
        </div>
        <div className="w-full min-w-0 sm:w-40">
          <Label htmlFor="typegen-root">Root type name</Label>
          <Input
            id="typegen-root"
            value={rootName}
            onChange={(e) => setRootName(e.target.value)}
            placeholder="Root"
            spellCheck={false}
            autoComplete="off"
          />
        </div>
        <div className="w-full min-w-0 sm:w-72">
          <Label htmlFor="typegen-nulls">Missing keys and nulls</Label>
          <Select id="typegen-nulls" value={nullModeValue} onChange={(e) => setNullMode(e.target.value as NullMode)}>
            {NULL_MODES.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </Select>
        </div>
        {info.options.includes('goPackage') && (
          <div className="w-full min-w-0 sm:w-32">
            <Label htmlFor="typegen-package">Package</Label>
            <Input
              id="typegen-package"
              value={goPackage}
              onChange={(e) => setGoPackage(e.target.value)}
              placeholder="main"
              spellCheck={false}
              autoComplete="off"
              className="font-mono text-[13px]"
            />
          </div>
        )}
        {info.options.includes('csharpStyle') && (
          <div>
            <Label>Declare as</Label>
            <Segmented
              label="Declare as"
              value={csharpStyle}
              onChange={setCsharpStyle}
              options={[
                { value: 'record', label: 'Records' },
                { value: 'class', label: 'Classes' },
              ]}
            />
          </div>
        )}
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 sm:h-9">
          <Switch label="Detect formats" checked={formats} onChange={setFormats} />
          {info.options.includes('export') && <Switch label="Export" checked={exportTypes} onChange={setExportTypes} />}
          {info.options.includes('readonly') && <Switch label="Readonly" checked={readonly} onChange={setReadonly} />}
          {info.options.includes('names') && (
            <Switch label="Idiomatic names" checked={idiomaticNames} onChange={setIdiomaticNames} />
          )}
        </div>
      </ToolBar>

      <ErrorMessage
        title={parseError ? 'Invalid JSON' : 'Could not generate types'}
        error={parseError ? formatJsonError(parseError) : failure}
      />

      <SplitPanes>
        <CodePanel
          title="JSON"
          value={input}
          onChange={setInput}
          language="json"
          placeholder="Paste a JSON sample, e.g. an API response…"
          sample={SAMPLE}
          fileAccept=".json,application/json,text/plain"
          invalid={Boolean(parseError)}
          height="520px"
          extensions={inputExtensions}
          footer={hasInput ? <span>{formatBytes(new Blob([input]).size)}</span> : undefined}
        />
        <CodePanel
          title={info.label}
          value={code}
          language={editorLanguage}
          extensions={outputExtensions}
          placeholder="Types appear here as you type or paste JSON."
          downloadName={info.filename}
          downloadType="text/plain;charset=utf-8"
          lineWrapping={false}
          height="520px"
          footer={
            slow ? (
              <Spinner label="Generating…" size={14} />
            ) : result?.ok ? (
              <>
                <span>
                  {pluralize(result.types, 'type')}, {pluralize(result.fields, 'field')}
                </span>
                {formats && <span className="min-w-0">{info.formatsHint}</span>}
              </>
            ) : undefined
          }
        />
      </SplitPanes>

      {result?.ok && result.warnings.length > 0 && (
        <Alert tone="warning" title="Partially analysed">
          {result.warnings.join(' ')}
        </Alert>
      )}
    </ToolStack>
  );
}
