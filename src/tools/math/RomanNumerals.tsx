import { useMemo } from 'react';
import { CalendarDays } from 'lucide-react';
import { ToolStack } from '@/components/tool/EditorPanel';
import { Panel } from '@/components/ui/Panel';
import { Field, Input } from '@/components/ui/Field';
import { Button } from '@/components/ui/Button';
import { CopyButton } from '@/components/ui/Actions';
import { ErrorMessage } from '@/components/ui/Alert';
import { useToolState } from '@/lib/hooks';
import { fromRoman, toRoman, type RomanPart } from './lib/roman';

const TOOL = 'roman-numerals';

function Breakdown({ parts }: { parts: RomanPart[] }) {
  // Group consecutive identical symbols: M M → MM (2000)
  const groups: RomanPart[] = [];
  for (const p of parts) {
    const last = groups.at(-1);
    if (last && p.symbol.length === 1 && [...last.symbol].every((c) => c === p.symbol)) {
      groups[groups.length - 1] = { symbol: last.symbol + p.symbol, value: last.value + p.value };
    } else groups.push({ ...p });
  }
  return (
    <div className="flex flex-wrap items-stretch gap-1.5" role="group" aria-label="Symbol breakdown">
      {groups.map((g, i) => (
        <div key={i} className="flex items-center gap-1.5">
          {i > 0 && <span className="text-fg-muted">+</span>}
          <div className="rounded-lg border border-line bg-surface-sunken px-2.5 py-1.5 text-center">
            <div className="font-mono text-[15px] font-semibold text-fg">{g.symbol}</div>
            <div className="font-mono text-[12px] tabular-nums text-fg-muted">{g.value}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

function ResultLine({ value }: { value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-line bg-surface-sunken px-3 py-2.5">
      <output className="min-w-0 font-mono text-[22px] font-semibold tracking-wide break-all text-fg">{value}</output>
      <CopyButton value={value} iconOnly />
    </div>
  );
}

export default function RomanNumerals() {
  const [numberText, setNumberText] = useToolState(TOOL, 'number', '2026');
  const [romanText, setRomanText] = useToolState(TOOL, 'roman', 'MCMXCIV');

  const toResult = useMemo(() => {
    const t = numberText.trim();
    if (!t) return null;
    if (!/^[+-]?\d+(\.\d+)?$/.test(t)) return { ok: false as const, error: 'Enter a whole number between 1 and 3999.' };
    return toRoman(Number(t));
  }, [numberText]);

  const fromResult = useMemo(() => (romanText.trim() ? fromRoman(romanText) : null), [romanText]);

  return (
    <ToolStack>
      <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-2">
        <Panel
          title="Number → Roman"
          actions={
            <Button size="sm" variant="ghost" icon={CalendarDays} onClick={() => setNumberText(String(new Date().getFullYear()))}>
              This year
            </Button>
          }
          bodyClassName="flex flex-col gap-4"
        >
          <Field label="Number (1–3999)">
            {({ id }) => (
              <Input
                id={id}
                inputMode="numeric"
                value={numberText}
                onChange={(e) => setNumberText(e.target.value)}
                placeholder="e.g. 1994"
                aria-invalid={toResult ? !toResult.ok : undefined}
                className="font-mono tabular-nums"
              />
            )}
          </Field>
          {toResult?.ok ? (
            <>
              <ResultLine value={toResult.value} />
              <Breakdown parts={toResult.parts} />
            </>
          ) : (
            <ErrorMessage error={toResult?.error} />
          )}
          {!toResult && <p className="text-[13px] text-fg-muted">Type a number to see it in Roman numerals.</p>}
        </Panel>

        <Panel title="Roman → Number" bodyClassName="flex flex-col gap-4">
          <Field label="Roman numeral" hint="Letters I, V, X, L, C, D, M — upper or lower case.">
            {({ id, describedBy }) => (
              <Input
                id={id}
                aria-describedby={describedBy}
                value={romanText}
                onChange={(e) => setRomanText(e.target.value)}
                placeholder="e.g. MMXXVI"
                autoCapitalize="characters"
                spellCheck={false}
                aria-invalid={fromResult ? !fromResult.ok : undefined}
                className="font-mono uppercase"
              />
            )}
          </Field>
          {fromResult?.ok ? (
            <>
              <ResultLine value={String(fromResult.value)} />
              <Breakdown parts={fromResult.parts} />
            </>
          ) : (
            <ErrorMessage error={fromResult?.error} title="Not a valid Roman numeral" />
          )}
          {!fromResult && <p className="text-[13px] text-fg-muted">Type a Roman numeral to convert it.</p>}
        </Panel>
      </div>

      <Panel title="Symbols">
        <div className="grid grid-cols-4 gap-2 sm:grid-cols-7">
          {(
            [
              ['I', 1],
              ['V', 5],
              ['X', 10],
              ['L', 50],
              ['C', 100],
              ['D', 500],
              ['M', 1000],
            ] as const
          ).map(([s, v]) => (
            <div key={s} className="rounded-lg border border-line bg-surface-sunken px-2 py-2 text-center">
              <div className="font-mono text-[15px] font-semibold text-fg">{s}</div>
              <div className="font-mono text-[12px] tabular-nums text-fg-muted">{v}</div>
            </div>
          ))}
        </div>
        <p className="mt-3 text-[13px] text-fg-secondary">
          A smaller symbol before a larger one is subtracted, but only in six pairs: IV (4), IX (9), XL (40), XC (90), CD (400)
          and CM (900). I, X, C and M repeat at most three times; V, L and D never repeat.
        </p>
      </Panel>
    </ToolStack>
  );
}
