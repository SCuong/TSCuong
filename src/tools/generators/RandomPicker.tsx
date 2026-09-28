import { useId, useMemo, useState } from 'react';
import { Coins, Dices, ListOrdered, Shuffle, Sparkles, Trophy } from 'lucide-react';
import { ToolBar, ToolStack } from '@/components/tool/EditorPanel';
import { Segmented } from '@/components/ui/Segmented';
import { Checkbox, Input, Label, NumberInput, Textarea } from '@/components/ui/Field';
import { Button } from '@/components/ui/Button';
import { Badge, Panel, Stat } from '@/components/ui/Panel';
import { ErrorMessage } from '@/components/ui/Alert';
import { EmptyState } from '@/components/ui/Feedback';
import { CopyButton } from '@/components/ui/Actions';
import { useToolState } from '@/lib/hooks';
import { cn, formatNumber, pluralize } from '@/lib/utils';
import {
  diceRange,
  flipCoins,
  parseDice,
  parseList,
  pickFromList,
  randomIntegers,
  rollDice,
  shuffleList,
  type CoinFlips,
  type DiceRoll,
} from './lib/picker';
import { OutputPanel, ToolField } from './components';

const TOOL = 'random-picker';
type Mode = 'numbers' | 'list' | 'shuffle' | 'dice' | 'coin';

function num(v: number | ''): number {
  return v === '' ? NaN : v;
}

// ---------------------------------------------------------------------------

function NumbersSection() {
  const [min, setMin] = useToolState<number | ''>(TOOL, 'min', 1);
  const [max, setMax] = useToolState<number | ''>(TOOL, 'max', 100);
  const [count, setCount] = useToolState<number | ''>(TOOL, 'count', 1);
  const [unique, setUnique] = useToolState(TOOL, 'unique', true);
  const [sort, setSort] = useToolState<'none' | 'asc' | 'desc'>(TOOL, 'sort', 'none');
  const [result, setResult] = useState<{ values: number[] } | { error: string } | null>(null);
  const ids = { min: useId(), max: useId(), count: useId() };

  function generate() {
    const r = randomIntegers({ min: num(min), max: num(max), count: num(count), unique, sort });
    setResult(r.ok ? { values: r.value } : { error: r.error });
  }

  const values = result && 'values' in result ? result.values : null;
  return (
    <>
      <ToolBar>
        <ToolField label="Min" htmlFor={ids.min} className="w-32">
          <NumberInput id={ids.min} value={min} onChange={setMin} step={1} />
        </ToolField>
        <ToolField label="Max" htmlFor={ids.max} className="w-32">
          <NumberInput id={ids.max} value={max} onChange={setMax} step={1} />
        </ToolField>
        <ToolField label="How many" htmlFor={ids.count} className="w-28">
          <NumberInput id={ids.count} value={count} onChange={setCount} min={1} max={10000} step={1} />
        </ToolField>
        <div>
          <Label>Order</Label>
          <Segmented
            label="Order"
            value={sort}
            onChange={setSort}
            options={[
              { value: 'none', label: 'Random' },
              { value: 'asc', label: 'Ascending' },
              { value: 'desc', label: 'Descending' },
            ]}
          />
        </div>
        <Checkbox label="No duplicates" checked={unique} onChange={setUnique} className="pb-2" />
        <Button variant="primary" icon={Sparkles} onClick={generate} className="sm:ml-auto">
          Generate
        </Button>
      </ToolBar>
      <ErrorMessage error={result && 'error' in result ? result.error : null} title="Can't generate these numbers" />
      {!result && <IdleHint icon={ListOrdered} text="Set a range and press Generate." />}
      {values &&
        (values.length === 1 ? (
          <BigResult label={`Random number between ${formatNumber(num(min), 0)} and ${formatNumber(num(max), 0)}`} value={formatNumber(values[0], 0)} copy={String(values[0])} />
        ) : (
          <OutputPanel
            title={pluralize(values.length, 'number')}
            text={values.join('\n')}
            filename="random-numbers.txt"
            actions={<CopyButton value={values.join(', ')} label="Copy comma-separated" />}
            footer={
              <>
                <span className="tabular-nums">Sum {formatNumber(values.reduce((a, b) => a + b, 0), 0)}</span>
                <span className="tabular-nums">Min {formatNumber(Math.min(...values), 0)}</span>
                <span className="tabular-nums">Max {formatNumber(Math.max(...values), 0)}</span>
              </>
            }
          />
        ))}
    </>
  );
}

