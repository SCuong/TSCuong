import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CircleCheck, CircleX, KeyRound, ShieldCheck } from 'lucide-react';
import { SplitPanes, ToolStack } from '@/components/tool/EditorPanel';
import { Field, Input } from '@/components/ui/Field';
import { Button } from '@/components/ui/Button';
import { Alert, ErrorMessage } from '@/components/ui/Alert';
import { KeyValueList, Panel } from '@/components/ui/Panel';
import { EmptyState, Spinner } from '@/components/ui/Feedback';
import { useToolState } from '@/lib/hooks';
import { cn, errorMessage, formatDuration } from '@/lib/utils';
import {
  DEFAULT_COST,
  MAX_COST,
  MAX_PASSWORD_BYTES,
  MIN_COST,
  clampCost,
  estimateMs,
  parseBcryptHash,
  preparePassword,
  type BcryptParts,
} from './lib/bcrypt';
import type { BcryptRequest, BcryptResponse } from './lib/bcrypt.worker';
import { DigestRow, ElapsedLabel, SecretInput, useElapsed } from './shared-a/ui';

const TOOL = 'bcrypt';

type Job = { op: 'hash'; password: string; cost: number } | { op: 'verify'; password: string; hash: string };
type JobResult = { hash?: string; match?: boolean; ms: number };

/** Runs bcrypt in a dedicated worker so the page stays responsive; cancel = terminate. */
function useBcryptWorker() {
  const worker = useRef<Worker | null>(null);
  const pending = useRef<{ id: number; resolve: (r: JobResult) => void; reject: (e: Error) => void } | null>(null);
  const seq = useRef(0);

  const stop = useCallback(() => {
    worker.current?.terminate();
    worker.current = null;
    pending.current?.reject(new DOMException('Cancelled', 'AbortError'));
    pending.current = null;
  }, []);

  useEffect(() => stop, [stop]);

  const exec = useCallback(
    (job: Job) =>
      new Promise<JobResult>((resolve, reject) => {
        if (pending.current) stop();
        if (!worker.current) {
          const w = new Worker(new URL('./lib/bcrypt.worker.ts', import.meta.url), { type: 'module' });
          w.onmessage = (event: MessageEvent<BcryptResponse>) => {
            const res = event.data;
            const p = pending.current;
            if (!p || p.id !== res.id) return;
            pending.current = null;
            if (res.ok) p.resolve({ hash: res.hash, match: res.match, ms: res.ms });
            else p.reject(new Error(res.error));
          };
          w.onerror = (event) => {
            event.preventDefault();
            const p = pending.current;
            pending.current = null;
            worker.current?.terminate();
            worker.current = null;
            p?.reject(new Error('The bcrypt worker failed to start.'));
          };
          worker.current = w;
        }
        const id = ++seq.current;
        pending.current = { id, resolve, reject };
        worker.current.postMessage({ id, ...job } as BcryptRequest);
      }),
    [stop],
  );

  return { exec, stop };
}

function PartsList({ parts }: { parts: BcryptParts }) {
  return (
    <KeyValueList
      items={[
        {
          label: 'Version',
          value: `$${parts.version}$${parts.version === '2b' ? ' (current)' : parts.version === '2y' ? ' (PHP, same as 2b)' : ' (older label, same algorithm)'}`,
        },
        { label: 'Cost', value: `${parts.cost} (2^${parts.cost} = ${(2 ** parts.cost).toLocaleString()} rounds)` },
        { label: 'Salt (22 chars)', value: <span className="break-all">{parts.salt}</span> },
        { label: 'Hash (31 chars)', value: <span className="break-all">{parts.hash}</span> },
      ]}
    />
  );
}

function LengthNote({ password }: { password: string }) {
  if (!password) return null;
  const prepared = preparePassword(password);
  if (!prepared.truncated) {
    return (
      <span className="tabular-nums">
        {prepared.byteLength} of {MAX_PASSWORD_BYTES} bytes used
      </span>
    );
  }
  return (
    <span className="text-warning">
      {prepared.byteLength} bytes: bcrypt ignores everything after byte {MAX_PASSWORD_BYTES}.
    </span>
  );
}

