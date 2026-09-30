import { useId, useMemo, useState, type KeyboardEvent } from 'react';
import { CircleCheck, CircleX, Plus, Trash, X } from 'lucide-react';
import { EditorPanel, ToolBar, ToolStack } from '@/components/tool/EditorPanel';
import { Panel, Badge } from '@/components/ui/Panel';
import { Field, Input, Label, NumberInput, Select, Textarea } from '@/components/ui/Field';
import { Button, IconButton } from '@/components/ui/Button';
import { Alert } from '@/components/ui/Alert';
import { Segmented } from '@/components/ui/Segmented';
import { useToolState } from '@/lib/hooks';
import { cn } from '@/lib/utils';
import {
  AI_CRAWLERS,
  COMMON_AGENTS,
  generateRobots,
  isAllowed,
  parseRobots,
  preset,
  validateConfig,
  type PresetId,
  type RobotsConfig,
  type RobotsGroup,
  type RuleType,
} from './lib/robots';
import { t } from '@/lib/i18n';

const TOOL = 'robots-txt-generator';
const DEFAULT_SITEMAP = 'https://www.example.com/sitemap.xml';
const INITIAL: RobotsConfig = preset('standard', DEFAULT_SITEMAP);

const PRESETS: Array<{ id: PresetId; label: string }> = [
  { id: 'allow-all', label: t('Allow all') },
  { id: 'block-all', label: t('Block all') },
  { id: 'block-ai', label: t('Block AI crawlers') },
  { id: 'standard', label: t('Typical site') },
];

