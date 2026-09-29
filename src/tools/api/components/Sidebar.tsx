import { useMemo, useState } from 'react';
import {
  Braces,
  ChevronDown,
  ChevronRight,
  Clock,
  CopyPlus,
  Download,
  Folder,
  FolderPlus,
  FolderInput,
  Pencil,
  Plus,
  Search,
  Star,
  StarOff,
  Trash,
} from 'lucide-react';
import { Button, IconButton } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/Dialog';
import { EmptyState } from '@/components/ui/Feedback';
import { newId } from '@/lib/storage/db';
import { useToolState } from '@/lib/hooks';
import { cn, formatDuration, modKey } from '@/lib/utils';
import { toast } from '@/components/ui/Toast';
import { cloneDraft, type ApiCollection, type HistoryEntry, type SavedRequest } from '../lib/model';
import { groupHistory } from '../lib/history';
import { collectionsDb, historyDb, requestsDb } from '../lib/store';
import { InlineRename, MethodLabel, RowMenu, StatusPill, TabStrip } from './bits';

type Confirm =
  | { kind: 'collection'; item: ApiCollection; count: number }
  | { kind: 'folder'; collection: ApiCollection; folderId: string; name: string; count: number }
  | { kind: 'request'; item: SavedRequest }
  | { kind: 'history' };

export interface SidebarProps {
  collections: ApiCollection[];
  requests: SavedRequest[];
  history: HistoryEntry[];
  activeRequestId: string | null;
  onOpenRequest: (req: SavedRequest) => void;
  onOpenHistory: (entry: HistoryEntry) => void;
  onNewRequest: () => void;
  onExample: () => void;
  onImport: () => void;
  onExport: (only: ApiCollection | null) => void;
  onEditVariables: (collection: ApiCollection) => void;
  /** Called after the active request was deleted. */
  onActiveDeleted: () => void;
  className?: string;
}

