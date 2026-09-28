import { useEffect, useRef, useState } from 'react';
import { DatabaseBackup, Download, HardDrive, Trash, Upload } from 'lucide-react';
import { Panel } from '@/components/ui/Panel';
import { Button } from '@/components/ui/Button';
import { Switch } from '@/components/ui/Field';
import { Alert } from '@/components/ui/Alert';
import { ConfirmDialog, Dialog } from '@/components/ui/Dialog';
import { Segmented } from '@/components/ui/Segmented';
import { toast } from '@/components/ui/Toast';
import { settingsStore, useSettings } from '@/lib/userPrefs';
import { clearAllData, createBackup, parseBackup, restoreBackup, type Backup, type BackupSummary } from '@/lib/backup';
import { getStorageProblem } from '@/lib/storage/db';
import { downloadBlob, errorMessage, formatBytes } from '@/lib/utils';
import { ThemeSwitcher } from '../ThemeSwitcher';
import { useDocumentTitle } from '../useDocumentTitle';

const COLLECTION_LABELS: Record<string, string> = {
  notes: 'notes',
  snippets: 'snippets',
  apiRequests: 'saved API requests',
  apiCollections: 'API collections',
  apiEnvironments: 'API environments',
  apiHistory: 'API history entries',
  diagrams: 'diagrams',
};

