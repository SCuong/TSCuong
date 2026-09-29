import { useEffect, useMemo, useRef, useState } from 'react';
import { EditorView } from '@codemirror/view';
import { BookOpenCheck, Crosshair, FileSearch, ListChecks, WandSparkles } from 'lucide-react';
import { EditorPanel, SplitPanes, ToolBar, ToolStack } from '@/components/tool/EditorPanel';
import { Label, Switch } from '@/components/ui/Field';
import { Segmented } from '@/components/ui/Segmented';
import { Alert } from '@/components/ui/Alert';
import { Badge, Panel } from '@/components/ui/Panel';
import { Button, IconButton } from '@/components/ui/Button';
import { EmptyState, Spinner } from '@/components/ui/Feedback';
import { ConfirmDialog } from '@/components/ui/Dialog';
import { toast } from '@/components/ui/Toast';
import { useDebouncedValue, useToolState } from '@/lib/hooks';
import { cn, formatBytes, formatNumber, pluralize } from '@/lib/utils';
import { problemMarkers, type EditorProblem } from '../shared/errorMarkers';
import { useLatestJobRunner } from '../typegen/hooks';
import { DRAFT_LABELS, type DraftChoice } from './lib/drafts';
import { SCHEMA_SAMPLES } from './lib/samples';
import type { TextPosition } from './lib/locate';
import type { LocatedIssue, LocatedProblem, TextError, ValidationJob, ValidationRun } from './lib/validate';
import type { SchemaWorkerRequest, SchemaWorkerResult } from './lib/schema.worker';

const ID = 'json-schema-validator';

const DRAFTS: Array<{ value: DraftChoice; label: string; title: string }> = [
  { value: 'auto', label: 'Auto', title: 'Use the draft declared in "$schema" (2020-12 when there is none)' },
  { value: '4', label: 'Draft 4', title: 'JSON Schema draft-04' },
  { value: '7', label: 'Draft 7', title: 'JSON Schema draft-07 (also used for draft-06)' },
  { value: '2019-09', label: '2019-09', title: 'JSON Schema 2019-09' },
  { value: '2020-12', label: '2020-12', title: 'JSON Schema 2020-12' },
];

function createWorker() {
  return new Worker(new URL('./lib/schema.worker.ts', import.meta.url), { type: 'module', name: 'json-schema-validator' });
}

/** Selects a node in an editor and scrolls it into view. */
function reveal(view: EditorView | null, at: TextPosition | TextError | null) {
  if (!view || !at) return;
  const doc = view.state.doc;
  const line = doc.line(Math.max(1, Math.min(at.line, doc.lines)));
  const from = Math.min(line.to, line.from + Math.max(0, at.column - 1));
  const to = Math.min(line.to, from + ('length' in at ? at.length : 0));
  view.dispatch({ selection: { anchor: from, head: to }, effects: EditorView.scrollIntoView(from, { y: 'center' }) });
  view.focus();
}

const pointerLabel = (pointer: string) => pointer || '(root)';

type Result = { run: ValidationRun } | { failure: string };

function IssueRow({ issue, onDoc, onSchema }: { issue: LocatedIssue; onDoc: (at: TextPosition | null) => void; onSchema: (at: TextPosition | null) => void }) {
  return (
    <div className="flex items-start gap-1 px-1.5 py-1">
      <button
        type="button"
        onClick={() => onDoc(issue.at)}
        disabled={!issue.at}
        className="flex min-w-0 flex-1 flex-col gap-1 rounded-lg px-2.5 py-1.5 text-left hover:bg-surface-hover disabled:cursor-default disabled:hover:bg-transparent"
      >
        <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <code className="min-w-0 font-mono text-[12.5px] break-all text-accent-text">{pointerLabel(issue.instancePath)}</code>
          <Badge className="font-mono">{issue.keyword}</Badge>
          {issue.at && <span className="ml-auto shrink-0 text-[12px] text-fg-muted tabular-nums">line {issue.at.line}</span>}
        </span>
        <span className="text-[13px] break-words text-fg">{issue.message}</span>
      </button>
      {issue.schemaAt && (
        <IconButton icon={FileSearch} label="Show the rule in the schema" size="sm" className="mt-1" onClick={() => onSchema(issue.schemaAt)} />
      )}
    </div>
  );
}

