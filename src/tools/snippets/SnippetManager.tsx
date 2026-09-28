import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import {
  ArrowLeft,
  Copy,
  CopyPlus,
  Download,
  FileUp,
  Keyboard,
  LayoutTemplate,
  Library,
  Pencil,
  Plus,
  Save,
  Search,
  SquareCode,
  Star,
  Trash,
  X,
} from 'lucide-react';
import { Button, IconButton } from '@/components/ui/Button';
import { Input, Label, Select, Textarea } from '@/components/ui/Field';
import { Badge, Kbd } from '@/components/ui/Panel';
import { ErrorMessage, Alert } from '@/components/ui/Alert';
import { EmptyState, Spinner } from '@/components/ui/Feedback';
import { ConfirmDialog } from '@/components/ui/Dialog';
import { toast } from '@/components/ui/Toast';
import { CodeEditor } from '@/components/editor/CodeEditor';
import { collection, getStorageProblem, newId, useCollection } from '@/lib/storage/db';
import { useMediaQuery, useToolState } from '@/lib/hooks';
import { cn, copyText, downloadBlob, errorMessage, formatBytes, formatNumber, modKey, pluralize } from '@/lib/utils';
import { SNIPPET_LANGUAGES, getSnippetLanguage, snippetFileName, PLAIN_LANGUAGE_ID } from './lib/languages';
import {
  applyDraft,
  createSnippet,
  draftFromSnippet,
  draftsEqual,
  duplicateSnippet,
  emptyDraft,
  relativeTime,
  validateDraft,
  type Snippet,
  type SnippetDraft,
} from './lib/model';
import { SORT_LABELS, buildSearchIndex, languageCounts, searchSnippets, tagCounts, type SortKey } from './lib/search';
import { exportSnippets, parseImport, planImport, type ConflictStrategy } from './lib/io';
import { SNIPPET_TEMPLATES, type SnippetTemplate } from './lib/templates';
import { CodeBlock, useSnippetLanguage } from './components/HighlightedCode';
import { SnippetList, type SnippetListHandle } from './components/SnippetList';
import { TagInput } from './components/TagInput';
import { ImportDialog, ShortcutsDialog, TemplatesDialog, type PendingImport } from './components/Dialogs';

const TOOL = 'snippets';
const snippets = collection<Snippet>('snippets');
const MAX_IMPORT_FILE = 100 * 1024 * 1024;

interface EditState {
  mode: 'new' | 'edit';
  id: string | null;
  base: SnippetDraft;
  draft: SnippetDraft;
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

export default function SnippetManager() {
  const { items, loading, error } = useCollection(snippets);
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query);
  const [sort, setSort] = useToolState<SortKey>(TOOL, 'sort', 'updated');
  const [langFilter, setLangFilter] = useToolState<string>(TOOL, 'lang', '');
  const [tagFilter, setTagFilter] = useToolState<string>(TOOL, 'tag', '');
  const [favOnly, setFavOnly] = useToolState(TOOL, 'fav', false);
  const [lastLanguage, setLastLanguage] = useToolState(TOOL, 'lastLanguage', 'typescript');

  const [openId, setOpenId] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [editing, setEditing] = useState<EditState | null>(null);
  const [mobileDetail, setMobileDetail] = useState(false);
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Snippet | null>(null);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [pendingImport, setPendingImport] = useState<PendingImport | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [storageProblem, setStorageProblem] = useState<string | null>(null);