export default function BcryptTool() {
  const [cost, setCost] = useToolState(TOOL, 'cost', DEFAULT_COST);
  const safeCost = clampCost(Number(cost) || DEFAULT_COST);
  const [password, setPassword] = useState('');
  const [hashResult, setHashResult] = useState<{ hash: string; ms: number } | null>(null);
  const [hashError, setHashError] = useState<string | null>(null);

  const [verifyPassword, setVerifyPassword] = useState('');
  const [verifyHash, setVerifyHash] = useState('');
  const [verifyResult, setVerifyResult] = useState<{ match: boolean; ms: number } | null>(null);
  const [verifyError, setVerifyError] = useState<string | null>(null);

  const [running, setRunning] = useState<null | { op: 'hash' | 'verify'; estimate: number }>(null);
  const elapsed = useElapsed(running !== null);
  // Measured time for cost 10 on this device, refined after each run.
  const [msAt10, setMsAt10] = useState<number | undefined>(undefined);
  const { exec, stop } = useBcryptWorker();

  const parsedVerify = useMemo(() => (verifyHash.trim() ? parseBcryptHash(verifyHash) : null), [verifyHash]);
  const parsedResult = useMemo(() => (hashResult ? parseBcryptHash(hashResult.hash) : null), [hashResult]);

  useEffect(() => setHashResult(null), [password, safeCost]);
  useEffect(() => setVerifyResult(null), [verifyPassword, verifyHash]);

  async function onHash() {
    if (!password || running) return;
    setHashError(null);
    setHashResult(null);
    setRunning({ op: 'hash', estimate: estimateMs(safeCost, msAt10) });
    try {
      const res = await exec({ op: 'hash', password, cost: safeCost });
      setHashResult({ hash: res.hash!, ms: res.ms });
      setMsAt10(res.ms / 2 ** (safeCost - 10));
    } catch (e) {
      if (!(e instanceof DOMException && e.name === 'AbortError')) setHashError(errorMessage(e, 'Hashing failed.'));
    } finally {
      setRunning(null);
    }
  }

  async function onVerify() {
    if (!verifyPassword || !parsedVerify?.ok || running) return;
    setVerifyError(null);
    setVerifyResult(null);
    const vCost = parsedVerify.value.cost;
    setRunning({ op: 'verify', estimate: estimateMs(vCost, msAt10) });
    try {
      const res = await exec({ op: 'verify', password: verifyPassword, hash: verifyHash.trim() });
      setVerifyResult({ match: Boolean(res.match), ms: res.ms });
      setMsAt10(res.ms / 2 ** (vCost - 10));
    } catch (e) {
      if (!(e instanceof DOMException && e.name === 'AbortError')) setVerifyError(errorMessage(e, 'Verification failed.'));
    } finally {
      setRunning(null);
    }
  }

  const progress = (op: 'hash' | 'verify') =>
    running?.op === op ? (
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line bg-surface-sunken px-3 py-2 text-[13px]">
        <Spinner label={op === 'hash' ? 'Hashing…' : 'Verifying…'} />
        <span className="flex items-center gap-2 text-fg-secondary">
          <ElapsedLabel ms={elapsed} estimate={running.estimate} />
          <Button size="sm" variant="ghost" onClick={stop}>
            Cancel
          </Button>
        </span>
      </div>
    ) : null;

  return (
    <ToolStack>
      <SplitPanes>
        <Panel title="Hash a password" description="New random 16-byte salt every time">
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              void onHash();
            }}
          >
            <Field label="Password" hint={<LengthNote password={password} />}>
              {({ id, describedBy }) => (
                <SecretInput
                  id={id}
                  value={password}
                  onChange={setPassword}
                  describedBy={describedBy}
                  placeholder="Password to hash"
                  autoComplete="new-password"
                />
              )}
            </Field>
            <Field
              label={
                <span className="flex items-center justify-between gap-2">
                  <span>Cost factor</span>
                  <span className="font-mono text-fg tabular-nums">{safeCost}</span>
                </span>
              }
              hint={`2^${safeCost} rounds · about ${formatDuration(estimateMs(safeCost, msAt10))} here${msAt10 ? '' : ' (estimate)'} · each +1 doubles the time`}
            >
              {({ id, describedBy }) => (
                <input
                  id={id}
                  type="range"
                  min={MIN_COST}
                  max={MAX_COST}
                  step={1}
                  value={safeCost}
                  aria-describedby={describedBy}
                  onChange={(e) => setCost(Number(e.target.value))}
                  className="w-full accent-[var(--lk-accent)]"
                />
              )}
            </Field>
            <Button type="submit" variant="primary" icon={KeyRound} disabled={!password || running !== null}>
              Generate hash
            </Button>
            {progress('hash')}
          </form>
          <ErrorMessage error={hashError} className="mt-4" />
          {hashResult && parsedResult?.ok && (
            <div className="mt-4 overflow-hidden rounded-lg border border-line">
              <DigestRow stacked label="bcrypt hash" value={hashResult.hash} />
              <div className="border-t border-line px-4 pb-1">
                <PartsList parts={parsedResult.value} />
              </div>
              <p className="border-t border-line px-4 py-2 text-[12.5px] text-fg-muted">
                Computed in {formatDuration(hashResult.ms)}
              </p>
            </div>
          )}
        </Panel>

        <Panel title="Verify a password" description="Check a password against a $2a$, $2b$ or $2y$ hash">
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              void onVerify();
            }}
          >
            <Field label="Password" hint={<LengthNote password={verifyPassword} />}>
              {({ id, describedBy }) => (
                <SecretInput
                  id={id}
                  value={verifyPassword}
                  onChange={setVerifyPassword}
                  describedBy={describedBy}
                  placeholder="Password to check"
                  autoComplete="off"
                />
              )}
            </Field>
            <Field label="bcrypt hash" error={parsedVerify && !parsedVerify.ok ? parsedVerify.error : null}>
              {({ id, describedBy, invalid }) => (
                <Input
                  id={id}
                  mono
                  value={verifyHash}
                  onChange={(e) => setVerifyHash(e.target.value)}
                  aria-describedby={describedBy}
                  aria-invalid={invalid || undefined}
                  placeholder="$2b$10$…"
                  spellCheck={false}
                  autoComplete="off"
                />
              )}
            </Field>
            {parsedVerify?.ok && parsedVerify.value.cost > MAX_COST && (
              <Alert tone="warning">Cost {parsedVerify.value.cost} is very slow; verifying may take minutes.</Alert>
            )}
            <Button
              type="submit"
              variant="primary"
              icon={ShieldCheck}
              disabled={!verifyPassword || !parsedVerify?.ok || running !== null}
            >
              Verify
            </Button>
            {progress('verify')}
          </form>
          <ErrorMessage error={verifyError} className="mt-4" />
          {verifyResult && (
            <div
              role="status"
              className={cn(
                'mt-4 flex items-start gap-3 rounded-lg px-4 py-3',
                verifyResult.match ? 'bg-success-soft' : 'bg-danger-soft',
              )}
            >
              {verifyResult.match ? (
                <CircleCheck size={22} className="mt-0.5 shrink-0 text-success" aria-hidden />
              ) : (
                <CircleX size={22} className="mt-0.5 shrink-0 text-danger" aria-hidden />
              )}
              <div>
                <p className={cn('text-[15px] font-semibold', verifyResult.match ? 'text-success' : 'text-danger')}>
                  {verifyResult.match ? 'Match' : 'No match'}
                </p>
                <p className="text-[13px] text-fg-secondary">
                  {verifyResult.match
                    ? 'The password is correct for this hash.'
                    : 'The password does not produce this hash.'}{' '}
                  Checked in {formatDuration(verifyResult.ms)}.
                </p>
              </div>
            </div>
          )}
          {parsedVerify?.ok && !verifyResult && (
            <div className="mt-4 rounded-lg border border-line px-4 pb-1">
              <PartsList parts={parsedVerify.value} />
            </div>
          )}
          {!verifyHash.trim() && !verifyResult && (
            <EmptyState icon={ShieldCheck} title="Paste a bcrypt hash" className="py-6">
              Its version, cost and salt are shown here.
            </EmptyState>
          )}
        </Panel>
      </SplitPanes>

      <Alert tone="info" title="About bcrypt">
        bcrypt is a deliberately slow password hash. Only the first {MAX_PASSWORD_BYTES} bytes of a password count (UTF-8, so
        fewer for accented or emoji characters). A cost of 10–12 is typical today; pick the highest your server can afford
        per login. Everything runs in a background worker on this device.
      </Alert>
    </ToolStack>
  );
}
