import { useEffect, useMemo, useState } from 'react';
import { Eraser, FileBadge } from 'lucide-react';
import { EditorPanel, ToolStack } from '@/components/tool/EditorPanel';
import { Alert, ErrorMessage } from '@/components/ui/Alert';
import { Badge, Panel } from '@/components/ui/Panel';
import { Button } from '@/components/ui/Button';
import { EmptyState, Spinner } from '@/components/ui/Feedback';
import { FileDrop } from '@/components/ui/FileDrop';
import { toast } from '@/components/ui/Toast';
import { useDebouncedValue } from '@/lib/hooks';
import { errorMessage } from '@/lib/utils';
import { KeyFileButton } from '../shared-b/KeyFileButton';
import { readKeyFile } from '../shared-b/files';
import { inspectText, type InspectedItem, type Inspection } from './lib/inspect';
import { SAMPLE_CHAIN } from './lib/sample';
import { ChainPanel, CertificateCard, CrlCard, CsrCard, PrivateKeyCard, keyMatchText, PublicKeyCard } from './components';

const FILE_ACCEPT = '.pem,.crt,.cer,.der,.csr,.req,.key,.pub,.p7b,.p7c,.crl,.txt';

function kindLabel(item: InspectedItem): string {
  switch (item.kind) {
    case 'certificate':
      return 'Certificate';
    case 'csr':
      return 'CSR';
    case 'crl':
      return 'CRL';
    case 'public-key':
    case 'ssh-public-key':
      return 'Public key';
    case 'private-key':
      return 'Private key';
    default:
      return 'Item';
  }
}

