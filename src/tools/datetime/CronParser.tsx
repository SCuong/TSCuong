import { useId, useMemo, useState } from 'react';
import { CalendarCog, Eraser } from 'lucide-react';
import { ToolStack } from '@/components/tool/EditorPanel';
import { Badge, Panel } from '@/components/ui/Panel';
import { Alert, ErrorMessage } from '@/components/ui/Alert';
import { IconButton } from '@/components/ui/Button';
import { CopyButton } from '@/components/ui/Actions';
import { Label, Select } from '@/components/ui/Field';
import { Segmented } from '@/components/ui/Segmented';
import { EmptyState } from '@/components/ui/Feedback';
import { useToolState } from '@/lib/hooks';
import { cn } from '@/lib/utils';
import { ZonePicker } from './components/ZonePicker';
import { LinkButton, prefers12Hour, useClock, validZone } from './components/shared';
import {
  CRON_FIELDS,
  CRON_MACROS,
  CRON_PRESETS,
  dayFieldsRule,
  describeCron,
  inspectFields,
  nextRuns,
  parseCron,
  setField,
  type CronFieldKey,
  type CronRun,
  type CronSkip,
} from './lib/cron';
import { relativeTime } from './lib/timestamp';
import { formatUtcLabel, localTimeZone, tzOffsetMs, wallInZone, zoneCity } from './lib/tz';
import { clockText, shortDate } from './lib/zoneconvert';

const TOOL = 'cron-parser';
const COUNTS = ['5', '10', '25', '50'] as const;
type Count = (typeof COUNTS)[number];

const SYNTAX: Array<[string, string]> = [
  ['*', 'every value'],
  ['5', 'exactly 5'],
  ['1,15', 'a list: 1 and 15'],
  ['9-17', 'a range, 9 through 17'],
  ['*/15', 'every 15th value from the start (0, 15, 30, 45)'],
  ['10-50/20', 'every 20th value in a range (10, 30, 50)'],
  ['MON-FRI', 'day and month names (SUN–SAT, JAN–DEC)'],
  ['L', 'day of month: the last day'],
  ['5L', 'day of week: the last Friday of the month'],
  ['1#2', 'day of week: the second Monday of the month'],
  ['?', 'day fields: no specific value'],
  ['@daily', 'macros: @yearly, @monthly, @weekly, @daily, @hourly'],
];

function runText(run: CronRun, zone: string, withSeconds: boolean, hour12: boolean): string {
  const w = wallInZone(run.epochMs, zone);
  const time = clockText(w, hour12);
  const seconds = withSeconds ? `:${String(w.second).padStart(2, '0')}` : '';
  return `${shortDate(w)} ${hour12 ? time.replace(/ (AM|PM)$/, `${seconds} $1`) : `${time}${seconds}`}`;
}

function dstText(run: CronRun, hour12: boolean): string | null {
  const scheduled = clockText(run.scheduled, hour12);
  if (run.dst === 'moved') return `${scheduled} is skipped when clocks spring forward; cron runs it right after the jump.`;
  if (run.dst === 'once') return `${scheduled} happens twice today (clocks fall back); cron runs this job only once.`;
  if (run.dst === 'repeated') return `Clocks fell back, so ${scheduled} comes around again and wildcard jobs run again.`;
  return null;
}

function skipText(skip: CronSkip, hour12: boolean): string {
  const range = `${clockText(skip.from, hour12)}–${clockText(skip.to, hour12)}`;
  const what = skip.count === 1 ? 'the run' : `${skip.count.toLocaleString('en-US')} runs`;
  return skip.reason === 'wildcard'
    ? `${shortDate(skip.from)}: clocks jump forward over ${range}, so ${what} scheduled in that hour do not happen (jobs with * in the minute or hour field follow the new clock).`
    : `${shortDate(skip.from)}: the clock skips ${range}, more than cron catches up on, so ${what} scheduled then do not happen.`;
}

/** A field value editor that keeps a local draft while typing, so it can be emptied and retyped. */
function FieldEditor({ value, label, invalid, onCommit }: { value: string; label: string; invalid: boolean; onCommit: (v: string) => void }) {
  const [draft, setDraft] = useState(value);
  const [focused, setFocused] = useState(false);
  return (
    <input
      aria-label={label}
      aria-invalid={invalid || undefined}
      className="lk-field h-8 w-full py-1 font-mono text-[13px]"
      spellCheck={false}
      autoCapitalize="off"
      autoComplete="off"
      value={focused ? draft : value}
      onFocus={() => {
        setDraft(value);
        setFocused(true);
      }}
      onBlur={() => setFocused(false)}
      onChange={(e) => {
        setDraft(e.target.value);
        const next = e.target.value.trim();
        if (next && !/\s/.test(next)) onCommit(next);
      }}
    />
  );
}

