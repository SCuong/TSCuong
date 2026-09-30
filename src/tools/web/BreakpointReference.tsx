import { useMemo, useSyncExternalStore } from 'react';
import { Laptop, Monitor, Smartphone, Tablet } from 'lucide-react';
import { ToolStack } from '@/components/tool/EditorPanel';
import { Panel, Badge, Stat } from '@/components/ui/Panel';
import { Checkbox, Label, NumberInput, Select } from '@/components/ui/Field';
import { CopyButton } from '@/components/ui/Actions';
import { Segmented } from '@/components/ui/Segmented';
import { useToolState } from '@/lib/hooks';
import { cn } from '@/lib/utils';
import { DEVICES, FRAMEWORKS, activeBreakpoint, buildMediaQuery, frameworkQuery, type Device, type MediaQueryOptions } from './lib/breakpoints';

const TOOL = 'breakpoint-reference';

interface Viewport {
  width: number;
  height: number;
  dpr: number;
}

let cached: Viewport = { width: 0, height: 0, dpr: 1 };
function readViewport(): Viewport {
  const next = { width: window.innerWidth, height: window.innerHeight, dpr: window.devicePixelRatio || 1 };
  if (next.width !== cached.width || next.height !== cached.height || next.dpr !== cached.dpr) cached = next;
  return cached;
}
function subscribe(listener: () => void) {
  window.addEventListener('resize', listener);
  return () => window.removeEventListener('resize', listener);
}

function useViewport(): Viewport {
  return useSyncExternalStore(subscribe, readViewport, () => cached);
}

const KIND_ICON = { Phone: Smartphone, Tablet, Laptop, Desktop: Monitor } as const;

const DEFAULT_QUERY: MediaQueryOptions = {
  mode: 'min',
  min: 768,
  max: 1024,
  unit: 'px',
  syntax: 'classic',
  orientation: 'any',
  colorScheme: 'any',
  reducedMotion: false,
  hover: false,
};

function range(min: number, max: number | null) {
  if (min === 0 && max !== null) return `< ${max}px`;
  if (max === null) return `≥ ${min}px`;
  return `${min}–${max - 1}px`;
}

