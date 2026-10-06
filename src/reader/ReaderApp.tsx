import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { BookOpen, FolderOpen, Search, LayoutDashboard, Library, Wrench, Settings, Images, Merge, ScanText } from 'lucide-react';
import { usePdfFile } from '@/tools/pdf/components/usePdfFile';
import { readerRepository as repository, fingerprint, pdfDrafts, CACHE_LIMIT, type ReaderDocument } from './storage';
import { readerPlatform } from './platform';
import { readerErrorMessage } from './errorMessage';
import { MobileReader } from './MobileReader';
import { PdfToolkit } from './PdfToolkit';
import { OfflineOcr } from './OfflineOcr';
import { Dialog, ConfirmDialog } from '@/components/ui/Dialog';
import { Spinner } from '@/components/ui/Feedback';
import { FileLibrary } from './FileLibrary';
import { selectDocuments, type FileFilter, type FileSort } from './libraryModel';
import { libraryThumbnail } from './libraryThumbnails';
import { LanguageToggle } from '@/app/LanguageSwitcher';
import { useTheme, setThemePreference, type ThemePreference } from '@/lib/theme';
import { readRaw, writeRaw } from '@/lib/storage/local';
import { UpdatePrompt } from '@/app/UpdatePrompt';
import { toast, Toaster } from '@/components/ui/Toast';
import { t, setLocaleInPlace, type Locale } from '@/lib/i18n';
import './reader.css';
import './appShell.css';

