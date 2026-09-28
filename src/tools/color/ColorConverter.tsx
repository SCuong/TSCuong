import { useMemo, useState } from 'react';
import { Pipette } from 'lucide-react';
import type { Color } from 'culori';
import { ToolStack } from '@/components/tool/EditorPanel';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Badge, Panel } from '@/components/ui/Panel';
import { CopyButton } from '@/components/ui/Actions';
import { toast } from '@/components/ui/Toast';
import { useToolState } from '@/lib/hooks';
import { errorMessage } from '@/lib/utils';
import { ColorField } from './components/ColorField';
import {
  FORMATS,
  alphaValue,
  cssColor,
  formatColor,
  inSrgb,
  nearestNamed,
  parseAny,
  readableTextOn,
  withAlpha,
  type FormatId,
} from './lib/color';

const TOOL = 'color-converter';
const PRESETS = ['#2563eb', '#e11d48', '#10b981', '#f59e0b', '#7c3aed', 'oklch(70% 0.25 145)', 'rebeccapurple', 'rgb(0 0 0 / 0.5)'];

interface EyeDropperCtor {
  new (): { open: () => Promise<{ sRGBHex: string }> };
}

function eyeDropper(): EyeDropperCtor | null {
  return typeof window !== 'undefined' && 'EyeDropper' in window ? (window as unknown as { EyeDropper: EyeDropperCtor }).EyeDropper : null;
}

function safeParse(text: string): Color | null {
  try {
    return parseAny(text);
  } catch {
    return null;
  }
}

const validate = (text: string): string | null => {
  try {
    parseAny(text);
    return null;
  } catch (error) {
    return errorMessage(error);
  }
};

export default function ColorConverter() {
  const [stored, setStored] = useToolState(TOOL, 'color', '#2563eb');
  const color = useMemo(() => safeParse(stored) ?? parseAny('#2563eb'), [stored]);
  const [picking, setPicking] = useState(false);

  const setColor = (c: Color) => setStored(formatColor(c, 'oklch'));
  const commit = (text: string) => {
    const c = safeParse(text);
    if (c) setStored(text.trim());
  };

  const values = useMemo(() => Object.fromEntries(FORMATS.map((f) => [f.id, formatColor(color, f.id)])) as Record<FormatId, string>, [color]);
  const named = useMemo(() => nearestNamed(color), [color]);
  const alpha = alphaValue(color);
  const inGamut = inSrgb(color);
  const preview = cssColor(color);
  const textColor = readableTextOn(color);
  const Dropper = eyeDropper();

  async function pick() {
    if (!Dropper) return;
    setPicking(true);
    try {
      const result = await new Dropper().open();
      const c = parseAny(result.sRGBHex);
      setColor(alpha < 1 ? withAlpha(c, alpha) : c);
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) toast(errorMessage(error, 'The eyedropper could not pick a color.'), 'error');
    } finally {
      setPicking(false);
    }
  }

  return (
    <ToolStack>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <Panel bodyClassName="flex flex-col gap-4">
          <div className="lk-checker relative h-44 overflow-hidden rounded-xl border border-line sm:h-52">
            <div className="absolute inset-0 flex flex-col justify-end p-4" style={{ background: preview, color: textColor }}>
              <span className="font-mono text-[20px] font-semibold tracking-tight">{values.hex}</span>
              <span className="text-[13px] opacity-80">
                {named.exact ? named.name : `≈ ${named.name}`}
                {alpha < 1 && ` · ${Math.round(alpha * 100)}% opacity`}
              </span>
            </div>
          </div>
          <ColorField label="Any CSS color" value={stored} onCommit={commit} validate={validate} hint="hex, rgb(), hsl(), oklch(), names…" />
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex items-center gap-2 text-[13px] text-fg-secondary">
              <input
                type="color"
                value={values.hex}
                onChange={(e) => {
                  const c = parseAny(e.target.value);
                  setColor(alpha < 1 ? withAlpha(c, alpha) : c);
                }}
                className="h-9 w-12 cursor-pointer rounded-lg border border-line-strong bg-surface-sunken p-1"
                aria-label="Pick a color"
              />
              Picker
            </label>
            {Dropper ? (
              <Button size="md" icon={Pipette} onClick={pick} loading={picking}>
                Pick from screen
              </Button>
            ) : (
              <span className="text-[12.5px] text-fg-muted">Screen eyedropper isn’t supported in this browser.</span>
            )}
          </div>
          <div>
            <div className="mb-1 flex justify-between text-[12.5px]">
              <label htmlFor="cc-alpha" className="font-medium text-fg-secondary">
                Alpha
              </label>
              <span className="font-mono text-fg-muted tabular-nums">{Math.round(alpha * 100)}%</span>
            </div>
            <input
              id="cc-alpha"
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={alpha}
              onChange={(e) => setColor(withAlpha(color, Number(e.target.value)))}
              className="lk-range"
            />
          </div>
          <div className="flex flex-wrap gap-1.5">
            {PRESETS.map((p) => (
              <button
                key={p}
                type="button"
                title={p}
                aria-label={`Use ${p}`}
                onClick={() => setStored(p)}
                className="lk-checker size-7 overflow-hidden rounded-md border border-line-strong"
              >
                <span className="block size-full" style={{ background: cssColor(parseAny(p)) }} />
              </button>
            ))}
          </div>
        </Panel>

        <Panel
          title="Formats"
          actions={
            <Badge tone={named.exact ? 'accent' : 'neutral'}>
              {named.exact ? `Named: ${named.name}` : `Closest name: ${named.name} (ΔE ${(named.distance * 100).toFixed(1)})`}
            </Badge>
          }
          bodyClassName="flex flex-col gap-3"
        >
          {!inGamut && (
            <Alert tone="warning" title="Outside the sRGB gamut">
              This color can’t be shown exactly on standard screens. HEX, RGB, HSL, HWB and CMYK show the closest sRGB color
              (mapped in OKLCH, keeping hue and lightness); LAB, LCH, OKLAB and OKLCH keep the original values.
            </Alert>
          )}
          <div className="grid gap-x-4 gap-y-3 sm:grid-cols-2">
            {FORMATS.map((f) => (
              <ColorField key={f.id} label={f.label} hint={f.hint} value={values[f.id]} onCommit={commit} validate={validate} />
            ))}
            <div className="min-w-0">
              <div className="mb-1 text-[12.5px] font-medium text-fg-secondary">CSS name</div>
              <div className="flex items-center gap-1">
                <div className="lk-field truncate font-mono text-[13px]">{named.exact ? named.name : `none (closest: ${named.name})`}</div>
                <CopyButton value={named.name} iconOnly label="Copy color name" />
              </div>
            </div>
          </div>
        </Panel>
      </div>
    </ToolStack>
  );
}
