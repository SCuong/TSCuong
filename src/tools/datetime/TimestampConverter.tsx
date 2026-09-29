import { useMemo, useState } from 'react';
import { Clock, Eraser, Pause, Play, Timer } from 'lucide-react';
import { ToolStack } from '@/components/tool/EditorPanel';
import { Badge, Panel } from '@/components/ui/Panel';
import { Alert, ErrorMessage } from '@/components/ui/Alert';
import { Button, IconButton } from '@/components/ui/Button';
import { CopyButton } from '@/components/ui/Actions';
import { Label, Select } from '@/components/ui/Field';
import { Segmented } from '@/components/ui/Segmented';
import { EmptyState } from '@/components/ui/Feedback';
import { useToolState } from '@/lib/hooks';
import { cn } from '@/lib/utils';
import { ZonePicker } from './components/ZonePicker';
import { Chip, CopyRow, Fact, LinkButton, useSecondClock, validZone } from './components/shared';
import { dayOfYear, formatClock, formatIsoDate, isoWeek, quarter } from './lib/civil';
import {
  ALT_EPOCHS,
  EPOCH_UNIT_LABEL,
  altEpochSpec,
  formatAltEpoch,
  formatEpoch,
  formatEpochFloor,
  formatHttpDate,
  formatHuman,
  formatIsoInZone,
  formatIsoUtc,
  formatRfc2822,
  formatRfc9557,
  interpretNumber,
  parseDateInput,
  preciseRelative,
  relativeTime,
  type AltEpoch,
  type EpochUnit,
  type InputUnit,
  type Instant,
  type ParsedInput,
} from './lib/timestamp';
import {
  formatUtcLabel,
  isDst,
  localTimeZone,
  namedAbbreviation,
  tzOffsetMs,
  wallInZone,
  zoneAbbreviation,
  zoneCity,
} from './lib/tz';

const TOOL = 'timestamp-converter';

type UnitChoice = 'auto' | EpochUnit | 'other';

const UNIT_OPTIONS: Array<{ value: UnitChoice; label: string; title: string }> = [
  { value: 'auto', label: 'Auto', title: 'Detect the unit from the number of digits' },
  { value: 's', label: 's', title: 'Seconds' },
  { value: 'ms', label: 'ms', title: 'Milliseconds' },
  { value: 'us', label: 'µs', title: 'Microseconds' },
  { value: 'ns', label: 'ns', title: 'Nanoseconds' },
  { value: 'other', label: 'Other…', title: 'Windows FILETIME, .NET ticks, Excel, Julian Day and more' },
];

const EXAMPLES = [
  '1700000000',
  '1700000000000',
  '2023-11-14T22:13:20Z',
  'Tue, 14 Nov 2023 22:13:20 GMT',
  '2024-03-10 02:30 America/New_York',
  'now',
];

const UNIX_UNITS: EpochUnit[] = ['s', 'ms', 'us', 'ns'];
const isEpochUnit = (u: string): u is EpochUnit => (UNIX_UNITS as string[]).includes(u);
const isAltEpoch = (u: string): u is AltEpoch => ALT_EPOCHS.some((e) => e.id === u);

function unitLabel(unit: EpochUnit | AltEpoch): string {
  return isEpochUnit(unit) ? `Unix ${EPOCH_UNIT_LABEL[unit]}` : altEpochSpec(unit).label;
}

function digitCount(text: string): number {
  return text.replace(/^[\s@+-]+/, '').split(/[.eE]/)[0].replace(/\D/g, '').length;
}

function describeInput(parsed: ParsedInput, input: string, zone: string): string {
  switch (parsed.kind) {
    case 'now':
      return 'The current time; it keeps updating.';
    case 'epoch': {
      const unit = parsed.unit as EpochUnit;
      return parsed.unitDetected
        ? `Detected Unix ${EPOCH_UNIT_LABEL[unit]} from the size of the number (${digitCount(input)} digits). Pick a unit to override.`
        : `Read as Unix ${EPOCH_UNIT_LABEL[unit]}.`;
    }
    case 'alt': {
      const spec = altEpochSpec(parsed.unit as AltEpoch);
      return `Read as ${spec.label}: ${spec.description}`;
    }
    case 'iso':
      return parsed.usedZone
        ? `ISO 8601 date without an offset, read as wall-clock time in ${zone}.`
        : 'ISO 8601 / RFC 3339 date with an explicit offset or zone.';
    case 'rfc2822':
      return 'RFC 2822 date (email headers, HTTP).';
    case 'http':
      return 'RFC 850 date (an obsolete HTTP date format).';
    case 'ctime':
      return 'asctime / Unix date command format.';
    case 'browser':
      return 'Read by your browser’s date parser.';
  }
}

