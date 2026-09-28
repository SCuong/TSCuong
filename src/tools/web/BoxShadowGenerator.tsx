import { useState } from 'react';
import { ArrowDown, ArrowUp, Copy, Eye, EyeOff, Plus, Trash2 } from 'lucide-react';
import { ToolStack } from '@/components/tool/EditorPanel';
import { Panel } from '@/components/ui/Panel';
import { Button, IconButton } from '@/components/ui/Button';
import { Switch } from '@/components/ui/Field';
import { useToolState } from '@/lib/hooks';
import { cn } from '@/lib/utils';
import { ColorInput, CssOutput, SliderRow } from './design/Controls';
import { SHADOW_PRESETS, layerCss, layerId, shadowCss, type ShadowLayer } from './lib/shadow';

const TOOL = 'box-shadow-generator';

interface Box {
  background: string;
  radius: number;
}

export default function BoxShadowGenerator() {
  const [layers, setLayers] = useToolState<ShadowLayer[]>(TOOL, 'layers', SHADOW_PRESETS[1].layers);
  const [box, setBox] = useToolState<Box>(TOOL, 'box', { background: '#ffffff', radius: 16 });
  const [selectedId, setSelectedId] = useState(layers[0]?.id ?? '');
  const selected = layers.find((l) => l.id === selectedId) ?? layers[0];
  const css = shadowCss(layers);

  const update = (id: string, patch: Partial<ShadowLayer>) => setLayers((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  const add = (from?: ShadowLayer) => {
    const layer: ShadowLayer = from
      ? { ...from, id: layerId() }
      : { id: layerId(), x: 0, y: 8, blur: 24, spread: -4, color: '#000000', opacity: 0.2, inset: false, visible: true };
    setLayers((prev) => [...prev, layer]);
    setSelectedId(layer.id);
  };
  const remove = (id: string) => {
    const rest = layers.filter((l) => l.id !== id);
    setLayers(rest);
    setSelectedId(rest[0]?.id ?? '');
  };
  const move = (id: string, delta: number) =>
    setLayers((prev) => {
      const i = prev.findIndex((l) => l.id === id);
      const j = i + delta;
      if (i < 0 || j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });

  const surface = (dark: boolean) => (
    <div className={cn('flex h-64 items-center justify-center rounded-xl p-8 sm:h-72', dark ? 'bg-[#0b0f17]' : 'bg-[#f1f3f6]')}>
      <div className="size-32 sm:size-40" style={{ background: dark ? '#1b2130' : box.background, borderRadius: box.radius, boxShadow: css }} />
    </div>
  );

  return (
    <ToolStack>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_400px]">
        <div className="flex min-w-0 flex-col gap-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <figure className="m-0">
              {surface(false)}
              <figcaption className="mt-1.5 text-center text-[12px] text-fg-muted">Light surface</figcaption>
            </figure>
            <figure className="m-0">
              {surface(true)}
              <figcaption className="mt-1.5 text-center text-[12px] text-fg-muted">Dark surface</figcaption>
            </figure>
          </div>
          <Panel title="Preview element" bodyClassName="grid gap-4 sm:grid-cols-2">
            <ColorInput label="Background (light preview)" value={box.background} onChange={(background) => setBox((b) => ({ ...b, background }))} />
            <SliderRow label="Corner radius" value={box.radius} min={0} max={80} unit="px" onChange={(radius) => setBox((b) => ({ ...b, radius }))} />
          </Panel>
          <Panel title="Presets">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
              {SHADOW_PRESETS.map((p) => (
                <button
                  key={p.name}
                  type="button"
                  onClick={() => {
                    const fresh = p.layers.map((l) => ({ ...l, id: layerId() }));
                    setLayers(fresh);
                    setSelectedId(fresh[0].id);
                  }}
                  className="flex flex-col items-center gap-2 rounded-lg border border-line bg-[#f1f3f6] px-2 pt-4 pb-2 text-[12px] font-medium text-[#1f2937] hover:border-line-strong"
                >
                  <span className="size-10 rounded-lg bg-white" style={{ boxShadow: shadowCss(p.layers) }} />
                  {p.name}
                </button>
              ))}
            </div>
          </Panel>
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          <Panel
            title="Layers"
            description="The first layer is drawn on top."
            actions={
              <Button size="sm" icon={Plus} onClick={() => add()}>
                Add
              </Button>
            }
            bodyClassName="p-2"
          >
            {layers.length === 0 ? (
              <p className="px-2 py-4 text-center text-[13px] text-fg-muted">No layers. The element has no shadow.</p>
            ) : (
              <ul className="flex flex-col gap-1">
                {layers.map((l, i) => (
                  <li key={l.id}>
                    <div
                      className={cn(
                        'flex items-center gap-1 rounded-lg border px-1 py-1',
                        l.id === selected?.id ? 'border-accent-line bg-accent-soft' : 'border-transparent hover:bg-surface-hover',
                      )}
                    >
                      <button
                        type="button"
                        onClick={() => setSelectedId(l.id)}
                        aria-pressed={l.id === selected?.id}
                        className={cn('flex min-w-0 flex-1 items-center gap-2 px-1 text-left', !l.visible && 'opacity-50')}
                      >
                        <span className="size-4 shrink-0 rounded ring-1 ring-line-strong" style={{ background: l.color, opacity: Math.max(0.15, l.opacity) }} />
                        <span className="truncate font-mono text-[12px] text-fg">{layerCss(l)}</span>
                      </button>
                      <IconButton icon={l.visible ? Eye : EyeOff} label={l.visible ? 'Hide layer' : 'Show layer'} size="sm" onClick={() => update(l.id, { visible: !l.visible })} />
                      <IconButton icon={ArrowUp} label="Move up" size="sm" disabled={i === 0} onClick={() => move(l.id, -1)} />
                      <IconButton icon={ArrowDown} label="Move down" size="sm" disabled={i === layers.length - 1} onClick={() => move(l.id, 1)} />
                      <IconButton icon={Copy} label="Duplicate layer" size="sm" onClick={() => add(l)} />
                      <IconButton icon={Trash2} label="Delete layer" size="sm" onClick={() => remove(l.id)} />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
          {selected && (
            <Panel title="Selected layer" bodyClassName="flex flex-col gap-3">
              <SliderRow label="Horizontal offset" value={selected.x} min={-100} max={100} unit="px" onChange={(x) => update(selected.id, { x })} />
              <SliderRow label="Vertical offset" value={selected.y} min={-100} max={100} unit="px" onChange={(y) => update(selected.id, { y })} />
              <SliderRow label="Blur" value={selected.blur} min={0} max={150} unit="px" onChange={(blur) => update(selected.id, { blur: Math.max(0, blur) })} />
              <SliderRow label="Spread" value={selected.spread} min={-60} max={60} unit="px" onChange={(spread) => update(selected.id, { spread })} />
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <ColorInput label="Color" value={selected.color} onChange={(color) => update(selected.id, { color })} />
                <SliderRow label="Opacity" value={Math.round(selected.opacity * 100)} min={0} max={100} unit="%" onChange={(v) => update(selected.id, { opacity: v / 100 })} />
              </div>
              <Switch label="Inset (inner shadow)" checked={selected.inset} onChange={(inset) => update(selected.id, { inset })} />
            </Panel>
          )}
        </div>
      </div>
      <CssOutput code={`box-shadow: ${css};`} />
    </ToolStack>
  );
}
