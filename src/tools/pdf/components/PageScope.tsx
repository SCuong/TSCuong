import { useId, useMemo, useState } from 'react';
import { Segmented } from '@/components/ui/Segmented';
import { Input, Label } from '@/components/ui/Field';
import { Button } from '@/components/ui/Button';
import { pluralize } from '@/lib/utils';
import { formatPageList, parsePageRange } from '../lib/ranges';
import type { LoadedPdf } from './usePdfFile';
import { PageGrid, type GridItem } from './PageGrid';
import { t } from '@/lib/i18n';

export type ScopeMode = 'all' | 'range' | 'pick';

export const pageId = (index: number) => `p${index}`;

/** State for "which pages?" questions: all, a typed range, or a visual pick. Pages are 0-based. */
export function usePageScope(pageCount: number, initial: ScopeMode = 'all', initialRange = '') {
  const [mode, setMode] = useState<ScopeMode>(initial);
  const [range, setRange] = useState(initialRange);
  const [picked, setPicked] = useState<Set<string>>(() => new Set());

  const result = useMemo((): { pages: number[]; error: string | null } => {
    if (mode === 'all') return { pages: Array.from({ length: pageCount }, (_, i) => i), error: null };
    if (mode === 'range') {
      if (!range.trim()) return { pages: [], error: null };
      const r = parsePageRange(range, pageCount);
      return r.ok ? { pages: r.pages.map((p) => p - 1), error: null } : { pages: [], error: r.error };
    }
    const pages: number[] = [];
    for (let i = 0; i < pageCount; i++) if (picked.has(pageId(i))) pages.push(i);
    return { pages, error: null };
  }, [mode, range, picked, pageCount]);

  return { mode, setMode, range, setRange, picked, setPicked, pageCount, ...result };
}

export type PageScopeState = ReturnType<typeof usePageScope>;

/** Segmented "All / Range / Pick" control with the range input and quick picks. */
export function PageScopeControl({
  scope,
  label = 'Pages',
  modes = ['all', 'range', 'pick'],
  pickLabel = 'Select on pages',
}: {
  scope: PageScopeState;
  label?: string;
  modes?: ScopeMode[];
  pickLabel?: string;
}) {
  const id = useId();
  const names: Record<ScopeMode, string> = { all: 'All pages', range: 'Page range', pick: pickLabel };
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div>
        <Label>{label}</Label>
        <Segmented
          label={label}
          value={scope.mode}
          onChange={scope.setMode}
          options={modes.map((m) => ({ value: m, label: names[m] }))}
        />
      </div>
      {scope.mode === 'range' && (
        <div className="max-w-md">
          <Label htmlFor={id} className="sr-only">
            {t('Page range')}
          </Label>
          <Input
            id={id}
            value={scope.range}
            onChange={(e) => scope.setRange(e.target.value)}
            placeholder={t('e.g. 1-3, 5, 8-  or  odd, even, last')}
            aria-invalid={scope.error ? true : undefined}
            aria-describedby={`${id}-help`}
            mono
          />
          <p id={`${id}-help`} role={scope.error ? 'alert' : undefined} className={`mt-1.5 text-[12.5px] ${scope.error ? 'text-danger' : 'text-fg-muted'}`}>
            {scope.error ??
              (scope.range.trim()
                ? `${pluralize(scope.pages.length, t('page'), t('pages'))}: ${formatPageList(scope.pages.map((p) => p + 1))}`
                : t('Use commas and dashes. Also: all, odd, even, last, 5- (to the end).'))}
          </p>
        </div>
      )}
    </div>
  );
}

/** Quick selection buttons used with a visual page grid. */
export function QuickSelect({
  pageCount,
  selected,
  onChange,
}: {
  pageCount: number;
  selected: ReadonlySet<string>;
  onChange: (next: Set<string>) => void;
}) {
  const pick = (fn: (i: number) => boolean) => {
    const next = new Set<string>();
    for (let i = 0; i < pageCount; i++) if (fn(i)) next.add(pageId(i));
    onChange(next);
  };
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="mr-1 text-[12.5px] text-fg-muted">{t('{count} selected', { count: pluralize(selected.size, t('page'), t('pages')) })}</span>
      <Button size="sm" variant="ghost" onClick={() => pick(() => true)}>
        {t('All')}
      </Button>
      <Button size="sm" variant="ghost" onClick={() => pick((i) => i % 2 === 0)}>
        {t('Odd')}
      </Button>
      <Button size="sm" variant="ghost" onClick={() => pick((i) => i % 2 === 1)}>
        {t('Even')}
      </Button>
      <Button size="sm" variant="ghost" onClick={() => pick((i) => !selected.has(pageId(i)))}>
        {t('Invert')}
      </Button>
      <Button size="sm" variant="ghost" disabled={selected.size === 0} onClick={() => onChange(new Set())}>
        {t('None')}
      </Button>
    </div>
  );
}

/** A visual picker for all pages of a document. */
export function PagePicker({
  pdf,
  selected,
  onChange,
  rotation,
  removed,
}: {
  pdf: LoadedPdf;
  selected: ReadonlySet<string>;
  onChange: (next: Set<string>) => void;
  /** Extra rotation per 0-based page to preview. */
  rotation?: (index: number) => number;
  /** Pages rendered as "removed" (e.g. delete preview). */
  removed?: (index: number) => boolean;
}) {
  const items = useMemo<GridItem[]>(
    () =>
      Array.from({ length: pdf.pageCount }, (_, i) => ({
        id: pageId(i),
        doc: pdf.doc,
        pageIndex: i,
        rotation: rotation?.(i) ?? 0,
        label: t('Page {i}', { i: i + 1 }),
        state: removed?.(i) ? 'removed' : 'normal',
      })),
    [pdf, rotation, removed],
  );
  return (
    <div className="flex flex-col gap-3">
      <QuickSelect pageCount={pdf.pageCount} selected={selected} onChange={onChange} />
      <PageGrid items={items} ariaLabel={t('Pages')} selected={selected} onSelectionChange={onChange} />
    </div>
  );
}
