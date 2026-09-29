import type { ReactNode } from 'react';
import { ArrowDown, CircleCheck, CircleHelp, CircleX, KeyRound, Link2 } from 'lucide-react';
import { Badge, KeyValueList, Panel } from '@/components/ui/Panel';
import { Alert } from '@/components/ui/Alert';
import { CopyButton, DownloadButton } from '@/components/ui/Actions';
import { DigestRow } from '../shared-a/ui';
import { formatLocalDateTime } from '../shared-b/time';
import type {
  CertificateSummary,
  ChainReport,
  CrlSummary,
  CsrSummary,
  InspectedItem,
  NamePart,
  PrivateKeySummary,
  PublicKeySummary,
  SignatureAlgorithm,
  Validity,
} from './lib/inspect';

type Tone = 'success' | 'warning' | 'danger' | 'neutral' | 'accent';

export function validityBadge(v: Validity): { tone: Tone; text: string } {
  if (v.status === 'expired') {
    const days = -v.daysLeft;
    return { tone: 'danger', text: days <= 1 ? 'Expired' : `Expired ${days.toLocaleString()} days ago` };
  }
  if (v.status === 'not-yet-valid') return { tone: 'warning', text: 'Not yet valid' };
  if (v.daysLeft < 30) return { tone: 'warning', text: v.daysLeft <= 0 ? 'Expires today' : `${v.daysLeft} day${v.daysLeft === 1 ? '' : 's'} left` };
  return { tone: 'success', text: `Valid · ${v.daysLeft.toLocaleString()} days left` };
}

export function certRole(cert: CertificateSummary): string {
  if (cert.selfIssued && cert.isCA) return 'Root CA';
  if (cert.selfIssued) return 'Self-signed';
  if (cert.isCA) return 'Intermediate CA';
  return 'Leaf';
}

function Chips({ items, tone = 'neutral' }: { items: ReactNode[]; tone?: Tone }) {
  return (
    <span className="flex flex-wrap gap-1">
      {items.map((item, i) => (
        <Badge key={i} tone={tone} className="font-sans whitespace-normal [overflow-wrap:anywhere]">
          {item}
        </Badge>
      ))}
    </span>
  );
}

function NameList({ parts, fallback }: { parts: NamePart[]; fallback: string }) {
  if (parts.length === 0) return <span className="break-all">{fallback || '(empty)'}</span>;
  return (
    <span className="flex flex-col gap-0.5">
      {parts.map((p, i) => (
        <span key={i} className="break-words">
          <span className="text-fg-muted">{p.type}=</span>
          {p.value}
        </span>
      ))}
    </span>
  );
}

function Signature({ sig }: { sig: SignatureAlgorithm }) {
  return (
    <span className="flex flex-col gap-1">
      <span>
        {sig.name} <span className="text-fg-muted">({sig.oid})</span>
      </span>
      {sig.weak && <span className="font-sans text-[12.5px] text-warning">{sig.weak}</span>}
    </span>
  );
}

function KeyLine({ pk }: { pk: PublicKeySummary }) {
  return (
    <span className="flex flex-col gap-1">
      <span>{pk.info.label}</span>
      {pk.weak && <span className="font-sans text-[12.5px] text-warning">{pk.weak}</span>}
    </span>
  );
}

function ValidityLine({ v }: { v: Validity }) {
  const badge = validityBadge(v);
  return (
    <span className="flex flex-col gap-1 font-sans">
      <span className="font-mono text-[12.5px]">
        {formatLocalDateTime(v.notBefore.getTime())} → {formatLocalDateTime(v.notAfter.getTime())}
      </span>
      <span className="flex flex-wrap items-center gap-2 text-[12.5px] text-fg-muted">
        <Badge tone={badge.tone}>{badge.text}</Badge>
        <span>Lifetime {v.lifetimeDays.toLocaleString()} days</span>
      </span>
    </span>
  );
}

function Urls({ urls }: { urls: string[] }) {
  return (
    <span className="flex flex-col gap-0.5">
      {urls.map((u) => (
        <span key={u} className="break-all">
          {u}
        </span>
      ))}
    </span>
  );
}

