import { useMemo } from 'react';
import { Eraser, Hourglass } from 'lucide-react';
import { ToolStack } from '@/components/tool/EditorPanel';
import { Badge, Panel } from '@/components/ui/Panel';
import { Alert, ErrorMessage } from '@/components/ui/Alert';
import { IconButton } from '@/components/ui/Button';
import { CopyButton } from '@/components/ui/Actions';
import { Label, Select } from '@/components/ui/Field';
import { EmptyState } from '@/components/ui/Feedback';
import { useToolState } from '@/lib/hooks';
import { cn } from '@/lib/utils';
import { Chip, CopyRow } from './components/shared';
import {
  UNIT_LABEL,
  UNIT_MS,
  convertDuration,
  formatClockDuration,
  formatCompactDuration,
  formatDayClockDuration,
  formatGoDuration,
  formatHumanDuration,
  formatIsoDuration,
  formatUnitValue,
  parseDuration,
  type DurationFormat,
  type DurationUnit,
} from './lib/duration';

const TOOL = 'duration-converter';

const UNITS: DurationUnit[] = ['ns', 'us', 'ms', 's', 'min', 'h', 'd', 'w', 'mo', 'y'];
const SYMBOL: Record<DurationUnit, string> = {
  ns: 'ns',
  us: 'µs',
  ms: 'ms',
  s: 's',
  min: 'min',
  h: 'h',
  d: 'd',
  w: 'wk',
  mo: 'mo',
  y: 'yr',
};

const EXAMPLES = ['PT1H30M', '1h 30m', '01:30:00', '90 minutes', '5400', '2 days 4 hours', 'P1Y2M10D', '1.5s', '-45m', '1.02:03:04'];

const FORMAT_TEXT: Record<DurationFormat, string> = {
  iso: 'Read as an ISO 8601 duration.',
  human: 'Read as amounts with units.',
  clock: 'Read as clock notation (hours:minutes:seconds).',
  timespan: 'Read as a .NET TimeSpan (days.hours:minutes:seconds).',
  number: 'Read as a plain number in the unit below.',
};

const isUnit = (u: string): u is DurationUnit => (UNITS as string[]).includes(u);

/** 5400000000000 → 5,400,000,000,000 for reading; copies keep the plain digits. */
function groupDigits(v: string): string {
  if (/e/i.test(v)) return v;
  const [int, frac] = v.split('.');
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return frac ? `${grouped}.${frac}` : grouped;
}

