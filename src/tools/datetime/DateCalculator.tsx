import { useMemo } from 'react';
import { CalendarPlus, Minus, Plus, RotateCcw } from 'lucide-react';
import { ToolStack } from '@/components/tool/EditorPanel';
import { Badge, Panel } from '@/components/ui/Panel';
import { Alert, ErrorMessage } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Checkbox, Field, Label, NumberInput } from '@/components/ui/Field';
import { Segmented } from '@/components/ui/Segmented';
import { EmptyState } from '@/components/ui/Feedback';
import { useToolState } from '@/lib/hooks';
import { ZonePicker } from './components/ZonePicker';
import { Chip, CopyRow, DateTimeInput, LinkButton, nowInputValue, parseInputValue, todayInputValue, validZone } from './components/shared';
import { WEEKDAY_NAMES, dayOfWeek, dayOfYear, epochDay, formatIsoDate, isoWeek } from './lib/civil';
import { calculateDate, type CalcAmounts, type CalcMode } from './lib/datecalc';
import { formatIsoInZone } from './lib/timestamp';
import { formatUtcLabel, localTimeZone, namedAbbreviation, tzOffsetMs, wallInZone, zoneCity } from './lib/tz';
import { longDate } from './lib/difference';

const TOOL = 'date-calculator';

type AmountKey = keyof CalcAmounts;
type AmountInputs = Record<AmountKey, number | ''>;

const FIELDS: Array<{ key: AmountKey; label: string; time?: boolean }> = [
  { key: 'years', label: 'Years' },
  { key: 'months', label: 'Months' },
  { key: 'weeks', label: 'Weeks' },
  { key: 'days', label: 'Days' },
  { key: 'hours', label: 'Hours', time: true },
  { key: 'minutes', label: 'Minutes', time: true },
  { key: 'seconds', label: 'Seconds', time: true },
];

const EMPTY: AmountInputs = { years: '', months: '', weeks: '', days: '', hours: '', minutes: '', seconds: '' };

const PRESETS: Array<{ label: string; amounts: Partial<AmountInputs>; direction: 'add' | 'subtract'; business?: boolean }> = [
  { label: '+7 days', amounts: { days: 7 }, direction: 'add' },
  { label: '+30 days', amounts: { days: 30 }, direction: 'add' },
  { label: '+90 days', amounts: { days: 90 }, direction: 'add' },
  { label: '+6 months', amounts: { months: 6 }, direction: 'add' },
  { label: '+1 year', amounts: { years: 1 }, direction: 'add' },
  { label: '+10 business days', amounts: { days: 10 }, direction: 'add', business: true },
  { label: '−1 month', amounts: { months: 1 }, direction: 'subtract' },
  { label: '−100 days', amounts: { days: 100 }, direction: 'subtract' },
];

function toNumbers(inputs: AmountInputs, mode: CalcMode): CalcAmounts {
  const n = (v: number | '' | undefined) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  return {
    years: n(inputs.years),
    months: n(inputs.months),
    weeks: n(inputs.weeks),
    days: n(inputs.days),
    hours: mode === 'date' ? 0 : n(inputs.hours),
    minutes: mode === 'date' ? 0 : n(inputs.minutes),
    seconds: mode === 'date' ? 0 : n(inputs.seconds),
  };
}

