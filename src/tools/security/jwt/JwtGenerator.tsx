import { useEffect, useId, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { Clock, Dices, KeyRound, ShieldCheck, TicketCheck, WandSparkles } from 'lucide-react';
import { EditorPanel, SplitPanes, ToolBar, ToolStack } from '@/components/tool/EditorPanel';
import { Field, Label, NumberInput, Select, Textarea } from '@/components/ui/Field';
import { Segmented } from '@/components/ui/Segmented';
import { Button } from '@/components/ui/Button';
import { Alert, ErrorMessage } from '@/components/ui/Alert';
import { Badge, Panel } from '@/components/ui/Panel';
import { EmptyState, Spinner } from '@/components/ui/Feedback';
import { CopyButton } from '@/components/ui/Actions';
import { toast } from '@/components/ui/Toast';
import { useDebouncedValue, useToolState } from '@/lib/hooks';
import { cn, errorMessage } from '@/lib/utils';
import { bytesToBase64Url, decodeInput, type KeyEncoding } from '../shared-a/bytes';
import { SecretInput } from '../shared-a/ui';
import { KeyFileButton } from '../shared-b/KeyFileButton';
import { clearHandoff, peekHandoff, putHandoff } from '../shared-b/handoff';
import { StatusBanner, useNow } from '../shared-b/ui';
import { SEGMENT_TEXT } from './components';
import { JWS_ALGORITHMS, jwsAlgorithm } from './lib/algorithms';
import { evaluateClaims } from './lib/claims';
import { parseKeyText } from './lib/keys';
import {
  derivePublicKeyPem,
  generateTestKeyPair,
  parseJsonObject,
  randomSecretBytes,
  setMember,
  signJwt,
  signingKeyProblem,
  type SignKey,
} from './lib/sign';

const TOOL = 'jwt-generator';
const KEY_FILE_ACCEPT = '.pem,.key,.der,.json,.jwk,.txt';
const FAMILIES: Array<{ label: string; family: string }> = [
  { label: 'HMAC (shared secret)', family: 'HMAC' },
  { label: 'RSA PKCS#1 v1.5', family: 'RSA' },
  { label: 'RSA-PSS', family: 'RSA-PSS' },
  { label: 'ECDSA', family: 'ECDSA' },
  { label: 'EdDSA', family: 'EdDSA' },
];
const ENCODINGS: Array<{ value: KeyEncoding; label: string }> = [
  { value: 'text', label: 'Text' },
  { value: 'base64', label: 'Base64' },
  { value: 'hex', label: 'Hex' },
];
type Unit = 'minutes' | 'hours' | 'days';
const UNIT_SECONDS: Record<Unit, number> = { minutes: 60, hours: 3600, days: 86400 };

const nowSeconds = () => Math.floor(Date.now() / 1000);

function defaultPayload(): string {
  const iat = nowSeconds();
  return JSON.stringify({ sub: '1234567890', name: 'Ada Lovelace', admin: true, iat, exp: iat + 3600 }, null, 2);
}

export default function JwtGenerator() {
  const navigate = useNavigate();
  const [handoff] = useState(() => peekHandoff('jwt-generator'));
  const [storedAlg, setAlg] = useToolState<string>(TOOL, 'alg', 'HS256');
  const alg = jwsAlgorithm(storedAlg) ? storedAlg : 'HS256';
  const [headerText, setHeaderText] = useState(() => JSON.stringify({ alg: handoff?.alg ?? alg, typ: 'JWT' }, null, 2));
  const [payloadText, setPayloadText] = useState(defaultPayload);
  // Secrets and keys are never persisted.
  const [secret, setSecret] = useState('');
  const [secretEncoding, setSecretEncoding] = useToolState<KeyEncoding>(TOOL, 'secretEncoding', 'text');
  const [keyText, setKeyText] = useState(handoff?.privateKey ?? '');
  const [knownPublic, setKnownPublic] = useState<{ privateKey: string; publicPem: string } | null>(
    handoff?.publicKey ? { privateKey: handoff.privateKey, publicPem: handoff.publicKey } : null,
  );
  const [expiresIn, setExpiresIn] = useToolState<number | ''>(TOOL, 'expiresIn', 60);
  const [expiresUnit, setExpiresUnit] = useToolState<Unit>(TOOL, 'expiresUnit', 'minutes');
  const [generating, setGenerating] = useState(false);
  const algId = useId();
  const expId = useId();

  useEffect(() => {
    if (handoff) setAlg(handoff.alg);
    clearHandoff('jwt-generator');
  }, [handoff, setAlg]);

  const info = jwsAlgorithm(alg)!;
  const hmac = info.family === 'HMAC';
  const header = useMemo(() => parseJsonObject(headerText, 'header'), [headerText]);
  const payload = useMemo(() => parseJsonObject(payloadText, 'payload'), [payloadText]);

  const secretBytes = useMemo(() => (hmac && secret ? decodeInput(secret, secretEncoding, 'The secret') : null), [hmac, secret, secretEncoding]);
  const parsedKey = useMemo(() => (hmac ? null : parseKeyText(keyText)), [hmac, keyText]);
  const keyProblem = parsedKey?.ok ? signingKeyProblem(parsedKey.material, info) : (parsedKey?.error ?? null);
  const signKey = useMemo<SignKey | null>(() => {
    if (hmac) return secretBytes?.ok && secretBytes.bytes.length > 0 ? { kind: 'secret', bytes: secretBytes.bytes } : null;
    return parsedKey?.ok && !keyProblem ? { kind: 'material', material: parsedKey.material } : null;
  }, [hmac, secretBytes, parsedKey, keyProblem]);

  const live = useMemo(
    () => ({ header: header.ok ? header.value : null, payload: payload.ok ? payload.value : null, alg, signKey }),
    [header, payload, alg, signKey],
  );
  const request = useDebouncedValue(live, 150);
  const [signed, setSigned] = useState<{ request: typeof request; token: string | null; error: string | null; publicPem: string | null } | null>(null);

  useEffect(() => {
    const { header: h, payload: p, alg: a, signKey: k } = request;
    if (!h || !p || !k) return;
    let stale = false;
    (async () => {
      try {
        const token = await signJwt(h, p, a, k);
        const publicPem = k.kind === 'material' ? await derivePublicKeyPem(k.material, a) : null;
        if (!stale) setSigned({ request, token, error: null, publicPem });
      } catch (e) {
        if (!stale) setSigned({ request, token: null, error: errorMessage(e, 'The token could not be signed.'), publicPem: null });
      }
    })();
    return () => {
      stale = true;
    };
  }, [request]);

  const current = signed && signed.request === live ? signed : null;
  const pending = !!live.header && !!live.payload && !!live.signKey && !current;
  const now = useNow(1000, payload.ok);
  const expiry = useMemo(() => (payload.ok ? evaluateClaims(payload.value, now / 1000).summary : null), [payload, now]);

  function changeAlg(next: string) {
    setAlg(next);
    const h = parseJsonObject(headerText, 'header');
    if (h.ok) setHeaderText(JSON.stringify({ ...h.value, alg: next }, null, 2));
    const nextInfo = jwsAlgorithm(next);
    if (nextInfo && nextInfo.family !== info.family) setKnownPublic(null);
  }

  function onHeaderChange(text: string) {
    setHeaderText(text);
    const h = parseJsonObject(text, 'header');
    if (h.ok && typeof h.value.alg === 'string' && h.value.alg !== alg && jwsAlgorithm(h.value.alg)) setAlg(h.value.alg);
  }

  function setClaim(key: string, value: unknown) {
    try {
      setPayloadText(setMember(payloadText, key, value));
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  }

  async function generateKeys() {
    setGenerating(true);
    try {
      const pair = await generateTestKeyPair(alg);
      setKeyText(pair.privatePem);
      setKnownPublic({ privateKey: pair.privatePem, publicPem: pair.publicPem });
    } catch (e) {
      toast(errorMessage(e, 'Could not generate a key pair in this browser.'), 'error');
    } finally {
      setGenerating(false);
    }
  }

  function generateSecret() {
    setSecret(bytesToBase64Url(randomSecretBytes(alg)));
    setSecretEncoding('base64');
  }

  const publicPem = current?.publicPem ?? (knownPublic && knownPublic.privateKey === keyText ? knownPublic.publicPem : null);

  function openInDecoder() {
    if (!current?.token) return;
    putHandoff('jwt-decoder', {
      token: current.token,
      secret: hmac ? { value: secret, encoding: secretEncoding } : undefined,
      publicKey: hmac ? undefined : (publicPem ?? undefined),
    });
    navigate('/tools/jwt');
  }

  const expSeconds = typeof expiresIn === 'number' && expiresIn > 0 ? Math.round(expiresIn * UNIT_SECONDS[expiresUnit]) : null;
  const inputError = !header.ok ? header.error : !payload.ok ? payload.error : null;

  return (
    <ToolStack>
      <ToolBar>
        <div className="w-full sm:w-72">
          <Label htmlFor={algId}>Algorithm</Label>
          <Select id={algId} value={alg} onChange={(e) => changeAlg(e.target.value)}>
            {FAMILIES.map((f) => (
              <optgroup key={f.family} label={f.label}>
                {JWS_ALGORITHMS.filter((a) => a.family === f.family && a.alg !== 'Ed25519').map((a) => (
                  <option key={a.alg} value={a.alg}>
                    {a.alg}
                  </option>
                ))}
              </optgroup>
            ))}
          </Select>
        </div>
        <p className="min-w-0 flex-1 basis-56 pb-2 text-[13px] text-fg-secondary">{info.description}</p>
      </ToolBar>

      <SplitPanes>
        <div className="flex min-w-0 flex-col gap-4">
          <EditorPanel
            title={<span className={SEGMENT_TEXT.header}>Header</span>}
            ariaLabel="Header JSON"
            value={headerText}
            onChange={onHeaderChange}
            language="json"
            height="130px"
            invalid={!header.ok}
          />
          <EditorPanel
            title={<span className={SEGMENT_TEXT.payload}>Payload (claims)</span>}
            ariaLabel="Payload JSON"
            value={payloadText}
            onChange={setPayloadText}
            language="json"
            height="260px"
            invalid={!payload.ok}
            footer={
              <div className="flex w-full flex-wrap items-center gap-x-2 gap-y-2 py-1">
                <Button size="sm" variant="secondary" icon={Clock} disabled={!payload.ok} onClick={() => setClaim('iat', nowSeconds())}>
                  iat = now
                </Button>
                <span className="inline-flex flex-wrap items-center gap-1.5">
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={!payload.ok || expSeconds === null}
                    onClick={() => expSeconds !== null && setClaim('exp', nowSeconds() + expSeconds)}
                  >
                    exp = now +
                  </Button>
                  <label htmlFor={expId} className="sr-only">
                    Expires in
                  </label>
                  <NumberInput id={expId} value={expiresIn} onChange={setExpiresIn} min={1} max={100000} className="h-8 w-20" />
                  <Select aria-label="Expiry unit" value={expiresUnit} onChange={(e) => setExpiresUnit(e.target.value as Unit)} className="h-8 w-auto">
                    <option value="minutes">minutes</option>
                    <option value="hours">hours</option>
                    <option value="days">days</option>
                  </Select>
                </span>
                <Button size="sm" variant="secondary" disabled={!payload.ok} onClick={() => setClaim('nbf', nowSeconds())}>
                  nbf = now
                </Button>
                <Button size="sm" variant="secondary" icon={Dices} disabled={!payload.ok} onClick={() => setClaim('jti', crypto.randomUUID())}>
                  jti
                </Button>
              </div>
            }
          />
          <ErrorMessage error={inputError} />
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          <Panel
            title={<span className={SEGMENT_TEXT.signature}>{hmac ? 'Secret' : 'Private key'}</span>}
            actions={
              hmac ? (
                <Button size="sm" variant="ghost" icon={WandSparkles} onClick={generateSecret}>
                  Random secret
                </Button>
              ) : (
                <Button size="sm" variant="ghost" icon={WandSparkles} loading={generating} onClick={() => void generateKeys()}>
                  Generate test key pair
                </Button>
              )
            }
          >
            {hmac ? (
              <Field
                label={
                  <span className="flex flex-wrap items-center justify-between gap-2">
                    <span>HMAC secret</span>
                    <Segmented label="Secret encoding" size="sm" value={secretEncoding} onChange={setSecretEncoding} options={ENCODINGS} />
                  </span>
                }
                hint={
                  secretBytes?.ok
                    ? secretBytes.bytes.length < (info.minSecretBytes ?? 32)
                      ? `${secretBytes.bytes.length} bytes; RFC 7518 requires at least ${info.minSecretBytes} bytes for ${alg}.`
                      : `${secretBytes.bytes.length} bytes. Never saved.`
                    : `At least ${info.minSecretBytes} bytes for ${alg}. Never saved.`
                }
                error={secretBytes && !secretBytes.ok ? secretBytes.error : null}
              >
                {({ id, describedBy, invalid }) => (
                  <SecretInput id={id} value={secret} onChange={setSecret} describedBy={describedBy} invalid={invalid} mono placeholder="Shared secret" />
                )}
              </Field>
            ) : (
              <PrivateKeyField keyText={keyText} onKeyText={setKeyText} parsed={parsedKey} problem={keyProblem} alg={alg} />
            )}
          </Panel>

          <Panel
            title="Signed token"
            actions={
              current?.token ? (
                <>
                  <CopyButton value={current.token} label="Copy token" />
                  <Button size="sm" variant="primary" icon={TicketCheck} onClick={openInDecoder}>
                    Verify in decoder
                  </Button>
                </>
              ) : undefined
            }
          >
            {current?.token ? (
              <div className="flex flex-col gap-3">
                <code className="block rounded-lg border border-line bg-surface-sunken px-3 py-2.5 font-mono text-[12.5px] leading-relaxed break-all select-all">
                  {current.token.split('.').map((part, i, all) => (
                    <span key={i}>
                      <span className={i === 0 ? SEGMENT_TEXT.header : i === 1 ? SEGMENT_TEXT.payload : SEGMENT_TEXT.signature}>{part}</span>
                      {i < all.length - 1 && <span className="font-bold text-fg">.</span>}
                    </span>
                  ))}
                </code>
                <p className="flex flex-wrap items-center gap-2 text-[12.5px] text-fg-muted">
                  <Badge>{alg}</Badge>
                  <span>{current.token.length.toLocaleString()} characters</span>
                </p>
                {expiry && (
                  <StatusBanner tone={expiry.tone} title={expiry.title} icon={Clock}>
                    Checked against this device’s clock.
                  </StatusBanner>
                )}
              </div>
            ) : pending ? (
              <Spinner label="Signing…" />
            ) : current?.error ? (
              <ErrorMessage error={current.error} title="Could not sign" />
            ) : (
              <EmptyState icon={KeyRound} title={hmac ? 'Enter a secret to sign' : 'Add a private key to sign'} className="py-6">
                {hmac
                  ? 'Type the shared secret, or create a random one.'
                  : 'Paste a PKCS#8, PKCS#1, SEC1 or JWK private key, or generate a test key pair.'}
              </EmptyState>
            )}
          </Panel>

          {!hmac && publicPem && current?.token && (
            <Panel title="Public key for verification" actions={<CopyButton value={publicPem} iconOnly label="Copy public key" />}>
              <pre
                role="region"
                aria-label="Public key PEM"
                tabIndex={0}
                className="max-h-44 overflow-auto rounded-lg border border-line bg-surface-sunken px-3 py-2 font-mono text-[12px] whitespace-pre-wrap [overflow-wrap:anywhere] text-fg-secondary"
              >
                {publicPem}
              </pre>
              <p className="mt-2 text-[12.5px] text-fg-muted">Share this with whoever verifies the token. The private key stays here.</p>
            </Panel>
          )}

          <Alert tone="info">
            For development and testing. Tokens are signed in your browser; secrets and keys are never sent anywhere or
            saved. Don’t reuse browser-made test keys in production.
          </Alert>
        </div>
      </SplitPanes>
    </ToolStack>
  );
}

function PrivateKeyField({
  keyText,
  onKeyText,
  parsed,
  problem,
  alg,
}: {
  keyText: string;
  onKeyText: (v: string) => void;
  parsed: ReturnType<typeof parseKeyText>;
  problem: string | null;
  alg: string;
}) {
  const hintId = useId();
  const id = useId();
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-end justify-between gap-2">
        <Label htmlFor={id} className="mb-0">
          Private key for {alg}
        </Label>
        <KeyFileButton accept={KEY_FILE_ACCEPT} onText={(text) => onKeyText(text)} label="Open key file" />
      </div>
      <Textarea
        id={id}
        value={keyText}
        onChange={(e) => onKeyText(e.target.value)}
        rows={8}
        aria-invalid={problem ? true : undefined}
        aria-describedby={hintId}
        placeholder={'-----BEGIN PRIVATE KEY-----\n…\n-----END PRIVATE KEY-----\n\nor a private JWK {"kty": …, "d": …}'}
        className="resize-y text-[12px]"
      />
      <div id={hintId} className="text-[12.5px]">
        {!keyText.trim() ? (
          <span className="text-fg-muted">PKCS#8, PKCS#1 (RSA), SEC1 (EC) PEM or a private JWK. Never saved.</span>
        ) : problem ? (
          <span role="alert" className="text-danger">
            {problem}
          </span>
        ) : parsed?.ok ? (
          <span className={cn('flex flex-wrap items-center gap-x-2 gap-y-1 text-fg-secondary')}>
            <ShieldCheck size={13} aria-hidden className="text-success" />
            {parsed.material.format === 'jwk' || parsed.material.format === 'pkcs8' ? `${parsed.material.info.label} private key` : 'Key'}
            {parsed.notes.map((n) => (
              <span key={n} className="text-fg-muted">
                {n}
              </span>
            ))}
          </span>
        ) : null}
      </div>
    </div>
  );
}
