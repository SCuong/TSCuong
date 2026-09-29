import { useDeferredValue, useMemo } from 'react';
import { CircleCheck, CircleX, Crosshair, FileCheck, TriangleAlert } from 'lucide-react';
import { EditorPanel, SplitPanes, ToolBar, ToolStack } from '@/components/tool/EditorPanel';
import { Button } from '@/components/ui/Button';
import { Switch } from '@/components/ui/Field';
import { EmptyState } from '@/components/ui/Feedback';
import { Badge, Panel, Stat } from '@/components/ui/Panel';
import { Segmented } from '@/components/ui/Segmented';
import { useToolState } from '@/lib/hooks';
import { cn, formatNumber, pluralize } from '@/lib/utils';
import type { EditorProblem } from '@/tools/json/shared/errorMarkers';
import { describeDifference, formatYaml, validateYaml, type YamlDiagnostic, type YamlVersion } from './lib/yaml';
import { Option, TextStats, useEditorView, useProblemMarkers } from './shared/ConvertUi';

const TOOL = 'yaml-formatter';

const SAMPLE = `# Deployment settings
app:
    name: localkit
    replicas: 3
    ports: [80, 443]
    features: {search: on, beta: no}
defaults: &defaults
    timeout: 30
    retries: 2
jobs:
    - name: build
      <<: *defaults
      steps:
          - run: npm ci
          - run: npm test
    - name: deploy
      <<: *defaults
      when: 2024-06-01
---
# A second document
kind: ConfigMap
data:
    mode: 0755
`;

interface Settings {
  indent: '2' | '4';
  indentSeq: boolean;
  sortKeys: boolean;
  foldLines: boolean;
  blockStyle: boolean;
  version: YamlVersion;
}

interface Problem extends YamlDiagnostic {
  kind: 'error' | 'warning' | 'version';
}

