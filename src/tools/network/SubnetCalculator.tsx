import { useMemo, useState, type ReactNode } from 'react';
import { CircleCheck, CircleX, Network } from 'lucide-react';
import { ToolStack } from '@/components/tool/EditorPanel';
import { Badge, Panel, Stat } from '@/components/ui/Panel';
import { ErrorMessage, Alert } from '@/components/ui/Alert';
import { Field, Input, Select } from '@/components/ui/Field';
import { CopyButton } from '@/components/ui/Actions';
import { EmptyState } from '@/components/ui/Feedback';
import { useToolState } from '@/lib/hooks';
import { cn, errorMessage, formatNumber } from '@/lib/utils';
import {
  cidrContains,
  detectFamily,
  formatBig,
  formatIPv4,
  ipv4Info,
  ipv6Info,
  parseIPv4Cidr,
  parseIPv6Cidr,
  prefixToMask,
  splitIPv4,
  type IPv4Cidr,
  type IPv4Info,
  type IPv6Info,
} from './lib/cidr';

const TOOL = 'subnet-calculator';
const SPLIT_LIMIT = 256;

type Result =
  | { family: 4; info: IPv4Info; cidr: IPv4Cidr }
  | { family: 6; info: IPv6Info }
  | { error: string }
  | null;

function compute(input: string): Result {
  if (!input.trim()) return null;
  try {
    if (detectFamily(input) === 6) return { family: 6, info: ipv6Info(parseIPv6Cidr(input)) };
    const cidr = parseIPv4Cidr(input);
    return { family: 4, info: ipv4Info(cidr), cidr };
  } catch (error) {
    return { error: errorMessage(error) };
  }
}

function Row({ label, value, copy = true, mono = true }: { label: ReactNode; value: ReactNode; copy?: boolean; mono?: boolean }) {
  return (
    // A <dl> group may only contain <dt>/<dd>, so the copy button lives inside the <dd>.
    <div className="grid grid-cols-1 gap-y-0.5 py-2 sm:grid-cols-[180px_minmax(0,1fr)] sm:items-center sm:gap-x-3">
      <dt className="text-[13px] text-fg-muted">{label}</dt>
      <dd className="flex min-w-0 items-center justify-between gap-3">
        <span className={cn('min-w-0 text-[13px] break-all text-fg', mono && 'font-mono text-[12.5px]')}>{value}</span>
        {copy && typeof value === 'string' && <CopyButton value={value} iconOnly />}
      </dd>
    </div>
  );
}