  const isDesktop = useMediaQuery('(min-width: 1024px)');
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<SnippetListHandle>(null);
  const importInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    void getStorageProblem().then((p) => {
      if (!cancelled) setStorageProblem(p);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const byId = useMemo(() => new Map(items.map((s) => [s.id, s])), [items]);
  const index = useMemo(() => buildSearchIndex(items), [items]);
  const langOptions = useMemo(() => languageCounts(items), [items]);
  const tagOptions = useMemo(() => tagCounts(items), [items]);
  const allTags = useMemo(() => tagOptions.map(([t]) => t), [tagOptions]);

  // Filters that point at values no longer present are ignored rather than showing an empty list.
  const effectiveLang = langFilter && langOptions.some(([l]) => l === langFilter) ? langFilter : '';
  const effectiveTag = tagFilter && tagOptions.some(([t]) => t === tagFilter) ? tagFilter : '';

  const hits = useMemo(
    () =>
      searchSnippets(index, deferredQuery, { language: effectiveLang || null, tag: effectiveTag || null, favorites: favOnly }, sort),
    [index, deferredQuery, effectiveLang, effectiveTag, favOnly, sort],
  );

  const openSnippet = openId ? byId.get(openId) ?? null : null;
  // On desktop the detail pane shows the first result until the user picks something.
  const shownSnippet = openSnippet ?? (isDesktop && !editing ? hits[0]?.snippet ?? null : null);
  const currentActiveId = activeId && hits.some((h) => h.snippet.id === activeId) ? activeId : shownSnippet?.id ?? null;
  const dirty = editing ? !draftsEqual(editing.base, editing.draft) : false;
  const showDetail = isDesktop || mobileDetail;
  const showList = isDesktop || !mobileDetail;

  // Warn before leaving the page with unsaved edits.
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  /** Run an action, asking first when it would discard unsaved edits. */
  const guard = useCallback(
    (action: () => void) => {
      if (dirty) setPendingAction(() => action);
      else action();
    },
    [dirty],
  );

  const open = useCallback(
    (id: string) => {
      if (editing && !dirty && editing.id === id) return;
      guard(() => {
        setEditing(null);
        setSaveError(null);
        setOpenId(id);
        setActiveId(id);
        setMobileDetail(true);
      });
    },
    [guard, editing, dirty],
  );

  const startNew = useCallback(
    (draft?: SnippetDraft) => {
      guard(() => {
        const base = draft ?? emptyDraft(lastLanguage);
        setEditing({ mode: 'new', id: null, base: emptyDraft(base.language), draft: base });
        setSaveError(null);
        setMobileDetail(true);
      });
    },
    [guard, lastLanguage],
  );

  const startEdit = useCallback((s: Snippet) => {
    const base = draftFromSnippet(s);
    setEditing({ mode: 'edit', id: s.id, base, draft: base });
    setOpenId(s.id);
    setSaveError(null);
    setMobileDetail(true);
  }, []);

  const cancelEdit = useCallback(() => {
    guard(() => {
      setEditing(null);
      setSaveError(null);
      if (!openId) setMobileDetail(false);
    });
  }, [guard, openId]);

  const save = useCallback(async () => {
    if (!editing) return;
    const problem = validateDraft(editing.draft);
    if (problem) {
      setSaveError(problem);
      return;
    }
    try {
      if (editing.mode === 'new') {
        const created = createSnippet(editing.draft, newId());
        await snippets.put(created);
        setOpenId(created.id);
        setActiveId(created.id);
        setLastLanguage(created.language);
        toast('Snippet created');
      } else {
        const current = editing.id ? byId.get(editing.id) : undefined;
        if (!current) {
          setSaveError('This snippet no longer exists (it may have been deleted in another tab).');
          return;
        }
        await snippets.put(applyDraft(current, editing.draft));
        toast('Snippet saved');
      }
      setEditing(null);
      setSaveError(null);
    } catch (err) {
      setSaveError(errorMessage(err, 'Could not save the snippet.'));
    }
  }, [editing, byId, setLastLanguage]);

  const copySnippet = useCallback(async (s: Snippet) => {
    if (!s.code) {
      toast('This snippet has no code to copy.', 'info');
      return;
    }
    if (!(await copyText(s.code))) {
      toast('Copy failed. Your browser blocked clipboard access.', 'error');
      return;
    }
    toast(`Copied “${s.title}”`);
    const latest = (await snippets.get(s.id)) ?? s;
    await snippets.put({ ...latest, copyCount: latest.copyCount + 1 }).catch(() => undefined);
  }, []);

  const toggleFavorite = useCallback(async (s: Snippet) => {
    await snippets.put({ ...s, favorite: !s.favorite }).catch((err: unknown) => toast(errorMessage(err), 'error'));
  }, []);

  const duplicate = useCallback(
    async (s: Snippet) => {
      const copy = duplicateSnippet(s, newId(), items.map((i) => i.title));
      await snippets.put(copy);
      setOpenId(copy.id);
      setActiveId(copy.id);
      toast('Snippet duplicated');
    },
    [items],
  );

  const confirmDelete = useCallback(async () => {
    const target = deleteTarget;
    if (!target) return;
    setDeleteTarget(null);
    const pos = hits.findIndex((h) => h.snippet.id === target.id);
    const next = hits[pos + 1] ?? hits[pos - 1];
    try {
      await snippets.remove(target.id);
      if (editing?.id === target.id) setEditing(null);
      if (openId === target.id || !openId) {
        setOpenId(isDesktop && next ? next.snippet.id : null);
        if (!isDesktop) setMobileDetail(false);
      }
      toast('Snippet deleted');
    } catch (err) {
      toast(errorMessage(err, 'Could not delete the snippet.'), 'error');
    }
  }, [deleteTarget, hits, editing, openId, isDesktop]);

  const addAllTemplates = useCallback(async () => {
    const now = Date.now();
    const existingTitles = new Set(items.map((s) => s.title));
    const toAdd = SNIPPET_TEMPLATES.filter((t) => !existingTitles.has(t.title)).map((t, i) =>
      createSnippet(t, newId(), now - i * 1000),
    );
    setTemplatesOpen(false);
    if (!toAdd.length) {
      toast('All templates are already in your library.', 'info');
      return;
    }
    await snippets.putMany(toAdd);
    toast(`Added ${pluralize(toAdd.length, 'template')}`);
  }, [items]);

  const applyTemplate = useCallback(
    (t: SnippetTemplate) => {
      setTemplatesOpen(false);
      startNew({ title: t.title, description: t.description, language: t.language, code: t.code, tags: [...t.tags] });
    },
    [startNew],
  );

  async function onImportFile(file: File) {
    if (file.size > MAX_IMPORT_FILE) {
      toast('That file is too large to import (limit 100 MB).', 'error');
      return;
    }
    try {
      const parsed = parseImport(await file.text(), newId);
      setPendingImport({ fileName: file.name, parsed });
    } catch (err) {
      toast(errorMessage(err, 'Could not read the file.'), 'error');
    }
  }

  async function confirmImport(strategy: ConflictStrategy) {
    if (!pendingImport) return;
    const plan = planImport(items, pendingImport.parsed.snippets, strategy, newId);
    setPendingImport(null);
    try {
      await snippets.putMany(plan.toPut);
      toast(`Imported ${pluralize(plan.toPut.length, 'snippet')}`);
    } catch (err) {
      toast(errorMessage(err, 'Import failed.'), 'error');
    }
  }

  function exportAll(list: Snippet[], label: string) {
    const stamp = new Date().toISOString().slice(0, 10);
    downloadBlob(exportSnippets(list), `snippets-${label}${stamp}.json`, 'application/json');
  }

  const moveActive = useCallback(
    (delta: number) => {
      if (!hits.length) return;
      const pos = hits.findIndex((h) => h.snippet.id === currentActiveId);
      const next = Math.min(hits.length - 1, Math.max(0, pos === -1 ? 0 : pos + delta));
      setActiveId(hits[next].snippet.id);
      listRef.current?.scrollToIndex(next);
    },
    [hits, currentActiveId],
  );

  // Global keyboard shortcuts.
  const handlers = useRef({ save, startNew, copySnippet, toggleFavorite, startEdit, cancelEdit, moveActive, open });
  handlers.current = { save, startNew, copySnippet, toggleFavorite, startEdit, cancelEdit, moveActive, open };
  const stateRef = useRef({ editing, shownSnippet, currentActiveId });
  stateRef.current = { editing, shownSnippet, currentActiveId };

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const h = handlers.current;
      const { editing: ed, shownSnippet: shown, currentActiveId: active } = stateRef.current;
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      const modalOpen = document.querySelector('dialog[open]') !== null;
      if (modalOpen) return;

      if (ed && mod && (key === 's' || key === 'enter')) {
        e.preventDefault();
        void h.save();
        return;
      }
      if ((mod && !e.shiftKey && key === 'n') || (e.altKey && !mod && key === 'n')) {
        e.preventDefault();
        h.startNew();
        return;
      }
      if (mod && e.shiftKey && key === 'c' && !ed && shown) {
        e.preventDefault();
        void h.copySnippet(shown);
        return;
      }
      if (isTypingTarget(e.target) || mod || e.altKey) return;

      if (e.key === 'Escape' && ed) {
        e.preventDefault();
        h.cancelEdit();
      } else if (e.key === '/') {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      } else if (e.key === '?') {
        e.preventDefault();
        setShortcutsOpen(true);
      } else if (ed) {
        return;
      } else if (key === 'n') {
        e.preventDefault();
        h.startNew();
      } else if (key === 'c' && shown) {
        e.preventDefault();
        void h.copySnippet(shown);
      } else if (key === 'e' && shown) {
        e.preventDefault();
        h.startEdit(shown);
      } else if (key === 'f' && shown) {
        e.preventDefault();
        void h.toggleFavorite(shown);
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        if (e.target instanceof HTMLElement && e.target.closest('[role="region"]')) return;
        e.preventDefault();
        h.moveActive(e.key === 'ArrowDown' ? 1 : -1);
      } else if (e.key === 'Enter' && active && !(e.target instanceof HTMLButtonElement)) {
        e.preventDefault();
        h.open(active);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  function onSearchKeyDown(e: ReactKeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      moveActive(e.key === 'ArrowDown' ? 1 : -1);
    } else if (e.key === 'Enter' && currentActiveId) {
      e.preventDefault();
      open(currentActiveId);
    } else if (e.key === 'Escape' && query) {
      e.preventDefault();
      setQuery('');
    }
  }

  const filtersActive = Boolean(effectiveLang || effectiveTag || favOnly || query);
  const empty = !loading && items.length === 0;

  const toolbar = (
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="primary" icon={Plus} onClick={() => startNew()} title={`New snippet (${modKey}+N)`}>
        New snippet
      </Button>
      <Button icon={LayoutTemplate} onClick={() => setTemplatesOpen(true)}>
        Templates
      </Button>
      <Button icon={FileUp} onClick={() => importInput.current?.click()}>
        Import
      </Button>
      <input
        ref={importInput}
        type="file"
        accept=".json,application/json"
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void onImportFile(file);
          e.target.value = '';
        }}
      />
      <Button icon={Download} disabled={items.length === 0} onClick={() => exportAll(items, '')}>
        Export all
      </Button>
      {filtersActive && hits.length > 0 && hits.length < items.length && (
        <Button variant="ghost" icon={Download} onClick={() => exportAll(hits.map((h) => h.snippet), 'filtered-')}>
          Export {hits.length} shown
        </Button>
      )}
      <IconButton icon={Keyboard} label="Keyboard shortcuts (?)" onClick={() => setShortcutsOpen(true)} className="ml-auto" />
    </div>
  );

