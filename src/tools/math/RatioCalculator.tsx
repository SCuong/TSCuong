import { useMemo } from 'react';
import { ToolStack } from '@/components/tool/EditorPanel';
import { Panel, Stat } from '@/components/ui/Panel';
import { Field, Input, Label } from '@/components/ui/Field';
import { Segmented } from '@/components/ui/Segmented';
import { CopyButton } from '@/components/ui/Actions';
import { ErrorMessage } from '@/components/ui/Alert';
import { useToolState } from '@/lib/hooks';
import { cn } from '@/lib/utils';
import { Fraction } from './lib/fraction';
import { parseRatio, scaleRatio, simplify, solveProportion, type Unknown } from './lib/ratio';

const TOOL = 'ratio-calculator';
const PRESETS = ['16:9', '4:3', '3:2', '21:9', '1:1', '9:16', '5:4', '2:1'];

function SimplifyCard() {
  const [text, setText] = useToolState(TOOL, 'simplify', '1920:1080');
  const result = useMemo(() => {
    if (!text.trim()) return null;
    const parsed = parseRatio(text);
    if (!parsed.ok) return parsed;
    const simple = simplify(parsed.value);
    const first = parsed.value[0];
    const decimals = first.isZero() ? null : parsed.value.map((t) => t.div(first).toDecimal(8));
    return { ok: true as const, simple, decimals, terms: parsed.value };
  }, [text]);
  const simpleText = result?.ok ? result.simple.join(':') : '';
  return (
    <Panel title="Simplify a ratio" bodyClassName="flex flex-col gap-3">
      <Field label="Ratio" hint="Two or more terms: 1920:1080, 4:6:8, 1.5:2 or 1280x720.">
        {({ id, describedBy }) => (
          <Input id={id} aria-describedby={describedBy} mono value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. 1920:1080" />
        )}
      </Field>
      {result?.ok ? (
        <>
          <div className="flex items-center justify-between gap-3 rounded-lg border border-line bg-surface-sunken px-3 py-2">
            <output className="min-w-0 font-mono text-[22px] font-semibold break-all text-fg">{simpleText}</output>
            <CopyButton value={simpleText} iconOnly />
          </div>
          {result.terms.length === 2 && !result.terms[1].isZero() && (
            <p className="text-[13px] text-fg-secondary">
              As x:1 <span className="font-mono text-fg">{result.terms[0].div(result.terms[1]).toDecimal(6)}:1</span>
              {' '}· quotient <span className="font-mono text-fg">{result.terms[0].div(result.terms[1]).toDecimal(12)}</span>
            </p>
          )}
          {result.terms.length > 2 && result.decimals && (
            <p className="text-[13px] text-fg-secondary">
              Relative to the first term: <span className="font-mono text-fg">{result.decimals.join(' : ')}</span>
            </p>
          )}
        </>
      ) : (
        <ErrorMessage error={result?.error} />
      )}
    </Panel>
  );
}

