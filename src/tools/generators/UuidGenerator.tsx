import { useId, useMemo, useState, type ReactNode } from 'react';
import { RefreshCw, ScanSearch } from 'lucide-react';
import { ToolBar, ToolStack } from '@/components/tool/EditorPanel';
import { Segmented } from '@/components/ui/Segmented';
import { Label, NumberInput, Switch, Textarea } from '@/components/ui/Field';
import { Button } from '@/components/ui/Button';
import { Badge, KeyValueList, Panel } from '@/components/ui/Panel';
import { EmptyState } from '@/components/ui/Feedback';
import { Alert } from '@/components/ui/Alert';
import { CopyButton } from '@/components/ui/Actions';
import { useToolState } from '@/lib/hooks';
import { pluralize } from '@/lib/utils';
import { MAX_UUIDS, formatUuid, generateUuids, parseMany, type UuidInfo, type UuidKind } from './lib/uuid';
import { OutputPanel, ToolField, clampInt } from './components';

const TOOL = 'uuid-generator';

const KIND_HINTS: Record<UuidKind, string> = {
  v4: '122 random bits. The everyday choice when you just need a unique id.',
  v7: 'Unix-millisecond timestamp + randomness. Sorts by creation time, which makes it a good database key.',
  v1: 'Gregorian timestamp + clock sequence + node. The node is random here (multicast bit set), never your MAC address.',
  v6: 'Like v1 but with the timestamp reordered so ids sort by creation time.',
  nil: 'All 128 bits zero. Useful as an "empty" sentinel value.',
  max: 'All 128 bits one (RFC 9562). Useful as an upper-bound sentinel.',
};

function localTime(date: Date): string {
  if (Number.isNaN(date.getTime())) return 'Out of range';
  return date.toLocaleString(undefined, { dateStyle: 'full', timeStyle: 'long' });
}

function details(info: UuidInfo) {
  const items: Array<{ label: string; value: ReactNode }> = [
    { label: 'Canonical', value: <span className="break-all">{info.canonical}</span> },
    { label: 'Version', value: info.versionLabel },
    { label: 'Variant', value: info.variant },
  ];
  if (info.timestamp) {
    items.push({ label: 'Timestamp (UTC)', value: info.timestamp.iso });
    items.push({ label: 'Local time', value: localTime(info.timestamp.date) });
    items.push({ label: 'Unix milliseconds', value: String(Math.floor(info.timestamp.unixMs)) });
  }
  if (info.clockSeq !== undefined) items.push({ label: 'Clock sequence', value: String(info.clockSeq) });
  if (info.node) {
    items.push({
      label: 'Node',
      value: (
        <>
          {info.node} <span className="font-sans text-fg-muted">{info.nodeIsRandom ? '(random, multicast bit set)' : '(looks like a MAC address)'}</span>
        </>
      ),
    });
  }
  items.push({ label: 'Uppercase', value: <span className="break-all">{info.canonical.toUpperCase()}</span> });
  items.push({ label: 'No hyphens', value: <span className="break-all">{info.canonical.replace(/-/g, '')}</span> });
  items.push({ label: 'URN', value: <span className="break-all">urn:uuid:{info.canonical}</span> });
  return items;
}

