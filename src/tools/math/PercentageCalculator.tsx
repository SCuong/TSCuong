import type { ReactNode } from 'react';
import { ToolStack } from '@/components/tool/EditorPanel';
import { Panel } from '@/components/ui/Panel';
import { CopyButton } from '@/components/ui/Actions';
import { ErrorMessage } from '@/components/ui/Alert';
import { useToolState } from '@/lib/hooks';
import { cn } from '@/lib/utils';
import { formatNumber, parseNumber } from './shared-a/format';
import {
  addPercent,
  percentChange,
  percentDifference,
  percentOf,
  reversePercent,
  subtractPercent,
  whatPercent,
  type Calc,
} from './lib/percentage';

const TOOL = 'percentage-calculator';

type Parsed = { ok: true; values: number[] } | { ok: false; error: string } | null;

/** Parse the named inputs; null when any is empty (neutral state). A trailing "%" is allowed. */
function parseAll(fields: Array<[string, string]>): Parsed {
  if (fields.some(([, v]) => !v.trim())) return null;
  const values: number[] = [];
  for (const [name, text] of fields) {
    const n = parseNumber(text.trim().replace(/%$/, ''));
    if (n === null) return { ok: false, error: `${name} is not a valid number.` };
    values.push(n);
  }
  return { ok: true, values };
}

function useInputs(key: string, initial: [string, string]) {
  const [values, setValues] = useToolState<[string, string]>(TOOL, key, initial);
  const set = (i: 0 | 1) => (v: string) => setValues((prev) => (i === 0 ? [v, prev[1]] : [prev[0], v]));
  return [values, set] as const;
}

export default function PercentageCalculator() {
  return (
    <ToolStack>
      <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-2">
        <PercentOfCard />
        <WhatPercentCard />
        <ChangeCard />
        <AddSubtractCard />
        <ReverseCard />
        <DifferenceCard />
      </div>
    </ToolStack>
  );
}

function PercentOfCard() {
  const [[x, y], set] = useInputs('of', ['15', '80']);
  const parsed = parseAll([
    ['The percentage', x],
    ['The value', y],
  ]);
  const calc = parsed?.ok ? percentOf(parsed.values[0], parsed.values[1]) : null;
  return (
    <Card title="Percentage of a number">
      <Sentence>
        What is <Num value={x} onChange={set(0)} label="Percentage" suffix="%" /> of <Num value={y} onChange={set(1)} label="Value" />?
      </Sentence>
      <Outcome parsed={parsed} calc={calc} explain={(v) => `${fmt(v[0])}% × ${fmt(v[1])} ÷ 100`} />
    </Card>
  );
}

function WhatPercentCard() {
  const [[x, y], set] = useInputs('what', ['12', '80']);
  const parsed = parseAll([
    ['X', x],
    ['Y', y],
  ]);
  const calc = parsed?.ok ? whatPercent(parsed.values[0], parsed.values[1]) : null;
  return (
    <Card title="What percent is X of Y">
      <Sentence>
        <Num value={x} onChange={set(0)} label="X" /> is what percent of <Num value={y} onChange={set(1)} label="Y" />?
      </Sentence>
      <Outcome parsed={parsed} calc={calc} unit="%" explain={(v) => `${fmt(v[0])} ÷ ${fmt(v[1])} × 100`} />
    </Card>
  );
}

function ChangeCard() {
  const [[a, b], set] = useInputs('change', ['50', '75']);
  const parsed = parseAll([
    ['The starting value', a],
    ['The final value', b],
  ]);
  const calc = parsed?.ok ? percentChange(parsed.values[0], parsed.values[1]) : null;
  const direction = calc?.ok ? (calc.value > 0 ? 'increase' : calc.value < 0 ? 'decrease' : 'no change') : null;
  return (
    <Card title="Percentage change (increase / decrease)">
      <Sentence>
        From <Num value={a} onChange={set(0)} label="Starting value" /> to <Num value={b} onChange={set(1)} label="Final value" />
      </Sentence>
      <Outcome
        parsed={parsed}
        calc={calc}
        unit="%"
        signed
        badge={direction ? <DirectionBadge direction={direction} /> : null}
        explain={(v) => `(${fmt(v[1])} − ${fmt(v[0])}) ÷ |${fmt(v[0])}| × 100 · difference ${fmt(v[1] - v[0])}`}
      />
    </Card>
  );
}

function AddSubtractCard() {
  const [[y, x], set] = useInputs('addsub', ['200', '15']);
  const parsed = parseAll([
    ['The value', y],
    ['The percentage', x],
  ]);
  const add = parsed?.ok ? addPercent(parsed.values[0], parsed.values[1]) : null;
  const sub = parsed?.ok ? subtractPercent(parsed.values[0], parsed.values[1]) : null;
  return (
    <Card title="Add or subtract a percentage">
      <Sentence>
        <Num value={y} onChange={set(0)} label="Value" /> ± <Num value={x} onChange={set(1)} label="Percentage" suffix="%" />
      </Sentence>
      {parsed?.ok && add?.ok && sub?.ok ? (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <ResultBox label={`+ ${fmt(parsed.values[1])}%`} value={add.value} />
          <ResultBox label={`− ${fmt(parsed.values[1])}%`} value={sub.value} />
        </div>
      ) : (
        <Outcome parsed={parsed} calc={add} />
      )}
      {parsed?.ok && add?.ok && (
        <p className="text-[12.5px] text-fg-muted">
          The {fmt(parsed.values[1])}% amount is {fmt((parsed.values[0] * parsed.values[1]) / 100)}.
        </p>
      )}
    </Card>
  );
}

