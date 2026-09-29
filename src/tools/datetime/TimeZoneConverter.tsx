import { useMemo, useState } from 'react';
import { ArrowUpToLine, CalendarClock, Clock, X } from 'lucide-react';
import { ToolStack } from '@/components/tool/EditorPanel';
import { Badge, Panel } from '@/components/ui/Panel';
import { Alert } from '@/components/ui/Alert';
import { IconButton } from '@/components/ui/Button';
import { CopyButton } from '@/components/ui/Actions';
import { Segmented } from '@/components/ui/Segmented';
import { EmptyState } from '@/components/ui/Feedback';
import { useToolState } from '@/lib/hooks';
import { cn } from '@/lib/utils';
import { ZonePicker } from './components/ZonePicker';
import { DateTimeInput, LinkButton, parseInputValue, prefers12Hour, toLocalInputValue, useClock, validZone } from './components/shared';
import { MONTH_SHORT, MS_PER_HOUR } from './lib/civil';
import { formatUtcLabel, isValidTimeZone, localTimeZone, tzOffsetMs, wallInZone, zoneCity } from './lib/tz';

/** Display name: the city, or just "UTC". */
const zoneLabel = (zone: string) => (zone === 'UTC' ? 'UTC' : zoneCity(zone));
import {
  clockText,
  describeTransition,
  formatOffsetDiff,
  plannerStrip,
  resolveSource,
  shortDate,
  startOfZonedDay,
  zoneView,
  type SourceChoice,
  type ZoneView,
} from './lib/zoneconvert';

const TOOL = 'timezone-converter';
const DEFAULT_TARGETS = ['UTC', 'America/New_York', 'Europe/London', 'Asia/Kolkata', 'Asia/Tokyo', 'Australia/Sydney'];
const MAX_ZONES = 24;

function dayShiftLabel(shift: number): string {
  if (shift === 0) return 'same day';
  const abs = Math.abs(shift);
  return `${shift > 0 ? '+' : '−'}${abs} day${abs === 1 ? '' : 's'}`;
}

function ZoneRow({
  view,
  isSource,
  hour12,
  onRemove,
  onMakeSource,
}: {
  view: ZoneView;
  isSource: boolean;
  hour12: boolean;
  onRemove?: () => void;
  onMakeSource?: () => void;
}) {
  const local = view.zone === localTimeZone();
  const next = view.next ? describeTransition(view.next, hour12) : null;
  return (
    <li className={cn('px-4 py-3', isSource && 'bg-accent-soft')}>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <span className="truncate text-[14px] font-semibold text-fg">{zoneLabel(view.zone)}</span>
            {isSource && <Badge tone="accent">Source</Badge>}
            {local && <Badge>Your zone</Badge>}
          </div>
          <div className="truncate text-[12px] text-fg-muted">
            {view.zone === 'UTC' ? view.longName : `${view.zone} · ${view.longName}`}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div className="font-mono text-[20px] leading-tight font-semibold text-fg tabular-nums">{clockText(view.wall, hour12)}</div>
          <div className="text-[12px] whitespace-nowrap text-fg-secondary">{shortDate(view.wall)}</div>
        </div>
        <div className="flex shrink-0 flex-col gap-0.5 sm:flex-row">
          {onMakeSource && (
            <IconButton icon={ArrowUpToLine} size="sm" label={`Use ${zoneLabel(view.zone)} as the source`} onClick={onMakeSource} />
          )}
          {onRemove && <IconButton icon={X} size="sm" label={`Remove ${zoneLabel(view.zone)}`} onClick={onRemove} />}
          {!onMakeSource && !onRemove && <span className="h-7 w-7 sm:w-[58px]" aria-hidden />}
        </div>
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-fg-muted">
        <Badge>{formatUtcLabel(view.offsetMs)}</Badge>
        {view.abbreviation && <Badge>{view.abbreviation}</Badge>}
        {view.dst && <Badge tone="warning">Daylight saving</Badge>}
        {!isSource && view.dayShift !== 0 && <Badge tone="accent">{dayShiftLabel(view.dayShift)}</Badge>}
        {!isSource && <span>{formatOffsetDiff(view.offsetDiffMs)} from source</span>}
        {next ? (
          <span className="min-w-0">
            · Next change: {next.summary.toLowerCase()} on {next.when}
          </span>
        ) : (
          view.zone !== 'UTC' && <span>· No clock changes in the next year</span>
        )}
      </div>
    </li>
  );
}

