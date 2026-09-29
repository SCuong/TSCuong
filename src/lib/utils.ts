import { extendTailwindMerge } from 'tailwind-merge';

/** Knows LocalKit's custom theme scales so e.g. `shadow-card` is merged as a box shadow, not a shadow color. */
const mergeClasses = extendTailwindMerge({
  extend: {
    theme: {
      shadow: ['card', 'raised', 'popover'],
    },
  },
});

/**
 * Join class names, skipping falsy values. Conflicting Tailwind utilities are
 * resolved in favour of the later one, so a component's `className` prop
 * reliably overrides its base classes (e.g. `hidden` over a base `inline-flex`).
 */
export function cn(...parts: unknown[]): string {
  return mergeClasses(parts.filter((p): p is string => typeof p === 'string' && p.length > 0).join(' '));
}

export function formatBytes(bytes: number, decimals = 1): string {
  if (!Number.isFinite(bytes)) return '—';
  const sign = bytes < 0 ? '-' : '';
  let value = Math.abs(bytes);
  if (value < 1024) return `${sign}${value} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let unit = -1;
  do {
    value /= 1024;
    unit++;
  } while (value >= 1024 && unit < units.length - 1);
  return `${sign}${value.toFixed(value >= 100 ? 0 : decimals)} ${units[unit]}`;
}

export function formatNumber(value: number, maximumFractionDigits = 2): string {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits }).format(value);
}

export function formatDuration(ms: number): string {
  if (ms < 1) return `${ms.toFixed(2)} ms`;
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)} s`;
}

/** Turn anything thrown into a short, user-facing sentence (no stack traces). */
export function errorMessage(error: unknown, fallback = 'Something went wrong.'): string {
  if (error instanceof DOMException && error.name === 'AbortError') return 'The operation was cancelled.';
  if (error instanceof DOMException && error.name === 'NotAllowedError') return 'Permission was denied.';
  if (error instanceof RangeError && /array buffer|allocation|memory/i.test(error.message)) {
    return 'The file is too large to process in this browser (out of memory).';
  }
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string' && error) return error;
  return fallback;
}

export function logDevError(context: string, error: unknown) {
  if (import.meta.env.DEV) console.error(`[LocalKit] ${context}`, error);
}

/** Trigger a download of a Blob or string without leaking the object URL. */
export function downloadBlob(data: Blob | string, filename: string, type = 'text/plain;charset=utf-8') {
  const blob = typeof data === 'string' ? new Blob([data], { type }) : data;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Fallback for insecure contexts / denied permission.
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

/** Replace the extension of a filename (or append one). */
export function withExtension(filename: string, ext: string): string {
  const clean = ext.startsWith('.') ? ext : `.${ext}`;
  const dot = filename.lastIndexOf('.');
  const base = dot > 0 ? filename.slice(0, dot) : filename;
  return `${base || 'file'}${clean}`;
}

export function baseName(filename: string): string {
  const dot = filename.lastIndexOf('.');
  return dot > 0 ? filename.slice(0, dot) : filename;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${formatNumber(count, 0)} ${count === 1 ? singular : plural}`;
}

export const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
export const modKey = isMac ? '⌘' : 'Ctrl';