function summary(result: Inspection): string {
  const counts = new Map<string, number>();
  for (const item of result.items) {
    if (item.kind === 'error' || item.kind === 'other') continue;
    const label = kindLabel(item).toLowerCase();
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  const plural: Record<string, string> = { certificate: 'certificates', csr: 'CSRs', crl: 'CRLs', 'public key': 'public keys', 'private key': 'private keys' };
  return [...counts.entries()].map(([label, n]) => `${n} ${n === 1 ? (label === 'csr' ? 'CSR' : label === 'crl' ? 'CRL' : label) : plural[label]}`).join(', ');
}

export default function CertificateInspector() {
  // Input may contain private keys: never persisted.
  const [text, setText] = useState('');
  const debounced = useDebouncedValue(text, 200);
  const [state, setState] = useState<{ input: string; result: Inspection | null; error: string | null } | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!debounced.trim()) return;
    inspectText(debounced)
      .then((result) => !cancelled && setState({ input: debounced, result, error: null }))
      .catch((e) => !cancelled && setState({ input: debounced, result: null, error: errorMessage(e, 'The input could not be inspected.') }));
    return () => {
      cancelled = true;
    };
  }, [debounced]);

  const current = state && state.input === text ? state : null;
  const busy = text.trim() !== '' && !current;
  const result = current?.result ?? null;

  const itemsById = useMemo(() => new Map((result?.items ?? []).map((i) => [i.id, i])), [result]);
  const labelOf = (id: number) => {
    const item = itemsById.get(id);
    return item ? `${kindLabel(item)} #${id}` : `#${id}`;
  };
  const matchesFor = (hash: string | null | undefined) => (hash ? result?.keyMatches.get(hash) : undefined);

  async function openFile(file: File) {
    try {
      const { text: content } = await readKeyFile(file);
      setText(content);
    } catch (e) {
      toast(errorMessage(e, 'Could not read the file.'), 'error');
    }
  }

  return (
    <ToolStack>
      <EditorPanel
        code
        title="PEM, certificate chain, CSR or key"
        ariaLabel="PEM or certificate text"
        value={text}
        onChange={setText}
        placeholder={'-----BEGIN CERTIFICATE-----\nMIIF…\n-----END CERTIFICATE-----'}
        height="220px"
        sample={SAMPLE_CHAIN}
        actions={<KeyFileButton accept={FILE_ACCEPT} onText={(content) => setText(content)} />}
        footer={
          <span>
            Parsed locally in your browser; nothing is uploaded or saved. Never paste private keys into websites: this tool
            recognises them but does not display them.
          </span>
        }
      />

      {!text.trim() && (
        <Panel>
          <EmptyState icon={FileBadge} title="Inspect certificates, chains, CSRs and keys">
            Paste PEM text above, or drop a .pem, .crt, .cer, .der, .csr or .key file below. You will see names, validity,
            SANs, key usage, fingerprints and whether a chain is complete.
          </EmptyState>
          <FileDrop
            accept={FILE_ACCEPT}
            onFiles={(files) => void openFile(files[0])}
            title="Drop a certificate or key file"
            hint="Binary DER files are converted to PEM. Files never leave your device."
            compact
            className="mt-2"
          />
        </Panel>
      )}

      {busy && (
        <Panel>
          <div className="flex justify-center py-8">
            <Spinner label="Inspecting…" />
          </div>
        </Panel>
      )}

      <ErrorMessage error={current?.error ?? null} />

      {result && (
        <>
          {result.containsPrivateKey && (
            <Alert
              tone="danger"
              title="This input contains a private key"
              action={
                <Button size="sm" icon={Eraser} onClick={() => setText('')}>
                  Clear
                </Button>
              }
            >
              Its contents are not shown and nothing leaves your browser, but avoid pasting private keys into websites:
              anyone who sees one can impersonate its owner. Clear the input when you are done.
            </Alert>
          )}
          {result.problems.length > 0 && (
            <Alert tone={result.items.length ? 'warning' : 'danger'} title={result.items.length ? 'Some input was skipped' : 'Nothing to inspect'}>
              <ul className="flex flex-col gap-1">
                {result.problems.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            </Alert>
          )}
          {result.items.length > 0 && summary(result) && (
            <p className="px-1 text-[13px] text-fg-secondary" role="status">
              Found {summary(result)}.
            </p>
          )}
          {result.chain && <ChainPanel chain={result.chain} items={itemsById} labelOf={labelOf} />}
          {result.items.map((item) => {
            const heading = `${kindLabel(item)} #${item.id}`;
            switch (item.kind) {
              case 'certificate':
                return (
                  <CertificateCard
                    key={item.id}
                    item={item}
                    cert={item.cert}
                    heading={`${heading} · ${item.cert.commonName ?? item.cert.subject}`}
                    matchNote={keyMatchText(matchesFor(item.cert.publicKey.spkiSha256Hex), item.id, labelOf)}
                  />
                );
              case 'csr':
                return (
                  <CsrCard
                    key={item.id}
                    item={item}
                    csr={item.csr}
                    heading={`${heading} · ${item.csr.subjectParts.find((p) => p.type === 'CN')?.value ?? item.csr.subject}`}
                    matchNote={keyMatchText(matchesFor(item.csr.publicKey.spkiSha256Hex), item.id, labelOf)}
                  />
                );
              case 'crl':
                return <CrlCard key={item.id} item={item} crl={item.crl} heading={heading} />;
              case 'public-key':
                return (
                  <PublicKeyCard
                    key={item.id}
                    item={item}
                    format={item.format}
                    pk={item.key}
                    heading={`${heading} · ${item.key.info.label}`}
                    matchNote={keyMatchText(matchesFor(item.key.spkiSha256Hex), item.id, labelOf)}
                  />
                );
              case 'ssh-public-key':
                return (
                  <Panel key={item.id} title={`${heading} · ${item.key.label}`} description={item.source}>
                    <div className="flex flex-col gap-2 text-[13px]">
                      <span className="flex flex-wrap gap-1.5">
                        <Badge tone="accent">OpenSSH public key</Badge>
                        <Badge>{item.key.type}</Badge>
                      </span>
                      {item.key.comment && <p className="text-fg-secondary">Comment: {item.key.comment}</p>}
                      <p className="font-mono text-[12.5px] break-all text-fg">{item.key.fingerprint}</p>
                      <p className="text-[12.5px] text-fg-muted">The fingerprint matches what ssh-keygen -l shows.</p>
                    </div>
                  </Panel>
                );
              case 'private-key':
                return (
                  <PrivateKeyCard
                    key={item.id}
                    item={item}
                    pk={item.key}
                    heading={`${heading}${item.key.info ? ` · ${item.key.info.label}` : ''}`}
                    matchNote={keyMatchText(matchesFor(item.key.spkiSha256Hex), item.id, labelOf)}
                  />
                );
              case 'other':
                return (
                  <Alert key={item.id} tone="info" title={item.title}>
                    {item.message}
                  </Alert>
                );
              case 'error':
                return <ErrorMessage key={item.id} title={`${item.source} could not be read`} error={item.error} />;
            }
          })}
        </>
      )}
    </ToolStack>
  );
}
