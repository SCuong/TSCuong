import type { ReactNode } from 'react';
import { ToolStack } from '@/components/tool/EditorPanel';
import { Panel, Stat } from '@/components/ui/Panel';
import { Input, Label, Select } from '@/components/ui/Field';
import { Segmented } from '@/components/ui/Segmented';
import { CopyButton } from '@/components/ui/Actions';
import { Alert, ErrorMessage } from '@/components/ui/Alert';
import { useToolState } from '@/lib/hooks';
import { cn } from '@/lib/utils';
import { formatNumber, parseNumber } from './shared-a/format';
import {
  RATE_PRESETS,
  RATE_UNITS,
  SIZE_PRESETS,
  SIZE_UNITS,
  describeRate,
  describeSize,
  formatClock,
  formatHumanDuration,
  parseDuration,
  rateUnit,
  requiredRate,
  sizeUnit,
  transferTime,
  transferableSize,
  type Calc,
  type Scaled,
} from './lib/transfer';

const TOOL = 'transfer-time';
type Mode = 'time' | 'rate' | 'size';

interface State {
  size: string;
  sizeUnit: string;
  rate: string;
  rateUnit: string;
  time: string;
  overhead: string;
}

const INITIAL: State = { size: '4.7', sizeUnit: 'gb', rate: '100', rateUnit: 'mbps', time: '1h', overhead: '0' };

type Entry = { ok: true; value: number } | { ok: false; error: string } | null;

function positive(text: string, name: string): Entry {
  if (!text.trim()) return null;
  const n = parseNumber(text);
  if (n === null) return { ok: false, error: `${name} is not a valid number.` };
  if (n < 0) return { ok: false, error: `${name} cannot be negative.` };
  return { ok: true, value: n };
}

const show = (s: Scaled) => `${formatNumber(s.value, { precision: 4 })} ${s.unit}`;

export default function TransferTimeCalculator() {
  const [mode, setMode] = useToolState<Mode>(TOOL, 'mode', 'time');
  const [st, setSt] = useToolState<State>(TOOL, 'state', INITIAL);
  const set = (key: keyof State) => (value: string) => setSt((prev) => ({ ...prev, [key]: value }));

  const size = positive(st.size, 'Size');
  const rate = positive(st.rate, 'Bandwidth');
  const time: Entry = st.time.trim() ? parseDuration(st.time) : null;
  const overheadIn = st.overhead.trim() ? parseNumber(st.overhead.replace(/%$/, '')) : 0;
  const overheadError =
    overheadIn === null ? 'Overhead is not a valid number.' : overheadIn < 0 || overheadIn >= 100 ? 'Overhead must be from 0 up to (but not including) 100%.' : null;
  const overhead = overheadError ? 0 : (overheadIn ?? 0);

  const bytes = size?.ok ? size.value * sizeUnit(st.sizeUnit).bytes : null;
  const bps = rate?.ok ? rate.value * rateUnit(st.rateUnit).bitsPerSecond : null;
  const seconds = time?.ok ? time.value : null;

  const needed: Array<[Entry, string]> =
    mode === 'time'
      ? [
          [size, 'size'],
          [rate, 'bandwidth'],
        ]
      : mode === 'rate'
        ? [
            [size, 'size'],
            [time, 'time'],
          ]
        : [
            [rate, 'bandwidth'],
            [time, 'time'],
          ];
  const inputError = needed.map(([i]) => (i && !i.ok ? i.error : null)).find(Boolean) ?? overheadError;
  const missing = needed.filter(([i]) => !i).map(([, name]) => name);

  let calc: Calc | null = null;
  if (!inputError && missing.length === 0) {
    if (mode === 'time') calc = transferTime(bytes!, bps!, overhead);
    else if (mode === 'rate') calc = requiredRate(bytes!, seconds!, overhead);
    else calc = transferableSize(bps!, seconds!, overhead);
  }

  return (
    <ToolStack>
      <Panel bodyClassName="flex flex-col gap-4">
        <div>
          <Label>Calculate</Label>
          <Segmented
            label="Calculate"
            value={mode}
            onChange={setMode}
            options={[
              { value: 'time', label: 'Time' },
              { value: 'rate', label: 'Bandwidth' },
              { value: 'size', label: 'Size' },
            ]}
          />
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {mode !== 'size' && (
            <Group label="File size" htmlFor="tt-size">
              <div className="grid grid-cols-[minmax(0,1fr)_7rem] gap-2">
                <Input id="tt-size" mono inputMode="decimal" value={st.size} onChange={(e) => set('size')(e.target.value)} placeholder="e.g. 4.7" />
                <Select aria-label="Size unit" value={st.sizeUnit} onChange={(e) => set('sizeUnit')(e.target.value)}>
                  {SIZE_UNITS.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.label}
                    </option>
                  ))}
                </Select>
              </div>
              <Presets
                items={SIZE_PRESETS.map((p) => ({ label: p.label, active: Number(st.size) === p.value && st.sizeUnit === p.unit }))}
                onPick={(i) => setSt((prev) => ({ ...prev, size: String(SIZE_PRESETS[i].value), sizeUnit: SIZE_PRESETS[i].unit }))}
              />
            </Group>
          )}
          {mode !== 'rate' && (
            <Group label="Bandwidth (link speed)" htmlFor="tt-rate">
              <div className="grid grid-cols-[minmax(0,1fr)_7rem] gap-2">
                <Input id="tt-rate" mono inputMode="decimal" value={st.rate} onChange={(e) => set('rate')(e.target.value)} placeholder="e.g. 100" />
                <Select aria-label="Bandwidth unit" value={st.rateUnit} onChange={(e) => set('rateUnit')(e.target.value)}>
                  {RATE_UNITS.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.label}
                    </option>
                  ))}
                </Select>
              </div>
              <Presets
                items={RATE_PRESETS.map((p) => ({ label: p.label, title: p.note, active: Number(st.rate) === p.value && st.rateUnit === p.unit }))}
                onPick={(i) => setSt((prev) => ({ ...prev, rate: String(RATE_PRESETS[i].value), rateUnit: RATE_PRESETS[i].unit }))}
              />
            </Group>
          )}
          {mode !== 'time' && (
            <Group label="Time" htmlFor="tt-time" hint="90 (seconds), 1:30:00, 1.5h, 2h 30m or 1d 4h">
              <Input id="tt-time" mono value={st.time} onChange={(e) => set('time')(e.target.value)} placeholder="e.g. 1h 30m" />
            </Group>
          )}
          <Group label="Protocol overhead" htmlFor="tt-oh" hint="Share of the link lost to TCP/IP, Ethernet framing, encoding… (typically 3–10%).">
            <div className="relative w-32">
              <Input id="tt-oh" mono inputMode="decimal" value={st.overhead} onChange={(e) => set('overhead')(e.target.value)} className="pr-7" />
              <span className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-[13px] text-fg-muted">%</span>
            </div>
          </Group>
        </div>
      </Panel>

      <ErrorMessage error={inputError} />
      {!inputError && calc && !calc.ok && <ErrorMessage error={calc.error} />}
      {!inputError && missing.length > 0 && (
        <p className="px-1 text-[13px] text-fg-muted">Enter the {missing.join(' and ')} to see the result.</p>
      )}

      {calc?.ok && mode === 'time' && <TimeResult seconds={calc.value} bps={bps!} overhead={overhead} />}
      {calc?.ok && mode === 'rate' && <RateResult bps={calc.value} overhead={overhead} />}
      {calc?.ok && mode === 'size' && <SizeResult bytes={calc.value} />}

      <Alert tone="info" title="Bits vs bytes, SI vs IEC">
        Network speeds are quoted in decimal <strong>bits</strong> per second (1 Mbit/s = 1,000,000 bit/s = 0.125 MB/s). File sizes use bytes, and
        some operating systems (Windows, for example) label binary sizes with SI names: a file shown as “1 GB” there is really 1 GiB = 1,073,741,824
        bytes. Pick GiB/MiB when your size comes from such a system.
      </Alert>
    </ToolStack>
  );
}