export default function BreakpointReference() {
  const vp = useViewport();
  const [fwId, setFwId] = useToolState(TOOL, 'framework', 'tailwind');
  const [kind, setKind] = useToolState<'all' | Device['kind']>(TOOL, 'deviceKind', 'all');
  const [stored, setQuery] = useToolState<MediaQueryOptions>(TOOL, 'query', DEFAULT_QUERY);
  const q = { ...DEFAULT_QUERY, ...stored };
  const setQ = <K extends keyof MediaQueryOptions>(key: K, value: MediaQueryOptions[K]) => setQuery((p) => ({ ...DEFAULT_QUERY, ...p, [key]: value }));
  const framework = FRAMEWORKS.find((f) => f.id === fwId) ?? FRAMEWORKS[0];
  const active = activeBreakpoint(framework, vp.width);
  const query = buildMediaQuery(q);
  const devices = useMemo(() => DEVICES.filter((d) => kind === 'all' || d.kind === kind), [kind]);

  return (
    <ToolStack>
      <Panel title="Your viewport" description="Updates live as you resize the window.">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label="Width" value={`${vp.width}px`} />
          <Stat label="Height" value={`${vp.height}px`} />
          <Stat label="Pixel ratio" value={`${Number(vp.dpr.toFixed(2))}×`} />
          <Stat label="Orientation" value={vp.width >= vp.height ? 'landscape' : 'portrait'} />
        </div>
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-[13px]">
          {FRAMEWORKS.map((f) => (
            <span key={f.id} className="flex items-center gap-1.5 text-fg-secondary">
              {f.name}: <Badge tone="accent">{activeBreakpoint(f, vp.width).name}</Badge>
            </span>
          ))}
        </div>
      </Panel>

      <Panel
        title="Framework breakpoints"
        description={framework.approach}
        actions={
          <Segmented
            label="Framework"
            size="sm"
            value={framework.id}
            onChange={setFwId}
            options={FRAMEWORKS.map((f) => ({ value: f.id, label: f.name.replace(/ (CSS )?v?\d.*$|\s\d+$/, '') }))}
          />
        }
        bodyClassName="p-0"
      >
        <div className="overflow-x-auto" tabIndex={0} role="region" aria-label={`${framework.name} breakpoints`}>
          <table className="w-full min-w-[640px] text-left text-[13px]">
            <thead className="text-[12px] text-fg-muted">
              <tr className="border-b border-line">
                <th className="py-2 pr-3 pl-4 font-medium">Name</th>
                <th className="py-2 pr-3 font-medium">Min width</th>
                <th className="py-2 pr-3 font-medium">Range</th>
                <th className="py-2 pr-4 font-medium">Media query (this size and up / only this range)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {framework.breakpoints.map((bp) => {
                const up = frameworkQuery(framework, bp, 'up');
                const onlyQuery = frameworkQuery(framework, bp, 'only');
                const only = onlyQuery === up ? null : onlyQuery;
                const isActive = bp === active;
                return (
                  <tr key={bp.name} className={cn('align-top', isActive && 'bg-accent-soft')}>
                    <td className="py-2 pr-3 pl-4">
                      <span className="font-mono font-semibold text-fg">{bp.name}</span>
                      {isActive && (
                        <Badge tone="accent" className="ml-2">
                          current
                        </Badge>
                      )}
                    </td>
                    <td className="py-2 pr-3 font-mono text-fg tabular-nums">
                      {bp.min}px{bp.note && /^\d/.test(bp.note) && <span className="ml-1 text-fg-muted">({bp.note})</span>}
                    </td>
                    <td className="py-2 pr-3 text-fg-secondary">
                      {range(bp.min, bp.max)}
                      {bp.note && !/^\d/.test(bp.note) && <span className="block text-[12px] text-fg-muted">{bp.note}</span>}
                    </td>
                    <td className="py-2 pr-4">
                      <div className="flex flex-col gap-1 font-mono text-[12px]">
                        {[up, only].map((qq, i) =>
                          qq ? (
                            <span key={i} className="flex items-center gap-1">
                              <code className="min-w-0 flex-1 break-all text-fg-secondary">{qq}</code>
                              <CopyButton value={`${qq} {\n  \n}`} iconOnly label={`Copy ${i === 0 ? 'min-width' : 'range'} query for ${bp.name}`} />
                            </span>
                          ) : (
                            i === 0 && (
                              <span key={i} className="font-sans text-fg-muted">
                                Base styles, no media query
                              </span>
                            )
                          ),
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Panel>

      <div className="grid min-w-0 grid-cols-1 items-start gap-4 xl:grid-cols-2">
        <Panel title="Media query builder" bodyClassName="flex flex-col gap-4">
          <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
            <div>
              <Label>Condition</Label>
              <Segmented
                label="Condition"
                value={q.mode}
                onChange={(v) => setQ('mode', v)}
                options={[
                  { value: 'min', label: 'From' },
                  { value: 'max', label: 'Below' },
                  { value: 'between', label: 'Between' },
                ]}
              />
            </div>
            {q.mode !== 'max' && (
              <div className="w-28">
                <Label htmlFor="bq-min">Min width (px)</Label>
                <NumberInput id="bq-min" min={0} value={q.min} onChange={(v) => setQ('min', v === '' ? 0 : Math.max(0, v))} />
              </div>
            )}
            {q.mode !== 'min' && (
              <div className="w-28">
                <Label htmlFor="bq-max">{q.mode === 'max' ? 'Width below (px)' : 'Max (exclusive)'}</Label>
                <NumberInput id="bq-max" min={0} value={q.max} onChange={(v) => setQ('max', v === '' ? 0 : Math.max(0, v))} />
              </div>
            )}
            <div>
              <Label>Unit</Label>
              <Segmented label="Unit" value={q.unit} onChange={(v) => setQ('unit', v)} options={[{ value: 'px', label: 'px' }, { value: 'em', label: 'em' }]} />
            </div>
            <div>
              <Label>Syntax</Label>
              <Segmented
                label="Syntax"
                value={q.syntax}
                onChange={(v) => setQ('syntax', v)}
                options={[
                  { value: 'classic', label: 'min/max-width' },
                  { value: 'range', label: 'Range (width >=)' },
                ]}
              />
            </div>
          </div>
          <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
            <div>
              <Label htmlFor="bq-orient">Orientation</Label>
              <Select id="bq-orient" value={q.orientation} onChange={(e) => setQ('orientation', e.target.value as MediaQueryOptions['orientation'])} className="w-auto">
                <option value="any">Any</option>
                <option value="portrait">Portrait</option>
                <option value="landscape">Landscape</option>
              </Select>
            </div>
            <div>
              <Label htmlFor="bq-scheme">Color scheme</Label>
              <Select id="bq-scheme" value={q.colorScheme} onChange={(e) => setQ('colorScheme', e.target.value as MediaQueryOptions['colorScheme'])} className="w-auto">
                <option value="any">Any</option>
                <option value="dark">Dark</option>
                <option value="light">Light</option>
              </Select>
            </div>
            <Checkbox label="Reduced motion" checked={q.reducedMotion} onChange={(v) => setQ('reducedMotion', v)} className="h-9 items-center" />
            <Checkbox label="Mouse / fine pointer" checked={q.hover} onChange={(v) => setQ('hover', v)} className="h-9 items-center" />
          </div>
          <div className="flex items-start gap-2 rounded-lg border border-line bg-surface-sunken px-3 py-2.5">
            <pre className="min-w-0 flex-1 font-mono text-[13px] break-all whitespace-pre-wrap text-fg">{query}</pre>
            <CopyButton value={query} iconOnly label="Copy media query" />
          </div>
          {typeof window !== 'undefined' && (
            <p className="text-[12.5px] text-fg-muted">
              In this window the query currently{' '}
              <strong className="font-semibold text-fg">{window.matchMedia(query.slice(7, query.indexOf(' {'))).matches ? 'matches' : 'does not match'}</strong>.
              {q.syntax === 'range' && ' Range syntax works in all current browsers (2023+).'}
            </p>
          )}
        </Panel>

        <Panel
          title="Common device viewports"
          description="CSS pixels, portrait. Actual sizes vary with browser UI and zoom."
          actions={
            <Segmented
              label="Device type"
              size="sm"
              value={kind}
              onChange={setKind}
              options={[
                { value: 'all', label: 'All' },
                { value: 'Phone', label: 'Phones' },
                { value: 'Tablet', label: 'Tablets' },
                { value: 'Laptop', label: 'Laptops' },
                { value: 'Desktop', label: 'Desktops' },
              ]}
            />
          }
          bodyClassName="p-0"
        >
          <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Common device viewports">
            <table className="w-full min-w-[340px] text-left text-[13px]">
              <thead className="text-[12px] text-fg-muted">
                <tr className="border-b border-line">
                  <th className="py-2 pr-3 pl-4 font-medium">Device</th>
                  <th className="py-2 pr-3 font-medium">Viewport</th>
                  <th className="py-2 pr-4 font-medium">{framework.name.split(' ')[0]}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {devices.map((d) => {
                  const Icon = KIND_ICON[d.kind];
                  return (
                    <tr key={d.name}>
                      <td className="py-2 pr-3 pl-4">
                        <span className="flex items-center gap-2 text-fg">
                          <Icon size={15} className="shrink-0 text-fg-muted" aria-hidden />
                          {d.name}
                        </span>
                      </td>
                      <td className="py-2 pr-3 font-mono whitespace-nowrap text-fg tabular-nums">
                        {d.width} × {d.height}
                      </td>
                      <td className="py-2 pr-4 font-mono text-fg-secondary">{activeBreakpoint(framework, d.width).name}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>
    </ToolStack>
  );
}