export function Sidebar(props: SidebarProps) {
  const { collections, requests, history, activeRequestId, onOpenRequest, onOpenHistory, className } = props;
  const [tab, setTab] = useToolState<'collections' | 'history'>('api-client', 'sidebarTab', 'collections');
  const [collapsed, setCollapsed] = useToolState<string[]>('api-client', 'collapsed', []);
  const [query, setQuery] = useState('');
  const [renaming, setRenaming] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<Confirm | null>(null);

  const q = query.trim().toLowerCase();
  const match = (r: { name?: string; url: string; method: string }) =>
    !q || `${r.method} ${r.name ?? ''} ${r.url}`.toLowerCase().includes(q);

  const sortedCollections = useMemo(() => [...collections].sort((a, b) => a.name.localeCompare(b.name)), [collections]);
  const favorites = requests.filter((r) => r.favorite && match(r)).sort((a, b) => a.name.localeCompare(b.name));
  const toggle = (id: string) => setCollapsed((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]));

  async function newCollection() {
    const now = Date.now();
    const c: ApiCollection = { id: newId(), name: 'New collection', folders: [], variables: [], createdAt: now, updatedAt: now };
    await collectionsDb.put(c);
    setRenaming(c.id);
  }

  async function addFolder(c: ApiCollection) {
    const folder = { id: newId(), name: 'New folder' };
    await collectionsDb.put({ ...c, folders: [...c.folders, folder], updatedAt: Date.now() });
    setCollapsed((list) => list.filter((x) => x !== c.id));
    setRenaming(folder.id);
  }

  async function duplicate(r: SavedRequest) {
    const now = Date.now();
    const copy: SavedRequest = { ...cloneDraft(r), name: `${r.name} copy`, id: newId(), collectionId: r.collectionId, folderId: r.folderId, favorite: false, createdAt: now, updatedAt: now };
    await requestsDb.put(copy);
    toast('Request duplicated.');
  }

  async function runConfirm(c: Confirm) {
    setConfirm(null);
    try {
      if (c.kind === 'collection') {
        const ids = requests.filter((r) => r.collectionId === c.item.id).map((r) => r.id);
        await requestsDb.removeMany(ids);
        await collectionsDb.remove(c.item.id);
        if (activeRequestId && ids.includes(activeRequestId)) props.onActiveDeleted();
      } else if (c.kind === 'folder') {
        const ids = requests.filter((r) => r.collectionId === c.collection.id && r.folderId === c.folderId).map((r) => r.id);
        await requestsDb.removeMany(ids);
        await collectionsDb.put({ ...c.collection, folders: c.collection.folders.filter((f) => f.id !== c.folderId), updatedAt: Date.now() });
        if (activeRequestId && ids.includes(activeRequestId)) props.onActiveDeleted();
      } else if (c.kind === 'request') {
        await requestsDb.remove(c.item.id);
        if (activeRequestId === c.item.id) props.onActiveDeleted();
      } else {
        await historyDb.clear();
      }
    } catch {
      toast('Could not delete. Local storage may be unavailable.', 'error');
    }
  }

  const requestRow = (r: SavedRequest, indent: number) => (
    <li key={r.id} className="group flex items-center gap-0.5 pr-1" style={{ paddingLeft: indent }}>
      {renaming === r.id ? (
        <InlineRename
          label="Request name"
          value={r.name}
          onCancel={() => setRenaming(null)}
          onCommit={(name) => {
            setRenaming(null);
            void requestsDb.put({ ...r, name, updatedAt: Date.now() });
          }}
        />
      ) : (
        <button
          type="button"
          onClick={() => onOpenRequest(r)}
          aria-current={activeRequestId === r.id || undefined}
          title={`${r.method} ${r.url}`}
          className={cn(
            'flex h-8 min-w-0 flex-1 items-center gap-1.5 rounded-md px-2 text-left text-[13px]',
            activeRequestId === r.id ? 'bg-accent-soft text-fg' : 'text-fg-secondary hover:bg-surface-hover hover:text-fg',
          )}
        >
          <MethodLabel method={r.method} />
          <span className="truncate">{r.name}</span>
          {r.favorite && <Star size={12} aria-label="Favorite" className="ml-auto shrink-0 fill-current text-warm" />}
        </button>
      )}
      <RowMenu
        label={`Actions for ${r.name}`}
        items={[
          { label: r.favorite ? 'Remove from favorites' : 'Add to favorites', icon: r.favorite ? StarOff : Star, onSelect: () => void requestsDb.put({ ...r, favorite: !r.favorite }) },
          { label: 'Rename', icon: Pencil, onSelect: () => setRenaming(r.id) },
          { label: 'Duplicate', icon: CopyPlus, onSelect: () => void duplicate(r) },
          { label: 'Delete', icon: Trash, danger: true, onSelect: () => setConfirm({ kind: 'request', item: r }) },
        ]}
      />
    </li>
  );

  const historyGroups = useMemo(() => groupHistory(history.filter((h) => match(h))), [history, q]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <aside aria-label="Collections and history" className={cn('flex min-h-0 min-w-0 flex-col rounded-xl border border-line bg-surface shadow-card', className)}>
      <div className="flex items-center gap-2 border-b border-line p-2">
        <Button size="sm" variant="primary" icon={Plus} onClick={props.onNewRequest} className="flex-1">
          New request
        </Button>
        <IconButton icon={FolderInput} label="Import collection, environment or curl" size="sm" variant="secondary" onClick={props.onImport} />
        <IconButton icon={Download} label="Export all" size="sm" variant="secondary" onClick={() => props.onExport(null)} />
      </div>
      <TabStrip
        label="Sidebar"
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'collections', label: 'Collections', badge: requests.length || undefined },
          { id: 'history', label: 'History', badge: history.length || undefined },
        ]}
      />
      <div className="relative px-2 pt-2">
        <Search size={14} aria-hidden className="pointer-events-none absolute top-1/2 left-4.5 mt-1 -translate-y-1/2 text-fg-muted" />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={tab === 'collections' ? 'Filter requests' : 'Filter history'}
          aria-label={tab === 'collections' ? 'Filter requests' : 'Filter history'}
          className="lk-field h-8 py-0 pl-8 text-[13px]"
        />
      </div>

      {tab === 'collections' ? (
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {favorites.length > 0 && (
            <section className="mb-2">
              <h3 className="px-2 pb-1 text-[11.5px] font-semibold tracking-wide text-fg-muted uppercase">Favorites</h3>
              <ul>{favorites.map((r) => requestRow(r, 0))}</ul>
            </section>
          )}
          {sortedCollections.length === 0 ? (
            <EmptyState
              icon={Braces}
              title="No saved requests"
              action={
                <div className="flex flex-col items-center gap-2">
                  <Button size="sm" onClick={props.onExample}>
                    Try an example request
                  </Button>
                  <Button size="sm" variant="ghost" icon={FolderPlus} onClick={() => void newCollection()}>
                    New collection
                  </Button>
                </div>
              }
            >
              Save requests with {modKey}+S, or import a Postman collection.
            </EmptyState>
          ) : (
            <ul className="flex flex-col gap-1">
              {sortedCollections.map((c) => {
                const inCollection = requests.filter((r) => r.collectionId === c.id);
                const visible = inCollection.filter(match);
                if (q && visible.length === 0 && !c.name.toLowerCase().includes(q)) return null;
                const open = !collapsed.includes(c.id) || Boolean(q);
                const root = visible.filter((r) => !r.folderId || !c.folders.some((f) => f.id === r.folderId)).sort((a, b) => a.name.localeCompare(b.name));
                return (
                  <li key={c.id}>
                    <div className="flex items-center gap-0.5 pr-1">
                      {renaming === c.id ? (
                        <InlineRename
                          label="Collection name"
                          value={c.name}
                          onCancel={() => setRenaming(null)}
                          onCommit={(name) => {
                            setRenaming(null);
                            void collectionsDb.put({ ...c, name, updatedAt: Date.now() });
                          }}
                        />
                      ) : (
                        <button
                          type="button"
                          onClick={() => toggle(c.id)}
                          aria-expanded={open}
                          className="flex h-8 min-w-0 flex-1 items-center gap-1.5 rounded-md px-1.5 text-left text-[13px] font-semibold text-fg hover:bg-surface-hover"
                        >
                          {open ? <ChevronDown size={14} aria-hidden className="shrink-0 text-fg-muted" /> : <ChevronRight size={14} aria-hidden className="shrink-0 text-fg-muted" />}
                          <span className="truncate">{c.name}</span>
                          <span className="ml-auto shrink-0 text-[11.5px] font-normal text-fg-muted tabular-nums">{inCollection.length}</span>
                        </button>
                      )}
                      <RowMenu
                        label={`Actions for collection ${c.name}`}
                        items={[
                          { label: 'Add folder', icon: FolderPlus, onSelect: () => void addFolder(c) },
                          { label: 'Rename', icon: Pencil, onSelect: () => setRenaming(c.id) },
                          { label: `Variables (${c.variables.length})`, icon: Braces, onSelect: () => props.onEditVariables(c) },
                          { label: 'Export', icon: Download, onSelect: () => props.onExport(c) },
                          { label: 'Delete', icon: Trash, danger: true, onSelect: () => setConfirm({ kind: 'collection', item: c, count: inCollection.length }) },
                        ]}
                      />
                    </div>
                    {open && (
                      <ul>
                        {[...c.folders]
                          .sort((a, b) => a.name.localeCompare(b.name))
                          .map((f) => {
                            const inFolder = visible.filter((r) => r.folderId === f.id).sort((a, b) => a.name.localeCompare(b.name));
                            if (q && inFolder.length === 0) return null;
                            const folderOpen = !collapsed.includes(f.id) || Boolean(q);
                            return (
                              <li key={f.id}>
                                <div className="flex items-center gap-0.5 pr-1 pl-3">
                                  {renaming === f.id ? (
                                    <InlineRename
                                      label="Folder name"
                                      value={f.name}
                                      onCancel={() => setRenaming(null)}
                                      onCommit={(name) => {
                                        setRenaming(null);
                                        void collectionsDb.put({ ...c, folders: c.folders.map((x) => (x.id === f.id ? { ...x, name } : x)), updatedAt: Date.now() });
                                      }}
                                    />
                                  ) : (
                                    <button
                                      type="button"
                                      onClick={() => toggle(f.id)}
                                      aria-expanded={folderOpen}
                                      className="flex h-8 min-w-0 flex-1 items-center gap-1.5 rounded-md px-1.5 text-left text-[13px] text-fg hover:bg-surface-hover"
                                    >
                                      {folderOpen ? <ChevronDown size={13} aria-hidden className="shrink-0 text-fg-muted" /> : <ChevronRight size={13} aria-hidden className="shrink-0 text-fg-muted" />}
                                      <Folder size={14} aria-hidden className="shrink-0 text-fg-muted" />
                                      <span className="truncate">{f.name}</span>
                                    </button>
                                  )}
                                  <RowMenu
                                    label={`Actions for folder ${f.name}`}
                                    items={[
                                      { label: 'Rename', icon: Pencil, onSelect: () => setRenaming(f.id) },
                                      {
                                        label: 'Delete',
                                        icon: Trash,
                                        danger: true,
                                        onSelect: () =>
                                          setConfirm({ kind: 'folder', collection: c, folderId: f.id, name: f.name, count: inCollection.filter((r) => r.folderId === f.id).length }),
                                      },
                                    ]}
                                  />
                                </div>
                                {folderOpen && (
                                  <ul>
                                    {inFolder.length === 0 ? (
                                      <li className="py-1 pl-12 text-[12.5px] text-fg-muted">Empty folder</li>
                                    ) : (
                                      inFolder.map((r) => requestRow(r, 28))
                                    )}
                                  </ul>
                                )}
                              </li>
                            );
                          })}
                        {root.map((r) => requestRow(r, 14))}
                        {inCollection.length === 0 && c.folders.length === 0 && <li className="py-1 pl-8 text-[12.5px] text-fg-muted">No requests yet</li>}
                      </ul>
                    )}
                  </li>
                );
              })}
              <li className="pt-1">
                <Button size="sm" variant="ghost" icon={FolderPlus} onClick={() => void newCollection()}>
                  New collection
                </Button>
              </li>
            </ul>
          )}
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            {history.length === 0 ? (
              <EmptyState icon={Clock} title="No history yet">
                Sent requests appear here. Auth settings and sensitive headers are never stored.
              </EmptyState>
            ) : historyGroups.length === 0 ? (
              <p className="py-6 text-center text-[13px] text-fg-muted">Nothing matches the filter.</p>
            ) : (
              historyGroups.map((g) => (
                <section key={g.label} className="mb-2">
                  <h3 className="px-2 pb-1 text-[11.5px] font-semibold tracking-wide text-fg-muted uppercase">{g.label}</h3>
                  <ul>
                    {g.entries.map((h) => (
                      <li key={h.id} className="flex items-center gap-0.5 pr-1">
                        <button
                          type="button"
                          onClick={() => onOpenHistory(h)}
                          title={`${h.method} ${h.url}
${new Date(h.at).toLocaleString()}${h.error ? `
${h.error}` : ''}`}
                          className="flex min-w-0 flex-1 flex-col gap-0.5 rounded-md px-2 py-1.5 text-left hover:bg-surface-hover"
                        >
                          <span className="flex w-full min-w-0 items-center gap-1.5">
                            <MethodLabel method={h.method} />
                            <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-fg">{splitHistoryUrl(h.url).path}</span>
                          </span>
                          <span className="flex w-full min-w-0 items-center gap-1.5 pl-[3.625rem] text-[11.5px] text-fg-muted">
                            {h.status !== null ? (
                              <StatusPill status={h.status} className="shrink-0 text-[11px]" />
                            ) : (
                              <span className="shrink-0 rounded-md bg-danger-soft px-1.5 text-[11px] font-medium text-danger">Failed</span>
                            )}
                            <span className="min-w-0 truncate">{splitHistoryUrl(h.url).host}</span>
                            {h.timeMs !== null && <span className="ml-auto shrink-0 tabular-nums">{formatDuration(h.timeMs)}</span>}
                          </span>
                        </button>
                        <IconButton icon={Trash} label="Remove from history" size="sm" onClick={() => void historyDb.remove(h.id)} />
                      </li>
                    ))}
                  </ul>
                </section>
              ))
            )}
          </div>
          {history.length > 0 && (
            <div className="flex items-center justify-between gap-2 border-t border-line px-3 py-2 text-[12px] text-fg-muted">
              <span>Last {history.length} of max 200</span>
              <Button size="sm" variant="ghost" icon={Trash} onClick={() => setConfirm({ kind: 'history' })}>
                Clear
              </Button>
            </div>
          )}
        </div>
      )}

      <ConfirmDialog
        open={confirm !== null}
        onCancel={() => setConfirm(null)}
        onConfirm={() => confirm && void runConfirm(confirm)}
        title={
          confirm?.kind === 'collection'
            ? 'Delete collection?'
            : confirm?.kind === 'folder'
              ? 'Delete folder?'
              : confirm?.kind === 'request'
                ? 'Delete request?'
                : 'Clear history?'
        }
        confirmLabel={confirm?.kind === 'history' ? 'Clear' : 'Delete'}
      >
        {confirm?.kind === 'collection' && `“${confirm.item.name}” and its ${confirm.count} saved request${confirm.count === 1 ? '' : 's'} will be deleted.`}
        {confirm?.kind === 'folder' && `“${confirm.name}” and the ${confirm.count} request${confirm.count === 1 ? '' : 's'} in it will be deleted.`}
        {confirm?.kind === 'request' && `“${confirm.item.name}” will be deleted.`}
        {confirm?.kind === 'history' && 'All history entries in this browser will be removed.'}
      </ConfirmDialog>
    </aside>
  );
}

/** "host" and "path?query" for compact history rows (falls back to the raw text for templates). */
function splitHistoryUrl(url: string): { host: string; path: string } {
  const m = /^(?:https?:\/\/)?([^/?#]*)(.*)$/i.exec(url.trim());
  if (!m) return { host: '', path: url };
  return { host: m[1], path: m[2] || '/' };
}