/** Live "current Unix time" strip that can be paused and copied. */
function LiveNow({ onUse }: { onUse: (text: string) => void }) {
  const [paused, setPaused] = useState(false);
  const now = useSecondClock(paused);
  const seconds = Math.floor(now / 1000);
  const iso = new Date(seconds * 1000).toISOString().replace('.000Z', 'Z');
  return (
    <Panel bodyClassName="flex flex-wrap items-center gap-x-8 gap-y-3">
      <div className="min-w-0">
        <div className="flex items-center gap-1.5 text-[12px] text-fg-muted">
          <span
            aria-hidden
            className={cn('inline-block size-2 rounded-full', paused ? 'bg-fg-muted' : 'bg-success motion-safe:animate-pulse')}
          />
          {paused ? 'Current Unix time (paused)' : 'Current Unix time'}
        </div>
        <div className="flex items-center gap-1.5">
          <output aria-label="Current Unix time in seconds" className="font-mono text-[26px] leading-tight font-semibold text-fg tabular-nums">
            {seconds}
          </output>
          <CopyButton value={String(seconds)} iconOnly label="Copy current Unix seconds" />
        </div>
      </div>
      <div className="min-w-0">
        <div className="text-[12px] text-fg-muted">Milliseconds</div>
        <div className="flex items-center gap-1.5">
          <output aria-label="Current Unix time in milliseconds" className="font-mono text-[15px] text-fg tabular-nums">
            {now}
          </output>
          <CopyButton value={String(now)} iconOnly label="Copy current Unix milliseconds" />
        </div>
      </div>
      <div className="min-w-0">
        <div className="text-[12px] text-fg-muted">UTC</div>
        <div className="flex items-center gap-1.5">
          <output aria-label="Current time in UTC" className="font-mono text-[13px] break-all text-fg">
            {iso}
          </output>
          <CopyButton value={iso} iconOnly label="Copy current UTC time" />
        </div>
      </div>
      <div className="flex flex-wrap gap-2 sm:ml-auto">
        <Button size="sm" icon={paused ? Play : Pause} onClick={() => setPaused((p) => !p)} aria-pressed={paused}>
          {paused ? 'Resume' : 'Pause'}
        </Button>
        <Button size="sm" icon={Timer} onClick={() => onUse(String(seconds))}>
          Convert this
        </Button>
      </div>
    </Panel>
  );
}

/** "3 hours ago", plus the calendar breakdown when it says more. */
function relativeText(ms: number, now: number, zone: string): { short: string; precise: string | null } {
  const short = relativeTime(ms, now);
  const precise = preciseRelative(ms, now, zone);
  return { short, precise: precise === short || (precise === 'now' && short === 'now') ? null : precise };
}

function Headline({ instant, zone, now }: { instant: Instant; zone: string; now: number }) {
  const ms = instant.epochMs;
  const wall = wallInZone(ms, zone);
  const offset = tzOffsetMs(ms, zone);
  const date = new Intl.DateTimeFormat(undefined, { dateStyle: 'full', timeZone: zone }).format(new Date(ms));
  const fraction = formatIsoInZone(instant, zone).match(/\.(\d+)/)?.[1] ?? '000';
  const time = `${formatClock(wall)}${/^0+$/.test(fraction) ? '' : `.${fraction}`}`;
  const abbr = namedAbbreviation(ms, zone);
  const relative = relativeText(ms, now, zone);
  return (
    <section
      aria-label="Result"
      className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3 rounded-xl border border-accent-line bg-accent-soft px-4 py-3.5"
    >
      <div className="min-w-0">
        <p className="text-[12.5px] text-fg-secondary">
          {zoneCity(zone)} <span className="text-fg-muted">· {zone}</span>
        </p>
        <p className="mt-0.5 text-[19px] leading-snug font-semibold tracking-tight text-fg">{date}</p>
        <p className="mt-1 flex flex-wrap items-center gap-2">
          <span className="font-mono text-[18px] font-semibold text-fg tabular-nums">{time}</span>
          {abbr && <Badge>{abbr}</Badge>}
          <Badge>{formatUtcLabel(offset)}</Badge>
          {isDst(ms, zone) && <Badge tone="warning">Daylight saving</Badge>}
        </p>
      </div>
      <div className="min-w-0 text-left sm:text-right">
        <p className="text-[15px] font-medium text-fg">{relative.short}</p>
        {relative.precise && <p className="text-[12.5px] text-fg-muted">{relative.precise}</p>}
      </div>
    </section>
  );
}