export function SettingsPage() {
  useDocumentTitle('Settings');
  const settings = useSettings();
  const fileRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<{ backup: Backup; summary: BackupSummary } | null>(null);
  const [mode, setMode] = useState<'merge' | 'replace'>('merge');
  const [confirmClear, setConfirmClear] = useState(false);
  const [busy, setBusy] = useState(false);
  const [storage, setStorage] = useState<{ usage?: number; quota?: number; persisted?: boolean; problem?: string | null }>({});

  useEffect(() => {
    void (async () => {
      const problem = await getStorageProblem();
      const estimate = await navigator.storage?.estimate?.().catch(() => undefined);
      const persisted = await navigator.storage?.persisted?.().catch(() => undefined);
      setStorage({ usage: estimate?.usage, quota: estimate?.quota, persisted, problem });
    })();
  }, []);

  async function exportBackup() {
    setBusy(true);
    try {
      const backup = await createBackup();
      downloadBlob(JSON.stringify(backup, null, 2), `localkit-backup-${new Date().toISOString().slice(0, 10)}.json`, 'application/json');
      toast('Backup downloaded.');
    } catch (error) {
      toast(errorMessage(error, 'Could not create the backup.'), 'error');
    } finally {
      setBusy(false);
    }
  }

  async function onFile(file: File) {
    try {
      setPending(parseBackup(await file.text()));
    } catch (error) {
      toast(errorMessage(error), 'error', 5000);
    }
  }

  async function confirmRestore() {
    if (!pending) return;
    setBusy(true);
    try {
      await restoreBackup(pending.backup, mode);
      toast('Backup restored.');
      setPending(null);
    } catch (error) {
      toast(errorMessage(error, 'Could not restore the backup.'), 'error');
    } finally {
      setBusy(false);
    }
  }

  async function requestPersistence() {
    const granted = await navigator.storage?.persist?.().catch(() => false);
    setStorage((s) => ({ ...s, persisted: Boolean(granted) }));
    toast(granted ? 'Storage is now persistent.' : 'The browser declined persistent storage.', granted ? 'success' : 'info');
  }

  return (
    <div className="mx-auto max-w-3xl px-4 pt-8 pb-16 sm:px-6">
      <h1 className="text-[26px] font-semibold tracking-[-0.02em] text-fg">Settings</h1>
      <p className="mt-1 text-[14px] text-fg-secondary">Preferences and data are stored only in this browser.</p>

      <div className="mt-8 flex flex-col gap-4">
        <Panel title="Appearance">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-fg">Theme</p>
              <p className="text-[13px] text-fg-muted">System follows your operating system setting.</p>
            </div>
            <ThemeSwitcher withLabels />
          </div>
        </Panel>

        <Panel title="Behavior">
          <div className="flex flex-col gap-4">
            <Switch
              label="Remember input in simple tools between visits"
              checked={settings.rememberToolInput}
              onChange={(v) => settingsStore.set((s) => ({ ...s, rememberToolInput: v }))}
            />
            <Switch
              label="Keep a list of recent searches"
              checked={settings.recordSearchHistory}
              onChange={(v) => settingsStore.set((s) => ({ ...s, recordSearchHistory: v }))}
            />
          </div>
        </Panel>

        <Panel title="Backup & restore" description="Favorites, settings, notes, snippets, diagrams and API collections.">
          <div className="flex flex-wrap gap-2">
            <Button icon={Download} variant="primary" onClick={exportBackup} loading={busy}>
              Export backup
            </Button>
            <Button icon={Upload} onClick={() => fileRef.current?.click()}>
              Import backup…
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept="application/json,.json"
              className="sr-only"
              tabIndex={-1}
              aria-hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void onFile(f);
                e.target.value = '';
              }}
            />
          </div>
          <p className="mt-3 text-[12.5px] text-fg-muted">
            Backups are plain JSON files. Saved API requests may contain credentials if you chose to store them — keep backups private.
            Local file-search indexes are not included.
          </p>
        </Panel>

        <Panel title="Storage">
          {storage.problem && (
            <Alert tone="warning" className="mb-3" title="Data is not being saved">
              {storage.problem} Notes, snippets and other documents are kept only until you close this tab.
            </Alert>
          )}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <HardDrive size={18} className="text-fg-muted" aria-hidden />
              <div>
                <p className="text-sm text-fg">
                  {storage.usage !== undefined ? `${formatBytes(storage.usage)} used` : 'Usage unavailable'}
                  {storage.quota ? ` of ${formatBytes(storage.quota)} available` : ''}
                </p>
                <p className="text-[12.5px] text-fg-muted">
                  {storage.persisted
                    ? 'Persistent: the browser will not evict this data automatically.'
                    : 'Best-effort: the browser may clear data under storage pressure.'}
                </p>
              </div>
            </div>
            {!storage.persisted && 'persist' in (navigator.storage ?? {}) && (
              <Button size="sm" icon={DatabaseBackup} onClick={requestPersistence}>
                Make persistent
              </Button>
            )}
          </div>
        </Panel>

        <Panel title="Danger zone">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-[13px] text-fg-secondary">Delete all favorites, history, notes, snippets, diagrams and API data from this browser.</p>
            <Button variant="danger" icon={Trash} onClick={() => setConfirmClear(true)}>
              Delete all data
            </Button>
          </div>
        </Panel>
      </div>

      <Dialog
        open={pending !== null}
        onClose={() => setPending(null)}
        title="Restore backup"
        description={pending?.summary.createdAt ? `Created ${new Date(pending.summary.createdAt).toLocaleString()}` : undefined}
        footer={
          <>
            <Button variant="ghost" onClick={() => setPending(null)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={confirmRestore} loading={busy}>
              Restore
            </Button>
          </>
        }
      >
        {pending && (
          <div className="flex flex-col gap-4 text-sm">
            <ul className="list-disc pl-5 text-fg-secondary">
              <li>{pending.summary.settings} preference entries</li>
              {Object.entries(pending.summary.items).map(([name, count]) => (
                <li key={name}>
                  {count} {COLLECTION_LABELS[name] ?? name}
                </li>
              ))}
            </ul>
            <div>
              <p className="mb-2 font-medium text-fg">How should existing data be handled?</p>
              <Segmented
                label="Restore mode"
                value={mode}
                onChange={setMode}
                options={[
                  { value: 'merge', label: 'Merge with existing' },
                  { value: 'replace', label: 'Replace existing' },
                ]}
              />
            </div>
          </div>
        )}
      </Dialog>

      <ConfirmDialog
        open={confirmClear}
        title="Delete all local data?"
        confirmLabel="Delete everything"
        onCancel={() => setConfirmClear(false)}
        onConfirm={async () => {
          setConfirmClear(false);
          try {
            await clearAllData();
            toast('All local data deleted.');
          } catch (error) {
            toast(errorMessage(error), 'error');
          }
        }}
      >
        This cannot be undone. Export a backup first if you might need anything. Your theme choice is kept.
      </ConfirmDialog>
    </div>
  );
}
