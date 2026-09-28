import { useMemo } from 'react';
import { CircleAlert, CircleCheck, Info, Plus, TriangleAlert, X } from 'lucide-react';
import { EditorPanel, ToolStack } from '@/components/tool/EditorPanel';
import { Button, IconButton } from '@/components/ui/Button';
import { Field, Input, Label, NumberInput, Select, Switch, Textarea } from '@/components/ui/Field';
import { Badge, KeyValueList, Panel } from '@/components/ui/Panel';
import { Segmented } from '@/components/ui/Segmented';
import { EmptyState } from '@/components/ui/Feedback';
import { useToolState } from '@/lib/hooks';
import { cn } from '@/lib/utils';
import {
  COMMIT_TYPES,
  DEFAULT_LINT_OPTIONS,
  buildCommitMessage,
  lintCommitMessage,
  type Footer,
  type LintIssue,
  type LintResult,
} from './lib/conventional';

const TOOL = 'conventional-commit';

const SAMPLE = `Feat(Auth): Added login with passkeys.
Passkeys are stored in the platform authenticator.

breaking change: the /login endpoint now requires a challenge
Reviewed by: Ada`;

export default function ConventionalCommit() {
  const [mode, setMode] = useToolState<'build' | 'lint'>(TOOL, 'mode', 'build');
  return (
    <ToolStack>
      <Segmented
        label="Mode"
        value={mode}
        onChange={setMode}
        options={[
          { value: 'build', label: 'Write a message' },
          { value: 'lint', label: 'Check a message' },
        ]}
        className="self-start"
      />
      {mode === 'build' ? <Builder /> : <Linter />}
    </ToolStack>
  );
}

