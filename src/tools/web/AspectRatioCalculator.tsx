import { useMemo } from 'react';
import { ArrowLeftRight, Lock, LockOpen } from 'lucide-react';
import { ToolStack } from '@/components/tool/EditorPanel';
import { Panel, Stat } from '@/components/ui/Panel';
import { Field, Input, NumberInput } from '@/components/ui/Field';
import { Button, IconButton } from '@/components/ui/Button';
import { CopyButton } from '@/components/ui/Actions';
import { useToolState } from '@/lib/hooks';
import { cn } from '@/lib/utils';
import {
  RATIO_PRESETS,
  commonSizes,
  cssSnippets,
  fmt,
  paddingPercent,
  parseRatio,
  ratioDecimal,
  ratioLabel,
  simplifyRatio,
  solveHeight,
  solveWidth,
  type Ratio,
} from './lib/aspectRatio';

const TOOL = 'aspect-ratio-calculator';

interface State {
  width: number | '';
  height: number | '';
  ratioText: string;
  locked: boolean;
}

const INITIAL: State = { width: 1920, height: 1080, ratioText: '16:9', locked: true };

const round = (n: number) => Math.round(n * 100) / 100;

function nearestPreset(r: Ratio) {
  const d = ratioDecimal(r);
  let best = RATIO_PRESETS[0];
  for (const p of RATIO_PRESETS) if (Math.abs(ratioDecimal(p.ratio) - d) < Math.abs(ratioDecimal(best.ratio) - d)) best = p;
  const off = Math.abs(ratioDecimal(best.ratio) - d) / d;
  return off < 0.01 ? { preset: best, exact: off < 1e-9 } : null;
}

