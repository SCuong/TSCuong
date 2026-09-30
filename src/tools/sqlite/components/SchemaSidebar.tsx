import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Eye, Key, Layers, ListTree, Search, Table2, Zap, type LucideIcon } from 'lucide-react';
import { Input, Switch } from '@/components/ui/Field';
import { Spinner } from '@/components/ui/Feedback';
import { cn, errorMessage, formatNumber } from '@/lib/utils';
import type { SchemaObject, SchemaType, TableDetails } from '../lib/protocol';

type DetailsMap = Record<string, TableDetails | { error: string } | 'loading'>;
const NO_DETAILS: DetailsMap = {};

const SECTIONS: Array<{ type: SchemaType; label: string; icon: LucideIcon }> = [
  { type: 'table', label: 'Tables', icon: Table2 },
  { type: 'view', label: 'Views', icon: Eye },
  { type: 'index', label: 'Indexes', icon: ListTree },
  { type: 'trigger', label: 'Triggers', icon: Zap },
];

export function SchemaSidebar({
  objects,
  selected,
  onSelect,
  loadDetails,
}: {
  objects: SchemaObject[];
  selected: string | null;
  onSelect: (object: SchemaObject) => void;
  loadDetails: (name: string) => Promise<TableDetails>;
}) {
  const [query, setQuery] = useState('');
  const [showInternal, setShowInternal] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  // Column lists are cached per schema snapshot: a new `objects` array (after CREATE/ALTER/DROP)
  // makes them stale, so the open ones are loaded again and answers for an old snapshot are ignored.
  const [details, setDetails] = useState<{ schema: SchemaObject[]; map: DetailsMap }>({ schema: objects, map: {} });
  const map = details.schema === objects ? details.map : NO_DETAILS;
  const hasInternal = objects.some((o) => o.internal);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return objects.filter((o) => (showInternal || !o.internal) && (!q || o.name.toLowerCase().includes(q) || o.tableName.toLowerCase().includes(q)));
  }, [objects, query, showInternal]);

  useEffect(() => {
    const missing = Object.keys(expanded).filter((name) => expanded[name] && map[name] === undefined && objects.some((o) => o.name === name));
    if (!missing.length) return;
    setDetails((d) => {
      const next: DetailsMap = { ...(d.schema === objects ? d.map : {}) };
      for (const name of missing) next[name] = 'loading';
      return { schema: objects, map: next };
    });
    const store = (name: string, value: DetailsMap[string]) =>
      setDetails((d) => (d.schema === objects ? { schema: objects, map: { ...d.map, [name]: value } } : d));
    for (const name of missing) {
      loadDetails(name).then(
        (result) => store(name, result),
        (error: unknown) => store(name, { error: errorMessage(error) }),
      );
    }
  }, [expanded, map, objects, loadDetails]);

  function toggle(o: SchemaObject) {
    setExpanded((e) => ({ ...e, [o.name]: !e[o.name] }));
  }

  return (
    <div className="flex flex-col">
      <div className="flex flex-col gap-2 border-b border-line p-3">
        <div className="relative">
          <Search size={14} className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-fg-muted" aria-hidden />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter schema…"
            aria-label="Filter schema objects"
            className="h-8 pl-8 text-[13px]"
          />
        </div>
        {hasInternal && <Switch label="Show internal objects" checked={showInternal} onChange={setShowInternal} className="text-[12.5px]" />}
      </div>
      <nav aria-label="Database schema" className="flex flex-col gap-1 p-2">
        {SECTIONS.map(({ type, label, icon: Icon }) => {
          const items = filtered.filter((o) => o.type === type);
          return (
            <div key={type} className="py-1">
              <h2 className="flex items-center gap-1.5 px-2 pb-1 text-[11.5px] font-semibold tracking-wide text-fg-muted uppercase">
                {label}
                <span className="font-normal">{items.length}</span>
              </h2>
              {items.length === 0 ? (
                <p className="px-2 text-[12.5px] text-fg-muted">{query ? 'No matches' : `No ${label.toLowerCase()}`}</p>
              ) : (
                <ul className="flex flex-col">
                  {items.map((o) => {
                    const expandable = o.type === 'table' || o.type === 'view';
                    const isOpen = expanded[o.name];
                    const d = map[o.name];
                    return (
                      <li key={`${o.type}:${o.name}`}>
                        <div
                          className={cn(
                            'group flex items-center rounded-md',
                            selected === o.name ? 'bg-accent-soft text-accent-text' : 'text-fg hover:bg-surface-hover',
                          )}
                        >
                          {expandable ? (
                            <button
                              type="button"
                              onClick={() => void toggle(o)}
                              aria-expanded={isOpen}
                              aria-label={`${isOpen ? 'Collapse' : 'Expand'} ${o.name} columns`}
                              className="flex size-7 shrink-0 items-center justify-center rounded-md text-fg-muted hover:text-fg"
                            >
                              {isOpen ? <ChevronDown size={14} aria-hidden /> : <ChevronRight size={14} aria-hidden />}
                            </button>
                          ) : (
                            <span className="size-7 shrink-0" />
                          )}
                          <button
                            type="button"
                            onClick={() => onSelect(o)}
                            aria-current={selected === o.name ? 'true' : undefined}
                            className="flex min-w-0 flex-1 items-center gap-2 py-1.5 pr-2 text-left text-[13px]"
                            title={o.type === 'index' || o.type === 'trigger' ? `${o.name} on ${o.tableName}` : o.name}
                          >
                            <Icon size={14} aria-hidden className="shrink-0 opacity-70" />
                            <span className="min-w-0 flex-1 truncate font-mono text-[12.5px]">{o.name}</span>
                            {o.type === 'table' && o.rows !== null && (
                              <span className="shrink-0 text-[11.5px] text-fg-muted tabular-nums">{formatNumber(o.rows, 0)}</span>
                            )}
                            {(o.type === 'index' || o.type === 'trigger') && (
                              <span className="max-w-[40%] shrink-0 truncate text-[11.5px] text-fg-muted">{o.tableName}</span>
                            )}
                          </button>
                        </div>
                        {expandable && isOpen && (
                          <div className="mb-1 ml-7 border-l border-line pl-2">
                            {d === 'loading' || d === undefined ? (
                              <Spinner size={13} label="Loading columns…" className="px-1 py-1" />
                            ) : 'error' in d ? (
                              <p className="px-1 py-1 text-[12px] text-danger">{d.error}</p>
                            ) : (
                              <ul className="py-0.5">
                                {d.columns.map((c) => (
                                  <li key={c.cid} className="flex items-center gap-1.5 px-1 py-0.5 text-[12px]">
                                    {c.pk > 0 ? (
                                      <Key size={11} className="shrink-0 text-warning" aria-label="Primary key" />
                                    ) : d.foreignKeys.some((f) => f.from === c.name) ? (
                                      <Layers size={11} className="shrink-0 text-accent-text" aria-label="Foreign key" />
                                    ) : (
                                      <span className="size-[11px] shrink-0" />
                                    )}
                                    <span className="min-w-0 truncate font-mono text-fg">{c.name}</span>
                                    <span className="ml-auto shrink-0 font-mono text-[11px] text-fg-muted uppercase">{c.type || 'any'}</span>
                                    {c.notNull && <span className="shrink-0 text-[10px] font-semibold text-fg-muted">NN</span>}
                                  </li>
                                ))}
                              </ul>
                            )}
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          );
        })}
      </nav>
    </div>
  );
}