function AgentInput({ agents, onChange, listId }: { agents: string[]; onChange: (next: string[]) => void; listId: string }) {
  const [draft, setDraft] = useState('');
  const id = useId();
  function add() {
    const values = draft
      .split(/[,\n]/)
      .map((v) => v.trim())
      .filter(Boolean);
    if (!values.length) return;
    const lower = new Set(agents.map((a) => a.toLowerCase()));
    onChange([...agents, ...values.filter((v) => !lower.has(v.toLowerCase()))]);
    setDraft('');
  }
  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault();
      add();
    } else if (e.key === 'Backspace' && !draft && agents.length) {
      onChange(agents.slice(0, -1));
    }
  }
  return (
    <div>
      <Label htmlFor={id}>{t('User-agents')}</Label>
      {agents.length > 0 && (
        <ul className="mb-2 flex flex-wrap gap-1.5" aria-label={t('User-agents in this group')}>
          {agents.map((a, i) => (
            <li key={a + i} className="inline-flex items-center gap-0.5 rounded-md border border-line bg-surface-sunken py-0.5 pr-0.5 pl-2 font-mono text-[12.5px] text-fg">
              {a}
              <button
                type="button"
                aria-label={t('Remove {a}', { a })}
                onClick={() => onChange(agents.filter((_, j) => j !== i))}
                className="rounded p-0.5 text-fg-muted hover:bg-surface-hover hover:text-fg"
              >
                <X size={13} aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex gap-2">
        <Input
          id={id}
          mono
          list={listId}
          value={draft}
          placeholder={agents.length ? t('Add another crawler…') : t('* for all crawlers, or e.g. Googlebot')}
          autoComplete="off"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
        />
        <Button variant="secondary" icon={Plus} onClick={add} disabled={!draft.trim()}>
          {t('Add')}
        </Button>
      </div>
    </div>
  );
}

function GroupEditor({
  group,
  index,
  onChange,
  onRemove,
  listId,
}: {
  group: RobotsGroup;
  index: number;
  onChange: (g: RobotsGroup) => void;
  onRemove?: () => void;
  listId: string;
}) {
  const setRule = (i: number, patch: Partial<{ type: RuleType; path: string }>) =>
    onChange({ ...group, rules: group.rules.map((r, j) => (j === i ? { ...r, ...patch } : r)) });
  return (
    <Panel
      title={t('Group {index}', { index: index + 1 })}
      description={group.comment}
      actions={onRemove && <IconButton icon={Trash} label={t('Remove group {index}', { index: index + 1 })} size="sm" onClick={onRemove} />}
      bodyClassName="flex flex-col gap-4"
    >
      <AgentInput agents={group.userAgents} onChange={(userAgents) => onChange({ ...group, userAgents })} listId={listId} />
      <div>
        <Label>{t('Rules')}</Label>
        {group.rules.length === 0 && <p className="mb-2 text-[13px] text-fg-muted">{t('No rules: these crawlers may fetch everything.')}</p>}
        <div className="flex flex-col gap-2">
          {group.rules.map((r, i) => (
            <div key={i} className="grid grid-cols-[112px_minmax(0,1fr)_auto] items-center gap-2">
              <Select aria-label={t('Rule {i} type', { i: i + 1 })} value={r.type} onChange={(e) => setRule(i, { type: e.target.value as RuleType })}>
                <option value="disallow">{t('Disallow')}</option>
                <option value="allow">{t('Allow')}</option>
              </Select>
              <Input mono aria-label={t('Rule {i} path', { i: i + 1 })} value={r.path} placeholder="/private/" spellCheck={false} onChange={(e) => setRule(i, { path: e.target.value })} />
              <IconButton icon={X} label={t('Remove rule {i}', { i: i + 1 })} size="sm" onClick={() => onChange({ ...group, rules: group.rules.filter((_, j) => j !== i) })} />
            </div>
          ))}
        </div>
        <Button
          size="sm"
          variant="ghost"
          icon={Plus}
          className="mt-2"
          onClick={() => onChange({ ...group, rules: [...group.rules, { type: 'disallow', path: '' }] })}
        >
          {t('Add rule')}
        </Button>
        <p className="mt-1 text-[12px] text-fg-muted">
          {t('Use * to match any characters and $ to anchor the end, e.g. /*.pdf$. The longest matching rule wins.')}
        </p>
      </div>
      <Field label={t('Crawl-delay (seconds)')} hint={t('Optional and non-standard: Bing and Yandex honor it, Google ignores it.')}>
        {({ id, describedBy }) => (
          <NumberInput
            id={id}
            aria-describedby={describedBy}
            className="max-w-[160px]"
            min={0}
            step={1}
            value={group.crawlDelay ?? ''}
            placeholder={t('None')}
            onChange={(v) => onChange({ ...group, crawlDelay: v === '' ? null : Math.max(0, v) })}
          />
        )}
      </Field>
    </Panel>
  );
}

function Tester({ generated }: { generated: string }) {
  const [source, setSource] = useToolState<'generated' | 'custom'>(TOOL, 'testSource', 'generated');
  const [custom, setCustom] = useToolState(TOOL, 'testCustom', '');
  const [agent, setAgent] = useToolState(TOOL, 'testAgent', 'Googlebot');
  const [target, setTarget] = useToolState(TOOL, 'testUrl', '/admin/settings');
  const text = source === 'generated' ? generated : custom;
  const parsed = useMemo(() => parseRobots(text), [text]);
  const result = useMemo(() => (agent.trim() ? isAllowed(parsed, agent, target) : null), [parsed, agent, target]);

  return (
    <Panel title={t('Test a URL')} description={t('Checks a URL the way Google and RFC 9309 do: most specific group, then longest matching rule.')}>
      <div className="flex flex-col gap-3">
        <Segmented
          label={t('robots.txt to test')}
          size="sm"
          value={source}
          onChange={setSource}
          options={[
            { value: 'generated', label: t('Generated file') },
            { value: 'custom', label: t('Paste your own') },
          ]}
        />
        {source === 'custom' && (
          <div>
            <Label htmlFor="rt-custom">{t('robots.txt')}</Label>
            <Textarea id="rt-custom" rows={8} value={custom} placeholder={t('User-agent: *\nDisallow: /private/')} onChange={(e) => setCustom(e.target.value)} />
          </div>
        )}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
          <Field label={t('User-agent')}>
            {({ id }) => <Input id={id} mono list="rt-agents" value={agent} placeholder={t('Googlebot')} autoComplete="off" onChange={(e) => setAgent(e.target.value)} />}
          </Field>
          <Field label={t('URL or path')}>
            {({ id }) => <Input id={id} mono value={target} placeholder={t('/path?query or https://…')} spellCheck={false} onChange={(e) => setTarget(e.target.value)} />}
          </Field>
        </div>
        {parsed.unknown.length > 0 && (
          <Alert tone="warning" title={(parsed.unknown.length === 1) ? t('{count} line was not understood and will be ignored by crawlers', { count: parsed.unknown.length }) : t('{count} lines were not understood and will be ignored by crawlers', { count: parsed.unknown.length })}>
            <ul className="font-mono text-[12px]">
              {parsed.unknown.slice(0, 5).map((u) => (
                <li key={u.line} className="break-all">
                  {t('Line {line}: {text}', { line: u.line, text: u.text })}
                </li>
              ))}
            </ul>
          </Alert>
        )}
        {!agent.trim() ? (
          <p className="text-[13px] text-fg-muted">{t('Enter a crawler name to test.')}</p>
        ) : (
          result && (
            <div
              role="status"
              className={cn('flex gap-3 rounded-lg px-3 py-3', result.allowed ? 'bg-success-soft' : 'bg-danger-soft')}
            >
              {result.allowed ? <CircleCheck size={20} className="mt-0.5 shrink-0 text-success" aria-hidden /> : <CircleX size={20} className="mt-0.5 shrink-0 text-danger" aria-hidden />}
              <div className="min-w-0 text-[13px]">
                <p className={cn('text-[14px] font-semibold', result.allowed ? 'text-success' : 'text-danger')}>{result.allowed ? t('Allowed') : t('Blocked')}</p>
                <p className="mt-0.5 text-fg">{result.reason}</p>
                <p className="mt-1 break-all text-fg-secondary">
                  {t('Path checked:')}{' '}<code className="font-mono">{result.target}</code>
                  {result.groupAgents.length > 0 && (
                    <>
                      {' '}{t('· Group:')}{' '}<code className="font-mono">{result.groupAgents.slice(0, 4).join(', ')}{result.groupAgents.length > 4 ? ` +${result.groupAgents.length - 4}` : ''}</code>
                    </>
                  )}
                </p>
              </div>
            </div>
          )
        )}
      </div>
    </Panel>
  );
}

export default function RobotsTxtGenerator() {
  const [config, setConfig] = useToolState<RobotsConfig>(TOOL, 'config', INITIAL);
  const output = useMemo(() => generateRobots(config), [config]);
  const issues = useMemo(() => validateConfig(config), [config]);
  const listId = 'rt-agents';

  const setGroup = (i: number, g: RobotsGroup) => setConfig((c) => ({ ...c, groups: c.groups.map((x, j) => (j === i ? g : x)) }));
  const applyPreset = (id: PresetId) => setConfig((c) => preset(id, c.sitemaps.find((s) => s.trim()) ?? ''));

  return (
    <ToolStack>
      <datalist id={listId}>
        {['*', ...COMMON_AGENTS].map((a) => (
          <option key={a} value={a} />
        ))}
      </datalist>
      <ToolBar>
        <div className="min-w-0">
          <Label>{t('Start from a preset')}</Label>
          <div className="flex flex-wrap gap-2">
            {PRESETS.map((p) => (
              <Button key={p.id} size="sm" variant="secondary" onClick={() => applyPreset(p.id)}>
                {p.label}
              </Button>
            ))}
          </div>
        </div>
      </ToolBar>

      <div className="grid min-w-0 grid-cols-1 items-start gap-4 lg:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-4">
          {config.groups.map((g, i) => (
            <GroupEditor
              key={i}
              group={g}
              index={i}
              listId={listId}
              onChange={(next) => setGroup(i, next)}
              onRemove={config.groups.length > 1 ? () => setConfig((c) => ({ ...c, groups: c.groups.filter((_, j) => j !== i) })) : undefined}
            />
          ))}
          <div>
            <Button
              variant="secondary"
              icon={Plus}
              onClick={() => setConfig((c) => ({ ...c, groups: [...c.groups, { userAgents: [], rules: [{ type: 'disallow', path: '/' }], crawlDelay: null }] }))}
            >
              {t('Add user-agent group')}
            </Button>
          </div>
          <Panel title={t('Sitemaps')} bodyClassName="flex flex-col gap-2">
            {config.sitemaps.map((s, i) => (
              <div key={i} className="flex items-center gap-2">
                <Input
                  mono
                  aria-label={t('Sitemap {i}', { i: i + 1 })}
                  value={s}
                  placeholder="https://example.com/sitemap.xml"
                  spellCheck={false}
                  onChange={(e) => setConfig((c) => ({ ...c, sitemaps: c.sitemaps.map((x, j) => (j === i ? e.target.value : x)) }))}
                />
                <IconButton icon={X} label={t('Remove sitemap {i}', { i: i + 1 })} size="sm" onClick={() => setConfig((c) => ({ ...c, sitemaps: c.sitemaps.filter((_, j) => j !== i) }))} />
              </div>
            ))}
            <div>
              <Button size="sm" variant="ghost" icon={Plus} onClick={() => setConfig((c) => ({ ...c, sitemaps: [...c.sitemaps, ''] }))}>
                {t('Add sitemap')}
              </Button>
            </div>
          </Panel>
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          {issues.length > 0 && (
            <Alert tone={issues.some((i) => i.level === 'error') ? 'danger' : 'warning'} title={t('Check these')}>
              <ul className="list-disc pl-4">
                {issues.map((i, n) => (
                  <li key={n}>{i.message}</li>
                ))}
              </ul>
            </Alert>
          )}
          <EditorPanel
            title="robots.txt"
            value={output}
            downloadName="robots.txt"
            downloadType="text/plain;charset=utf-8"
            placeholder={t('Add a user-agent group to generate the file')}
            height="340px"
            footer={<span>{t('Upload it to the root of your site, e.g. https://example.com/robots.txt')}</span>}
          />
          <Tester generated={output} />
          <Panel title={t('AI crawler tokens')} description={t('Used by the “Block AI crawlers” preset. Blocking them does not affect regular search engines.')}>
            <div className="max-h-[280px] overflow-auto" tabIndex={0} role="region" aria-label={t('AI crawler tokens')}>
              <table className="w-full min-w-[380px] text-left text-[13px]">
                <thead className="sticky top-0 bg-surface text-[12px] text-fg-muted">
                  <tr className="border-b border-line">
                    <th className="py-1.5 pr-3 font-medium">{t('Token')}</th>
                    <th className="py-1.5 pr-3 font-medium">{t('Operator')}</th>
                    <th className="py-1.5 font-medium">{t('Purpose')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {AI_CRAWLERS.map((c) => (
                    <tr key={c.token} className="align-top">
                      <td className="py-1.5 pr-3 font-mono text-[12.5px] whitespace-nowrap text-fg">{c.token}</td>
                      <td className="py-1.5 pr-3 text-fg-secondary">{c.owner}</td>
                      <td className="py-1.5 text-fg-secondary">
                        {t(c.purpose)}
                        {/-User$/.test(c.token) && (
                          <Badge className="ml-1.5" tone="neutral">
                            {t('user-triggered')}
                          </Badge>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        </div>
      </div>
    </ToolStack>
  );
}
