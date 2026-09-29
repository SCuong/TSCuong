import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { Clock, FlaskConical, KeyRound, LockKeyhole, PenTool, ShieldAlert, ShieldCheck, TicketCheck } from 'lucide-react';
import { EditorPanel, SplitPanes, ToolStack } from '@/components/tool/EditorPanel';
import { Badge, Panel } from '@/components/ui/Panel';
import { Field, Label, Textarea } from '@/components/ui/Field';
import { Segmented } from '@/components/ui/Segmented';
import { Alert, ErrorMessage } from '@/components/ui/Alert';
import { EmptyState, Spinner } from '@/components/ui/Feedback';
import { Button, IconButton } from '@/components/ui/Button';
import { CopyButton } from '@/components/ui/Actions';
import { useDebouncedValue, useToolState } from '@/lib/hooks';
import { errorMessage } from '@/lib/utils';
import { decodeInput, type KeyEncoding } from '../shared-a/bytes';
import { SecretInput } from '../shared-a/ui';
import { IssueList, JsonView, LegendDot, StatusBanner, useNow, type StatusTone } from '../shared-b/ui';
import { KeyFileButton } from '../shared-b/KeyFileButton';
import { clearHandoff, peekHandoff } from '../shared-b/handoff';
import { prettyJson } from '../shared-b/jsonTokens';
import { ClaimsList, DetailToggle, HeaderParams, SEGMENT_TEXT, SegmentLegend, JWT_EDITOR_EXTENSIONS, type DetailView } from './components';
import { decodeToken, type DecodedJwe, type DecodedJws } from './lib/decode';
import { evaluateClaims } from './lib/claims';
import { JWE_ENCRYPTION, describeAlgorithm, jwsAlgorithm } from './lib/algorithms';
import { parseKeyText } from './lib/keys';
import { verifyJws, type VerifyKey, type VerifyOutcome } from './lib/verify';
import { SAMPLE_SECRET, SAMPLE_TOKEN } from './lib/sample';

const TOOL = 'jwt-decoder';
const KEY_FILE_ACCEPT = '.pem,.crt,.cer,.der,.pub,.key,.json,.jwk,.jwks,.txt';

const ENCODINGS: Array<{ value: KeyEncoding; label: string }> = [
  { value: 'text', label: 'Text' },
  { value: 'base64', label: 'Base64' },
  { value: 'hex', label: 'Hex' },
];

const OUTCOME_TONE: Record<VerifyOutcome['status'], StatusTone> = { verified: 'success', invalid: 'danger', error: 'warning' };