  return (
    <div className="flex min-w-0 flex-col gap-3">
      {toolbar}
      {storageProblem && (
        <Alert tone="warning" title="Snippets are only kept in memory">
          {storageProblem} Export your snippets before closing this tab.
        </Alert>
      )}
      <ErrorMessage error={error} title="Could not load snippets" />

      {empty && !editing ? (
        <div className="rounded-xl border border-line bg-surface shadow-card">
          <EmptyState
            icon={SquareCode}
            title="Your snippet library is empty"
            action={
              <div className="flex flex-wrap justify-center gap-2">
                <Button variant="primary" icon={Plus} onClick={() => startNew()}>
                  Create your first snippet
                </Button>
                <Button icon={Library} onClick={() => void addAllTemplates()}>
                  Load {SNIPPET_TEMPLATES.length} starter templates
                </Button>
                <Button variant="ghost" icon={FileUp} onClick={() => importInput.current?.click()}>
                  Import JSON
                </Button>
              </div>
            }
          >
            Save reusable code with tags, search it instantly and copy it in one click. Everything stays in this browser.
          </EmptyState>
        </div>
      ) : (
        <div className="grid min-w-0 grid-cols-1 gap-4 lg:h-[max(620px,calc(100dvh-230px))] lg:grid-cols-[minmax(320px,400px)_minmax(0,1fr)]">
          {showList && (
            <section
              aria-label="Snippet list"
              className="flex h-[calc(100dvh-190px)] min-h-[460px] min-w-0 flex-col rounded-xl border border-line bg-surface shadow-card lg:h-auto lg:min-h-0"
            >
              <div className="flex flex-col gap-2 border-b border-line p-3">
                <div className="relative">
                  <Search size={15} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-fg-muted" aria-hidden />
                  <Input
                    ref={searchRef}
                    type="search"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={onSearchKeyDown}
                    placeholder="Search title, tags, code…"
                    aria-label="Search snippets"
                    className="pr-9 pl-9"
                  />
                  {!query && <Kbd className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2">/</Kbd>}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Select value={effectiveLang} onChange={(e) => setLangFilter(e.target.value)} aria-label="Filter by language" className="h-8 py-1 text-[13px]">
                    <option value="">All languages</option>
                    {langOptions.map(([id, n]) => (
                      <option key={id} value={id}>
                        {getSnippetLanguage(id).name} ({n})
                      </option>
                    ))}
                  </Select>
                  <Select value={effectiveTag} onChange={(e) => setTagFilter(e.target.value)} aria-label="Filter by tag" className="h-8 py-1 text-[13px]">
                    <option value="">All tags</option>
                    {tagOptions.map(([t, n]) => (
                      <option key={t} value={t}>
                        #{t} ({n})
                      </option>
                    ))}
                  </Select>
                </div>
                <div className="flex items-center gap-2">
                  <Select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} aria-label="Sort snippets" className="h-8 min-w-0 flex-1 py-1 text-[13px]">
                    {(Object.keys(SORT_LABELS) as SortKey[]).map((k) => (
                      <option key={k} value={k}>
                        {SORT_LABELS[k]}
                      </option>
                    ))}
                  </Select>
                  <Button
                    size="sm"
                    variant={favOnly ? 'subtle' : 'ghost'}
                    icon={Star}
                    aria-pressed={favOnly}
                    onClick={() => setFavOnly(!favOnly)}
                    className={cn(favOnly && 'text-warm [&_svg]:fill-current')}
                  >
                    Favorites
                  </Button>
                </div>
              </div>
              <div className="flex items-center justify-between gap-2 px-4 py-1.5 text-[12px] text-fg-muted">
                <span aria-live="polite">
                  {loading ? 'Loading…' : filtersActive ? `${formatNumber(hits.length, 0)} of ${pluralize(items.length, 'snippet')}` : pluralize(items.length, 'snippet')}
                </span>
                {filtersActive && (
                  <button
                    type="button"
                    className="font-medium text-accent-text hover:underline"
                    onClick={() => {
                      setQuery('');
                      setLangFilter('');
                      setTagFilter('');
                      setFavOnly(false);
                    }}
                  >
                    Clear filters
                  </button>
                )}
              </div>
              {loading ? (
                <div className="flex flex-1 items-center justify-center">
                  <Spinner label="Loading snippets…" />
                </div>
              ) : hits.length === 0 ? (
                <EmptyState icon={Search} title="No snippets match" className="flex-1">
                  Try another search, or use <code className="font-mono">lang:</code>, <code className="font-mono">tag:</code> and{' '}
                  <code className="font-mono">is:fav</code> qualifiers.
                </EmptyState>
              ) : (
                <SnippetList
                  ref={listRef}
                  hits={hits}
                  activeId={currentActiveId}
                  openId={editing?.mode === 'new' ? null : shownSnippet?.id ?? null}
                  onOpen={open}
                  className="flex-1 pt-0.5"
                />
              )}
            </section>
          )}

          {showDetail && (
            <section
              aria-label="Snippet details"
              className="flex min-h-[480px] min-w-0 flex-col rounded-xl border border-line bg-surface shadow-card lg:min-h-0"
            >
              {editing ? (
                <SnippetEditorPane
                  editing={editing}
                  onChange={(draft) => setEditing((prev) => (prev ? { ...prev, draft } : prev))}
                  onSave={() => void save()}
                  onCancel={cancelEdit}
                  onBack={isDesktop ? undefined : cancelEdit}
                  error={saveError}
                  tagSuggestions={allTags}
                  dirty={dirty}
                />
              ) : shownSnippet ? (
                <SnippetDetailPane
                  snippet={shownSnippet}
                  onBack={isDesktop ? undefined : () => setMobileDetail(false)}
                  onCopy={() => void copySnippet(shownSnippet)}
                  onEdit={() => startEdit(shownSnippet)}
                  onDuplicate={() => void duplicate(shownSnippet)}
                  onDelete={() => setDeleteTarget(shownSnippet)}
                  onFavorite={() => void toggleFavorite(shownSnippet)}
                  onTag={(tag) => {
                    setTagFilter(tag);
                    if (!isDesktop) setMobileDetail(false);
                  }}
                />
              ) : (
                <EmptyState icon={SquareCode} title="No snippet selected" className="flex-1">
                  {hits.length === 0 ? 'Nothing matches the current filters.' : 'Pick a snippet from the list.'}
                  {!isDesktop && (
                    <div className="mt-3">
                      <Button size="sm" icon={ArrowLeft} onClick={() => setMobileDetail(false)}>
                        Back to list
                      </Button>
                    </div>
                  )}
                </EmptyState>
              )}
            </section>
          )}
        </div>
      )}

      <ConfirmDialog
        open={pendingAction !== null}
        title="Discard unsaved changes?"
        confirmLabel="Discard changes"
        onCancel={() => setPendingAction(null)}
        onConfirm={() => {
          const action = pendingAction;
          setPendingAction(null);
          setEditing(null);
          action?.();
        }}
      >
        You have edits that are not saved yet. They will be lost.
      </ConfirmDialog>
      <ConfirmDialog
        open={deleteTarget !== null}
        title="Delete snippet?"
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => void confirmDelete()}
      >
        “{deleteTarget?.title}” will be permanently removed from this browser. Export first if you want a backup.
      </ConfirmDialog>
      <TemplatesDialog
        open={templatesOpen}
        onClose={() => setTemplatesOpen(false)}
        onUse={applyTemplate}
        onAddAll={() => void addAllTemplates()}
      />
      <ImportDialog
        pending={pendingImport}
        existing={items}
        onCancel={() => setPendingImport(null)}
        onConfirm={(s) => void confirmImport(s)}
      />
      <ShortcutsDialog open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
    </div>
  );
}

