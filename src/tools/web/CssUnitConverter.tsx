import { useMemo } from 'react';
import { ToolStack } from '@/components/tool/EditorPanel';
import { Panel } from '@/components/ui/Panel';
import { Field, Input, Label, NumberInput, Select, Textarea } from '@/components/ui/Field';
import { CopyButton } from '@/components/ui/Actions';
import { useToolState } from '@/lib/hooks';
import { cn } from '@/lib/utils';
import { CSS_UNITS, DEFAULT_CONTEXT, UNIT_INFO, batchConvert, convert, formatNumber, parseLength, type CssUnit, type UnitContext } from './lib/cssUnits';
import { t } from '@/lib/i18n';

const TOOL = 'css-unit-converter';

function ContextField({ label, value, onChange, hint }: { label: string; value: number; onChange: (v: number) => void; hint?: string }) {
  return (
    <Field label={label} hint={hint}>
      {({ id, describedBy }) => (
        <div className="relative">
          <NumberInput
            id={id}
            aria-describedby={describedBy}
            value={value}
            min={0}
            onChange={(v) => onChange(v === '' ? 0 : Math.max(0, v))}
            className="pr-8"
          />
          <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-[12px] text-fg-muted">{t('px')}</span>
        </div>
      )}
    </Field>
  );
}

export default function CssUnitConverter() {
  const [input, setInput] = useToolState(TOOL, 'input', '24px');
  const [ctx, setCtx] = useToolState<UnitContext>(TOOL, 'context', DEFAULT_CONTEXT);
  const [precision, setPrecision] = useToolState(TOOL, 'precision', 4);
  const [batch, setBatch] = useToolState(TOOL, 'batch', '12px\n14px\n16px\n1.25rem\n18pt\n2em\n50%\n10vw');
  const [target, setTarget] = useToolState<CssUnit>(TOOL, 'target', 'rem');
  const set = (k: keyof UnitContext) => (v: number) => setCtx((c) => ({ ...c, [k]: v }));

  const parsed = parseLength(input);
  const rows = useMemo(() => batchConvert(batch, target, ctx, precision), [batch, target, ctx, precision]);
  const batchOutput = rows.map((r) => r.result ?? `/* ${r.input}: ${r.error} */`).join('\n');

  return (
    <ToolStack>
      <Panel bodyClassName="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_160px]">
          <Field label={t('Value')} hint={t('A number with a unit, e.g. 24px, 1.5rem, 12pt or 50%.')} error={input.trim() && !parsed ? t('Enter a number followed by a CSS unit.') : null}>
            {({ id, describedBy, invalid }) => (
              <Input id={id} aria-describedby={describedBy} aria-invalid={invalid || undefined} mono value={input} onChange={(e) => setInput(e.target.value)} className="text-[16px]" />
            )}
          </Field>
          <div>
            <Label htmlFor="cu-precision">{t('Decimals')}</Label>
            <Select id="cu-precision" value={precision} onChange={(e) => setPrecision(Number(e.target.value))}>
              {[0, 1, 2, 3, 4, 6].map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </Select>
          </div>
        </div>
        {parsed && (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
            {CSS_UNITS.map((u) => {
              const v = convert(parsed.value, parsed.unit, u, ctx);
              const text = Number.isFinite(v) ? `${formatNumber(v, precision)}${u}` : '—';
              return (
                <div
                  key={u}
                  className={cn('flex items-center gap-1 rounded-lg border px-3 py-2', u === parsed.unit ? 'border-accent-line bg-accent-soft' : 'border-line bg-surface-sunken')}
                  title={UNIT_INFO[u]}
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-[11.5px] text-fg-muted">{u}</div>
                    <div className="truncate font-mono text-[14px] font-semibold text-fg tabular-nums">{text}</div>
                  </div>
                  <CopyButton value={Number.isFinite(v) ? text : ''} iconOnly label={t('Copy {text}', { text })} />
                </div>
              );
            })}
          </div>
        )}
      </Panel>

      <Panel title={t('Reference sizes')} description={t('Relative units depend on these. Absolute units (pt, in, cm…) use the CSS standard of 96px per inch.')}>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <ContextField label={t('Root font size (rem)')} value={ctx.rootFontSize} onChange={set('rootFontSize')} />
          <ContextField label={t('Parent font size (em)')} value={ctx.parentFontSize} onChange={set('parentFontSize')} />
          <ContextField label={t('Viewport width (vw)')} value={ctx.viewportWidth} onChange={set('viewportWidth')} />
          <ContextField label={t('Viewport height (vh)')} value={ctx.viewportHeight} onChange={set('viewportHeight')} />
          <ContextField label={t('100% equals')} value={ctx.percentBase} onChange={set('percentBase')} hint={t('e.g. the parent\'s width')} />
        </div>
      </Panel>

      <Panel
        title={t('Batch conversion')}
        actions={
          <div className="flex items-center gap-2">
            <Label htmlFor="cu-target" className="mb-0">
              {t('Convert to')}
            </Label>
            <Select id="cu-target" value={target} onChange={(e) => setTarget(e.target.value as CssUnit)} className="w-auto">
              {CSS_UNITS.map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </Select>
            <CopyButton value={batchOutput} label={t('Copy results')} />
          </div>
        }
      >
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <Label htmlFor="cu-batch">{t('Values (one per line or comma-separated; bare numbers are px)')}</Label>
            <Textarea id="cu-batch" rows={10} value={batch} onChange={(e) => setBatch(e.target.value)} />
          </div>
          <div className="min-w-0 overflow-x-auto" tabIndex={0} role="region" aria-label={t('Converted values')}>
            <table className="w-full text-left text-[13px]">
              <thead className="text-[12px] text-fg-muted">
                <tr className="border-b border-line">
                  <th className="py-2 pr-3 font-medium">{t('Input')}</th>
                  <th className="py-2 pr-3 font-medium">{t('px')}</th>
                  <th className="py-2 font-medium">{target}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line font-mono text-[12.5px]">
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={3} className="py-4 font-sans text-fg-muted">
                      {t('Enter some values to convert.')}
                    </td>
                  </tr>
                )}
                {rows.slice(0, 500).map((r, i) => (
                  <tr key={i}>
                    <td className="py-1.5 pr-3 text-fg-secondary">{r.input}</td>
                    <td className="py-1.5 pr-3 text-fg-secondary">{r.parsed ? formatNumber(convert(r.parsed.value, r.parsed.unit, 'px', ctx), precision) : ''}</td>
                    <td className={cn('py-1.5', r.error ? 'font-sans text-danger' : 'font-semibold text-fg')}>{r.result ?? r.error}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {rows.length > 500 && <p className="mt-2 text-[12.5px] text-fg-muted">{t('Showing 500 of {count} rows; “Copy results” includes all of them.', { count: rows.length })}</p>}
          </div>
        </div>
      </Panel>
    </ToolStack>
  );
}
