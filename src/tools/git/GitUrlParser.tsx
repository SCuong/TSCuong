import { useMemo, useState } from 'react';
import { ExternalLink, Info } from 'lucide-react';
import { Field, Input, NumberInput } from '@/components/ui/Field';
import { ErrorMessage } from '@/components/ui/Alert';
import { Badge, KeyValueList, Panel } from '@/components/ui/Panel';
import { EmptyState } from '@/components/ui/Feedback';
import { useToolState } from '@/lib/hooks';
import { PROVIDER_NAMES, cloneUrls, fileLinks, parseGitUrl, supportsFileLinks, type GitUrlInfo, type LinkKind, type UrlForm } from './lib/gitUrl';
import { CopyRow, ToggleChip } from './shared';

const TOOL = 'git-url-parser';

const EXAMPLES: Array<{ label: string; url: string }> = [
  { label: 'GitHub SSH', url: 'git@github.com:vitejs/vite.git' },
  { label: 'GitHub file', url: 'https://github.com/vitejs/vite/blob/main/packages/vite/src/node/server/index.ts#L120-L140' },
  { label: 'GitLab subgroup', url: 'https://gitlab.com/gitlab-org/api/client-go/-/blob/main/README.md#L5-12' },
  { label: 'Bitbucket', url: 'https://bitbucket.org/atlassian/python-bitbucket/src/master/setup.py#lines-3:9' },
  { label: 'Azure DevOps', url: 'git@ssh.dev.azure.com:v3/contoso/Fabrikam/Web' },
  { label: 'Custom port', url: 'ssh://git@git.example.com:2222/team/app.git' },
];

const FORM_LABELS: Record<UrlForm, string> = {
  scp: 'SSH (scp-like)',
  ssh: 'SSH URL',
  https: 'HTTPS',
  http: 'HTTP (insecure)',
  git: 'git:// protocol',
  file: 'Local file',
  shorthand: 'owner/repo shorthand',
};

const KIND_LABELS: Record<LinkKind, string> = {
  repo: 'Repository',
  blob: 'File',
  tree: 'Branch / folder',
  raw: 'Raw file',
  blame: 'Blame',
  commit: 'Commit',
  history: 'Commit history',
  pull: 'Pull / merge request',
  issue: 'Issue',
  compare: 'Comparison',
  release: 'Release / tag',
  other: 'Other page',
};

export default function GitUrlParser() {
  const [input, setInput] = useToolState(TOOL, 'input', '');
  const parsed = useMemo(() => (input.trim() ? parseGitUrl(input) : null), [input]);
  const info = parsed?.ok ? parsed.info : null;

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <Panel>
        <Field label="Git URL or link" hint="SSH, HTTPS, git://, file://, or a GitHub / GitLab / Bitbucket / Azure DevOps web link. Nothing is fetched.">
          {({ id, describedBy }) => (
            <Input
              id={id}
              aria-describedby={describedBy}
              aria-invalid={parsed?.ok === false || undefined}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="git@github.com:owner/repo.git"
              mono
              autoComplete="off"
              spellCheck={false}
            />
          )}
        </Field>
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-[12.5px] text-fg-muted">Examples:</span>
          {EXAMPLES.map((ex) => (
            <ToggleChip key={ex.label} pressed={input === ex.url} onToggle={() => setInput(ex.url)} className="h-7 px-2 text-[12.5px]">
              {ex.label}
            </ToggleChip>
          ))}
        </div>
      </Panel>

      {parsed && !parsed.ok && <ErrorMessage error={parsed.error} title="Could not parse this URL" />}
      {!parsed && (
        <EmptyState icon={Info} title="Paste a Git URL" className="rounded-xl border border-line bg-surface">
          See its parts, convert between SSH and HTTPS, and build file, raw, blame and permalink URLs.
        </EmptyState>
      )}
      {info && <Result key={input} info={info} />}
    </div>
  );
}

