import { useMemo, useState } from 'react';
import { ArrowLeftRight, Search } from 'lucide-react';
import { ToolStack } from '@/components/tool/EditorPanel';
import { Panel } from '@/components/ui/Panel';
import { Field, Input, Label, Select, Switch } from '@/components/ui/Field';
import { Segmented } from '@/components/ui/Segmented';
import { IconButton } from '@/components/ui/Button';
import { CopyButton } from '@/components/ui/Actions';
import { Alert, ErrorMessage } from '@/components/ui/Alert';
import { useToolState } from '@/lib/hooks';
import { cn } from '@/lib/utils';
import { formatNumber, parseNumber } from './shared-a/format';
import { UNIT_CATEGORIES, convert, getCategory, getUnit, searchUnits, validateValue, type CategoryKey, type Unit, type UnitCategory } from './lib/units';

const TOOL = 'unit-converter';
type Precision = '4' | '6' | '8' | '10' | '12' | '15';

interface Selection {
  category: CategoryKey;
  from: string;
  to: string;
}

const TEMPERATURE_FORMULAS: Record<string, string> = {
  'c>f': '°F = °C × 9/5 + 32',
  'f>c': '°C = (°F − 32) × 5/9',
  'c>k': 'K = °C + 273.15',
  'k>c': '°C = K − 273.15',
  'f>k': 'K = (°F + 459.67) × 5/9',
  'k>f': '°F = K × 9/5 − 459.67',
  'c>r': '°R = (°C + 273.15) × 9/5',
  'r>c': '°C = (°R − 491.67) × 5/9',
  'f>r': '°R = °F + 459.67',
  'r>f': '°F = °R − 459.67',
  'k>r': '°R = K × 9/5',
  'r>k': 'K = °R × 5/9',
};