export default function AspectRatioCalculator() {
  const [stored, setState] = useToolState<State>(TOOL, 'state', INITIAL);
  const s = { ...INITIAL, ...stored };
  const ratio = parseRatio(s.ratioText);
  const update = (patch: Partial<State>) => setState((prev) => ({ ...INITIAL, ...prev, ...patch }));

  function setWidth(w: number | '') {
    if (s.locked && ratio && w !== '' && w > 0) update({ width: w, height: round(solveHeight(w, ratio)) });
    else {
      const r = w !== '' && s.height !== '' ? simplifyRatio(w, s.height) : null;
      update({ width: w, ...(r && !s.locked ? { ratioText: ratioLabel(r) } : {}) });
    }
  }
  function setHeight(h: number | '') {
    if (s.locked && ratio && h !== '' && h > 0) update({ height: h, width: round(solveWidth(h, ratio)) });
    else {
      const r = s.width !== '' && h !== '' ? simplifyRatio(s.width, h) : null;
      update({ height: h, ...(r && !s.locked ? { ratioText: ratioLabel(r) } : {}) });
    }
  }
  function setRatio(text: string) {
    const r = parseRatio(text);
    if (r && s.width !== '' && s.width > 0) update({ ratioText: text, height: round(solveHeight(s.width, r)) });
    else update({ ratioText: text });
  }
  function swap() {
    const r = parseRatio(s.ratioText);
    update({
      width: s.height,
      height: s.width,
      ratioText: r ? (Number.isInteger(r.w) && Number.isInteger(r.h) ? `${r.h}:${r.w}` : `${fmt(r.h)}:${fmt(r.w)}`) : s.ratioText,
    });
  }

  const dims = s.width !== '' && s.height !== '' && s.width > 0 && s.height > 0 ? { w: s.width, h: s.height } : null;
  const dimRatio = dims ? simplifyRatio(dims.w, dims.h) : null;
  const shown = ratio ?? dimRatio;
  const near = shown ? nearestPreset(shown) : null;
  const css = shown ? cssSnippets(shown) : null;
  const sizes = useMemo(() => (ratio ? commonSizes(ratio) : []), [ratio]);
  const mismatch = ratio && dims && Math.abs(dims.w / dims.h - ratioDecimal(ratio)) / ratioDecimal(ratio) > 0.005;

  // Preview box: fit within 320 × 200 while keeping the ratio.
  const pr = shown ? ratioDecimal(shown) : 16 / 9;
  const pw = pr >= 1.6 ? 320 : Math.round(200 * pr);
  const ph = pr >= 1.6 ? Math.round(320 / pr) : 200;

  return (
    <ToolStack>
      <Panel bodyClassName="flex flex-col gap-4">
        <div className="grid grid-cols-1 items-end gap-3 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto_minmax(0,1fr)]">
          <Field label="Width">
            {({ id }) => <NumberInput id={id} min={0} step="any" value={s.width} onChange={setWidth} className="text-[16px]" />}
          </Field>
          <IconButton icon={ArrowLeftRight} label="Swap width and height" variant="secondary" onClick={swap} className="justify-self-start" />
          <Field label="Height">
            {({ id }) => <NumberInput id={id} min={0} step="any" value={s.height} onChange={setHeight} className="text-[16px]" />}
          </Field>
          <IconButton
            icon={s.locked ? Lock : LockOpen}
            // A toggle keeps one name; aria-pressed tells whether it is on (the text below explains the effect).
            label="Lock aspect ratio"
            variant="secondary"
            active={s.locked}
            aria-pressed={s.locked}
            onClick={() => update({ locked: !s.locked })}
            className="justify-self-start"
          />
          <Field label="Aspect ratio" error={s.ratioText.trim() && !ratio ? 'Use a form like 16:9, 4/3 or 2.39.' : null}>
            {({ id, describedBy, invalid }) => (
              <Input
                id={id}
                aria-describedby={describedBy}
                aria-invalid={invalid || undefined}
                mono
                value={s.ratioText}
                placeholder="16:9"
                onChange={(e) => setRatio(e.target.value)}
                className="text-[16px]"
              />
            )}
          </Field>
        </div>
        <p className="text-[12.5px] text-fg-muted">
          {s.locked
            ? 'Ratio locked: change the width or height and the other side is solved for you.'
            : 'Ratio unlocked: the ratio follows the width and height you type.'}
          {mismatch && dimRatio && (
            <span className="text-warning"> The dimensions are {ratioLabel(dimRatio)}, not {s.ratioText.trim()}.</span>
          )}
        </p>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Common ratios">
          {RATIO_PRESETS.map((p) => (
            <Button
              key={p.label}
              size="sm"
              variant={ratio && Math.abs(ratioDecimal(ratio) - ratioDecimal(p.ratio)) < 1e-9 ? 'primary' : 'secondary'}
              title={p.use}
              onClick={() => setRatio(p.label)}
            >
              {p.label}
            </Button>
          ))}
        </div>
      </Panel>

      <div className="grid min-w-0 grid-cols-1 items-start gap-4 lg:grid-cols-2">
        <Panel title="Result">
          {shown ? (
            <div className="flex flex-col gap-4">
              <div className="grid grid-cols-2 gap-2">
                <Stat label="Simplified ratio" value={ratioLabel(shown)} />
                <Stat label="Decimal (width ÷ height)" value={fmt(ratioDecimal(shown), 4)} />
                <Stat label="Dimensions" value={dims ? `${fmt(dims.w, 2)} × ${fmt(dims.h, 2)}` : '—'} />
                <Stat label="Orientation" value={ratioDecimal(shown) > 1 ? 'Landscape' : ratioDecimal(shown) < 1 ? 'Portrait' : 'Square'} />
              </div>
              {near && !near.exact && (
                <p className="text-[13px] text-fg-secondary">
                  Close to <strong className="font-semibold text-fg">{near.preset.label}</strong> ({near.preset.use}).
                </p>
              )}
              {near?.exact && <p className="text-[13px] text-fg-secondary">{near.preset.use}.</p>}
              <div className="flex min-h-[216px] items-center justify-center rounded-lg border border-line bg-surface-sunken lk-grid-bg p-2">
                <div
                  className="flex max-w-full items-center justify-center rounded-md border-2 border-accent bg-accent-soft font-mono text-[13px] font-semibold text-accent-text"
                  style={{ width: pw, height: ph }}
                >
                  {ratioLabel(shown)}
                </div>
              </div>
            </div>
          ) : (
            <p className="text-[13px] text-fg-muted">Enter a width and height, or a ratio such as 16:9.</p>
          )}
        </Panel>

        <div className="flex min-w-0 flex-col gap-4">
          {css && shown && (
            <Panel title="CSS">
              <div className="flex flex-col gap-3">
                {[
                  { label: 'Modern: aspect-ratio', code: css.modern },
                  { label: `Legacy: padding-top ${paddingPercent(shown)}`, code: css.legacy },
                ].map((b) => (
                  <div key={b.label}>
                    <div className="mb-1.5 flex items-center justify-between gap-2">
                      <span className="text-[12.5px] font-medium text-fg-secondary">{b.label}</span>
                      <CopyButton value={b.code} label="Copy" />
                    </div>
                    <pre className="overflow-x-auto rounded-lg border border-line bg-surface-sunken px-3 py-2 font-mono text-[12.5px] text-fg">{b.code}</pre>
                  </div>
                ))}
              </div>
            </Panel>
          )}
          {ratio && (
            <Panel title={`Common sizes for ${ratioLabel(ratio)}`} description="Whole-pixel sizes; click one to use it.">
              {sizes.length ? (
                <div className="flex flex-wrap gap-1.5">
                  {sizes.map((z) => {
                    const current = s.width === z.w && s.height === z.h;
                    return (
                      <button
                        key={z.w}
                        type="button"
                        onClick={() => update({ width: z.w, height: z.h })}
                        className={cn(
                          'rounded-md border px-2 py-1 font-mono text-[12.5px] tabular-nums transition-colors',
                          current ? 'border-accent-line bg-accent-soft text-accent-text' : 'border-line bg-surface-sunken text-fg hover:bg-surface-hover',
                        )}
                      >
                        {z.w} × {z.h}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <p className="text-[13px] text-fg-muted">No common widths give a whole-pixel height for this ratio.</p>
              )}
            </Panel>
          )}
        </div>
      </div>
    </ToolStack>
  );
}
