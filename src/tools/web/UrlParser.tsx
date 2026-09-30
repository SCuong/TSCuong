import { useMemo, useState, type ReactNode } from 'react';
import { Eye, EyeOff, FlaskConical, Link, Plus, X } from 'lucide-react';
import { ToolStack } from '@/components/tool/EditorPanel';
import { Panel, Badge, KeyValueList } from '@/components/ui/Panel';
import { Field, Input, Label, Switch } from '@/components/ui/Field';
import { Button, IconButton } from '@/components/ui/Button';
import { CopyButton } from '@/components/ui/Actions';
import { ErrorMessage } from '@/components/ui/Alert';
import { EmptyState } from '@/components/ui/Feedback';
import { Segmented } from '@/components/ui/Segmented';
import { useToolState } from '@/lib/hooks';
import { cn } from '@/lib/utils';
import { buildUrl, parseUrl, partsFromUrl, toDisplayUrl, type ParsedUrl, type UrlParts } from './lib/url';
import { t } from '@/lib/i18n';

const TOOL = 'url-parser';
const SAMPLE = 'https://admin:s3cret@shop.bücher.example:8443/catalog/books/sci-fi%20%26%20fantasy?sort=price&tag=new&tag=sale&q=space+opera#reviews';

function Muted({ children = '(empty)' }: { children?: ReactNode }) {
  return <span className="font-sans text-fg-muted">{children}</span>;
}

function Value({ value, copy = true }: { value: string; copy?: boolean }) {
  if (!value) return <Muted />;
  return (
    <span className="flex items-start gap-1">
      <span className="min-w-0 flex-1 break-all">{value}</span>
      {copy && <CopyButton value={value} iconOnly label={t('Copy value')} className="-my-1" />}
    </span>
  );
}

function Components({ url }: { url: ParsedUrl }) {
  const [showPassword, setShowPassword] = useState(false);
  const items: Array<{ label: ReactNode; value: ReactNode; key: string }> = [
    { key: 'scheme', label: t('Scheme'), value: <Value value={url.protocol} /> },
  ];
  if (url.hasAuthority) {
    items.push({ key: 'user', label: t('Username'), value: <Value value={url.username} /> });
    items.push({
      key: 'pass',
      label: t('Password'),
      value: url.password ? (
        <span className="flex items-start gap-1">
          <span className="min-w-0 flex-1 break-all">{showPassword ? url.password : '•'.repeat(Math.min(12, Math.max(6, url.password.length)))}</span>
          <IconButton
            icon={showPassword ? EyeOff : Eye}
            label={showPassword ? t('Hide password') : t('Show password')}
            size="sm"
            className="-my-1"
            onClick={() => setShowPassword((v) => !v)}
          />
          <CopyButton value={url.password} iconOnly label={t('Copy password')} className="-my-1" />
        </span>
      ) : (
        <Muted />
      ),
    });
    items.push({
      key: 'host',
      label: t('Hostname'),
      value: url.hostname ? (
        <span className="flex flex-col gap-1">
          <span className="flex flex-wrap items-center gap-1.5">
            <span className="break-all">{url.hostnameUnicode}</span>
            {url.hostKind !== 'domain' && url.hostKind !== 'none' && <Badge>{url.hostKind === 'ipv4' ? t('IPv4') : t('IPv6')}</Badge>}
            {url.isIdn && <Badge tone="accent">IDN</Badge>}
            <CopyButton value={url.hostname} iconOnly label={t('Copy hostname')} className="-my-1" />
          </span>
          {url.isIdn && <span className="text-fg-muted">{t('Punycode: {hostname}', { hostname: url.hostname })}</span>}
        </span>
      ) : (
        <Muted />
      ),
    });
    items.push({
      key: 'port',
      label: t('Port'),
      value: url.port ? (
        <Value value={url.port} />
      ) : url.defaultPort ? (
        <span>
          {url.defaultPort} <Muted>{t('(default for {scheme})', { scheme: url.scheme })}</Muted>
        </span>
      ) : (
        <Muted>{t('(none)')}</Muted>
      ),
    });
    items.push({ key: 'origin', label: t('Origin'), value: <Value value={url.origin} /> });
  }
  items.push({ key: 'path', label: url.hasAuthority ? t('Path') : t('Path (opaque)'), value: <Value value={url.pathname} /> });
  items.push({ key: 'query', label: t('Query'), value: <Value value={url.search} /> });
  items.push({
    key: 'hash',
    label: t('Fragment'),
    value: url.rawHash ? (
      <span className="flex items-start gap-1">
        <span className="min-w-0 flex-1 break-all">
          #{url.hash}
          {url.hash !== url.rawHash && <span className="block text-fg-muted">{t('Raw: #{rawHash}', { rawHash: url.rawHash })}</span>}
        </span>
        <CopyButton value={`#${url.rawHash}`} iconOnly label={t('Copy fragment')} className="-my-1" />
      </span>
    ) : (
      <Muted />
    ),
  });
  return <KeyValueList items={items} />;
}

