import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { ArrowUpRight, Clock, Copy, PlugZap, RefreshCw, Send, TriangleAlert } from 'lucide-react';
import { CodeEditor } from '@/components/editor/CodeEditor';
import type { EditorLanguage } from '@/components/editor/languages';
import { Segmented } from '@/components/ui/Segmented';
import { Button } from '@/components/ui/Button';
import { CopyButton, DownloadButton } from '@/components/ui/Actions';
import { Badge, Kbd } from '@/components/ui/Panel';
import { EmptyState, Spinner } from '@/components/ui/Feedback';
import { Textarea } from '@/components/ui/Field';
import { Alert } from '@/components/ui/Alert';
import { useObjectUrl } from '@/lib/hooks';
import { cn, copyText, formatBytes, formatDuration, modKey } from '@/lib/utils';
import { toast } from '@/components/ui/Toast';
import {
  classifyBody,
  headerValue,
  PRETTY_LIMIT,
  prettyPrintJson,
  responseFilename,
  statusReason,
  type ApiResponse,
  type BodyKind,
  type FailureExplanation,
} from '../lib/response';
import { StatusPill, TabStrip } from './bits';

export type ResponseState =
  | { phase: 'idle' }
  | { phase: 'sending'; startedAt: number; via: 'browser' | 'companion' }
  | { phase: 'done'; response: ApiResponse; requestUrl: string }
  | { phase: 'error'; failure: FailureExplanation; via: 'browser' | 'companion' };

/** Bodies above this size are not decoded as text at all (download them instead). */
const TEXT_LIMIT = 50 * 1024 * 1024;
const RAW_SHOW_LIMIT = 10 * 1024 * 1024;

const EDITOR_LANG: Partial<Record<BodyKind, EditorLanguage>> = { json: 'json', html: 'html', xml: 'xml', image: 'xml' };

export function ResponsePanel({
  state,
  onCancel,
  onRetry,
  onUseCompanion,
  curl,
  idleHint,
  className,
}: {
  state: ResponseState;
  onCancel: () => void;
  onRetry: () => void;
  onUseCompanion: () => void;
  /** cURL for the current request (secrets hidden), for the CORS fallback. */
  curl: () => string | null;
  idleHint: ReactNode;
  className?: string;
}) {
  return (
    <section aria-label="Response" className={cn('flex min-h-0 min-w-0 flex-col rounded-xl border border-line bg-surface shadow-card', className)}>
      {state.phase === 'idle' && (
        <div className="flex flex-1 items-center justify-center">
          <EmptyState icon={Send} title="No response yet">
            {idleHint}
          </EmptyState>
        </div>
      )}
      {state.phase === 'sending' && <Sending startedAt={state.startedAt} via={state.via} onCancel={onCancel} />}
      {state.phase === 'error' && (
        <FailureView failure={state.failure} via={state.via} onRetry={onRetry} onUseCompanion={onUseCompanion} curl={curl} />
      )}
      {state.phase === 'done' && <ResponseView key={state.response.timeMs + state.response.url} response={state.response} requestUrl={state.requestUrl} />}
    </section>
  );
}

function Sending({ startedAt, via, onCancel }: { startedAt: number; via: string; onCancel: () => void }) {
  const [now, setNow] = useState(() => performance.now());
  useEffect(() => {
    const id = setInterval(() => setNow(performance.now()), 100);
    return () => clearInterval(id);
  }, []);
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 py-12 text-center">
      <Spinner size={20} label={`Sending${via === 'companion' ? ' via the companion' : ''}… ${formatDuration(Math.max(0, now - startedAt))}`} />
      <Button size="sm" variant="secondary" onClick={onCancel}>
        Cancel <Kbd className="ml-1">Esc</Kbd>
      </Button>
    </div>
  );
}