/** "Same key pair as Private key #3" text, or null when nothing else shares the key. */
export function keyMatchText(ids: number[] | undefined, self: number, labelOf: (id: number) => string): string | null {
  const others = (ids ?? []).filter((id) => id !== self);
  return others.length ? `Same key pair as ${others.map(labelOf).join(', ')}` : null;
}

function MatchNote({ text }: { text: string | null | undefined }) {
  if (!text) return null;
  return (
    <p className="flex items-center gap-1.5 border-b border-line px-4 py-2 text-[12.5px] text-success">
      <Link2 size={13} aria-hidden />
      {text}
    </p>
  );
}

export function CertificateCard({
  item,
  cert,
  heading,
  matchNote,
}: {
  item: InspectedItem;
  cert: CertificateSummary;
  heading: string;
  matchNote?: string | null;
}) {
  const badge = validityBadge(cert.validity);
  const rows: Array<{ label: ReactNode; value: ReactNode; key?: string }> = [
    { label: 'Subject', value: <NameList parts={cert.subjectParts} fallback={cert.subject} /> },
    { label: 'Issuer', value: <NameList parts={cert.issuerParts} fallback={cert.issuer} /> },
    { label: 'Validity', value: <ValidityLine v={cert.validity} /> },
    { label: 'Serial number', value: <span className="break-all">{cert.serial}</span> },
    { label: 'Signature algorithm', value: <Signature sig={cert.signature} /> },
    { label: 'Public key', value: <KeyLine pk={cert.publicKey} /> },
  ];
  if (cert.subjectAltNames.length) {
    rows.push({
      label: 'Subject alternative names',
      value: <Chips items={cert.subjectAltNames.map((n) => <span key={n.value}><span className="font-semibold">{n.type}</span> {n.value}</span>)} />,
    });
  }
  if (cert.keyUsage.length) {
    rows.push({ label: `Key usage${cert.keyUsageCritical ? ' (critical)' : ''}`, value: <Chips items={cert.keyUsage} /> });
  }
  if (cert.extendedKeyUsage.length) {
    rows.push({ label: 'Extended key usage', value: <Chips items={cert.extendedKeyUsage.map((e) => e.name)} /> });
  }
  if (cert.basicConstraints) {
    const bc = cert.basicConstraints;
    rows.push({
      label: `Basic constraints${bc.critical ? ' (critical)' : ''}`,
      value: bc.ca ? `CA: yes${bc.pathLength !== undefined ? `, path length ${bc.pathLength}` : ', no path length limit'}` : 'CA: no (end entity)',
    });
  }
  if (cert.subjectKeyId) rows.push({ label: 'Subject key ID', value: <span className="break-all">{cert.subjectKeyId}</span> });
  if (cert.authorityKeyId) rows.push({ label: 'Authority key ID', value: <span className="break-all">{cert.authorityKeyId}</span> });
  if (cert.ocsp.length) rows.push({ label: 'OCSP responder', value: <Urls urls={cert.ocsp} /> });
  if (cert.caIssuers.length) rows.push({ label: 'CA issuer URL', value: <Urls urls={cert.caIssuers} /> });
  if (cert.crlDistributionPoints.length) rows.push({ label: 'CRL distribution', value: <Urls urls={cert.crlDistributionPoints} /> });
  if (cert.policies.length) {
    rows.push({ label: 'Policies', value: <Chips items={cert.policies.map((p) => (p.name ? `${p.name} · ${p.oid}` : p.oid))} /> });
  }
  if (cert.otherExtensions.length) {
    rows.push({
      label: 'Other extensions',
      value: (
        <span className="flex flex-col gap-0.5">
          {cert.otherExtensions.map((e) => (
            <span key={e.oid}>
              {e.name ?? 'Unknown'} <span className="text-fg-muted">({e.oid}{e.critical ? ', critical' : ''})</span>
            </span>
          ))}
        </span>
      ),
    });
  }
  rows.push({ label: 'Version', value: `v${cert.version}` });

  return (
    <Panel
      title={
        <span className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="truncate">{heading}</span>
        </span>
      }
      description={item.source}
      actions={
        <>
          <CopyButton value={cert.pem} label="Copy PEM" />
          <DownloadButton data={cert.pem} filename={`${(cert.commonName ?? 'certificate').replace(/[^\w.-]+/g, '_')}.crt`} type="application/x-pem-file" label=".crt" />
        </>
      }
      bodyClassName="p-0"
    >
      <div className="flex flex-wrap items-center gap-1.5 border-b border-line px-4 py-2.5">
        <Badge tone="accent">{certRole(cert)}</Badge>
        <Badge tone={badge.tone}>{badge.text}</Badge>
        {cert.selfSigned === false && cert.selfIssued && <Badge tone="danger">Self-signature invalid</Badge>}
        {cert.signature.weak && <Badge tone="warning">Weak signature</Badge>}
        {cert.publicKey.weak && <Badge tone="warning">Weak key</Badge>}
      </div>
      <MatchNote text={matchNote} />
      <div className="px-4">
        <KeyValueList items={rows} />
      </div>
      <div className="divide-y divide-line border-t border-line">
        <DigestRow label="SHA-256 fingerprint" value={cert.fingerprints.sha256} />
        <DigestRow label="SHA-1 fingerprint" value={cert.fingerprints.sha1} />
        <DigestRow label="Public key pin (SHA-256)" value={cert.publicKey.pinSha256} />
      </div>
    </Panel>
  );
}

