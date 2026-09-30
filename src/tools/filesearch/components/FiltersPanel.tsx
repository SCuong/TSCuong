import { useState } from 'react';
import { FunnelX } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input, Label, NumberInput } from '@/components/ui/Field';
import { cn, formatNumber } from '@/lib/utils';
import { hasActiveFilters, parseDateInput, type SearchFilters } from '../lib/query';

function toDateInput(ms: number | null): string {
  if (ms === null) return '';
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const KB = 1024;

export function FiltersPanel({
  filters,
  onChange,
  extensions,
}: {
  filters: SearchFilters;
  onChange: (next: SearchFilters) => void;
  extensions: Array<{ ext: string; count: number }>;
}) {
  const [showAll, setShowAll] = useState(false);
  // Chosen types always stay visible, even when they are beyond the first 30.
  const shown = showAll ? extensions : extensions.filter((e, i) => i < 30 || filters.exts.includes(e.ext));
  const set = (patch: Partial<SearchFilters>) => onChange({ ...filters, ...patch });

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-line bg-surface-sunken p-3">
      <fieldset>
        <legend className="mb-1.5 text-[13px] font-medium text-fg-secondary">File types</legend>
        <div className="flex flex-wrap gap-1.5">
          {shown.map(({ ext, count }) => {
            const active = filters.exts.includes(ext);
            return (
              <button
                key={ext || '(none)'}
                type="button"
                aria-pressed={active}
                onClick={() => set({ exts: active ? filters.exts.filter((e) => e !== ext) : [...filters.exts, ext] })}
                className={cn(
                  'inline-flex h-7 items-center gap-1.5 rounded-md border px-2 font-mono text-[12px] transition-colors',
                  active ? 'border-accent-line bg-accent-soft text-accent-text' : 'border-line-strong bg-surface-raised text-fg-secondary hover:text-fg',
                )}
              >
                {ext ? `.${ext}` : '(none)'}
                <span className="font-sans text-[11px] text-fg-muted tabular-nums">{formatNumber(count, 0)}</span>
              </button>
            );
          })}
          {(extensions.length > shown.length || showAll) && extensions.length > 30 && (
            <Button size="sm" variant="ghost" className="h-7" onClick={() => setShowAll((v) => !v)} aria-expanded={showAll}>
              {showAll ? 'Show fewer types' : `Show ${extensions.length - shown.length} more types`}
            </Button>
          )}
        </div>
      </fieldset>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div>
          <Label htmlFor="fs-min">Min size (KB)</Label>
          <NumberInput
            id="fs-min"
            min={0}
            value={filters.minSize === null ? '' : Math.round((filters.minSize / KB) * 100) / 100}
            onChange={(v) => set({ minSize: v === '' ? null : Math.max(0, v) * KB })}
            className="h-8 py-1 text-[13px]"
          />
        </div>
        <div>
          <Label htmlFor="fs-max">Max size (KB)</Label>
          <NumberInput
            id="fs-max"
            min={0}
            value={filters.maxSize === null ? '' : Math.round((filters.maxSize / KB) * 100) / 100}
            onChange={(v) => set({ maxSize: v === '' ? null : Math.max(0, v) * KB })}
            className="h-8 py-1 text-[13px]"
          />
        </div>
        <div>
          <Label htmlFor="fs-from">Modified from</Label>
          <Input
            id="fs-from"
            type="date"
            value={toDateInput(filters.modifiedFrom)}
            onChange={(e) => set({ modifiedFrom: parseDateInput(e.target.value) })}
            className="h-8 py-1 text-[13px]"
          />
        </div>
        <div>
          <Label htmlFor="fs-to">Modified to</Label>
          <Input
            id="fs-to"
            type="date"
            value={toDateInput(filters.modifiedTo)}
            onChange={(e) => set({ modifiedTo: parseDateInput(e.target.value, true) })}
            className="h-8 py-1 text-[13px]"
          />
        </div>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1 basis-56">
          <Label htmlFor="fs-path">Folder or path contains</Label>
          <Input
            id="fs-path"
            mono
            value={filters.pathContains}
            placeholder="e.g. src/components"
            onChange={(e) => set({ pathContains: e.target.value })}
            className="h-8 py-1"
          />
        </div>
        <Button
          size="sm"
          variant="ghost"
          icon={FunnelX}
          disabled={!hasActiveFilters(filters)}
          onClick={() => onChange({ exts: [], minSize: null, maxSize: null, modifiedFrom: null, modifiedTo: null, pathContains: '' })}
        >
          Clear filters
        </Button>
      </div>
    </div>
  );
}