function BinaryView({ rows, prefix }: { rows: Array<{ label: string; bits: string }>; prefix: number }) {
  return (
    <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Binary representation">
      <table className="font-mono text-[12.5px]">
        <tbody>
          {rows.map((row) => {
            let index = 0;
            return (
              <tr key={row.label}>
                <th scope="row" className="py-1 pr-4 text-left font-sans text-[13px] font-normal whitespace-nowrap text-fg-muted">
                  {row.label}
                </th>
                <td className="py-1 whitespace-nowrap">
                  {row.bits.split('').map((ch, i) => {
                    if (ch === '.') return <span key={i} className="text-fg-muted">.</span>;
                    const isNet = index++ < prefix;
                    return (
                      <span key={i} className={isNet ? 'text-accent-text' : 'text-fg-secondary'}>
                        {ch}
                      </span>
                    );
                  })}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12.5px] text-fg-muted">
        <span>
          <span className="font-mono text-accent-text">1010</span> network bits ({prefix})
        </span>
        <span>
          <span className="font-mono text-fg-secondary">1010</span> host bits ({32 - prefix})
        </span>
      </p>
    </div>
  );
}

function SplitPanel({ cidr }: { cidr: IPv4Cidr }) {
  const [newPrefix, setNewPrefix] = useState<number>(Math.min(cidr.prefix + 2, 32));
  const effective = Math.max(newPrefix, cidr.prefix);
  const split = useMemo(() => splitIPv4(cidr, effective, SPLIT_LIMIT), [cidr, effective]);
  const options = [];
  for (let p = cidr.prefix; p <= 32; p++) options.push(p);
  const hostsPer = effective >= 31 ? (effective === 32 ? 1 : 2) : 2 ** (32 - effective) - 2;

  return (
    <Panel
      title="Split into subnets"
      description={`${formatNumber(split.count, 0)} × /${effective}, ${formatNumber(hostsPer, 0)} usable ${hostsPer === 1 ? 'host' : 'hosts'} each`}
      actions={
        <Select
          aria-label="New prefix length"
          value={effective}
          onChange={(e) => setNewPrefix(Number(e.target.value))}
          className="w-auto min-w-40"
        >
          {options.map((p) => (
            <option key={p} value={p}>
              /{p} — {formatIPv4(prefixToMask(p))}
            </option>
          ))}
        </Select>
      }
      bodyClassName="p-0"
    >
      <div className="max-h-[420px] overflow-auto">
        <table className="w-full min-w-[560px] text-left text-[13px]">
          <thead className="sticky top-0 bg-surface-raised text-[12px] text-fg-muted">
            <tr className="border-b border-line">
              <th className="px-4 py-2 font-medium">#</th>
              <th className="px-4 py-2 font-medium">Subnet</th>
              <th className="px-4 py-2 font-medium">Usable range</th>
              <th className="px-4 py-2 font-medium">Broadcast</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line font-mono text-[12.5px]">
            {split.subnets.map((s, i) => (
              <tr key={s.cidr} className="hover:bg-surface-hover">
                <td className="px-4 py-1.5 text-fg-muted tabular-nums">{i + 1}</td>
                <td className="px-4 py-1.5 text-fg">{s.cidr}</td>
                <td className="px-4 py-1.5 text-fg-secondary">
                  {s.firstHost === s.lastHost ? s.firstHost : `${s.firstHost} – ${s.lastHost}`}
                </td>
                <td className="px-4 py-1.5 text-fg-secondary">{s.broadcast ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {split.truncated && (
        <p className="border-t border-line px-4 py-2 text-[12.5px] text-fg-muted">
          Showing the first {formatNumber(SPLIT_LIMIT, 0)} of {formatNumber(split.count, 0)} subnets.
        </p>
      )}
    </Panel>
  );
}

function ContainsPanel() {
  const [block, setBlock] = useToolState(TOOL, 'containsCidr', '10.0.0.0/8');
  const [ip, setIp] = useToolState(TOOL, 'containsIp', '10.20.30.40');
  const result = useMemo(() => {
    if (!block.trim() || !ip.trim()) return null;
    try {
      return { ok: true as const, ...cidrContains(block, ip) };
    } catch (error) {
      return { ok: false as const, error: errorMessage(error) };
    }
  }, [block, ip]);

  return (
    <Panel title="Is this IP in the range?" description="Works for IPv4 and IPv6.">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="CIDR block">
          {({ id }) => <Input id={id} mono value={block} onChange={(e) => setBlock(e.target.value)} placeholder="10.0.0.0/8" spellCheck={false} />}
        </Field>
        <Field label="IP address">
          {({ id }) => <Input id={id} mono value={ip} onChange={(e) => setIp(e.target.value)} placeholder="10.20.30.40" spellCheck={false} />}
        </Field>
      </div>
      <div className="mt-3" aria-live="polite">
        {result?.ok === false && <ErrorMessage error={result.error} />}
        {result?.ok && (
          <div
            className={cn(
              'flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-[13px]',
              result.contains ? 'bg-success-soft' : 'bg-danger-soft',
            )}
          >
            {result.contains ? (
              <CircleCheck size={17} className="shrink-0 text-success" aria-hidden />
            ) : (
              <CircleX size={17} className="shrink-0 text-danger" aria-hidden />
            )}
            <span className="min-w-0 break-all text-fg">
              <span className="font-mono">{ip.trim()}</span> is {result.contains ? '' : 'not '}inside{' '}
              <span className="font-mono">{result.network}</span>.
            </span>
          </div>
        )}
      </div>
    </Panel>
  );
}

function IPv4Result({ info, cidr, onPrefix }: { info: IPv4Info; cidr: IPv4Cidr; onPrefix: (prefix: number) => void }) {
  return (
    <>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Network" value={info.network} />
        <Stat label="Broadcast" value={info.broadcast ?? 'None'} />
        <Stat label="Usable hosts" value={formatNumber(info.usableHosts, 0)} />
        <Stat label="Total addresses" value={formatNumber(info.totalAddresses, 0)} />
      </div>
      {info.note && <Alert tone="info">{info.note}</Alert>}
      <Panel
        title="Details"
        actions={
          <Select aria-label="Prefix length" value={cidr.prefix} onChange={(e) => onPrefix(Number(e.target.value))} className="w-auto min-w-44">
            {Array.from({ length: 33 }, (_, p) => (
              <option key={p} value={p}>
                /{p} — {formatIPv4(prefixToMask(p))}
              </option>
            ))}
          </Select>
        }
      >
        <dl className="-my-2 divide-y divide-line">
          <Row label="CIDR notation" value={info.cidr} />
          <Row label="Address" value={info.ip} />
          <Row label="Subnet mask" value={info.mask} />
          <Row label="Wildcard mask" value={info.wildcard} />
          <Row label="First usable host" value={info.firstHost} />
          <Row label="Last usable host" value={info.lastHost} />
          <Row label="Host range" value={`${info.firstHost} – ${info.lastHost}`} />
          <Row
            label="Address type"
            copy={false}
            mono={false}
            value={
              <span className="inline-flex flex-wrap items-center gap-2">
                {info.type.label}
                <Badge tone={info.type.isPublic ? 'accent' : 'neutral'}>{info.type.isPublic ? 'Public' : 'Special use'}</Badge>
              </span>
            }
          />
          <Row label="Class (historical)" value={info.ipClass} copy={false} mono={false} />
          <Row label="Integer" value={String(info.integer)} />
          <Row label="Hex" value={info.hex} />
          <Row label="Reverse DNS" value={info.reverseDns} />
        </dl>
      </Panel>
      <Panel title="Binary">
        <BinaryView
          prefix={info.prefix}
          rows={[
            { label: 'Address', bits: info.binary.ip },
            { label: 'Mask', bits: info.binary.mask },
            { label: 'Network', bits: info.binary.network },
          ]}
        />
      </Panel>
      <SplitPanel key={`${info.network}/${info.prefix}`} cidr={cidr} />
    </>
  );
}

function IPv6Result({ info }: { info: IPv6Info }) {
  return (
    <>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Stat label="Network" value={info.cidr} />
        <Stat label="Addresses" value={info.totalPower === 0 ? '1' : `2^${info.totalPower}`} />
      </div>
      {info.zone && <Alert tone="info">The zone id “%{info.zone}” identifies a local interface and is not part of the address math.</Alert>}
      <Panel title="Details">
        <dl className="-my-2 divide-y divide-line">
          <Row label="Address (compressed)" value={info.address} />
          <Row label="Address (expanded)" value={info.expanded} />
          <Row label="Prefix length" value={`/${info.prefix}`} copy={false} />
          <Row label="Prefix mask" value={info.mask} />
          <Row label="Network" value={info.network} />
          <Row label="First address" value={info.first} />
          <Row label="Last address" value={info.last} />
          <Row label="Last (expanded)" value={info.lastExpanded} />
          <Row label="Total addresses" value={formatBig(info.totalAddresses)} />
          <Row
            label="Address type"
            copy={false}
            mono={false}
            value={
              <span className="inline-flex flex-wrap items-center gap-2">
                {info.type.label}
                <Badge tone={info.type.isPublic ? 'accent' : 'neutral'}>{info.type.isPublic ? 'Public' : 'Special use'}</Badge>
              </span>
            }
          />
          <Row label="Reverse DNS" value={info.reverseDns} />
        </dl>
      </Panel>
    </>
  );
}

const EXAMPLES = ['192.168.1.10/24', '10.0.0.0 255.255.240.0', '172.16.5.4/30', '2001:db8:abcd:12::1/64', 'fe80::1/10'];

export default function SubnetCalculator() {
  const [input, setInput] = useToolState(TOOL, 'input', '192.168.1.10/24');
  const result = useMemo(() => compute(input), [input]);

  const setPrefix = (prefix: number) => {
    if (result && 'family' in result && result.family === 4) setInput(`${result.info.ip}/${prefix}`);
  };

  return (
    <ToolStack>
      <Panel>
        <Field
          label="IP address with prefix or mask"
          hint="Examples: 192.168.1.10/24 · 10.0.0.1 255.255.0.0 · 2001:db8::1/48"
        >
          {({ id, describedBy }) => (
            <Input
              id={id}
              aria-describedby={describedBy}
              mono
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="192.168.1.10/24"
              spellCheck={false}
              autoCapitalize="off"
              autoComplete="off"
              className="text-[15px]"
            />
          )}
        </Field>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {EXAMPLES.map((ex) => (
            <button
              key={ex}
              type="button"
              onClick={() => setInput(ex)}
              className="rounded-md border border-line bg-surface-sunken px-2 py-0.5 font-mono text-[12px] text-fg-secondary hover:border-line-strong hover:text-fg"
            >
              {ex}
            </button>
          ))}
        </div>
      </Panel>

      {result === null && (
        <Panel>
          <EmptyState icon={Network} title="Enter an address to calculate">
            IPv4 and IPv6 addresses are supported, with a /prefix or a dotted subnet mask.
          </EmptyState>
        </Panel>
      )}
      {result && 'error' in result && <ErrorMessage error={result.error} title="Can't read that address" />}
      {result && 'family' in result && result.family === 4 && <IPv4Result info={result.info} cidr={result.cidr} onPrefix={setPrefix} />}
      {result && 'family' in result && result.family === 6 && <IPv6Result info={result.info} />}

      <ContainsPanel />
    </ToolStack>
  );
}
