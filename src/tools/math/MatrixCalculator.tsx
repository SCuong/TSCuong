import { useMemo } from 'react';
import { ArrowLeftRight, ArrowUp, Minus, Plus, RotateCcw } from 'lucide-react';
import { ToolBar, ToolStack } from '@/components/tool/EditorPanel';
import { Panel, Stat } from '@/components/ui/Panel';
import { Field, Input, Label } from '@/components/ui/Field';
import { Segmented } from '@/components/ui/Segmented';
import { Button, IconButton } from '@/components/ui/Button';
import { CopyButton } from '@/components/ui/Actions';
import { ErrorMessage } from '@/components/ui/Alert';
import { useToolState } from '@/lib/hooks';
import { cn } from '@/lib/utils';
import { Fraction } from './lib/fraction';
import { useRovingRadio } from './shared-a/useRovingRadio';
import {
  add,
  determinant,
  dimsLabel,
  inverse,
  MAX_SIZE,
  MatrixError,
  multiply,
  parseMatrix,
  power,
  rank,
  scalar,
  subtract,
  toStrings,
  toTsv,
  transpose,
  type Matrix,
} from './lib/matrix';

const TOOL = 'matrix-calculator';

type Op = 'add' | 'sub' | 'mul' | 'det' | 'inv' | 'transpose' | 'rank' | 'scalar' | 'power';

const OPS: Array<{ value: Op; label: string; needsB?: boolean }> = [
  { value: 'add', label: 'A + B', needsB: true },
  { value: 'sub', label: 'A − B', needsB: true },
  { value: 'mul', label: 'A × B', needsB: true },
  { value: 'det', label: 'det(A)' },
  { value: 'inv', label: 'A⁻¹' },
  { value: 'transpose', label: 'Aᵀ' },
  { value: 'rank', label: 'rank(A)' },
  { value: 'scalar', label: 'k · A' },
  { value: 'power', label: 'Aⁿ' },
];

type Grid = string[][];

function makeGrid(rows: number, cols: number, prev: Grid = []): Grid {
  return Array.from({ length: rows }, (_, i) => Array.from({ length: cols }, (_, j) => prev[i]?.[j] ?? '0'));
}

const DEFAULT_A: Grid = [
  ['2', '1', '1'],
  ['1', '3', '2'],
  ['1', '0', '0'],
];
const DEFAULT_B: Grid = [
  ['1', '0', '2'],
  ['0', '1', '0'],
  ['3', '1', '1'],
];

function SizeStepper({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div className="flex items-center gap-1">
      <span className="text-[12.5px] text-fg-muted">{label}</span>
      <IconButton icon={Minus} size="sm" variant="secondary" label={`Fewer ${label.toLowerCase()}`} disabled={value <= 1} onClick={() => onChange(value - 1)} />
      <span className="w-4 text-center font-mono text-[13px] tabular-nums text-fg">{value}</span>
      <IconButton icon={Plus} size="sm" variant="secondary" label={`More ${label.toLowerCase()}`} disabled={value >= MAX_SIZE} onClick={() => onChange(value + 1)} />
    </div>
  );
}

function GridEditor({ name, grid, onChange }: { name: string; grid: Grid; onChange: (g: Grid) => void }) {
  const rows = grid.length;
  const cols = grid[0]?.length ?? 0;
  return (
    <Panel
      title={`Matrix ${name}`}
      description={`${rows}×${cols}`}
      actions={
        <>
          <SizeStepper label="Rows" value={rows} onChange={(r) => onChange(makeGrid(r, cols, grid))} />
          <SizeStepper label="Cols" value={cols} onChange={(c) => onChange(makeGrid(rows, c, grid))} />
          <IconButton icon={RotateCcw} size="sm" label={`Reset ${name} to zeros`} onClick={() => onChange(makeGrid(rows, cols))} />
        </>
      }
    >
      <div className="overflow-x-auto">
        <div className="inline-grid gap-1.5" style={{ gridTemplateColumns: `repeat(${cols}, minmax(3.25rem, 4.5rem))` }}>
          {grid.map((row, i) =>
            row.map((cell, j) => {
              const invalid = cell.trim() === '' || Fraction.parse(cell) === null;
              return (
                <input
                  key={`${i}-${j}`}
                  value={cell}
                  inputMode="decimal"
                  aria-label={`${name} row ${i + 1} column ${j + 1}`}
                  aria-invalid={invalid || undefined}
                  onFocus={(e) => e.target.select()}
                  onChange={(e) => onChange(grid.map((r, ri) => (ri === i ? r.map((c, ci) => (ci === j ? e.target.value : c)) : r)))}
                  className="lk-field h-9 px-1.5 text-center font-mono text-[13px] tabular-nums"
                />
              );
            }),
          )}
        </div>
      </div>
    </Panel>
  );
}

