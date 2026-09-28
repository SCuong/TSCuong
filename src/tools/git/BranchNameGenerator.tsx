import { useMemo } from 'react';
import { CircleAlert, CircleCheck } from 'lucide-react';
import { ToolBar, ToolStack } from '@/components/tool/EditorPanel';
import { CopyButton } from '@/components/ui/Actions';
import { Field, Input, Label, NumberInput, Select, Switch } from '@/components/ui/Field';
import { Panel } from '@/components/ui/Panel';
import { Segmented } from '@/components/ui/Segmented';
import { useToolState } from '@/lib/hooks';
import { cn } from '@/lib/utils';
import { generateBranchName, normalizeTicket, slugWords, validateBranchName, type BranchOptions } from './lib/branchName';
import { CopyRow } from './shared';

const TOOL = 'git-branch-name';
const PREFIXES = ['feature', 'fix', 'bugfix', 'hotfix', 'chore', 'docs', 'refactor', 'test', 'perf', 'ci', 'release', 'experiment'];

export default function BranchNameGenerator() {
  const [title, setTitle] = useToolState(TOOL, 'title', '');
  const [ticket, setTicket] = useToolState(TOOL, 'ticket', '');
  const [prefixChoice, setPrefixChoice] = useToolState(TOOL, 'prefix', 'feature');
  const [customPrefix, setCustomPrefix] = useToolState(TOOL, 'customPrefix', '');
  const [prefixSeparator, setPrefixSeparator] = useToolState<BranchOptions['prefixSeparator']>(TOOL, 'prefixSep', '/');
  const [wordSeparator, setWordSeparator] = useToolState<BranchOptions['wordSeparator']>(TOOL, 'wordSep', '-');
  const [lowercase, setLowercase] = useToolState(TOOL, 'lowercase', true);
  const [keepTicketCase, setKeepTicketCase] = useToolState(TOOL, 'keepTicketCase', true);
  const [dropStopWords, setDropStopWords] = useToolState(TOOL, 'dropStopWords', false);
  const [maxLength, setMaxLength] = useToolState<number | ''>(TOOL, 'maxLength', 60);
  const [check, setCheck] = useToolState(TOOL, 'check', '');

  const prefix = prefixChoice === 'custom' ? customPrefix : prefixChoice === 'none' ? '' : prefixChoice;
  const usable = slugWords(title).length > 0 || normalizeTicket(ticket) !== '';
  const name = useMemo(
    () =>
      usable
        ? generateBranchName({
            title,
            ticket,
            prefix,
            prefixSeparator,
            wordSeparator,
            lowercase,
            keepTicketCase,
            dropStopWords,
            maxLength: maxLength === '' ? 0 : Math.max(0, maxLength),
          })
        : '',
    [usable, title, ticket, prefix, prefixSeparator, wordSeparator, lowercase, keepTicketCase, dropStopWords, maxLength],
  );
  const nameIssues = name ? validateBranchName(name) : [];
  const checkIssues = check ? validateBranchName(check) : [];
  const nothingUsable = Boolean(title.trim() || ticket.trim()) && !usable;

  return (
    <ToolStack>
      <Panel title="Issue">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-[minmax(0,1fr)_200px]">
          <Field label="Title or summary">
            {({ id }) => (
              <Input
                id={id}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Sửa lỗi đăng nhập khi dùng Safari"
                autoComplete="off"
              />
            )}
          </Field>
          <Field label="Ticket / issue id" hint="Optional, e.g. PROJ-142 or #87">
            {({ id, describedBy }) => (
              <Input
                id={id}
                aria-describedby={describedBy}
                value={ticket}
                onChange={(e) => setTicket(e.target.value)}
                placeholder="PROJ-142"
                mono
                autoComplete="off"
              />
            )}
          </Field>
        </div>
      </Panel>

      <ToolBar>
        <Field label="Prefix" className="w-40">
          {({ id }) => (
            <Select id={id} value={prefixChoice} onChange={(e) => setPrefixChoice(e.target.value)}>
              {PREFIXES.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
              <option value="none">(none)</option>
              <option value="custom">Custom…</option>
            </Select>
          )}
        </Field>
        {prefixChoice === 'custom' && (
          <Field label="Custom prefix" className="w-40">
            {({ id }) => <Input id={id} value={customPrefix} onChange={(e) => setCustomPrefix(e.target.value)} placeholder="team-a" mono />}
          </Field>
        )}
        <div>
          <Label>After prefix</Label>
          <Segmented
            label="Separator after prefix"
            value={prefixSeparator}
            onChange={setPrefixSeparator}
            options={[
              { value: '/', label: '/' },
              { value: '-', label: '-' },
              { value: '_', label: '_' },
            ]}
          />
        </div>
        <div>
          <Label>Between words</Label>
          <Segmented
            label="Separator between words"
            value={wordSeparator}
            onChange={setWordSeparator}
            options={[
              { value: '-', label: 'kebab-case' },
              { value: '_', label: 'snake_case' },
              { value: '.', label: 'dot.case' },
            ]}
          />
        </div>
        <Field label="Max length" className="w-28">
          {({ id }) => <NumberInput id={id} value={maxLength} onChange={setMaxLength} min={0} max={255} placeholder="none" />}
        </Field>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 pb-1">
          <Switch label="Lowercase" checked={lowercase} onChange={setLowercase} />
          <Switch label="Keep ticket case" checked={keepTicketCase} onChange={setKeepTicketCase} disabled={!lowercase} />
          <Switch label="Drop filler words" checked={dropStopWords} onChange={setDropStopWords} />
        </div>
      </ToolBar>

      <Panel title="Branch name">
        {name ? (
          <div className="flex flex-col gap-3">
            <div className="flex items-start gap-2 rounded-lg border border-line bg-surface-sunken p-3">
              <code className="min-w-0 flex-1 font-mono text-[15px] font-medium break-all text-fg">{name}</code>
              <CopyButton value={name} />
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12.5px] text-fg-muted">
              <span>{name.length} characters</span>
              <ValidityLine issues={nameIssues} />
            </div>
            <div className="divide-y divide-line">
              <CopyRow label="Create & switch" value={`git switch -c ${name}`} />
              <CopyRow label="Older Git" value={`git checkout -b ${name}`} />
              <CopyRow label="First push" value={`git push -u origin ${name}`} />
            </div>
          </div>
        ) : (
          <p className="text-[13px] text-fg-muted">
            {nothingUsable
              ? 'The title has no letters or digits that can be used in a branch name.'
              : 'Type an issue title or ticket id to generate a branch name.'}
          </p>
        )}
      </Panel>

      <Panel title="Check a branch name" description="Validates against the rules of git check-ref-format">
        <Field label="Branch name">
          {({ id }) => (
            <Input
              id={id}
              value={check}
              onChange={(e) => setCheck(e.target.value)}
              placeholder="feature/my..branch"
              mono
              aria-invalid={checkIssues.length > 0 || undefined}
              autoComplete="off"
              spellCheck={false}
            />
          )}
        </Field>
        {check && (
          <div className="mt-3">
            <ValidityLine issues={checkIssues} />
            {checkIssues.length > 0 && (
              <ul className="mt-2 flex flex-col gap-1.5 text-[13px] text-fg">
                {checkIssues.map((issue) => (
                  <li key={issue.message} className="flex gap-2">
                    <CircleAlert size={15} aria-hidden className="mt-0.5 shrink-0 text-danger" />
                    {issue.message}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </Panel>
    </ToolStack>
  );
}

function ValidityLine({ issues }: { issues: { message: string }[] }) {
  const ok = issues.length === 0;
  const Icon = ok ? CircleCheck : CircleAlert;
  return (
    <span role="status" className={cn('inline-flex items-center gap-1.5 text-[13px] font-medium', ok ? 'text-success' : 'text-danger')}>
      <Icon size={15} aria-hidden />
      {ok ? 'Valid git branch name' : `Not a valid branch name (${issues.length} ${issues.length === 1 ? 'problem' : 'problems'})`}
    </span>
  );
}
