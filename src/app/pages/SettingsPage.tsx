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
import { LanguageSwitcher } from '../LanguageSwitcher';
import { useDocumentTitle } from '../useDocumentTitle';
import { t } from '@/lib/i18n';

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
  useDocumentTitle(t('Settings'));
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
      toast(t('Backup downloaded.'));
    } catch (error) {
      toast(errorMessage(error, t('Could not create the backup.')), 'error');
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
      toast(t('Backup restored.'));
      setPending(null);
    } catch (error) {
      toast(errorMessage(error, t('Could not restore the backup.')), 'error');
    } finally {
      setBusy(false);
    }
  }

  async function requestPersistence() {
    const granted = await navigator.storage?.persist?.().catch(() => false);
    setStorage((s) => ({ ...s, persisted: Boolean(granted) }));
    toast(granted ? t('Storage is now persistent.') : t('The browser declined persistent storage.'), granted ? 'success' : 'info');
  }

  return (
    <div className="mx-auto max-w-3xl px-4 pt-8 pb-16 sm:px-6">
      <h1 className="text-[26px] font-semibold tracking-[-0.02em] text-fg">{t('Settings')}</h1>
      <p className="mt-1 text-[14px] text-fg-secondary">{t('Preferences and data are stored only in this browser.')}</p>

      <div className="mt-8 flex flex-col gap-4">
        <Panel title={t('Appearance')}>
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-fg">{t('Theme')}</p>
                <p className="text-[13px] text-fg-muted">{t('System follows your operating system setting.')}</p>
              </div>
              <ThemeSwitcher withLabels />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-fg">{t('Language')}</p>
                <p className="text-[13px] text-fg-muted">{t('Changing the language reloads the page.')}</p>
              </div>
              <LanguageSwitcher />
            </div>
          </div>
        </Panel>

        <Panel title={t('Behavior')}>
          <div className="flex flex-col gap-4">
            <Switch
              label={t('Remember input in simple tools between visits')}
              checked={settings.rememberToolInput}
              onChange={(v) => settingsStore.set((s) => ({ ...s, rememberToolInput: v }))}
            />
            <Switch
              label={t('Keep a list of recent searches')}
              checked={settings.recordSearchHistory}
              onChange={(v) => settingsStore.set((s) => ({ ...s, recordSearchHistory: v }))}
            />
          </div>
        </Panel>

        <Panel title={t('Backup & restore')} description={t('Favorites, settings, notes, snippets, diagrams and API collections.')}>
          <div className="flex flex-wrap gap-2">
            <Button icon={Download} variant="primary" onClick={exportBackup} loading={busy}>
              {t('Export backup')}
            </Button>
            <Button icon={Upload} onClick={() => fileRef.current?.click()}>
              {t('Import backup…')}
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
            {t('Backups are plain JSON files. Saved API requests may contain credentials if you chose to store them — keep backups private. Local file-search indexes are not included.')}
          </p>
        </Panel>

        <Panel title={t('Storage')}>
          {storage.problem && (
            <Alert tone="warning" className="mb-3" title={t('Data is not being saved')}>
              {t('{problem} Notes, snippets and other documents are kept only until you close this tab.', { problem: t(storage.problem) })}
            </Alert>
          )}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <HardDrive size={18} className="text-fg-muted" aria-hidden />
              <div>
                <p className="text-sm text-fg">
                  {storage.usage === undefined
                    ? t('Usage unavailable')
                    : storage.quota
                      ? t('{used} used of {total} available', { used: formatBytes(storage.usage), total: formatBytes(storage.quota) })
                      : t('{used} used', { used: formatBytes(storage.usage) })}
                </p>
                <p className="text-[12.5px] text-fg-muted">
                  {storage.persisted
                    ? t('Persistent: the browser will not evict this data automatically.')
                    : t('Best-effort: the browser may clear data under storage pressure.')}
                </p>
              </div>
            </div>
            {!storage.persisted && 'persist' in (navigator.storage ?? {}) && (
              <Button size="sm" icon={DatabaseBackup} onClick={requestPersistence}>
                {t('Make persistent')}
              </Button>
            )}
          </div>
        </Panel>

        <Panel title={t('Danger zone')}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-[13px] text-fg-secondary">{t('Delete all favorites, history, notes, snippets, diagrams and API data from this browser.')}</p>
            <Button variant="danger" icon={Trash} onClick={() => setConfirmClear(true)}>
              {t('Delete all data')}
            </Button>
          </div>
        </Panel>
      </div>

      <Dialog
        open={pending !== null}
        onClose={() => setPending(null)}
        title={t('Restore backup')}
        description={pending?.summary.createdAt ? t('Created {value}', { value: new Date(pending.summary.createdAt).toLocaleString() }) : undefined}
        footer={
          <>
            <Button variant="ghost" onClick={() => setPending(null)}>
              {t('Cancel')}
            </Button>
            <Button variant="primary" onClick={confirmRestore} loading={busy}>
              {t('Restore')}
            </Button>
          </>
        }
      >
        {pending && (
          <div className="flex flex-col gap-4 text-sm">
            <ul className="list-disc pl-5 text-fg-secondary">
              <li>{t('{settings} preference entries', { settings: pending.summary.settings })}</li>
              {Object.entries(pending.summary.items).map(([name, count]) => (
                <li key={name}>
                  {count} {COLLECTION_LABELS[name] ?? name}
                </li>
              ))}
            </ul>
            <div>
              <p className="mb-2 font-medium text-fg">{t('How should existing data be handled?')}</p>
              <Segmented
                label={t('Restore mode')}
                value={mode}
                onChange={setMode}
                options={[
                  { value: 'merge', label: t('Merge with existing') },
                  { value: 'replace', label: t('Replace existing') },
                ]}
              />
            </div>
          </div>
        )}
      </Dialog>

      <ConfirmDialog
        open={confirmClear}
        title={t('Delete all local data?')}
        confirmLabel={t('Delete everything')}
        onCancel={() => setConfirmClear(false)}
        onConfirm={async () => {
          setConfirmClear(false);
          try {
            await clearAllData();
            toast(t('All local data deleted.'));
          } catch (error) {
            toast(errorMessage(error), 'error');
          }
        }}
      >
        {t('This cannot be undone. Export a backup first if you might need anything. Your theme and language choices are kept.')}
      </ConfirmDialog>
    </div>
  );
}
