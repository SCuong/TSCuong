import { useEffect, useRef, useState } from 'react';
import { CopyPlus, Lock, LockOpen, Pencil, Plus, Trash } from 'lucide-react';
import { Dialog, ConfirmDialog } from '@/components/ui/Dialog';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/Feedback';
import { newId } from '@/lib/storage/db';
import { cn } from '@/lib/utils';
import { toast } from '@/components/ui/Toast';
import { rowId, type ApiEnvironment, type EnvVariable, type KeyValue } from '../lib/model';
import { environmentsDb } from '../lib/store';
import { buildScope } from '../lib/vars';
import { KeyValueEditor } from './KeyValueEditor';
import { InlineRename, RowMenu } from './bits';

/** Create, rename, duplicate, delete and edit environments. Edits are saved automatically. */
export function EnvironmentDialog({
  open,
  onClose,
  environments,
  activeId,
  onActivate,
}: {
  open: boolean;
  onClose: () => void;
  environments: ApiEnvironment[];
  activeId: string | null;
  onActivate: (id: string | null) => void;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<ApiEnvironment | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<ApiEnvironment | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pending = useRef<ApiEnvironment | null>(null);
  const sorted = [...environments].sort((a, b) => a.name.localeCompare(b.name));

  const flush = () => {
    clearTimeout(timer.current);
    if (pending.current) {
      const env = pending.current;
      pending.current = null;
      environmentsDb.put(env).catch(() => toast('Could not save the environment.', 'error'));
    }
  };

  // Pick an environment to show when the dialog opens.
  useEffect(() => {
    if (!open) return;
    const initial = environments.find((e) => e.id === activeId) ?? environments[0] ?? null;
    setSelectedId(initial?.id ?? null);
    setDraft(initial ? structuredClone(initial) : null);
    // Only when opening.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Save pending edits when the component unmounts.
  useEffect(() => {
    const t = timer;
    const p = pending;
    return () => {
      clearTimeout(t.current);
      if (p.current) void environmentsDb.put(p.current);
    };
  }, []);

  const select = (env: ApiEnvironment) => {
    flush();
    setSelectedId(env.id);
    setDraft(structuredClone(env));
  };

  const edit = (next: ApiEnvironment) => {
    const stamped = { ...next, updatedAt: Date.now() };
    setDraft(stamped);
    pending.current = stamped;
    clearTimeout(timer.current);
    timer.current = setTimeout(flush, 350);
  };

  async function create(copyOf?: ApiEnvironment) {
    flush();
    const now = Date.now();
    const env: ApiEnvironment = copyOf
      ? { ...structuredClone(copyOf), id: newId(), name: `${copyOf.name} copy`, createdAt: now, updatedAt: now }
      : { id: newId(), name: environments.length ? `Environment ${environments.length + 1}` : 'Development', variables: [], createdAt: now, updatedAt: now };
    if (copyOf) env.variables = env.variables.map((v) => ({ ...v, id: rowId() }));
    await environmentsDb.put(env);
    setSelectedId(env.id);
    setDraft(env);
    if (!copyOf) setRenaming(env.id);
  }

  async function remove(env: ApiEnvironment) {
    if (pending.current?.id === env.id) {
      clearTimeout(timer.current);
      pending.current = null;
    }
    await environmentsDb.remove(env.id);
    if (activeId === env.id) onActivate(null);
    const rest = sorted.filter((e) => e.id !== env.id);
    setSelectedId(rest[0]?.id ?? null);
    setDraft(rest[0] ? structuredClone(rest[0]) : null);
    setConfirmDelete(null);
  }

  const shadowed = draft ? buildScope(draft.variables) : new Map<string, string>();

  return (
    <>
      <Dialog
        open={open}
        onClose={() => {
          flush();
          onClose();
        }}
        size="lg"
        title="Environments"
        description="Variables used as {{name}} in URLs, params, headers, bodies and auth. Environment values override collection variables."
        footer={
          <Button
            variant="primary"
            onClick={() => {
              flush();
              onClose();
            }}
          >
            Done
          </Button>
        }
      >
        <div className="grid min-h-[340px] gap-4 md:grid-cols-[200px_minmax(0,1fr)]">
          <div className="flex min-w-0 flex-col gap-1">
            <Button size="sm" icon={Plus} onClick={() => void create()} className="mb-1 justify-start">
              New environment
            </Button>
            <ul className="flex flex-col gap-0.5" aria-label="Environments">
              {sorted.map((env) => (
                <li key={env.id} className="flex items-center gap-1">
                  {renaming === env.id ? (
                    <InlineRename
                      label="Environment name"
                      value={env.name}
                      onCancel={() => setRenaming(null)}
                      onCommit={(name) => {
                        setRenaming(null);
                        const base = selectedId === env.id && draft ? draft : env;
                        const next = { ...base, name, updatedAt: Date.now() };
                        if (selectedId === env.id) setDraft(next);
                        void environmentsDb.put(next);
                      }}
                    />
                  ) : (
                    <button
                      type="button"
                      onClick={() => select(env)}
                      aria-current={selectedId === env.id || undefined}
                      className={cn(
                        'flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md px-2 text-left text-[13px]',
                        selectedId === env.id ? 'bg-accent-soft text-fg' : 'text-fg-secondary hover:bg-surface-hover hover:text-fg',
                      )}
                    >
                      <span className="truncate">{env.name}</span>
                      {activeId === env.id && <span className="ml-auto shrink-0 text-[11px] font-medium text-accent-text">Active</span>}
                    </button>
                  )}
                  <RowMenu
                    label={`Actions for ${env.name}`}
                    items={[
                      { label: activeId === env.id ? 'Deactivate' : 'Make active', onSelect: () => onActivate(activeId === env.id ? null : env.id) },
                      { label: 'Rename', icon: Pencil, onSelect: () => setRenaming(env.id) },
                      { label: 'Duplicate', icon: CopyPlus, onSelect: () => void create(env) },
                      { label: 'Delete', icon: Trash, danger: true, onSelect: () => setConfirmDelete(env) },
                    ]}
                  />
                </li>
              ))}
            </ul>
          </div>
          <div className="min-w-0">
            {draft ? (
              <>
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <h3 className="truncate text-[14px] font-semibold">{draft.name}</h3>
                  {activeId !== draft.id ? (
                    <Button size="sm" onClick={() => onActivate(draft.id)}>
                      Make active
                    </Button>
                  ) : (
                    <span className="text-[12.5px] text-accent-text">Active environment</span>
                  )}
                </div>
                <KeyValueEditor<EnvVariable>
                  label={`Variables of ${draft.name}`}
                  rows={draft.variables}
                  onChange={(variables) => edit({ ...draft, variables })}
                  makeRow={(r: KeyValue) => ({ ...r, secret: false })}
                  scope={shadowed}
                  keyLabel="Variable"
                  keyPlaceholder="name"
                  extraWidth="28px"
                  renderValue={(row, update) =>
                    row.secret ? (
                      <input
                        type="password"
                        value={row.value}
                        onChange={(e) => update({ value: e.target.value })}
                        aria-label={`Secret value of ${row.key}`}
                        autoComplete="off"
                        className="h-8 w-full min-w-0 rounded-md border border-transparent bg-transparent px-2 font-mono text-[13px] outline-none hover:border-line focus:border-accent focus:bg-surface-sunken"
                      />
                    ) : undefined
                  }
                  renderExtra={(row, update) => (
                    <button
                      type="button"
                      onClick={() => update({ secret: !row.secret })}
                      aria-pressed={row.secret}
                      aria-label={row.secret ? `Unmark ${row.key || 'variable'} as secret` : `Mark ${row.key || 'variable'} as secret`}
                      title={row.secret ? 'Secret: masked, left out of exports unless you include secrets' : 'Mark as secret'}
                      className={cn(
                        'inline-flex size-7 items-center justify-center rounded-md hover:bg-surface-hover',
                        row.secret ? 'text-accent-text' : 'text-fg-muted',
                      )}
                    >
                      {row.secret ? <Lock size={14} aria-hidden /> : <LockOpen size={14} aria-hidden />}
                    </button>
                  )}
                />
                <p className="mt-3 text-[12.5px] text-fg-muted">
                  Values are stored unencrypted in this browser. Secret values are masked and left out of exports unless you choose to include secrets.
                </p>
              </>
            ) : (
              <EmptyState title="No environments yet" action={<Button size="sm" icon={Plus} onClick={() => void create()}>Create one</Button>}>
                Keep values like base URLs and tokens in an environment and switch between dev, staging and production.
              </EmptyState>
            )}
          </div>
        </div>
      </Dialog>
      <ConfirmDialog
        open={confirmDelete !== null}
        onCancel={() => setConfirmDelete(null)}
        onConfirm={() => confirmDelete && void remove(confirmDelete)}
        title="Delete environment?"
      >
        “{confirmDelete?.name}” and its {confirmDelete?.variables.length ?? 0} variables will be removed from this browser.
      </ConfirmDialog>
    </>
  );
}
