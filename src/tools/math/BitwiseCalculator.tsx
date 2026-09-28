import { useMemo, type ReactNode } from 'react';
import { ToolBar, ToolStack } from '@/components/tool/EditorPanel';
import { KeyValueList, Panel } from '@/components/ui/Panel';
import { Input, Label } from '@/components/ui/Field';
import { Segmented } from '@/components/ui/Segmented';
import { CopyButton } from '@/components/ui/Actions';
import { ErrorMessage } from '@/components/ui/Alert';
import { useToolState } from '@/lib/hooks';
import { cn } from '@/lib/utils';
import { groupDigits, type Result } from './lib/base';
import {
  OPS,
  applyOp,
  interpret,
  opInfo,
  parseOperand,
  parseShiftCount,
  popcount,
  toBits,
  toHex,
  type Op,
  type Radix,
  type Width,
} from './lib/bitwise';

const TOOL = 'bitwise-calculator';
type WidthOpt = '8' | '16' | '32' | '64';

export default function BitwiseCalculator() {
  const [widthOpt, setWidthOpt] = useToolState<WidthOpt>(TOOL, 'width', '8');
  const [signed, setSigned] = useToolState(TOOL, 'signed', false);
  const [radix, setRadix] = useToolState<Radix>(TOOL, 'radix', 'dec');
  const [op, setOp] = useToolState<Op>(TOOL, 'op', 'and');
  const [aText, setAText] = useToolState(TOOL, 'a', '202');
  const [bText, setBText] = useToolState(TOOL, 'b', '172');
  const width = Number(widthOpt) as Width;
  const info = opInfo(op);

  const a = useMemo(() => (aText.trim() ? parseOperand(aText, radix, width, signed) : null), [aText, radix, width, signed]);
  const b = useMemo((): Result<bigint> | null => {
    if (info.kind === 'unary' || !bText.trim()) return null;
    return info.kind === 'shift' ? parseShiftCount(bText, radix) : parseOperand(bText, radix, width, signed);
  }, [bText, radix, width, signed, info.kind]);

  const needsB = info.kind !== 'unary';
  const result = useMemo(() => {
    if (!a?.ok) return null;
    if (needsB && !b?.ok) return null;
    return applyOp(op, a.value, needsB && b?.ok ? b.value : 0n, width);
  }, [a, b, op, width, needsB]);
  const out = result?.ok ? result.value : null;

  const changeRadix = (next: Radix) => {
    // Re-express the current operands in the new format so switching is lossless.
    const conv = (text: string, parsed: Result<bigint> | null, isShift: boolean) => {
      if (!parsed?.ok) return text;
      const v = isShift ? parsed.value : interpret(parsed.value, width, signed);
      if (next === 'dec') return v.toString();
      const pattern = isShift ? v : BigInt.asUintN(width, v);
      return next === 'hex' ? pattern.toString(16).toUpperCase() : pattern.toString(2);
    };
    setAText(conv(aText, a, false));
    if (needsB) setBText(conv(bText, b, info.kind === 'shift'));
    setRadix(next);
  };

  const radixHint = radix === 'dec' ? (signed ? 'Signed decimal' : 'Unsigned decimal') : radix === 'hex' ? 'Hex bit pattern' : 'Binary bit pattern';

  return (
    <ToolStack>
      <ToolBar>
        <div>
          <Label>Width</Label>
          <Segmented
            label="Bit width"
            value={widthOpt}
            onChange={setWidthOpt}
            options={(['8', '16', '32', '64'] as WidthOpt[]).map((w) => ({ value: w, label: `${w}-bit` }))}
          />
        </div>
        <div>
          <Label>Interpretation</Label>
          <Segmented
            label="Interpretation"
            value={signed ? 'signed' : 'unsigned'}
            onChange={(v) => setSigned(v === 'signed')}
            options={[
              { value: 'unsigned', label: 'Unsigned' },
              { value: 'signed', label: 'Signed' },
            ]}
          />
        </div>
        <div>
          <Label>Input format</Label>
          <Segmented
            label="Input format"
            value={radix}
            onChange={changeRadix}
            options={[
              { value: 'dec', label: 'Dec' },
              { value: 'hex', label: 'Hex' },
              { value: 'bin', label: 'Bin' },
            ]}
          />
        </div>
      </ToolBar>

      <Panel title="Operation" bodyClassName="flex flex-col gap-4">
        <div role="radiogroup" aria-label="Operation" className="grid grid-cols-3 gap-1.5 sm:grid-cols-6">
          {OPS.map((o) => (
            <button
              key={o.id}
              type="button"
              role="radio"
              aria-checked={op === o.id}
              title={o.name}
              onClick={() => setOp(o.id)}
              className={cn(
                'flex h-12 min-w-0 flex-col items-center justify-center rounded-lg border px-1 transition-colors',
                op === o.id
                  ? 'border-accent-line bg-accent-soft text-accent-text'
                  : 'border-line bg-surface-sunken text-fg-secondary hover:bg-surface-hover hover:text-fg',
              )}
            >
              <span className="font-mono text-[14px] leading-tight font-semibold">{o.symbol}</span>
              <span className="max-w-full truncate text-[11.5px] leading-tight">{o.id === 'sar' ? 'Arithmetic' : o.id === 'shr' ? 'Logical' : o.name}</span>
            </button>
          ))}
        </div>

        <div className={cn('grid grid-cols-1 gap-3', needsB && 'sm:grid-cols-2')}>
          <OperandInput id="bw-a" label="A" hint={radixHint} value={aText} onChange={setAText} error={a && !a.ok ? a.error : null} radix={radix} />
          {needsB && (
            <OperandInput
              id="bw-b"
              label={info.kind === 'shift' ? 'Shift by (bits)' : 'B'}
              hint={info.kind === 'shift' ? (op === 'rol' || op === 'ror' ? `Rotates by n mod ${width}` : 'Counts ≥ width shift everything out') : radixHint}
              value={bText}
              onChange={setBText}
              error={b && !b.ok ? b.error : null}
              radix={radix}
            />
          )}
        </div>
        {result && !result.ok && <ErrorMessage error={result.error} />}
        {op === 'sar' && (
          <p className="text-[12.5px] text-fg-muted">
            Arithmetic shift copies the top (sign) bit into the vacated positions; use &gt;&gt;&gt; for a logical shift that fills with zeros.
          </p>
        )}
      </Panel>

      {a?.ok && out !== null && (
        <>
          <Panel title="Bits" description="1 bits are highlighted; bit 0 is on the right." bodyClassName="p-0!">
            <div className="overflow-x-auto px-4 py-3">
              <BitGrid
                width={width}
                rows={[
                  { label: 'A', value: a.value },
                  ...(needsB && info.kind === 'binary' && b?.ok ? [{ label: 'B', value: b.value }] : []),
                  { label: info.kind === 'unary' ? '~A' : `A ${info.symbol} ${info.kind === 'shift' && b?.ok ? b.value.toString() : 'B'}`, value: out, result: true },
                ]}
              />
            </div>
          </Panel>
          <Panel title="Result" actions={<CopyButton value={interpret(out, width, signed).toString()} label="Copy decimal" />}>
            <KeyValueList
              items={[
                { label: `Decimal (${signed ? 'signed' : 'unsigned'})`, value: <Strong>{interpret(out, width, signed).toString()}</Strong> },
                { label: `Decimal (${signed ? 'unsigned' : 'signed'})`, value: interpret(out, width, !signed).toString() },
                { label: 'Hex', value: <CopyLine text={`0x${toHex(out, width)}`} /> },
                { label: 'Binary', value: <CopyLine text={groupDigits(toBits(out, width), 4, ' ')} copy={toBits(out, width)} /> },
                { label: 'Set bits', value: `${popcount(out)} of ${width}` },
              ]}
            />
          </Panel>
        </>
      )}
    </ToolStack>
  );
}

