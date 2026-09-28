import { useMemo } from 'react';
import { ChartColumn } from 'lucide-react';
import { EditorPanel, SplitPanes, ToolStack } from '@/components/tool/EditorPanel';
import { Panel, Stat, KeyValueList } from '@/components/ui/Panel';
import { Field, NumberInput } from '@/components/ui/Field';
import { Alert } from '@/components/ui/Alert';
import { EmptyState } from '@/components/ui/Feedback';
import { CopyButton } from '@/components/ui/Actions';
import { useDebouncedValue, useToolState } from '@/lib/hooks';
import { formatStat, histogram, parseNumbers, percentile, summarize, type Bin } from './lib/stats';

const TOOL = 'statistics-calculator';
const SAMPLE = '12, 15, 11, 19, 22, 15, 17, 14, 30, 16\n18 21 15 13 25 16 19 20 14 17';

function Histogram({ bins }: { bins: Bin[] }) {
  const W = 640;
  const H = 220;
  const pad = { l: 36, r: 12, t: 12, b: 34 };
  const maxCount = Math.max(...bins.map((b) => b.count), 1);
  const plotW = W - pad.l - pad.r;
  const plotH = H - pad.t - pad.b;
  const bw = plotW / bins.length;
  const ticks = [0, Math.ceil(maxCount / 2), maxCount].filter((v, i, a) => a.indexOf(v) === i);
  const labelEvery = Math.ceil(bins.length / 6);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="Histogram of the values">
      {ticks.map((t) => {
        const y = pad.t + plotH - (t / maxCount) * plotH;
        return (
          <g key={t}>
            <line x1={pad.l} x2={W - pad.r} y1={y} y2={y} stroke="var(--lk-border)" strokeWidth={1} />
            <text x={pad.l - 6} y={y + 4} textAnchor="end" fontSize={11} fill="var(--lk-text-muted)">
              {t}
            </text>
          </g>
        );
      })}
      {bins.map((b, i) => {
        const h = (b.count / maxCount) * plotH;
        const x = pad.l + i * bw;
        return (
          <g key={i}>
            <rect
              x={x + 1}
              y={pad.t + plotH - h}
              width={Math.max(1, bw - 2)}
              height={h}
              rx={2}
              fill="var(--lk-accent)"
              fillOpacity={0.85}
            >
              <title>{`${formatStat(b.from, 4)} – ${formatStat(b.to, 4)}: ${b.count}`}</title>
            </rect>
            {(i % labelEvery === 0 || bins.length === 1) && (
              <text x={x} y={H - pad.b + 16} fontSize={11} fill="var(--lk-text-muted)" textAnchor={i === 0 ? 'start' : 'middle'}>
                {formatStat(b.from, 3)}
              </text>
            )}
          </g>
        );
      })}
      <text x={W - pad.r} y={H - pad.b + 16} fontSize={11} fill="var(--lk-text-muted)" textAnchor="end">
        {formatStat(bins[bins.length - 1].to, 3)}
      </text>
      <line x1={pad.l} x2={W - pad.r} y1={pad.t + plotH} y2={pad.t + plotH} stroke="var(--lk-border-strong)" />
    </svg>
  );
}