function FailureView({
  failure,
  via,
  onRetry,
  onUseCompanion,
  curl,
}: {
  failure: FailureExplanation;
  via: 'browser' | 'companion';
  onRetry: () => void;
  onUseCompanion: () => void;
  curl: () => string | null;
}) {
  const browserBlocked = failure.kind === 'blocked-or-unreachable' || failure.kind === 'mixed-content';
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
      <Alert tone={failure.kind === 'cancelled' ? 'info' : 'danger'} title={failure.title}>
        <p>{failure.detail}</p>
        {failure.causes.length > 0 && (
          <ul className="mt-2 list-disc space-y-1 pl-5">
            {failure.causes.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        )}
      </Alert>
      {via === 'companion' && (
        <p className="text-[12.5px] text-fg-muted">The request went through the local companion. Check its terminal window for details.</p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" icon={RefreshCw} onClick={onRetry}>
          Retry
        </Button>
        {browserBlocked && via === 'browser' && (
          <Button size="sm" icon={PlugZap} onClick={onUseCompanion}>
            Use local companion
          </Button>
        )}
        {browserBlocked && (
          <Button
            size="sm"
            icon={Copy}
            onClick={async () => {
              const text = curl();
              if (!text) return toast('The request has errors; fix them first.', 'error');
              const ok = await copyText(text);
              toast(ok ? 'Copied as cURL (secrets replaced by placeholders).' : 'Copy failed. Your browser blocked clipboard access.', ok ? 'success' : 'error');
            }}
          >
            Copy as cURL
          </Button>
        )}
      </div>
      {browserBlocked && (
        <div className="rounded-lg border border-line bg-surface-sunken p-3 text-[13px] text-fg-secondary">
          <p className="font-medium text-fg">What you can do</p>
          <ul className="mt-1.5 list-disc space-y-1 pl-5">
            <li>
              If you control the server, allow this origin (<code className="font-mono text-[12px]">{window.location.origin}</code>) with CORS headers.
            </li>
            <li>Send it through the optional local companion, which is not subject to browser CORS rules.</li>
            <li>Copy the request as cURL and run it in a terminal.</li>
          </ul>
        </div>
      )}
    </div>
  );
}

type View = 'pretty' | 'raw' | 'preview';

function ResponseView({ response, requestUrl }: { response: ApiResponse; requestUrl: string }) {
  const [tab, setTab] = useState<'body' | 'headers'>('body');
  const [kind, setKind] = useState<BodyKind | null>(null);
  const [text, setText] = useState<string | null>(null);
  const [forcePretty, setForcePretty] = useState(false);
  const [view, setView] = useState<View>('pretty');
  const size = response.body.size;
  const contentType = headerValue(response.headers, 'content-type');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const head = new Uint8Array(await response.body.slice(0, 2048).arrayBuffer());
      const k = classifyBody(contentType, size, head);
      const textual = k === 'json' || k === 'html' || k === 'xml' || k === 'text' || (k === 'image' && /svg/.test(contentType ?? ''));
      const decoded = textual && size <= TEXT_LIMIT ? await response.body.text() : null;
      if (cancelled) return;
      setKind(k);
      setText(decoded);
      setView(k === 'image' || k === 'pdf' ? 'preview' : k === 'binary' ? 'raw' : 'pretty');
    })().catch(() => {
      if (!cancelled) setKind('binary');
    });
    return () => {
      cancelled = true;
    };
  }, [response, contentType, size]);

  const pretty = useMemo(() => {
    if (text === null || kind !== 'json') return null;
    if (size > PRETTY_LIMIT && !forcePretty) return null;
    return prettyPrintJson(text);
  }, [text, kind, size, forcePretty]);

  const filename = responseFilename(response.url || requestUrl, response.headers, kind ?? 'binary');
  const reason = statusReason(response.status, response.statusText);
  const canPreview = kind === 'html' || kind === 'image' || kind === 'pdf';
  const crossOrigin = (() => {
    try {
      return new URL(response.url || requestUrl).origin !== window.location.origin;
    } catch {
      return false;
    }
  })();

  return (
    <>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line px-3 py-2.5">
        <StatusPill status={response.status}>
          {response.status}
          {reason ? ` ${reason}` : ''}
        </StatusPill>
        <span className="inline-flex items-center gap-1 text-[12.5px] text-fg-secondary tabular-nums" title="Total time until the whole body arrived">
          <Clock size={13} aria-hidden className="text-fg-muted" />
          {formatDuration(response.timeMs)}
        </span>
        <span className="text-[12.5px] text-fg-secondary tabular-nums" title={`${size} bytes`}>
          {formatBytes(size)}
        </span>
        <Badge tone={response.via === 'companion' ? 'accent' : 'neutral'}>{response.via === 'companion' ? 'Companion' : 'Browser'}</Badge>
        {response.redirected && (
          <Badge tone="neutral">
            <ArrowUpRight size={11} aria-hidden />
            Redirected
          </Badge>
        )}
        <div className="ml-auto flex items-center gap-1">
          <CopyButton value={text ?? ''} iconOnly label="Copy body" />
          <DownloadButton data={response.body} filename={filename} label="Save" variant="ghost" disabled={size === 0} />
        </div>
      </div>
      <TabStrip
        label="Response sections"
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'body', label: 'Body' },
          { id: 'headers', label: 'Headers', badge: response.headers.length },
        ]}
      />
      {tab === 'headers' ? (
        <div className="min-h-0 flex-1 overflow-auto p-3">
          {response.via === 'browser' && crossOrigin && (
            <p className="mb-2 text-[12.5px] text-fg-muted">
              Browsers only show cross-origin response headers that the server lists in Access-Control-Expose-Headers. The companion shows all of them.
            </p>
          )}
          {response.headers.length === 0 ? (
            <p className="py-6 text-center text-[13px] text-fg-muted">No headers are visible.</p>
          ) : (
            <table className="w-full table-fixed border-collapse text-[12.5px]">
              <caption className="sr-only">Response headers</caption>
              <thead>
                <tr className="border-b border-line text-left text-fg-muted">
                  <th scope="col" className="w-2/5 py-1.5 pr-3 font-medium">
                    Name
                  </th>
                  <th scope="col" className="py-1.5 font-medium">
                    Value
                  </th>
                </tr>
              </thead>
              <tbody>
                {response.headers.map(([name, value], i) => (
                  <tr key={`${name}-${i}`} className="border-b border-line/70 align-top">
                    <td className="py-1.5 pr-3 font-mono break-all text-fg-secondary">{name}</td>
                    <td className="py-1.5 font-mono break-all text-fg">{value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          {kind === null ? (
            <div className="flex flex-1 items-center justify-center py-10">
              <Spinner label="Reading body…" />
            </div>
          ) : kind === 'empty' ? (
            <p className="py-10 text-center text-[13px] text-fg-muted">The response has no body.</p>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2 px-3 pt-2.5">
                <Segmented
                  label="Body view"
                  size="sm"
                  value={view}
                  onChange={setView}
                  options={[
                    ...(kind !== 'binary' && kind !== 'pdf' && !(kind === 'image' && text === null) ? [{ value: 'pretty' as View, label: 'Pretty' }] : []),
                    { value: 'raw' as View, label: kind === 'binary' || (kind === 'image' && text === null) || kind === 'pdf' ? 'Hex' : 'Raw' },
                    ...(canPreview ? [{ value: 'preview' as View, label: 'Preview' }] : []),
                  ]}
                />
                <span className="truncate text-[12px] text-fg-muted">{contentType || 'No Content-Type'}</span>
              </div>
              <BodyView
                view={view}
                kind={kind}
                text={text}
                pretty={pretty}
                size={size}
                body={response.body}
                forcePretty={() => setForcePretty(true)}
              />
            </>
          )}
        </div>
      )}
    </>
  );
}

function BodyView({
  view,
  kind,
  text,
  pretty,
  size,
  body,
  forcePretty,
}: {
  view: View;
  kind: BodyKind;
  text: string | null;
  pretty: string | null;
  size: number;
  body: Blob;
  forcePretty: () => void;
}) {
  if (view === 'preview') return <Preview kind={kind} body={body} text={text} />;
  if (text === null) {
    if (size > TEXT_LIMIT && kind !== 'binary' && kind !== 'image' && kind !== 'pdf') {
      return (
        <p className="p-4 text-[13px] text-fg-muted">
          This {formatBytes(size)} body is too large to display. Use Save to download it.
        </p>
      );
    }
    return <HexView body={body} size={size} />;
  }
  if (view === 'raw') {
    const shown = text.length > RAW_SHOW_LIMIT ? text.slice(0, RAW_SHOW_LIMIT) : text;
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-1 p-3">
        {shown !== text && <p className="text-[12.5px] text-warning">Showing the first 10 MB. Save the response for the full body.</p>}
        <Textarea readOnly value={shown} aria-label="Raw response body" wrap="off" className="min-h-48 flex-1 resize-none whitespace-pre" />
      </div>
    );
  }
  // Pretty
  if (kind === 'json' && pretty === null) {
    const invalid = size <= PRETTY_LIMIT;
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-2 p-3">
        <Alert tone={invalid ? 'warning' : 'info'} action={invalid ? undefined : <Button size="sm" onClick={forcePretty}>Pretty print anyway</Button>}>
          {invalid ? 'The body is labelled JSON but is not valid JSON; showing it as sent.' : `Pretty view is off for large bodies (${formatBytes(size)}) to keep the page responsive.`}
        </Alert>
        <Textarea readOnly value={text.slice(0, RAW_SHOW_LIMIT)} aria-label="Response body" wrap="off" className="min-h-48 flex-1 resize-none whitespace-pre" />
      </div>
    );
  }
  if (size > PRETTY_LIMIT && kind !== 'json') {
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-2 p-3">
        <p className="text-[12.5px] text-fg-muted">Syntax highlighting is off for large bodies ({formatBytes(size)}).</p>
        <Textarea readOnly value={text.slice(0, RAW_SHOW_LIMIT)} aria-label="Response body" wrap="off" className="min-h-48 flex-1 resize-none whitespace-pre" />
      </div>
    );
  }
  return (
    <div className="min-h-48 flex-1 p-3">
      <div className="h-full overflow-hidden rounded-lg border border-line">
        <CodeEditor value={pretty ?? text} readOnly language={EDITOR_LANG[kind] ?? 'plain'} ariaLabel="Response body" className="h-full" />
      </div>
    </div>
  );
}

function Preview({ kind, body, text }: { kind: BodyKind; body: Blob; text: string | null }) {
  const url = useObjectUrl(kind === 'image' || kind === 'pdf' ? body : null);
  if (kind === 'html') {
    return (
      <div className="flex min-h-64 flex-1 flex-col gap-1 p-3">
        <p className="text-[12px] text-fg-muted">Sandboxed preview: scripts, forms and navigation are disabled.</p>
        <iframe title="HTML preview" sandbox="" srcDoc={text ?? ''} className="min-h-64 w-full flex-1 rounded-lg border border-line bg-white" />
      </div>
    );
  }
  if (kind === 'image' && url) {
    return (
      <div className="flex min-h-48 flex-1 items-center justify-center overflow-auto p-3">
        <img src={url} alt="Response image" className="lk-checker max-h-full max-w-full rounded-lg border border-line object-contain" />
      </div>
    );
  }
  if (kind === 'pdf' && url) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
        <p className="text-[13px] text-fg-secondary">The response is a PDF document.</p>
        <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex h-8 items-center gap-1.5 rounded-md border border-line-strong bg-surface-raised px-2.5 text-[13px] font-medium text-fg shadow-card hover:bg-surface-hover">
          <ArrowUpRight size={14} aria-hidden />
          Open PDF in a new tab
        </a>
      </div>
    );
  }
  return (
    <p className="flex items-center gap-2 p-4 text-[13px] text-fg-muted">
      <TriangleAlert size={14} aria-hidden /> No preview is available for this content.
    </p>
  );
}

