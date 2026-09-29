import { useMemo } from 'react';
import { ArrowLeftRight, CalendarRange } from 'lucide-react';
import { ToolStack } from '@/components/tool/EditorPanel';
import { Badge, Panel } from '@/components/ui/Panel';
import { Alert, ErrorMessage } from '@/components/ui/Alert';
import { IconButton } from '@/components/ui/Button';
import { CopyButton } from '@/components/ui/Actions';
import { Checkbox, Label } from '@/components/ui/Field';
import { Segmented } from '@/components/ui/Segmented';
import { EmptyState } from '@/components/ui/Feedback';
import { useToolState } from '@/lib/hooks';
import { ZonePicker } from './components/ZonePicker';
import { BigValue, DateTimeInput, LinkButton, nowInputValue, parseInputValue, todayInputValue, validZone } from './components/shared';
import { MS_PER_DAY, MS_PER_HOUR, MS_PER_MINUTE } from './lib/civil';
import { formatCalendarDiff, formatWeeksAndDays, type DateDifference as Difference } from './lib/datemath';
import { computeDifference, longDate, type DifferenceMode as Mode } from './lib/difference';
import { localTimeZone } from './lib/tz';

const TOOL = 'date-difference';

const fmt = (n: number, digits = 0) => n.toLocaleString('en-US', { maximumFractionDigits: digits });

function nextNewYear(zone: string): string {
  const year = Number(todayInputValue(zone).slice(0, 4)) + 1;
  return `${year}-01-01`;
}

function Totals({ d, mode }: { d: Difference; mode: Mode }) {
  const sign = d.totalMs < 0 ? '−' : '';
  const days = Math.abs(d.calendarDays);
  const abs = Math.abs(d.totalMs);
  const months = d.diff.years * 12 + d.diff.months;
  // Date mode counts whole calendar days; date-time mode shows exact elapsed time.
  const totalDays = mode === 'date' ? days : abs / MS_PER_DAY;
  const hours = mode === 'date' ? days * 24 : abs / MS_PER_HOUR;
  const minutes = mode === 'date' ? days * 1440 : abs / MS_PER_MINUTE;
  const seconds = mode === 'date' ? days * 86_400 : abs / 1000;
  const wholeDays = Math.floor(totalDays);
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      <BigValue label="Days" value={`${sign}${fmt(totalDays, 2)}`} sub={mode === 'date' ? 'calendar days' : 'exact, 24-hour days'} />
      <BigValue label="Weeks" value={`${sign}${fmt(totalDays / 7, 2)}`} sub={formatWeeksAndDays(wholeDays)} />
      <BigValue
        label="Months"
        value={`${sign}${fmt(months)}`}
        sub={`${fmt(months)} month${months === 1 ? '' : 's'} and ${fmt(d.diff.days)} day${d.diff.days === 1 ? '' : 's'}`}
      />
      <BigValue label="Business days" value={`${sign}${fmt(Math.abs(d.businessDays))}`} sub="Monday to Friday" />
      <BigValue label="Weekend days" value={`${sign}${fmt(Math.abs(d.weekendDays))}`} sub="Saturday and Sunday" />
      <BigValue label="Hours" value={`${sign}${fmt(hours, 2)}`} />
      <BigValue label="Minutes" value={`${sign}${fmt(minutes, 2)}`} />
      <BigValue label="Seconds" value={`${sign}${fmt(seconds, 3)}`} />
    </div>
  );
}