function Result({ info }: { info: GitUrlInfo }) {
  const urls = cloneUrls(info);
  const lines =
    info.lineStart !== null ? (info.lineEnd !== null ? `${info.lineStart}–${info.lineEnd}` : String(info.lineStart)) : null;
  const details = [
    { label: 'Host', value: `${info.host}${info.port ? `:${info.port}` : ''}` },
    { label: 'Provider', value: PROVIDER_NAMES[info.provider] },
    { label: 'Format', value: FORM_LABELS[info.form] },
    info.user ? { label: 'User', value: info.user } : null,
    info.azure
      ? { label: 'Organization / project', value: `${info.azure.org} / ${info.azure.project}` }
      : { label: info.provider === 'gitlab' ? 'Group / namespace' : 'Owner', value: info.owner || '(none)' },
    { label: 'Repository', value: info.repo },
    info.kind !== 'repo' ? { label: 'Link type', value: KIND_LABELS[info.kind] } : null,
    info.ref ? { label: 'Branch / ref', value: info.ref } : null,
    info.path ? { label: 'Path', value: info.path } : null,
    lines ? { label: 'Lines', value: lines } : null,
    info.commit ? { label: 'Commit', value: info.commit } : null,
    info.number !== null ? { label: info.kind === 'issue' ? 'Issue' : 'Number', value: `#${info.number}` } : null,
  ].filter((x): x is { label: string; value: string } => x !== null);

  return (
    <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-2">
      <div className="flex min-w-0 flex-col gap-4">
        <Panel title="Parts" actions={<Badge tone="accent">{PROVIDER_NAMES[info.provider]}</Badge>}>
          <KeyValueList items={details.map((d) => ({ ...d, key: d.label }))} />
        </Panel>
        {info.notes.length > 0 && (
          <div className="flex flex-col gap-2">
            {info.notes.map((n) => (
              <p key={n} className="flex gap-2 rounded-lg border border-accent-line bg-accent-soft px-3 py-2 text-[12.5px] leading-relaxed text-fg">
                <Info size={15} aria-hidden className="mt-0.5 shrink-0 text-accent-text" />
                {n}
              </p>
            ))}
          </div>
        )}
      </div>
      <div className="flex min-w-0 flex-col gap-4">
        <Panel title="Clone URLs" bodyClassName="py-1">
          <div className="divide-y divide-line">
            {info.form === 'file' ? (
              <CopyRow label="File URL" value={urls.https} />
            ) : (
              <>
                <CopyRow label="HTTPS" value={urls.https} />
                <CopyRow label="SSH" value={urls.ssh} />
                <CopyRow label="Clone (SSH)" value={`git clone ${urls.ssh}`} />
                <CopyRow label="Web page" value={urls.web} extra={<OpenLink href={urls.web} />} />
              </>
            )}
          </div>
          {info.provider === 'generic' && info.form !== 'file' && (
            <p className="pb-2 text-[12px] text-fg-muted">Unknown host: the SSH form assumes the “git” user and the default port.</p>
          )}
        </Panel>
        {supportsFileLinks(info) && <LinkBuilder info={info} />}
      </div>
    </div>
  );
}

function LinkBuilder({ info }: { info: GitUrlInfo }) {
  const [ref, setRef] = useState(info.ref && info.kind !== 'compare' ? info.ref : 'main');
  const [path, setPath] = useState(info.path ?? '');
  const [lineStart, setLineStart] = useState<number | ''>(info.lineStart ?? '');
  const [lineEnd, setLineEnd] = useState<number | ''>(info.lineEnd ?? '');
  const [commit, setCommit] = useState(info.commit ?? '');

  const links = fileLinks(info, {
    ref,
    path,
    lineStart: lineStart === '' || lineStart < 1 ? null : lineStart,
    lineEnd: lineEnd === '' || lineEnd < 1 ? null : lineEnd,
    commit,
  });
  const commitInvalid = commit.trim() !== '' && !/^[0-9a-f]{7,64}$/i.test(commit.trim());

  return (
    <Panel title="File links" description="Edit the parts to build other links">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Branch or tag">
          {({ id }) => <Input id={id} value={ref} onChange={(e) => setRef(e.target.value)} mono placeholder="main" spellCheck={false} />}
        </Field>
        <Field label="Commit SHA" hint="Used for the permalink" error={commitInvalid ? 'A commit SHA is 7–64 hexadecimal characters.' : null}>
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              aria-describedby={describedBy}
              aria-invalid={invalid || undefined}
              value={commit}
              onChange={(e) => setCommit(e.target.value)}
              mono
              placeholder="e.g. 3f1c2ab"
              spellCheck={false}
            />
          )}
        </Field>
        <Field label="File path" className="sm:col-span-2">
          {({ id }) => <Input id={id} value={path} onChange={(e) => setPath(e.target.value)} mono placeholder="src/index.ts" spellCheck={false} />}
        </Field>
        <Field label="First line">
          {({ id }) => <NumberInput id={id} value={lineStart} onChange={setLineStart} min={1} placeholder="—" />}
        </Field>
        <Field label="Last line">
          {({ id }) => <NumberInput id={id} value={lineEnd} onChange={setLineEnd} min={1} placeholder="—" />}
        </Field>
      </div>
      {links.length > 0 && !commitInvalid ? (
        <div className="mt-3 divide-y divide-line border-t border-line">
          {links.map((l) => (
            <CopyRow key={l.id} label={l.label} value={l.url} extra={<OpenLink href={l.url} />} />
          ))}
        </div>
      ) : (
        <p className="mt-3 text-[12.5px] text-fg-muted">
          {commitInvalid ? 'Fix the commit SHA to see links.' : 'Enter a branch (and optionally a file path or commit) to build links.'}
        </p>
      )}
    </Panel>
  );
}

function OpenLink({ href }: { href: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Open in a new tab"
      title="Open in a new tab"
      className="inline-flex size-7 items-center justify-center rounded-lg text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg"
    >
      <ExternalLink size={15} aria-hidden />
    </a>
  );
}
