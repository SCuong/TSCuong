import { useMemo, useState, type ReactNode } from 'react';
import { Bot, Monitor, Smartphone, Tablet, Tv, UserRound } from 'lucide-react';
import { EditorPanel, ToolStack } from '@/components/tool/EditorPanel';
import { Button } from '@/components/ui/Button';
import { ErrorMessage, Alert } from '@/components/ui/Alert';
import { Textarea, Label } from '@/components/ui/Field';
import { Badge, Panel } from '@/components/ui/Panel';
import { errorMessage } from '@/lib/utils';
import { parseUserAgent, SAMPLE_USER_AGENTS } from './lib/userAgent';

interface UAData {
  brands: Array<{ brand: string; version: string }>;
  mobile: boolean;
  platform: string;
  getHighEntropyValues?: (hints: string[]) => Promise<Record<string, unknown>>;
}

function currentUA(): string {
  return typeof navigator === 'undefined' ? '' : navigator.userAgent;
}

function getUAData(): UAData | null {
  if (typeof navigator === 'undefined') return null;
  const data = (navigator as Navigator & { userAgentData?: UAData }).userAgentData;
  return data ?? null;
}

const PLATFORM_ICONS = { desktop: Monitor, mobile: Smartphone, tablet: Tablet, tv: Tv, bot: Bot } as const;

function Card({ title, primary, secondary }: { title: string; primary: ReactNode; secondary?: ReactNode }) {
  return (
    <div className="min-w-0 rounded-lg border border-line bg-surface-sunken px-3.5 py-3">
      <div className="text-[12px] text-fg-muted">{title}</div>
      <div className="mt-0.5 truncate text-[15px] font-semibold text-fg">{primary}</div>
      {secondary && <div className="mt-0.5 truncate text-[12.5px] text-fg-secondary">{secondary}</div>}
    </div>
  );
}

function ClientHints() {
  const data = getUAData();
  const [high, setHigh] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!data) {
    return (
      <p className="text-[13px] text-fg-secondary">
        This browser does not expose User-Agent Client Hints (<code className="font-mono">navigator.userAgentData</code>). Firefox and
        Safari currently rely on the User-Agent string only.
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-3 text-[13px]">
      <div className="flex flex-wrap gap-1.5">
        {data.brands.map((b) => (
          <Badge key={b.brand}>
            {b.brand} {b.version}
          </Badge>
        ))}
        <Badge tone="accent">Platform: {data.platform || 'unknown'}</Badge>
        <Badge tone="accent">{data.mobile ? 'Mobile' : 'Not mobile'}</Badge>
      </div>
      {data.getHighEntropyValues && !high && (
        <div>
          <Button
            size="sm"
            onClick={async () => {
              try {
                setHigh(
                  await data.getHighEntropyValues!([
                    'architecture',
                    'bitness',
                    'model',
                    'platformVersion',
                    'fullVersionList',
                    'wow64',
                  ]),
                );
              } catch (err) {
                setError(errorMessage(err, 'The browser declined to share detailed hints.'));
              }
            }}
          >
            Show detailed hints
          </Button>
          <p className="mt-1.5 text-[12.5px] text-fg-muted">Asks this browser for its architecture, model and full versions. Nothing is sent anywhere.</p>
        </div>
      )}
      <ErrorMessage error={error} />
      {high && (
        <pre className="overflow-x-auto rounded-lg border border-line bg-surface-sunken p-3 font-mono text-[12.5px] text-fg">
          {JSON.stringify(high, null, 2)}
        </pre>
      )}
    </div>
  );
}

export default function UserAgentParser() {
  const [ua, setUa] = useState(currentUA);
  const isMine = ua === currentUA();

  const result = useMemo(() => {
    if (!ua.trim()) return null;
    try {
      return { ok: true as const, info: parseUserAgent(ua) };
    } catch (error) {
      return { ok: false as const, error: errorMessage(error) };
    }
  }, [ua]);

  const info = result?.ok ? result.info : null;
  const json = info ? JSON.stringify({ userAgent: ua.trim(), ...info }, null, 2) : '';
  const PlatformIcon = (info?.platform.type && PLATFORM_ICONS[info.platform.type as keyof typeof PLATFORM_ICONS]) || UserRound;
  const nothing = info && !info.browser.name && !info.os.name && !info.engine.name && !info.platform.type;

  return (
    <ToolStack>
      <Panel bodyClassName="flex flex-col gap-3">
        <div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Label htmlFor="ua-input">User-Agent string</Label>
            {isMine ? (
              <Badge tone="accent" className="mb-1.5">
                Your browser
              </Badge>
            ) : (
              <Button size="sm" variant="ghost" className="mb-1.5" onClick={() => setUa(currentUA())}>
                Use my browser’s User-Agent
              </Button>
            )}
          </div>
          <Textarea
            id="ua-input"
            value={ua}
            onChange={(e) => setUa(e.target.value)}
            rows={3}
            placeholder="Mozilla/5.0 (…)"
            className="resize-y"
          />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {SAMPLE_USER_AGENTS.map((s) => (
            <button
              key={s.label}
              type="button"
              onClick={() => setUa(s.ua)}
              className="rounded-md border border-line bg-surface-sunken px-2 py-0.5 text-[12.5px] text-fg-secondary hover:border-line-strong hover:text-fg"
            >
              {s.label}
            </button>
          ))}
        </div>
      </Panel>

      {result && !result.ok && <ErrorMessage error={result.error} />}
      {!result && <Alert tone="info">Paste a User-Agent string, or use your browser’s.</Alert>}
      {nothing && <Alert tone="warning">This string does not match any known browser, engine or operating system.</Alert>}
      {info?.fromProductToken && (
        <Alert tone="info">Identified from the leading product token; this looks like an HTTP client or script rather than a browser.</Alert>
      )}

      {info && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Card title="Browser" primary={info.browser.name ?? 'Unknown'} secondary={info.browser.version && `Version ${info.browser.version}`} />
          <Card title="Engine" primary={info.engine.name ?? 'Unknown'} secondary={info.engine.version && `Version ${info.engine.version}`} />
          <Card
            title="Operating system"
            primary={info.os.name ?? 'Unknown'}
            secondary={[info.os.versionName, info.os.version].filter(Boolean).join(' · ') || undefined}
          />
          <Card
            title="Device"
            primary={
              <span className="inline-flex items-center gap-1.5">
                <PlatformIcon size={16} aria-hidden className="text-fg-muted" />
                {info.platform.type ? info.platform.type.charAt(0).toUpperCase() + info.platform.type.slice(1) : 'Unknown'}
              </span>
            }
            secondary={[info.platform.vendor, info.platform.model].filter(Boolean).join(' ') || undefined}
          />
        </div>
      )}

      {info && <EditorPanel title="JSON" value={json} language="json" height="300px" downloadName="user-agent.json" downloadType="application/json" />}

      <Panel title="Client Hints" description="Structured data some browsers expose instead of the UA string.">
        <ClientHints />
      </Panel>
    </ToolStack>
  );
}