function ReverseCard() {
  const [[y, x], set] = useInputs('reverse', ['30', '20']);
  const parsed = parseAll([
    ['The value', y],
    ['The percentage', x],
  ]);
  const calc = parsed?.ok ? reversePercent(parsed.values[0], parsed.values[1]) : null;
  return (
    <Card title="Reverse percentage (find the whole)">
      <Sentence>
        <Num value={y} onChange={set(0)} label="Part" /> is <Num value={x} onChange={set(1)} label="Percentage" suffix="%" /> of what?
      </Sentence>
      <Outcome parsed={parsed} calc={calc} explain={(v) => `${fmt(v[0])} × 100 ÷ ${fmt(v[1])}`} />
    </Card>
  );
}

function DifferenceCard() {
  const [[a, b], set] = useInputs('diff', ['10', '20']);
  const parsed = parseAll([
    ['A', a],
    ['B', b],
  ]);
  const calc = parsed?.ok ? percentDifference(parsed.values[0], parsed.values[1]) : null;
  return (
    <Card title="Percentage difference (symmetric)">
      <Sentence>
        Between <Num value={a} onChange={set(0)} label="A" /> and <Num value={b} onChange={set(1)} label="B" />
      </Sentence>
      <Outcome parsed={parsed} calc={calc} unit="%" explain={(v) => `|${fmt(v[0])} − ${fmt(v[1])}| ÷ average(${fmt(v[0])}, ${fmt(v[1])}) × 100 — order does not matter`} />
    </Card>
  );
}

// ---------------------------------------------------------------------------

const fmt = (v: number) => formatNumber(v);

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Panel title={title} bodyClassName="flex flex-col gap-3">
      {children}
    </Panel>
  );
}

function Sentence({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-center gap-x-2 gap-y-2 text-[14px] text-fg">{children}</div>;
}

function Num({ value, onChange, label, suffix }: { value: string; onChange: (v: string) => void; label: string; suffix?: string }) {
  return (
    <span className="relative inline-flex">
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={label}
        inputMode="decimal"
        autoComplete="off"
        spellCheck={false}
        className={cn('lk-field w-24 font-mono tabular-nums sm:w-28', suffix && 'pr-7')}
      />
      {suffix && <span className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-[13px] text-fg-muted">{suffix}</span>}
    </span>
  );
}

function ResultBox({ label, value, unit = '', signed, badge }: { label?: string; value: number; unit?: string; signed?: boolean; badge?: ReactNode }) {
  const text = `${signed && value > 0 ? '+' : ''}${formatNumber(value)}${unit}`;
  const plain = `${formatNumber(value, { grouping: false })}${unit}`;
  return (
    <div className="flex min-w-0 items-center justify-between gap-3 rounded-lg border border-line bg-surface-sunken px-3 py-2">
      <div className="min-w-0">
        {label && <div className="text-[12px] text-fg-muted">{label}</div>}
        <output className="flex flex-wrap items-center gap-2 font-mono text-[22px] font-semibold break-all text-fg tabular-nums">
          {text}
          {badge}
        </output>
      </div>
      <CopyButton value={plain} iconOnly label="Copy result" />
    </div>
  );
}

function Outcome({
  parsed,
  calc,
  unit,
  signed,
  badge,
  explain,
}: {
  parsed: Parsed;
  calc: Calc | null;
  unit?: string;
  signed?: boolean;
  badge?: ReactNode;
  explain?: (values: number[]) => string;
}) {
  if (!parsed) return <p className="text-[13px] text-fg-muted">Enter both values to see the result.</p>;
  if (!parsed.ok) return <ErrorMessage error={parsed.error} />;
  if (!calc) return null;
  if (!calc.ok) return <ErrorMessage error={calc.error} />;
  return (
    <>
      <ResultBox value={calc.value} unit={unit} signed={signed} badge={badge} />
      {explain && <p className="text-[12.5px] break-words text-fg-muted">{explain(parsed.values)}</p>}
    </>
  );
}

function DirectionBadge({ direction }: { direction: 'increase' | 'decrease' | 'no change' }) {
  return (
    <span
      className={cn(
        'rounded-md px-1.5 py-px font-sans text-[12px] font-medium',
        direction === 'increase' ? 'bg-success-soft text-success' : direction === 'decrease' ? 'bg-danger-soft text-danger' : 'bg-surface-hover text-fg-secondary',
      )}
    >
      {direction}
    </span>
  );
}