function ProportionCard() {
  const [values, setValues] = useToolState<Record<Unknown, string>>(TOOL, 'prop', { a: '3', b: '4', c: '15', d: '' });
  const [unknown, setUnknown] = useToolState<Unknown>(TOOL, 'unknown', 'd');
  const result = useMemo(() => solveProportion(values, unknown), [values, unknown]);
  const empty = (['a', 'b', 'c', 'd'] as Unknown[]).filter((k) => k !== unknown).every((k) => !values[k].trim());

  const cell = (key: Unknown) => {
    const isUnknown = key === unknown;
    const shown = isUnknown ? (result.ok ? result.value.toDecimal(10) : '?') : values[key];
    return (
      <div className="min-w-0">
        <label htmlFor={`prop-${key}`} className="mb-1 block text-center text-[12px] font-medium text-fg-muted">
          {key.toUpperCase()}
        </label>
        <input
          id={`prop-${key}`}
          value={shown}
          readOnly={isUnknown}
          inputMode="decimal"
          onChange={(e) => setValues({ ...values, [key]: e.target.value })}
          className={cn(
            'lk-field text-center font-mono tabular-nums',
            isUnknown && 'border-accent-line bg-accent-soft font-semibold text-accent-text',
          )}
          aria-label={isUnknown ? `${key.toUpperCase()} (solved)` : key.toUpperCase()}
        />
      </div>
    );
  };

  return (
    <Panel title="Solve A : B = C : D" bodyClassName="flex flex-col gap-3">
      <div>
        <Label>Solve for</Label>
        <Segmented
          label="Unknown value"
          value={unknown}
          onChange={setUnknown}
          options={(['a', 'b', 'c', 'd'] as Unknown[]).map((k) => ({ value: k, label: k.toUpperCase() }))}
        />
      </div>
      <div className="grid grid-cols-[1fr_auto_1fr_auto_1fr_auto_1fr] items-end gap-1.5">
        {cell('a')}
        <span className="pb-2 text-fg-muted">:</span>
        {cell('b')}
        <span className="pb-2 text-fg-muted">=</span>
        {cell('c')}
        <span className="pb-2 text-fg-muted">:</span>
        {cell('d')}
      </div>
      {result.ok ? (
        <p className="text-[13px] text-fg-secondary">
          {unknown.toUpperCase()} = <span className="font-mono font-semibold text-fg">{result.value.toDecimal(12)}</span>
          {!result.value.isInteger() && (
            <>
              {' '}
              (exactly <span className="font-mono text-fg">{result.value.toString()}</span>)
            </>
          )}
        </p>
      ) : empty ? (
        <p className="text-[13px] text-fg-muted">Enter the three known values.</p>
      ) : (
        <ErrorMessage error={result.error} />
      )}
    </Panel>
  );
}

function ScaleCard() {
  const [ratio, setRatio] = useToolState(TOOL, 'scaleRatio', '16:9');
  const [known, setKnown] = useToolState<'width' | 'height'>(TOOL, 'scaleKnown', 'width');
  const [value, setValue] = useToolState(TOOL, 'scaleValue', '1280');

  const result = useMemo(() => {
    const r = parseRatio(ratio);
    if (!r.ok) return r;
    if (r.value.length !== 2) return { ok: false as const, error: 'Use a two-term ratio (width:height) for scaling.' };
    if (!value.trim()) return null;
    const v = Fraction.parse(value);
    if (!v || v.num < 0n) return { ok: false as const, error: `${known === 'width' ? 'Width' : 'Height'} must be a positive number.` };
    const out = scaleRatio(r.value[0], r.value[1], known, v);
    if (!out.ok) return out;
    const w = known === 'width' ? v : out.value;
    const h = known === 'height' ? v : out.value;
    return { ok: true as const, w, h };
  }, [ratio, known, value]);

  return (
    <Panel title="Scale a ratio (aspect ratio)" bodyClassName="flex flex-col gap-3">
      <div className="flex flex-wrap gap-1.5">
        {PRESETS.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => setRatio(p)}
            className={cn(
              'h-7 rounded-md border px-2 font-mono text-[12.5px]',
              ratio.replace(/\s/g, '') === p
                ? 'border-accent-line bg-accent-soft text-accent-text'
                : 'border-line bg-surface-sunken text-fg-secondary hover:bg-surface-hover hover:text-fg',
            )}
          >
            {p}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label="Ratio (W:H)">
          {({ id }) => <Input id={id} mono value={ratio} onChange={(e) => setRatio(e.target.value)} />}
        </Field>
        <div>
          <Label>I know the</Label>
          <Segmented
            label="Known side"
            value={known}
            onChange={setKnown}
            options={[
              { value: 'width', label: 'Width' },
              { value: 'height', label: 'Height' },
            ]}
          />
        </div>
        <Field label={known === 'width' ? 'Width' : 'Height'}>
          {({ id }) => <Input id={id} mono inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} />}
        </Field>
      </div>
      {result?.ok ? (
        <div className="grid grid-cols-2 gap-2">
          <Stat label="Width" value={result.w.toDecimal(10)} />
          <Stat label="Height" value={result.h.toDecimal(10)} />
        </div>
      ) : (
        <ErrorMessage error={result?.error} />
      )}
    </Panel>
  );
}

export default function RatioCalculator() {
  return (
    <ToolStack>
      <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-2">
        <SimplifyCard />
        <ProportionCard />
      </div>
      <ScaleCard />
    </ToolStack>
  );
}
