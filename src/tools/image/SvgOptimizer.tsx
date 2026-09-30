import { useMemo, useState } from 'react';
import { EditorPanel, SplitPanes, ToolBar, ToolStack } from '@/components/tool/EditorPanel';
import { ErrorMessage } from '@/components/ui/Alert';
import { Checkbox, Label, Switch } from '@/components/ui/Field';
import { Segmented } from '@/components/ui/Segmented';
import { Badge, Panel } from '@/components/ui/Panel';
import { Spinner } from '@/components/ui/Feedback';
import { useDebouncedValue, useToolState } from '@/lib/hooks';
import { formatBytes } from '@/lib/utils';
import { RangeField } from './components/controls';
import { SvgPreview, type PreviewBg } from './components/SvgPreview';
import { useSvgo } from './components/useSvgo';
import { buildSvgoConfig, defaultPrecision, presetToggles, SVGO_TOGGLES, type SvgoPreset } from './lib/svg';
import { t } from '@/lib/i18n';

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

export default function SvgOptimizer() {
  const [input, setInput] = useToolState('svg-optimizer', 'input', '');
  const [preset, setPresetState] = useToolState<SvgoPreset>('svg-optimizer', 'preset', 'default');
  const [plugins, setPlugins] = useToolState<Record<string, boolean>>('svg-optimizer', 'plugins', presetToggles('default'));
  const [multipass, setMultipass] = useToolState('svg-optimizer', 'multipass', true);
  const [precision, setPrecision] = useToolState('svg-optimizer', 'precision', 3);
  const [pretty, setPretty] = useToolState('svg-optimizer', 'pretty', false);
  const [bg, setBg] = useState<PreviewBg>('checker');
  const debounced = useDebouncedValue(input, 200);
  const config = useMemo(() => buildSvgoConfig({ preset, multipass, precision, pretty, plugins }), [preset, multipass, precision, pretty, plugins]);
  // SVGO runs in a worker: multi-megabyte SVGs take seconds and must not freeze the page.
  const { result, working, loadError } = useSvgo(debounced, config);

  function setPreset(p: SvgoPreset) {
    setPresetState(p);
    setPlugins(presetToggles(p));
    setPrecision(defaultPrecision(p));
    setMultipass(true);
  }

  const output = result?.ok ? result.data : '';
  // Sizes of the input the current result was made from (the editor may be ahead of it).
  const inputSize = useMemo(() => new Blob([input]).size, [input]);
  const before = useMemo(() => new Blob([result?.input ?? '']).size, [result]);
  const after = useMemo(() => new Blob([output]).size, [output]);
  const saved = before ? ((before - after) / before) * 100 : 0;

  return (
    <ToolStack>
      <ToolBar>
        <div className="min-w-0">
          <Label>{t('Preset')}</Label>
          <Segmented
            label={t('Preset')}
            value={preset}
            onChange={setPreset}
            options={[
              { value: 'safe', label: t('Safe') },
              { value: 'default', label: t('Default') },
              { value: 'aggressive', label: t('Aggressive') },
            ]}
          />
        </div>
        <RangeField label={t('Number precision')} className="w-full sm:w-48" value={precision} min={0} max={6} onChange={setPrecision} format={(v) => `${v} decimals`} />
        <Switch label={t('Multipass')} checked={multipass} onChange={setMultipass} className="h-8" />
        <Switch label={t('Pretty print')} checked={pretty} onChange={setPretty} className="h-8" />
      </ToolBar>
      <details className="rounded-xl border border-line bg-surface px-4 py-2.5 shadow-card">
        <summary className="text-[13px] font-medium text-fg-secondary select-none">{t('Plugins ({count} enabled)', { count: Object.values(plugins).filter(Boolean).length })}</summary>
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
      <ErrorMessage error={result && !result.ok ? result.error : null} title={t('Invalid SVG')} />
      <SplitPanes>
        <EditorPanel
          title={t('Input SVG')}
          value={input}
          onChange={setInput}
          language="xml"
          placeholder={t('Paste SVG markup or open a .svg file…')}
          sample={SAMPLE}
          fileAccept=".svg,image/svg+xml"
          invalid={Boolean(result && !result.ok)}
          height="360px"
          footer={input ? <span>{formatBytes(inputSize)}</span> : undefined}
        />
        <EditorPanel
          title={t('Optimized SVG')}
          value={output}
          language="xml"
          height="360px"
          downloadName="optimized.svg"
          downloadType="image/svg+xml"
          placeholder={working ? t('Optimizing…') : t('Optimized output appears here')}
          footer={
            output ? (
              <>
                <span>{formatBytes(after)}</span>
                <span className={saved >= 0 ? 'text-success' : 'text-warning'}>
                  {saved >= 0 ? t('{saved}% smaller', { saved: saved.toFixed(1) }) : t('{abs}% larger', { abs: Math.abs(saved).toFixed(1) })}
                </span>
              </>
            ) : undefined
          }
        />
      </SplitPanes>
      {working && <Spinner label={output ? t('Updating the optimized SVG…') : t('Optimizing…')} />}
      {output && (
        <Panel
          title={t('Preview')}
          description={t('Rendered as images: scripts never run')}
          actions={
            <Segmented
              label={t('Preview background')}
              size="sm"
              value={bg}
              onChange={setBg}
              options={[
                { value: 'checker', label: t('Checker') },
                { value: 'light', label: t('White') },
                { value: 'dark', label: t('Black') },
              ]}
            />
          }
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <figure>
              <figcaption className="mb-1.5 flex items-center gap-2 text-[12.5px] text-fg-muted">
                {t('Before')}{' '}<Badge>{formatBytes(before)}</Badge>
              </figcaption>
              <SvgPreview svg={debounced} background={bg} label={t('Original SVG')} />
            </figure>
            <figure>
              <figcaption className="mb-1.5 flex items-center gap-2 text-[12.5px] text-fg-muted">
                {t('After')}{' '}<Badge tone={saved >= 0 ? 'success' : 'warning'}>{formatBytes(after)}</Badge>
              </figcaption>
              <SvgPreview svg={output} background={bg} label={t('Optimized SVG')} />
            </figure>
          </div>
        </Panel>
      )}
    </ToolStack>
  );
}