function MatrixView({ m, mode, label }: { m: Matrix; mode: 'fraction' | 'decimal'; label: string }) {
  const cells = toStrings(m, mode);
  return (
    // Exact results can be very wide; the focusable region lets keyboard users scroll them.
    <div className="overflow-x-auto" tabIndex={0} role="region" aria-label={label}>
      <table className="border-separate border-spacing-0 font-mono text-[14px] tabular-nums">
        <tbody>
          {cells.map((row, i) => (
            <tr key={i}>
              {row.map((c, j) => (
                <td
                  key={j}
                  className={cn(
                    'px-3 py-1.5 text-right whitespace-nowrap text-fg',
                    j === 0 && 'border-l-2 border-line-strong',
                    j === row.length - 1 && 'border-r-2 border-line-strong',
                    i === 0 && (j === 0 ? 'rounded-tl-md' : j === row.length - 1 ? 'rounded-tr-md' : ''),
                  )}
                >
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

type Outcome = { kind: 'matrix'; value: Matrix; label: string } | { kind: 'scalar'; value: string; decimal?: string; label: string };

export default function MatrixCalculator() {
  const [a, setA] = useToolState<Grid>(TOOL, 'a', DEFAULT_A);
  const [b, setB] = useToolState<Grid>(TOOL, 'b', DEFAULT_B);
  const [op, setOp] = useToolState<Op>(TOOL, 'op', 'mul');
  const [k, setK] = useToolState(TOOL, 'k', '2');
  const [n, setN] = useToolState(TOOL, 'n', '2');
  const [mode, setMode] = useToolState<'fraction' | 'decimal'>(TOOL, 'mode', 'fraction');

  const needsB = OPS.find((o) => o.value === op)?.needsB ?? false;
  const radio = useRovingRadio(
    OPS.map((o) => o.value),
    op,
    setOp,
  );

  const outcome = useMemo((): { ok: true; value: Outcome } | { ok: false; error: string } => {
    try {
      const A = parseMatrix(a, 'A');
      const B = needsB ? parseMatrix(b, 'B') : null;
      switch (op) {
        case 'add':
          return { ok: true, value: { kind: 'matrix', value: add(A, B!), label: 'A + B' } };
        case 'sub':
          return { ok: true, value: { kind: 'matrix', value: subtract(A, B!), label: 'A − B' } };
        case 'mul':
          return { ok: true, value: { kind: 'matrix', value: multiply(A, B!), label: 'A × B' } };
        case 'transpose':
          return { ok: true, value: { kind: 'matrix', value: transpose(A), label: 'Aᵀ' } };
        case 'inv':
          return { ok: true, value: { kind: 'matrix', value: inverse(A), label: 'A⁻¹' } };
        case 'det': {
          const d = determinant(A);
          return { ok: true, value: { kind: 'scalar', value: d.toString(), decimal: d.isInteger() ? undefined : d.toDecimal(12), label: 'det(A)' } };
        }
        case 'rank':
          return { ok: true, value: { kind: 'scalar', value: String(rank(A)), label: 'rank(A)' } };
        case 'scalar': {
          const f = Fraction.parse(k);
          if (!f) return { ok: false, error: 'The scalar k must be a number such as 2, -0.5 or 1/3.' };
          return { ok: true, value: { kind: 'matrix', value: scalar(A, f), label: `${f.toString()} · A` } };
        }
        case 'power': {
          if (!/^\s*-?\d+\s*$/.test(n)) return { ok: false, error: 'The exponent n must be a whole number (negative uses the inverse).' };
          return { ok: true, value: { kind: 'matrix', value: power(A, Number(n)), label: `A^${Number(n)}` } };
        }
      }
    } catch (error) {
      if (error instanceof MatrixError) return { ok: false, error: error.message };
      if (error instanceof RangeError) return { ok: false, error: 'Division by zero while computing the result.' };
      throw error;
    }
  }, [a, b, op, k, n, needsB]);

  return (
    <ToolStack>
      <ToolBar>
        <div className="min-w-0">
          <Label>Operation</Label>
          <div role="radiogroup" aria-label="Operation" className="flex flex-wrap gap-1" onKeyDown={radio.onKeyDown}>
            {OPS.map((o, i) => (
              <button
                key={o.value}
                {...radio.optionProps(i)}
                type="button"
                role="radio"
                aria-checked={op === o.value}
                onClick={() => setOp(o.value)}
                className={cn(
                  'h-8 rounded-md border px-2.5 font-mono text-[13px] transition-colors',
                  op === o.value
                    ? 'border-accent-line bg-accent-soft text-accent-text'
                    : 'border-line bg-surface-sunken text-fg-secondary hover:bg-surface-hover hover:text-fg',
                )}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>
        {op === 'scalar' && (
          <Field label="k" className="w-28">
            {({ id }) => <Input id={id} mono value={k} onChange={(e) => setK(e.target.value)} />}
          </Field>
        )}
        {op === 'power' && (
          <Field label="n" className="w-28">
            {({ id }) => <Input id={id} mono value={n} onChange={(e) => setN(e.target.value)} inputMode="numeric" />}
          </Field>
        )}
        <div>
          <Label>Show</Label>
          <Segmented
            label="Number display"
            value={mode}
            onChange={setMode}
            options={[
              { value: 'fraction', label: 'Fractions' },
              { value: 'decimal', label: 'Decimals' },
            ]}
          />
        </div>
      </ToolBar>

      <div className={cn('grid min-w-0 grid-cols-1 gap-4', needsB && 'lg:grid-cols-2')}>
        <GridEditor name="A" grid={a} onChange={setA} />
        {needsB && <GridEditor name="B" grid={b} onChange={setB} />}
      </div>

      <Panel
        title={outcome.ok ? `Result: ${outcome.value.label}` : 'Result'}
        description={outcome.ok && outcome.value.kind === 'matrix' ? dimsLabel(outcome.value.value) : undefined}
        actions={
          <>
            {needsB && (
              <Button size="sm" variant="ghost" icon={ArrowLeftRight} onClick={() => { setA(b); setB(a); }}>
                Swap A and B
              </Button>
            )}
            {outcome.ok && outcome.value.kind === 'matrix' && (
              <>
                <Button
                  size="sm"
                  variant="ghost"
                  icon={ArrowUp}
                  onClick={() => outcome.value.kind === 'matrix' && setA(toStrings(outcome.value.value, 'fraction'))}
                >
                  Use as A
                </Button>
                <CopyButton value={toTsv(outcome.value.value, mode)} label="Copy" />
              </>
            )}
          </>
        }
      >
        {outcome.ok ? (
          outcome.value.kind === 'matrix' ? (
            <MatrixView m={outcome.value.value} mode={mode} label={`Result ${outcome.value.label}`} />
          ) : (
            <div className="grid max-w-md grid-cols-1 gap-2 sm:grid-cols-2">
              <Stat label={outcome.value.label} value={mode === 'decimal' && outcome.value.decimal ? outcome.value.decimal : outcome.value.value} />
              {outcome.value.decimal && mode === 'fraction' && <Stat label="Decimal" value={outcome.value.decimal} />}
            </div>
          )
        ) : (
          <ErrorMessage error={outcome.error} />
        )}
        <p className="mt-3 text-[12.5px] text-fg-muted">
          Cells accept integers, decimals and fractions (3, -1.5, 2/3). Arithmetic is exact, so inverses are shown as fractions
          without rounding error.
        </p>
      </Panel>
    </ToolStack>
  );
}
