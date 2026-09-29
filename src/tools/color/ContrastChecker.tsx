import { useMemo } from 'react';
import { ArrowUpDown, Check, WandSparkles, X } from 'lucide-react';
import type { Color } from 'culori';
import { ToolStack } from '@/components/tool/EditorPanel';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Label } from '@/components/ui/Field';
import { Panel } from '@/components/ui/Panel';
import { Segmented } from '@/components/ui/Segmented';
import { useToolState } from '@/lib/hooks';
import { cn, errorMessage } from '@/lib/utils';
import { alphaValue, cssColor, formatColor, parseAny } from './lib/color';
import { contrastRatio, evaluate, formatRatio, suggestPassing } from './lib/contrast';

const TOOL = 'contrast-checker';

function tryParse(text: string): { color: Color | null; error: string | null } {
  try {
    return { color: parseAny(text), error: null };
  } catch (error) {
    return { color: null, error: errorMessage(error) };
  }
}

function ColorInput({ label, value, onChange, error }: { label: string; value: string; onChange: (v: string) => void; error: string | null }) {
  const parsed = useMemo(() => tryParse(value).color, [value]);
  const id = `cc-${label.toLowerCase().replace(/\s+/g, '-')}`;
  return (
    <div className="min-w-0 flex-1">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex items-center gap-2">
        <input
          type="color"
          aria-label={`${label} picker`}
          value={parsed ? formatColor(parsed, 'hex') : '#000000'}
          onChange={(e) => onChange(e.target.value)}
          className="h-9 w-11 shrink-0 cursor-pointer rounded-lg border border-line-strong bg-surface-sunken p-1"
        />
        <input
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          spellCheck={false}
          autoComplete="off"
          aria-invalid={Boolean(error) || undefined}
          className="lk-field font-mono text-[13px]"
        />
      </div>
      {error && <p className="mt-1 text-[12px] text-danger">{error}</p>}
    </div>
  );
}