function Builder() {
  const [type, setType] = useToolState(TOOL, 'type', 'feat');
  const [scope, setScope] = useToolState(TOOL, 'scope', '');
  const [breaking, setBreaking] = useToolState(TOOL, 'breaking', false);
  const [subject, setSubject] = useToolState(TOOL, 'subject', '');
  const [body, setBody] = useToolState(TOOL, 'body', '');
  const [breakingDescription, setBreakingDescription] = useToolState(TOOL, 'breakingDescription', '');
  const [closes, setCloses] = useToolState(TOOL, 'closes', '');
  const [footers, setFooters] = useToolState<Footer[]>(TOOL, 'footers', []);
  const [wrap, setWrap] = useToolState(TOOL, 'wrap', true);

  const message = useMemo(
    () =>
      subject.trim()
        ? buildCommitMessage({ type, scope, breaking, subject, body, breakingDescription, closes, footers, wrap: wrap ? 72 : 0 })
        : '',
    [type, scope, breaking, subject, body, breakingDescription, closes, footers, wrap],
  );
  const lint = useMemo(() => (message ? lintCommitMessage(message) : null), [message]);
  const header = message.split('\n')[0];
  const typeInfo = COMMIT_TYPES.find((t) => t.type === type);

  const updateFooter = (index: number, patch: Partial<Footer>) =>
    setFooters((prev) => prev.map((f, i) => (i === index ? { ...f, ...patch } : f)));

  return (
    <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-2">
      <Panel title="Commit details">
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Type" hint={typeInfo?.description}>
              {({ id, describedBy }) => (
                <Select id={id} aria-describedby={describedBy} value={type} onChange={(e) => setType(e.target.value)}>
                  {COMMIT_TYPES.map((t) => (
                    <option key={t.type} value={t.type}>
                      {t.type}: {t.title}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Scope" hint="Optional noun, e.g. api, parser">
              {({ id, describedBy }) => (
                <Input
                  id={id}
                  aria-describedby={describedBy}
                  value={scope}
                  onChange={(e) => setScope(e.target.value)}
                  placeholder="api"
                  autoComplete="off"
                />
              )}
            </Field>
          </div>
          <Field
            label="Description"
            hint={
              <span className={cn(header.length > 72 && 'text-warning')}>
                Imperative, lowercase, no period. First line: {header.length || 0}/72 characters
              </span>
            }
          >
            {({ id, describedBy }) => (
              <Input
                id={id}
                aria-describedby={describedBy}
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="add passkey login"
                autoComplete="off"
              />
            )}
          </Field>
          <Field label="Body" hint="Optional: what changed and why">
            {({ id, describedBy }) => (
              <Textarea
                id={id}
                aria-describedby={describedBy}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={4}
                mono={false}
                placeholder="Explain the motivation for the change…"
              />
            )}
          </Field>
          <div className="flex flex-wrap gap-x-6 gap-y-2">
            <Switch label="Breaking change" checked={breaking} onChange={setBreaking} />
            <Switch label="Wrap body at 72" checked={wrap} onChange={setWrap} />
          </div>
          {breaking && (
            <Field label="What breaks?" hint="Becomes a BREAKING CHANGE footer; describe the migration">
              {({ id, describedBy }) => (
                <Textarea
                  id={id}
                  aria-describedby={describedBy}
                  value={breakingDescription}
                  onChange={(e) => setBreakingDescription(e.target.value)}
                  rows={2}
                  mono={false}
                  placeholder="the config file moved to config/app.json"
                />
              )}
            </Field>
          )}
          <Field label="Closes issues" hint="Comma or space separated: 12, #15, PROJ-7">
            {({ id, describedBy }) => (
              <Input id={id} aria-describedby={describedBy} value={closes} onChange={(e) => setCloses(e.target.value)} placeholder="#12" />
            )}
          </Field>
          <div>
            <Label>Other footers</Label>
            <div className="flex flex-col gap-2">
              {footers.map((f, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Input
                    value={f.token}
                    onChange={(e) => updateFooter(i, { token: e.target.value })}
                    placeholder="Reviewed-by"
                    aria-label={`Footer ${i + 1} token`}
                    className="w-[38%]"
                  />
                  <Input
                    value={f.value}
                    onChange={(e) => updateFooter(i, { value: e.target.value })}
                    placeholder="Name <email>"
                    aria-label={`Footer ${i + 1} value`}
                    className="flex-1"
                  />
                  <IconButton icon={X} label={`Remove footer ${i + 1}`} size="sm" onClick={() => setFooters((prev) => prev.filter((_, j) => j !== i))} />
                </div>
              ))}
              <Button size="sm" icon={Plus} className="self-start" onClick={() => setFooters((prev) => [...prev, { token: '', value: '' }])}>
                Add footer
              </Button>
            </div>
          </div>
        </div>
      </Panel>
      <div className="flex min-w-0 flex-col gap-4 lg:sticky lg:top-4 lg:self-start">
        <EditorPanel
          title="Commit message"
          value={message}
          placeholder="Write a description to build the message."
          height="260px"
          footer={lint ? <LintSummary result={lint} /> : undefined}
        />
        {lint && lint.issues.length > 0 && (
          <Panel title="Suggestions">
            <IssueList issues={lint.issues} showLines={false} />
          </Panel>
        )}
      </div>
    </div>
  );
}

function Linter() {
  const [input, setInput] = useToolState(TOOL, 'lintInput', '');
  const [maxHeader, setMaxHeader] = useToolState<number | ''>(TOOL, 'maxHeader', DEFAULT_LINT_OPTIONS.maxHeaderLength);
  const [extraTypes, setExtraTypes] = useToolState(TOOL, 'extraTypes', '');

  const result = useMemo(
    () =>
      input.trim()
        ? lintCommitMessage(input, {
            ...DEFAULT_LINT_OPTIONS,
            maxHeaderLength: maxHeader === '' || maxHeader < 10 ? DEFAULT_LINT_OPTIONS.maxHeaderLength : maxHeader,
            extraTypes: extraTypes.split(/[\s,]+/).filter(Boolean),
          })
        : null,
    [input, maxHeader, extraTypes],
  );

  return (
    <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-2">
      <div className="flex min-w-0 flex-col gap-4">
        <EditorPanel
          title="Commit message"
          value={input}
          onChange={setInput}
          placeholder="Paste a commit message to check it against Conventional Commits 1.0…"
          sample={SAMPLE}
          fileAccept=".txt,text/plain,COMMIT_EDITMSG"
          height="260px"
          invalid={Boolean(result && !result.valid)}
          footer={result ? <LintSummary result={result} /> : undefined}
        />
        <div className="grid grid-cols-1 gap-4 rounded-xl border border-line bg-surface px-4 py-3 shadow-card sm:grid-cols-2">
          <Field label="Max first-line length">
            {({ id }) => <NumberInput id={id} value={maxHeader} onChange={setMaxHeader} min={10} max={200} />}
          </Field>
          <Field label="Extra allowed types" hint="e.g. wip, release">
            {({ id, describedBy }) => (
              <Input id={id} aria-describedby={describedBy} value={extraTypes} onChange={(e) => setExtraTypes(e.target.value)} placeholder="wip" />
            )}
          </Field>
        </div>
      </div>
      <div className="flex min-w-0 flex-col gap-4">
        {!result ? (
          <Panel title="Result">
            <EmptyState icon={CircleCheck} title="Nothing to check yet">
              Paste a message or load the sample. Comment lines starting with # are ignored, like git does.
            </EmptyState>
          </Panel>
        ) : (
          <>
            <Panel title="Result">
              {result.issues.length ? (
                <IssueList issues={result.issues} showLines />
              ) : (
                <p className="flex items-center gap-2 text-[13px] text-success">
                  <CircleCheck size={16} aria-hidden /> Follows Conventional Commits with no warnings.
                </p>
              )}
            </Panel>
            {result.header && (
              <Panel title="Parsed">
                <KeyValueList
                  items={[
                    { label: 'Type', value: result.header.type },
                    { label: 'Scope', value: result.header.scope ?? '(none)' },
                    { label: 'Description', value: result.header.description || '(empty)' },
                    { label: 'Breaking change', value: result.breaking ? 'Yes (major version bump)' : 'No' },
                    ...result.footers.map((f, i) => ({ key: `f${i}`, label: `Footer: ${f.token}`, value: f.value })),
                  ]}
                />
              </Panel>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function LintSummary({ result }: { result: LintResult }) {
  const errors = result.issues.filter((i) => i.severity === 'error').length;
  const warnings = result.issues.filter((i) => i.severity === 'warning').length;
  if (result.exempt) return <Badge tone="accent">Exempt: {result.exempt}</Badge>;
  return (
    <>
      {errors ? (
        <span className="font-medium text-danger">
          {errors} {errors === 1 ? 'error' : 'errors'}
        </span>
      ) : (
        <span className="font-medium text-success">Valid Conventional Commit</span>
      )}
      {warnings > 0 && (
        <span className="text-warning">
          {warnings} {warnings === 1 ? 'warning' : 'warnings'}
        </span>
      )}
      {result.breaking && <Badge tone="danger">Breaking</Badge>}
    </>
  );
}

const SEVERITY = {
  error: { icon: CircleAlert, className: 'text-danger', label: 'Error' },
  warning: { icon: TriangleAlert, className: 'text-warning', label: 'Warning' },
  info: { icon: Info, className: 'text-accent-text', label: 'Tip' },
} as const;

function IssueList({ issues, showLines }: { issues: LintIssue[]; showLines: boolean }) {
  return (
    <ul className="flex flex-col gap-2.5">
      {issues.map((issue, i) => {
        const s = SEVERITY[issue.severity];
        const Icon = s.icon;
        return (
          <li key={i} className="flex gap-2.5 text-[13px] leading-relaxed text-fg">
            <Icon size={16} aria-label={s.label} className={cn('mt-0.5 shrink-0', s.className)} />
            <span className="min-w-0">
              {showLines && <span className="mr-1.5 font-mono text-[12px] text-fg-muted">L{issue.line}</span>}
              {issue.message}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