export default function UnitConverter() {
  const [selection, setSelection] = useToolState<Selection>(TOOL, 'selection', { category: 'length', from: 'ft', to: 'm' });
  const [input, setInput] = useToolState(TOOL, 'value', '1');
  const [precisionOpt, setPrecisionOpt] = useToolState<Precision>(TOOL, 'precision', '10');
  const [grouping, setGrouping] = useToolState(TOOL, 'grouping', true);
  const [query, setQuery] = useState('');

  const category = getCategory(selection.category) ?? UNIT_CATEGORIES[0];
  const from = getUnit(category, selection.from) ?? getUnit(category, category.defaultFrom)!;
  const to = getUnit(category, selection.to) ?? getUnit(category, category.defaultTo)!;
  const precision = Number(precisionOpt);
  const fmt = (v: number) => formatNumber(v, { precision, grouping });
  const plain = (v: number) => formatNumber(v, { precision, grouping: false });

  const value = input.trim() ? parseNumber(input) : null;
  const inputError = input.trim() && value === null ? `"${input.trim()}" is not a valid number.` : null;
  const issue = value === null ? null : validateValue(category, from, value);
  const blocked = issue?.level === 'error';
  const result = value !== null && !blocked ? convert(value, from, to) : null;

  const matches = useMemo(() => searchUnits(query, 10), [query]);

  const selectCategory = (cat: UnitCategory) => {
    if (cat.id === category.id) return;
    setSelection({ category: cat.id, from: cat.defaultFrom, to: cat.defaultTo });
  };
  const swap = () => setSelection({ ...selection, from: to.id, to: from.id });

  const formula = useMemo(() => {
    if (category.id === 'temperature') return TEMPERATURE_FORMULAS[`${from.id}>${to.id}`] ?? null;
    if (from.id === to.id) return null;
    const one = convert(1, from, to);
    if (!Number.isFinite(one)) return null;
    if (category.id === 'fuel' && (from.id === 'l100' || to.id === 'l100')) {
      // Reciprocal relationship: value_to = k ÷ value_from, with k = convert(1, from, to).
      return `${to.symbol} = ${formatNumber(one, { precision })} ÷ ${from.symbol} (reciprocal)`;
    }
    return `1 ${from.symbol} = ${formatNumber(one, { precision })} ${to.symbol}`;
  }, [category, from, to, precision]);

  return (
    <ToolStack>
      <Panel bodyClassName="flex flex-col gap-3">
        <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Category">
          {UNIT_CATEGORIES.map((cat) => (
            <button
              key={cat.id}
              type="button"
              role="radio"
              aria-checked={cat.id === category.id}
              onClick={() => selectCategory(cat)}
              className={cn(
                'h-8 rounded-lg border px-2.5 text-[13px] font-medium whitespace-nowrap transition-colors',
                cat.id === category.id
                  ? 'border-accent-line bg-accent-soft text-accent-text'
                  : 'border-line bg-surface-sunken text-fg-secondary hover:bg-surface-hover hover:text-fg',
              )}
            >
              {cat.name}
            </button>
          ))}
        </div>
        <div className="relative">
          <Search size={15} aria-hidden className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-fg-muted" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search units: feet, psi, MiB, fahrenheit…"
            aria-label="Search units"
            className="pl-9"
          />
        </div>
        {query.trim() && (
          <div className="flex flex-wrap gap-1.5" aria-live="polite">
            {matches.length === 0 ? (
              <p className="text-[13px] text-fg-muted">No units match “{query.trim()}”.</p>
            ) : (
              matches.map((m) => (
                <button
                  key={`${m.category.id}:${m.unit.id}`}
                  type="button"
                  onClick={() => {
                    const cat = m.category;
                    const nextTo = cat.id === category.id ? (to.id === m.unit.id ? from.id : to.id) : cat.defaultTo === m.unit.id ? cat.defaultFrom : cat.defaultTo;
                    setSelection({ category: cat.id, from: m.unit.id, to: nextTo });
                    setQuery('');
                  }}
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line bg-surface-raised px-2.5 text-[13px] text-fg hover:border-accent-line hover:bg-accent-soft"
                >
                  <span className="font-medium">{m.unit.name}</span>
                  <span className="font-mono text-[12px] text-fg-muted">{m.unit.symbol}</span>
                  <span className="text-[12px] text-fg-muted">· {m.category.name}</span>
                </button>
              ))
            )}
          </div>
        )}
      </Panel>

      <Panel title={category.name} bodyClassName="flex flex-col gap-4">
        <div className="grid grid-cols-1 items-end gap-3 md:grid-cols-[1fr_auto_1fr]">
          <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-2">
            <Field label="Value">
              {({ id }) => (
                <Input
                  id={id}
                  mono
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  inputMode="decimal"
                  autoComplete="off"
                  aria-invalid={inputError ? true : undefined}
                  placeholder="e.g. 12.5"
                />
              )}
            </Field>
            <Field label="From">
              {({ id }) => (
                <UnitSelect id={id} units={category.units} value={from.id} onChange={(u) => setSelection({ ...selection, from: u })} />
              )}
            </Field>
          </div>
          <IconButton icon={ArrowLeftRight} label="Swap units" variant="secondary" onClick={swap} className="justify-self-center max-md:rotate-90" />
          <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-2">
            <div className="min-w-0">
              <Label>Result</Label>
              <div className="flex h-[36px] items-center justify-between gap-1 rounded-lg border border-accent-line bg-accent-soft pr-0.5 pl-2.5">
                <output className="min-w-0 truncate font-mono text-[14px] font-semibold text-fg tabular-nums" title={result === null ? undefined : plain(result)}>
                  {result === null ? '—' : fmt(result)}
                </output>
                <CopyButton value={result === null ? '' : plain(result)} iconOnly label="Copy result" />
              </div>
            </div>
            <Field label="To">
              {({ id }) => <UnitSelect id={id} units={category.units} value={to.id} onChange={(u) => setSelection({ ...selection, to: u })} />}
            </Field>
          </div>
        </div>

        <ErrorMessage error={inputError} />
        {issue && <Alert tone={issue.level === 'error' ? 'danger' : 'warning'}>{issue.message}</Alert>}

        {result !== null && value !== null && (
          <div className="rounded-lg border border-line bg-surface-sunken px-3 py-2.5">
            <p className="font-mono text-[15px] break-words text-fg tabular-nums">
              {fmt(value)} {from.symbol} = <span className="font-semibold">{fmt(result)}</span> {to.symbol}
            </p>
            {formula && !(value === 1 && formula.startsWith('1 ')) && <p className="mt-0.5 text-[12.5px] text-fg-muted">{formula}</p>}
          </div>
        )}

        <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
          <div>
            <Label>Significant digits</Label>
            <Segmented
              label="Significant digits"
              size="sm"
              value={precisionOpt}
              onChange={setPrecisionOpt}
              options={(['4', '6', '8', '10', '12', '15'] as Precision[]).map((p) => ({ value: p, label: p }))}
            />
          </div>
          <Switch label="Thousands separators" checked={grouping} onChange={setGrouping} className="h-7" />
        </div>
      </Panel>

      <Panel
        title={`All ${category.name.toLowerCase()} units`}
        description={value !== null && !blocked ? `${fmt(value)} ${from.symbol} in every unit. Click a row to convert to it.` : 'Enter a value to fill the table.'}
        bodyClassName="p-0!"
      >
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-line text-left text-[12px] text-fg-muted">
                <th className="py-2 pr-2 pl-4 font-medium">Unit</th>
                <th className="hidden px-2 py-2 font-medium sm:table-cell">Symbol</th>
                <th className="px-2 py-2 text-right font-medium">Value</th>
                <th className="w-10 px-2 py-2">
                  <span className="sr-only">Copy</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {category.units.map((unit) => {
                const v = value !== null && !blocked ? convert(value, from, unit) : null;
                const isFrom = unit.id === from.id;
                const isTo = unit.id === to.id;
                return (
                  <tr
                    key={unit.id}
                    onClick={() => !isFrom && setSelection({ ...selection, to: unit.id })}
                    className={cn(
                      'border-b border-line last:border-b-0',
                      isTo ? 'bg-accent-soft' : isFrom ? 'bg-surface-sunken' : 'cursor-pointer hover:bg-surface-hover',
                    )}
                  >
                    <td className="py-1.5 pr-2 pl-4 text-fg">
                      {unit.name}
                      <span className="ml-1.5 font-mono text-[12px] text-fg-muted sm:hidden">{unit.symbol}</span>
                      {isFrom && <span className="ml-2 text-[11.5px] text-fg-muted">from</span>}
                      {isTo && <span className="ml-2 text-[11.5px] text-accent-text">to</span>}
                    </td>
                    <td className="hidden px-2 py-1.5 font-mono text-[12.5px] whitespace-nowrap text-fg-secondary sm:table-cell">{unit.symbol}</td>
                    <td className="px-2 py-1.5 text-right font-mono whitespace-nowrap text-fg tabular-nums">{v === null ? '—' : fmt(v)}</td>
                    <td className="px-2 py-1" onClick={(e) => e.stopPropagation()}>
                      <CopyButton value={v === null ? '' : plain(v)} iconOnly label={`Copy ${unit.name}`} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {category.note && <p className="border-t border-line px-4 py-2.5 text-[12.5px] text-fg-muted">{category.note}</p>}
      </Panel>
    </ToolStack>
  );
}

function UnitSelect({ id, units, value, onChange }: { id: string; units: Unit[]; value: string; onChange: (id: string) => void }) {
  return (
    <Select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
      {units.map((u) => (
        <option key={u.id} value={u.id}>
          {u.name} ({u.symbol})
        </option>
      ))}
    </Select>
  );
}