function TimeResult({ seconds, bps, overhead }: { seconds: number; bps: number; overhead: number }) {
  const clock = formatClock(seconds);
  const effective = describeRate(bps * (1 - overhead / 100));
  return (
    <Panel title="Transfer time" actions={<CopyButton value={clock} label="Copy HH:MM:SS" />} bodyClassName="flex flex-col gap-3">
      <div>
        <output className="block font-mono text-[28px] font-semibold text-fg tabular-nums">{clock}</output>
        <p className="text-[14px] text-fg-secondary">{formatHumanDuration(seconds)}</p>
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <Stat label={overhead > 0 ? 'Effective throughput' : 'Throughput'} value={show(effective.bits)} />
        <Stat label="In SI bytes" value={show(effective.si)} />
        <Stat label="In IEC bytes" value={show(effective.iec)} />
      </div>
    </Panel>
  );
}

function RateResult({ bps, overhead }: { bps: number; overhead: number }) {
  const d = describeRate(bps);
  const main = show(d.bits);
  return (
    <Panel title="Required bandwidth" actions={<CopyButton value={main} label="Copy" />} bodyClassName="flex flex-col gap-3">
      <output className="block font-mono text-[28px] font-semibold text-fg tabular-nums">{main}</output>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <Stat label="Bits per second" value={`${formatNumber(bps, { precision: 6 })} bit/s`} />
        <Stat label="In SI bytes" value={show(d.si)} />
        <Stat label="In IEC bytes" value={show(d.iec)} />
      </div>
      {overhead > 0 && <p className="text-[12.5px] text-fg-muted">Includes {formatNumber(overhead)}% protocol overhead on top of the payload rate.</p>}
    </Panel>
  );
}

function SizeResult({ bytes }: { bytes: number }) {
  const d = describeSize(bytes);
  const main = show(d.si);
  return (
    <Panel title="Data transferred" actions={<CopyButton value={main} label="Copy" />} bodyClassName="flex flex-col gap-3">
      <output className="block font-mono text-[28px] font-semibold text-fg tabular-nums">{main}</output>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <Stat label="Bytes" value={formatNumber(Math.floor(bytes), { precision: 15 })} />
        <Stat label="In IEC units" value={show(d.iec)} />
        <Stat label="In bits" value={show({ value: (bytes * 8) / 1e9, unit: 'Gbit' })} />
      </div>
    </Panel>
  );
}

function Group({ label, htmlFor, hint, children }: { label: string; htmlFor: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <Label htmlFor={htmlFor} className="mb-0">
        {label}
      </Label>
      {children}
      {hint && <p className="text-[12.5px] text-fg-muted">{hint}</p>}
    </div>
  );
}

function Presets({ items, onPick }: { items: Array<{ label: string; title?: string; active: boolean }>; onPick: (index: number) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((item, i) => (
        <button
          key={item.label}
          type="button"
          title={item.title}
          aria-pressed={item.active}
          onClick={() => onPick(i)}
          className={cn(
            'h-7 rounded-md border px-2 text-[12.5px] whitespace-nowrap',
            item.active
              ? 'border-accent-line bg-accent-soft text-accent-text'
              : 'border-line bg-surface-sunken text-fg-secondary hover:bg-surface-hover hover:text-fg',
          )}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