function SnippetDetailPane({
  snippet,
  onBack,
  onCopy,
  onEdit,
  onDuplicate,
  onDelete,
  onFavorite,
  onTag,
}: {
  snippet: Snippet;
  onBack?: () => void;
  onCopy: () => void;
  onEdit: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onFavorite: () => void;
  onTag: (tag: string) => void;
}) {
  const lang = getSnippetLanguage(snippet.language);
  const lineCount = snippet.code ? snippet.code.split('\n').length : 0;
  const now = Date.now();
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex flex-col gap-3 border-b border-line px-4 py-3 sm:px-5">
        <div className="flex items-start gap-2">
          {onBack && <IconButton icon={ArrowLeft} label="Back to list" onClick={onBack} className="-ml-1.5" />}
          <div className="min-w-0 flex-1">
            <h2 className="text-[17px] leading-snug font-semibold tracking-tight break-words text-fg">{snippet.title}</h2>
            <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] text-fg-muted">
              <Badge tone="accent">{lang.name}</Badge>
              <span>Updated {relativeTime(snippet.updatedAt, now)}</span>
              <span aria-hidden>·</span>
              <span>Created {relativeTime(snippet.createdAt, now)}</span>
              <span aria-hidden>·</span>
              <span>
                {pluralize(lineCount, 'line')}, {formatBytes(new Blob([snippet.code]).size)}
              </span>
              <span aria-hidden>·</span>
              <span>Copied {pluralize(snippet.copyCount, 'time')}</span>
            </p>
          </div>
          <IconButton
            icon={Star}
            label={snippet.favorite ? 'Remove from favorites (F)' : 'Add to favorites (F)'}
            aria-pressed={snippet.favorite}
            onClick={onFavorite}
            className={snippet.favorite ? 'text-warm hover:text-warm [&_svg]:fill-current' : undefined}
          />
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Button variant="primary" size="sm" icon={Copy} onClick={onCopy} disabled={!snippet.code} title={`Copy code (${modKey}+Shift+C)`}>
            Copy code
          </Button>
          <Button size="sm" icon={Pencil} onClick={onEdit} title="Edit (E)">
            Edit
          </Button>
          <Button size="sm" icon={CopyPlus} onClick={onDuplicate}>
            Duplicate
          </Button>
          <Button
            size="sm"
            icon={Download}
            onClick={() => downloadBlob(snippet.code, snippetFileName(snippet.title, snippet.language))}
            title={`Download as ${snippetFileName(snippet.title, snippet.language)}`}
          >
            .{lang.fileName ? lang.fileName : lang.ext}
          </Button>
          <Button size="sm" variant="ghost" icon={Trash} onClick={onDelete} className="text-danger hover:text-danger">
            Delete
          </Button>
        </div>
      </header>
      <div className="flex min-h-0 flex-1 flex-col gap-3 p-4 sm:px-5">
        {snippet.description && <p className="text-[13.5px] whitespace-pre-wrap text-fg-secondary">{snippet.description}</p>}
        {snippet.tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {snippet.tags.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => onTag(t)}
                title={`Show snippets tagged ${t}`}
                className="rounded-md border border-line bg-surface-hover px-1.5 py-px text-[12px] font-medium text-fg-secondary hover:border-accent-line hover:text-accent-text"
              >
                #{t}
              </button>
            ))}
          </div>
        )}
        <CodeBlock code={snippet.code} language={snippet.language} className="max-h-[70dvh] min-h-0 lg:max-h-none lg:flex-1" />
      </div>
    </div>
  );
}