// ---------------------------------------------------------------------------

const SAMPLE_LIST = ['Alice', 'Bao', 'Carmen', 'Dmitri', 'Esi', 'Farah', 'Gustav', 'Hana', 'Ines', 'Jamal'].join('\n');

function ListInput({ value, onChange, dedupe, onDedupe }: { value: string; onChange: (v: string) => void; dedupe: boolean; onDedupe: (v: boolean) => void }) {
  const id = useId();
  const total = parseList(value, false).length;
  const unique = parseList(value, true).length;
  return (
    <Panel
      title="Entries"
      description="One per line. Blank lines are ignored."
      actions={
        <>
          <Button size="sm" variant="ghost" onClick={() => onChange(SAMPLE_LIST)}>
            Load sample
          </Button>
          <Button size="sm" variant="ghost" onClick={() => onChange('')} disabled={!value}>
            Clear
          </Button>
        </>
      }
    >
      <label htmlFor={id} className="sr-only">
        Entries, one per line
      </label>
      <Textarea id={id} value={value} onChange={(e) => onChange(e.target.value)} rows={8} placeholder={'Alice\nBob\nCharlie'} className="resize-y" />
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-[12.5px] text-fg-muted">
        <Checkbox label="Remove duplicate entries" checked={dedupe} onChange={onDedupe} />
        <span className="tabular-nums">
          {pluralize(dedupe ? unique : total, 'entry', 'entries')}
          {total !== unique && ` (${total - unique} duplicate${total - unique === 1 ? '' : 's'}${dedupe ? ' removed' : ''})`}
        </span>
      </div>
    </Panel>
  );
}

