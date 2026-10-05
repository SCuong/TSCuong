import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { ArrowLeft, BookOpen, CloudOff, FileText, FolderOpen, HardDrive, Info, Star, Trash2 } from 'lucide-react';
import { usePdfFile } from '@/tools/pdf/components/usePdfFile';
import { readerRepository as repository, fingerprint, pdfDrafts, CACHE_LIMIT, type ReaderDocument } from './storage';
import { readerPlatform } from './platform';
import { readerErrorMessage } from './errorMessage';
import { MobileReader } from './MobileReader';
import { PdfToolkit } from './PdfToolkit';
import { OfflineOcr } from './OfflineOcr';
import { Dialog, ConfirmDialog } from '@/components/ui/Dialog';
import { Spinner } from '@/components/ui/Feedback';
import { Logo } from '@/components/Logo';
import { LanguageToggle } from '@/app/LanguageSwitcher';
import { cycleTheme } from '@/lib/theme';
import { UpdatePrompt } from '@/app/UpdatePrompt';
import { toast, Toaster } from '@/components/ui/Toast';
import { t, setLocaleInPlace, type Locale } from '@/lib/i18n';
import './reader.css';

export function ReaderApp() {
  const controller = usePdfFile();
  const { pdf, state, open, reset, submitPassword } = controller;
  const location = useLocation();
  const navigate = useNavigate();
  const [documents, setDocuments] = useState<ReaderDocument[]>([]);
  const [record, setRecord] = useState<ReaderDocument | null>(null);
  const [notice, setNotice] = useState('');
  const [, setLanguageRevision] = useState(0);
  const changeLanguage = useCallback((next: Locale) => {
    void setLocaleInPlace(next).then(() => setLanguageRevision((revision) => revision + 1)).catch(() => toast(t('Could not change language. Open LocalKit online once and try again.'), 'error'));
  }, []);
  const [preparing, setPreparing] = useState(false);
  const [libraryTab, setLibraryTab] = useState<'recent' | 'favorites'>('recent');
  const [query, setQuery] = useState('');
  const [password, setPassword] = useState('');
  const [settings, setSettings] = useState(false);
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
    if (settings) void navigator.storage?.estimate?.().then(setEstimate).catch(() => {});
  }, [settings]);
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
  const shown = documents.filter(
    (r) => (libraryTab === 'recent' || r.favorite) && r.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
  );
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
      {inToolkit ? <PdfToolkit file={toolFile} onRead={readResult} onSource={setToolFile} onLanguage={changeLanguage} /> : inReader && pdf && record && !preparing ? (
        <>
          <MobileReader
            key={record.id}
            pdf={pdf}
            record={record}
            update={update}
            onTools={enterToolkit}
            onLibrary={() => {
              navigate('/read');
              document.title = t('PDF Reader') + ' · LocalKit';
            }}
          />
          {notice && <div className="reader-floating-notice">{noticeBar}</div>}
        </>
      ) : (
        <main className="reader-library">
          <header className="reader-library-header">
            <Link to="/" className="reader-home" aria-label={t('Back to LocalKit')}>
              <ArrowLeft size={20} />
              <Logo />
            </Link>
            <div className="reader-header-actions">
              <LanguageToggle onChange={changeLanguage} />
              <button className="reader-icon" onClick={() => setSettings(true)} aria-label={t('Reader settings')}>
                <Info size={21} />
              </button>
            </div>
          </header>
          <nav className="reader-product-nav" aria-label={t('PDF workspace')}><span aria-current="page">{t('PDF library')}</span><button onClick={() => enterToolkit()}>{t('PDF Toolkit')}</button></nav>
          <section className="reader-hero">
            <div className="reader-eyebrow">
              <BookOpen size={16} />
              {t('YOUR PRIVATE READING SPACE')}
            </div>
            <h1>{t('PDF Reader')}</h1>
            <p>{t('A little space to read. Just you and your documents.')}</p>
            <button className="reader-primary reader-open" onClick={pick} disabled={loading}>
              <FolderOpen size={21} />
              {t('Open PDF')}
            </button>
            <div className="reader-privacy">
              <CloudOff size={15} />
              <span>
                {offlineReady ? t('Ready for offline reading') : t('Files stay on this device. No uploads, no ads.')}
              </span>
            </div>
          </section>
          {noticeBar}
          {loading && (
            <div className="reader-loading" role="status">
              <Spinner />
              <span>
                {state.status === 'loading'
                  ? t('Opening {name}…', { name: state.name })
                  : t('Preparing your document…')}
              </span>
              <button
                onClick={() => {
                  reset();
                  prepared.current = null;
                  setPreparing(false);
                  navigate('/read');
                }}
              >
                {t('Cancel')}
              </button>
            </div>
          )}
          {state.status === 'error' && (
            <div className="reader-notice" role="alert">
              <span>{readerErrorMessage(state.error, state.name)}</span>
              <button onClick={reset}>{t('Dismiss')}</button>
            </div>
          )}
          <div className="reader-library-controls">
            <div className="reader-tabs" role="group" aria-label={t('Document collection')}>
              <button aria-pressed={libraryTab === 'recent'} onClick={() => setLibraryTab('recent')}>
                {t('Recent PDFs')}
                <span>{documents.length}</span>
              </button>
              <button aria-pressed={libraryTab === 'favorites'} onClick={() => setLibraryTab('favorites')}>
                <Star size={15} />
                {t('Favorites')}
              </button>
            </div>
            <input
              type="search"
              aria-label={t('Find a document')}
              placeholder={t('Find a document')}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          {shown.length ? (
            <ul className="reader-documents">
              {shown.map((r) => (
                <li key={r.id} className="reader-document">
                  <button
                    className="reader-document-open"
                    disabled={loading || inReader}
                    onClick={() => {
                      if (!r.cached) {
                        setNotice(t('Pick this PDF again. Your saved position and bookmarks will be restored.'));
                        pick();
                      } else if (record?.id === r.id && pdf) {
                        void repository
                          .patch(r.id, { lastOpened: Date.now() })
                          .then(refresh)
                          .catch(() => {});
                        navigate('/read/doc?id=' + r.id);
                      } else {
                        setRecord(null);
                        prepared.current = null;
                        reset();
                        navigate('/read/doc?id=' + r.id);
                      }
                    }}
                  >
                    <div className="reader-document-icon">
                      <FileText size={30} />
                      <span>PDF</span>
                    </div>
                    <div className="reader-document-info">
                      <h2>{r.name}</h2>
                      <p>
                        {t('Page {page} of {pages}', { page: r.page, pages: r.pages })} · {formatSize(r.size)}
                      </p>
                      <span className={r.cached ? 'reader-saved' : ''}>
                        {r.cached ? t('Saved on device') : t('Pick file to reopen')}
                      </span>
                      <div className="reader-progress">
                        <i style={{ width: (r.page / r.pages) * 100 + '%' }} />
                      </div>
                    </div>
                  </button>
                  <div className="reader-document-actions">
                    <button
                      className="reader-icon"
                      aria-label={r.favorite ? t('Remove favorite') : t('Add favorite')}
                      aria-pressed={r.favorite}
                      onClick={() => void toggleFavorite(r)}
                    >
                      <Star size={19} fill={r.favorite ? 'currentColor' : 'none'} />
                    </button>
                    <button
                      className="reader-icon"
                      aria-label={t('Remove {name}', { name: r.name })}
                      onClick={() => setRemove(r)}
                    >
                      <Trash2 size={18} />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <div className="reader-empty">
              <BookOpen size={34} />
              <h2>
                {query
                  ? t('No matching documents')
                  : libraryTab === 'favorites'
                    ? t('Keep your favorites close')
                    : t('Your next read starts here')}
              </h2>
              <p>
                {query
                  ? t('Try another filename.')
                  : libraryTab === 'favorites'
                    ? t('Tap the star on a document to keep it here and protect its saved copy.')
                    : t('Open a PDF from Files or Downloads. We will remember where you left off.')}
              </p>
            </div>
          )}
          <footer className="reader-storage">
            <HardDrive size={16} />
            <span>
              {t('{count}/20 PDFs · {size}/500 MB saved', {
                count: cached.length,
                size: (cachedBytes / 1024 / 1024).toFixed(1),
              })}
            </span>
            <button onClick={() => setSettings(true)}>{t('Manage storage')}</button>
          </footer>
        </main>
      )}
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
      <Dialog open={settings} onClose={() => setSettings(false)} title={t('Reader settings')} className="reader-sheet">
        <div className="reader-settings">
          <button className="reader-row" onClick={cycleTheme}>
            {t('Switch light / dark interface')}
          </button>
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
              'In Chrome on Android, open the menu (⋮), choose Add to Home screen, then Install. Long-press the LocalKit icon for the PDF Reader shortcut.',
            )}
          </p>
          <p className="reader-muted">
            {t(
              'Open LocalKit once while online to prepare offline reading. Share a PDF from Files to LocalKit, or use Open PDF. Installation and device storage require HTTPS or localhost.',
            )}
          </p>
          <p className="reader-muted">
            {t(
              'Saved PDFs are private browser data. Clearing site data removes them. They are not included in LocalKit backups.',
            )}
          </p>
        </div>
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
      <UpdatePrompt />
      <Toaster />
    </div>
  );
}
const sharedFiles = new Map<string, Promise<File>>();
function formatSize(size: number) {
  return size < 1024 * 1024 ? (size / 1024).toFixed(0) + ' KB' : (size / 1024 / 1024).toFixed(1) + ' MB';
}