export default function CronParser() {
  const [expr, setExpr] = useToolState(TOOL, 'expression', '*/15 9-17 * * 1-5');
  const [storedZone, setZone] = useToolState(TOOL, 'zone', localTimeZone());
  const [count, setCount] = useToolState<Count>(TOOL, 'count', '10');
  const [hour12, setHour12] = useToolState(TOOL, 'hour12', prefers12Hour());
  const zone = validZone(storedZone);
  const now = useClock(60_000);
  const inputId = useId();

  const parsed = useMemo(() => (expr.trim() ? parseCron(expr) : null), [expr]);
  const fields = useMemo(() => inspectFields(expr), [expr]);
  const description = useMemo(() => (parsed?.ok ? describeCron(expr, !hour12) : null), [parsed, expr, hour12]);
  const runs = useMemo(
    () => (parsed?.ok ? nextRuns(expr, { from: now, zone, count: Number(COUNTS.includes(count) ? count : '10') }) : null),
    [parsed, expr, now, zone, count],
  );
  const rule = parsed?.ok ? dayFieldsRule(parsed) : null;
  const hasSeconds = parsed?.ok ? parsed.hasSeconds : false;
  const base = parsed?.ok ? parsed.normalized : expr;
  const failing: CronFieldKey | undefined = parsed && !parsed.ok ? parsed.field : undefined;
  const quartzLike = parsed?.ok && parsed.hasSeconds && /\?/.test(expr);
  const presetValue = CRON_PRESETS.find((p) => p.expression === expr.trim())?.expression ?? '';
  const runsText = runs?.ok ? runs.value.runs.map((r) => new Date(r.epochMs).toISOString()).join('\n') : '';

  return (
    <ToolStack>
      <Panel bodyClassName="flex flex-col gap-3">
        <div>
          <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
            <Label htmlFor={inputId} className="mb-0">
              Cron expression
            </Label>
            <div className="min-w-0 sm:w-72">
              <Select
                aria-label="Load a preset"
                value={presetValue}
                onChange={(e) => e.target.value && setExpr(e.target.value)}
                className="h-8 py-1 text-[13px]"
              >
                <option value="">Presets…</option>
                {CRON_PRESETS.map((p) => (
                  <option key={p.expression} value={p.expression}>
                    {p.label} ({p.expression})
                  </option>
                ))}
              </Select>
            </div>
          </div>
          <div className="relative">
            <input
              id={inputId}
              className="lk-field pr-10 font-mono text-[17px] tracking-wide"
              value={expr}
              onChange={(e) => setExpr(e.target.value)}
              placeholder="*/15 9-17 * * 1-5"
              spellCheck={false}
              autoCapitalize="off"
              autoComplete="off"
              aria-invalid={parsed?.ok === false || undefined}
              aria-describedby={`${inputId}-help`}
            />
            {expr && (
              <IconButton icon={Eraser} label="Clear" size="sm" onClick={() => setExpr('')} className="absolute top-1/2 right-1.5 -translate-y-1/2" />
            )}
          </div>
          <p id={`${inputId}-help`} className="mt-1.5 text-[12.5px] text-fg-muted">
            Five fields (minute hour day-of-month month day-of-week), six with seconds first, or a macro such as @daily.
          </p>
        </div>
        {fields && (
          <div className="flex flex-wrap gap-1.5" aria-hidden>
            {fields.map((f) => (
              <span
                key={f.key}
                className={cn(
                  'flex min-w-14 flex-col items-center rounded-md border px-2 py-1',
                  f.ok ? 'border-line bg-surface-sunken' : 'border-danger/50 bg-danger-soft',
                )}
              >
                <span className={cn('font-mono text-[13px]', f.ok ? 'text-fg' : 'text-danger')}>{f.raw}</span>
                <span className="text-[11px] text-fg-muted">{CRON_FIELDS[f.key].label.toLowerCase()}</span>
              </span>
            ))}
          </div>
        )}
      </Panel>

      {parsed === null && (
        <Panel>
          <EmptyState icon={CalendarCog} title="Enter a cron expression">
            Type or pick a preset to see what it means, each field explained and the next run times in your time zone.
          </EmptyState>
        </Panel>
      )}
      {parsed?.ok === false && <ErrorMessage error={parsed.error} title="Not a valid cron expression" />}

      {parsed?.ok && description && (
        <section
          aria-label="Description"
          className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-accent-line bg-accent-soft px-4 py-3.5"
        >
          <div className="min-w-0">
            <p className="text-[19px] leading-snug font-semibold tracking-tight text-fg">{description}</p>
            {parsed.macro && (
              <p className="mt-1 text-[13px] text-fg-secondary">
                <span className="font-mono">{parsed.macro}</span> is short for <span className="font-mono">{CRON_MACROS[parsed.macro]}</span>
              </p>
            )}
          </div>
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
        </section>
      )}
      {rule && <Alert tone={rule.mode === 'and' ? 'warning' : 'info'}>{rule.text}</Alert>}
      {quartzLike && (
        <Alert tone="info">
          This looks like a Quartz expression. Quartz numbers weekdays 1–7 starting on Sunday, while this tool uses cron numbering (0 or
          7 = Sunday, 1 = Monday). Weekday names such as MON avoid the ambiguity.
        </Alert>
      )}

      {fields && (
        <div className="grid min-w-0 grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,6fr)_minmax(0,5fr)]">
          <Panel title="Fields" description="Edit a field to change the expression." bodyClassName="p-0">
            <div className="hidden grid-cols-[9.5rem_8rem_minmax(0,1fr)] gap-x-3 border-b border-line px-4 py-2 text-[12px] font-medium text-fg-muted sm:grid">
              <span>Field</span>
              <span>Value</span>
              <span>Meaning</span>
            </div>
            <ul className="divide-y divide-line text-[13px]">
              {fields.map((f) => (
                <li
                  key={f.key}
                  className={cn(
                    'grid grid-cols-[minmax(0,1fr)_8rem] items-start gap-x-3 gap-y-1 px-4 py-2 sm:grid-cols-[9.5rem_8rem_minmax(0,1fr)]',
                    failing === f.key && 'bg-danger-soft',
                  )}
                >
                  <div className="min-w-0">
                    <span className="block text-fg">{CRON_FIELDS[f.key].label}</span>
                    <span className="block text-[11.5px] text-fg-muted">{CRON_FIELDS[f.key].hint}</span>
                  </div>
                  <FieldEditor
                    value={f.raw}
                    label={`${CRON_FIELDS[f.key].label} field`}
                    invalid={!f.ok}
                    onCommit={(v) => setExpr(setField(base, f.key, v))}
                  />
                  <p className={cn('col-span-2 min-w-0 break-words sm:col-span-1 sm:pt-1.5', f.ok ? 'text-fg-secondary' : 'text-danger')}>
                    {f.text}
                  </p>
                </li>
              ))}
            </ul>
          </Panel>

          <Panel
            title="Next runs"
            description={`In ${zone === 'UTC' ? 'UTC' : zoneCity(zone)} (${formatUtcLabel(tzOffsetMs(now, zone))}), the cron daemon’s time zone`}
            actions={runsText ? <CopyButton value={runsText} label="Copy" /> : undefined}
            bodyClassName="flex flex-col gap-3"
          >
            <div className="flex flex-wrap items-start gap-3">
              <ZonePicker
                label="Server time zone"
                value={zone}
                onChange={setZone}
                className="min-w-0 flex-1 basis-52"
                action={
                  <span className="flex gap-1">
                    <LinkButton onClick={() => setZone(localTimeZone())}>Local</LinkButton>
                    <LinkButton onClick={() => setZone('UTC')}>UTC</LinkButton>
                  </span>
                }
              />
              <div>
                <Label className="flex min-h-5 items-center">Show</Label>
                <Segmented label="Number of runs" size="sm" value={count} onChange={setCount} options={COUNTS.map((c) => ({ value: c, label: c }))} />
              </div>
            </div>
            {!parsed?.ok && <p className="text-[13px] text-fg-muted">Fix the expression to see when it runs.</p>}
            {runs?.ok === false && <Alert tone="warning">{runs.error}</Alert>}
            {runs?.ok && (
              <>
                <ol className="-mx-4 divide-y divide-line border-y border-line">
                  {runs.value.runs.map((run, i) => {
                    const note = dstText(run, hour12);
                    return (
                      <li key={run.epochMs} className="flex items-start gap-3 px-4 py-2">
                        <span className="w-6 shrink-0 pt-px text-right text-[12px] text-fg-muted tabular-nums">{i + 1}</span>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                            <span className="font-mono text-[13px] text-fg">{runText(run, zone, hasSeconds, hour12)}</span>
                            <span className="text-[12px] text-fg-muted">{relativeTime(run.epochMs, now)}</span>
                          </div>
                          {note && (
                            <p className="mt-0.5 flex items-start gap-1.5 text-[12px] text-fg-secondary">
                              <Badge tone="warning">DST</Badge>
                              <span>{note}</span>
                            </p>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ol>
                {runs.value.skipped.map((skip) => (
                  <Alert key={skip.epochMs} tone="warning">
                    {skipText(skip, hour12)}
                  </Alert>
                ))}
                {runs.value.exhausted && runs.value.runs.length > 0 && (
                  <p className="text-[12.5px] text-fg-muted">No further runs in the next 100 years.</p>
                )}
                <p className="text-[12px] text-fg-muted">
                  Daylight-saving rules follow Vixie/ISC cron (Debian, Ubuntu, cronie). Other schedulers may treat skipped and repeated
                  hours differently.
                </p>
              </>
            )}
          </Panel>
        </div>
      )}

      <Panel title="Syntax" bodyClassName="p-0">
        <dl className="-mb-px grid grid-cols-1 overflow-hidden rounded-b-xl sm:grid-cols-2">
          {SYNTAX.map(([token, meaning]) => (
            <div key={token} className="flex items-baseline gap-3 border-b border-line px-4 py-2 text-[13px] sm:odd:border-r">
              <dt className="w-20 shrink-0">
                <code className="font-mono text-[12.5px] text-accent-text">{token}</code>
              </dt>
              <dd className="min-w-0 text-fg-secondary">{meaning}</dd>
            </div>
          ))}
        </dl>
      </Panel>
    </ToolStack>
  );
}
