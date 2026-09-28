import { ToolStack } from '@/components/tool/EditorPanel';
import { Panel } from '@/components/ui/Panel';
import { Segmented } from '@/components/ui/Segmented';
import { Label, Switch } from '@/components/ui/Field';
import { useToolState } from '@/lib/hooks';
import { CssOutput, SliderRow } from './design/Controls';
import { CORNER_KEYS, RADIUS_PRESETS, borderRadiusLonghand, borderRadiusValue, type CornerKey, type RadiusConfig } from './lib/radius';

const TOOL = 'border-radius-generator';
const NAMES: Record<CornerKey, string> = { topLeft: 'Top left', topRight: 'Top right', bottomRight: 'Bottom right', bottomLeft: 'Bottom left' };

export default function BorderRadiusGenerator() {
  const [cfg, setCfg] = useToolState<RadiusConfig>(TOOL, 'config', RADIUS_PRESETS[0].config);
  const [linked, setLinked] = useToolState(TOOL, 'linked', true);
  const [size, setSize] = useToolState(TOOL, 'size', { w: 240, h: 180 });
  const max = cfg.unit === '%' ? 100 : 200;
  const value = borderRadiusValue(cfg);

  const setCorner = (key: CornerKey, axis: 'x' | 'y', v: number) =>
    setCfg((prev) => {
      if (linked) {
        const next = { ...prev };
        for (const k of CORNER_KEYS) next[k] = { ...prev[k], [axis]: v, ...(prev.elliptical ? {} : { y: v }) };
        return next;
      }
      return { ...prev, [key]: { ...prev[key], [axis]: v, ...(prev.elliptical || axis === 'y' ? {} : { y: v }) } };
    });

  const corners: CornerKey[] = linked ? ['topLeft'] : [...CORNER_KEYS];

  return (
    <ToolStack>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_400px]">
        <div className="flex min-w-0 flex-col gap-4">
          <div className="lk-grid-bg flex h-80 items-center justify-center overflow-hidden rounded-xl border border-line bg-surface-sunken p-6 sm:h-96">
            <div
              className="max-h-full max-w-full bg-accent shadow-raised"
              style={{ width: size.w, height: size.h, borderRadius: value }}
              role="img"
              aria-label={`Shape with border-radius ${value}`}
            />
          </div>
          <Panel title="Preview size" bodyClassName="grid gap-4 sm:grid-cols-2">
            <SliderRow label="Width" value={size.w} min={40} max={400} unit="px" onChange={(w) => setSize((s) => ({ ...s, w }))} />
            <SliderRow label="Height" value={size.h} min={40} max={320} unit="px" onChange={(h) => setSize((s) => ({ ...s, h }))} />
          </Panel>
        </div>
        <div className="flex min-w-0 flex-col gap-4">
          <Panel title="Radius" bodyClassName="flex flex-col gap-4">
            <div className="flex flex-wrap items-end gap-4">
              <div>
                <Label>Unit</Label>
                <Segmented label="Unit" value={cfg.unit} onChange={(unit) => setCfg((c) => ({ ...c, unit }))} options={[{ value: 'px', label: 'px' }, { value: '%', label: '%' }]} />
              </div>
              <Switch label="Same for all corners" checked={linked} onChange={setLinked} className="h-8" />
              <Switch label="Elliptical corners" checked={cfg.elliptical} onChange={(elliptical) => setCfg((c) => ({ ...c, elliptical }))} className="h-8" />
            </div>
            {corners.map((k) => (
              <fieldset key={k} className="flex flex-col gap-3 rounded-lg border border-line p-3">
                <legend className="px-1 text-[12.5px] font-semibold text-fg">{linked ? 'All corners' : NAMES[k]}</legend>
                <SliderRow label={cfg.elliptical ? 'Horizontal' : 'Radius'} value={cfg[k].x} min={0} max={max} unit={cfg.unit} onChange={(v) => setCorner(k, 'x', v)} />
                {cfg.elliptical && <SliderRow label="Vertical" value={cfg[k].y} min={0} max={max} unit={cfg.unit} onChange={(v) => setCorner(k, 'y', v)} />}
              </fieldset>
            ))}
          </Panel>
          <Panel title="Presets">
            <div className="grid grid-cols-4 gap-2">
              {RADIUS_PRESETS.map((p) => (
                <button
                  key={p.name}
                  type="button"
                  onClick={() => {
                    setCfg(p.config);
                    const same = CORNER_KEYS.every((k) => p.config[k].x === p.config.topLeft.x && p.config[k].y === p.config.topLeft.y);
                    setLinked(same);
                  }}
                  className="flex flex-col items-center gap-1.5 rounded-lg border border-line bg-surface-sunken p-2 text-[11.5px] text-fg-secondary hover:border-line-strong hover:text-fg"
                >
                  <span className="h-8 w-10 bg-accent" style={{ borderRadius: borderRadiusValue(p.config) }} />
                  {p.name}
                </button>
              ))}
            </div>
          </Panel>
        </div>
      </div>
      <CssOutput code={`border-radius: ${value};\n\n/* Longhand */\n${borderRadiusLonghand(cfg)}`} />
    </ToolStack>
  );
}