export default function JwtDecoder() {
  const [initial] = useState(() => peekHandoff('jwt-decoder'));
  const [token, setToken] = useState(initial?.token ?? '');
  const [secret, setSecret] = useState(initial?.secret?.value ?? '');
  const [secretEncoding, setSecretEncoding] = useToolState<KeyEncoding>(TOOL, 'secretEncoding', 'text');
  const [keyText, setKeyText] = useState(initial?.publicKey ?? '');
  const [view, setView] = useToolState<DetailView>(TOOL, 'view', 'explained');

  useEffect(() => {
    if (initial?.secret) setSecretEncoding(initial.secret.encoding);
    clearHandoff('jwt-decoder');
  }, [initial, setSecretEncoding]);

  const debouncedToken = useDebouncedValue(token, 120);
  const result = useMemo(() => decodeToken(debouncedToken), [debouncedToken]);
  const decoded = result?.ok ? result.value : null;
  const jws = decoded?.kind === 'jws' ? decoded : null;
  const claims = jws?.payload.kind === 'claims' ? jws.payload.claims : null;
  const now = useNow(1000, claims !== null);
  const report = useMemo(() => (claims ? evaluateClaims(claims, now / 1000) : null), [claims, now]);

  function loadSample() {
    setToken(SAMPLE_TOKEN);
    setSecret(SAMPLE_SECRET);
    setSecretEncoding('text');
  }

  const segments = result ? (result.ok ? result.value.segments : result.segments) : [];
  const notes = result ? (result.ok ? result.value.notes : result.notes) : [];

  return (
    <ToolStack>
      <SplitPanes>
        <div className="flex min-w-0 flex-col gap-4">
          <EditorPanel
            title="Encoded token"
            ariaLabel="JWT to decode"
            value={token}
            onChange={setToken}
            placeholder="Paste a JWT (eyJhbGciOi…), an Authorization header or a token response"
            extensions={JWT_EDITOR_EXTENSIONS}
            height="200px"
            actions={<IconButton icon={FlaskConical} label="Load sample" size="sm" onClick={loadSample} />}
            invalid={result !== null && !result.ok}
            footer={
              segments.length > 0 ? (
                <SegmentLegend segments={segments} />
              ) : (
                <span>Tokens and secrets stay on this device and are never saved.</span>
              )
            }
          />
          {notes.length > 0 && (
            <p className="-mt-2 px-1 text-[12.5px] text-fg-muted" role="status">
              {notes.join(' ')}
            </p>
          )}
          {result && !result.ok && <ErrorMessage error={result.error} title="This token cannot be decoded" />}
          <VerifyPanel
            decoded={decoded}
            secret={secret}
            onSecret={setSecret}
            secretEncoding={secretEncoding}
            onSecretEncoding={setSecretEncoding}
            keyText={keyText}
            onKeyText={setKeyText}
          />
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          {!result && (
            <Panel>
              <EmptyState
                icon={TicketCheck}
                title="Paste a JSON Web Token"
                action={
                  <Button size="sm" onClick={loadSample}>
                    Load a sample token
                  </Button>
                }
              >
                See its header and claims explained, check expiry, and verify the signature with a secret, public key,
                certificate or JWKS. Decoding happens entirely in your browser.
              </EmptyState>
            </Panel>
          )}
          {result && !result.ok && (
            <Panel>
              <EmptyState icon={ShieldAlert} title="Nothing to show yet">
                Fix the problem described on the left and the header and claims appear here.
              </EmptyState>
            </Panel>
          )}
          {jws && <JwsDetails jws={jws} report={report} view={view} onView={setView} />}
          {decoded?.kind === 'jwe' && <JweDetails jwe={decoded} view={view} onView={setView} />}
        </div>
      </SplitPanes>
    </ToolStack>
  );
}

function Summary({ decoded, children }: { decoded: DecodedJws | DecodedJwe; children?: ReactNode }) {
  const typ = typeof decoded.header.typ === 'string' ? decoded.header.typ : null;
  const kid = typeof decoded.header.kid === 'string' ? decoded.header.kid : null;
  const isJwt = decoded.kind === 'jws' && decoded.payload.kind === 'claims';
  return (
    <Panel bodyClassName="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge tone="accent">
          {decoded.kind === 'jwe'
            ? 'JWE · encrypted'
            : decoded.alg?.toLowerCase() === 'none'
              ? `${isJwt ? 'JWT' : 'JWS'} · unsecured`
              : isJwt
                ? 'JWT · signed (JWS)'
                : 'JWS'}
        </Badge>
        {decoded.alg && (
          <Badge tone={decoded.alg.toLowerCase() === 'none' ? 'danger' : 'neutral'}>
            <span className="font-mono">{decoded.alg}</span>
          </Badge>
        )}
        {decoded.kind === 'jwe' && decoded.enc && (
          <Badge>
            <span className="font-mono">{decoded.enc}</span>
          </Badge>
        )}
        {typ && <Badge>typ {typ}</Badge>}
        {kid && (
          <Badge className="max-w-full">
            <span className="truncate">kid {kid}</span>
          </Badge>
        )}
        <span className="text-[12.5px] text-fg-muted tabular-nums">{decoded.token.length.toLocaleString()} characters</span>
      </div>
      {decoded.alg && describeAlgorithm(decoded.alg) && (
        <p className="text-[13px] text-fg-secondary">{describeAlgorithm(decoded.alg)}</p>
      )}
      {children}
    </Panel>
  );
}