export function CsrCard({ item, csr, heading, matchNote }: { item: InspectedItem; csr: CsrSummary; heading: string; matchNote?: string | null }) {
  const rows: Array<{ label: ReactNode; value: ReactNode }> = [
    { label: 'Subject', value: <NameList parts={csr.subjectParts} fallback={csr.subject} /> },
    {
      label: 'Signature',
      value: (
        <span className="flex flex-col gap-1">
          <Signature sig={csr.signature} />
          {csr.signatureValid === true && <span className="font-sans text-[12.5px] text-success">Self-signature is valid: the requester holds the private key.</span>}
          {csr.signatureValid === false && <span className="font-sans text-[12.5px] text-danger">Self-signature does not verify: the request was altered or is corrupt.</span>}
          {csr.signatureValid === null && <span className="font-sans text-[12.5px] text-fg-muted">This browser could not check the signature.</span>}
        </span>
      ),
    },
    { label: 'Public key', value: <KeyLine pk={csr.publicKey} /> },
  ];
  if (csr.subjectAltNames.length) {
    rows.push({ label: 'Requested names (SAN)', value: <Chips items={csr.subjectAltNames.map((n) => `${n.type} ${n.value}`)} /> });
  }
  if (csr.extensions.length) {
    rows.push({ label: 'Other requested extensions', value: <Chips items={csr.extensions.map((e) => e.name ?? e.oid)} /> });
  }
  if (csr.hasChallengePassword) rows.push({ label: 'Challenge password', value: 'Present (not shown)' });
  return (
    <Panel title={heading} description={item.source} bodyClassName="p-0">
      <div className="flex flex-wrap items-center gap-1.5 border-b border-line px-4 py-2.5">
        <Badge tone="accent">Certificate signing request</Badge>
        {csr.signatureValid === true && <Badge tone="success">Signature valid</Badge>}
        {csr.signatureValid === false && <Badge tone="danger">Signature invalid</Badge>}
      </div>
      <MatchNote text={matchNote} />
      <div className="px-4">
        <KeyValueList items={rows} />
      </div>
      <div className="border-t border-line">
        <DigestRow label="Public key pin (SHA-256)" value={csr.publicKey.pinSha256} />
      </div>
    </Panel>
  );
}

