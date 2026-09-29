import { useRef, useState, type KeyboardEvent } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import { ToolStack } from '@/components/tool/EditorPanel';
import { Panel } from '@/components/ui/Panel';
import { Button, IconButton } from '@/components/ui/Button';
import { CopyButton } from '@/components/ui/Actions';
import { Field, Input, Label } from '@/components/ui/Field';
import { Segmented } from '@/components/ui/Segmented';
import { EmptyState } from '@/components/ui/Feedback';
import { useToolState } from '@/lib/hooks';
import { cn } from '@/lib/utils';
import { BigValue, CopyRow, DateTimeInput, LinkButton, parseInputValue, todayInputValue } from './components/shared';
import {
  MONTH_NAMES,
  WEEKDAY_NAMES,
  WEEKDAY_SHORT,
  addDays,
  addMonths,
  datePart,
  dayOfWeek,
  formatIsoDate,
  fromIsoWeek,
  simpleWeekNumber,
  type PlainDate,
} from './lib/civil';
import { calendarInfo, monthGrid, parseIsoWeek } from './lib/calendarInfo';
import { localTimeZone } from './lib/tz';

const TOOL = 'week-number';
const ORDINAL = ['', 'first', 'second', 'third', 'fourth', 'fifth'];

const sameDay = (a: PlainDate, b: PlainDate) => a.year === b.year && a.month === b.month && a.day === b.day;
const pad2 = (n: number) => String(n).padStart(2, '0');
const isoWeekText = (weekYear: number, week: number) => `${weekYear}-W${pad2(week)}`;

/** "Mon, Sep 28 – Sun, Oct 4, 2026" (the first year only when it differs). */
function rangeText(a: PlainDate, b: PlainDate): string {
  const f = (d: PlainDate, withYear: boolean) =>
    `${WEEKDAY_SHORT[dayOfWeek(d)]}, ${MONTH_NAMES[d.month - 1].slice(0, 3)} ${d.day}${withYear ? `, ${d.year}` : ''}`;
  return `${f(a, a.year !== b.year)} – ${f(b, true)}`;
}

/** Days from the first day of the displayed week to `d`. */
const weekIndex = (d: PlainDate, start: number) => (7 + dayOfWeek(d) - start) % 7;