function JwsDetails({
  jws,
  report,
  view,
  onView,
}: {
  jws: DecodedJws;
  report: ReturnType<typeof evaluateClaims> | null;
  view: DetailView;
  onView: (v: DetailView) => void;
}) {
  const issues = [...jws.issues, ...(report?.issues ?? [])];
  const order = { danger: 0, warning: 1, info: 2 } as const;
  issues.sort((a, b) => order[a.level] - order[b.level]);
  const payloadJson =
    jws.payload.kind === 'claims' || jws.payload.kind === 'json'
      ? prettyJson(jws.payload.kind === 'claims' ? jws.payload.claims : jws.payload.value)
      : jws.payload.kind === 'text'
        ? jws.payload.text
        : '';

  return (
    <>
      <Summary decoded={jws}>
        {report && (
          <StatusBanner tone={report.summary.tone} title={report.summary.title} icon={Clock}>
            {report.summary.detail && <span className="font-mono text-[12.5px]">{report.summary.detail}</span>}
            {report.lifetime && <span className="block">Lifetime from iat to exp: {report.lifetime}.</span>}
          </StatusBanner>
        )}
      </Summary>

      {issues.length > 0 && (
        <Panel title="Findings">
          <IssueList issues={issues} />
        </Panel>
      )}

      <Panel
        title={
          <span className="inline-flex items-center gap-2">
            <LegendDot className={SEGMENT_TEXT.header}>Header</LegendDot>
          </span>
        }
        actions={
          <>
            <DetailToggle label="Header view" value={view} onChange={onView} />
            <CopyButton value={prettyJson(jws.header)} iconOnly label="Copy header JSON" />
          </>
        }
      >
        {view === 'json' ? <JsonView value={jws.header} /> : <HeaderParams header={jws.header} />}
      </Panel>

      <Panel
        title={<LegendDot className={SEGMENT_TEXT.payload}>{jws.payload.kind === 'claims' ? 'Payload (claims)' : 'Payload'}</LegendDot>}
        actions={
          <>
            {jws.payload.kind === 'claims' && <DetailToggle label="Payload view" value={view} onChange={onView} />}
            <CopyButton value={payloadJson} iconOnly label="Copy payload" />
          </>
        }
      >
        {jws.payload.kind === 'claims' && report ? (
          view === 'json' ? (
            <JsonView value={jws.payload.claims} />
          ) : (
            <ClaimsList report={report} />
          )
        ) : jws.payload.kind === 'json' ? (
          <JsonView value={jws.payload.value} />
        ) : jws.payload.kind === 'text' ? (
          <pre
            role="region"
            aria-label="Payload text"
            tabIndex={0}
            className="max-h-80 overflow-auto rounded-lg border border-line bg-surface-sunken px-3 py-2.5 font-mono text-[12.5px] whitespace-pre-wrap [overflow-wrap:anywhere]"
          >
            {jws.payload.text}
          </pre>
        ) : jws.payload.kind === 'binary' ? (
          <p className="text-[13px] text-fg-secondary">
            {jws.payload.bytes.length.toLocaleString()} bytes of binary data (not shown).
          </p>
        ) : (
          <p className="text-[13px] text-fg-secondary">The payload is detached (not included in the token).</p>
        )}
      </Panel>
    </>
  );
}

function JweDetails({ jwe, view, onView }: { jwe: DecodedJwe; view: DetailView; onView: (v: DetailView) => void }) {
  return (
    <>
      <Summary decoded={jwe}>
        <StatusBanner tone="neutral" icon={LockKeyhole} title="Encrypted token (JWE)">
          The claims are encrypted{jwe.enc && JWE_ENCRYPTION[jwe.enc] ? ` with ${JWE_ENCRYPTION[jwe.enc]}` : ''}. Only the
          holder of the decryption key can read them, so only the protected header is shown. LocalKit does not decrypt
          JWEs.
        </StatusBanner>
      </Summary>
      {jwe.issues.length > 0 && (
        <Panel title="Findings">
          <IssueList issues={jwe.issues} />
        </Panel>
      )}
      <Panel
        title={<LegendDot className={SEGMENT_TEXT.header}>Protected header</LegendDot>}
        actions={
          <>
            <DetailToggle label="Header view" value={view} onChange={onView} />
            <CopyButton value={prettyJson(jwe.header)} iconOnly label="Copy header JSON" />
          </>
        }
      >
        {view === 'json' ? <JsonView value={jwe.header} /> : <HeaderParams header={jwe.header} />}
      </Panel>
      <Panel title="Encrypted parts">
        <ul className="flex flex-col gap-2 text-[13px]">
          {jwe.segments.slice(1).map((s) => (
            <li key={s.name} className="flex flex-wrap items-center justify-between gap-x-3">
              <LegendDot className={SEGMENT_TEXT[s.name]}>
                {s.name === 'encryptedKey' ? 'Encrypted key' : s.name === 'iv' ? 'Initialization vector' : s.name === 'ciphertext' ? 'Ciphertext' : 'Authentication tag'}
              </LegendDot>
              <span className="text-fg-muted tabular-nums">
                {s.byteLength === 0 ? 'empty' : `${(s.byteLength ?? 0).toLocaleString()} bytes`}
              </span>
            </li>
          ))}
        </ul>
      </Panel>
    </>
  );
}

