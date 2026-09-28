import { useEffect, useMemo, useState } from 'react';
import { EditorPanel, SplitPanes, ToolBar, ToolStack } from '@/components/tool/EditorPanel';
import { ErrorMessage } from '@/components/ui/Alert';
import { Checkbox, Label, Switch } from '@/components/ui/Field';
import { Segmented } from '@/components/ui/Segmented';
import { Badge, Panel } from '@/components/ui/Panel';
import { Spinner } from '@/components/ui/Feedback';
import { useDebouncedValue, useToolState } from '@/lib/hooks';
import { errorMessage, formatBytes } from '@/lib/utils';
import { RangeField } from './components/controls';
import { SvgPreview, type PreviewBg } from './components/SvgPreview';
import { buildSvgoConfig, defaultPrecision, presetToggles, SVGO_TOGGLES, type SvgoPreset } from './lib/svg';

const SAMPLE = `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<!-- Generator: Some Editor 1.0 -->
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="120px" height="120px" viewBox="0 0 120 120" version="1.1">
  <title>Badge</title>
  <desc>Created with an editor.</desc>
  <metadata>
    <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"/>
  </metadata>
  <defs>
    <linearGradient id="gradient-00001" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#2563EB"/>
      <stop offset="100%" stop-color="#7C3AED"/>
    </linearGradient>
  </defs>
  <g id="Page-1" stroke="none" stroke-width="1" fill="none" fill-rule="evenodd">
    <g id="Group">
      <rect id="Rectangle" fill="url(#gradient-00001)" x="10.000000" y="10.000000" width="100.000000" height="100.000000" rx="24.000000"></rect>
      <circle id="Oval" fill="#FFFFFF" cx="60.000000" cy="60.000000" r="22.500000"></circle>
    </g>
  </g>
</svg>`;

type OptimizeFn = (input: string, config: ReturnType<typeof buildSvgoConfig>) => { data: string };