function HexView({ body, size }: { body: Blob; size: number }) {
  const [lines, setLines] = useState<string[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    body
      .slice(0, 1024)
      .arrayBuffer()
      .then((buf) => {
        if (cancelled) return;
        const bytes = new Uint8Array(buf);
        const out: string[] = [];
        for (let i = 0; i < bytes.length; i += 16) {
          const row = bytes.subarray(i, i + 16);
          const hex = [...row].map((b) => b.toString(16).padStart(2, '0')).join(' ');
          const ascii = [...row].map((b) => (b >= 32 && b < 127 ? String.fromCharCode(b) : '.')).join('');
          out.push(`${i.toString(16).padStart(8, '0')}  ${hex.padEnd(47)}  ${ascii}`);
        }
        setLines(out);
      })
      .catch(() => setLines([]));
    return () => {
      cancelled = true;
    };
  }, [body]);
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-1 p-3">
      <p className="text-[12.5px] text-fg-muted">
        Binary content{size > 1024 ? `: first 1 KB of ${formatBytes(size)}` : ''}. Use Save to download it.
      </p>
      <pre className="min-h-0 flex-1 overflow-auto rounded-lg border border-line bg-surface-sunken p-3 font-mono text-[12px] leading-relaxed text-fg-secondary">
        {lines === null ? 'Reading…' : lines.join('\n')}
      </pre>
    </div>
  );
}

export function IdleShortcuts() {
  return (
    <span className="inline-flex flex-wrap items-center justify-center gap-1">
      Press <Kbd>{modKey}</Kbd>
      <Kbd>Enter</Kbd> to send, <Kbd>{modKey}</Kbd>
      <Kbd>S</Kbd> to save.
    </span>
  );
}
