import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { NotebookPen, Plus } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Alert } from '@/components/ui/Alert';
import { ConfirmDialog } from '@/components/ui/Dialog';
import { EmptyState, Spinner } from '@/components/ui/Feedback';
import { matchesAccept } from '@/components/ui/FileDrop';
import { toast } from '@/components/ui/Toast';
import { useDebouncedValue, useMediaQuery, useToolState } from '@/lib/hooks';
import { collection, kvGet, kvSet, newId, useCollection } from '@/lib/storage/db';
import { useTheme } from '@/lib/theme';
import { cn, errorMessage, formatBytes, pluralize } from '@/lib/utils';
import { renderMermaid } from '../diagrams/lib/mermaid';
import { sizedSvg } from '../diagrams/lib/diagrams';
import { patchRecord } from '../diagrams/lib/store';
import type { DiagramRenderer } from './lib/enhance';
import {
  collectTags,
  copyTitle,
  createNoteIndex,
  deriveTitle,
  filterNotes,
  parseImportedMarkdown,
  sortNotes,
  UNTITLED,
  type Note,
  type NoteFilter,
  type NoteSort,
} from './lib/notes';
import { WELCOME_NOTE, WELCOME_TAGS } from './lib/welcome';
import { IMPORT_ACCEPT, NoteList } from './components/NoteList';
import { NoteEditor, type ViewMode } from './components/NoteEditor';
import './notes.css';

const TOOL = 'markdown-notes';
const store = collection<Note>('notes');
const SEEDED_KEY = 'notes:seeded';
const MAX_IMPORT_BYTES = 5 * 1024 * 1024;

const renderDiagram: DiagramRenderer = (source, theme) => renderMermaid(source, theme).then((svg) => sizedSvg(svg));

function newNote(init: Partial<Omit<Note, 'id' | 'createdAt' | 'updatedAt'>> = {}): Note {
  const now = Date.now();
  const content = init.content ?? '';
  return {
    title: deriveTitle(content),
    autoTitle: true,
    tags: [],
    favorite: false,
    ...init,
    content,
    id: newId(),
    createdAt: now,
    updatedAt: now,
  };
}