export function ReaderApp() {
  const controller = usePdfFile();
  const { pdf, state, open, reset, submitPassword } = controller;
  const location = useLocation();
  const navigate = useNavigate();
  const [documents, setDocuments] = useState<ReaderDocument[]>([]);
  const [record, setRecord] = useState<ReaderDocument | null>(null);
  const [notice, setNotice] = useState('');
  const [languageRevision, setLanguageRevision] = useState(0);
  const changeLanguage = useCallback((next: Locale) => {
    void setLocaleInPlace(next).then(() => setLanguageRevision((revision) => revision + 1)).catch(() => toast(t('Could not change language. Open LocalKit online once and try again.'), 'error'));
  }, []);
  const [preparing, setPreparing] = useState(false);
  const [filter, setFilter] = useState<FileFilter>('all');
  const [sort, setSort] = useState<FileSort>('added');
  const searchInput = useRef<HTMLInputElement>(null);
  const [focusSearch, setFocusSearch] = useState(false);
  const theme = useTheme();
  const [paper, setPaper] = useState(() => readRaw('reader-night') ?? 'paper');
  const [query, setQuery] = useState('');
  const [password, setPassword] = useState('');
  const [remove, setRemove] = useState<ReaderDocument | null>(null);
  const [offlineReady, setOfflineReady] = useState(false);
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const [draftCount, setDraftCount] = useState(0);
  const [clearDrafts, setClearDrafts] = useState(false);
  const [estimate, setEstimate] = useState<StorageEstimate | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const [toolFile, setToolFile] = useState<File | null>(null);
  const current = useRef(record);
  current.current = record;
  const prepared = useRef<typeof pdf>(null);
  const requestId = new URLSearchParams(location.search).get('id');
  const shareId = new URLSearchParams(location.search).get('share');
  const shareError = new URLSearchParams(location.search).has('shareError');
  const inReader = location.pathname === '/read/doc';
  const inToolkit = location.pathname.startsWith('/read/tools');
  const inSettings = location.pathname === '/read/settings';
  const inLibrary = location.pathname === '/read/library';
  const sections = [{ path: '/read', label: 'Overview', icon: LayoutDashboard }, { path: '/read/library', label: 'Library', icon: Library }, { path: '/read/tools', label: 'Tools', icon: Wrench }, { path: '/read/settings', label: 'Settings', icon: Settings }];
  const section = inToolkit ? sections[2] : inSettings ? sections[3] : inLibrary ? sections[1] : sections[0];
  useEffect(() => {
    if (inLibrary && focusSearch) { searchInput.current?.focus(); setFocusSearch(false); }
  }, [inLibrary, focusSearch]);
  useEffect(() => { window.scrollTo(0, 0); }, [location.pathname]);

  useEffect(() => {
    if (inReader && !requestId && !pdf) navigate('/read/library', { replace: true });
    if (!['/read', '/read/', '/read/library', '/read/settings', '/read/doc'].includes(location.pathname) && !inToolkit) navigate('/read', { replace: true });
    if (!inReader) document.title = t(section.label) + ' · LocalKit PDF';
  }, [location.pathname, inToolkit, inReader, navigate, section.label, languageRevision, requestId, pdf]);

  function enterToolkit(id?: string) {
    setToolFile(pdf?.file ?? null);
    reset();
    setRecord(null);
    prepared.current = null;
    navigate('/read/tools' + (id ? '/' + id : ''));
  }
  const readResult = useCallback((file: File) => {
    setToolFile(null);
    setRecord(null);
    prepared.current = null;
    navigate('/read');
    void open(file);
  }, [navigate, open]);

  useEffect(() => {
    if (shareError) {
      setNotice(t('The shared PDF could not be opened. Use Open PDF to pick it from your device.'));
      navigate('/read', { replace: true });
    }
  }, [shareError, navigate]);

  const refresh = useCallback(async () => {
    try {
      setDocuments((await repository.list()).sort((a, b) => b.lastOpened - a.lastOpened));
      setDraftCount(await pdfDrafts.count());
    } catch {
      setNotice(t('Local storage is unavailable. You can still read, but your library will not be saved.'));
    }
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh, location.pathname]);
  useEffect(() => {
    if (inSettings) void navigator.storage?.estimate?.().then(setEstimate).catch(() => {});
  }, [inSettings]);
  useEffect(() => {
    const refreshOnFocus = () => void refresh();
    window.addEventListener('focus', refreshOnFocus);
    return () => window.removeEventListener('focus', refreshOnFocus);
  }, [refresh]);
  useEffect(() => {
    let cancelled = false;
    if (import.meta.env.PROD && 'serviceWorker' in navigator) {
      void navigator.serviceWorker.ready.then(() => {
        if (!cancelled) setOfflineReady(true);
      });
    }
    void navigator.storage
      ?.persisted?.()
      .then(setPersisted)
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!requestId || !inReader || current.current?.id === requestId) return;
    let cancelled = false;
    setPreparing(true);
    void repository
      .readFile(requestId)
      .then(async (file) => {
        if (cancelled) return;
        const saved = (await repository.list()).find((r) => r.id === requestId);
        if (cancelled) return;
        await open(new File([file], saved?.name ?? 'document.pdf', { type: 'application/pdf' }));
      })
      .catch(() => {
        if (cancelled) return;
        void repository
          .patch(requestId, { cached: false })
          .then(refresh)
          .catch(() => {});
        setNotice(
          t('This PDF is no longer saved on this device. Pick the same file to restore your reading position.'),
        );
        navigate('/read', { replace: true });
      })
      .finally(() => {
        if (!cancelled) setPreparing(false);
      });
    return () => {
      cancelled = true;
    };
  }, [requestId, inReader, open, refresh, navigate]);

  useEffect(() => {
    if (!shareId) return;
    // Claim once across StrictMode effect replays; the file stays in memory only.
    let cancelled = false;
    const task = sharedFiles.get(shareId) ?? readerPlatform.takeSharedFile(shareId);
    sharedFiles.set(shareId, task);
    void task
      .then((file) => {
        if (!cancelled) {
          sharedFiles.delete(shareId);
          navigate('/read', { replace: true });
          void open(file);
        }
      })
      .catch(() => {
        if (!cancelled) {
          sharedFiles.delete(shareId);
          setNotice(t('The shared PDF could not be opened. Use Open PDF to pick it from your device.'));
          navigate('/read', { replace: true });
        }
      })
      .finally(() => sharedFiles.delete(shareId));
    return () => {
      cancelled = true;
    };
  }, [shareId, navigate, open]);

  useEffect(() => {
    if (!pdf || prepared.current === pdf) return;
    let cancelled = false;
    setPreparing(true);
    void (async () => {
      const id = await fingerprint(pdf.bytes);
      const initial: ReaderDocument = {
        id,
        name: pdf.file.name,
        size: pdf.file.size,
        pages: pdf.pageCount,
        page: 1,
        offset: 0,
        bookmarks: [],
        favorite: false,
        cached: false,
        lastOpened: Date.now(),
        addedAt: Date.now(),
      };
      let next = initial;
      try {
        const saved = await repository.remember(initial, pdf.file);
        next = saved.record;
        if (saved.warning && !cancelled)
          setNotice(
            saved.warning === 'limit'
              ? t(
                  'The cache is full of favorites, or this file exceeds 500 MB. You can read it now; pick it again next time.',
                )
              : t('This PDF could not be saved locally. You can read it now; pick it again next time.'),
          );
      } catch {
        if (!cancelled)
          setNotice(t('Local storage is unavailable. You can still read, but your library will not be saved.'));
      }
      if (cancelled) return;
      prepared.current = pdf;
      setRecord(next);
      void libraryThumbnail(id, pdf.doc);
      setPreparing(false);
      document.title = pdf.file.name + ' · LocalKit';
      void refresh();
      navigate('/read/doc?id=' + id, { replace: true });
    })().catch(() => {
      if (!cancelled) {
        setPreparing(false);
        setNotice(t('Could not prepare this PDF. Please open it again.'));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [pdf, navigate, refresh]);

  const update = useCallback(
    (patch: Partial<Pick<ReaderDocument, 'page' | 'offset' | 'favorite' | 'bookmarks'>>) => {
      const saved = current.current;
      if (!saved) return Promise.resolve();
      const next = { ...saved, ...patch };
      current.current = next;
      setRecord(next);
      return repository
        .patch(saved.id, patch)
        .then(refresh)
        .catch(() => {
          setNotice(t('Your changes could not be saved. Keep this tab open to retain this reading session.'));
        });
    },
    [refresh],
  );

  async function toggleFavorite(r: ReaderDocument) {
    if (current.current?.id === r.id) update({ favorite: !r.favorite });
    else {
      try {
        await repository.patch(r.id, { favorite: !r.favorite });
        await refresh();
      } catch {
        setNotice(t('Your changes could not be saved. Keep this tab open to retain this reading session.'));
      }
    }
  }
  function pick() {
    input.current?.click();
  }
  const loading = state.status === 'loading' || preparing;
  const cached = documents.filter((r) => r.cached);
  const cachedBytes = cached.reduce((sum, r) => sum + r.size, 0);
  const shown = inLibrary ? selectDocuments(documents, query, filter, sort) : selectDocuments(documents, '', 'all', 'added').slice(0, 8);
  function openRecord(r: ReaderDocument) {
    if (!r.cached) { setNotice(t('Pick this PDF again. Your saved position and bookmarks will be restored.')); pick(); }
    else if (record?.id === r.id && pdf) { void repository.patch(r.id, { lastOpened: Date.now() }).then(refresh).catch(() => {}); navigate('/read/doc?id=' + r.id); }
    else { setRecord(null); prepared.current = null; reset(); navigate('/read/doc?id=' + r.id); }
  }
  const noticeBar = notice && (
    <div className="reader-notice" role="status">
      <span>{notice}</span>
      <button onClick={() => setNotice('')} aria-label={t('Dismiss message')}>
        ×
      </button>
    </div>
  );
  return (
    <div className="reader-app">
      <input
        ref={input}
        type="file"
        accept=".pdf,application/pdf"
        aria-label={t('Open PDF from device')}
        className="sr-only"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) {
            setNotice('');
            setRecord(null);
            prepared.current = null;
            void open(file);
          }
        }}
      />
      {inToolkit ? <PdfToolkit file={toolFile} onRead={readResult} onSource={setToolFile} /> : inReader && pdf && record && !preparing ? (
        <>
          <MobileReader
            key={record.id}
            pdf={pdf}
            record={record}
            update={update}
            onTools={enterToolkit}
            onLibrary={() => {
              navigate('/read/library');
              document.title = 'LocalKit PDF';
            }}
          />
          {notice && <div className="reader-floating-notice">{noticeBar}</div>}
        </>
      ) : (
        <main className="pdf-app-content">
          <header className="pdf-app-header">
            <div className="pdf-app-brand">{inLibrary || inSettings ? <section.icon size={22} /> : <BookOpen size={22} />}<h1>{inLibrary || inSettings ? t(section.label) : t('LocalKit PDF')}</h1></div>
            <button className="reader-icon" aria-label={t('Search PDFs')} onClick={() => { setFocusSearch(true); navigate('/read/library'); }}><Search size={22} /></button>
            <button className="reader-icon" aria-label={t('Import PDF')} disabled={loading} onClick={pick}><FolderOpen size={22} /></button>
          </header>
          {noticeBar}
          {loading && <div className="reader-loading" role="status"><Spinner /><span>{state.status === 'loading' ? t('Opening {name}…', { name: state.name }) : t('Preparing your document…')}</span><button onClick={() => { reset(); prepared.current = null; setPreparing(false); navigate('/read'); }}>{t('Cancel')}</button></div>}
          {state.status === 'error' && <div className="reader-notice" role="alert"><span>{readerErrorMessage(state.error, state.name)}</span><button onClick={reset}>{t('Dismiss')}</button></div>}
          {inSettings ? (        <div className="reader-settings">
          <h2>{t('Appearance')}</h2>
          <div className="pdf-setting-row"><span>{t('Language')}</span><LanguageToggle onChange={changeLanguage} /></div>
          <label className="pdf-setting-row">{t('Theme')}<select value={theme.preference} onChange={(e) => setThemePreference(e.target.value as ThemePreference)}><option value="system">{t('System')}</option><option value="light">{t('Light')}</option><option value="dark">{t('Dark')}</option></select></label>
          <label className="pdf-setting-row">{t('Reading paper')}<select value={paper} onChange={(e) => { setPaper(e.target.value); writeRaw('reader-night', e.target.value); }}><option value="paper">{t('Original')}</option><option value="sepia">{t('Sepia')}</option><option value="night">{t('Night')}</option></select></label>
          <h2>{t('Offline and storage')}</h2>
          <p className="reader-muted" role="status">{offlineReady ? t('Ready for offline reading') : t('Open the app online once to prepare offline use.')}</p>
          <h3>{t('Storage on this device')}</h3>
          <p>
            {t('{count}/20 PDFs · {size}/500 MB saved', {
              count: cached.length,
              size: (cachedBytes / 1024 / 1024).toFixed(1),
            })}
          </p>
          <progress value={cachedBytes} max={CACHE_LIMIT.bytes} aria-label={t('PDF cache usage')} />
          {estimate?.quota !== undefined && <p className="reader-muted">{t('{used} of {quota} MB used by LocalKit and offline engines', { used: ((estimate.usage ?? 0) / 1048576).toFixed(1), quota: (estimate.quota / 1048576).toFixed(0) })}</p>}
          <p>{t('{count} document editing drafts saved', { count: draftCount })}</p>
          <button className="reader-row" disabled={!draftCount} onClick={() => setClearDrafts(true)}>{t('Clear annotation and form drafts')}</button>
          <p className="reader-muted">
            {t(
              'Least recently opened PDFs are removed from the cache when it fills up. Favorites are protected. Reading positions and bookmarks remain.',
            )}
          </p>
          <button
            className="reader-row"
            disabled={cached.every((r) => r.favorite)}
            onClick={() =>
              void repository
                .clearCache()
                .then(refresh)
                .catch(() => setNotice(t('Could not clear saved files. Please try again.')))
            }
          >
            {t('Clear saved copies except favorites')}
          </button>
          <button
            className="reader-row"
            disabled={persisted === true}
            onClick={() =>
              void readerPlatform
                .persist()
                .then((value) => {
                  setPersisted(value);
                  if (!value)
                    setNotice(
                      t('The browser did not grant persistent storage. Keep original PDFs in Files or Downloads.'),
                    );
                })
                .catch(() => setNotice(t('Persistent storage is unavailable in this browser.')))
            }
          >
            {persisted ? t('Persistent storage enabled') : t('Request persistent storage')}
          </button>
          <OfflineOcr />
          <h3>{t('Install on your phone')}</h3>
          <p>
            {t(
              'Android: Chrome menu → Add to Home screen → Install. iPhone/iPad: Safari Share → Add to Home Screen.',
            )}
          </p>
          <p className="reader-muted">
            {t(
              'Open the app online once to prepare offline reading. Import PDFs from Files or share them to LocalKit PDF when your device offers it. Installation requires HTTPS.',
            )}
          </p>
          <h3>{t('Privacy')}</h3>
          <p className="reader-muted">
            {t(
              'PDFs, passwords and edits stay on this device. No uploads, accounts or ads. Keep originals in Files: clearing browser data removes saved PDFs and drafts.',
            )}
          </p>
        </div>
) : <>
            {!inLibrary && <div className="pdf-quick-actions" aria-label={t('Quick actions')}>
              <button onClick={pick} disabled={loading}><FolderOpen size={22} /><span>{t('Open PDF')}</span></button>
              <Link to="/read/tools/pdf-from-images"><Images size={22} /><span>{t('Images → PDF')}</span></Link>
              <Link to="/read/tools/pdf-merge"><Merge size={22} /><span>{t('Merge PDFs')}</span></Link>
              <Link to="/read/tools/pdf-ocr"><ScanText size={22} /><span>{t('OCR / Scan')}</span></Link>
            </div>}
            {inLibrary ? <div className="pdf-library-controls">
              <input ref={searchInput} type="search" aria-label={t('Find a document')} placeholder={t('Find a document')} value={query} onChange={(e) => setQuery(e.target.value)} />
              <div><label><span className="sr-only">{t('Filter files')}</span><select aria-label={t('Filter files')} value={filter} onChange={(e) => setFilter(e.target.value as FileFilter)}><option value="all">{t('All PDFs')}</option><option value="favorites">{t('Favorites')}</option><option value="saved">{t('Saved on device')}</option><option value="missing">{t('Pick file to reopen')}</option></select></label>
              <label><span className="sr-only">{t('Sort files')}</span><select aria-label={t('Sort files')} value={sort} onChange={(e) => setSort(e.target.value as FileSort)}><option value="added">{t('Recently added')}</option><option value="opened">{t('Last opened')}</option><option value="name">{t('Filename')}</option><option value="size">{t('File size')}</option></select></label></div>
            </div> : <div className="pdf-section-title"><h2>{t('Recently added')}</h2><Link to="/read/library">{t('View all')}</Link></div>}
            {shown.length ? <FileLibrary documents={shown} onOpen={openRecord} onFavorite={(r) => void toggleFavorite(r)} onRemove={setRemove} loading={loading || inReader} /> : <div className="pdf-list-empty"><FileTextPlaceholder /><p>{query ? t('No matching documents') : filter === 'favorites' && inLibrary ? t('No favorites yet') : t('No PDFs yet')}</p><span>{query ? t('Try another filename.') : t('Import a PDF from Files or Downloads.')}</span></div>}
          </>}
        </main>
      )}
      {!inReader && <nav className="pdf-bottom-nav" aria-label={t('PDF app navigation')}>{sections.map((item) => <Link key={item.path} to={item.path} onClick={() => { if (item.path === '/read/tools' && !inToolkit && pdf) setToolFile(pdf.file); }} aria-current={section.path === item.path ? 'page' : undefined}><item.icon size={22} /><span>{t(item.label)}</span></Link>)}</nav>}
      <Dialog
        open={state.status === 'password'}
        onClose={() => {
          reset();
          navigate('/read');
        }}
        title={t('Password required')}
        className="reader-sheet"
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submitPassword(password);
            setPassword('');
          }}
        >
          <p className="reader-muted">
            {t('Enter the PDF password. It is used only to open this document and is never saved.')}
          </p>
          {state.status === 'password' && state.error && (
            <p role="alert" className="reader-error">
              {readerErrorMessage(state.error, state.file.name)}
            </p>
          )}
          <input
            type="password"
            aria-label={t('PDF password')}
            autoFocus
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="reader-input"
          />
          <button className="reader-primary reader-wide" type="submit">
            {t('Unlock PDF')}
          </button>
        </form>
      </Dialog>
      <ConfirmDialog
        open={Boolean(remove)}
        onCancel={() => setRemove(null)}
        onConfirm={() => {
          if (!remove) return;
          void repository
            .remove(remove.id)
            .then(() => {
              if (record?.id === remove.id) {
                reset();
                setRecord(null);
                prepared.current = null;
              }
              setRemove(null);
              void refresh();
            })
            .catch(() => setNotice(t('Could not remove this document. Please try again.')));
        }}
        title={t('Remove this document?')}
        confirmLabel={t('Remove document')}
      >
        {t(
          'This removes its saved copy, reading position, bookmarks and editing draft from LocalKit. The original file in Files or Downloads is kept.',
        )}
      </ConfirmDialog>
      <ConfirmDialog open={clearDrafts} onCancel={() => setClearDrafts(false)} onConfirm={() => void pdfDrafts.clear().then(() => { setClearDrafts(false); void refresh(); }).catch(() => setNotice(t('Could not clear saved edits. Please try again.')))} title={t('Clear all editing drafts?')} confirmLabel={t('Clear drafts')}>
        {t('This removes local annotation and form drafts. Exported PDFs, originals, reading positions and bookmarks are kept. Export any edits you want to keep first.')}
      </ConfirmDialog>
      <UpdatePrompt announceOffline={false} />
      <Toaster />
    </div>
  );
}
const sharedFiles = new Map<string, Promise<File>>();
function FileTextPlaceholder() { return <BookOpen size={28} aria-hidden="true" />; }