function VerifyPanel({
  decoded,
  secret,
  onSecret,
  secretEncoding,
  onSecretEncoding,
  keyText,
  onKeyText,
}: {
  decoded: DecodedJws | DecodedJwe | null;
  secret: string;
  onSecret: (v: string) => void;
  secretEncoding: KeyEncoding;
  onSecretEncoding: (v: KeyEncoding) => void;
  keyText: string;
  onKeyText: (v: string) => void;
}) {
  const jws = decoded?.kind === 'jws' ? decoded : null;
  const alg = jwsAlgorithm(jws?.alg);
  const hmac = alg?.family === 'HMAC';
  const secretBytes = useMemo(
    () => (hmac && secret ? decodeInput(secret, secretEncoding, 'The secret') : null),
    [hmac, secret, secretEncoding],
  );
  const parsedKey = useMemo(() => (alg && !hmac ? parseKeyText(keyText) : null), [alg, hmac, keyText]);
  const verifyKey = useMemo<VerifyKey | null>(() => {
    if (hmac) return secretBytes?.ok ? { kind: 'secret', bytes: secretBytes.bytes } : null;
    return parsedKey?.ok ? { kind: 'material', material: parsedKey.material } : null;
  }, [hmac, secretBytes, parsedKey]);

  const live = useMemo(() => ({ jws, verifyKey }), [jws, verifyKey]);
  const request = useDebouncedValue(live, 150);
  const [outcome, setOutcome] = useState<{ request: typeof request; result: VerifyOutcome } | null>(null);

  useEffect(() => {
    if (!request.jws || !request.verifyKey) return;
    let stale = false;
    verifyJws(request.jws, request.verifyKey)
      .then((result) => !stale && setOutcome({ request, result }))
      .catch((e) => !stale && setOutcome({ request, result: { status: 'error', title: 'Could not verify', detail: errorMessage(e), notes: [] } }));
    return () => {
      stale = true;
    };
  }, [request]);

  const current = outcome && outcome.request === live ? outcome.result : null;
  const pending = live.jws !== null && live.verifyKey !== null && !current;

  let body: ReactNode;
  if (!decoded) {
    body = (
      <p className="text-[13px] text-fg-muted">
        Paste a token first. HS256/384/512 tokens are checked with the shared secret; RS, PS, ES and EdDSA tokens with the
        issuer’s public key, certificate or JWK Set.
      </p>
    );
  } else if (decoded.kind === 'jwe') {
    body = (
      <p className="text-[13px] text-fg-secondary">
        An encrypted token’s integrity is protected by its authentication tag, which can only be checked while decrypting
        it with the recipient’s key.
      </p>
    );
  } else if (!alg) {
    body = (
      <StatusBanner tone={decoded.alg?.toLowerCase() === 'none' ? 'danger' : 'warning'} title="Cannot verify this token">
        {decoded.alg?.toLowerCase() === 'none'
          ? 'It is unsecured (alg “none”): there is no signature. Any server that accepts it can be fooled by a forged token.'
          : decoded.alg
            ? `“${decoded.alg}” is not a supported signature algorithm.`
            : 'The header does not name its algorithm.'}
      </StatusBanner>
    );
  } else {
    body = (
      <div className="flex flex-col gap-4">
        {hmac ? (
          <Field
            label={
              <span className="flex flex-wrap items-center justify-between gap-2">
                <span>Secret</span>
                <Segmented label="Secret encoding" size="sm" value={secretEncoding} onChange={onSecretEncoding} options={ENCODINGS} />
              </span>
            }
            hint={
              secretBytes?.ok
                ? `${secretBytes.bytes.length} byte${secretBytes.bytes.length === 1 ? '' : 's'}. The secret is never saved.`
                : 'The HMAC secret shared by the issuer and the API. It is never saved.'
            }
            error={secretBytes && !secretBytes.ok ? secretBytes.error : null}
          >
            {({ id, describedBy, invalid }) => (
              <SecretInput
                id={id}
                value={secret}
                onChange={onSecret}
                describedBy={describedBy}
                invalid={invalid}
                mono
                placeholder={secretEncoding === 'text' ? 'your-256-bit-secret' : secretEncoding === 'hex' ? 'e.g. 3f1a…' : 'e.g. c2VjcmV0…'}
              />
            )}
          </Field>
        ) : (
          <KeyField keyText={keyText} onKeyText={onKeyText} parsed={parsedKey} algLabel={alg.alg} />
        )}
        {pending && <Spinner label="Verifying…" />}
        {current && (
          <StatusBanner
            tone={OUTCOME_TONE[current.status]}
            title={current.title}
            icon={current.status === 'verified' ? ShieldCheck : undefined}
          >
            {current.detail}
          </StatusBanner>
        )}
        {current && current.notes.length > 0 && (
          <IssueList issues={current.notes.map((message) => ({ level: /RFC 7518|brute/.test(message) ? 'warning' : 'info', message }))} />
        )}
        {!current && !pending && (
          <p className="text-[12.5px] text-fg-muted">
            {hmac ? 'Enter the secret to check the signature.' : 'Paste the public key to check the signature.'} The result
            covers the signature only; expiry is checked separately above.
          </p>
        )}
      </div>
    );
  }

  return (
    <Panel
      title={
        <span className="inline-flex items-center gap-2">
          <LegendDot className={SEGMENT_TEXT.signature}>Verify signature</LegendDot>
          {alg && <span className="font-mono text-[12px] font-normal text-fg-muted">{alg.alg}</span>}
        </span>
      }
      actions={
        <Link
          to="/tools/jwt/generate"
          className="inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-[12.5px] font-medium text-accent-text hover:bg-accent-soft"
        >
          <PenTool size={13} aria-hidden />
          Create a token
        </Link>
      }
    >
      {body}
    </Panel>
  );
}

