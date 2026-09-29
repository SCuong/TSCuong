import { describe, expect, it } from 'vitest';
import { describePermissions, permissionList } from './permissions';

describe('permissionList', () => {
  it('accepts the Set that pdf.js 6 returns and the array of older versions', () => {
    expect(permissionList(new Set([4, 16]))).toEqual([4, 16]);
    expect(permissionList([4, 2048])).toEqual([4, 2048]);
  });

  it('treats anything else as unrestricted', () => {
    expect(permissionList(null)).toBeNull();
    expect(permissionList(undefined)).toBeNull();
    expect(permissionList({ 4: true })).toBeNull();
  });
});

describe('describePermissions', () => {
  it('lists allowed actions in a stable order', () => {
    expect(describePermissions([16, 4])).toBe('Print, Copy text and images');
    expect(describePermissions([])).toBe('Nothing');
  });
});