function SnippetEditorPane({
  editing,
  onChange,
  onSave,
  onCancel,
  onBack,
  error,
  tagSuggestions,
  dirty,
}: {
  editing: EditState;
  onChange: (draft: SnippetDraft) => void;
  onSave: () => void;
  onCancel: () => void;
  onBack?: () => void;
  error: string | null;
  tagSuggestions: string[];
  dirty: boolean;
}) {
  const { draft } = editing;
  const lang = useSnippetLanguage(draft.language);
  const extensions = useMemo(() => (lang ? [lang.extension] : []), [lang]);
  const editorLanguage = getSnippetLanguage(draft.language).editor ?? 'plain';
  const set = (patch: Partial<SnippetDraft>) => onChange({ ...draft, ...patch });

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3 sm:px-5">
        {onBack && <IconButton icon={ArrowLeft} label="Back to list" onClick={onBack} className="-ml-1.5" />}
        <h2 className="min-w-0 flex-1 text-[15px] font-semibold tracking-tight text-fg">
          {editing.mode === 'new' ? 'New snippet' : 'Edit snippet'}
          {dirty && (
            <span className="ml-2 align-middle text-[12px] font-normal text-warning" role="status">
              Unsaved changes
            </span>
          )}
        </h2>
        <div className="flex items-center gap-1.5">
          <Button size="sm" variant="ghost" icon={X} onClick={onCancel} title="Cancel (Esc)">
            Cancel
          </Button>
          <Button size="sm" variant="primary" icon={Save} onClick={onSave} title={`Save (${modKey}+S)`}>
            Save
          </Button>
        </div>
      </header>
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4 sm:px-5">
        <ErrorMessage error={error} />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_200px]">
          <div>
            <Label htmlFor="snippet-title">Title</Label>
            <Input
              id="snippet-title"
              value={draft.title}
              onChange={(e) => set({ title: e.target.value })}
              placeholder="e.g. Debounce a function"
              maxLength={200}
              autoFocus={editing.mode === 'new'}
            />
          </div>
          <div>
            <Label htmlFor="snippet-language">Language</Label>
            <Select id="snippet-language" value={draft.language} onChange={(e) => set({ language: e.target.value })}>
              {SNIPPET_LANGUAGES.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </Select>
          </div>
        </div>
        <div>
          <Label htmlFor="snippet-description">Description</Label>
          <Textarea
            id="snippet-description"
            mono={false}
            rows={2}
            value={draft.description}
            onChange={(e) => set({ description: e.target.value })}
            placeholder="What it does, when to use it (optional)"
            className="resize-y"
          />
        </div>
        <div>
          <Label htmlFor="snippet-tags">Tags</Label>
          <TagInput id="snippet-tags" tags={draft.tags} onChange={(tags) => set({ tags })} suggestions={tagSuggestions} />
        </div>
        <div className="flex min-h-[320px] flex-1 flex-col">
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <span className="text-[13px] font-medium text-fg-secondary">Code</span>
            <span className="text-[12px] text-fg-muted">
              {draft.language === PLAIN_LANGUAGE_ID || (!getSnippetLanguage(draft.language).editor && !getSnippetLanguage(draft.language).legacy)
                ? 'No syntax highlighting'
                : `${getSnippetLanguage(draft.language).name} highlighting`}
            </span>
          </div>
          <CodeEditor
            value={draft.code}
            onChange={(code) => set({ code })}
            language={editorLanguage}
            extensions={extensions}
            ariaLabel="Snippet code"
            placeholder="Paste or type code…"
            lineWrapping={false}
            className="min-h-[320px] flex-1"
          />
        </div>
      </div>
    </div>
  );
}