export default function StatisticsCalculator() {
  const [input, setInput] = useToolState(TOOL, 'input', '');
  const [p, setP] = useToolState<number | ''>(TOOL, 'p', 90);
  const debounced = useDebouncedValue(input, 150);

  const parsed = useMemo(() => parseNumbers(debounced), [debounced]);
  const s = useMemo(() => summarize(parsed.values), [parsed]);
  const bins = useMemo(() => (s ? histogram(s.sorted) : []), [s]);
  const pValid = p !== '' && p >= 0 && p <= 100;
  const pValue = s && pValid ? percentile(s.sorted, p) : null;

  const rows = s
    ? [
        { label: 'Count', value: s.count },
        { label: 'Sum', value: formatStat(s.sum) },
        { label: 'Mean', value: formatStat(s.mean) },
        { label: 'Median', value: formatStat(s.median) },
        {
          label: 'Mode',
          value: s.modes.length
            ? `${s.modes.slice(0, 10).map((m) => formatStat(m)).join(', ')}${s.modes.length > 10 ? ` (+${s.modes.length - 10} more)` : ''} (×${s.modeFrequency})`
            : 'No mode (every value is unique)',
        },
        { label: 'Minimum', value: formatStat(s.min) },
        { label: 'Maximum', value: formatStat(s.max) },
        { label: 'Range', value: formatStat(s.range) },
        { label: 'Variance (sample, n−1)', value: s.sampleVariance === null ? 'Needs at least 2 values' : formatStat(s.sampleVariance) },
        { label: 'Std deviation (sample)', value: s.sampleStdDev === null ? 'Needs at least 2 values' : formatStat(s.sampleStdDev) },
        { label: 'Variance (population, n)', value: formatStat(s.populationVariance) },
        { label: 'Std deviation (population)', value: formatStat(s.populationStdDev) },
        { label: 'Standard error of mean', value: s.standardError === null ? '—' : formatStat(s.standardError) },
        { label: 'Q1 (25th percentile)', value: formatStat(s.q1) },
        { label: 'Q3 (75th percentile)', value: formatStat(s.q3) },
        { label: 'Interquartile range', value: formatStat(s.iqr) },
        {
          label: 'Geometric mean',
          value: s.geometricMean === null ? 'Only defined when all values are positive' : formatStat(s.geometricMean),
        },
        {
          label: 'Harmonic mean',
          value: s.harmonicMean === null ? 'Only defined when all values are positive' : formatStat(s.harmonicMean),
        },
        { label: 'Skewness (sample)', value: s.skewness === null ? 'Needs 3+ values with some spread' : formatStat(s.skewness, 6) },
        {
          label: 'Coefficient of variation',
          value: s.coefficientOfVariation === null ? '—' : `${formatStat(s.coefficientOfVariation * 100, 6)}%`,
        },
      ]
    : [];

  const report = rows.map((r) => `${r.label}\t${r.value}`).join('\n');

  return (
    <ToolStack>
      <SplitPanes className="lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <EditorPanel
          title="Numbers"
          value={input}
          onChange={setInput}
          placeholder="Paste numbers separated by commas, spaces or new lines…"
          sample={SAMPLE}
          fileAccept=".txt,.csv,.tsv,text/plain,text/csv"
          height="360px"
          footer={
            input.trim() ? (
              <>
                <span>{parsed.values.length.toLocaleString()} numbers</span>
                {parsed.ignoredCount > 0 && (
                  <span className="text-warning">{parsed.ignoredCount.toLocaleString()} ignored</span>
                )}
              </>
            ) : (
              <span>Use a dot for decimals: 3.14, not 3,14.</span>
            )
          }
        />
        <div className="flex min-w-0 flex-col gap-4">
          {parsed.ignoredCount > 0 && (
            <Alert tone="warning" title={`${parsed.ignoredCount.toLocaleString()} value${parsed.ignoredCount === 1 ? ' was' : 's were'} ignored`}>
              Not numbers: {parsed.ignored.slice(0, 8).map((t) => `"${t}"`).join(', ')}
              {parsed.ignoredCount > 8 ? '…' : ''}
            </Alert>
          )}
          {s ? (
            <>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Stat label="Count" value={s.count.toLocaleString()} />
                <Stat label="Mean" value={formatStat(s.mean, 8)} />
                <Stat label="Median" value={formatStat(s.median, 8)} />
                <Stat label="Std dev (sample)" value={s.sampleStdDev === null ? '—' : formatStat(s.sampleStdDev, 6)} />
              </div>
              <Panel title="Histogram" description={`${bins.length} bin${bins.length === 1 ? '' : 's'} (Freedman–Diaconis)`}>
                <Histogram bins={bins} />
              </Panel>
            </>
          ) : (
            <Panel>
              <EmptyState icon={ChartColumn} title="Paste some numbers">
                Count, mean, median, mode, standard deviation, quartiles and a histogram appear here.
              </EmptyState>
            </Panel>
          )}
        </div>
      </SplitPanes>

      {s && (
        <div className="grid min-w-0 grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <Panel title="Summary" actions={<CopyButton value={report} label="Copy all" />}>
            <KeyValueList items={rows.map((r) => ({ label: r.label, value: String(r.value), key: r.label }))} />
          </Panel>
          <Panel title="Percentile" bodyClassName="flex flex-col gap-3">
            <Field label="Percentile (0–100)" error={p !== '' && !pValid ? 'Enter a value between 0 and 100.' : null}>
              {({ id, describedBy, invalid }) => (
                <NumberInput
                  id={id}
                  aria-describedby={describedBy}
                  aria-invalid={invalid || undefined}
                  value={p}
                  onChange={setP}
                  min={0}
                  max={100}
                  step={1}
                />
              )}
            </Field>
            {pValue !== null && (
              <Stat label={`Percentile ${p} (P${p})`} value={formatStat(pValue)} />
            )}
            <p className="text-[12.5px] text-fg-muted">
              Quartiles and percentiles use linear interpolation between closest ranks (the same method as Excel
              PERCENTILE.INC / QUARTILE.INC, R type 7 and NumPy's default).
            </p>
          </Panel>
        </div>
      )}
    </ToolStack>
  );
}