export default function YamlFormatter() {
  const [input, setInput] = useToolState(TOOL, 'input', '');
  const [s, setS] = useToolState<Settings>(TOOL, 'settings', {
    indent: '2',
    indentSeq: true,
    sortKeys: false,
    foldLines: false,
    blockStyle: false,
    version: '1.2',
  });
  const set = <K extends keyof Settings>(key: K, value: Settings[K]) => setS((o) => ({ ...o, [key]: value }));
  const editor = useEditorView();

  const deferred = useDeferredValue(input);
  const validation = useMemo(() => (deferred.trim() ? validateYaml(deferred, { version: s.version }) : null), [deferred, s.version]);
  const formatted = useMemo(() => (validation && validation.errors.length === 0 ? formatYaml(deferred, s) : null), [validation, deferred, s]);

  const problems = useMemo<Problem[]>(() => {
    if (!validation) return [];
    const list: Problem[] = [
      ...validation.errors.map((e) => ({ ...e, kind: 'error' as const })),
      ...validation.warnings.map((w) => ({ ...w, kind: 'warning' as const })),
      ...validation.differences.items.map((d) => ({
        kind: 'version' as const,
        severity: 'warning' as const,
        message: describeDifference(d),
        line: d.line,
        column: d.column,
      })),
    ];
    return list.slice(0, 300);
  }, [validation]);

  const editorProblems = useMemo<EditorProblem[]>(
    () =>
      problems
        .filter((p) => p.line !== undefined)
        .map((p) => ({
          line: p.line!,
          column: p.column,
          length: p.endLine === p.line && p.endColumn && p.column ? Math.max(1, p.endColumn - p.column) : 1,
          severity: p.severity,
          message: p.message,
        })),
    [problems],
  );
  const markers = useProblemMarkers(null, editorProblems);

  const firstError = validation?.errors[0];
  const output = formatted?.ok ? formatted.value : '';
  const stats = validation?.stats;
  const warningCount = problems.filter((p) => p.kind !== 'error').length;

  return (
    <ToolStack>
      <ToolBar>
        <Option label="Indent">
          <Segmented
            label="Indent"
            value={s.indent}
            onChange={(v) => set('indent', v)}
            options={[
              { value: '2', label: '2 spaces' },
              { value: '4', label: '4 spaces' },
            ]}
          />
        </Option>
        <Option label="YAML version">
          <Segmented
            label="YAML version"
            value={s.version}
            onChange={(v) => set('version', v)}
            options={[
              { value: '1.2', label: 'YAML 1.2', title: 'Current spec: yes/no/on/off are strings' },
              { value: '1.1', label: 'YAML 1.1', title: 'PyYAML, go-yaml v2: yes/no/on/off are booleans' },
            ]}
          />
        </Option>
        <Switch label="Sort keys" checked={s.sortKeys} onChange={(v) => set('sortKeys', v)} className="h-8" />
        <Switch label="Indent lists" checked={s.indentSeq} onChange={(v) => set('indentSeq', v)} className="h-8" />
        <Switch label="Expand {…} and […] to block style" checked={s.blockStyle} onChange={(v) => set('blockStyle', v)} className="h-8" />
        <Switch label="Fold long strings" checked={s.foldLines} onChange={(v) => set('foldLines', v)} className="h-8" />
      </ToolBar>

      {validation && (
        <div
          role={firstError ? 'alert' : 'status'}
          className={cn('flex flex-wrap items-center justify-between gap-3 rounded-xl px-4 py-3', firstError ? 'bg-danger-soft' : 'bg-success-soft')}
        >
          <div className="flex min-w-0 items-start gap-2">
            {firstError ? (
              <CircleX size={18} className="mt-0.5 shrink-0 text-danger" aria-hidden />
            ) : (
              <CircleCheck size={18} className="mt-0.5 shrink-0 text-success" aria-hidden />
            )}
            <div className="min-w-0">
              <p className="text-sm font-semibold text-fg">
                {firstError ? `Invalid YAML — ${pluralize(validation.errors.length, 'error')}` : 'Valid YAML'}
              </p>
              <p className="mt-0.5 text-[13px] break-words text-fg-secondary">
                {firstError
                  ? `${firstError.message}${firstError.line ? ` (line ${firstError.line}, column ${firstError.column ?? 1})` : ''}`
                  : `${pluralize(validation.documents, 'document')}${warningCount ? ` · ${pluralize(warningCount, 'warning')}` : ' · no warnings'}`}
              </p>
            </div>
          </div>
          {firstError?.line && (
            <Button size="sm" icon={Crosshair} onClick={() => editor.reveal(firstError.line, firstError.column)}>
              Go to error
            </Button>
          )}
        </div>
      )}

      <SplitPanes>
        <EditorPanel code
          title="YAML"
          value={input}
          onChange={setInput}
          language="yaml"
          placeholder="Paste YAML to validate and format…"
          sample={SAMPLE}
          fileAccept=".yaml,.yml,text/yaml,application/yaml,text/plain"
          invalid={Boolean(firstError)}
          height="480px"
          extensions={markers}
          onReady={editor.onReady}
          footer={input ? <TextStats text={input} /> : undefined}
        />
        <EditorPanel
          title="Formatted YAML"
          value={output}
          language="yaml"
          downloadName="formatted.yaml"
          downloadType="application/yaml"
          placeholder={firstError ? 'Fix the errors to see the formatted YAML' : 'Formatted YAML appears here'}
          height="480px"
          lineWrapping={false}
          footer={output ? <TextStats text={output} extra={<span>Comments and anchors kept</span>} /> : undefined}
        />
      </SplitPanes>

      {!validation ? (
        <Panel title="Problems">
          <EmptyState icon={FileCheck} title="Nothing to check yet">
            Paste YAML, open a .yml file or load the sample. Syntax errors, duplicate keys and values that YAML 1.1 and 1.2 read differently are pinpointed here.
          </EmptyState>
        </Panel>
      ) : (
        <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
          <Panel
            title={
              <span className="inline-flex items-center gap-1.5">
                {problems.length ? <TriangleAlert size={14} className={firstError ? 'text-danger' : 'text-warning'} aria-hidden /> : null}
                {problems.length ? pluralize(problems.length, 'problem') : 'No problems'}
              </span>
            }
            description={problems.length ? 'Select a problem to jump to it.' : undefined}
            bodyClassName="p-0"
          >
            {problems.length === 0 ? (
              <p className="px-4 py-3 text-[13px] text-fg-muted">No syntax errors, duplicate keys or version-dependent values were found.</p>
            ) : (
              <ul className="max-h-72 divide-y divide-line overflow-y-auto">
                {problems.map((p, i) => (
                  <li key={i}>
                    <button
                      type="button"
                      disabled={p.line === undefined}
                      onClick={() => editor.reveal(p.line, p.column)}
                      className="flex w-full items-start gap-3 px-4 py-2 text-left hover:bg-surface-hover disabled:cursor-default"
                    >
                      <Badge tone={p.kind === 'error' ? 'danger' : 'warning'} className="mt-0.5">
                        {p.kind === 'error' ? 'Error' : p.kind === 'version' ? '1.1 vs 1.2' : 'Warning'}
                      </Badge>
                      <span className="min-w-0 flex-1 text-[13px] break-words text-fg">{p.message}</span>
                      {p.line !== undefined && <span className="shrink-0 text-[12px] text-fg-muted tabular-nums">line {p.line}</span>}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {validation.differences.total > validation.differences.items.length && (
              <p className="border-t border-line px-4 py-2 text-[12.5px] text-fg-muted">
                Showing the first {formatNumber(validation.differences.items.length)} of {formatNumber(validation.differences.total)} version-dependent values.
              </p>
            )}
          </Panel>
          <Panel title="Statistics">
            {stats ? (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                <Stat label="Documents" value={formatNumber(stats.documents)} />
                <Stat label="Mappings" value={formatNumber(stats.mappings)} />
                <Stat label="Sequences" value={formatNumber(stats.sequences)} />
                <Stat label="Keys" value={formatNumber(stats.keys)} />
                <Stat label="Scalars" value={formatNumber(stats.scalars)} />
                <Stat label="Max depth" value={formatNumber(stats.maxDepth)} />
                <Stat label="Anchors" value={formatNumber(stats.anchors)} />
                <Stat label="Aliases" value={formatNumber(stats.aliases)} />
                <Stat label="Comments" value={formatNumber(stats.comments)} />
              </div>
            ) : (
              <p className="text-[13px] text-fg-muted">Statistics appear once the YAML is valid.</p>
            )}
          </Panel>
        </div>
      )}
    </ToolStack>
  );
}
