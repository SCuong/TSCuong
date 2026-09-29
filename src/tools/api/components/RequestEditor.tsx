import type { ClipboardEvent, ReactNode } from 'react';
import { Send, Square } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Alert } from '@/components/ui/Alert';
import { NumberInput, Label } from '@/components/ui/Field';
import { useToolState } from '@/lib/hooks';
import { cn } from '@/lib/utils';
import { METHODS, type HttpMethod, type KeyValue, type RequestDraft } from '../lib/model';
import { paramsFromUrl, urlWithParams } from '../lib/url';
import { forbiddenHeaders, isForbiddenHeader } from '../lib/prepare';
import type { Scope } from '../lib/vars';
import { KeyValueEditor } from './KeyValueEditor';
import { BodyEditor } from './BodyEditor';
import { AuthEditor } from './AuthEditor';
import { VarInput } from './VarInput';
import { METHOD_COLOR, TabStrip } from './bits';

const COMMON_HEADERS = [
  'Accept',
  'Accept-Language',
  'Authorization',
  'Cache-Control',
  'Content-Type',
  'If-Match',
  'If-None-Match',
  'If-Modified-Since',
  'Origin',
  'Prefer',
  'Range',
  'User-Agent',
  'X-API-Key',
  'X-Request-ID',
  'X-Requested-With',
];
const HEADER_LIST_ID = 'api-client-common-headers';

type Tab = 'params' | 'headers' | 'body' | 'auth' | 'settings';

