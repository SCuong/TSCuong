export interface PageSize {
  width: number;
  height: number;
}
export const PAGE_GAP = 12;
export function pageLayout(sizes: PageSize[], scale: number | number[]) {
  let y = PAGE_GAP;
  const offsets = sizes.map((size, i) => {
    const factor = typeof scale === 'number' ? scale : scale[i];
    const result = { top: y, height: size.height * factor, width: size.width * factor };
    y += result.height + PAGE_GAP;
    return result;
  });
  return { offsets, height: y };
}
export function pageAt(offsets: { top: number }[], y: number) {
  let low = 0,
    high = offsets.length - 1;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (offsets[mid].top <= y) low = mid;
    else high = mid - 1;
  }
  return low;
}
export function fitScale(size: PageSize, width: number, height: number, mode: 'width' | 'page') {
  const w = Math.max(1, width - 16) / size.width;
  return mode === 'width' ? w : Math.min(w, Math.max(1, height - PAGE_GAP * 2) / size.height);
}
export function boundedZoom(value: number) {
  return Math.max(0.35, Math.min(5, value));
}
