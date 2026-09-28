import { describe, expect, it } from 'vitest';
import { describeSize, groupSizes, orientation } from './pageSizes';

describe('page size helpers', () => {
  it('describes sizes in several units', () => {
    const a4 = describeSize(595.28, 841.89);
    expect(a4.pt).toBe('595.3 × 841.9 pt');
    expect(a4.mm).toBe('210 × 297 mm');
    expect(a4.inches).toBe('8.27 × 11.69 in');
    expect(a4.paper).toBe('A4');
    expect(describeSize(100, 100).paper).toBeNull();
  });

  it('detects orientation', () => {
    expect(orientation(100, 200)).toBe('portrait');
    expect(orientation(200, 100)).toBe('landscape');
    expect(orientation(100, 100.2)).toBe('square');
  });

  it('groups identical sizes and sorts by frequency', () => {
    const groups = groupSizes([
      { page: 1, width: 612, height: 792, rotation: 0 },
      { page: 2, width: 792, height: 612, rotation: 0 },
      { page: 3, width: 612, height: 792, rotation: 0 },
      { page: 4, width: 612, height: 792, rotation: 90 },
    ]);
    expect(groups[0]).toMatchObject({ pages: [1, 3], width: 612 });
    expect(groups).toHaveLength(3);
    expect(groupSizes([])).toEqual([]);
  });
});