function Strong({ children }: { children: ReactNode }) {
  return <span className="text-[15px] font-semibold">{children}</span>;
}

function CopyLine({ text, copy }: { text: string; copy?: string }) {
  return (
    <span className="flex items-start justify-between gap-2">
      <span className="min-w-0 break-words">{text}</span>
      <CopyButton value={copy ?? text} iconOnly className="-my-1" />
    </span>
  );
}

function OperandInput({
  id,
  label,
  hint,
  value,
  onChange,
  error,
  radix,
}: {
  id: string;
  label: string;
  hint: string;
  value: string;
  onChange: (v: string) => void;
  error: string | null;
  radix: Radix;
}) {
  return (
    <div className="min-w-0">
      <div className="mb-1.5 flex items-baseline justify-between gap-2">
        <Label htmlFor={id} className="mb-0">
          {label}
        </Label>
        <span className="truncate text-[12px] text-fg-muted">{hint}</span>
      </div>
      <Input
        id={id}
        mono
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-err` : undefined}
        inputMode={radix === 'hex' ? 'text' : 'numeric'}
        autoCapitalize="off"
        autoComplete="off"
        spellCheck={false}
        placeholder={radix === 'dec' ? 'e.g. 202' : radix === 'hex' ? 'e.g. CA or 0xCA' : 'e.g. 1100 1010'}
      />
      {error && (
        <p id={`${id}-err`} role="alert" className="mt-1.5 text-[13px] text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

type BitRow = { label: string; value: bigint; result?: boolean };

/** Bit grid; 64-bit values are shown as two 32-bit halves so the grid fits common screens. */
function BitGrid({ width, rows }: { width: Width; rows: BitRow[] }) {
  const chunk = Math.min(width, 32);
  const halves = Array.from({ length: width / chunk }, (_, i) => width - i * chunk);
  return (
    <div className="flex flex-col items-start gap-4">
      {halves.map((top) => (
        <BitTable key={top} width={width} top={top} count={chunk} rows={rows} large={width <= 16} />
      ))}
    </div>
  );
}

function BitTable({ width, top, count, rows, large }: { width: Width; top: number; count: number; rows: BitRow[]; large: boolean }) {
  const nibbles = count / 4;
  return (
    <table className={cn('border-separate border-spacing-0 font-mono', large ? 'text-[13px]' : 'text-[12px]')}>
      <thead>
        <tr>
          <th className="sticky left-0 z-10 bg-surface pr-3" />
          {Array.from({ length: nibbles }, (_, n) => {
            const high = top - 1 - n * 4;
            return (
              <th key={n} colSpan={4} className={cn('pb-1 text-left text-[10.5px] font-normal text-fg-muted', n > 0 && 'pl-2')}>
                {high}
              </th>
            );
          })}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          const all = toBits(row.value, width);
          const bits = all.slice(width - top, width - top + count);
          return (
            <tr key={row.label}>
              <th
                scope="row"
                className={cn(
                  'sticky left-0 z-10 bg-surface pr-3 text-left text-[12px] font-medium whitespace-nowrap',
                  row.result ? 'pt-2 text-fg' : 'pt-1 text-fg-secondary',
                )}
              >
                {row.label}
              </th>
              {Array.from(bits).map((bit, i) => (
                <td key={i} className={cn(row.result ? 'pt-2' : 'pt-1', i % 4 === 0 && i > 0 && 'pl-2')}>
                  <span
                    className={cn(
                      'mx-px flex items-center justify-center rounded-[4px] border tabular-nums',
                      large ? 'h-7 w-[24px]' : 'h-6 w-[18px]',
                      bit === '1'
                        ? row.result
                          ? 'border-transparent bg-accent font-semibold text-accent-contrast'
                          : 'border-accent-line bg-accent-soft font-semibold text-accent-text'
                        : 'border-line bg-surface-sunken text-fg-muted',
                    )}
                    title={`bit ${top - 1 - i}`}
                  >
                    {bit}
                  </span>
                </td>
              ))}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