function IssueDetails({ issue, onDoc }: { issue: LocatedIssue; onDoc: (at: TextPosition | null) => void }) {
  if (!issue.details?.length) return null;
  return (
    <details className="mx-4 mb-2 rounded-lg border border-line bg-surface-sunken px-3 py-2">
      <summary className="cursor-pointer text-[12.5px] font-medium text-fg-secondary select-none">Why each option failed</summary>
      <ul className="mt-2 flex flex-col gap-2">
        {issue.details.map((d) => (
          <li key={d.label}>
            <p className="text-[12px] font-medium text-fg-muted">{d.label}</p>
            <ul className="mt-0.5">
              {d.issues.map((sub, i) => (
                <li key={i}>
                  <button
                    type="button"
                    onClick={() => onDoc(sub.at)}
                    disabled={!sub.at}
                    className="w-full rounded-md px-2 py-1 text-left text-[12.5px] hover:bg-surface-hover disabled:hover:bg-transparent"
                  >
                    <code className="font-mono break-all text-accent-text">{pointerLabel(sub.instancePath)}</code>{' '}
                    <span className="text-fg">{sub.message}</span>
                  </button>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </details>
  );
}

function ProblemList({ problems, onSchema }: { problems: LocatedProblem[]; onSchema: (at: TextPosition | null) => void }) {
  return (
    <ul className="flex flex-col">
      {problems.map((p, i) => (
        <li key={i}>
          <button
            type="button"
            onClick={() => onSchema(p.at)}
            disabled={!p.at}
            className="flex w-full min-w-0 flex-col gap-0.5 rounded-md px-2 py-1.5 text-left hover:bg-surface-hover disabled:hover:bg-transparent"
          >
            <span className="flex flex-wrap items-center gap-x-2">
              <code className="font-mono text-[12px] break-all text-fg-secondary">{pointerLabel(p.pointer)}</code>
              {p.at && <span className="text-[12px] text-fg-muted tabular-nums">line {p.at.line}</span>}
            </span>
            <span className="text-[13px] break-words text-fg">{p.message}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

export default function JsonSchemaValidator() {
  const [doc, setDoc] = useToolState(ID, 'doc', '');
  const [schema, setSchema] = useToolState(ID, 'schema', '');
  const [draftChoice, setDraft] = useToolState<DraftChoice>(ID, 'draft', 'auto');
  const [formats, setFormats] = useToolState(ID, 'formats', true);
  const docView = useRef<EditorView | null>(null);
  const schemaView = useRef<EditorView | null>(null);
  const draft = DRAFTS.some((d) => d.value === draftChoice) ? draftChoice : 'auto';

  const size = doc.length + schema.length;
  const job = useMemo<ValidationJob>(() => ({ doc, schema, draft, formats }), [doc, schema, draft, formats]);
  const debounced = useDebouncedValue(job, size > 500_000 ? 600 : size > 50_000 ? 300 : 150);

  const validator = useLatestJobRunner<SchemaWorkerRequest, SchemaWorkerResult>(createWorker, 20_000);
  const generator = useLatestJobRunner<SchemaWorkerRequest, SchemaWorkerResult>(createWorker, 30_000);
  const [result, setResult] = useState<Result | null>(null);
  const [slow, setSlow] = useState(false);
  const [confirmReplace, setConfirmReplace] = useState(false);
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    if (!debounced.doc.trim() && !debounced.schema.trim()) {
      validator.dispose();
      setResult(null);
      setSlow(false);
      return;
    }
    let active = true;
    const timer = setTimeout(() => active && setSlow(true), 300);
    void validator.run({ kind: 'validate', ...debounced }).then((outcome) => {
      if (!active || outcome.status === 'superseded') return;
      clearTimeout(timer);
      setSlow(false);
      if (outcome.status === 'done' && outcome.result.kind === 'validate') setResult({ run: outcome.result.run });
      else if (outcome.status === 'timeout') {
        setResult({ failure: 'Validation took longer than 20 seconds and was stopped. A "pattern" in the schema may be extremely slow on this input.' });
      } else if (outcome.status === 'done' && outcome.result.kind === 'error') setResult({ failure: outcome.result.message });
      else setResult({ failure: 'The validator stopped unexpectedly. The input may be too large for this browser.' });
    });
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [validator, debounced]);

  const hasDoc = doc.trim() !== '';
  const hasSchema = schema.trim() !== '';
  const run = result && 'run' in result ? result.run : null;
  const failure = result && 'failure' in result ? result.failure : (run?.failure ?? null);
  const schemaErrors = run?.problems.filter((p) => p.severity === 'error') ?? [];
  const warnings = run?.problems.filter((p) => p.severity === 'warning') ?? [];
  const docError = hasDoc ? (run?.docError ?? null) : null;
  const schemaError = hasSchema ? (run?.schemaError ?? null) : null;

  const docExtensions = useMemo(() => {
    const problems: EditorProblem[] = [];
    if (run?.docError) problems.push({ line: run.docError.line, column: run.docError.column, message: run.docError.message });
    for (const issue of run?.issues.slice(0, 400) ?? []) {
      if (issue.at) problems.push({ ...issue.at, message: issue.message });
    }
    return [problemMarkers(problems)];
  }, [run]);

  const schemaExtensions = useMemo(() => {
    const problems: EditorProblem[] = [];
    if (run?.schemaError) problems.push({ line: run.schemaError.line, column: run.schemaError.column, message: run.schemaError.message });
    for (const p of run?.problems ?? []) {
      if (p.at) problems.push({ ...p.at, message: p.message, severity: p.severity });
    }
    return [problemMarkers(problems)];
  }, [run]);

  async function generate() {
    setConfirmReplace(false);
    setGenerating(true);
    const outcome = await generator.run({ kind: 'generate', doc });
    setGenerating(false);
    if (outcome.status === 'superseded') return;
    if (outcome.status === 'done' && outcome.result.kind === 'generate') {
      const r = outcome.result.result;
      if (r.ok) {
        setSchema(r.schema);
        toast('Schema generated from the document.');
      } else toast(`The document is not valid JSON: ${r.error.message} (line ${r.error.line}).`, 'error');
      return;
    }
    toast('A schema could not be generated from this document.', 'error');
  }

  const onGenerate = () => {
    if (hasSchema) setConfirmReplace(true);
    else void generate();
  };

  const loadSample = (id: string) => {
    const sample = SCHEMA_SAMPLES.find((s) => s.id === id);
    if (!sample) return;
    setDoc(sample.doc);
    setSchema(sample.schema);
  };

  const onDoc = (at: TextPosition | TextError | null) => reveal(docView.current, at);
  const onSchema = (at: TextPosition | TextError | null) => reveal(schemaView.current, at);
  const sourceLabel = run?.draftSource === 'declared' ? 'from $schema' : run?.draftSource === 'selected' ? 'selected' : 'default';
  const canValidate = hasDoc && hasSchema && !docError && !schemaError && schemaErrors.length === 0 && !failure;

  const docFooter = (
    <>
      {hasDoc && <span>{formatBytes(new Blob([doc]).size)}</span>}
      {slow && <Spinner size={13} label="Validating…" />}
      {!slow && canValidate && run?.outcome === 'valid' && <span className="font-medium text-success">Valid against the schema</span>}
      {!slow && canValidate && run?.outcome === 'invalid' && (
        <span className="font-medium text-danger">{pluralize(run.totalIssues, 'error')}</span>
      )}
    </>
  );
  const schemaFooter = run && hasSchema && !schemaError ? (
    <>
      <span>
        {DRAFT_LABELS[run.draft]} <span className="text-fg-muted">({sourceLabel})</span>
      </span>
      {warnings.length > 0 && <span className="text-warning">{pluralize(warnings.length, 'warning')}</span>}
    </>
  ) : undefined;

  return (
    <ToolStack>
      <ToolBar>
        <div className="min-w-0">
          <Label>Draft</Label>
          <Segmented
            label="JSON Schema draft"
            value={draft}
            onChange={setDraft}
            options={DRAFTS.map((d) => ({ value: d.value, label: d.label, title: d.title }))}
          />
        </div>
        <Switch label="Check formats" checked={formats} onChange={setFormats} className="sm:h-8" />
        <div className="min-w-0">
          <Label>Examples</Label>
          <div className="flex flex-wrap gap-1.5">
            {SCHEMA_SAMPLES.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => loadSample(s.id)}
                className="h-8 rounded-md border border-line bg-surface-sunken px-2.5 text-[12.5px] text-fg-secondary hover:border-line-strong hover:text-fg"
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>
        <Button icon={WandSparkles} onClick={onGenerate} loading={generating} disabled={!hasDoc || Boolean(docError)} className="sm:ml-auto">
          Generate schema from document
        </Button>
      </ToolBar>

      <SplitPanes>
        <EditorPanel code
          title="JSON document"
          value={doc}
          onChange={setDoc}
          language="json"
          placeholder="Paste the JSON to validate…"
          fileAccept=".json,application/json,text/plain"
          invalid={Boolean(docError)}
          height="440px"
          extensions={docExtensions}
          onReady={(v) => (docView.current = v)}
          footer={hasDoc || slow ? docFooter : undefined}
        />
        <EditorPanel code
          title="JSON Schema"
          value={schema}
          onChange={setSchema}
          language="json"
          placeholder='Paste a JSON Schema, e.g. {"type": "object", "required": ["id"]}'
          fileAccept=".json,.schema.json,application/json,application/schema+json,text/plain"
          invalid={Boolean(schemaError) || schemaErrors.length > 0}
          height="440px"
          extensions={schemaExtensions}
          onReady={(v) => (schemaView.current = v)}
          footer={schemaFooter}
        />
      </SplitPanes>

      <section aria-label="Validation result" className="flex min-w-0 flex-col gap-3">
        {!hasDoc && !hasSchema ? (
          <Panel>
            <EmptyState icon={ListChecks} title="Validate JSON against a JSON Schema">
              Paste a document and a schema, open files or load an example. Every error links to the exact spot in the document and
              the rule in the schema.
            </EmptyState>
          </Panel>
        ) : (
          <>
            {docError && (
              <Alert
                tone="danger"
                title="The document is not valid JSON"
                action={<Button size="sm" icon={Crosshair} onClick={() => onDoc(docError)}>Go to error</Button>}
              >
                {docError.message} (line {docError.line}, column {docError.column})
              </Alert>
            )}
            {schemaError && (
              <Alert
                tone="danger"
                title="The schema is not valid JSON"
                action={<Button size="sm" icon={Crosshair} onClick={() => onSchema(schemaError)}>Go to error</Button>}
              >
                {schemaError.message} (line {schemaError.line}, column {schemaError.column})
              </Alert>
            )}
            {!schemaError && schemaErrors.length > 0 && (
              <Alert tone="danger" title={`The schema has ${pluralize(schemaErrors.length, 'problem')}, so the document was not validated`}>
                <ProblemList problems={schemaErrors} onSchema={onSchema} />
              </Alert>
            )}
            {failure && hasSchema && hasDoc && (
              <Alert tone="danger" title="Validation stopped">
                {failure}
              </Alert>
            )}
            {!docError && !schemaError && schemaErrors.length === 0 && !failure && (
              <>
                {hasDoc && !hasSchema && (
                  <Alert
                    tone="info"
                    title="Add a JSON Schema to validate against"
                    action={
                      <Button size="sm" icon={WandSparkles} onClick={onGenerate} loading={generating}>
                        Generate one
                      </Button>
                    }
                  >
                    Paste or open a schema, or generate a draft 2020-12 schema from this document and refine it.
                  </Alert>
                )}
                {!hasDoc && hasSchema && run && (
                  <Alert tone="info" title="Add a JSON document to validate">
                    The schema looks fine ({DRAFT_LABELS[run.draft]}, {sourceLabel}). Paste or open the JSON you want to check.
                  </Alert>
                )}
                {canValidate && run?.outcome === 'valid' && (
                  <Alert tone="success" title="Valid: the document matches the schema">
                    {DRAFT_LABELS[run.draft]} rules ({sourceLabel}), formats {formats ? 'checked' : 'not checked'}, {formatNumber(run.ms, 1)} ms.
                  </Alert>
                )}
                {canValidate && run?.outcome === 'invalid' && (
                  <Panel
                    title={
                      <span className="inline-flex items-center gap-2">
                        <span className="text-danger">{pluralize(run.totalIssues, 'error')}</span>
                        <span className="font-normal text-fg-muted">
                          {DRAFT_LABELS[run.draft]} ({sourceLabel}), {formatNumber(run.ms, 1)} ms
                        </span>
                      </span>
                    }
                    description="Select an error to highlight it in the document."
                    bodyClassName="p-0"
                  >
                    <p role="alert" className="sr-only">
                      The document is invalid: {pluralize(run.totalIssues, 'error')}.
                    </p>
                    <ul className="max-h-[520px] divide-y divide-line overflow-y-auto py-1">
                      {run.issues.map((issue, i) => (
                        <li key={i}>
                          <IssueRow issue={issue} onDoc={onDoc} onSchema={onSchema} />
                          <IssueDetails issue={issue} onDoc={onDoc} />
                        </li>
                      ))}
                    </ul>
                    {run.totalIssues > run.issues.length && (
                      <p className="border-t border-line px-4 py-2 text-[12.5px] text-fg-muted">
                        Showing the first {formatNumber(run.issues.length)} of {formatNumber(run.totalIssues)} errors.
                      </p>
                    )}
                  </Panel>
                )}
              </>
            )}
            {(warnings.length > 0 || (run?.notes.length ?? 0) > 0) && hasSchema && !schemaError && (
              <Alert tone="warning" title={pluralize(warnings.length + (run?.notes.length ?? 0), 'note') + ' about the schema'}>
                {run?.notes.map((note) => (
                  <p key={note} className="px-2 py-1 text-[13px]">
                    {note}
                  </p>
                ))}
                <ProblemList problems={warnings} onSchema={onSchema} />
              </Alert>
            )}
          </>
        )}
        <p className={cn('flex items-center gap-1.5 text-[12.5px] text-fg-muted', !hasDoc && !hasSchema && 'hidden')}>
          <BookOpenCheck size={14} aria-hidden />
          Validation runs locally with drafts 4, 6/7, 2019-09 and 2020-12. Remote "$ref"s are never downloaded.
        </p>
      </section>

      <ConfirmDialog
        open={confirmReplace}
        onCancel={() => setConfirmReplace(false)}
        onConfirm={() => void generate()}
        title="Replace the current schema?"
        confirmLabel="Replace schema"
        danger={false}
      >
        A schema inferred from the document will replace the text in the schema editor.
      </ConfirmDialog>
    </ToolStack>
  );
}