export default function UuidGenerator() {
  const [kind, setKind] = useToolState<UuidKind>(TOOL, 'kind', 'v4');
  const [count, setCount] = useToolState<number | ''>(TOOL, 'count', 10);
  const [uppercase, setUppercase] = useToolState(TOOL, 'upper', false);
  const [braces, setBraces] = useToolState(TOOL, 'braces', false);
  const [hyphens, setHyphens] = useToolState(TOOL, 'hyphens', true);
  const [nonce, setNonce] = useState(0);
  const [check, setCheck] = useToolState(TOOL, 'check', '');
  const countId = useId();
  const checkId = useId();

  const n = clampInt(count, 1, MAX_UUIDS, 1);
  const raw = useMemo(() => {
    void nonce; // regenerate on demand
    return generateUuids(kind, n, { uppercase: false, braces: false, hyphens: true });
  }, [kind, n, nonce]);
  const output = useMemo(() => raw.map((id) => formatUuid(id, { uppercase, braces, hyphens })).join('\n'), [raw, uppercase, braces, hyphens]);

  const parsed = useMemo(() => (check.trim() ? parseMany(check) : []), [check]);
  const validCount = parsed.filter((p) => p.ok).length;
  const countTooHigh = count !== '' && count > MAX_UUIDS;

  return (
    <ToolStack>
      <ToolBar>
        <div>
          <Label>Version</Label>
          <Segmented
            label="UUID version"
            value={kind}
            onChange={setKind}
            options={[
              { value: 'v4', label: 'v4' },
              { value: 'v7', label: 'v7' },
              { value: 'v1', label: 'v1' },
              { value: 'v6', label: 'v6' },
              { value: 'nil', label: 'Nil' },
              { value: 'max', label: 'Max' },
            ]}
          />
        </div>
        <ToolField label="How many" htmlFor={countId} className="w-28">
          <NumberInput id={countId} value={count} onChange={setCount} min={1} max={MAX_UUIDS} step={1} />
        </ToolField>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 pb-1.5">
          <Switch label="Uppercase" checked={uppercase} onChange={setUppercase} />
          <Switch label="Hyphens" checked={hyphens} onChange={setHyphens} />
          <Switch label="Braces {}" checked={braces} onChange={setBraces} />
        </div>
        <Button variant="primary" icon={RefreshCw} onClick={() => setNonce((x) => x + 1)} className="sm:ml-auto">
          Generate
        </Button>
      </ToolBar>
      <p className="-mt-1 px-1 text-[13px] text-fg-muted">{KIND_HINTS[kind]}</p>
      {countTooHigh && (
        <Alert tone="warning">You can generate up to {MAX_UUIDS.toLocaleString()} UUIDs at once, so {MAX_UUIDS.toLocaleString()} were made.</Alert>
      )}

      <OutputPanel
        title={n === 1 ? 'UUID' : `${pluralize(n, 'UUID')}`}
        text={output}
        filename={`uuid-${kind}${n > 1 ? `-${n}` : ''}.txt`}
        height={n === 1 ? '64px' : '320px'}
        footer={<span>Generated locally with crypto.getRandomValues</span>}
      />

      <Panel title="Validate & inspect" description="Paste one or more UUIDs (one per line, or separated by spaces or commas).">
        <div className="flex flex-col gap-4">
          <div>
            <label htmlFor={checkId} className="sr-only">
              UUIDs to inspect
            </label>
            <Textarea
              id={checkId}
              value={check}
              onChange={(e) => setCheck(e.target.value)}
              placeholder={'017F22E2-79B0-7CC3-98C4-DC0C0C07398F\n{c232ab00-9414-11ec-b3c8-9f6bdeced846}'}
              rows={4}
              className="resize-y"
            />
          </div>
          {parsed.length === 0 ? (
            <EmptyState icon={ScanSearch} title="Nothing to inspect yet" className="py-4">
              Version, variant and the embedded timestamp (v1, v6, v7) appear here.
            </EmptyState>
          ) : parsed.length === 1 ? (
            parsed[0].ok ? (
              <div>
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <Badge tone="success">Valid UUID</Badge>
                  <Badge tone="accent">{parsed[0].info.special ? parsed[0].info.versionLabel : `v${parsed[0].info.version}`}</Badge>
                </div>
                <KeyValueList items={details(parsed[0].info)} />
              </div>
            ) : (
              <Alert tone="danger" title="Not a valid UUID">
                {parsed[0].error}
              </Alert>
            )
          ) : (
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center gap-2 text-[13px] text-fg-secondary">
                <Badge tone="success">{validCount} valid</Badge>
                {parsed.length - validCount > 0 && <Badge tone="danger">{parsed.length - validCount} invalid</Badge>}
                <CopyButton
                  className="ml-auto"
                  label="Copy as CSV"
                  value={() =>
                    [
                      'input,valid,version,variant,timestamp_utc',
                      ...parsed.map((p) =>
                        p.ok
                          ? `${p.info.input},true,${p.info.special ?? p.info.version},${p.info.variant},${p.info.timestamp?.iso ?? ''}`
                          : `"${p.input.replace(/"/g, '""')}",false,,,`,
                      ),
                    ].join('\n')
                  }
                />
              </div>
              <div className="overflow-x-auto rounded-lg border border-line">
                <table className="w-full min-w-[640px] text-left text-[13px]">
                  <thead className="bg-surface-sunken text-fg-muted">
                    <tr>
                      <th className="px-3 py-2 font-medium">UUID</th>
                      <th className="px-3 py-2 font-medium">Version</th>
                      <th className="px-3 py-2 font-medium">Variant</th>
                      <th className="px-3 py-2 font-medium">Timestamp (UTC)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {parsed.slice(0, 500).map((p, i) => (
                      <tr key={i} className="align-top">
                        <td className="px-3 py-2 font-mono text-[12.5px] break-all text-fg">{p.ok ? p.info.canonical : p.input}</td>
                        {p.ok ? (
                          <>
                            <td className="px-3 py-2 whitespace-nowrap text-fg">{p.info.special ? p.info.versionLabel : `v${p.info.version}`}</td>
                            <td className="px-3 py-2 whitespace-nowrap text-fg-secondary">{p.info.variant}</td>
                            <td className="px-3 py-2 font-mono text-[12.5px] whitespace-nowrap text-fg-secondary">
                              {p.info.timestamp ? (
                                <span title={localTime(p.info.timestamp.date)}>{p.info.timestamp.iso}</span>
                              ) : (
                                <span className="text-fg-muted">—</span>
                              )}
                            </td>
                          </>
                        ) : (
                          <td colSpan={3} className="px-3 py-2 text-danger">
                            {p.error}
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {parsed.length > 500 && <p className="text-[12.5px] text-fg-muted">Showing the first 500 of {parsed.length.toLocaleString()} entries.</p>}
            </div>
          )}
        </div>
      </Panel>
    </ToolStack>
  );
}
