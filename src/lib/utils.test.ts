import { describe, expect, it } from 'vitest';
import { cn, errorMessage } from './utils';

describe('cn', () => {
  it('skips falsy values', () => {
    expect(cn('a', false, null, undefined, '', 'b')).toBe('a b');
  });

  it('lets a later display utility override a base one', () => {
    expect(cn('inline-flex items-center', 'hidden md:inline-flex')).toBe('items-center hidden md:inline-flex');
  });

  it('resolves conflicts between LocalKit semantic color tokens', () => {
    expect(cn('text-fg-muted hover:text-fg', 'text-warm hover:text-warm')).toBe('text-warm hover:text-warm');
    expect(cn('bg-surface', 'bg-surface-raised')).toBe('bg-surface-raised');
    expect(cn('border-line', 'border-danger/60')).toBe('border-danger/60');
    expect(cn('text-accent-contrast', 'text-fg')).toBe('text-fg');
  });

  it('keeps utilities that target different properties', () => {
    expect(cn('text-[13px] text-fg-muted')).toBe('text-[13px] text-fg-muted');
    expect(cn('border border-line')).toBe('border border-line');
    expect(cn('p-2', 'px-4')).toBe('p-2 px-4');
    expect(cn('font-mono tabular-nums text-[12px]')).toBe('font-mono tabular-nums text-[12px]');
  });

  it('treats the custom shadow scale as box shadows', () => {
    expect(cn('shadow-card', 'shadow-none')).toBe('shadow-none');
    expect(cn('shadow-card', 'shadow-popover')).toBe('shadow-popover');
  });

  it('merges spacing and radius overrides', () => {
    expect(cn('rounded-lg px-3', 'rounded-xl px-0')).toBe('rounded-xl px-0');
  });

  it('leaves non-Tailwind classes untouched', () => {
    expect(cn('lk-field', 'w-48', 'lk-textarea')).toBe('lk-field w-48 lk-textarea');
  });
});

describe('errorMessage', () => {
  it('turns failed lazy loads into an actionable sentence without the module URL', () => {
    const chrome = new TypeError('Failed to fetch dynamically imported module: http://localhost:5173/assets/Tool-abc.js');
    const safari = new TypeError('Importing a module script failed.');
    const firefox = new TypeError('error loading dynamically imported module: http://x/y.js');
    for (const error of [chrome, safari, firefox]) {
      expect(errorMessage(error)).toBe('Part of LocalKit could not be loaded. Check your connection and reload the page.');
    }
  });

  it('does not relabel ordinary network failures', () => {
    expect(errorMessage(new TypeError('Failed to fetch'))).toBe('Failed to fetch');
  });

  it('maps out-of-memory style errors, including oversized strings', () => {
    expect(errorMessage(new RangeError('Invalid string length'))).toMatch(/too large to process/);
    expect(errorMessage(new RangeError('Array buffer allocation failed'))).toMatch(/too large to process/);
  });

  it('keeps cancellation and permission messages short', () => {
    expect(errorMessage(new DOMException('x', 'AbortError'))).toBe('The operation was cancelled.');
    expect(errorMessage(new DOMException('x', 'NotAllowedError'))).toBe('Permission was denied.');
  });
});
