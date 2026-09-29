/** How a processed file's size compares with the original (Compress PDF). */
export type SizeVerdict = 'smaller' | 'marginal' | 'same' | 'larger';

export interface SizeChange {
  /** (after − before) / before */
  fraction: number;
  /** 'smaller' means at least 1% smaller; 'marginal' is a smaller file that saves less than 1%. */
  verdict: SizeVerdict;
  /** Signed percentage for display: "-45.2%", "+3.1%", "-0.004%", "0%". */
  percent: string;
}

export function sizeChange(before: number, after: number): SizeChange {
  const fraction = before > 0 ? (after - before) / before : 0;
  const verdict: SizeVerdict = after === before ? 'same' : fraction <= -0.01 ? 'smaller' : fraction < 0 ? 'marginal' : 'larger';
  return { fraction, verdict, percent: formatPercent(fraction) };
}

/** Signed percentage that never rounds a real change to "0.0%". */
export function formatPercent(fraction: number): string {
  const pct = fraction * 100;
  if (pct === 0 || !Number.isFinite(pct)) return '0%';
  const sign = pct < 0 ? '-' : '+';
  const abs = Math.abs(pct);
  if (abs >= 0.1) return `${sign}${abs.toFixed(1)}%`;
  if (abs < 0.001) return `${sign}<0.001%`;
  return `${sign}${Number(abs.toPrecision(1))}%`;
}
