import { useRef, useState, type DragEvent, type ReactNode } from 'react';
import { FileText, FileUp, Plus, Search, Star, X } from 'lucide-react';
import { Button, IconButton } from '@/components/ui/Button';
import { Input, Select } from '@/components/ui/Field';
import { Kbd } from '@/components/ui/Panel';
import { cn, formatNumber, pluralize } from '@/lib/utils';
import { formatRelativeTime, noteSnippet, type Note, type NoteFilter, type NoteSort } from '../lib/notes';

export const IMPORT_ACCEPT = '.md,.markdown,.mdown,.mkd,.txt,text/markdown,text/plain';

const SORT_LABELS: Record<NoteSort, string> = {
  updated: 'Last edited',
  created: 'Newest first',
  title: 'Title A–Z',
};

export function NoteList({
  notes,
  total,
  favoritesCount,
  activeId,
  onSelect,
  query,
  onQuery,
  filter,
  onFilter,
  sort,
  onSort,
  tags,
  onNew,
  onImport,
  onToggleFavorite,
  className,
}: {
  notes: Note[];
  total: number;
  favoritesCount: number;
  activeId: string | undefined;
  onSelect: (id: string) => void;
  query: string;
  onQuery: (q: string) => void;
  filter: NoteFilter;
  onFilter: (f: NoteFilter) => void;
  sort: NoteSort;
  onSort: (s: NoteSort) => void;
  tags: Array<{ tag: string; count: number }>;
  onNew: () => void;
  onImport: (files: File[]) => void;
  onToggleFavorite: (note: Note) => void;
  className?: string;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [dropping, setDropping] = useState(false);
  const filtered = query.trim() !== '' || filter.kind !== 'all';
  const now = Date.now();

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setDropping(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length) onImport(files);
  }

  return (
    <section
      aria-label="Notes"
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault();
          setDropping(true);
        }
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropping(false);
      }}
      onDrop={onDrop}
      className={cn(
        'relative flex min-h-0 min-w-0 flex-col rounded-xl border bg-surface shadow-card',
        dropping ? 'border-accent' : 'border-line',
        className,
      )}
    >
      <div className="flex flex-col gap-2 border-b border-line p-3">
        <div className="flex gap-2">
          <Button variant="primary" size="sm" icon={Plus} onClick={onNew} className="flex-1" title="New note (Ctrl+Alt+N)">
            New note
          </Button>
          <Button size="sm" icon={FileUp} onClick={() => fileInput.current?.click()} title="Import .md files">
            Import
          </Button>
          <input
            ref={fileInput}
            type="file"
            multiple
            accept={IMPORT_ACCEPT}
            className="sr-only"
            tabIndex={-1}
            aria-hidden
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              if (files.length) onImport(files);
              e.target.value = '';
            }}
          />
        </div>
        <div className="relative">
          <Search size={15} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-fg-muted" aria-hidden />
          <Input
            type="search"
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape' && query) {
                e.preventDefault();
                onQuery('');
              }
            }}
            placeholder="Search notes…"
            aria-label="Search notes"
            className="h-8 py-1 pr-3 pl-9 text-[13px]"
          />
        </div>
        <div className="flex items-center gap-2">
          <div role="group" aria-label="Show" className="flex min-w-0 flex-1 gap-1">
            <FilterChip active={filter.kind === 'all'} onClick={() => onFilter({ kind: 'all' })}>
              All <span className="text-fg-muted">{formatNumber(total, 0)}</span>
            </FilterChip>
            <FilterChip active={filter.kind === 'favorites'} onClick={() => onFilter({ kind: 'favorites' })}>
              <Star size={12} aria-hidden className={cn(filter.kind === 'favorites' && 'fill-current text-warm')} />
              Favorites <span className="text-fg-muted">{formatNumber(favoritesCount, 0)}</span>
            </FilterChip>
          </div>
          <Select
            value={sort}
            onChange={(e) => onSort(e.target.value as NoteSort)}
            aria-label="Sort notes"
            className="h-7 w-auto shrink-0 py-0 pr-7 pl-2 text-[12.5px]"
          >
            {(Object.keys(SORT_LABELS) as NoteSort[]).map((k) => (
              <option key={k} value={k}>
                {SORT_LABELS[k]}
              </option>
            ))}
          </Select>
        </div>
        {tags.length > 0 && (
          <div role="group" aria-label="Filter by tag" className="flex max-h-[76px] flex-wrap gap-1 overflow-y-auto">
            {tags.map(({ tag, count }) => {
              const active = filter.kind === 'tag' && filter.tag === tag;
              return (
                <button
                  key={tag}
                  type="button"
                  aria-pressed={active}
                  onClick={() => onFilter(active ? { kind: 'all' } : { kind: 'tag', tag })}
                  className={cn(
                    'inline-flex max-w-full items-center gap-1 rounded-md border px-1.5 py-px text-[12px] font-medium transition-colors',
                    active
                      ? 'border-accent-line bg-accent-soft text-accent-text'
                      : 'border-line bg-surface-hover text-fg-secondary hover:text-fg',
                  )}
                >
                  <span className="truncate">#{tag}</span>
                  <span className={active ? 'text-accent-text' : 'text-fg-muted'}>{count}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div className="flex items-center justify-between gap-2 px-4 pt-2 pb-1 text-[12px] text-fg-muted">
        <span aria-live="polite">{filtered ? `${formatNumber(notes.length, 0)} of ${pluralize(total, 'note')}` : pluralize(total, 'note')}</span>
        {filtered && (
          <button
            type="button"
            className="inline-flex items-center gap-1 font-medium text-accent-text hover:underline"
            onClick={() => {
              onQuery('');
              onFilter({ kind: 'all' });
            }}
          >
            <X size={12} aria-hidden />
            Clear filters
          </button>
        )}
      </div>

      <ul className="min-h-0 flex-1 overflow-y-auto px-2 pb-2" aria-label="Note list">
        {notes.map((note) => {
          const active = note.id === activeId;
          const snippet = noteSnippet(note.content, 90);
          return (
            <li key={note.id} className="group relative">
              <button
                type="button"
                onClick={() => onSelect(note.id)}
                aria-current={active ? 'true' : undefined}
                className={cn(
                  'flex w-full flex-col gap-0.5 rounded-lg px-2.5 py-2 pr-9 text-left transition-colors',
                  active ? 'bg-accent-soft ring-1 ring-accent-line' : 'hover:bg-surface-hover',
                )}
              >
                <span className={cn('truncate text-[13.5px] font-medium', active ? 'text-fg' : 'text-fg')}>{note.title}</span>
                {snippet && <span className="line-clamp-2 text-[12.5px] leading-snug text-fg-muted">{snippet}</span>}
                <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[11.5px] text-fg-muted">
                  <span className="shrink-0">{formatRelativeTime(note.updatedAt, now)}</span>
                  {note.tags.slice(0, 3).map((t) => (
                    <span key={t} className="truncate rounded bg-surface-hover px-1 text-fg-secondary">
                      #{t}
                    </span>
                  ))}
                </span>
              </button>
              <IconButton
                icon={Star}
                size="sm"
                label={note.favorite ? `Remove "${note.title}" from favorites` : `Add "${note.title}" to favorites`}
                aria-pressed={note.favorite}
                onClick={() => onToggleFavorite(note)}
                className={cn(
                  'absolute top-1.5 right-1.5',
                  note.favorite
                    ? 'text-warm hover:text-warm [&_svg]:fill-current'
                    : 'opacity-100 lg:opacity-0 lg:group-focus-within:opacity-100 lg:group-hover:opacity-100',
                )}
              />
            </li>
          );
        })}
        {notes.length === 0 && (
          <li className="flex flex-col items-center px-4 py-10 text-center">
            <FileText size={20} className="mb-2 text-fg-muted" aria-hidden />
            <p className="text-[13px] font-medium text-fg">{total === 0 ? 'No notes yet' : 'No matching notes'}</p>
            <p className="mt-1 text-[12.5px] text-fg-muted">
              {total === 0 ? 'Create a note or import Markdown files.' : 'Try another search or clear the filters.'}
            </p>
          </li>
        )}
      </ul>
      <div className="hidden flex-col gap-1 border-t border-line px-4 py-2 text-[11.5px] text-fg-muted lg:flex">
        <span className="flex items-center gap-1">
          <Kbd>Ctrl</Kbd>
          <Kbd>Alt</Kbd>
          <Kbd>N</Kbd>
          <span className="ml-1">New note</span>
        </span>
        <span>Drop .md files here to import them.</span>
      </div>
      {dropping && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-xl bg-accent-soft text-[13px] font-medium text-accent-text">
          Drop Markdown files to import
        </div>
      )}
    </section>
  );
}

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'inline-flex h-7 items-center gap-1 rounded-md px-2 text-[12.5px] font-medium whitespace-nowrap transition-colors',
        active ? 'bg-surface-raised text-fg shadow-card ring-1 ring-line-strong' : 'text-fg-muted hover:bg-surface-hover hover:text-fg',
      )}
    >
      {children}
    </button>
  );
}
