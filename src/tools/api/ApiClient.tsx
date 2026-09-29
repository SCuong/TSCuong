import { useCallback, useEffect, useMemo, useRef, useState, type ClipboardEvent } from 'react';
import { Braces, Code, Info, Layers, PlugZap, Save, Settings2, X } from 'lucide-react';
import { Button, IconButton } from '@/components/ui/Button';
import { Alert } from '@/components/ui/Alert';
import { ConfirmDialog } from '@/components/ui/Dialog';
import { Segmented } from '@/components/ui/Segmented';
import { Select } from '@/components/ui/Field';
import { toast } from '@/components/ui/Toast';
import { kvGet, kvSet, newId, useCollection } from '@/lib/storage/db';
import { useMediaQuery } from '@/lib/hooks';
import { cn, modKey } from '@/lib/utils';
import {
  cloneDraft,
  draftOf,
  draftsEqual,
  emptyDraft,
  findSecrets,
  kv,
  normalizeDraft,
  stripSecrets,
  type ApiCollection,
  type HistoryEntry,
  type RequestDraft,
  type SavedRequest,
} from './lib/model';
import { buildScope } from './lib/vars';
import { prepareRequest } from './lib/prepare';
import { sendRequest } from './lib/send';
import { explainFailure } from './lib/response';
import { historyOverflow, makeHistoryEntry } from './lib/history';
import { checkCompanion } from './lib/companion';
import { draftFromCurl, looksLikeCurl } from './lib/curlImport';
import { generateCode, toCodeRequest } from './lib/codegen';
import { withParamsFromUrl } from './lib/url';
import type { ImportResult } from './lib/exchange';
import {
  collectionsDb,
  environmentsDb,
  historyDb,
  loadSettings,
  requestsDb,
  saveSettings,
  SESSION_KEY,
  type ClientSettings,
} from './lib/store';
import { Sidebar } from './components/Sidebar';
import { RequestEditor } from './components/RequestEditor';
import { IdleShortcuts, ResponsePanel, type ResponseState } from './components/ResponsePanel';
import { EnvironmentDialog } from './components/EnvironmentDialog';
import { CodeDialog } from './components/CodeDialog';
import { ExportDialog, ImportDialog } from './components/ImportExport';
import { SaveDialog, SecretsDialog, type SaveTarget } from './components/SaveDialog';
import { CompanionDialog, StatusDot, companionLabel, type CompanionCheck } from './components/CompanionDialog';
import { CollectionVarsDialog } from './components/CollectionVarsDialog';

interface Session {
  draft: RequestDraft;
  savedId: string | null;
}

interface Notice {
  tone: 'info' | 'warning';
  title: string;
  items: string[];
}

const EXAMPLE_URL = 'https://httpbin.org/get?hello=world';

function exampleDraft(): RequestDraft {
  const d = emptyDraft();
  d.name = 'Example: httpbin.org GET';
  const { url, params } = withParamsFromUrl(EXAMPLE_URL);
  d.url = url;
  d.params = params;
  d.headers = [kv('Accept', 'application/json')];
  return d;
}

type MobileView = 'sidebar' | 'request' | 'response';

