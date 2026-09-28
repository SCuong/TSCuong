import { useEffect, useMemo, useState } from 'react';
import { Panel, Badge } from '@/components/ui/Panel';
import { ToolStack } from '@/components/tool/EditorPanel';
import { CopyButton } from '@/components/ui/Actions';
import { cn } from '@/lib/utils';
import {
  CACHEABLE_BY_DEFAULT,
  HTTP_STATUSES,
  STATUS_CLASSES,
  filterStatuses,
  redirectMethodNote,
  statusClass,
  type StatusClass,
} from './lib/httpStatus';
import { FilterChips, NoMatches, RefList, RefRow, SearchBox } from './ref/ReferenceUI';

const CLASS_TONE: Record<StatusClass, string> = {
  '1xx': 'text-fg-secondary',
  '2xx': 'text-success',
  '3xx': 'text-accent-text',
  '4xx': 'text-warning',
  '5xx': 'text-danger',
};

function initialCode(): number | null {
  const m = /^#(\d{3})$/.exec(typeof location === 'undefined' ? '' : location.hash);
  return m ? Number(m[1]) : null;
}

export default function HttpStatusCodes() {
  const [query, setQuery] = useState(() => (initialCode() ? String(initialCode()) : ''));
  const [group, setGroup] = useState<StatusClass | 'all'>('all');
  const [open, setOpen] = useState<Set<number>>(() => new Set(initialCode() ? [initialCode()!] : []));

  const results = useMemo(() => filterStatuses(HTTP_STATUSES, { query, group }), [query, group]);
  const exact = /^\d{3}$/.test(query.trim()) ? Number(query.trim()) : null;

  // An exact code typed in the search box opens its details.
  useEffect(() => {
    if (exact !== null && HTTP_STATUSES.some((s) => s.code === exact)) {
      setOpen((prev) => (prev.has(exact) ? prev : new Set(prev).add(exact)));
    }
  }, [exact]);

  const toggle = (code: number) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: HTTP_STATUSES.length };
    for (const s of HTTP_STATUSES) c[statusClass(s.code)] = (c[statusClass(s.code)] ?? 0) + 1;
    return c;
  }, []);

  return (
    <ToolStack>
      <Panel bodyClassName="flex flex-col gap-3">
        <SearchBox
          value={query}
          onChange={setQuery}
          placeholder="Search by code or words, e.g. 404, redirect, rate limit"
          label="Search status codes"
          count={results.length}
          total={HTTP_STATUSES.length}
        />
        <FilterChips
          label="Status class"
          value={group}
          onChange={setGroup}
          options={[
            { value: 'all', label: 'All', count: counts.all },
            ...STATUS_CLASSES.map((c) => ({ value: c.id, label: `${c.id} ${c.name}`, count: counts[c.id] })),
          ]}
        />
      </Panel>

      <Panel bodyClassName="p-0">
        {results.length === 0 ? (
          <NoMatches
            onClear={() => {
              setQuery('');
              setGroup('all');
            }}
          />
        ) : (
          <RefList>
            {results.map((s) => {
              const cls = statusClass(s.code);
              const redirect = redirectMethodNote(s.code);
              return (
                <RefRow
                  key={s.code}
                  id={String(s.code)}
                  expanded={open.has(s.code)}
                  onToggle={() => toggle(s.code)}
                  summary={
                    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
                      <span className={cn('font-mono text-[15px] font-semibold tabular-nums', CLASS_TONE[cls])}>{s.code}</span>
                      <span className="text-[14px] font-medium text-fg">{s.name}</span>
                      {s.unofficial && <Badge tone="warning">Unofficial</Badge>}
                      {s.deprecated && <Badge>Reserved / obsolete</Badge>}
                      <span className="basis-full text-[13px] text-fg-muted">{s.summary}</span>
                    </div>
                  }
                >
                  <p className="text-fg">{s.details}</p>
                  {redirect && <p className="mt-2">{redirect}</p>}
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <Badge tone="neutral">{STATUS_CLASSES.find((c) => c.id === cls)?.name}</Badge>
                    {CACHEABLE_BY_DEFAULT.has(s.code) && <Badge tone="accent">Cacheable by default</Badge>}
                    <span className="text-[12.5px] text-fg-muted">{s.spec}</span>
                    <span className="ml-auto flex gap-1.5">
                      <CopyButton value={String(s.code)} label="Copy code" />
                      <CopyButton value={`${s.code} ${s.name}`} label="Copy line" />
                    </span>
                  </div>
                </RefRow>
              );
            })}
          </RefList>
        )}
      </Panel>
    </ToolStack>
  );
}