export default function DateDifference() {
  const local = localTimeZone();
  const [mode, setMode] = useToolState<Mode>(TOOL, 'mode', 'date');
  const [startDate, setStartDate] = useToolState(TOOL, 'startDate', todayInputValue(local));
  const [endDate, setEndDate] = useToolState(TOOL, 'endDate', nextNewYear(local));
  const [startDT, setStartDT] = useToolState(TOOL, 'startDateTime', nowInputValue(local));
  const [endDT, setEndDT] = useToolState(TOOL, 'endDateTime', `${nextNewYear(local)}T00:00:00`);
  const [storedZone, setZone] = useToolState(TOOL, 'zone', local);
  const [storedEndZone, setEndZone] = useToolState(TOOL, 'endZone', local);
  const [separateZones, setSeparateZones] = useToolState(TOOL, 'separateZones', false);
  const [includeEnd, setIncludeEnd] = useToolState(TOOL, 'includeEnd', false);

  const zone = validZone(storedZone);
  const endZone = separateZones ? validZone(storedEndZone) : zone;
  const isDate = mode === 'date';
  const startText = isDate ? startDate : startDT;
  const endText = isDate ? endDate : endDT;
  const setStart = isDate ? setStartDate : setStartDT;
  const setEnd = isDate ? setEndDate : setEndDT;

  const outcome = useMemo(
    () => computeDifference(mode, startText, endText, { startZone: zone, endZone, includeEnd }),
    [mode, startText, endText, zone, endZone, includeEnd],
  );

  const now = (z: string) => (isDate ? todayInputValue(z) : nowInputValue(z));
  const result = outcome?.ok ? outcome.value : null;
  const reversed = result ? result.d.totalMs < 0 || result.d.calendarDays < 0 : false;
  const headline = result ? formatCalendarDiff(result.d.diff, !isDate) : '';
  const summary = result
    ? [
        `From ${longDate(result.start, !isDate)} to ${longDate(result.end, !isDate)}${isDate && includeEnd ? ' (end date included)' : ''}`,
        `${reversed ? '−' : ''}${headline}`,
        `${fmt(Math.abs(result.d.calendarDays))} calendar days, ${fmt(Math.abs(result.d.businessDays))} business days`,
      ].join('\n')
    : '';

  return (
    <ToolStack>
      <Panel bodyClassName="flex flex-col gap-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <Label>Compare</Label>
            <Segmented
              label="Compare"
              value={mode}
              onChange={setMode}
              options={[
                { value: 'date', label: 'Dates' },
                { value: 'datetime', label: 'Dates and times' },
              ]}
            />
          </div>
          {isDate ? (
            <Checkbox
              label="Include the end date"
              description="Counts both the first and the last day (adds one day)."
              checked={includeEnd}
              onChange={setIncludeEnd}
            />
          ) : (
            <Checkbox label="Different time zone for the end" checked={separateZones} onChange={setSeparateZones} />
          )}
        </div>
        <div className="grid min-w-0 grid-cols-1 items-end gap-3 md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
          <DateTimeInput
            label="Start"
            value={startText}
            onChange={setStart}
            dateOnly={isDate}
            invalid={Boolean(startText) && !parseInputValue(startText)}
            action={<LinkButton onClick={() => setStart(now(zone))}>{isDate ? 'Today' : 'Now'}</LinkButton>}
          />
          <IconButton
            icon={ArrowLeftRight}
            label="Swap start and end"
            variant="secondary"
            className="justify-self-center max-md:rotate-90"
            onClick={() => {
              setStart(endText);
              setEnd(startText);
            }}
          />
          <DateTimeInput
            label="End"
            value={endText}
            onChange={setEnd}
            dateOnly={isDate}
            invalid={Boolean(endText) && !parseInputValue(endText)}
            action={<LinkButton onClick={() => setEnd(now(endZone))}>{isDate ? 'Today' : 'Now'}</LinkButton>}
          />
        </div>
        {!isDate && (
          <div className="grid min-w-0 grid-cols-1 gap-3 md:grid-cols-2">
            <ZonePicker label={separateZones ? 'Start time zone' : 'Time zone'} value={zone} onChange={setZone} />
            {separateZones && <ZonePicker label="End time zone" value={endZone} onChange={setEndZone} />}
          </div>
        )}
      </Panel>

      {outcome === null && (
        <Panel>
          <EmptyState icon={CalendarRange} title="Pick two dates">
            Choose a start and an end to see the years, months and days between them, with totals and business days.
          </EmptyState>
        </Panel>
      )}
      {outcome?.ok === false && <ErrorMessage error={outcome.error} />}
      {result && (
        <>
          <section
            aria-label="Difference"
            className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-accent-line bg-accent-soft px-4 py-3.5"
          >
            <div className="min-w-0">
              <p className="text-[20px] leading-snug font-semibold tracking-tight text-fg">
                {reversed && '−'}
                {headline}
              </p>
              <p className="mt-1 text-[13px] text-fg-secondary">
                From {longDate(result.start, !isDate)} to {longDate(result.end, !isDate)}
                {isDate && includeEnd && ', counting the end date'}
              </p>
              {reversed && (
                <p className="mt-1.5">
                  <Badge tone="warning">The end is before the start</Badge>
                </p>
              )}
            </div>
            <CopyButton value={summary} label="Copy summary" />
          </section>
          {result.notes.length > 0 && (
            <Alert tone="info">
              {result.notes.length === 1 ? (
                result.notes[0]
              ) : (
                <ul className="list-disc pl-4">
                  {result.notes.map((n) => (
                    <li key={n}>{n}</li>
                  ))}
                </ul>
              )}
            </Alert>
          )}
          <Totals d={result.d} mode={mode} />
          <p className="px-1 text-[12px] text-fg-muted">
            {isDate
              ? 'Business days exclude Saturdays and Sundays; public holidays are not taken into account.'
              : 'Totals are exact elapsed time. Business days count the weekdays from the start date up to, but not including, the end date.'}
          </p>
        </>
      )}
    </ToolStack>
  );
}