export function CrlCard({ item, crl, heading }: { item: InspectedItem; crl: CrlSummary; heading: string }) {
  return (
    <Panel title={heading} description={item.source} bodyClassName="p-0">
      <div className="flex flex-wrap items-center gap-1.5 border-b border-line px-4 py-2.5">
        <Badge tone="accent">Certificate revocation list</Badge>
        {crl.stale ? <Badge tone="warning">Past its next update</Badge> : <Badge tone="success">Current</Badge>}
      </div>
      <div className="px-4">
        <KeyValueList
          items={[
            { label: 'Issuer', value: <span className="break-all">{crl.issuer}</span> },
            { label: 'This update', value: formatLocalDateTime(crl.thisUpdate.getTime()) },
            { label: 'Next update', value: crl.nextUpdate ? formatLocalDateTime(crl.nextUpdate.getTime()) : 'Not specified' },
            { label: 'Signature algorithm', value: <Signature sig={crl.signature} /> },
            { label: 'Revoked certificates', value: crl.revokedCount.toLocaleString() },
          ]}
        />
      </div>
      {crl.revoked.length > 0 && (
        <div className="overflow-x-auto border-t border-line px-4 py-2" role="region" aria-label="Revoked certificates" tabIndex={0}>
          <table className="w-full min-w-[480px] text-left text-[12.5px]">
            <thead>
              <tr className="text-fg-muted">
                <th className="py-1.5 pr-3 font-medium">Serial</th>
                <th className="py-1.5 pr-3 font-medium">Revoked</th>
                <th className="py-1.5 font-medium">Reason</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line font-mono">
              {crl.revoked.map((r) => (
                <tr key={r.serial}>
                  <td className="py-1.5 pr-3 break-all">{r.serial}</td>
                  <td className="py-1.5 pr-3">{r.date ? r.date.toISOString().slice(0, 10) : '—'}</td>
                  <td className="py-1.5 font-sans">{r.reason ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {crl.revokedCount > crl.revoked.length && (
            <p className="py-1.5 text-[12.5px] text-fg-muted">Showing the first {crl.revoked.length} of {crl.revokedCount.toLocaleString()}.</p>
          )}
        </div>
      )}
    </Panel>
  );
}

export function PublicKeyCard({
  item,
  format,
  pk,
  heading,
  matchNote,
}: {
  item: InspectedItem;
  format: string;
  pk: PublicKeySummary;
  heading: string;
  matchNote?: string | null;
}) {
  return (
    <Panel title={heading} description={item.source} bodyClassName="p-0">
      <div className="flex flex-wrap items-center gap-1.5 border-b border-line px-4 py-2.5">
        <Badge tone="accent">Public key</Badge>
        <Badge>{format}</Badge>
        {pk.weak && <Badge tone="warning">Weak key</Badge>}
      </div>
      <MatchNote text={matchNote} />
      <div className="px-4">
        <KeyValueList items={[{ label: 'Algorithm', value: <KeyLine pk={pk} /> }]} />
      </div>
      <div className="divide-y divide-line border-t border-line">
        <DigestRow label="Public key pin (SHA-256)" value={pk.pinSha256} />
        <DigestRow label="SPKI SHA-256 (hex)" value={pk.spkiSha256Hex} />
      </div>
    </Panel>
  );
}

export function PrivateKeyCard({
  item,
  pk,
  heading,
  matchNote,
}: {
  item: InspectedItem;
  pk: PrivateKeySummary;
  heading: string;
  matchNote?: string | null;
}) {
  const rows: Array<{ label: ReactNode; value: ReactNode }> = [{ label: 'Format', value: pk.format }];
  if (pk.info) rows.push({ label: 'Algorithm', value: pk.info.label });
  if (pk.note) rows.push({ label: 'Key type', value: pk.note });
  if (pk.encrypted) rows.push({ label: 'Protection', value: `Encrypted with a passphrase${pk.encryption ? ` (${pk.encryption})` : ''}` });
  else rows.push({ label: 'Protection', value: 'Not encrypted' });
  if (pk.sshFingerprint) rows.push({ label: 'Public key fingerprint', value: <span className="break-all">{pk.sshFingerprint}</span> });
  return (
    <Panel title={heading} description={item.source} bodyClassName="p-0">
      <div className="flex flex-wrap items-center gap-1.5 border-b border-line px-4 py-2.5">
        <Badge tone="danger">
          <KeyRound size={12} aria-hidden /> Private key
        </Badge>
        {pk.encrypted ? <Badge tone="success">Passphrase protected</Badge> : <Badge tone="warning">Unencrypted</Badge>}
      </div>
      <MatchNote text={matchNote} />
      <div className="px-4">
        <KeyValueList items={rows} mono={false} />
      </div>
      <p className="border-t border-line px-4 py-2.5 text-[12.5px] text-fg-muted">
        The key material is not displayed. Only its type{pk.spkiSha256Hex ? ' and matching public key' : ''} were read.
      </p>
    </Panel>
  );
}

function LinkStatus({ valid }: { valid: boolean | null }) {
  if (valid === true) return <CircleCheck size={15} className="text-success" aria-label="Signature verified" />;
  if (valid === false) return <CircleX size={15} className="text-danger" aria-label="Signature does not verify" />;
  return <CircleHelp size={15} className="text-fg-muted" aria-label="Signature not checked" />;
}

export function ChainPanel({
  chain,
  items,
  labelOf,
}: {
  chain: ChainReport;
  items: Map<number, InspectedItem>;
  labelOf: (id: number) => string;
}) {
  const notes: Array<{ tone: 'info' | 'warning' | 'danger'; text: string }> = [];
  if (!chain.inOrder) {
    notes.push({ tone: 'warning', text: 'The certificates are not in chain order. Servers should send the leaf first, then each issuer in turn.' });
  }
  if (chain.missingIssuer) {
    notes.push({
      tone: 'warning',
      text: `The chain stops before its root: the issuer “${chain.missingIssuer}” is not included. That is fine if clients already trust it; otherwise an intermediate is missing.`,
    });
  } else if (chain.endsWithRoot && chain.itemOrder.length > 1) {
    notes.push({ tone: 'info', text: 'The chain includes its self-signed root. Servers usually leave the root out because clients already have it.' });
  }
  for (const id of chain.unrelated) notes.push({ tone: 'warning', text: `${labelOf(id)} is not part of this chain.` });
  for (const link of chain.links) {
    if (link.signatureValid === false) {
      notes.push({ tone: 'danger', text: `${labelOf(link.child)} was not signed by ${labelOf(link.parent)}, although the names match.` });
    }
  }

  return (
    <Panel title="Certificate chain" description="Leaf first, then each issuer">
      <ol className="flex flex-col">
        {chain.itemOrder.map((id, i) => {
          const item = items.get(id);
          const cert = item?.kind === 'certificate' ? item.cert : null;
          const link = chain.links[i];
          return (
            <li key={id} className="flex flex-col">
              <div className="flex min-w-0 items-center gap-3 rounded-lg border border-line bg-surface-sunken px-3 py-2">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13.5px] font-medium text-fg">{cert?.commonName ?? cert?.subject ?? labelOf(id)}</span>
                  <span className="block text-[12px] text-fg-muted">
                    {labelOf(id)}
                    {cert ? ` · ${certRole(cert)} · ${cert.publicKey.info.label}` : ''}
                  </span>
                </span>
                {cert && <Badge tone={validityBadge(cert.validity).tone}>{validityBadge(cert.validity).text}</Badge>}
              </div>
              {link && (
                <div className="flex items-center gap-2 py-1 pl-4 text-[12px] text-fg-muted">
                  <ArrowDown size={13} aria-hidden />
                  <LinkStatus valid={link.signatureValid} />
                  <span>{link.signatureValid ? 'signed by' : link.signatureValid === false ? 'NOT signed by' : 'issued by (signature not checked)'}</span>
                </div>
              )}
            </li>
          );
        })}
        {chain.missingIssuer && (
          <li className="flex items-center gap-2 py-1 pl-4 text-[12px] text-fg-muted">
            <ArrowDown size={13} aria-hidden />
            <span className="break-all">not included: {chain.missingIssuer}</span>
          </li>
        )}
      </ol>
      {notes.length > 0 && (
        <div className="mt-3 flex flex-col gap-2">
          {notes.map((n, i) => (
            <Alert key={i} tone={n.tone}>
              {n.text}
            </Alert>
          ))}
        </div>
      )}
    </Panel>
  );
}