function ListSection({ shuffle }: { shuffle: boolean }) {
  const [text, setText] = useToolState(TOOL, 'list', '');
  const [dedupe, setDedupe] = useToolState(TOOL, 'dedupe', true);
  const [winners, setWinners] = useToolState<number | ''>(TOOL, 'winners', 1);
  const [result, setResult] = useState<{ items: string[] } | { error: string } | null>(null);
  const winnersId = useId();
  const items = useMemo(() => parseList(text, dedupe), [text, dedupe]);

  function run() {
    if (shuffle) {
      setResult(items.length ? { items: shuffleList(items) } : { error: 'Add at least one entry, one per line.' });
      return;
    }
    const r = pickFromList(items, num(winners));
    setResult(r.ok ? { items: r.value } : { error: r.error });
  }

  const picked = result && 'items' in result ? result.items : null;
  return (
    <>
      <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-2">
        <ListInput value={text} onChange={setText} dedupe={dedupe} onDedupe={setDedupe} />
        <div className="flex min-w-0 flex-col gap-4">
          <ToolBar>
            {!shuffle && (
              <ToolField label="Winners to pick" htmlFor={winnersId} className="w-36">
                <NumberInput id={winnersId} value={winners} onChange={setWinners} min={1} step={1} />
              </ToolField>
            )}
            <Button variant="primary" icon={shuffle ? Shuffle : Trophy} onClick={run} disabled={items.length === 0}>
              {shuffle ? 'Shuffle' : winners === 1 ? 'Pick a winner' : 'Pick winners'}
            </Button>
          </ToolBar>
          <ErrorMessage error={result && 'error' in result ? result.error : null} />
          {!picked && <IdleHint icon={shuffle ? Shuffle : Trophy} text={items.length ? `Ready with ${pluralize(items.length, 'entry', 'entries')}.` : 'Add entries to get started.'} />}
          {picked &&
            (picked.length === 1 && !shuffle ? (
              <BigResult label="Winner" value={picked[0]} copy={picked[0]} />
            ) : (
              <Panel
                title={shuffle ? 'Shuffled order' : `${picked.length} winners`}
                actions={<CopyButton value={picked.join('\n')} label="Copy" />}
                bodyClassName="p-0!"
              >
                <ol className="max-h-[420px] divide-y divide-line overflow-y-auto">
                  {picked.map((item, i) => (
                    <li key={i} className="flex items-baseline gap-3 px-4 py-2 text-[14px]">
                      <span className="w-8 shrink-0 text-right font-mono text-[12.5px] text-fg-muted tabular-nums">{i + 1}.</span>
                      <span className="min-w-0 break-words text-fg">{item}</span>
                    </li>
                  ))}
                </ol>
              </Panel>
            ))}
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------

const QUICK_DICE = ['d4', 'd6', '2d6', 'd8', 'd10', 'd12', 'd20', 'd100'];

function DiceSection() {
  const [notation, setNotation] = useToolState(TOOL, 'dice', '2d6');
  const [history, setHistory] = useState<Array<{ notation: string; roll: DiceRoll }>>([]);
  const inputId = useId();
  const parsed = useMemo(() => parseDice(notation), [notation]);
  const range = parsed.ok ? diceRange(parsed.value) : null;

  function roll(expr = notation) {
    const p = expr === notation ? parsed : parseDice(expr);
    if (!p.ok) return;
    if (expr !== notation) setNotation(expr);
    const r = rollDice(p.value);
    setHistory((h) => [{ notation: expr.trim(), roll: r }, ...h].slice(0, 20));
  }

  const latest = history[0];
  return (
    <>
      <ToolBar>
        <ToolField label="Dice notation" htmlFor={inputId} className="w-full sm:w-56">
          <Input
            id={inputId}
            mono
            value={notation}
            onChange={(e) => setNotation(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') roll();
            }}
            placeholder="2d6+1"
            aria-invalid={!parsed.ok && notation.trim() !== '' ? true : undefined}
          />
        </ToolField>
        <Button variant="primary" icon={Dices} onClick={() => roll()} disabled={!parsed.ok}>
          Roll
        </Button>
        <div className="flex flex-wrap gap-1.5 pb-0.5">
          {QUICK_DICE.map((d) => (
            <Button key={d} size="sm" variant="subtle" onClick={() => roll(d)} className="font-mono">
              {d}
            </Button>
          ))}
        </div>
      </ToolBar>
      {notation.trim() !== '' && <ErrorMessage error={parsed.ok ? null : parsed.error} />}
      {range && <p className="-mt-1 px-1 text-[13px] text-fg-muted">Possible totals: {range.min} to {range.max}. Supports NdM, dM, d%, and + / − modifiers.</p>}
      {!latest ? (
        <IdleHint icon={Dices} text="Pick a die or type notation like 3d6+2, then Roll." />
      ) : (
        <Panel title={`Rolled ${latest.notation}`} actions={<CopyButton value={String(latest.roll.total)} label="Copy total" />}>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
            <div className="flex size-24 shrink-0 flex-col items-center justify-center rounded-xl border border-accent-line bg-accent-soft">
              <span className="text-[11px] font-medium tracking-wide text-fg-muted uppercase">Total</span>
              <span className="font-mono text-[32px] leading-none font-semibold text-accent-text tabular-nums">{latest.roll.total}</span>
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              {latest.roll.terms.map((t, i) => (
                <div key={i} className="flex min-w-0 flex-wrap items-center gap-1.5 text-[13px]">
                  <Badge tone={t.term.sign === -1 ? 'danger' : 'neutral'} className="font-mono">
                    {t.term.sign === -1 ? '−' : '+'}
                    {t.term.count === 0 ? t.term.constant : `${t.term.count}d${t.term.sides}`}
                  </Badge>
                  {t.rolls.slice(0, 200).map((v, j) => (
                    <span
                      key={j}
                      className={cn(
                        'inline-flex h-7 min-w-7 items-center justify-center rounded-md border px-1.5 font-mono text-[13px] tabular-nums',
                        v === t.term.sides ? 'border-success/40 bg-success-soft text-success' : v === 1 ? 'border-danger/40 bg-danger-soft text-danger' : 'border-line-strong bg-surface-raised text-fg',
                      )}
                    >
                      {v}
                    </span>
                  ))}
                  {t.rolls.length > 200 && <span className="text-fg-muted">+{t.rolls.length - 200} more</span>}
                  {t.term.count > 0 && <span className="text-fg-muted tabular-nums">= {t.subtotal}</span>}
                </div>
              ))}
            </div>
          </div>
          {history.length > 1 && (
            <div className="mt-4 border-t border-line pt-3">
              <p className="mb-2 text-[12.5px] font-medium text-fg-muted">Earlier rolls</p>
              <div className="flex flex-wrap gap-1.5">
                {history.slice(1).map((h, i) => (
                  <Badge key={i} className="font-mono">
                    {h.notation} → {h.roll.total}
                  </Badge>
                ))}
              </div>
            </div>
          )}
        </Panel>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------

function CoinSection() {
  const [count, setCount] = useToolState<number | ''>(TOOL, 'flips', 1);
  const [result, setResult] = useState<CoinFlips | null>(null);
  const countId = useId();
  const n = count === '' ? 0 : Math.floor(count);
  const error = count !== '' && (n < 1 || n > 10_000) ? 'Flip between 1 and 10,000 coins.' : null;

  return (
    <>
      <ToolBar>
        <ToolField label="Coins to flip" htmlFor={countId} className="w-32">
          <NumberInput id={countId} value={count} onChange={setCount} min={1} max={10000} step={1} />
        </ToolField>
        <div className="flex flex-wrap gap-1.5 pb-0.5">
          {[1, 10, 100, 1000].map((c) => (
            <Button key={c} size="sm" variant={n === c ? 'subtle' : 'ghost'} onClick={() => setCount(c)}>
              {formatNumber(c)}
            </Button>
          ))}
        </div>
        <Button variant="primary" icon={Coins} onClick={() => setResult(flipCoins(n))} disabled={Boolean(error) || n < 1} className="sm:ml-auto">
          Flip
        </Button>
      </ToolBar>
      <ErrorMessage error={error} />
      {!result ? (
        <IdleHint icon={Coins} text="Choose how many coins and press Flip." />
      ) : result.flips.length === 1 ? (
        <BigResult label="Coin flip" value={result.heads ? 'Heads' : 'Tails'} copy={result.heads ? 'Heads' : 'Tails'} />
      ) : (
        <Panel title={`${pluralize(result.flips.length, 'flip')}`} actions={<CopyButton value={result.flips.join('')} label="Copy sequence" />}>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Heads" value={`${formatNumber(result.heads)} (${((result.heads / result.flips.length) * 100).toFixed(1)}%)`} />
            <Stat label="Tails" value={`${formatNumber(result.tails)} (${((result.tails / result.flips.length) * 100).toFixed(1)}%)`} />
            <Stat label="Longest streak" value={`${result.longestStreak.length} × ${result.longestStreak.side === 'H' ? 'heads' : 'tails'}`} />
            <Stat label="Difference" value={formatNumber(Math.abs(result.heads - result.tails))} />
          </div>
          <div className="mt-4 max-h-48 overflow-y-auto rounded-lg border border-line bg-surface-sunken p-3 font-mono text-[12.5px] leading-relaxed tracking-wider break-all text-fg-secondary">
            {result.flips.join('')}
          </div>
          <p className="mt-2 text-[12px] text-fg-muted">H = heads, T = tails, in flip order.</p>
        </Panel>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------

function IdleHint({ icon, text }: { icon: typeof Dices; text: string }) {
  return (
    <div className="rounded-xl border border-dashed border-line-strong bg-surface-sunken">
      <EmptyState icon={icon} title={text} className="py-8" />
    </div>
  );
}

function BigResult({ label, value, copy }: { label: string; value: string; copy: string }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-line bg-surface px-6 py-8 text-center shadow-card">
      <p className="text-[13px] font-medium text-fg-muted">{label}</p>
      <p className="max-w-full font-mono text-[44px] leading-tight font-semibold break-all text-fg tabular-nums" aria-live="polite">
        {value}
      </p>
      <CopyButton value={copy} />
    </div>
  );
}

export default function RandomPicker() {
  const [mode, setMode] = useToolState<Mode>(TOOL, 'mode', 'numbers');
  return (
    <ToolStack>
      <Segmented
        label="Picker"
        value={mode}
        onChange={setMode}
        className="self-start"
        options={[
          { value: 'numbers', label: 'Numbers', icon: ListOrdered },
          { value: 'list', label: 'Pick from list', icon: Trophy },
          { value: 'shuffle', label: 'Shuffle', icon: Shuffle },
          { value: 'dice', label: 'Dice', icon: Dices },
          { value: 'coin', label: 'Coin', icon: Coins },
        ]}
      />
      {mode === 'numbers' && <NumbersSection />}
      {mode === 'list' && <ListSection key="pick" shuffle={false} />}
      {mode === 'shuffle' && <ListSection key="shuffle" shuffle />}
      {mode === 'dice' && <DiceSection />}
      {mode === 'coin' && <CoinSection />}
    </ToolStack>
  );
}