function Params({ url }: { url: ParsedUrl }) {
  const [view, setView] = useToolState<'decoded' | 'raw'>(TOOL, 'paramView', 'decoded');
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of url.params) m.set(p.key, (m.get(p.key) ?? 0) + 1);
    return m;
  }, [url.params]);
  const json = useMemo(() => {
    const obj: Record<string, string | string[]> = {};
    for (const p of url.params) {
      const prev = Object.prototype.hasOwnProperty.call(obj, p.key) ? obj[p.key] : undefined;
      const next = prev === undefined ? p.value : Array.isArray(prev) ? [...prev, p.value] : [prev, p.value];
      Object.defineProperty(obj, p.key, { value: next, enumerable: true, writable: true, configurable: true });
    }
    return JSON.stringify(obj, null, 2);
  }, [url.params]);

  return (
    <Panel
      title={t('Query parameters ({count})', { count: url.params.length })}
      actions={
        url.params.length > 0 && (
          <>
            <Segmented
              label={t('Parameter display')}
              size="sm"
              value={view}
              onChange={setView}
              options={[
                { value: 'decoded', label: t('Decoded') },
                { value: 'raw', label: t('Raw') },
              ]}
            />
            <CopyButton value={json} label={t('Copy as JSON')} />
          </>
        )
      }
      bodyClassName={url.params.length ? 'p-0' : undefined}
    >
      {url.params.length === 0 ? (
        <p className="text-[13px] text-fg-muted">{t('This URL has no query string.')}</p>
      ) : (
        <div className="overflow-x-auto" tabIndex={0} role="region" aria-label={t('Query parameters')}>
          <table className="w-full min-w-[420px] text-left text-[13px]">
            <thead className="text-[12px] text-fg-muted">
              <tr className="border-b border-line">
                <th className="w-10 py-2 pr-2 pl-4 font-medium">#</th>
                <th className="py-2 pr-3 font-medium">{t('Key')}</th>
                <th className="py-2 pr-4 font-medium">{t('Value')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line font-mono text-[12.5px]">
              {url.params.map((p, i) => {
                const key = view === 'raw' ? p.rawKey : p.key;
                const value = view === 'raw' ? p.rawValue : p.value;
                const repeated = (counts.get(p.key) ?? 0) > 1;
                return (
                  <tr key={i} className="align-top">
                    <td className="py-2 pr-2 pl-4 font-sans text-fg-muted tabular-nums">{i + 1}</td>
                    <td className="py-2 pr-3">
                      <span className="break-all text-fg">{key || <Muted />}</span>
                      {repeated && (
                        <Badge tone="warning" className="ml-1.5 align-middle font-sans">
                          {t('repeated')}
                        </Badge>
                      )}
                    </td>
                    <td className="py-2 pr-4">
                      <span className="flex items-start gap-1">
                        <span className="min-w-0 flex-1 break-all text-fg">
                          {value ? value : p.hasEquals ? <Muted>{t('(empty)')}</Muted> : <Muted>{t('(no value)')}</Muted>}
                        </span>
                        <CopyButton value={value} iconOnly label={t('Copy value')} className="-my-1" />
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

function Builder({ url, onBuild }: { url: ParsedUrl; onBuild: (href: string) => void }) {
  const [draft, setDraft] = useState<{ parts: UrlParts; forHref: string; error: string | null } | null>(null);
  const current = draft && draft.forHref === url.href ? draft : null;
  const parts = current?.parts ?? partsFromUrl(url);
  const error = current?.error ?? null;

  function update(next: UrlParts) {
    const r = buildUrl(next);
    if (r.ok) {
      setDraft({ parts: next, forHref: r.href, error: null });
      onBuild(r.href);
    } else {
      setDraft({ parts: next, forHref: url.href, error: r.error });
    }
  }
  const set = <K extends keyof UrlParts>(key: K, value: UrlParts[K]) => update({ ...parts, [key]: value });
  const setParam = (i: number, field: 'key' | 'value', value: string) =>
    set(
      'params',
      parts.params.map((p, j) => (j === i ? { ...p, [field]: value, hasEquals: field === 'value' ? true : p.hasEquals } : p)),
    );

  const text = (key: 'protocol' | 'username' | 'password' | 'hostname' | 'port' | 'pathname' | 'hash', label: string, extra?: { placeholder?: string; className?: string; type?: string }) => (
    <Field label={label} className={extra?.className}>
      {({ id }) => (
        <Input
          id={id}
          mono
          type={extra?.type ?? 'text'}
          autoComplete="off"
          spellCheck={false}
          value={parts[key]}
          placeholder={extra?.placeholder}
          onChange={(e) => set(key, e.target.value)}
        />
      )}
    </Field>
  );

  return (
    <Panel title={t('Edit and rebuild')} description={t('Changes update the URL above; parameters you edit are percent-encoded for you.')}>
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-[140px_minmax(0,1fr)_110px]">
          {text('protocol', 'Scheme', { placeholder: 'https' })}
          {url.hasAuthority && text('hostname', 'Host', { placeholder: 'example.com' })}
          {url.hasAuthority && text('port', 'Port', { placeholder: url.defaultPort ?? '' })}
        </div>
        {url.hasAuthority && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {text('username', 'Username')}
            {text('password', 'Password', { type: 'password' })}
          </div>
        )}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          {text('pathname', 'Path', { placeholder: '/' })}
          {text('hash', 'Fragment', { placeholder: 'section' })}
        </div>
        <div>
          <Label>{t('Query parameters')}</Label>
          <div className="flex flex-col gap-2">
            {parts.params.map((p, i) => (
              <div key={i} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_auto] items-center gap-2">
                <Input mono aria-label={t('Parameter {i} key', { i: i + 1 })} placeholder="key" value={p.key} onChange={(e) => setParam(i, 'key', e.target.value)} />
                <Input mono aria-label={t('Parameter {i} value', { i: i + 1 })} placeholder="value" value={p.value} onChange={(e) => setParam(i, 'value', e.target.value)} />
                <IconButton icon={X} label={t('Remove parameter {i}', { i: i + 1 })} size="sm" onClick={() => set('params', parts.params.filter((_, j) => j !== i))} />
              </div>
            ))}
            <div>
              <Button size="sm" variant="ghost" icon={Plus} onClick={() => update({ ...parts, params: [...parts.params, { key: '', value: '' }] })}>
                {t('Add parameter')}
              </Button>
            </div>
          </div>
        </div>
        <ErrorMessage error={error} title={t('Cannot rebuild the URL')} />
      </div>
    </Panel>
  );
}

export default function UrlParser() {
  const [input, setInput] = useToolState(TOOL, 'input', SAMPLE);
  const [useBase, setUseBase] = useToolState(TOOL, 'useBase', false);
  const [base, setBase] = useToolState(TOOL, 'base', 'https://example.com/docs/guide/');

  const result = useMemo(() => parseUrl(input, useBase ? base : undefined), [input, useBase, base]);
  const url = result?.ok ? result.url : null;
  const display = url ? toDisplayUrl(url) : '';
  const resolved = url && useBase && url.href !== input.trim();

  return (
    <ToolStack>
      <Panel bodyClassName="flex flex-col gap-4">
        <Field label="URL" hint={useBase ? t('Relative URLs are resolved against the base URL below.') : undefined}>
          {({ id, describedBy }) => (
            <div className="flex gap-2">
              <Input
                id={id}
                aria-describedby={describedBy}
                aria-invalid={result?.ok === false || undefined}
                mono
                autoComplete="off"
                spellCheck={false}
                value={input}
                placeholder="https://example.com/path?query=value#fragment"
                onChange={(e) => setInput(e.target.value)}
              />
              <IconButton icon={FlaskConical} label={t('Load sample')} variant="secondary" onClick={() => setInput(SAMPLE)} />
              <IconButton icon={X} label={t('Clear')} variant="secondary" disabled={!input} onClick={() => setInput('')} />
            </div>
          )}
        </Field>
        <div className="flex flex-col gap-3">
          <Switch label={t('Resolve against a base URL')} checked={useBase} onChange={setUseBase} />
          {useBase && (
            <Field label={t('Base URL')}>
              {({ id }) => <Input id={id} mono autoComplete="off" spellCheck={false} value={base} placeholder="https://example.com/docs/" onChange={(e) => setBase(e.target.value)} />}
            </Field>
          )}
        </div>
        {result && !result.ok && <ErrorMessage error={result.error} title={t('Invalid URL')} />}
        {url && (
          <div className="flex flex-col gap-2 rounded-lg border border-line bg-surface-sunken px-3 py-2.5">
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <div className="text-[12px] text-fg-muted">{resolved ? t('Resolved URL') : t('Normalized URL')}</div>
                <div className="font-mono text-[13px] break-all text-fg">{url.href}</div>
              </div>
              <CopyButton value={url.href} iconOnly label={t('Copy URL')} />
            </div>
            {display !== url.href && (
              <div className="flex items-start gap-2 border-t border-line pt-2">
                <div className="min-w-0 flex-1">
                  <div className="text-[12px] text-fg-muted">{t('Readable (decoded, Unicode host)')}</div>
                  <div className="font-mono text-[13px] break-all text-fg-secondary">{display}</div>
                </div>
                <CopyButton value={display} iconOnly label={t('Copy readable URL')} />
              </div>
            )}
          </div>
        )}
      </Panel>

      {!result && (
        <Panel>
          <EmptyState icon={Link} title={t('Enter a URL to inspect it')}>
            {t('Paste any absolute URL, or turn on the base URL option to resolve relative links such as ../images/logo.png.')}
          </EmptyState>
        </Panel>
      )}

      {url && (
        <>
          <div className="grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
            <Panel title={t('Components')}>
              <Components url={url} />
            </Panel>
            <div className="flex min-w-0 flex-col gap-4">
              <Panel title={t('Path segments ({count})', { count: url.segments.length })}>
                {url.segments.length === 0 ? (
                  <p className="text-[13px] text-fg-muted">{url.hasAuthority ? t('The path is just “/”.') : t('This URL has an opaque path without segments.')}</p>
                ) : (
                  <ol className="flex flex-wrap items-center gap-1.5 font-mono text-[12.5px]">
                    {url.segments.map((s, i) => (
                      <li key={i} className="flex items-center gap-1.5">
                        <span className="text-fg-muted">/</span>
                        <span
                          className={cn('rounded-md border border-line bg-surface-sunken px-2 py-0.5 break-all', s.decoded ? 'text-fg' : 'text-fg-muted')}
                          title={s.raw !== s.decoded ? t('Raw: {raw}', { raw: s.raw }) : undefined}
                        >
                          {s.decoded || t('(empty)')}
                        </span>
                      </li>
                    ))}
                  </ol>
                )}
              </Panel>
              <Params url={url} />
            </div>
          </div>
          <Builder url={url} onBuild={setInput} />
        </>
      )}
    </ToolStack>
  );
}