export default function WeekNumber() {
  const local = localTimeZone();
  const [stored, setStored] = useToolState(TOOL, 'date', todayInputValue(local));
  const [weekStart, setWeekStart] = useToolState<'1' | '0'>(TOOL, 'weekStart', '1');
  const [jump, setJump] = useState('');
  const parsed = parseInputValue(stored);
  const date = parsed ? datePart(parsed) : null;
  const today = datePart(parseInputValue(todayInputValue(local))!);
  const [view, setView] = useState<{ year: number; month: number }>(() => {
    const d = date ?? today;
    return { year: d.year, month: d.month };
  });
  const gridRef = useRef<HTMLDivElement>(null);
  const start = weekStart === '0' ? 0 : 1;

  const select = (d: PlainDate, focus = false) => {
    setStored(formatIsoDate(d));
    setView({ year: d.year, month: d.month });
    if (focus) requestAnimationFrame(() => gridRef.current?.querySelector<HTMLElement>('[data-selected="true"]')?.focus());
  };

  const jumpParsed = jump.trim() ? parseIsoWeek(jump) : null;
  const jumpError = jump.trim() && !jumpParsed ? 'Use the ISO week format, e.g. 2026-W40 (weeks 1–52, or 53 in long years).' : null;

  const onGridKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!date) return;
    const moves: Record<string, () => PlainDate> = {
      ArrowLeft: () => addDays(date, -1),
      ArrowRight: () => addDays(date, 1),
      ArrowUp: () => addDays(date, -7),
      ArrowDown: () => addDays(date, 7),
      PageUp: () => addMonths(date, -1).date,
      PageDown: () => addMonths(date, 1).date,
      Home: () => addDays(date, -weekIndex(date, start)),
      End: () => addDays(date, 6 - weekIndex(date, start)),
    };
    const move = moves[event.key];
    if (!move) return;
    event.preventDefault();
    select(move(), true);
  };

  const info = date ? calendarInfo(date, start) : null;
  const grid = monthGrid(view.year, view.month, start);
  const headers = Array.from({ length: 7 }, (_, i) => WEEKDAY_SHORT[(start + i) % 7]);

  return (
    <ToolStack>
      <Panel bodyClassName="grid min-w-0 grid-cols-1 items-start gap-3 md:grid-cols-3">
        <DateTimeInput
          label="Date"
          value={stored}
          onChange={(v) => {
            setStored(v);
            const d = parseInputValue(v);
            if (d) setView({ year: d.year, month: d.month });
          }}
          dateOnly
          invalid={Boolean(stored) && !parsed}
          action={<LinkButton onClick={() => select(today)}>Today</LinkButton>}
        />
        <Field label="Go to ISO week" error={jumpError} hint="Type a week such as 2026-W40 or 2026-W40-5.">
          {({ id, describedBy, invalid }) => (
            <div className="flex gap-2">
              <Input
                id={id}
                aria-describedby={describedBy}
                aria-invalid={invalid || undefined}
                mono
                value={jump}
                placeholder="2026-W40"
                onChange={(e) => setJump(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && jumpParsed) select(fromIsoWeek(jumpParsed.weekYear, jumpParsed.week, jumpParsed.weekday ?? 1));
                }}
                spellCheck={false}
                autoComplete="off"
              />
              <Button
                disabled={!jumpParsed}
                onClick={() => jumpParsed && select(fromIsoWeek(jumpParsed.weekYear, jumpParsed.week, jumpParsed.weekday ?? 1))}
              >
                Go
              </Button>
            </div>
          )}
        </Field>
        <div>
          <Label>Weeks start on</Label>
          <Segmented
            label="Weeks start on"
            value={weekStart}
            onChange={setWeekStart}
            options={[
              { value: '1', label: 'Monday (ISO)' },
              { value: '0', label: 'Sunday (US)' },
            ]}
          />
        </div>
      </Panel>

      {!info || !date ? (
        <Panel>
          <EmptyState icon={CalendarDays} title="Pick a date">
            Choose a date to see its ISO week number, day of the year, quarter and a calendar with week numbers.
          </EmptyState>
        </Panel>
      ) : (
        <>
          <section
            aria-label="Week"
            className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-accent-line bg-accent-soft px-4 py-3.5"
          >
            <div className="min-w-0">
              <p className="text-[12.5px] text-fg-secondary">
                {info.weekdayName}, {info.monthName} {date.day}, {date.year}
              </p>
              <p className="text-[24px] leading-tight font-semibold tracking-tight text-fg">
                Week {info.isoWeek}
                {info.isoWeekYear !== date.year && <span className="text-[16px] font-medium text-fg-secondary"> of {info.isoWeekYear}</span>}
              </p>
              <p className="mt-0.5 text-[13px] text-fg-secondary">
                <span className="font-mono">{isoWeekText(info.isoWeekYear, info.isoWeek)}</span> ·{' '}
                {rangeText(info.isoWeekStart, info.isoWeekEnd)}
              </p>
            </div>
            <CopyButton value={isoWeekText(info.isoWeekYear, info.isoWeek)} label="Copy week" />
          </section>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <BigValue label="ISO week" value={`${info.isoWeek} / ${info.isoWeeksInYear}`} sub={`weeks in ${info.isoWeekYear}`} />
            <BigValue label="Day of year" value={`${info.dayOfYear} / ${info.daysInYear}`} sub={`${info.daysLeftInYear} days left`} />
            <BigValue label="Quarter" value={`Q${info.quarter}`} sub={`day ${info.dayOfQuarter} of ${info.daysInQuarter}`} />
            <BigValue label="Days in month" value={info.daysInMonth} sub={info.monthName} />
            <BigValue label="Leap year" value={info.leapYear ? 'Yes' : 'No'} sub={`${date.year} has ${info.daysInYear} days`} />
            <BigValue label="Year elapsed" value={`${info.yearProgress.toFixed(1)}%`} sub="at the start of this day" />
          </div>

          <div className="grid min-w-0 grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
            <Panel
              title={`${MONTH_NAMES[view.month - 1]} ${view.year}`}
              actions={
                <>
                  <IconButton
                    icon={ChevronLeft}
                    size="sm"
                    label="Previous month"
                    onClick={() => setView(view.month === 1 ? { year: view.year - 1, month: 12 } : { year: view.year, month: view.month - 1 })}
                  />
                  <Button size="sm" variant="ghost" onClick={() => select(today)}>
                    Today
                  </Button>
                  <IconButton
                    icon={ChevronRight}
                    size="sm"
                    label="Next month"
                    onClick={() => setView(view.month === 12 ? { year: view.year + 1, month: 1 } : { year: view.year, month: view.month + 1 })}
                  />
                </>
              }
            >
              <div
                ref={gridRef}
                role="grid"
                aria-label={`${MONTH_NAMES[view.month - 1]} ${view.year}, with ${start === 1 ? 'ISO' : 'US'} week numbers`}
                onKeyDown={onGridKey}
                className="text-[13px]"
              >
                <div role="row" className="grid grid-cols-[2.25rem_repeat(7,minmax(0,1fr))] gap-1 pb-1 text-[11.5px] text-fg-muted">
                  <span role="columnheader" className="text-center" title={start === 1 ? 'ISO week' : 'Week (US)'}>
                    Wk
                  </span>
                  {headers.map((h) => (
                    <span key={h} role="columnheader" className="text-center">
                      {h}
                    </span>
                  ))}
                </div>
                {grid.map((row) => (
                  <div key={formatIsoDate(row.days[0].date)} role="row" className="grid grid-cols-[2.25rem_repeat(7,minmax(0,1fr))] gap-1 py-0.5">
                    <span role="rowheader" className="flex items-center justify-center font-mono text-[11.5px] text-accent-text tabular-nums">
                      {row.week}
                    </span>
                    {row.days.map(({ date: d, inMonth }) => {
                      const selected = sameDay(d, date);
                      const isToday = sameDay(d, today);
                      const weekend = dayOfWeek(d) === 0 || dayOfWeek(d) === 6;
                      return (
                        <button
                          key={formatIsoDate(d)}
                          type="button"
                          role="gridcell"
                          aria-selected={selected}
                          aria-label={`${WEEKDAY_NAMES[dayOfWeek(d)]}, ${MONTH_NAMES[d.month - 1]} ${d.day}, ${d.year}${isToday ? ' (today)' : ''}`}
                          data-selected={selected}
                          tabIndex={selected ? 0 : -1}
                          onClick={() => select(d)}
                          className={cn(
                            'flex h-9 items-center justify-center rounded-md tabular-nums transition-colors',
                            selected
                              ? 'bg-accent font-semibold text-accent-contrast'
                              : inMonth
                                ? cn('hover:bg-surface-hover', weekend ? 'text-fg-secondary' : 'text-fg')
                                : 'text-fg-muted hover:bg-surface-hover',
                            isToday && !selected && 'ring-1 ring-accent-line',
                          )}
                        >
                          {d.day}
                        </button>
                      );
                    })}
                  </div>
                ))}
              </div>
              <p className="mt-2 text-[12px] text-fg-muted">
                Arrow keys move by day and week, Page Up and Page Down by month. Week numbers are{' '}
                {start === 1 ? 'ISO 8601 (week 1 contains the year’s first Thursday).' : 'US style (week 1 contains January 1).'}
              </p>
            </Panel>
            <Panel title="Details" bodyClassName="py-1">
              <div className="divide-y divide-line">
                <CopyRow label="ISO week date" value={`${isoWeekText(info.isoWeekYear, info.isoWeek)}-${info.isoWeekday}`} />
                <CopyRow label="ISO ordinal date" value={`${formatIsoDate(date).slice(0, -6)}-${String(info.dayOfYear).padStart(3, '0')}`} />
                <CopyRow label="Calendar date" value={formatIsoDate(date)} />
                <CopyRow label="US week number" hint="Sunday start, week 1 has Jan 1" value={String(simpleWeekNumber(date, 0))} />
                <CopyRow
                  label="Weekday in month"
                  value={`${ORDINAL[info.weekdayOccurrence]} ${info.weekdayName} of ${info.monthName}${info.isLastWeekdayOccurrence ? ' (the last one)' : ''}`.replace(
                    /^./,
                    (c) => c.toUpperCase(),
                  )}
                  mono={false}
                />
                <CopyRow label="ISO weekday" hint="1 = Monday … 7 = Sunday" value={String(info.isoWeekday)} />
              </div>
            </Panel>
          </div>
        </>
      )}
    </ToolStack>
  );
}

