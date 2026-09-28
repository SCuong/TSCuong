import { paperName, ptToIn, ptToMm } from './geometry';

export interface PageSizeInfo {
  /** 1-based page number */
  page: number;
  /** Displayed size (after /Rotate) in points */
  width: number;
  height: number;
  rotation: number;
}

export interface SizeGroup {
  pages: number[];
  width: number;
  height: number;
  rotation: number;
}

const round = (n: number, d = 1) => Math.round(n * 10 ** d) / 10 ** d;

export function orientation(width: number, height: number): 'portrait' | 'landscape' | 'square' {
  if (Math.abs(width - height) < 0.5) return 'square';
  return width > height ? 'landscape' : 'portrait';
}

export function describeSize(width: number, height: number): { pt: string; mm: string; inches: string; paper: string | null } {
  return {
    pt: `${round(width)} × ${round(height)} pt`,
    mm: `${round(ptToMm(width))} × ${round(ptToMm(height))} mm`,
    inches: `${round(ptToIn(width), 2)} × ${round(ptToIn(height), 2)} in`,
    paper: paperName(width, height),
  };
}

/** Group pages that share the same size and rotation (not necessarily consecutive). */
export function groupSizes(pages: PageSizeInfo[]): SizeGroup[] {
  const map = new Map<string, SizeGroup>();
  for (const p of pages) {
    const key = `${round(p.width)}x${round(p.height)}r${p.rotation}`;
    const g = map.get(key);
    if (g) g.pages.push(p.page);
    else map.set(key, { pages: [p.page], width: p.width, height: p.height, rotation: p.rotation });
  }
  return [...map.values()].sort((a, b) => b.pages.length - a.pages.length);
}
