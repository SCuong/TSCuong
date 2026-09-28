import { useId, useMemo, useState } from 'react';
import { Clock, RefreshCw } from 'lucide-react';
import { ToolBar, ToolStack } from '@/components/tool/EditorPanel';
import { Segmented } from '@/components/ui/Segmented';
import { Input, Label, NumberInput, Select, Switch } from '@/components/ui/Field';
import { Button } from '@/components/ui/Button';
import { KeyValueList, Panel, Stat } from '@/components/ui/Panel';
import { Alert, ErrorMessage } from '@/components/ui/Alert';
import { EmptyState } from '@/components/ui/Feedback';
import { useToolState } from '@/lib/hooks';
import { errorMessage, pluralize } from '@/lib/utils';
import { decodeUlid, generateUlids } from './lib/ulid';
import {
  NANOID_PRESETS,
  checkAlphabet,
  collisionProbability,
  formatCompact,
  formatSeconds,
  generateNanoids,
  idsForProbability,
} from './lib/nanoid';
import { entropyBits } from './lib/random';
import { OutputPanel, ToolField, clampInt } from './components';

const TOOL = 'ulid-nanoid';
const MAX_COUNT = 10_000;

function localTime(date: Date): string {
  if (Number.isNaN(date.getTime())) return 'Beyond the JavaScript date range';
  return date.toLocaleString(undefined, { dateStyle: 'full', timeStyle: 'long' });
}

function UlidSection() {
  const [count, setCount] = useToolState<number | ''>(TOOL, 'ulidCount', 10);
  const [monotonic, setMonotonic] = useToolState(TOOL, 'monotonic', true);
  const [lower, setLower] = useToolState(TOOL, 'ulidLower', false);
  const [decode, setDecode] = useToolState(TOOL, 'decode', '');
  const [nonce, setNonce] = useState(0);
  const countId = useId();
  const decodeId = useId();
  const n = clampInt(count, 1, MAX_COUNT, 1);

  const result = useMemo(() => {
    void nonce;
    try {
      return { ids: generateUlids(n, { monotonic }), error: null };
    } catch (error) {
      return { ids: [] as string[], error: errorMessage(error) };
    }
  }, [n, monotonic, nonce]);
  const text = useMemo(() => {
    const joined = result.ids.join('\n');
    return lower ? joined.toLowerCase() : joined;
  }, [result.ids, lower]);

  const decoded = decode.trim() ? decodeUlid(decode) : null;

  return (
    <>
      <ToolBar>
        <ToolField label="How many" htmlFor={countId} className="w-28">
          <NumberInput id={countId} value={count} onChange={setCount} min={1} max={MAX_COUNT} />
        </ToolField>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 pb-1.5">
          <Switch label="Monotonic" checked={monotonic} onChange={setMonotonic} />
          <Switch label="Lowercase" checked={lower} onChange={setLower} />
        </div>
        <Button variant="primary" icon={RefreshCw} onClick={() => setNonce((x) => x + 1)} className="sm:ml-auto">
          Generate
        </Button>
      </ToolBar>
      <p className="-mt-1 px-1 text-[13px] text-fg-muted">
        48-bit millisecond timestamp + 80 random bits, in Crockford Base32.{' '}
        {monotonic
          ? 'Monotonic: ids made in the same millisecond increment the random part, so they stay strictly sorted.'
          : 'Each id gets fresh randomness; ids from the same millisecond are not ordered among themselves.'}
      </p>
      <ErrorMessage error={result.error} title="Could not generate" />
      <OutputPanel title={pluralize(n, 'ULID')} text={text} filename={`ulids-${n}.txt`} height={n === 1 ? '64px' : '300px'} />

      <Panel title="Decode a ULID" description="Read the timestamp and randomness out of an existing ULID.">
        <div className="flex flex-col gap-3">
          <label htmlFor={decodeId} className="sr-only">
            ULID to decode
          </label>
          <Input id={decodeId} mono value={decode} onChange={(e) => setDecode(e.target.value)} placeholder="01ARYZ6S41TSV4RRFFQ69G5FAV" aria-invalid={decoded ? !decoded.ok : undefined} />
          {!decoded ? (
            <EmptyState icon={Clock} title="Paste a ULID to see when it was created" className="py-4" />
          ) : decoded.ok ? (
            <KeyValueList
              items={[
                { label: 'Status', value: <span className="font-sans text-success">Valid ULID</span> },
                { label: 'Timestamp (UTC)', value: Number.isNaN(decoded.value.date.getTime()) ? 'Beyond the JavaScript date range' : decoded.value.date.toISOString() },
                { label: 'Local time', value: localTime(decoded.value.date) },
                { label: 'Unix milliseconds', value: String(decoded.value.timeMs) },
                { label: 'Randomness (80 bits, hex)', value: <span className="break-all">{decoded.value.randomHex}</span> },
                { label: 'As UUID (128 bits)', value: <span className="break-all">{decoded.value.uuid}</span> },
              ]}
            />
          ) : (
            <Alert tone="danger" title="Not a valid ULID">
              {decoded.error}
            </Alert>
          )}
        </div>
      </Panel>
    </>
  );
}