export default function ApiClient() {
  const { items: collections } = useCollection(collectionsDb);
  const { items: requests } = useCollection(requestsDb);
  const { items: environments } = useCollection(environmentsDb);
  const { items: history } = useCollection(historyDb);

  const [settings, setSettings] = useState<ClientSettings>(loadSettings);
  const updateSettings = useCallback((patch: Partial<ClientSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      saveSettings(next);
      return next;
    });
  }, []);

  const [draft, setDraft] = useState<RequestDraft>(emptyDraft);
  const [savedId, setSavedId] = useState<string | null>(null);
  /** What an unsaved draft is compared with for the dirty indicator (the request as it was loaded). */
  const [baseline, setBaseline] = useState<RequestDraft>(emptyDraft);
  const [restored, setRestored] = useState(false);
  const [response, setResponse] = useState<ResponseState>({ phase: 'idle' });
  const [prepError, setPrepError] = useState<string | null>(null);
  const [sendWarnings, setSendWarnings] = useState<string[]>([]);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [mobileView, setMobileView] = useState<MobileView>('request');
  const isDesktop = useMediaQuery('(min-width: 1024px)');

  // Dialogs
  const [envOpen, setEnvOpen] = useState(false);
  const [codeOpen, setCodeOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [exportScope, setExportScope] = useState<{ only: ApiCollection | null } | null>(null);
  const [saveOpen, setSaveOpen] = useState(false);
  const [secretsOpen, setSecretsOpen] = useState(false);
  const [companionOpen, setCompanionOpen] = useState(false);
  const [varsFor, setVarsFor] = useState<ApiCollection | null>(null);
  const [pendingLoad, setPendingLoad] = useState<(() => void) | null>(null);
  const acknowledgedSecrets = useRef(new Set<string>());

  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);

  // ------------------------------------------------------------ session
  useEffect(() => {
    let cancelled = false;
    kvGet<Session>(SESSION_KEY)
      .then((s) => {
        if (cancelled || !s) return;
        setDraft(normalizeDraft(s.draft));
        setSavedId(typeof s.savedId === 'string' ? s.savedId : null);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setRestored(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!restored) return;
    const t = setTimeout(() => void kvSet<Session>(SESSION_KEY, { draft, savedId }).catch(() => {}), 400);
    return () => clearTimeout(t);
  }, [draft, savedId, restored]);

  const saved = savedId ? (requests.find((r) => r.id === savedId) ?? null) : null;
  const savedCollection = saved ? (collections.find((c) => c.id === saved.collectionId) ?? null) : null;
  const activeEnv = environments.find((e) => e.id === settings.activeEnvId) ?? null;
  const scope = useMemo(() => buildScope(savedCollection?.variables, activeEnv?.variables), [savedCollection, activeEnv]);
  const dirty = !draftsEqual(draft, saved ?? baseline);

  // ------------------------------------------------------------ companion status
  const [companion, setCompanion] = useState<CompanionCheck>({ state: 'unknown' });
  const checkSeq = useRef(0);
  const runCheck = useCallback(() => {
    const seq = ++checkSeq.current;
    setCompanion({ state: 'checking' });
    void checkCompanion(settings.port, settings.token).then((status) => {
      if (seq === checkSeq.current) setCompanion(status);
    });
  }, [settings.port, settings.token]);

  useEffect(() => {
    if (settings.via !== 'companion' && !companionOpen) return;
    const t = setTimeout(runCheck, 300);
    return () => clearTimeout(t);
  }, [settings.via, companionOpen, runCheck]);

  // ------------------------------------------------------------ loading requests
  const guardedLoad = useCallback(
    (load: () => void) => {
      if (dirty) setPendingLoad(() => load);
      else load();
    },
    [dirty],
  );

  const load = useCallback((next: RequestDraft, id: string | null) => {
    controller.current?.abort();
    controller.current = null;
    setDraft(next);
    setBaseline(next);
    setSavedId(id);
    setResponse({ phase: 'idle' });
    setPrepError(null);
    setSendWarnings([]);
    setNotice(null);
    setMobileView('request');
  }, []);

  const openRequest = (req: SavedRequest) => {
    if (req.id === savedId) return setMobileView('request');
    guardedLoad(() => load(cloneDraft(req), req.id));
  };
  const openHistory = (entry: HistoryEntry) => guardedLoad(() => load(cloneDraft(normalizeDraft(entry.request)), null));
  const newRequest = () => guardedLoad(() => load(emptyDraft(), null));
  const loadExample = () =>
    guardedLoad(() => {
      load(exampleDraft(), null);
      setNotice({
        tone: 'info',
        title: 'Example request to httpbin.org',
        items: ['httpbin.org is a public test service run by a third party. Sending this request contacts it directly from your browser.'],
      });
    });

  function importCurl(text: string) {
    const r = draftFromCurl(text);
    if (!r.ok) {
      toast(r.error, 'error');
      return;
    }
    guardedLoad(() => {
      load(r.draft, null);
      setNotice({ tone: r.warnings.length ? 'warning' : 'info', title: 'Imported from curl', items: r.warnings });
    });
  }

  const onPasteText = (text: string, e: ClipboardEvent<HTMLInputElement>) => {
    if (!looksLikeCurl(text)) return;
    e.preventDefault();
    importCurl(text);
  };

  // ------------------------------------------------------------ sending
  const addHistory = useCallback(async (entry: HistoryEntry) => {
    try {
      await historyDb.put(entry);
      const all = await historyDb.all();
      const overflow = historyOverflow(all);
      if (overflow.length) await historyDb.removeMany(overflow);
    } catch {
      /* history is best effort */
    }
  }, []);

  const send = useCallback(async () => {
    if (controller.current) return;
    // A curl command typed or dropped into the URL field (not pasted) is imported rather than
    // sent as a URL. The user reviews the imported request before anything goes out.
    if (looksLikeCurl(draft.url)) {
      const r = draftFromCurl(draft.url);
      if (!r.ok) {
        setPrepError(r.error);
        setMobileView('request');
        return;
      }
      load(r.draft, null);
      setNotice({
        tone: r.warnings.length ? 'warning' : 'info',
        title: 'Imported from curl. Review the request, then press Send.',
        items: r.warnings,
      });
      return;
    }
    const prepared = prepareRequest(draft, scope);
    if (!prepared.ok) {
      setPrepError(prepared.error);
      setMobileView('request');
      return;
    }
    if (settings.via === 'companion' && !settings.token) {
      setPrepError('Add the companion token first: open Companion settings.');
      setCompanionOpen(true);
      return;
    }
    setPrepError(null);
    setSendWarnings(prepared.warnings);
    const ctrl = new AbortController();
    controller.current = ctrl;
    const via = settings.via;
    const snapshot = draft;
    setResponse({ phase: 'sending', startedAt: performance.now(), via });
    setMobileView('response');
    try {
      const res = await sendRequest(prepared.request, { via, companionPort: settings.port, companionToken: settings.token, signal: ctrl.signal });
      if (controller.current !== ctrl) return;
      setResponse({ phase: 'done', response: res, requestUrl: prepared.request.url });
      void addHistory(makeHistoryEntry(snapshot, { status: res.status, timeMs: res.timeMs, size: res.body.size }, via, newId()));
    } catch (error) {
      if (controller.current !== ctrl) return;
      const failure = explainFailure(error, {
        url: prepared.request.url,
        pageProtocol: window.location.protocol,
        online: navigator.onLine,
        via,
      });
      setResponse({ phase: 'error', failure, via });
      if (failure.kind !== 'cancelled') {
        void addHistory(makeHistoryEntry(snapshot, { status: null, timeMs: null, size: null, error: failure.title }, via, newId()));
      }
    } finally {
      if (controller.current === ctrl) controller.current = null;
    }
  }, [draft, scope, settings, addHistory, load]);

  const cancel = useCallback(() => {
    const ctrl = controller.current;
    if (!ctrl) return;
    ctrl.abort(new DOMException('Cancelled', 'AbortError'));
    controller.current = null;
    setResponse({ phase: 'error', failure: explainFailure(new DOMException('Cancelled', 'AbortError'), { url: '', pageProtocol: '', online: true, via: settings.via }), via: settings.via });
  }, [settings.via]);

  // ------------------------------------------------------------ saving
  async function saveExisting(withoutSecrets: boolean) {
    if (!saved) return;
    const content = withoutSecrets ? stripSecrets(draft) : draft;
    try {
      await requestsDb.put({ ...saved, ...draftOf(content), updatedAt: Date.now() });
      if (withoutSecrets) {
        setDraft(content);
        toast('Saved without secrets. Use {{variables}} from an environment for credentials.');
      } else toast('Saved.');
    } catch {
      toast('Could not save. Local storage may be full or unavailable.', 'error');
    }
  }

  const requestSave = useCallback(() => {
    if (saved) {
      if (findSecrets(draft).length && !acknowledgedSecrets.current.has(saved.id)) setSecretsOpen(true);
      else void saveExisting(false);
    } else setSaveOpen(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saved, draft]);

  async function saveNew(target: SaveTarget) {
    const now = Date.now();
    try {
      let collectionId = target.collectionId;
      if (!collectionId) {
        const c: ApiCollection = { id: newId(), name: target.newCollectionName, folders: [], variables: [], createdAt: now, updatedAt: now };
        await collectionsDb.put(c);
        collectionId = c.id;
      }
      const content = { ...(target.withoutSecrets ? stripSecrets(draft) : draft), name: target.name };
      const req: SavedRequest = { ...draftOf(content), id: newId(), collectionId, folderId: target.folderId, favorite: false, createdAt: now, updatedAt: now };
      await requestsDb.put(req);
      if (!target.withoutSecrets && findSecrets(draft).length) acknowledgedSecrets.current.add(req.id);
      setDraft(content);
      setSavedId(req.id);
      setSaveOpen(false);
      toast(target.withoutSecrets ? 'Saved without secrets.' : 'Saved.');
    } catch {
      toast('Could not save. Local storage may be full or unavailable.', 'error');
    }
  }

  async function importData(result: ImportResult) {
    if (result.collections.length) await collectionsDb.putMany(result.collections);
    if (result.requests.length) await requestsDb.putMany(result.requests);
    if (result.environments.length) {
      await environmentsDb.putMany(result.environments);
      if (!activeEnv) updateSettings({ activeEnvId: result.environments[0].id });
    }
  }

  // ------------------------------------------------------------ keyboard
  const keys = useRef({ send, cancel, requestSave });
  useEffect(() => {
    keys.current = { send, cancel, requestSave };
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      const dialogOpen = Boolean(document.querySelector('dialog[open]'));
      if (mod && e.key === 'Enter' && !dialogOpen) {
        e.preventDefault();
        void keys.current.send();
      } else if (mod && (e.key === 's' || e.key === 'S') && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        if (!dialogOpen) keys.current.requestSave();
      } else if (e.key === 'Escape' && !dialogOpen && controller.current) {
        keys.current.cancel();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // ------------------------------------------------------------ derived
  const preparedForCode = useMemo(() => (codeOpen ? prepareRequest(draft, scope) : null), [codeOpen, draft, scope]);
  const curlText = () => {
    const p = prepareRequest(draft, scope);
    return p.ok ? generateCode(toCodeRequest(p.request, false), 'curl') : null;
  };
  const secrets = useMemo(() => (saveOpen || secretsOpen ? findSecrets(draft) : []), [saveOpen, secretsOpen, draft]);
  const sending = response.phase === 'sending';
  const compLabel = companionLabel(companion);

  const toolbar = (
    <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-2">
      <div className="flex min-w-0 flex-1 basis-40 items-center gap-1.5">
        <input
          aria-label="Request name"
          value={draft.name}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          onBlur={() => !draft.name.trim() && setDraft({ ...draft, name: 'Untitled request' })}
          className="h-8 max-w-full min-w-0 truncate rounded-md border border-transparent bg-transparent px-1.5 text-[14px] font-semibold text-fg outline-none [field-sizing:content] hover:border-line focus:border-accent focus:bg-surface-sunken"
        />
        {dirty && (
          <span className="size-2 shrink-0 rounded-full bg-warm" title={saved ? 'Unsaved changes' : 'Not saved yet'} aria-label={saved ? 'Unsaved changes' : 'Not saved yet'} role="img" />
        )}
        {savedCollection && <span className="hidden max-w-32 shrink-0 truncate text-[12px] text-fg-muted 2xl:inline">in {savedCollection.name}</span>}
      </div>
      <div className="flex min-w-0 items-center gap-0.5">
        <Layers size={14} aria-hidden className="mr-0.5 shrink-0 text-fg-muted" />
        <Select
          aria-label="Active environment"
          value={settings.activeEnvId ?? ''}
          onChange={(e) => updateSettings({ activeEnvId: e.target.value || null })}
          className="h-8 w-auto max-w-40 py-0 text-[13px]"
        >
          <option value="">No environment</option>
          {[...environments]
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((env) => (
              <option key={env.id} value={env.id}>
                {env.name}
              </option>
            ))}
        </Select>
        <IconButton icon={Braces} label="Manage environments" size="sm" onClick={() => setEnvOpen(true)} />
      </div>
      <div className="flex items-center gap-0.5">
        <Segmented
          label="Send via"
          size="sm"
          value={settings.via}
          onChange={(via) => updateSettings({ via })}
          options={[
            { value: 'browser', label: 'Browser', title: 'Send directly from this browser' },
            {
              value: 'companion',
              label: (
                <span className="inline-flex items-center gap-1.5">
                  {settings.via === 'companion' && <StatusDot status={companion} />}
                  Companion
                </span>
              ),
              title: settings.via === 'companion' ? `Local companion: ${compLabel.text}` : 'Send through the optional local companion',
            },
          ]}
        />
        <IconButton icon={Settings2} label="Companion settings" size="sm" onClick={() => setCompanionOpen(true)} />
      </div>
      <div className="flex items-center gap-1">
        <Button size="sm" icon={Save} onClick={requestSave} title={`Save (${modKey}+S)`}>
          Save
        </Button>
        <IconButton icon={Code} label="Generate code" size="sm" variant="secondary" onClick={() => setCodeOpen(true)} />
      </div>
    </div>
  );

  const notices = (
    <>
      {settings.via === 'companion' && companion.state !== 'connected' && companion.state !== 'checking' && companion.state !== 'unknown' && (
        <Alert
          tone="warning"
          className="py-2"
          action={
            <Button size="sm" icon={PlugZap} onClick={() => setCompanionOpen(true)}>
              Set up
            </Button>
          }
        >
          Local companion: {compLabel.text.toLowerCase()}.
        </Alert>
      )}
      {sendWarnings.map((w) => (
        <Alert key={w} tone="info" className="py-2">
          {w}
        </Alert>
      ))}
      {notice && (
        <Alert
          tone={notice.tone}
          title={notice.title}
          className="py-2"
          action={<IconButton icon={X} label="Dismiss" size="sm" onClick={() => setNotice(null)} />}
        >
          {notice.items.length > 0 && (
            <ul className={cn(notice.items.length > 1 && 'list-disc pl-4')}>
              {notice.items.map((i) => (
                <li key={i}>{i}</li>
              ))}
            </ul>
          )}
        </Alert>
      )}
    </>
  );

  const idleHint = draft.url.trim() ? (
    <IdleShortcuts />
  ) : (
    <div className="flex flex-col items-center gap-3">
      <span>Enter a URL above, paste a curl command, or open a saved request.</span>
      <Button size="sm" icon={Info} onClick={loadExample}>
        Try an example request
      </Button>
      <span className="text-[12px]">The example calls https://httpbin.org, an external public test service.</span>
    </div>
  );

  const sidebar = (
    <Sidebar
      collections={collections}
      requests={requests}
      history={history}
      activeRequestId={saved?.id ?? null}
      onOpenRequest={openRequest}
      onOpenHistory={openHistory}
      onNewRequest={newRequest}
      onExample={loadExample}
      onImport={() => setImportOpen(true)}
      onExport={(only) => setExportScope({ only })}
      onEditVariables={setVarsFor}
      onActiveDeleted={() => setSavedId(null)}
      className="h-full"
    />
  );
  const editor = (
    <RequestEditor
      draft={draft}
      onChange={setDraft}
      scope={scope}
      via={settings.via}
      sending={sending}
      onSend={() => void send()}
      onCancel={cancel}
      onPasteText={onPasteText}
      error={prepError}
      notices={notices}
      toolbar={toolbar}
      className="h-full"
    />
  );
  const responsePanel = (
    <ResponsePanel
      state={response}
      onCancel={cancel}
      onRetry={() => void send()}
      onUseCompanion={() => {
        updateSettings({ via: 'companion' });
        if (companion.state !== 'connected') setCompanionOpen(true);
      }}
      curl={curlText}
      idleHint={idleHint}
      className="h-full"
    />
  );

  return (
    <div className="min-w-0">
      {isDesktop ? (
        <div className="grid h-[max(660px,calc(100dvh-215px))] min-w-0 grid-cols-[250px_minmax(0,1fr)] grid-rows-[minmax(0,1fr)_minmax(0,1fr)] gap-3 2xl:grid-cols-[272px_minmax(0,1.05fr)_minmax(0,1fr)] 2xl:grid-rows-1">
          <div className="row-span-2 min-h-0 2xl:row-span-1">{sidebar}</div>
          <div className="min-h-0">{editor}</div>
          <div className="min-h-0">{responsePanel}</div>
        </div>
      ) : (
        <div className="flex min-w-0 flex-col gap-3">
          <Segmented
            label="View"
            value={mobileView}
            onChange={setMobileView}
            className="self-stretch [&>button]:flex-1"
            options={[
              { value: 'sidebar', label: 'Saved' },
              { value: 'request', label: 'Request' },
              {
                value: 'response',
                label:
                  response.phase === 'done' ? (
                    <span className="inline-flex items-center gap-1">
                      Response <span className="font-mono text-[11px] text-fg-muted">{response.response.status}</span>
                    </span>
                  ) : (
                    'Response'
                  ),
              },
            ]}
          />
          <div className={cn('h-[calc(100dvh-230px)] min-h-[520px]', mobileView !== 'sidebar' && 'hidden')}>{sidebar}</div>
          <div className={cn('min-h-[560px]', mobileView !== 'request' && 'hidden')}>{editor}</div>
          <div className={cn('h-[calc(100dvh-230px)] min-h-[480px]', mobileView !== 'response' && 'hidden')}>{responsePanel}</div>
        </div>
      )}

      <EnvironmentDialog
        open={envOpen}
        onClose={() => setEnvOpen(false)}
        environments={environments}
        activeId={settings.activeEnvId}
        onActivate={(id) => updateSettings({ activeEnvId: id })}
      />
      <CodeDialog open={codeOpen} onClose={() => setCodeOpen(false)} prepared={preparedForCode} />
      <ImportDialog open={importOpen} onClose={() => setImportOpen(false)} onImport={importData} onCurl={(d, warnings) => guardedLoad(() => {
        load(d, null);
        setNotice({ tone: warnings.length ? 'warning' : 'info', title: 'Imported from curl', items: warnings });
      })} />
      <ExportDialog
        open={exportScope !== null}
        onClose={() => setExportScope(null)}
        collections={collections}
        requests={requests}
        environments={environments}
        only={exportScope?.only ?? null}
      />
      <SaveDialog
        open={saveOpen}
        onClose={() => setSaveOpen(false)}
        initialName={draft.name}
        collections={[...collections].sort((a, b) => b.updatedAt - a.updatedAt)}
        preferredCollectionId={null}
        secrets={secrets}
        onSave={(t) => void saveNew(t)}
      />
      <SecretsDialog
        open={secretsOpen}
        secrets={secrets}
        onCancel={() => setSecretsOpen(false)}
        onSave={(withoutSecrets) => {
          setSecretsOpen(false);
          if (!withoutSecrets && saved) acknowledgedSecrets.current.add(saved.id);
          void saveExisting(withoutSecrets);
        }}
      />
      <CompanionDialog
        open={companionOpen}
        onClose={() => setCompanionOpen(false)}
        port={settings.port}
        token={settings.token}
        onChange={(next) => updateSettings(next)}
        status={companion}
        onCheck={runCheck}
      />
      <CollectionVarsDialog collection={varsFor} onClose={() => setVarsFor(null)} />
      <ConfirmDialog
        open={pendingLoad !== null}
        onCancel={() => setPendingLoad(null)}
        onConfirm={() => {
          const fn = pendingLoad;
          setPendingLoad(null);
          fn?.();
        }}
        title="Discard unsaved changes?"
        confirmLabel="Discard"
      >
        The request in the editor has changes that are not saved. Save it first ({modKey}+S) if you want to keep them.
      </ConfirmDialog>
    </div>
  );
}