export default function ContrastChecker() {
  const [fgText, setFg] = useToolState(TOOL, 'fg', '#94a3b8');
  const [bgText, setBg] = useToolState(TOOL, 'bg', '#ffffff');
  const [target, setTarget] = useToolState<'4.5' | '7' | '3'>(TOOL, 'target', '4.5');
  const [adjust, setAdjust] = useToolState<'fg' | 'bg'>(TOOL, 'adjust', 'fg');

  const fg = useMemo(() => tryParse(fgText), [fgText]);
  const bg = useMemo(() => tryParse(bgText), [bgText]);
  const ready = fg.color && bg.color;
  const ratio = ready ? contrastRatio(fg.color!, bg.color!) : null;
  const results = ratio !== null ? evaluate(ratio) : [];
  const suggestion = useMemo(() => {
    if (!fg.color || !bg.color || ratio === null) return undefined;
    if (ratio >= Number(target)) return undefined;
    return adjust === 'fg' ? suggestPassing(fg.color, bg.color, Number(target), true) : suggestPassing(bg.color, fg.color, Number(target), false);
  }, [fg.color, bg.color, ratio, target, adjust]);

  const fgCss = fg.color ? cssColor(fg.color) : 'transparent';
  const bgCss = bg.color ? cssColor(bg.color) : 'transparent';
  const translucent = (fg.color && alphaValue(fg.color) < 1) || (bg.color && alphaValue(bg.color) < 1);

  return (
    <ToolStack>
      <Panel bodyClassName="flex flex-col gap-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
          <ColorInput label="Text color" value={fgText} onChange={setFg} error={fg.error} />
          <Button
            variant="ghost"
            icon={ArrowUpDown}
            className="self-center sm:mt-6"
            onClick={() => {
              setFg(bgText);
              setBg(fgText);
            }}
          >
            Swap
          </Button>
          <ColorInput label="Background" value={bgText} onChange={setBg} error={bg.error} />
        </div>
        {translucent && (
          <p className="text-[12.5px] text-fg-muted">
            Transparent colors are blended first: the text over the background, and a transparent background over white.
          </p>
        )}
      </Panel>

      {ready && ratio !== null && (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
          <Panel bodyClassName="p-0">
            <div className="lk-checker overflow-hidden rounded-xl">
              {/* Rendered in the user's own colors on purpose, even when they fail WCAG (excluded from axe). */}
              <div data-contrast-sample className="flex flex-col gap-4 p-6 sm:p-8" style={{ background: bgCss, color: fgCss }}>
                <p className="text-[32px] leading-tight font-bold tracking-tight">Large text, 24px bold</p>
                <p className="text-[16px] leading-relaxed">
                  Normal body text at 16px. The quick brown fox jumps over the lazy dog, and readable contrast helps everyone —
                  in sunlight, on dim screens, and with low vision.
                </p>
                <p className="text-[13px]">Small print at 13px, like captions and helper text.</p>
                <div className="flex flex-wrap items-center gap-3">
                  <span className="rounded-lg border-2 px-4 py-2 text-[14px] font-semibold" style={{ borderColor: fgCss }}>
                    Outlined button
                  </span>
                  <span className="inline-flex h-10 w-48 items-center rounded-lg border-2 px-3 text-[14px]" style={{ borderColor: fgCss }}>
                    Input field
                  </span>
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke={fgCss} strokeWidth="2.25" aria-hidden>
                    <circle cx="12" cy="12" r="9" />
                    <path d="m8 12 3 3 5-6" />
                  </svg>
                </div>
              </div>
            </div>
          </Panel>

          <Panel bodyClassName="flex flex-col gap-4">
            <div>
              <div className="text-[12.5px] text-fg-muted">Contrast ratio</div>
              <div className="font-mono text-[40px] leading-none font-semibold tracking-tight text-fg tabular-nums">{formatRatio(ratio)}</div>
            </div>
            <ul className="divide-y divide-line rounded-lg border border-line">
              {results.map((r) => (
                <li key={r.id} className="flex items-center gap-3 px-3 py-2">
                  <span
                    className={cn(
                      'inline-flex size-6 shrink-0 items-center justify-center rounded-full',
                      r.pass ? 'bg-success-soft text-success' : 'bg-danger-soft text-danger',
                    )}
                  >
                    {r.pass ? <Check size={14} aria-hidden /> : <X size={14} aria-hidden />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-medium text-fg">
                      {r.level} · {r.label} <span className="font-normal text-fg-muted">≥ {r.min}:1</span>
                    </div>
                    <div className="truncate text-[12px] text-fg-muted">{r.detail}</div>
                  </div>
                  <span className={cn('text-[12.5px] font-semibold', r.pass ? 'text-success' : 'text-danger')}>{r.pass ? 'Pass' : 'Fail'}</span>
                </li>
              ))}
            </ul>
          </Panel>
        </div>
      )}

      {ready && (
        <Panel title="Suggest the nearest passing color" description="Adjusts OKLCH lightness only, keeping hue and as much chroma as sRGB allows.">
          <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
            <div>
              <Label>Target</Label>
              <Segmented
                label="Target ratio"
                value={target}
                onChange={setTarget}
                options={[
                  { value: '3', label: '3:1 large / UI' },
                  { value: '4.5', label: '4.5:1 AA' },
                  { value: '7', label: '7:1 AAA' },
                ]}
              />
            </div>
            <div>
              <Label>Change</Label>
              <Segmented
                label="Color to change"
                value={adjust}
                onChange={setAdjust}
                options={[
                  { value: 'fg', label: 'Text' },
                  { value: 'bg', label: 'Background' },
                ]}
              />
            </div>
          </div>
          <div className="mt-4">
            {suggestion === undefined && ratio !== null && <Alert tone="success">These colors already meet {target}:1.</Alert>}
            {suggestion === null && (
              <Alert tone="warning">
                No {adjust === 'fg' ? 'text' : 'background'} color with this hue can reach {target}:1 against the other color. Try
                changing the other color instead.
              </Alert>
            )}
            {suggestion && (
              <div className="flex flex-wrap items-center gap-3 rounded-lg border border-line bg-surface-sunken p-3">
                <div className="lk-checker size-10 shrink-0 overflow-hidden rounded-lg border border-line-strong">
                  <div className="size-full" style={{ background: suggestion.color }} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="font-mono text-[14px] font-semibold text-fg">{suggestion.color}</div>
                  <div className="text-[12.5px] text-fg-muted">
                    {formatRatio(suggestion.ratio)} · {suggestion.deltaL > 0 ? 'lighter' : 'darker'} by {(Math.abs(suggestion.deltaL) * 100).toFixed(1)}%
                    lightness
                  </div>
                </div>
                <div
                  className="rounded-md px-3 py-1.5 text-[13px] font-medium"
                  style={
                    adjust === 'fg'
                      ? { background: bgCss, color: suggestion.color }
                      : { background: suggestion.color, color: fgCss }
                  }
                >
                  Preview Aa
                </div>
                <Button
                  variant="primary"
                  size="sm"
                  icon={WandSparkles}
                  onClick={() => (adjust === 'fg' ? setFg(suggestion.color) : setBg(suggestion.color))}
                >
                  Apply
                </Button>
              </div>
            )}
          </div>
        </Panel>
      )}
    </ToolStack>
  );
}
