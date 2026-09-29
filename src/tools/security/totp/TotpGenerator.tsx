import { useEffect, useId, useMemo, useState } from 'react';
import { CircleCheck, CircleX, QrCode, Timer, WandSparkles } from 'lucide-react';
import { SplitPanes, ToolBar, ToolStack } from '@/components/tool/EditorPanel';
import { Field, Input, Label, NumberInput } from '@/components/ui/Field';
import { Segmented } from '@/components/ui/Segmented';
import { Button } from '@/components/ui/Button';
import { Alert } from '@/components/ui/Alert';
import { Panel } from '@/components/ui/Panel';
import { EmptyState } from '@/components/ui/Feedback';
import { CopyButton, DownloadButton } from '@/components/ui/Actions';
import { useObjectUrl, useToolState } from '@/lib/hooks';
import { cn, errorMessage } from '@/lib/utils';
import { SecretInput } from '../shared-a/ui';
import { useNow } from '../shared-b/ui';
import { decodeBase32, encodeBase32, groupSecret } from './lib/base32';
import { counterAt, hotp, secondsRemaining, verifyTotp, type OtpAlgorithm } from './lib/otp';
import { buildOtpauthUri, parseOtpauthUri } from './lib/otpauth';
import { qrSvg as qrSvgFor } from './lib/qr';

const TOOL = 'totp-generator';

function formatCode(code: string): string {
  const half = Math.floor(code.length / 2);
  return `${code.slice(0, half)} ${code.slice(half)}`;
}

