import { useId, useState } from 'react';
import { Eye, EyeOff, RefreshCw } from 'lucide-react';
import { Dialog } from '@/components/ui/Dialog';
import { Button, IconButton } from '@/components/ui/Button';
import { Input, Label, NumberInput } from '@/components/ui/Field';
import { CopyButton } from '@/components/ui/Actions';
import { cn } from '@/lib/utils';
import { DEFAULT_COMPANION_PORT, type CompanionStatus } from '../lib/companion';

export type CompanionCheck = CompanionStatus | { state: 'checking' } | { state: 'unknown' };

export function companionLabel(status: CompanionCheck): { text: string; tone: 'ok' | 'bad' | 'muted' } {
  switch (status.state) {
    case 'connected':
      return { text: `Connected${status.version ? ` (v${status.version})` : ''}`, tone: 'ok' };
    case 'wrong-token':
      return { text: 'Wrong token', tone: 'bad' };
    case 'not-running':
      return { text: 'Not running', tone: 'bad' };
    case 'not-companion':
      return { text: 'Another program is using this port', tone: 'bad' };
    case 'checking':
      return { text: 'Checking…', tone: 'muted' };
    default:
      return { text: 'Not checked', tone: 'muted' };
  }
}

export function StatusDot({ status }: { status: CompanionCheck }) {
  const { tone } = companionLabel(status);
  return (
    <span
      aria-hidden
      className={cn('inline-block size-2 shrink-0 rounded-full', tone === 'ok' ? 'bg-success' : tone === 'bad' ? 'bg-danger' : 'bg-fg-muted/60')}
    />
  );
}

export function CompanionDialog({
  open,
  onClose,
  port,
  token,
  onChange,
  status,
  onCheck,
}: {
  open: boolean;
  onClose: () => void;
  port: number;
  token: string;
  onChange: (next: { port: number; token: string }) => void;
  status: CompanionCheck;
  onCheck: () => void;
}) {
  const [showToken, setShowToken] = useState(false);
  const ids = { port: useId(), token: useId() };
  const label = companionLabel(status);
  const command = port === DEFAULT_COMPANION_PORT ? 'npm run companion' : `npm run companion -- --port ${port}`;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="lg"
      title="Local companion"
      description="An optional helper that runs on your computer and sends requests for the API client, so browser CORS rules do not apply."
      footer={
        <Button variant="primary" onClick={onClose}>
          Done
        </Button>
      }
    >
      <div className="flex flex-col gap-4 text-[13px]">
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-surface-sunken px-3 py-2.5" role="status">
          <StatusDot status={status} />
          <span className={cn('font-medium', label.tone === 'ok' ? 'text-success' : label.tone === 'bad' ? 'text-danger' : 'text-fg-secondary')}>{label.text}</span>
          <span className="text-fg-muted">on 127.0.0.1:{port}</span>
          <Button size="sm" variant="ghost" icon={RefreshCw} onClick={onCheck} className="ml-auto" loading={status.state === 'checking'}>
            Check again
          </Button>
        </div>

        <ol className="flex list-decimal flex-col gap-3 pl-5 text-fg-secondary">
          <li>
            In a terminal, in the LocalKit folder (Node.js 20 or newer), run:
            <div className="mt-1.5 flex items-center gap-2 rounded-lg border border-line bg-surface-sunken py-1 pr-1 pl-3">
              <code className="min-w-0 flex-1 truncate font-mono text-[12.5px] text-fg">{command}</code>
              <CopyButton value={command} iconOnly label="Copy command" />
            </div>
          </li>
          <li>
            Paste the token it prints:
            <div className="mt-1.5 grid gap-3 sm:grid-cols-[minmax(0,1fr)_8rem]">
              <div>
                <Label htmlFor={ids.token}>Token</Label>
                <div className="flex items-center gap-1">
                  <Input
                    id={ids.token}
                    type={showToken ? 'text' : 'password'}
                    mono
                    value={token}
                    onChange={(e) => onChange({ port, token: e.target.value.trim() })}
                    placeholder="Paste the token"
                    autoComplete="off"
                  />
                  <IconButton icon={showToken ? EyeOff : Eye} label={showToken ? 'Hide token' : 'Show token'} size="sm" onClick={() => setShowToken((s) => !s)} />
                </div>
              </div>
              <div>
                <Label htmlFor={ids.port}>Port</Label>
                <NumberInput
                  id={ids.port}
                  min={1}
                  max={65535}
                  value={port}
                  onChange={(v) => {
                    if (v !== '' && Number.isInteger(v) && v > 0 && v < 65536) onChange({ port: v, token });
                  }}
                />
              </div>
            </div>
          </li>
          <li>Check that the status above says Connected, then choose “Companion” next to Send.</li>
        </ol>

        <div className="rounded-lg border border-line p-3 text-fg-secondary">
          <p className="font-medium text-fg">How it stays safe</p>
          <ul className="mt-1.5 list-disc space-y-1 pl-5">
            <li>It listens on 127.0.0.1 only, so other computers cannot reach it.</li>
            <li>Every call needs the random token it prints at startup. The token is stored in this browser's localStorage.</li>
            <li>It only accepts requests from localhost pages (plus origins you allow with --allow-origin) and refuses to proxy to itself.</li>
            <li>Requests go straight from your computer to the API. Nothing passes through a third-party server.</li>
          </ul>
          <p className="mt-2 text-fg-muted">Details: companion/README.md in the LocalKit folder.</p>
        </div>
      </div>
    </Dialog>
  );
}