export function RequestEditor({
  draft,
  onChange,
  scope,
  via,
  sending,
  onSend,
  onCancel,
  onPasteText,
  error,
  notices,
  toolbar,
  className,
}: {
  draft: RequestDraft;
  onChange: (next: RequestDraft) => void;
  scope: Scope;
  via: 'browser' | 'companion';
  sending: boolean;
  onSend: () => void;
  onCancel: () => void;
  onPasteText: (text: string, e: ClipboardEvent<HTMLInputElement>) => void;
  /** Validation error from the last send attempt. */
  error: string | null;
  notices: ReactNode;
  /** Name, save, code, environment and send-via controls. */
  toolbar: ReactNode;
  className?: string;
}) {
  const [tab, setTab] = useToolState<Tab>('api-client', 'requestTab', 'params');
  const set = (patch: Partial<RequestDraft>) => onChange({ ...draft, ...patch });

  const enabledHeaders = draft.headers.filter((h) => h.enabled && h.key.trim());
  const forbidden = via === 'browser' ? forbiddenHeaders(enabledHeaders.map((h) => h.key)) : [];
  const paramCount = draft.params.filter((p) => p.enabled && (p.key || p.value)).length;
  const bodyLabel = draft.body.mode === 'none' ? undefined : draft.body.mode === 'raw' ? draft.body.rawLanguage.toUpperCase() : '●';

  return (
    <section aria-label="Request" className={cn('flex min-h-0 min-w-0 flex-col rounded-xl border border-line bg-surface shadow-card', className)}>
      <div className="flex flex-col gap-2.5 border-b border-line p-3">
        {toolbar}
        <form
          className="flex min-w-0 flex-wrap gap-2 sm:flex-nowrap"
          onSubmit={(e) => {
            e.preventDefault();
            if (!sending) onSend();
          }}
        >
          <select
            aria-label="HTTP method"
            value={draft.method}
            onChange={(e) => set({ method: e.target.value as HttpMethod })}
            className={cn('lk-field h-9 w-[6.5rem] shrink-0 py-0 font-mono text-[13px] font-semibold', METHOD_COLOR[draft.method])}
          >
            {METHODS.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
          <VarInput
            aria-label="Request URL"
            mono
            value={draft.url}
            onChange={(url) => set({ url, params: paramsFromUrl(url, draft.params) })}
            onPasteText={onPasteText}
            scope={scope}
            placeholder="https://api.example.com/items or paste a curl command"
            className="order-last w-full basis-full sm:order-none sm:basis-auto sm:flex-1"
          />
          {sending ? (
            <Button type="button" variant="secondary" icon={Square} onClick={onCancel} className="h-9 min-w-[5.5rem]">
              Cancel
            </Button>
          ) : (
            <Button type="submit" variant="primary" icon={Send} className="ml-auto h-9 min-w-[5.5rem] sm:ml-0">
              Send
            </Button>
          )}
        </form>
        {error && (
          <Alert tone="danger" className="py-2">
            {error}
          </Alert>
        )}
        {notices}
      </div>

      <TabStrip
        label="Request sections"
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'params', label: 'Params', badge: paramCount || undefined },
          { id: 'headers', label: 'Headers', badge: enabledHeaders.length || undefined },
          { id: 'body', label: 'Body', badge: bodyLabel },
          { id: 'auth', label: 'Auth', badge: draft.auth.type === 'none' ? undefined : '●' },
          { id: 'settings', label: 'Settings' },
        ]}
      />

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        {tab === 'params' && (
          <div className="p-3">
            <KeyValueEditor<KeyValue>
              label="Query parameters"
              rows={draft.params}
              onChange={(params) => set({ params, url: urlWithParams(draft.url, params) })}
              makeRow={(r) => r}
              scope={scope}
              keyLabel="Parameter"
            />
            <p className="mt-2 text-[12.5px] text-fg-muted">
              Synced with the URL. Values are sent as typed: percent-encode reserved characters such as &amp; and # yourself.
            </p>
          </div>
        )}
        {tab === 'headers' && (
          <div className="flex flex-col gap-2 p-3">
            {forbidden.length > 0 && (
              <Alert tone="warning" title="Browsers drop some of these headers">
                {forbidden.join(', ')} cannot be set from a web page; the browser silently leaves {forbidden.length === 1 ? 'it' : 'them'} out or uses its own
                value. Switch Send via to Companion to send {forbidden.length === 1 ? 'it' : 'them'}.
              </Alert>
            )}
            <KeyValueEditor<KeyValue>
              label="Request headers"
              rows={draft.headers}
              onChange={(headers) => set({ headers })}
              makeRow={(r) => r}
              scope={scope}
              keyLabel="Header"
              keyList={HEADER_LIST_ID}
              rowNote={(row) =>
                via === 'browser' && row.enabled && (isForbiddenHeader(row.key) || row.key.trim().toLowerCase() === 'user-agent')
                  ? 'Not sent by browsers'
                  : null
              }
            />
            <datalist id={HEADER_LIST_ID}>
              {COMMON_HEADERS.map((h) => (
                <option key={h} value={h} />
              ))}
            </datalist>
            <p className="text-[12.5px] text-fg-muted">
              Content-Type is added from the body type unless you set it here. Auth headers come from the Auth tab.
            </p>
          </div>
        )}
        {tab === 'body' && (
          <BodyEditor body={draft.body} onChange={(body) => set({ body })} scope={scope} methodAllowsBody={draft.method !== 'GET' && draft.method !== 'HEAD'} />
        )}
        {tab === 'auth' && <AuthEditor auth={draft.auth} onChange={(auth) => set({ auth })} scope={scope} />}
        {tab === 'settings' && (
          <div className="flex flex-col gap-4 p-3">
            <div className="max-w-xs">
              <Label htmlFor="api-timeout">Timeout (seconds)</Label>
              <NumberInput
                id="api-timeout"
                min={0}
                max={600}
                step={1}
                value={draft.timeoutMs / 1000}
                onChange={(v) => set({ timeoutMs: v === '' ? 0 : Math.max(0, Math.min(600, v)) * 1000 })}
              />
              <p className="mt-1.5 text-[12.5px] text-fg-muted">0 waits indefinitely (until you cancel). Press Esc to cancel a running request.</p>
            </div>
            <div className="text-[13px] text-fg-secondary">
              <p className="font-medium text-fg">Browser mode</p>
              <p className="mt-0.5">
                Requests go directly from this browser to the server, without cookies. Redirects are followed. The server must allow this page's origin via CORS.
              </p>
              <p className="mt-2 font-medium text-fg">Companion mode</p>
              <p className="mt-0.5">The optional local companion sends the request from your computer, so CORS and forbidden-header rules do not apply.</p>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
