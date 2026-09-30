import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { ToolStack } from '@/components/tool/EditorPanel';
import { Panel } from '@/components/ui/Panel';
import { Segmented } from '@/components/ui/Segmented';
import { Label, Select, Switch } from '@/components/ui/Field';
import { Button } from '@/components/ui/Button';
import { useToolState } from '@/lib/hooks';
import { cn } from '@/lib/utils';
import { ColorInput, CssOutput, SliderRow } from './design/Controls';
import {
  GRADIENT_PRESETS,
  colorAt,
  gradientCss,
  gradientDeclaration,
  sortStops,
  stopColor,
  stopId,
  type Gradient,
  type GradientStop,
  type GradientType,
  type RadialShape,
  type RadialSize,
} from './lib/gradient';

const TOOL = 'css-gradient-generator';
const clamp = (v: number) => Math.min(100, Math.max(0, Math.round(v * 10) / 10));

export default function GradientGenerator() {
  const [g, setG] = useToolState<Gradient>(TOOL, 'gradient', GRADIENT_PRESETS[1].gradient);
  const [selectedId, setSelectedId] = useState<string>(g.stops[0]?.id ?? '');
  const bar = useRef<HTMLDivElement>(null);
  const dragging = useRef<string | null>(null);

  const selected = g.stops.find((s) => s.id === selectedId) ?? g.stops[0];
  const set = <K extends keyof Gradient>(k: K, v: Gradient[K]) => setG((prev) => ({ ...prev, [k]: v }));
  const updateStop = (id: string, patch: Partial<GradientStop>) =>
    setG((prev) => ({ ...prev, stops: prev.stops.map((s) => (s.id === id ? { ...s, ...patch } : s)) }));
  const removeStop = (id: string) => {
    if (g.stops.length <= 2) return;
    const rest = g.stops.filter((s) => s.id !== id);
    setG((prev) => ({ ...prev, stops: rest }));
    setSelectedId(sortStops(rest)[0].id);
  };

  const positionFromEvent = (clientX: number) => {
    const rect = bar.current!.getBoundingClientRect();
    return clamp(((clientX - rect.left) / rect.width) * 100);
  };

  const insertStop = (position: number) => {
    const { color, alpha } = colorAt(g.stops, position);
    const stop = { id: stopId(), color, alpha, position };
    setG((prev) => ({ ...prev, stops: [...prev.stops, stop] }));
    setSelectedId(stop.id);
  };

  const onBarPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.target !== bar.current) return;
    insertStop(positionFromEvent(e.clientX));
  };

  /** Keyboard-friendly alternative to clicking the bar: a new stop in the middle of the widest gap. */
  const addStop = () => {
    const positions = [0, ...sortStops(g.stops).map((s) => s.position), 100];
    let at = 50;
    let widest = -1;
    for (let i = 0; i < positions.length - 1; i++) {
      const gap = positions[i + 1] - positions[i];
      if (gap > widest) {
        widest = gap;
        at = positions[i] + gap / 2;
      }
    }
    insertStop(clamp(at));
  };

  const onHandleKey = (e: KeyboardEvent, stop: GradientStop) => {
    const step = e.shiftKey ? 10 : 1;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') updateStop(stop.id, { position: clamp(stop.position - step) });
    else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') updateStop(stop.id, { position: clamp(stop.position + step) });
    else if (e.key === 'Home') updateStop(stop.id, { position: 0 });
    else if (e.key === 'End') updateStop(stop.id, { position: 100 });
    else if (e.key === 'Delete' || e.key === 'Backspace') removeStop(stop.id);
    else return;
    e.preventDefault();
  };

  const css = gradientCss(g);
  const barCss = `linear-gradient(90deg, ${sortStops(g.stops)
    .map((s) => `${stopColor(s)} ${s.position}%`)
    .join(', ')})`;

  return (
    <ToolStack>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="flex min-w-0 flex-col gap-4">
          <div className="lk-checker h-64 overflow-hidden rounded-xl border border-line sm:h-80" role="img" aria-label="Gradient preview">
            <div className="size-full" style={{ backgroundImage: css }} />
          </div>
          <Panel
            title="Color stops"
            description="Click the bar or use Add stop to add a stop. Drag handles, or focus one and use the arrow keys (Shift for 10%). Delete removes it."
            actions={
              <Button size="sm" icon={Plus} onClick={addStop}>
                Add stop
              </Button>
            }
          >
            <div className="px-2 pt-2 pb-7">
              <div
                ref={bar}
                onPointerDown={onBarPointerDown}
                className="lk-checker relative h-9 cursor-copy rounded-lg ring-1 ring-line-strong"
              >
                <div className="pointer-events-none absolute inset-0 rounded-lg" style={{ backgroundImage: barCss }} />
                {g.stops.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    role="slider"
                    aria-label={`Stop ${stopColor(s)}`}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={s.position}
                    aria-valuetext={`${s.position}%`}
                    onFocus={() => setSelectedId(s.id)}
                    onKeyDown={(e) => onHandleKey(e, s)}
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      e.currentTarget.setPointerCapture(e.pointerId);
                      dragging.current = s.id;
                      setSelectedId(s.id);
                    }}
                    onPointerMove={(e) => {
                      if (dragging.current === s.id) updateStop(s.id, { position: positionFromEvent(e.clientX) });
                    }}
                    onPointerUp={() => (dragging.current = null)}
                    className={cn(
                      'absolute top-full z-10 -mt-1.5 flex size-6 -translate-x-1/2 cursor-grab touch-none items-center justify-center rounded-full border-2 bg-surface-raised shadow-raised active:cursor-grabbing',
                      s.id === selected?.id ? 'border-accent ring-2 ring-accent-soft' : 'border-line-strong',
                    )}
                    style={{ left: `${s.position}%` }}
                  >
                    <span className="size-3.5 rounded-full ring-1 ring-black/10" style={{ background: stopColor(s) }} />
                  </button>
                ))}
              </div>
            </div>
            {selected && (
              <div className="grid gap-3 border-t border-line pt-3 sm:grid-cols-2">
                <ColorInput label="Color" value={selected.color} onChange={(color) => updateStop(selected.id, { color })} />
                <SliderRow label="Opacity" value={Math.round(selected.alpha * 100)} min={0} max={100} unit="%" onChange={(v) => updateStop(selected.id, { alpha: v / 100 })} />
                <SliderRow label="Position" value={selected.position} min={0} max={100} step={0.5} unit="%" onChange={(v) => updateStop(selected.id, { position: clamp(v) })} />
                <div className="flex items-end">
                  <Button variant="ghost" size="sm" icon={Trash2} disabled={g.stops.length <= 2} onClick={() => removeStop(selected.id)}>
                    Remove stop
                  </Button>
                </div>
              </div>
            )}
          </Panel>
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          <Panel title="Settings" bodyClassName="flex flex-col gap-4">
            <div>
              <Label>Type</Label>
              <Segmented
                label="Gradient type"
                value={g.type}
                onChange={(v: GradientType) => set('type', v)}
                options={[
                  { value: 'linear', label: 'Linear' },
                  { value: 'radial', label: 'Radial' },
                  { value: 'conic', label: 'Conic' },
                ]}
              />
            </div>
            {g.type !== 'radial' && (
              <SliderRow label={g.type === 'linear' ? 'Angle' : 'Start angle'} value={g.angle} min={0} max={360} unit="°" onChange={(v) => set('angle', v)} />
            )}
            {g.type === 'radial' && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="grad-shape">Shape</Label>
                  <Select id="grad-shape" value={g.shape} onChange={(e) => set('shape', e.target.value as RadialShape)}>
                    <option value="ellipse">Ellipse</option>
                    <option value="circle">Circle</option>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="grad-size">Size</Label>
                  <Select id="grad-size" value={g.size} onChange={(e) => set('size', e.target.value as RadialSize)}>
                    <option value="farthest-corner">Farthest corner</option>
                    <option value="farthest-side">Farthest side</option>
                    <option value="closest-corner">Closest corner</option>
                    <option value="closest-side">Closest side</option>
                  </Select>
                </div>
              </div>
            )}
            {g.type !== 'linear' && (
              <>
                <SliderRow label="Center X" value={g.x} min={0} max={100} unit="%" onChange={(v) => set('x', v)} />
                <SliderRow label="Center Y" value={g.y} min={0} max={100} unit="%" onChange={(v) => set('y', v)} />
              </>
            )}
            <Switch label="Repeating" checked={g.repeating} onChange={(v) => set('repeating', v)} />
          </Panel>
          <Panel title="Presets">
            <div className="grid grid-cols-4 gap-2">
              {GRADIENT_PRESETS.map((p) => (
                <button
                  key={p.name}
                  type="button"
                  title={p.name}
                  aria-label={`Preset: ${p.name}`}
                  onClick={() => {
                    const stops = p.gradient.stops.map((s) => ({ ...s, id: stopId() }));
                    setG({ ...p.gradient, stops });
                    setSelectedId(stops[0].id);
                  }}
                  className="lk-checker aspect-square overflow-hidden rounded-lg ring-1 ring-line-strong transition-transform hover:scale-105"
                >
                  <span className="block size-full" style={{ backgroundImage: gradientCss(p.gradient) }} />
                </button>
              ))}
            </div>
          </Panel>
        </div>
      </div>
      <CssOutput code={`${gradientDeclaration(g)}\n\n/* Shorthand */\nbackground: ${css};`} />
    </ToolStack>
  );
}