export default function DurationConverter() {
  const [input, setInput] = useToolState(TOOL, 'input', '1h 30m');
  const [storedUnit, setNumberUnit] = useToolState<DurationUnit>(TOOL, 'numberUnit', 's');
  const numberUnit = isUnit(storedUnit) ? storedUnit : 's';

  const parsed = useMemo(() => (input.trim() ? parseDuration(input, numberUnit) : null), [input, numberUnit]);
  const value = parsed?.ok ? parsed.value : null;

  const go = value ? formatGoDuration(value.ms) : null;

  return (
    <ToolStack>
      <Panel bodyClassName="flex flex-col gap-3">
        <div>
          <Label htmlFor="duration-input">Duration</Label>
          <div className="relative">
            <input
              id="duration-input"
              className="lk-field pr-10 font-mono text-[15px]"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="PT1H30M, 1h 30m, 01:30:00, 90 minutes, 5400…"
              spellCheck={false}
              autoCapitalize="off"
              autoComplete="off"
              aria-invalid={parsed?.ok === false || undefined}
              aria-describedby="duration-info"
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
          <p id="duration-info" className="mt-1.5 min-h-[18px] text-[12.5px] text-fg-muted">
            {value
              ? FORMAT_TEXT[value.format]
              : 'ISO 8601 (PT1H30M), text with units (1h 30m, 2 days 4 hours), clock time (01:30:00) or a plain number.'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[12px] text-fg-muted">Examples:</span>
          {EXAMPLES.map((ex) => (
            <Chip key={ex} onClick={() => setInput(ex)} active={input === ex}>
              {ex}
            </Chip>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Label htmlFor="duration-unit" className="mb-0">
            Plain numbers are in
          </Label>
          <Select
            id="duration-unit"
            value={numberUnit}
            onChange={(e) => setNumberUnit(e.target.value as DurationUnit)}
            className="w-auto min-w-40"
          >
            {UNITS.map((u) => (
              <option key={u} value={u}>
                {UNIT_LABEL[u].replace(' (avg.)', '')}
              </option>
            ))}
          </Select>
        </div>
      </Panel>

      {parsed === null && (
        <Panel>
          <EmptyState icon={Hourglass} title="Enter a duration">
            Type a duration in any common notation to see it in every format and unit.
          </EmptyState>
        </Panel>
      )}
      {parsed?.ok === false && <ErrorMessage error={parsed.error} title="Can’t read that duration" />}
      {value && (
        <>
          <section
            aria-label="Duration"
            className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-accent-line bg-accent-soft px-4 py-3.5"
          >
            <div className="min-w-0">
              <p className="text-[20px] leading-snug font-semibold tracking-tight break-words text-fg">{formatHumanDuration(value.ms)}</p>
              <p className="mt-1 flex flex-wrap items-center gap-2 text-[13px] text-fg-secondary">
                <span className="font-mono">{formatIsoDuration(value.ms)}</span>
                {value.nominal && <Badge tone="warning">uses average months or years</Badge>}
              </p>
            </div>
            <CopyButton value={formatHumanDuration(value.ms)} label="Copy" />
          </section>
          {value.note && <Alert tone="info">{value.note}</Alert>}
          {value.nominal && (
            <Alert tone="info" title="Months and years have no fixed length">
              They are converted with averages from the Gregorian calendar: 1 month = 30.436875 days and 1 year = 365.2425 days.
              To add real calendar months to a date, use the Date Calculator.
            </Alert>
          )}
          <div className="grid min-w-0 grid-cols-1 items-start gap-4 lg:grid-cols-2">
            <Panel title="Formats" bodyClassName="py-1">
              <div className="divide-y divide-line">
                <CopyRow label="ISO 8601" value={formatIsoDuration(value.ms)} />
                <CopyRow label="Readable" value={formatHumanDuration(value.ms)} mono={false} />
                <CopyRow label="Compact" value={formatCompactDuration(value.ms)} />
                <CopyRow label="Clock" hint="total hours" value={formatClockDuration(value.ms)} />
                <CopyRow label=".NET TimeSpan" hint="days.hours:minutes:seconds" value={formatDayClockDuration(value.ms)} />
                <CopyRow label="Go time.Duration" value={go ?? ''} empty="beyond Go’s ±292-year limit" />
              </div>
            </Panel>
            <Panel title="In every unit" bodyClassName="p-0">
              <table className="w-full text-[13px]">
                <caption className="sr-only">The duration converted to each unit</caption>
                <tbody>
                  {UNITS.map((u) => {
                    const v = formatUnitValue(convertDuration(value.ms, u));
                    const nominal = u === 'mo' || u === 'y';
                    return (
                      <tr key={u} className="border-b border-line last:border-b-0">
                        <th scope="row" className="py-2 pr-2 pl-4 text-left font-normal text-fg-muted">
                          {UNIT_LABEL[u]}
                        </th>
                        <td className={cn('px-2 py-2 text-right font-mono break-all text-fg tabular-nums', nominal && 'text-fg-secondary')}>
                          {groupDigits(v)} <span className="text-fg-muted">{SYMBOL[u]}</span>
                        </td>
                        <td className="w-10 py-1 pr-3">
                          <CopyButton value={v} iconOnly label={`Copy ${UNIT_LABEL[u].toLowerCase()}`} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </Panel>
          </div>
          <p className="px-1 text-[12px] text-fg-muted">
            A day is counted as exactly 24 hours ({(UNIT_MS.d / 1000).toLocaleString('en-US')} seconds) and a week as 7 days.
          </p>
        </>
      )}
    </ToolStack>
  );
}