function Results({
  parsed,
  zone,
  now,
  input,
  onPickUnit,
}: {
  parsed: ParsedInput;
  zone: string;
  now: number;
  input: string;
  onPickUnit: (unit: EpochUnit | AltEpoch) => void;
}) {
  const { instant } = parsed;
  const ms = instant.epochMs;
  const wall = wallInZone(ms, zone);
  const week = isoWeek(wall);
  const doy = dayOfYear(wall);
  // Within a day of the ends of the Date range the calendar maths has nothing to stand on.
  const calendarOk = Number.isFinite(week.week) && Number.isFinite(doy);
  const offset = tzOffsetMs(ms, zone);
  const inputUnit = parsed.kind === 'epoch' || parsed.kind === 'alt' ? parsed.unit : undefined;
  const rfc2822Zone = formatRfc2822(ms, zone);
  const rfc2822Utc = formatRfc2822(ms, 'UTC');
  const http = formatHttpDate(ms);
  const zoneShort = zone === 'UTC' ? 'UTC' : zoneCity(zone);
  const yearNote = 'only for years 0–9999';

  const unixRow = (unit: EpochUnit) => {
    const exact = formatEpoch(instant, unit);
    const floor = formatEpochFloor(instant, unit);
    return (
      <CopyRow
        key={unit}
        label={
          <span className="inline-flex items-center gap-1.5">
            {EPOCH_UNIT_LABEL[unit].replace(/^./, (c) => c.toUpperCase())}
            {inputUnit === unit && <Badge tone="accent">input</Badge>}
          </span>
        }
        value={floor}
        hint={exact !== floor ? `exact: ${exact}` : undefined}
      />
    );
  };

  const relative = relativeText(ms, now, zone);
  const altRow = (spec: (typeof ALT_EPOCHS)[number]) => (
    <CopyRow
      key={spec.id}
      label={
        <span className="inline-flex flex-wrap items-center gap-1.5">
          {spec.label}
          {inputUnit === spec.id && <Badge tone="accent">input</Badge>}
        </span>
      }
      hint={spec.id === 'excel' ? `wall time in ${zoneShort}` : undefined}
      value={formatAltEpoch(instant, spec.id, zone) ?? ''}
      empty="not representable in this format"
    />
  );

  return (
    <>
      <div className="grid min-w-0 grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <div className="flex min-w-0 flex-col gap-4">
          <Panel title="Unix timestamp" description="Whole units since 1970-01-01T00:00:00Z" bodyClassName="py-1">
            <div className="divide-y divide-line">{UNIX_UNITS.map(unixRow)}</div>
          </Panel>
          <Panel title="Calendar" bodyClassName="py-1">
            <div className="divide-y divide-line">
              <CopyRow
                label="ISO week date"
                value={calendarOk ? `${week.weekYear}-W${String(week.week).padStart(2, '0')}-${week.weekday}` : ''}
                empty="not available at the edge of the date range"
              />
              <CopyRow
                label="ISO ordinal date"
                value={calendarOk ? `${formatIsoDate(wall).slice(0, -6)}-${String(doy).padStart(3, '0')}` : ''}
                empty="not available at the edge of the date range"
              />
              <div className="flex flex-wrap gap-x-5 gap-y-1.5 py-2.5 text-[13px]">
                {calendarOk && <Fact label="Week">{week.week}</Fact>}
                {calendarOk && <Fact label="Day of year">{doy}</Fact>}
                <Fact label="Quarter">Q{quarter(wall.month)}</Fact>
                <Fact label="Offset">{formatUtcLabel(offset)}</Fact>
                <Fact label="Zone">{zoneAbbreviation(ms, zone, 'long')}</Fact>
              </div>
            </div>
          </Panel>
        </div>
        <Panel title="Date formats" bodyClassName="py-1">
          <div className="divide-y divide-line">
            <CopyRow label="ISO 8601 (UTC)" value={formatIsoUtc(instant)} />
            <CopyRow label={`ISO 8601 (${zoneShort})`} value={formatIsoInZone(instant, zone)} />
            <CopyRow label="RFC 9557 / Temporal" hint="offset plus zone name" value={formatRfc9557(instant, zone)} />
            <CopyRow label={`RFC 2822 (${zoneShort})`} value={rfc2822Zone ?? ''} empty={yearNote} />
            {zone !== 'UTC' && <CopyRow label="RFC 2822 (UTC)" value={rfc2822Utc ?? ''} empty={yearNote} />}
            <CopyRow label="HTTP date" hint="Last-Modified, Expires" value={http ?? ''} empty={yearNote} />
            <CopyRow label={`Readable (${zoneShort})`} value={formatHuman(ms, zone)} mono={false} />
            {zone !== 'UTC' && <CopyRow label="Readable (UTC)" value={formatHuman(ms, 'UTC')} mono={false} />}
            <CopyRow
              label="Relative"
              value={relative.precise ? `${relative.short} (${relative.precise})` : relative.short}
              mono={false}
            />
          </div>
        </Panel>
      </div>

      <Panel title="Other epochs" description="The same moment in other systems’ timestamp formats" bodyClassName="py-1">
        <div className="grid min-w-0 grid-cols-1 lg:grid-cols-2 lg:gap-x-8">
          <div className="divide-y divide-line">{ALT_EPOCHS.slice(0, 4).map(altRow)}</div>
          <div className="divide-y divide-line border-t border-line lg:border-t-0">{ALT_EPOCHS.slice(4).map(altRow)}</div>
        </div>
      </Panel>
      {inputUnit && <OtherReadings input={input} zone={zone} current={inputUnit} onPick={onPickUnit} />}
    </>
  );
}

