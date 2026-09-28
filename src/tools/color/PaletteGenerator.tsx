import { useMemo } from 'react';
import type { Color } from 'culori';
import { EditorPanel, ToolStack } from '@/components/tool/EditorPanel';
import { Field, Input, Label, Select } from '@/components/ui/Field';
import { Panel } from '@/components/ui/Panel';
import { Segmented } from '@/components/ui/Segmented';
import { DownloadButton } from '@/components/ui/Actions';
import { useToolState } from '@/lib/hooks';
import { errorMessage } from '@/lib/utils';
import { formatColor, parseAny } from './lib/color';
import { HARMONIES, SCALE_STEPS, exportHarmony, exportScale, harmony, slugify, tintScale, type ExportFormat, type HarmonyId, type ScaleStep } from './lib/palette';
import { SwatchButton } from './components/Swatch';

const TOOL = 'palette-generator';

const EXPORTS: Array<{ value: ExportFormat; label: string; language: 'css' | 'javascript' | 'json' | 'xml'; ext: string; mime: string }> = [
  { value: 'css', label: 'CSS (hex)', language: 'css', ext: 'css', mime: 'text/css' },
  { value: 'css-oklch', label: 'CSS (oklch)', language: 'css', ext: 'css', mime: 'text/css' },
  { value: 'tailwind4', label: 'Tailwind v4', language: 'css', ext: 'css', mime: 'text/css' },
  { value: 'tailwind3', label: 'Tailwind v3', language: 'javascript', ext: 'js', mime: 'text/javascript' },
  { value: 'json', label: 'JSON', language: 'json', ext: 'json', mime: 'application/json' },
  { value: 'svg', label: 'SVG', language: 'xml', ext: 'svg', mime: 'image/svg+xml' },
];

const PRESETS = ['#2563eb', '#e11d48', '#059669', '#d97706', '#7c3aed', '#0891b2', '#db2777', '#475569'];