export default function SvgOptimizer() {
  const [input, setInput] = useToolState('svg-optimizer', 'input', '');
  const [preset, setPresetState] = useToolState<SvgoPreset>('svg-optimizer', 'preset', 'default');
  const [plugins, setPlugins] = useToolState<Record<string, boolean>>('svg-optimizer', 'plugins', presetToggles('default'));
  const [multipass, setMultipass] = useToolState('svg-optimizer', 'multipass', true);
  const [precision, setPrecision] = useToolState('svg-optimizer', 'precision', 3);
  const [pretty, setPretty] = useToolState('svg-optimizer', 'pretty', false);
  const [bg, setBg] = useState<PreviewBg>('checker');
  const [optimizeFn, setOptimizeFn] = useState<OptimizeFn | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const debounced = useDebouncedValue(input, 200);

  useEffect(() => {
    let cancelled = false;
    import('svgo/browser').then(
      (m) => !cancelled && setOptimizeFn(() => m.optimize as unknown as OptimizeFn),
      () => !cancelled && setLoadError('The SVG optimizer failed to load. Check your connection and reload the page.'),
    );
    return () => {
      cancelled = true;
    };
  }, []);

  function setPreset(p: SvgoPreset) {
    setPresetState(p);
    setPlugins(presetToggles(p));
    setPrecision(defaultPrecision(p));
    setMultipass(true);
  }

  const result = useMemo(() => {
    if (!debounced.trim() || !optimizeFn) return null;
    try {
      const data = optimizeFn(debounced, buildSvgoConfig({ preset, multipass, precision, pretty, plugins })).data;
      return { ok: true as const, data };
    } catch (e) {
      const msg = errorMessage(e, 'The SVG could not be parsed.').split('\n')[0];
      return { ok: false as const, error: msg };
    }
  }, [debounced, optimizeFn, preset, multipass, precision, pretty, plugins]);

  const output = result?.ok ? result.data : '';
  const before = new Blob([debounced]).size;
  const after = new Blob([output]).size;
  const saved = before ? ((before - after) / before) * 100 : 0;

  return (
    <ToolStack>
      <ToolBar>
        <div>
          <Label>Preset</Label>
          <Segmented
            label="Preset"
            value={preset}
            onChange={setPreset}
            options={[
              { value: 'safe', label: 'Safe' },
              { value: 'default', label: 'Default' },
              { value: 'aggressive', label: 'Aggressive' },
            ]}
          />
        </div>
        <RangeField label="Number precision" className="w-full sm:w-48" value={precision} min={0} max={6} onChange={setPrecision} format={(v) => `${v} decimals`} />
        <Switch label="Multipass" checked={multipass} onChange={setMultipass} className="h-8" />
        <Switch label="Pretty print" checked={pretty} onChange={setPretty} className="h-8" />
      </ToolBar>
      <details className="rounded-xl border border-line bg-surface px-4 py-2.5 shadow-card">
        <summary className="text-[13px] font-medium text-fg-secondary select-none">Plugins ({Object.values(plugins).filter(Boolean).length} enabled)</summary>
        <div className="mt-3 grid gap-x-6 gap-y-2 pb-1 sm:grid-cols-2 lg:grid-cols-3">
          {SVGO_TOGGLES.map((p) => (
            <Checkbox
              key={p.name}
              label={p.label}
              description={p.hint}
              checked={plugins[p.name] ?? p.inPreset}
              onChange={(v) => setPlugins({ ...plugins, [p.name]: v })}
            />
          ))}
        </div>
      </details>
      <ErrorMessage error={loadError} />
      <ErrorMessage error={result && !result.ok ? result.error : null} title="Invalid SVG" />
      <SplitPanes>
        <EditorPanel
          title="Input SVG"
          value={input}
          onChange={setInput}
          language="xml"
          placeholder="Paste SVG markup or open a .svg file…"
          sample={SAMPLE}
          fileAccept=".svg,image/svg+xml"
          invalid={Boolean(result && !result.ok)}
          height="360px"
          footer={input ? <span>{formatBytes(before)}</span> : undefined}
        />
        <EditorPanel
          title="Optimized SVG"
          value={output}
          language="xml"
          height="360px"
          downloadName="optimized.svg"
          downloadType="image/svg+xml"
          placeholder={optimizeFn ? 'Optimized output appears here' : 'Loading optimizer…'}
          footer={
            output ? (
              <>
                <span>{formatBytes(after)}</span>
                <span className={saved >= 0 ? 'text-success' : 'text-warning'}>
                  {saved >= 0 ? `${saved.toFixed(1)}% smaller` : `${Math.abs(saved).toFixed(1)}% larger`}
                </span>
              </>
            ) : undefined
          }
        />
      </SplitPanes>
      {!optimizeFn && !loadError && input && <Spinner label="Loading SVGO…" />}
      {output && (
        <Panel
          title="Preview"
          description="Rendered as images: scripts never run"
          actions={
            <Segmented
              label="Preview background"
              size="sm"
              value={bg}
              onChange={setBg}
              options={[
                { value: 'checker', label: 'Checker' },
                { value: 'light', label: 'White' },
                { value: 'dark', label: 'Black' },
              ]}
            />
          }
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <figure>
              <figcaption className="mb-1.5 flex items-center gap-2 text-[12.5px] text-fg-muted">
                Before <Badge>{formatBytes(before)}</Badge>
              </figcaption>
              <SvgPreview svg={debounced} background={bg} label="Original SVG" />
            </figure>
            <figure>
              <figcaption className="mb-1.5 flex items-center gap-2 text-[12.5px] text-fg-muted">
                After <Badge tone={saved >= 0 ? 'success' : 'warning'}>{formatBytes(after)}</Badge>
              </figcaption>
              <SvgPreview svg={output} background={bg} label="Optimized SVG" />
            </figure>
          </div>
        </Panel>
      )}
    </ToolStack>
  );
}