function OtherReadings({
  input,
  zone,
  current,
  onPick,
}: {
  input: string;
  zone: string;
  current: EpochUnit | AltEpoch;
  onPick: (unit: EpochUnit | AltEpoch) => void;
}) {
  const readings = useMemo(() => interpretNumber(input, zone, current), [input, zone, current]);
  if (readings.length === 0) return null;
  return (
    <Panel title="Not the date you expected?" description="The same number read in other units that land between 1980 and 2099">
      <ul className="flex flex-col gap-1.5">
        {readings.map((r) => (
          <li key={r.unit} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-[13px]">
            <span className="min-w-0">
              <span className="text-fg-secondary">{unitLabel(r.unit)}</span>
              <span className="mx-1.5 text-fg-muted">→</span>
              <span className="font-mono text-fg">{formatIsoInZone(r.instant, zone).replace(/\.000(?=[+-Z])/, '')}</span>
            </span>
            <Button size="sm" variant="ghost" onClick={() => onPick(r.unit)}>
              Read as {isEpochUnit(r.unit) ? EPOCH_UNIT_LABEL[r.unit] : altEpochSpec(r.unit).label}
            </Button>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

export default function TimestampConverter() {
  const [input, setInput] = useToolState(TOOL, 'input', String(Math.floor(Date.now() / 1000)));
  const [storedUnit, setUnit] = useToolState<InputUnit>(TOOL, 'unit', 'auto');
  const [lastAlt, setLastAlt] = useToolState<AltEpoch>(TOOL, 'altEpoch', 'filetime');
  const [storedZone, setZone] = useToolState(TOOL, 'zone', localTimeZone());
  const zone = validZone(storedZone);
  const unit: InputUnit = storedUnit === 'auto' || isEpochUnit(storedUnit) || isAltEpoch(storedUnit) ? storedUnit : 'auto';
  const altUnit: AltEpoch = isAltEpoch(lastAlt) ? lastAlt : 'filetime';
  const now = useSecondClock();
  // The clock only matters for the literal "now"; other input is not re-parsed every second.
  const liveNow = /^\s*now\s*$/i.test(input) ? now : 0;

  const parsed = useMemo(
    () => (input.trim() ? parseDateInput(input, { zone, unit, now: liveNow || undefined }) : null),
    [input, zone, unit, liveNow],
  );

  const choice: UnitChoice = isAltEpoch(unit) ? 'other' : unit;
  const selectChoice = (next: UnitChoice) => setUnit(next === 'other' ? altUnit : next);

  /** The current time written in the selected unit, so "Now" never changes how the input is read. */
  const insertNow = () => {
    const current = { epochMs: Date.now(), nanos: 0 };
    if (isAltEpoch(unit)) setInput(formatAltEpoch(current, unit, zone) ?? String(Math.floor(current.epochMs / 1000)));
    else setInput(formatEpochFloor(current, unit === 'auto' ? 's' : unit));
  };

  return (
    <ToolStack>
      <LiveNow
        onUse={(text) => {
          setInput(text);
          setUnit('auto');
        }}
      />

      <Panel bodyClassName="flex flex-col gap-3.5">
        <div>
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <Label htmlFor="ts-input" className="mb-0">
              Timestamp or date
            </Label>
            <LinkButton onClick={insertNow} title="Insert the current time in the selected unit">
              Now
            </LinkButton>
          </div>
          <div className="relative">
            <input
              id="ts-input"
              className="lk-field pr-10 font-mono text-[15px]"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="1700000000, 1700000000000, 2023-11-14T22:13:20Z, Tue, 14 Nov 2023 22:13:20 GMT…"
              spellCheck={false}
              autoCapitalize="off"
              autoComplete="off"
              aria-invalid={parsed?.ok === false || undefined}
              aria-describedby="ts-input-info"
            />
            {input && (
              <IconButton
                icon={Eraser}
                label="Clear"
                size="sm"
                onClick={() => setInput('')}
                className="absolute top-1/2 right-1.5 -translate-y-1/2"
              />
            )}
          </div>
          <p id="ts-input-info" className="mt-1.5 min-h-[18px] text-[12.5px] text-fg-muted">
            {parsed?.ok ? describeInput(parsed.value, input, zone) : 'Numbers are read as Unix time; dates without an offset use the time zone below.'}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <span className="text-[12px] text-fg-muted">Examples:</span>
            {EXAMPLES.map((ex) => (
              <Chip
                key={ex}
                onClick={() => {
                  setInput(ex);
                  setUnit('auto');
                }}
              >
                {ex}
              </Chip>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-start gap-x-4 gap-y-3">
          <div>
            <Label className="flex min-h-5 items-center">Number unit</Label>
            <Segmented label="Number unit" size="sm" value={choice} onChange={selectChoice} options={UNIT_OPTIONS} />
          </div>
          {choice === 'other' && (
            <div className="min-w-0 flex-1 basis-56">
              <Label htmlFor="ts-alt" className="flex min-h-5 items-center">
                Epoch
              </Label>
              <Select
                id="ts-alt"
                value={altUnit}
                onChange={(e) => {
                  const next = e.target.value as AltEpoch;
                  setLastAlt(next);
                  setUnit(next);
                }}
              >
                {ALT_EPOCHS.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.label}
                  </option>
                ))}
              </Select>
            </div>
          )}
          <ZonePicker
            className="min-w-0 flex-1 basis-64"
            label="Time zone"
            value={zone}
            onChange={setZone}
            at={parsed?.ok ? parsed.value.instant.epochMs : now}
            action={
              <span className="flex gap-1">
                <LinkButton onClick={() => setZone(localTimeZone())}>Local</LinkButton>
                <LinkButton onClick={() => setZone('UTC')}>UTC</LinkButton>
              </span>
            }
          />
        </div>
      </Panel>

      {parsed === null && (
        <Panel>
          <EmptyState icon={Clock} title="Enter a timestamp or a date">
            Paste a Unix timestamp in seconds, milliseconds, microseconds or nanoseconds, or a date such as ISO 8601, RFC 2822
            or an HTTP date. Everything is converted on this device.
          </EmptyState>
        </Panel>
      )}
      {parsed?.ok === false && <ErrorMessage error={parsed.error} title="Can’t read that timestamp" />}
      {parsed?.ok && (
        <>
          {parsed.value.notes.length > 0 && (
            <Alert tone="info">
              {parsed.value.notes.length === 1 ? (
                parsed.value.notes[0]
              ) : (
                <ul className="list-disc pl-4">
                  {parsed.value.notes.map((n) => (
                    <li key={n}>{n}</li>
                  ))}
                </ul>
              )}
            </Alert>
          )}
          <Headline instant={parsed.value.instant} zone={zone} now={now} />
          <Results
            parsed={parsed.value}
            zone={zone}
            now={now}
            input={input}
            onPickUnit={(next) => {
              if (isAltEpoch(next)) setLastAlt(next);
              setUnit(next);
            }}
          />
          <p className="px-1 text-[12px] text-fg-muted">
            Unix time counts seconds since 1970-01-01 UTC and ignores leap seconds. Conversions use your browser’s time-zone
            data and happen entirely on this device.
          </p>
        </>
      )}
    </ToolStack>
  );
}
