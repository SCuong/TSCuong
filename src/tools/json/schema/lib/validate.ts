import { validate, type SchemaDraft } from '@cfworker/json-schema';
import { parseJson } from '../../lib/json';
import { resolveDraft, type DraftChoice, type DraftResolution } from './drafts';
import { explainErrors, indexSchema, type Issue } from './explain';
import { lintSchema, type SchemaProblem } from './lint';
import { locatePointers, positionFinder, type NodeLocation, type TextPosition } from './locate';
import { stripFormats } from './walk';

export interface ValidationJob {
  doc: string;
  schema: string;
  draft: DraftChoice;
  /** Check `format` keywords (email, date-time, …). */
  formats: boolean;
}

export interface TextError {
  message: string;
  line: number;
  column: number;
}

export type LocatedProblem = SchemaProblem & { at: TextPosition | null };

export interface LocatedIssue extends Omit<Issue, 'details'> {
  /** Where to highlight in the document (null when it could not be found). */
  at: TextPosition | null;
  /** Where the failing keyword sits in the schema. */
  schemaAt: TextPosition | null;
  details?: Array<{ label: string; issues: LocatedIssue[] }>;
}

export interface ValidationRun {
  docError: TextError | null;
  schemaError: TextError | null;
  /** Schema errors (which block validation) and warnings, with positions in the schema text. */
  problems: LocatedProblem[];
  draft: SchemaDraft;
  draftSource: DraftResolution['source'];
  notes: string[];
  /** skipped: nothing to validate yet (missing or broken input); failed: the engine stopped. */
  outcome: 'valid' | 'invalid' | 'skipped' | 'failed';
  failure?: string;
  issues: LocatedIssue[];
  /** Number of issues before truncation. */
  totalIssues: number;
  ms: number;
}

export const MAX_ISSUES = 1000;

function engineFailure(error: unknown): string {
  if (error instanceof RangeError) {
    return 'Validation ran out of stack space: the document or schema is nested too deeply, or a "$ref" loops back to itself without ever reaching a keyword.';
  }
  if (error instanceof URIError) {
    return 'A property name contains an unpaired Unicode surrogate, which the validator cannot process.';
  }
  const message = error instanceof Error ? error.message.split('\n')[0] : String(error);
  return `The validator could not apply this schema: ${message}`;
}

/** Positions for a node: the key for key targets and containers, otherwise the value. */
function nodePosition(loc: NodeLocation | undefined, target: 'value' | 'key', text: string, find: ReturnType<typeof positionFinder>) {
  if (!loc) return null;
  const first = text.charCodeAt(loc.value.from);
  const container = first === 123 || first === 91;
  if (loc.key && (target === 'key' || container)) return find(loc.key);
  return find(container ? { from: loc.value.from, to: loc.value.from + 1 } : loc.value);
}

function collectPointers(issues: Issue[], docPointers: Set<string>, schemaPointers: Set<string>) {
  for (const issue of issues) {
    docPointers.add(issue.instancePath);
    if (issue.schemaPointer !== null) schemaPointers.add(issue.schemaPointer);
    for (const d of issue.details ?? []) collectPointers(d.issues, docPointers, schemaPointers);
  }
}

export function runValidation(job: ValidationJob): ValidationRun {
  const started = performance.now();
  const run: ValidationRun = {
    docError: null,
    schemaError: null,
    problems: [],
    draft: job.draft === 'auto' ? '2020-12' : job.draft,
    draftSource: job.draft === 'auto' ? 'default' : 'selected',
    notes: [],
    outcome: 'skipped',
    issues: [],
    totalIssues: 0,
    ms: 0,
  };
  const finish = () => {
    run.ms = performance.now() - started;
    return run;
  };

  const doc = job.doc.trim() ? parseJson(job.doc) : null;
  const schemaParsed = job.schema.trim() ? parseJson(job.schema) : null;
  if (doc && !doc.ok) run.docError = doc.error;
  if (schemaParsed && !schemaParsed.ok) run.schemaError = schemaParsed.error;
  if (!schemaParsed?.ok) return finish();

  const schema = schemaParsed.value;
  const resolution = resolveDraft(schema, job.draft);
  run.draft = resolution.draft;
  run.draftSource = resolution.source;
  run.notes = resolution.notes;

  if (!job.formats) stripFormats(schema);
  const lint = lintSchema(schema, resolution.draft, job.formats);
  if (lint.problems.length) {
    const found = locatePointers(job.schema, lint.problems.map((p) => p.pointer));
    const find = positionFinder(job.schema);
    run.problems = lint.problems.map((p) => ({ ...p, at: nodePosition(found.get(p.pointer), p.target, job.schema, find) }));
  }
  if (!lint.lookup || !doc?.ok) return finish();

  let result;
  try {
    result = validate(doc.value, schema as Parameters<typeof validate>[1], resolution.draft, lint.lookup, false);
  } catch (error) {
    run.outcome = 'failed';
    run.failure = engineFailure(error);
    return finish();
  }
  if (result.valid) {
    run.outcome = 'valid';
    return finish();
  }

  run.outcome = 'invalid';
  const explained = explainErrors(result.errors, doc.value, indexSchema(schema, lint.lookup), resolution.draft);
  run.totalIssues = explained.length;
  const shown = explained.slice(0, MAX_ISSUES);
  const docPointers = new Set<string>();
  const schemaPointers = new Set<string>();
  collectPointers(shown, docPointers, schemaPointers);
  const docFound = locatePointers(job.doc, docPointers);
  const docFind = positionFinder(job.doc);
  const schemaFound = locatePointers(job.schema, schemaPointers);
  const schemaFind = positionFinder(job.schema);

  const locate = (issue: Issue): LocatedIssue => ({
    instancePath: issue.instancePath,
    keyword: issue.keyword,
    message: issue.message,
    schemaPointer: issue.schemaPointer,
    target: issue.target,
    at: nodePosition(docFound.get(issue.instancePath), issue.target, job.doc, docFind),
    schemaAt: issue.schemaPointer === null ? null : nodePosition(schemaFound.get(issue.schemaPointer), 'key', job.schema, schemaFind),
    details: issue.details?.map((d) => ({ label: d.label, issues: d.issues.map(locate) })),
  });
  run.issues = shown
    .map(locate)
    .map((issue, order) => ({ issue, order }))
    .sort((a, b) => (a.issue.at?.line ?? 0) - (b.issue.at?.line ?? 0) || (a.issue.at?.column ?? 0) - (b.issue.at?.column ?? 0) || a.order - b.order)
    .map((x) => x.issue);
  return finish();
}
