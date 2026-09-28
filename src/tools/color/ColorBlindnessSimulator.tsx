import { useMemo } from 'react';
import type { Color } from 'culori';
import { ToolStack } from '@/components/tool/EditorPanel';
import { Alert } from '@/components/ui/Alert';
import { Label, Textarea } from '@/components/ui/Field';
import { Badge, Panel } from '@/components/ui/Panel';
import { EmptyState } from '@/components/ui/Feedback';
import { Eye } from 'lucide-react';
import { useToolState } from '@/lib/hooks';
import { formatColor, parseAny } from './lib/color';
import { CONFUSION_THRESHOLD, VISION_TYPES, confusablePairs, extractColorTokens, simulate } from './lib/cvd';

const TOOL = 'color-blindness-simulator';
const MAX_COLORS = 24;

const SAMPLES = [
  { label: 'Chart palette', value: '#1f77b4, #ff7f0e, #2ca02c, #d62728, #9467bd, #8c564b' },
  { label: 'Traffic light', value: '#16a34a, #eab308, #dc2626' },
  { label: 'Status colors', value: '#22c55e #ef4444 #3b82f6 #f97316 #a855f7' },
  { label: 'Okabe–Ito (CVD-safe)', value: '#e69f00 #56b4e9 #009e73 #f0e442 #0072b2 #d55e00 #cc79a7 #000000' },
];

export default function ColorBlindnessSimulator() {
  const [text, setText] = useToolState(TOOL, 'colors', SAMPLES[0].value);

  const { colors, invalid } = useMemo(() => {
    const colors: Array<{ source: string; color: Color; hex: string }> = [];
    const invalid: string[] = [];
    for (const token of extractColorTokens(text)) {
      try {
        const color = parseAny(token);
        colors.push({ source: token, color, hex: formatColor(color, 'hex') });
      } catch {
        invalid.push(token);
      }
    }
    return { colors: colors.slice(0, MAX_COLORS), invalid, truncated: colors.length > MAX_COLORS };
  }, [text]);

  const rows = useMemo(
    () =>
      VISION_TYPES.map((v) => ({
        ...v,
        sims: colors.map((c) => simulate(c.color, v.id)),
        pairs: confusablePairs(
          colors.map((c) => c.color),
          v.id,
        ),
      })),
    [colors],
  );

  const problemRows = rows.filter((r) => r.pairs.length > 0);

  return (
    <ToolStack>
      <Panel bodyClassName="flex flex-col gap-3">
        <div>
          <Label htmlFor="cvd-colors">Colors</Label>
          <Textarea
            id="cvd-colors"
            rows={3}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="#1f77b4, #ff7f0e, rgb(44 160 44), crimson…"
          />
          <p className="mt-1.5 text-[12.5px] text-fg-muted">
            Separate colors with commas, spaces or new lines. Any CSS color works; up to {MAX_COLORS} are shown.
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {SAMPLES.map((s) => (
            <button
              key={s.label}
              type="button"
              onClick={() => setText(s.value)}
              className="rounded-md border border-line bg-surface-sunken px-2 py-0.5 text-[12.5px] text-fg-secondary hover:border-line-strong hover:text-fg"
            >
              {s.label}
            </button>
          ))}
        </div>
        {invalid.length > 0 && (
          <Alert tone="warning">
            Ignored {invalid.length === 1 ? 'a value that is' : `${invalid.length} values that are`} not colors:{' '}
            <span className="font-mono">{invalid.slice(0, 6).join(', ')}</span>
            {invalid.length > 6 && '…'}
          </Alert>
        )}
      </Panel>

      {colors.length === 0 ? (
        <Panel>
          <EmptyState icon={Eye} title="Add some colors">
            Paste a palette to see how it looks with different kinds of color vision.
          </EmptyState>
        </Panel>
      ) : (
        <>
          <Panel bodyClassName="flex flex-col divide-y divide-line p-0">
            {rows.map((row) => (
              <section key={row.id} className="flex flex-col gap-2.5 px-4 py-3.5 md:flex-row md:items-center md:gap-4">
                <div className="md:w-52 md:shrink-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <h3 className="text-[13.5px] font-semibold text-fg">{row.label}</h3>
                    {row.pairs.length > 0 && <Badge tone="warning">{row.pairs.length} hard to tell apart</Badge>}
                  </div>
                  <p className="text-[12px] text-fg-muted">{row.prevalence || 'Reference'}</p>
                </div>
                <div className="flex min-w-0 flex-1 flex-wrap gap-1.5">
                  {row.sims.map((hex, i) => (
                    <div
                      key={i}
                      title={`${colors[i].source} → ${hex}`}
                      className="flex h-14 w-16 items-end rounded-md p-1 ring-1 ring-black/5 ring-inset sm:w-20 dark:ring-white/10"
                      style={{ background: hex }}
                    >
                      <span className="rounded bg-black/45 px-1 font-mono text-[10.5px] text-white">{hex}</span>
                    </div>
                  ))}
                </div>
              </section>
            ))}
          </Panel>

          {problemRows.length > 0 ? (
            <Panel title="Pairs that become hard to distinguish" description={`OKLab distance below ${CONFUSION_THRESHOLD} under the simulation (but clearly different with typical vision).`}>
              <div className="flex flex-col gap-3">
                {problemRows.map((row) => (
                  <div key={row.id}>
                    <h3 className="mb-1.5 text-[13px] font-medium text-fg">{row.label}</h3>
                    <ul className="flex flex-wrap gap-2">
                      {row.pairs.map((p) => (
                        <li key={`${p.a}-${p.b}`} className="flex items-center gap-2 rounded-lg border border-line bg-surface-sunken px-2 py-1.5 text-[12.5px]">
                          <span className="size-4 rounded ring-1 ring-line-strong" style={{ background: colors[p.a].hex }} />
                          <span className="font-mono text-fg-secondary">{colors[p.a].hex}</span>
                          <span className="text-fg-muted">&amp;</span>
                          <span className="size-4 rounded ring-1 ring-line-strong" style={{ background: colors[p.b].hex }} />
                          <span className="font-mono text-fg-secondary">{colors[p.b].hex}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
                <p className="text-[12.5px] text-fg-muted">
                  Don’t rely on color alone: add labels, patterns or icons, or vary lightness more between these colors.
                </p>
              </div>
            </Panel>
          ) : (
            colors.length > 1 && <Alert tone="success">No pair of these colors collapses into near-identical colors in any of the simulations.</Alert>
          )}

          <p className="text-[12.5px] leading-relaxed text-fg-muted">
            Simulation uses the Machado, Oliveira &amp; Fernandes (2009) model for complete dichromacy (severity 1.0), applied in
            linear RGB, and Rec. 709 luminance for achromatopsia. Individual perception varies; milder forms (protanomaly,
            deuteranomaly) look closer to typical vision than shown here.
          </p>
        </>
      )}
    </ToolStack>
  );
}