function NanoidSection() {
  const [preset, setPreset] = useToolState(TOOL, 'preset', 'url');
  const [custom, setCustom] = useToolState(TOOL, 'custom', 'abcdef0123456789');
  const [size, setSize] = useToolState<number | ''>(TOOL, 'size', 21);
  const [count, setCount] = useToolState<number | ''>(TOOL, 'nanoCount', 10);
  const [rate, setRate] = useToolState<number | ''>(TOOL, 'rate', 1000);
  const [unit, setUnit] = useToolState<'second' | 'hour'>(TOOL, 'rateUnit', 'hour');
  const [nonce, setNonce] = useState(0);
  const ids = { preset: useId(), custom: useId(), size: useId(), count: useId(), rate: useId(), unit: useId() };

  const alphabetText = preset === 'custom' ? custom : (NANOID_PRESETS.find((p) => p.id === preset)?.alphabet ?? NANOID_PRESETS[0].alphabet);
  const check = useMemo(() => checkAlphabet(alphabetText), [alphabetText]);
  const len = clampInt(size, 2, 256, 21);
  const n = clampInt(count, 1, MAX_COUNT, 1);

  const text = useMemo(() => {
    void nonce;
    return check.ok ? generateNanoids(check.symbols, len, n).join('\n') : '';
  }, [check, len, n, nonce]);

  const stats = useMemo(() => {
    if (!check.ok) return null;
    const a = check.symbols.length;
    const needed = idsForProbability(a, len, 0.01);
    const perSecond = rate === '' || rate <= 0 ? 0 : unit === 'hour' ? rate / 3600 : rate;
    const yearIds = perSecond * 365.25 * 86400;
    return {
      a,
      bits: entropyBits(a, len),
      needed,
      time: perSecond > 0 ? formatSeconds(needed / perSecond) : null,
      yearP: perSecond > 0 ? collisionProbability(a, len, yearIds) : null,
      yearIds,
    };
  }, [check, len, rate, unit]);

  return (
    <>
      <ToolBar>
        <ToolField label="Alphabet" htmlFor={ids.preset} className="w-full sm:w-60">
          <Select id={ids.preset} value={preset} onChange={(e) => setPreset(e.target.value)}>
            {NANOID_PRESETS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
            <option value="custom">Custom…</option>
          </Select>
        </ToolField>
        <ToolField label="Length" htmlFor={ids.size} className="w-24">
          <NumberInput id={ids.size} value={size} onChange={setSize} min={2} max={256} />
        </ToolField>
        <ToolField label="How many" htmlFor={ids.count} className="w-28">
          <NumberInput id={ids.count} value={count} onChange={setCount} min={1} max={MAX_COUNT} />
        </ToolField>
        <Button variant="primary" icon={RefreshCw} onClick={() => setNonce((x) => x + 1)} disabled={!check.ok} className="sm:ml-auto">
          Generate
        </Button>
        {preset === 'custom' && (
          <ToolField label="Custom alphabet" htmlFor={ids.custom} className="w-full">
            <Input id={ids.custom} mono value={custom} onChange={(e) => setCustom(e.target.value)} aria-invalid={!check.ok || undefined} placeholder="Characters to draw from" />
          </ToolField>
        )}
      </ToolBar>
      {preset !== 'custom' && (
        <p className="-mt-1 px-1 font-mono text-[12.5px] break-all text-fg-muted">
          <span className="font-sans">Alphabet: </span>
          {alphabetText}
        </p>
      )}
      <ErrorMessage error={check.ok ? null : check.error} title="Alphabet problem" />
      {check.ok && <OutputPanel title={pluralize(n, 'NanoID')} text={text} filename={`nanoids-${n}.txt`} height={n === 1 ? '64px' : '300px'} />}

      {stats && (
        <Panel title="Collision probability" description="Birthday-bound estimate for this alphabet and length.">
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-end gap-3">
              <ToolField label="Generating" htmlFor={ids.rate} className="w-36">
                <NumberInput id={ids.rate} value={rate} onChange={setRate} min={0} />
              </ToolField>
              <ToolField label="IDs per" htmlFor={ids.unit} className="w-32">
                <Select id={ids.unit} value={unit} onChange={(e) => setUnit(e.target.value as 'second' | 'hour')}>
                  <option value="hour">hour</option>
                  <option value="second">second</option>
                </Select>
              </ToolField>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Stat label="Alphabet size" value={stats.a} />
              <Stat label="Entropy" value={`${stats.bits.toFixed(1)} bits`} />
              <Stat label="IDs for 1% collision risk" value={<span title={stats.needed.toExponential(3)}>~{formatCompact(stats.needed)}</span>} />
              <Stat label="Time to reach 1% risk" value={stats.time ?? '—'} />
            </div>
            <p className="text-[13px] leading-relaxed text-fg-secondary">
              {stats.time ? (
                <>
                  At {Number(rate).toLocaleString()} IDs per {unit}, it takes {stats.time.replace(/^~/, 'about ')} (about{' '}
                  {formatCompact(stats.needed)} IDs) before there is a 1% chance of at least one collision. After one year of generating (
                  {formatCompact(stats.yearIds)} IDs) the chance is {formatProbability(stats.yearP ?? 0)}.
                </>
              ) : (
                <>Enter a generation rate above zero to estimate how long it takes to reach a 1% collision risk.</>
              )}
            </p>
          </div>
        </Panel>
      )}
    </>
  );
}

function formatProbability(p: number): string {
  if (p <= 0) return '0%';
  if (p >= 0.999995) return '≈100%';
  const pct = p * 100;
  if (pct >= 0.01) return `${pct.toPrecision(3).replace(/\.?0+$/, '')}%`;
  const [m, e] = pct.toExponential(1).split('e');
  return `${m} × 10^${Number(e)} %`;
}

export default function UlidNanoid() {
  const [mode, setMode] = useToolState<'ulid' | 'nanoid'>(TOOL, 'mode', 'ulid');
  return (
    <ToolStack>
      <div>
        <Label className="sr-only">Generator</Label>
        <Segmented
          label="Generator"
          value={mode}
          onChange={setMode}
          options={[
            { value: 'ulid', label: 'ULID' },
            { value: 'nanoid', label: 'NanoID' },
          ]}
        />
      </div>
      {mode === 'ulid' ? <UlidSection /> : <NanoidSection />}
    </ToolStack>
  );
}