export default function DateCalculator() {
  const local = localTimeZone();
  const [mode, setMode] = useToolState<CalcMode>(TOOL, 'mode', 'date');
  const [startDate, setStartDate] = useToolState(TOOL, 'startDate', todayInputValue(local));
  const [startDT, setStartDT] = useToolState(TOOL, 'startDateTime', nowInputValue(local));
  const [storedZone, setZone] = useToolState(TOOL, 'zone', local);
  const [direction, setDirection] = useToolState<'add' | 'subtract'>(TOOL, 'direction', 'add');
  const [stored, setAmounts] = useToolState<AmountInputs>(TOOL, 'amounts', { ...EMPTY, days: 30 });
  const [businessDays, setBusinessDays] = useToolState(TOOL, 'businessDays', false);

  const zone = validZone(storedZone);
  const isDate = mode === 'date';
  const inputs: AmountInputs = { ...EMPTY, ...stored };
  const startText = isDate ? startDate : startDT;
  const setStart = isDate ? setStartDate : setStartDT;
  // The amounts object is rebuilt every render, so memoize on its serialized form.
  const amountsKey = JSON.stringify(toNumbers(inputs, mode));

  const outcome = useMemo(
    () => calculateDate(mode, startText, JSON.parse(amountsKey) as CalcAmounts, { zone, direction, businessDays }),
    [mode, startText, amountsKey, zone, direction, businessDays],
  );

  const setAmount = (key: AmountKey, value: number | '') => setAmounts({ ...inputs, [key]: value });
  const today = epochDay(wallInZone(Date.now(), isDate ? local : zone));

  return (
    <ToolStack>
      <Panel bodyClassName="flex flex-col gap-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <Label>Work with</Label>
            <Segmented
              label="Work with"
              value={mode}
              onChange={setMode}
              options={[
                { value: 'date', label: 'Dates' },
                { value: 'datetime', label: 'Dates and times' },
              ]}
            />
          </div>
          <Segmented
            label="Operation"
            value={direction}
            onChange={setDirection}
            options={[
              { value: 'add', label: 'Add', icon: Plus },
              { value: 'subtract', label: 'Subtract', icon: Minus },
            ]}
          />
        </div>
        <div className="grid min-w-0 grid-cols-1 gap-3 md:grid-cols-2">
          <DateTimeInput
            label="Start"
            value={startText}
            onChange={setStart}
            dateOnly={isDate}
            invalid={Boolean(startText) && !parseInputValue(startText)}
            action={<LinkButton onClick={() => setStart(isDate ? todayInputValue(local) : nowInputValue(zone))}>{isDate ? 'Today' : 'Now'}</LinkButton>}
          />
          {!isDate && <ZonePicker label="Time zone" value={zone} onChange={setZone} />}
        </div>
        <div className={isDate ? 'grid grid-cols-2 gap-3 sm:grid-cols-4' : 'grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7'}>
          {FIELDS.filter((f) => !f.time || !isDate).map((f) => (
            <Field key={f.key} label={f.key === 'days' && businessDays ? 'Business days' : f.label}>
              {({ id }) => (
                <NumberInput
                  id={id}
                  value={inputs[f.key]}
                  onChange={(v) => setAmount(f.key, v)}
                  placeholder="0"
                  step={f.time || !isDate ? 'any' : 1}
                  min={0}
                  className="font-mono"
                />
              )}
            </Field>
          ))}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Checkbox
            label="Count days as business days"
            description="Skips Saturdays and Sundays; a week counts as 5 business days."
            checked={businessDays}
            onChange={setBusinessDays}
          />
          <Button size="sm" variant="ghost" icon={RotateCcw} onClick={() => setAmounts(EMPTY)}>
            Clear amounts
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[12px] text-fg-muted">Quick:</span>
          {PRESETS.map((p) => (
            <Chip
              key={p.label}
              mono={false}
              onClick={() => {
                setAmounts({ ...EMPTY, ...p.amounts });
                setDirection(p.direction);
                setBusinessDays(Boolean(p.business));
              }}
            >
              {p.label}
            </Chip>
          ))}
        </div>
      </Panel>

      {outcome === null && (
        <Panel>
          <EmptyState icon={CalendarPlus} title="Pick a start date">
            Choose a date, then add or subtract years, months, weeks, days{isDate ? '' : ' and time'}.
          </EmptyState>
        </Panel>
      )}
      {outcome?.ok === false && <ErrorMessage error={outcome.error} />}
      {outcome?.ok && outcome.value.steps.length === 0 && (
        <Alert tone="info">Enter an amount to {direction === 'add' ? 'add to' : 'subtract from'} the start date.</Alert>
      )}
      {outcome?.ok && outcome.value.steps.length > 0 && (() => {
        const r = outcome.value;
        const resultZone = isDate ? 'UTC' : zone;
        const wall = wallInZone(r.epochMs, resultZone);
        const week = isoWeek(wall);
        const fromToday = epochDay(wall) - today;
        const abbr = isDate ? null : namedAbbreviation(r.epochMs, zone);
        return (
          <>
            <section
              aria-label="Result"
              className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-accent-line bg-accent-soft px-4 py-3.5"
            >
              <div className="min-w-0">
                <p className="text-[12.5px] text-fg-secondary">
                  {longDate(r.start, !isDate)} {direction === 'add' ? '+' : '−'} {r.amountText}
                </p>
                <p className="mt-0.5 text-[21px] leading-snug font-semibold tracking-tight text-fg">{longDate(wall, false)}</p>
                {!isDate && (
                  <p className="mt-1 flex flex-wrap items-center gap-2">
                    <span className="font-mono text-[17px] font-semibold text-fg tabular-nums">
                      {String(wall.hour).padStart(2, '0')}:{String(wall.minute).padStart(2, '0')}:{String(wall.second).padStart(2, '0')}
                    </span>
                    {abbr && <Badge>{abbr}</Badge>}
                    <Badge>{formatUtcLabel(tzOffsetMs(r.epochMs, zone))}</Badge>
                    <span className="text-[12.5px] text-fg-muted">{zoneCity(zone)}</span>
                  </p>
                )}
              </div>
              <p className="text-[13px] text-fg-secondary">
                {fromToday === 0 ? 'Today' : fromToday > 0 ? `${fromToday.toLocaleString('en-US')} days from today` : `${(-fromToday).toLocaleString('en-US')} days ago`}
              </p>
            </section>
            {r.clamped && (
              <Alert tone="warning" title="The day was clamped to the end of the month">
                The target month is shorter than the start day, so the result is the last day of that month. Add days separately
                if you need to overflow into the next month.
              </Alert>
            )}
            <div className="grid min-w-0 grid-cols-1 items-start gap-4 lg:grid-cols-2">
              <Panel title="Result" bodyClassName="py-1">
                <div className="divide-y divide-line">
                  <CopyRow label="Date" value={formatIsoDate(wall)} />
                  {!isDate && <CopyRow label="Date and time" value={formatIsoInZone({ epochMs: r.epochMs, nanos: 0 }, zone).replace('.000', '')} />}
                  {!isDate && <CopyRow label="Unix timestamp" value={String(Math.floor(r.epochMs / 1000))} />}
                  <CopyRow label="Weekday" value={WEEKDAY_NAMES[dayOfWeek(wall)]} mono={false} />
                  <CopyRow label="ISO week" value={`${week.weekYear}-W${String(week.week).padStart(2, '0')}`} />
                  <CopyRow label="Day of year" value={String(dayOfYear(wall))} />
                </div>
              </Panel>
              <Panel title="How it was calculated">
                <ol className="flex flex-col gap-2.5">
                  {r.steps.map((s, i) => (
                    <li key={i} className="flex gap-2.5 text-[13px]">
                      <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-surface-hover text-[11px] font-semibold text-fg-secondary">
                        {i + 1}
                      </span>
                      <span className="min-w-0">
                        <span className="font-medium text-fg">{s.label}</span>
                        <span className="block text-fg-secondary">{s.detail}</span>
                      </span>
                    </li>
                  ))}
                </ol>
              </Panel>
            </div>
          </>
        );
      })()}
    </ToolStack>
  );
}