function KeyField({
  keyText,
  onKeyText,
  parsed,
  algLabel,
}: {
  keyText: string;
  onKeyText: (v: string) => void;
  parsed: ReturnType<typeof parseKeyText>;
  algLabel: string;
}) {
  const isPrivate =
    parsed?.ok &&
    ((parsed.material.format === 'pkcs8') || (parsed.material.format === 'jwk' && parsed.material.isPrivate));
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-end justify-between gap-2">
        <Label htmlFor="jwt-verify-key" className="mb-0">
          Public key, certificate or JWKS
        </Label>
        <KeyFileButton accept={KEY_FILE_ACCEPT} onText={(text) => onKeyText(text)} label="Open key file" />
      </div>
      <Textarea
        id="jwt-verify-key"
        value={keyText}
        onChange={(e) => onKeyText(e.target.value)}
        rows={7}
        aria-invalid={(parsed && !parsed.ok) || undefined}
        aria-describedby="jwt-verify-key-hint"
        placeholder={`-----BEGIN PUBLIC KEY-----\n…\n-----END PUBLIC KEY-----\n\nor a certificate, or {"kty": …} / {"keys": [ … ]}`}
        className="resize-y text-[12px]"
      />
      <div id="jwt-verify-key-hint" className="text-[12.5px]">
        {parsed === null ? (
          <span className="text-fg-muted">PEM (SPKI or PKCS#1), X.509 certificate, JWK or JWK Set for {algLabel}. Never saved.</span>
        ) : parsed.ok ? (
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-fg-secondary">
            <KeyRound size={13} aria-hidden className="text-fg-muted" />
            {parsed.material.format === 'jwks'
              ? `JWK Set with ${parsed.material.keys.length} key${parsed.material.keys.length === 1 ? '' : 's'}`
              : `${parsed.material.info.label} ${
                  parsed.material.format === 'certificate'
                    ? 'certificate'
                    : parsed.material.format === 'spki'
                      ? 'public key'
                      : parsed.material.format === 'pkcs8'
                        ? 'private key'
                        : parsed.material.isPrivate
                          ? 'private JWK'
                          : 'JWK'
                }`}
            {parsed.notes.map((n) => (
              <span key={n} className="text-fg-muted">
                {n}
              </span>
            ))}
          </span>
        ) : (
          <span role="alert" className="text-danger">
            {parsed.error}
          </span>
        )}
      </div>
      {isPrivate && (
        <Alert tone="warning">
          This is a private key. Only the public key is needed to verify; avoid pasting private keys into websites. This one
          stays in your browser and is not saved.
        </Alert>
      )}
    </div>
  );
}