export default function TotpGenerator() {
  // The secret is never persisted.
  const [secret, setSecret] = useState('');
  const [algorithm, setAlgorithm] = useToolState<OtpAlgorithm>(TOOL, 'algorithm', 'SHA-1');
  const [digits, setDigits] = useToolState<number>(TOOL, 'digits', 6);
  const [periodInput, setPeriodInput] = useToolState<number | ''>(TOOL, 'period', 30);
  const [issuer, setIssuer] = useState('LocalKit Test');
  const [account, setAccount] = useState('you@example.com');
  const [code, setCode] = useState('');
  const [imported, setImported] = useState<string | null>(null);
  const periodId = useId();

  const period = typeof periodInput === 'number' && periodInput >= 5 && periodInput <= 300 ? Math.round(periodInput) : 30;
  const periodError = typeof periodInput === 'number' && (periodInput < 5 || periodInput > 300) ? 'Use 5 to 300 seconds.' : null;
  const decoded = useMemo(() => (secret.trim() ? decodeBase32(secret) : null), [secret]);
  const bytes = decoded?.ok && decoded.bytes.length > 0 ? decoded.bytes : null;
  const weak = bytes !== null && bytes.length < 16;

  const now = useNow(250, bytes !== null);
  const nowSeconds = now / 1000;
  const counter = counterAt(nowSeconds, period);
  const remaining = secondsRemaining(nowSeconds, period);

  const [codes, setCodes] = useState<{ key: string; current: string; next: string } | null>(null);
  const codeKey = bytes ? `${decoded && decoded.ok ? decoded.normalized : ''}|${algorithm}|${digits}|${period}|${counter}` : '';
  useEffect(() => {
    if (!bytes) return;
    let stale = false;
    Promise.all([hotp(bytes, counter, digits, algorithm), hotp(bytes, counter + 1, digits, algorithm)])
      .then(([current, next]) => !stale && setCodes({ key: codeKey, current, next }))
      .catch(() => !stale && setCodes(null));
    return () => {
      stale = true;
    };
  }, [bytes, counter, digits, algorithm, codeKey]);
  const live = codes && codes.key === codeKey ? codes : null;

  const [verdict, setVerdict] = useState<{ key: string; offset: number | null } | null>(null);
  const cleanCode = code.replace(/\s+/g, '');
  const verifyKey = bytes && cleanCode ? `${codeKey}|${cleanCode}` : '';
  useEffect(() => {
    if (!bytes || !cleanCode) return;
    let stale = false;
    verifyTotp(bytes, cleanCode, counter * period + 1, { algorithm, digits, period }, 1)
      .then((offset) => !stale && setVerdict({ key: verifyKey, offset }))
      .catch(() => !stale && setVerdict({ key: verifyKey, offset: null }));
    return () => {
      stale = true;
    };
  }, [bytes, cleanCode, counter, period, algorithm, digits, verifyKey]);
  const result = verdict && verdict.key === verifyKey ? verdict : null;

  const uri = decoded?.ok ? buildOtpauthUri({ type: 'totp', issuer, account, secret: decoded.normalized, algorithm, digits, period }) : '';
  const [qr, setQr] = useState<{ uri: string; svg: string; error: string | null } | null>(null);
  useEffect(() => {
    if (!uri) return;
    let cancelled = false;
    qrSvgFor(uri)
      .then((svg) => !cancelled && setQr({ uri, svg, error: null }))
      .catch((e) => {
        if (cancelled) return;
        const message = errorMessage(e, 'The QR code could not be created.');
        setQr({
          uri,
          svg: '',
          error: /dynamically imported module|module script failed|error loading/i.test(message)
            ? 'The QR library could not be loaded. Reload the page to try again.'
            : message,
        });
      });
    return () => {
      cancelled = true;
    };
  }, [uri]);
  const qrSvg = qr && qr.uri === uri ? qr.svg : '';
  const qrError = qr && qr.uri === uri ? qr.error : null;
  const qrBlob = useMemo(() => (qrSvg ? new Blob([qrSvg], { type: 'image/svg+xml' }) : null), [qrSvg]);
  const qrUrl = useObjectUrl(qrBlob);

  function onSecretChange(value: string) {
    if (/^\s*otpauth:\/\//i.test(value)) {
      const parsed = parseOtpauthUri(value);
      if (parsed.ok) {
        const v = parsed.value;
        setSecret(groupSecret(v.secret));
        setAlgorithm(v.algorithm);
        setDigits(v.digits);
        setPeriodInput(v.period);
        if (v.issuer) setIssuer(v.issuer);
        if (v.account) setAccount(v.account);
        setImported(v.type === 'hotp' ? 'Imported an HOTP URI; codes below use time steps (TOTP), not its counter.' : 'Imported the secret and settings from the otpauth:// URI.');
        return;
      }
      setImported(null);
      setSecret(value);
      return;
    }
    setImported(null);
    setSecret(value);
  }

  function randomSecret() {
    const raw = new Uint8Array(20);
    crypto.getRandomValues(raw);
    setSecret(groupSecret(encodeBase32(raw)));
    setImported(null);
  }

  const uriError = secret.trim() && /^\s*otpauth:\/\//i.test(secret) ? parseOtpauthUri(secret) : null;
  const secretError = uriError && !uriError.ok ? uriError.error : decoded && !decoded.ok ? decoded.error : null;
  const progress = remaining / period;

  return (
    <ToolStack>
      <ToolBar>
        <div>
          <Label>Algorithm</Label>
          <Segmented<OtpAlgorithm>
            label="Algorithm"
            value={algorithm}
            onChange={setAlgorithm}
            options={[
              { value: 'SHA-1', label: 'SHA-1', title: 'What almost every authenticator app uses' },
              { value: 'SHA-256', label: 'SHA-256' },
              { value: 'SHA-512', label: 'SHA-512' },
            ]}
          />
        </div>
        <div>
          <Label>Digits</Label>
          <Segmented<string>
            label="Digits"
            value={String(digits)}
            onChange={(v) => setDigits(Number(v))}
            options={[
              { value: '6', label: '6' },
              { value: '7', label: '7' },
              { value: '8', label: '8' },
            ]}
          />
        </div>
        <div className="w-28">
          <Label htmlFor={periodId}>Period (s)</Label>
          <NumberInput id={periodId} value={periodInput} onChange={setPeriodInput} min={5} max={300} aria-invalid={periodError ? true : undefined} />
        </div>
        {periodError && <p className="pb-2 text-[12.5px] text-danger">{periodError}</p>}
      </ToolBar>

      <SplitPanes>
        <div className="flex min-w-0 flex-col gap-4">
          <Panel
            title="Secret"
            actions={
              <Button size="sm" variant="ghost" icon={WandSparkles} onClick={randomSecret}>
                Random secret
              </Button>
            }
          >
            <Field
              label="Base32 secret or otpauth:// URI"
              hint={
                imported ??
                (bytes
                  ? `${bytes.length} bytes (${bytes.length * 8} bits). Never saved.`
                  : 'The key shown as text under the QR code during 2FA setup, e.g. JBSW Y3DP EHPK 3PXP. Never saved.')
              }
              error={secretError}
            >
              {({ id, describedBy, invalid }) => (
                <SecretInput id={id} value={secret} onChange={onSecretChange} describedBy={describedBy} invalid={invalid} mono placeholder="JBSW Y3DP EHPK 3PXP" />
              )}
            </Field>
            {weak && (
              <p className="mt-2 text-[12.5px] text-warning">
                Secrets shorter than 16 bytes (128 bits) are below the RFC 4226 minimum; 20 bytes is typical.
              </p>
            )}
          </Panel>

          <Panel title="Current code" bodyClassName="flex flex-col gap-4">
            {bytes && live ? (
              <>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="font-mono text-[40px] leading-none font-semibold tracking-[0.08em] text-fg tabular-nums" aria-live="polite">
                    {formatCode(live.current)}
                  </p>
                  <CopyButton value={live.current} label="Copy code" />
                </div>
                <div>
                  <div className="mb-1.5 flex justify-between text-[12.5px] text-fg-muted">
                    <span className={cn(remaining <= 5 && 'text-warning')}>Changes in {Math.ceil(remaining)} s</span>
                    <span className="tabular-nums">Next: {formatCode(live.next)}</span>
                  </div>
                  <div
                    className="h-1.5 overflow-hidden rounded-full bg-surface-hover"
                    role="progressbar"
                    aria-label="Time left for this code"
                    aria-valuemin={0}
                    aria-valuemax={period}
                    aria-valuenow={Math.ceil(remaining)}
                  >
                    <div className={cn('h-full rounded-full', remaining <= 5 ? 'bg-warning' : 'bg-accent')} style={{ width: `${progress * 100}%` }} />
                  </div>
                </div>
                <p className="text-[12.5px] text-fg-muted">
                  Time step {counter.toLocaleString()} · {algorithm} · {digits} digits · {period} s. Codes match authenticator apps
                  when this device’s clock is correct.
                </p>
              </>
            ) : (
              <EmptyState icon={Timer} title="Enter a secret to see live codes" className="py-6">
                Paste the Base32 key or an otpauth:// link from a 2FA setup screen, or create a random secret to test your own
                implementation.
              </EmptyState>
            )}
          </Panel>

          <Panel title="Check a code">
            <Field label="Code from an app or your server" hint="Accepted within one time step before or after now, like most servers.">
              {({ id, describedBy }) => (
                <Input
                  id={id}
                  aria-describedby={describedBy}
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  mono
                  placeholder={'0'.repeat(digits)}
                  disabled={!bytes}
                  className="max-w-56 text-[16px] tracking-[0.1em]"
                />
              )}
            </Field>
            {bytes && cleanCode && result && (
              <p role="status" className={cn('mt-3 flex items-start gap-2 text-[13px] font-medium', result.offset === null ? 'text-danger' : 'text-success')}>
                {result.offset === null ? <CircleX size={16} className="mt-px shrink-0" aria-hidden /> : <CircleCheck size={16} className="mt-px shrink-0" aria-hidden />}
                {result.offset === null
                  ? !/^\d+$/.test(cleanCode) || cleanCode.length !== digits
                    ? `Enter the ${digits}-digit code.`
                    : 'Not valid now, or within one step either side. Check the secret, the settings and the clock.'
                  : result.offset === 0
                    ? 'Valid: it matches the current time step.'
                    : result.offset < 0
                      ? `Valid for the previous time step (${period} s ago). Accepted, but the clocks may drift.`
                      : `Valid for the next time step. The other clock is ahead of this one.`}
              </p>
            )}
          </Panel>
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          <Panel title="Authenticator setup (otpauth:// URI)" bodyClassName="flex flex-col gap-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Issuer">{({ id }) => <Input id={id} value={issuer} onChange={(e) => setIssuer(e.target.value)} placeholder="Your app" />}</Field>
              <Field label="Account">{({ id }) => <Input id={id} value={account} onChange={(e) => setAccount(e.target.value)} placeholder="user@example.com" />}</Field>
            </div>
            {uri ? (
              <>
                <div className="flex flex-col items-center gap-3 sm:flex-row sm:items-start">
                  <div className="shrink-0 overflow-hidden rounded-lg border border-line">
                    {qrUrl ? (
                      <img src={qrUrl} alt="QR code for the otpauth URI" width={176} height={176} className="size-44" />
                    ) : (
                      <div className="flex size-44 flex-col items-center justify-center gap-2 p-3 text-center text-[12px] text-fg-muted">
                        <QrCode size={20} aria-hidden />
                        {qrError && <span role="alert" className="break-words">{qrError}</span>}
                      </div>
                    )}
                  </div>
                  <div className="flex min-w-0 flex-1 flex-col gap-2">
                    <code className="block rounded-lg border border-line bg-surface-sunken px-3 py-2 font-mono text-[12px] break-all text-fg-secondary">{uri}</code>
                    <div className="flex flex-wrap gap-2">
                      <CopyButton value={uri} label="Copy URI" />
                      <DownloadButton data={qrSvg} filename="totp-qr.svg" type="image/svg+xml" label="QR (SVG)" disabled={!qrSvg} />
                    </div>
                  </div>
                </div>
                <Alert tone="warning">
                  The URI and QR code contain the secret: anyone who scans them can generate the codes. Use them with test
                  accounts, and never share them.
                </Alert>
              </>
            ) : (
              <p className="text-[13px] text-fg-muted">Enter a valid secret to build the setup link and QR code.</p>
            )}
          </Panel>
          <Alert tone="info">
            Codes are computed in your browser with Web Crypto HMAC (RFC 6238 / RFC 4226). Nothing is sent anywhere and the
            secret is not saved. Handy for testing a 2FA implementation.
          </Alert>
        </div>
      </SplitPanes>
    </ToolStack>
  );
}
