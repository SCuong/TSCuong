import { useEffect, useId, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { Eye, EyeOff, KeySquare, PenTool, RefreshCw } from 'lucide-react';
import { ToolBar, ToolStack } from '@/components/tool/EditorPanel';
import { Segmented } from '@/components/ui/Segmented';
import { Label, Select } from '@/components/ui/Field';
import { Button } from '@/components/ui/Button';
import { Alert, ErrorMessage } from '@/components/ui/Alert';
import { Badge, Panel } from '@/components/ui/Panel';
import { EmptyState, Spinner } from '@/components/ui/Feedback';
import { CopyButton, DownloadButton } from '@/components/ui/Actions';
import { useToolState } from '@/lib/hooks';
import { errorMessage, formatDuration } from '@/lib/utils';
import { DigestRow, ElapsedLabel, useElapsed } from '../shared-a/ui';
import { putHandoff } from '../shared-b/handoff';
import { DEFAULT_SPEC, generateKeyPairFor, planFor, supportsAlgorithm, type Curve, type GeneratedKeyPair, type HashName, type KeyFamily, type KeySpec, type RsaScheme, type RsaSize } from './lib/keygen';

const TOOL = 'key-pair-generator';

type PublicFormat = 'pem' | 'jwk' | 'jwks' | 'openssh';
type PrivateFormat = 'pem' | 'jwk';

const FAMILY_HELP: Record<KeyFamily, string> = {
  RSA: 'The most compatible choice: TLS, JWT (RS/PS), SSH, S/MIME. Slower and larger than elliptic curves.',
  ECDSA: 'Small, fast signing keys: TLS certificates, JWT (ES256/384/512), SSH.',
  ECDH: 'Key agreement (deriving a shared secret), e.g. for ECDH-ES encryption. Cannot sign.',
  Ed25519: 'Modern, fast signatures: SSH, JWT (EdDSA), code signing. Fixed size, no parameters to get wrong.',
  X25519: 'Modern key agreement (TLS 1.3, HPKE, age). Cannot sign.',
};

function pretty(value: unknown) {
  return JSON.stringify(value, null, 2);
}

export default function KeyPairGenerator() {
  const navigate = useNavigate();
  const [family, setFamily] = useToolState<KeyFamily>(TOOL, 'family', DEFAULT_SPEC.family);
  const [rsaSize, setRsaSize] = useToolState<RsaSize>(TOOL, 'rsaSize', DEFAULT_SPEC.rsaSize);
  const [rsaScheme, setRsaScheme] = useToolState<RsaScheme>(TOOL, 'rsaScheme', DEFAULT_SPEC.rsaScheme);
  const [hash, setHash] = useToolState<HashName>(TOOL, 'hash', DEFAULT_SPEC.hash);
  const [curve, setCurve] = useToolState<Curve>(TOOL, 'curve', DEFAULT_SPEC.curve);
  const [publicFormat, setPublicFormat] = useToolState<PublicFormat>(TOOL, 'publicFormat', 'pem');
  const [privateFormat, setPrivateFormat] = useToolState<PrivateFormat>(TOOL, 'privateFormat', 'pem');
  // Generated keys live only in memory.
  const [result, setResult] = useState<GeneratedKeyPair | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [support, setSupport] = useState<{ Ed25519: boolean | null; X25519: boolean | null }>({ Ed25519: null, X25519: null });
  const elapsed = useElapsed(running);
  const job = useRef(0);
  const schemeId = useId();

  useEffect(() => {
    let cancelled = false;
    void Promise.all([supportsAlgorithm('Ed25519'), supportsAlgorithm('X25519')]).then(([ed, x]) => {
      if (!cancelled) setSupport({ Ed25519: ed, X25519: x });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const spec: KeySpec = { family, rsaScheme, rsaSize, hash, curve };
  const plan = planFor(spec);
  const unsupported = (family === 'Ed25519' || family === 'X25519') && support[family] === false;
  const checking = (family === 'Ed25519' || family === 'X25519') && support[family] === null;

  async function generate() {
    const id = ++job.current;
    setRunning(true);
    setError(null);
    setRevealed(false);
    try {
      const pair = await generateKeyPairFor(spec);
      if (id === job.current) setResult(pair);
    } catch (e) {
      if (id === job.current) setError(errorMessage(e, 'This browser could not generate the key pair.'));
    } finally {
      if (id === job.current) setRunning(false);
    }
  }

  function openInJwtGenerator() {
    if (!result?.plan.jwsAlg) return;
    putHandoff('jwt-generator', { alg: result.plan.jwsAlg, privateKey: result.privatePem, publicKey: result.publicPem });
    navigate('/tools/jwt/generate');
  }

  const baseName = result ? `${result.plan.label.split(' · ')[0].toLowerCase().replace(/[^a-z0-9]+/g, '-')}` : 'key';
  const publicText = !result
    ? ''
    : publicFormat === 'pem'
      ? result.publicPem
      : publicFormat === 'jwk'
        ? pretty(result.publicJwk)
        : publicFormat === 'jwks'
          ? pretty({ keys: [result.publicJwk] })
          : (result.openssh ?? '');
  const privateText = !result ? '' : privateFormat === 'pem' ? result.privatePem : pretty(result.privateJwk);
  const publicFile =
    publicFormat === 'pem'
      ? `${baseName}-public.pem`
      : publicFormat === 'jwk'
        ? `${baseName}-public.jwk.json`
        : publicFormat === 'jwks'
          ? 'jwks.json'
          : `id_${baseName.replace(/-.*/, '')}.pub`;

  return (
    <ToolStack>
      <ToolBar>
        <div className="max-w-full">
          <Label>Key type</Label>
          <Segmented
            label="Key type"
            value={family}
            onChange={(f) => {
              setFamily(f);
              setResult(null);
            }}
            options={[
              { value: 'RSA', label: 'RSA' },
              { value: 'ECDSA', label: 'ECDSA' },
              { value: 'ECDH', label: 'ECDH' },
              { value: 'Ed25519', label: 'Ed25519' },
              { value: 'X25519', label: 'X25519' },
            ]}
          />
        </div>
        {family === 'RSA' && (
          <>
            <div>
              <Label>Size</Label>
              <Segmented<string>
                label="RSA key size"
                value={String(rsaSize)}
                onChange={(v) => setRsaSize(Number(v) as RsaSize)}
                options={[
                  { value: '2048', label: '2048' },
                  { value: '3072', label: '3072' },
                  { value: '4096', label: '4096' },
                ]}
              />
            </div>
            <div className="w-full sm:w-60">
              <Label htmlFor={schemeId}>Algorithm</Label>
              <Select id={schemeId} value={rsaScheme} onChange={(e) => setRsaScheme(e.target.value as RsaScheme)}>
                <option value="RSASSA-PKCS1-v1_5">RSASSA-PKCS1-v1_5 (signing, RS256)</option>
                <option value="RSA-PSS">RSA-PSS (signing, PS256)</option>
                <option value="RSA-OAEP">RSA-OAEP (encryption)</option>
              </Select>
            </div>
            <div>
              <Label>Hash</Label>
              <Segmented<HashName>
                label="Hash"
                value={hash}
                onChange={setHash}
                options={[
                  { value: 'SHA-256', label: 'SHA-256' },
                  { value: 'SHA-384', label: 'SHA-384' },
                  { value: 'SHA-512', label: 'SHA-512' },
                ]}
              />
            </div>
          </>
        )}
        {(family === 'ECDSA' || family === 'ECDH') && (
          <div>
            <Label>Curve</Label>
            <Segmented<Curve>
              label="Curve"
              value={curve}
              onChange={setCurve}
              options={[
                { value: 'P-256', label: 'P-256' },
                { value: 'P-384', label: 'P-384' },
                { value: 'P-521', label: 'P-521' },
              ]}
            />
          </div>
        )}
        <Button
          variant="primary"
          icon={result ? RefreshCw : KeySquare}
          onClick={() => void generate()}
          loading={running}
          disabled={unsupported || checking}
          className="sm:ml-auto"
        >
          {result ? 'Generate new' : 'Generate key pair'}
        </Button>
      </ToolBar>

      <p className="-mt-1 px-1 text-[13px] text-fg-secondary">
        <span className="font-medium text-fg">{plan.label}.</span> {FAMILY_HELP[family]}
      </p>

      {unsupported && (
        <Alert tone="warning" title={`This browser cannot generate ${family} keys`}>
          {family} in Web Crypto needs a recent browser (Chrome 137+, Edge 137+, Firefox 129+ or Safari 17+). Use{' '}
          {family === 'Ed25519' ? 'ECDSA P-256' : 'ECDH P-256'} instead, or update your browser.
        </Alert>
      )}

      {running && (
        <Panel>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Spinner label={`Generating ${plan.label}…`} />
            <span className="text-[13px] text-fg-secondary">
              <ElapsedLabel ms={elapsed} />
              {family === 'RSA' && rsaSize === 4096 && <span className="text-fg-muted"> · 4096-bit RSA can take several seconds</span>}
            </span>
          </div>
        </Panel>
      )}

      <ErrorMessage error={error} title="Key generation failed" />

      {!result && !running && !error && (
        <Panel>
          <EmptyState icon={KeySquare} title="Choose a key type and generate a key pair">
            Keys are generated with your browser’s Web Crypto API and exported as PEM, JWK and OpenSSH. Nothing is sent or
            saved.
          </EmptyState>
        </Panel>
      )}

      {result && !running && (
        <>
          <Panel
            title={result.plan.label}
            description={`Generated in ${formatDuration(result.ms)}`}
            actions={
              result.plan.jwsAlg ? (
                <Button size="sm" icon={PenTool} onClick={openInJwtGenerator}>
                  Sign a JWT ({result.plan.jwsAlg})
                </Button>
              ) : undefined
            }
            bodyClassName="p-0"
          >
            <div className="flex flex-wrap gap-1.5 px-4 py-2.5">
              <Badge tone="accent">{result.plan.use === 'sig' ? 'Signing' : 'Encryption / key agreement'}</Badge>
              {result.plan.jwkAlg && <Badge>JWK alg {result.plan.jwkAlg}</Badge>}
              <Badge>{result.plan.usages.join(', ')}</Badge>
            </div>
            <div className="divide-y divide-line border-t border-line">
              <DigestRow label="JWK thumbprint (kid)" value={result.thumbprint} />
              <DigestRow label="Public key pin (SHA-256)" value={result.spkiPin} />
            </div>
          </Panel>

          <Panel
            title="Public key"
            actions={
              <>
                <Segmented<PublicFormat>
                  label="Public key format"
                  size="sm"
                  value={publicFormat === 'openssh' && !result.openssh ? 'pem' : publicFormat}
                  onChange={setPublicFormat}
                  options={[
                    { value: 'pem', label: 'PEM' },
                    { value: 'jwk', label: 'JWK' },
                    { value: 'jwks', label: 'JWKS' },
                    ...(result.openssh ? [{ value: 'openssh' as const, label: 'OpenSSH' }] : []),
                  ]}
                />
                <CopyButton value={publicFormat === 'openssh' && !result.openssh ? result.publicPem : publicText} iconOnly label="Copy public key" />
                <DownloadButton
                  data={publicFormat === 'openssh' && !result.openssh ? result.publicPem : publicText}
                  filename={publicFormat === 'openssh' && !result.openssh ? `${baseName}-public.pem` : publicFile}
                  label="Save"
                  variant="ghost"
                />
              </>
            }
          >
            <KeyText text={publicFormat === 'openssh' && !result.openssh ? result.publicPem : publicText} label="Public key" />
            <p className="mt-2 text-[12.5px] text-fg-muted">
              {publicFormat === 'pem' || (publicFormat === 'openssh' && !result.openssh)
                ? 'SubjectPublicKeyInfo (SPKI), the standard “PUBLIC KEY” PEM.'
                : publicFormat === 'openssh'
                  ? 'One line for ~/.ssh/authorized_keys.'
                  : publicFormat === 'jwks'
                    ? 'A JWK Set, the format of /.well-known/jwks.json endpoints.'
                    : 'JSON Web Key with kid (RFC 7638 thumbprint), use and alg.'}
            </p>
          </Panel>

          <Panel
            title="Private key"
            actions={
              <>
                <Segmented<PrivateFormat>
                  label="Private key format"
                  size="sm"
                  value={privateFormat}
                  onChange={setPrivateFormat}
                  options={[
                    { value: 'pem', label: 'PEM' },
                    { value: 'jwk', label: 'JWK' },
                  ]}
                />
                <Button size="sm" variant="ghost" icon={revealed ? EyeOff : Eye} onClick={() => setRevealed((r) => !r)}>
                  {revealed ? 'Hide' : 'Show'}
                </Button>
                <CopyButton value={privateText} iconOnly label="Copy private key" />
                <DownloadButton
                  data={privateText}
                  filename={privateFormat === 'pem' ? `${baseName}-private.pem` : `${baseName}-private.jwk.json`}
                  label="Save"
                  variant="ghost"
                />
              </>
            }
          >
            {revealed ? (
              <KeyText text={privateText} label="Private key" />
            ) : (
              <p className="rounded-lg border border-dashed border-line-strong bg-surface-sunken px-3 py-6 text-center text-[13px] text-fg-muted">
                Hidden so it does not show up in screen shares. Copy or save it directly, or choose Show.
              </p>
            )}
            <p className="mt-2 text-[12.5px] text-fg-muted">
              {privateFormat === 'pem' ? 'Unencrypted PKCS#8 (“PRIVATE KEY”).' : 'Private JWK (includes the “d” member).'} Anyone with
              this key can sign or decrypt as you.
            </p>
          </Panel>

          <Alert tone="warning" title="For testing and development">
            Keys generated in a browser tab are fine for local development, tests and demos. For production, generate keys
            where they will live (an HSM, a cloud KMS, or OpenSSL / ssh-keygen on the server) so the private key never passes
            through a browser. These keys disappear when you leave the page.
          </Alert>
        </>
      )}
    </ToolStack>
  );
}

function KeyText({ text, label }: { text: string; label: string }) {
  return (
    <pre
      role="region"
      aria-label={label}
      tabIndex={0}
      className="max-h-80 overflow-auto rounded-lg border border-line bg-surface-sunken px-3 py-2.5 font-mono text-[12px] leading-relaxed whitespace-pre-wrap [overflow-wrap:anywhere] text-fg select-all"
    >
      {text}
    </pre>
  );
}