export default function PaletteGenerator() {
  const [baseText, setBaseText] = useToolState(TOOL, 'base', '#2563eb');
  const [name, setName] = useToolState(TOOL, 'name', 'primary');
  const [harmonyId, setHarmonyId] = useToolState<HarmonyId>(TOOL, 'harmony', 'complementary');
  const [anchor, setAnchor] = useToolState<'auto' | '500'>(TOOL, 'anchor', 'auto');
  const [format, setFormat] = useToolState<ExportFormat>(TOOL, 'format', 'css');

  const parsed = useMemo((): { color: Color | null; error: string | null } => {
    try {
      return { color: parseAny(baseText), error: null };
    } catch (error) {
      return { color: null, error: errorMessage(error) };
    }
  }, [baseText]);
  const base = parsed.color;

  const swatches = useMemo(() => (base ? harmony(base, harmonyId) : []), [base, harmonyId]);
  const scale = useMemo(() => (base ? tintScale(base, anchor === 'auto' ? 'auto' : (500 as ScaleStep)) : []), [base, anchor]);
  const exportInfo = EXPORTS.find((e) => e.value === format) ?? EXPORTS[0];
  const output = useMemo(() => (scale.length ? exportScale(name, scale, format) : ''), [name, scale, format]);
  const harmonyInfo = HARMONIES.find((h) => h.id === harmonyId)!;

  return (
    <ToolStack>
      <Panel bodyClassName="flex flex-col gap-3">
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="min-w-0">
            <Label htmlFor="pg-base">Base color</Label>
            <div className="flex items-center gap-2">
              <input
                type="color"
                aria-label="Pick base color"
                value={base ? formatColor(base, 'hex') : '#000000'}
                onChange={(e) => setBaseText(e.target.value)}
                className="h-9 w-11 shrink-0 cursor-pointer rounded-lg border border-line-strong bg-surface-sunken p-1"
              />
              <Input
                id="pg-base"
                mono
                value={baseText}
                onChange={(e) => setBaseText(e.target.value)}
                spellCheck={false}
                aria-invalid={Boolean(parsed.error) || undefined}
              />
            </div>
            {parsed.error && <p className="mt-1 text-[12px] text-danger">{parsed.error}</p>}
          </div>
          <Field label="Palette name" hint="Used for variable names in the export.">
            {({ id, describedBy }) => <Input id={id} aria-describedby={describedBy} value={name} onChange={(e) => setName(e.target.value)} />}
          </Field>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {PRESETS.map((p) => (
            <button
              key={p}
              type="button"
              aria-label={`Use ${p}`}
              title={p}
              onClick={() => setBaseText(p)}
              className="size-7 rounded-md ring-1 ring-line-strong"
              style={{ background: p }}
            />
          ))}
        </div>
      </Panel>

      {base && (
        <>
          <Panel
            title="Harmony"
            description={`${harmonyInfo.description} Hues are rotated in OKLCH so lightness and chroma stay perceptually even.`}
            actions={
              <Select aria-label="Harmony" value={harmonyId} onChange={(e) => setHarmonyId(e.target.value as HarmonyId)} className="w-auto min-w-52">
                {HARMONIES.map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.label}
                  </option>
                ))}
              </Select>
            }
            bodyClassName="flex flex-col gap-3"
          >
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-5">
              {swatches.map((s, i) => (
                <SwatchButton
                  key={`${s.hex}-${i}`}
                  hex={s.hex}
                  className="min-h-28"
                  sublabel={`oklch ${(s.l * 100).toFixed(0)}% ${s.c.toFixed(3)} ${s.h.toFixed(0)}°`}
                  marker={harmonyId === 'monochromatic' ? s.hex === formatColor(base, 'hex') : i === (harmonyId === 'analogous' ? 1 : 0)}
                />
              ))}
            </div>
            <div className="flex flex-wrap gap-2">
              {(['css', 'json', 'svg'] as const).map((f) => (
                <DownloadHarmony key={f} format={f} name={name} swatches={swatches} />
              ))}
            </div>
          </Panel>

          <Panel
            title="Tints and shades"
            description="An 11-step scale in OKLCH with a design-system style lightness curve, gamut-mapped to sRGB."
            actions={
              <Segmented
                label="Base position"
                size="sm"
                value={anchor}
                onChange={setAnchor}
                options={[
                  { value: 'auto', label: 'Base at nearest step', title: 'Place the base color at the step with the closest lightness' },
                  { value: '500', label: 'Base at 500' },
                ]}
              />
            }
          >
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-6 xl:grid-cols-11">
              {scale.map((s) => (
                <SwatchButton key={s.step} hex={s.hex} label={String(s.step)} marker={s.isBase} className="min-h-24" />
              ))}
            </div>
          </Panel>

          <div>
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <span className="text-[13px] font-medium text-fg-secondary">Export scale as</span>
              <Segmented label="Export format" size="sm" value={format} onChange={setFormat} options={EXPORTS.map((e) => ({ value: e.value, label: e.label }))} />
            </div>
            <EditorPanel
              title={`${exportInfo.label} · ${SCALE_STEPS.length} colors`}
              value={output}
              language={exportInfo.language}
              downloadName={`${slugify(name)}.${exportInfo.ext}`}
              downloadType={exportInfo.mime}
              height="320px"
            />
          </div>
        </>
      )}
    </ToolStack>
  );
}

function DownloadHarmony({ format, name, swatches }: { format: 'css' | 'json' | 'svg'; name: string; swatches: ReturnType<typeof harmony> }) {
  const mime = { css: 'text/css', json: 'application/json', svg: 'image/svg+xml' }[format];
  return (
    <DownloadButton
      data={() => exportHarmony(name, swatches, format)}
      filename={`${slugify(name)}-harmony.${format}`}
      type={mime}
      label={`Download ${format.toUpperCase()}`}
    />
  );
}