export default function MarkdownNotes() {
  const { items, loading, error: storeError } = useCollection(store);
  const [activeId, setActiveId] = useToolState(TOOL, 'active', '');
  const [sort, setSort] = useToolState<NoteSort>(TOOL, 'sort', 'updated');
  const [filter, setFilter] = useToolState<NoteFilter>(TOOL, 'filter', { kind: 'all' });
  const [mode, setMode] = useToolState<ViewMode>(TOOL, 'view', 'split');
  const [query, setQuery] = useState('');
  const [mobileView, setMobileView] = useState<'list' | 'note'>('list');
  const [confirmDelete, setConfirmDelete] = useState<Note | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const isDesktop = useMediaQuery('(min-width: 1024px)');
  const theme = useTheme().resolved === 'dark' ? 'dark' : 'default';

  // First run: one welcome note (only once, so deleting it keeps it deleted).
  const seeding = useRef(false);
  useEffect(() => {
    if (loading || items.length > 0 || seeding.current) return;
    seeding.current = true;
    void (async () => {
      if (await kvGet<boolean>(SEEDED_KEY)) return;
      await kvSet(SEEDED_KEY, true);
      const note = newNote({ content: WELCOME_NOTE, tags: WELCOME_TAGS });
      await store.put(note);
      setActiveId(note.id);
    })().catch(() => undefined);
  }, [loading, items.length, setActiveId]);

  const tags = useMemo(() => collectTags(items), [items]);
  // A tag filter for a tag that no longer exists falls back to "all".
  const effectiveFilter = useMemo<NoteFilter>(
    () => (filter.kind === 'tag' && !tags.some((t) => t.tag === filter.tag) ? { kind: 'all' } : filter),
    [filter, tags],
  );
  const debouncedQuery = useDebouncedValue(query, 120);
  const index = useMemo(() => createNoteIndex(items), [items]);
  const visible = useMemo(() => {
    const filtered = filterNotes(items, effectiveFilter);
    const hits = index.search(debouncedQuery);
    if (!hits) return sortNotes(filtered, sort);
    const allowed = new Map(filtered.map((n) => [n.id, n]));
    return hits.map((id) => allowed.get(id)).filter((n): n is Note => Boolean(n));
  }, [items, effectiveFilter, index, debouncedQuery, sort]);

  const active = items.find((n) => n.id === activeId) ?? (isDesktop ? sortNotes(items, 'updated')[0] : undefined);

  const create = useCallback(
    async (init: Parameters<typeof newNote>[0] = {}) => {
      const note = newNote(init);
      try {
        await store.put(note);
        setActiveId(note.id);
        setFocusId(note.id);
        setMobileView('note');
        return note;
      } catch (err) {
        toast(errorMessage(err, 'Could not create the note.'), 'error');
        return null;
      }
    },
    [setActiveId],
  );

  const createFromFilter = useCallback(() => {
    void create({ tags: filter.kind === 'tag' ? [filter.tag] : [] });
  }, [create, filter]);

  // Ctrl+Alt+N (Cmd+Option+N) creates a note. Ctrl+K stays with the command palette.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.altKey && !event.shiftKey && (event.key.toLowerCase() === 'n' || event.code === 'KeyN')) {
        event.preventDefault();
        createFromFilter();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [createFromFilter]);

  async function importFiles(files: File[]) {
    const accepted = files.filter((f) => matchesAccept(f, IMPORT_ACCEPT) || /\.(md|markdown|mdown|mkd|txt)$/i.test(f.name));
    const skipped: string[] = files.filter((f) => !accepted.includes(f)).map((f) => `${f.name} (not a Markdown file)`);
    const notes: Note[] = [];
    for (const file of accepted) {
      if (file.size > MAX_IMPORT_BYTES) {
        skipped.push(`${file.name} (larger than ${formatBytes(MAX_IMPORT_BYTES)})`);
        continue;
      }
      try {
        const text = await file.text();
        if (text.includes('\u0000')) {
          skipped.push(`${file.name} (binary file)`);
          continue;
        }
        const parsed = parseImportedMarkdown(file.name, text);
        const now = Date.now();
        notes.push({ id: newId(), ...parsed, favorite: false, createdAt: now, updatedAt: now + notes.length });
      } catch {
        skipped.push(`${file.name} (could not be read)`);
      }
    }
    if (notes.length) {
      try {
        await store.putMany(notes);
        setActiveId(notes[notes.length - 1].id);
        setMobileView('note');
        toast(`Imported ${pluralize(notes.length, 'note')}.`);
      } catch (err) {
        toast(errorMessage(err, 'Could not save the imported notes.'), 'error');
        return;
      }
    }
    if (skipped.length) toast(`Skipped ${skipped.join(', ')}.`, 'error', 6000);
  }

  async function toggleFavorite(note: Note) {
    try {
      await patchRecord(store, note.id, { favorite: !note.favorite });
    } catch (err) {
      toast(errorMessage(err, 'Could not update the note.'), 'error');
    }
  }

  async function remove(note: Note) {
    setConfirmDelete(null);
    try {
      await store.remove(note.id);
      const next = visible.find((n) => n.id !== note.id) ?? items.find((n) => n.id !== note.id);
      setActiveId(next?.id ?? '');
      if (!isDesktop) setMobileView('list');
      toast(`Deleted "${note.title}".`);
    } catch (err) {
      toast(errorMessage(err, 'Could not delete the note.'), 'error');
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center rounded-xl border border-line bg-surface py-20">
        <Spinner label="Loading notes…" />
      </div>
    );
  }

  const showList = isDesktop || mobileView === 'list' || !active;
  const showEditor = Boolean(active) && (isDesktop || mobileView === 'note');

  return (
    <div className="flex min-w-0 flex-col gap-3">
      {storeError && (
        <Alert tone="warning" title="Notes could not be read from browser storage" className="lk-notes-noprint">
          {storeError}
        </Alert>
      )}
      <div
        className={cn(
          'lk-notes-layout grid min-w-0 grid-cols-1 gap-4',
          'lg:h-[max(600px,calc(100dvh-210px))] lg:grid-cols-[minmax(250px,300px)_minmax(0,1fr)]',
        )}
      >
        {showList && (
          <NoteList
            notes={visible}
            total={items.length}
            favoritesCount={items.filter((n) => n.favorite).length}
            activeId={isDesktop ? active?.id : undefined}
            onSelect={(id) => {
              setActiveId(id);
              setMobileView('note');
            }}
            query={query}
            onQuery={setQuery}
            filter={effectiveFilter}
            onFilter={setFilter}
            sort={sort}
            onSort={setSort}
            tags={tags}
            onNew={createFromFilter}
            onImport={(files) => void importFiles(files)}
            onToggleFavorite={(n) => void toggleFavorite(n)}
            className={cn('lk-notes-noprint', isDesktop ? 'min-h-0' : 'h-[calc(100dvh-220px)] min-h-[440px]')}
          />
        )}
        {showEditor && active ? (
          <NoteEditor
            key={active.id}
            note={active}
            theme={theme}
            renderDiagram={renderDiagram}
            isDesktop={isDesktop}
            mode={mode}
            onMode={setMode}
            onBack={() => setMobileView('list')}
            onDuplicate={(draft) =>
              void create({
                content: draft.content,
                tags: draft.tags,
                title: copyTitle(draft.title, items.map((n) => n.title)),
                autoTitle: false,
              }).then((copy) => copy && toast(`Created "${copy.title}".`))
            }
            onDelete={() => setConfirmDelete(active)}
            onToggleFavorite={() => void toggleFavorite(active)}
            onSave={async (patch) => {
              const saved = await patchRecord(store, active.id, patch);
              if (!saved) throw new Error('This note no longer exists.');
            }}
            tagSuggestions={tags.map((t) => t.tag)}
            autoFocus={focusId === active.id}
          />
        ) : (
          isDesktop && (
            <div className="flex min-h-0 items-center justify-center rounded-xl border border-line bg-surface shadow-card">
              <EmptyState
                icon={NotebookPen}
                title="No notes yet"
                action={
                  <div className="flex flex-wrap justify-center gap-2">
                    <Button variant="primary" icon={Plus} onClick={createFromFilter}>
                      New note
                    </Button>
                  </div>
                }
              >
                Write in Markdown with a live preview. Notes are saved automatically in this browser and never uploaded. You can also
                import existing .md files from the list.
              </EmptyState>
            </div>
          )
        )}
      </div>
      <ConfirmDialog
        open={confirmDelete !== null}
        onCancel={() => setConfirmDelete(null)}
        onConfirm={() => confirmDelete && void remove(confirmDelete)}
        title="Delete note?"
      >
        “{confirmDelete?.title ?? UNTITLED}” will be permanently deleted from this browser. Export it first if you want to keep a copy.
      </ConfirmDialog>
    </div>
  );
}