function Planner({
  instant,
  sourceZone,
  zones,
  hour12,
  onPick,
}: {
  instant: number;
  sourceZone: string;
  zones: string[];
  hour12: boolean;
  onPick: (epochMs: number) => void;
}) {
  const dayStart = startOfZonedDay(instant, sourceZone);
  const selected = Math.floor((instant - dayStart) / MS_PER_HOUR);
  const within = instant - (dayStart + selected * MS_PER_HOUR);
  const rows = useMemo(() => zones.map((zone) => ({ zone, cells: plannerStrip(dayStart, zone) })), [zones, dayStart]);
  const label = (hour: number, minute: number) => {
    const h = hour12 ? hour % 12 || 12 : hour;
    return minute ? `${h}:${String(minute).padStart(2, '0')}` : String(h);
  };
  return (
    <Panel
      title="Plan across the day"
      description={`24 hours from midnight on ${shortDate(wallInZone(instant, sourceZone))} in ${zoneLabel(sourceZone)}. Pick an hour to convert it.`}
      bodyClassName="p-0"
    >
      <div className="overflow-x-auto px-4 py-3">
        <div className="inline-flex min-w-full flex-col gap-1.5">
          {rows.map(({ zone, cells }, r) => (
            <div key={zone} className="flex items-stretch gap-[3px]">
              <div className="sticky left-0 z-10 flex w-24 shrink-0 flex-col justify-center bg-surface pr-2 sm:w-[7.5rem]">
                <span className="truncate text-[12.5px] font-medium text-fg">{zoneLabel(zone)}</span>
                <span className="font-mono text-[11px] text-fg-muted">{formatUtcLabel(tzOffsetMs(instant, zone))}</span>
              </div>
              {cells.map((cell, i) => {
                const isSel = i === selected;
                return (
                  <button
                    key={cell.epochMs}
                    type="button"
                    tabIndex={r === 0 ? 0 : -1}
                    onClick={() => onPick(cell.epochMs + within)}
                    aria-label={r === 0 ? `Convert ${clockText(cell.wall, hour12)} in ${zoneLabel(zone)}` : undefined}
                    aria-hidden={r === 0 ? undefined : true}
                    title={`${clockText(cell.wall, hour12)} · ${shortDate(cell.wall)} · ${zoneLabel(zone)}`}
                    className={cn(
                      'flex h-10 w-[37px] shrink-0 flex-col items-center justify-center rounded-md text-[12px] leading-none tabular-nums transition-colors',
                      cell.period === 'night' && 'bg-surface-sunken text-fg-muted',
                      cell.period === 'day' && 'bg-surface-hover text-fg-secondary',
                      cell.period === 'work' && 'bg-accent-soft text-fg',
                      cell.newDay && i > 0 && 'shadow-[inset_2px_0_0_var(--lk-accent)]',
                      isSel ? 'font-semibold ring-2 ring-accent' : 'hover:ring-1 hover:ring-line-strong',
                    )}
                  >
                    <span>{label(cell.wall.hour, cell.wall.minute)}</span>
                    <span className={cn('mt-0.5 text-[9.5px]', cell.newDay ? 'text-accent-text' : 'text-fg-muted')}>
                      {cell.newDay ? `${MONTH_SHORT[cell.wall.month - 1]} ${cell.wall.day}` : hour12 ? (cell.wall.hour < 12 ? 'am' : 'pm') : ''}
                    </span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1.5 border-t border-line px-4 py-2 text-[12px] text-fg-muted">
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="size-3 rounded-sm bg-accent-soft ring-1 ring-accent-line" /> 9:00–18:00
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="size-3 rounded-sm bg-surface-hover ring-1 ring-line" /> morning and evening
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="size-3 rounded-sm bg-surface-sunken ring-1 ring-line" /> night
        </span>
        <span>A blue edge marks midnight (a new date).</span>
      </div>
    </Panel>
  );
}

export default function TimeZoneConverter() {
  const [storedSource, setSourceZone] = useToolState(TOOL, 'source', localTimeZone());
  const [storedTargets, setTargets] = useToolState<string[]>(TOOL, 'targets', DEFAULT_TARGETS);
  const [live, setLive] = useToolState(TOOL, 'live', true);
  const [fixed, setFixed] = useToolState(TOOL, 'fixed', '');
  const [hour12, setHour12] = useToolState(TOOL, 'hour12', prefers12Hour());
  const [choice, setChoice] = useState<SourceChoice>('default');
  const now = useClock(60_000, !live);

  const sourceZone = validZone(storedSource);
  const targets = useMemo(() => {
    const list = Array.isArray(storedTargets) ? storedTargets : DEFAULT_TARGETS;
    return [...new Set(list.filter((z) => typeof z === 'string' && isValidTimeZone(z) && z !== sourceZone))].slice(0, MAX_ZONES);
  }, [storedTargets, sourceZone]);
  const allZones = useMemo(() => [sourceZone, ...targets], [sourceZone, targets]);

  const minute = Math.floor(now / 60_000);
  const liveWall = useMemo(() => wallInZone(minute * 60_000, sourceZone), [minute, sourceZone]);
  const inputValue = live ? toLocalInputValue({ ...liveWall, second: 0 }) : fixed;
  const wall = live ? liveWall : parseInputValue(fixed);

  const resolution = useMemo(() => (wall && !live ? resolveSource(wall, sourceZone, choice) : null), [wall, live, sourceZone, choice]);
  const instant = live ? minute * 60_000 : resolution?.epochMs ?? null;

  const views = useMemo(() => {
    if (instant === null) return null;
    const reference = { wall: wallInZone(instant, sourceZone), offsetMs: tzOffsetMs(instant, sourceZone) };
    return allZones.map((zone) => zoneView(instant, zone, reference));
  }, [instant, sourceZone, allZones]);

  const setSourceTime = (value: string) => {
    setLive(false);
    setFixed(value);
    setChoice('default');
  };

  const pickInstant = (epochMs: number) => {
    setSourceTime(toLocalInputValue({ ...wallInZone(epochMs, sourceZone), second: 0 }));
    // The picked instant exists, so if it lands in a repeated hour, keep the occurrence that was picked.
    const w = wallInZone(epochMs, sourceZone);
    const r = resolveSource({ ...w, second: 0, millisecond: 0 }, sourceZone, 'default');
    if (r.status === 'ambiguous' && r.epochMs !== Math.floor(epochMs / 60_000) * 60_000) setChoice('alternative');
  };

  const makeSource = (zone: string) => {
    if (instant !== null && !live) setFixed(toLocalInputValue({ ...wallInZone(instant, zone), second: 0 }));
    setTargets(targets.map((z) => (z === zone ? sourceZone : z)));
    setSourceZone(zone);
    setChoice('default');
  };

  const summary = views
    ? views.map((v) => `${zoneLabel(v.zone)} (${v.zone}): ${shortDate(v.wall)} ${clockText(v.wall, hour12)} ${formatUtcLabel(v.offsetMs)}`).join('\n')
    : '';

  return (
    <ToolStack>
      <Panel bodyClassName="flex flex-col gap-3">
        <div className="grid min-w-0 grid-cols-1 gap-3 md:grid-cols-2">
          <DateTimeInput
            label="Date and time"
            value={inputValue}
            onChange={setSourceTime}
            invalid={!live && !wall && fixed !== ''}
            action={
              <LinkButton onClick={() => setLive(true)} title="Follow the current time">
                Now
              </LinkButton>
            }
          />
          <ZonePicker
            label="In time zone"
            value={sourceZone}
            onChange={(zone) => {
              setSourceZone(zone);
              setChoice('default');
            }}
            at={instant ?? now}
            action={
              <span className="flex gap-1">
                <LinkButton onClick={() => setSourceZone(localTimeZone())}>Local</LinkButton>
                <LinkButton onClick={() => setSourceZone('UTC')}>UTC</LinkButton>
              </span>
            }
          />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="flex items-center gap-1.5 text-[12.5px] text-fg-muted">
            {live ? (
              <>
                <span aria-hidden className="inline-block size-2 rounded-full bg-success motion-safe:animate-pulse" />
                Showing the current time; it updates every minute.
              </>
            ) : (
              <>
                <CalendarClock size={14} aria-hidden /> Showing a fixed time.{' '}
                <LinkButton onClick={() => setLive(true)}>Back to now</LinkButton>
              </>
            )}
          </p>
          <Segmented
            label="Clock format"
            size="sm"
            value={hour12 ? '12' : '24'}
            onChange={(v) => setHour12(v === '12')}
            options={[
              { value: '24', label: '24-hour' },
              { value: '12', label: '12-hour' },
            ]}
          />
        </div>
        {resolution && resolution.status !== 'ok' && wall && (
          <Alert
            tone="warning"
            title={
              resolution.status === 'gap'
                ? `${clockText(wall, hour12)} does not exist in ${zoneLabel(sourceZone)} on ${shortDate(wall)}`
                : `${clockText(wall, hour12)} happens twice in ${zoneLabel(sourceZone)} on ${shortDate(wall)}`
            }
          >
            <p>
              {resolution.transition &&
                (() => {
                  const t = describeTransition(resolution.transition, hour12);
                  return `${t.summary} on ${t.when}. `;
                })()}
              {resolution.status === 'gap'
                ? 'That wall-clock time is skipped, so choose which side of the jump you mean:'
                : 'The clock shows that time once before and once after the change, so choose which one you mean:'}
            </p>
            <div className="mt-2">
              <Segmented
                label="Which time"
                size="sm"
                value={choice}
                onChange={setChoice}
                options={resolution.options.map((o) => {
                  const w = wallInZone(o.epochMs, sourceZone);
                  const offset = formatUtcLabel(tzOffsetMs(o.epochMs, sourceZone));
                  const text =
                    resolution.status === 'gap'
                      ? o.choice === 'default'
                        ? `${clockText(w, hour12)} (after the jump, ${offset})`
                        : `${clockText(w, hour12)} (before the jump, ${offset})`
                      : o.choice === 'default'
                        ? `First, ${offset}`
                        : `Second, ${offset}`;
                  return { value: o.choice, label: text };
                })}
              />
            </div>
          </Alert>
        )}
      </Panel>

      {views ? (
        <>
          <Panel
            title="Converted times"
            description={`${views.length} time zone${views.length === 1 ? '' : 's'}`}
            actions={
              <>
                <ZonePicker
                  label="Add a time zone"
                  hideLabel
                  clearOnSelect
                  placeholder="Add a city or time zone…"
                  value=""
                  exclude={[sourceZone, ...targets]}
                  at={instant ?? now}
                  onChange={(zone) => setTargets([...targets, zone].slice(0, MAX_ZONES))}
                  className="w-full sm:w-72"
                />
                <CopyButton value={summary} label="Copy all" />
              </>
            }
            bodyClassName="p-0"
          >
            <ul className="divide-y divide-line">
              {views.map((view, i) => (
                <ZoneRow
                  key={view.zone}
                  view={view}
                  isSource={i === 0}
                  hour12={hour12}
                  onRemove={i === 0 ? undefined : () => setTargets(targets.filter((z) => z !== view.zone))}
                  onMakeSource={i === 0 ? undefined : () => makeSource(view.zone)}
                />
              ))}
            </ul>
            {targets.length === 0 && (
              <p className="border-t border-line px-4 py-3 text-[13px] text-fg-muted">Add time zones above to compare them.</p>
            )}
          </Panel>
          <Planner instant={instant!} sourceZone={sourceZone} zones={allZones} hour12={hour12} onPick={pickInstant} />
        </>
      ) : (
        <Panel>
          <EmptyState icon={Clock} title="Pick a date and time">
            Choose a date and time above, or press Now, to see it in every time zone.
          </EmptyState>
        </Panel>
      )}
    </ToolStack>
  );
}
