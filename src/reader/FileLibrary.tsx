import { useEffect, useRef, useState } from 'react';
import { FileText, MoreHorizontal, Star, FolderOpen, Trash2, BookOpen } from 'lucide-react';
import { Dialog } from '@/components/ui/Dialog';
import { t } from '@/lib/i18n';
import { libraryThumbnail } from './libraryThumbnails';
import type { ReaderDocument } from './storage';
import { formatSize } from './libraryModel';

function FirstPage({ record }: { record: ReaderDocument }) {
  const host = useRef<HTMLSpanElement>(null);
  const [src, setSrc] = useState<string>();
  useEffect(() => {
    setSrc(undefined);
    let alive = true;
    let url: string | undefined;
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      observer.disconnect();
      if (!record.cached) return;
      void libraryThumbnail(record.id).then((blob) => {
        if (!alive || !blob) return;
        url = URL.createObjectURL(blob); setSrc(url);
      });
    }, { rootMargin: '120px' });
    observer.observe(host.current!);
    return () => { alive = false; observer.disconnect(); if (url) URL.revokeObjectURL(url); };
  }, [record.id, record.cached]);
  return <span ref={host} className="pdf-file-preview" aria-hidden="true">{src ? <img src={src} alt="" loading="lazy" decoding="async" /> : <FileText size={24} />}</span>;
}
export function FileLibrary({ documents, onOpen, onFavorite, onRemove, loading }: {
  documents: ReaderDocument[]; onOpen(record: ReaderDocument): void; onFavorite(record: ReaderDocument): void;
  onRemove(record: ReaderDocument): void; loading: boolean;
}) {
  const [selected, setSelected] = useState<ReaderDocument | null>(null);
  // Resolve against fresh metadata so the action sheet never shows an old favorite state.
  const active = documents.find((r) => r.id === selected?.id) ?? selected;
  return <>
    <ul className="pdf-file-list">{documents.map((r) => <li key={r.id} className="pdf-file-row">
      <button className="reader-document-open" disabled={loading} onClick={() => onOpen(r)} aria-label={t('Open {name}', { name: r.name })}>
        <FirstPage record={r} /><span className="pdf-file-info"><span className="pdf-file-title">{r.name}</span>
          <span className="pdf-file-meta">{r.pages === 1 ? t('1 page') : t('{count} pages', { count: r.pages })} · {formatSize(r.size)}</span>
          <span className="pdf-file-date">{r.cached ? t('Opened {date}', { date: new Intl.DateTimeFormat(document.documentElement.lang, { month: 'short', day: 'numeric' }).format(r.lastOpened) }) : t('Pick file to reopen')}</span>
        </span>{r.favorite && <Star className="pdf-file-star" size={14} fill="currentColor" />}
      </button>
      <button className="reader-icon" disabled={loading} aria-label={t('File actions for {name}', { name: r.name })} onClick={() => setSelected(r)}><MoreHorizontal size={21} /></button>
    </li>)}</ul>
    <Dialog open={!!active} onClose={() => setSelected(null)} title={active?.name} className="reader-sheet pdf-file-sheet">
      {active && <div className="pdf-file-menu">
        <p>{active.pages === 1 ? t('1 page') : t('{count} pages', { count: active.pages })} · {formatSize(active.size)}</p>
        <button className="reader-row" onClick={() => { onOpen(active); setSelected(null); }}><BookOpen size={20} />{t('Open PDF')}</button>
        <button className="reader-row" onClick={() => { onFavorite(active); setSelected(null); }}><Star size={20} />{active.favorite ? t('Remove favorite') : t('Add favorite')}</button>
        {!active.cached && <p className="reader-muted"><FolderOpen size={18} />{t('Pick this PDF again. Your saved position and bookmarks will be restored.')}</p>}
        <button className="reader-row pdf-danger" onClick={() => { onRemove(active); setSelected(null); }}><Trash2 size={20} />{t('Remove {name}', { name: active.name })}</button>
      </div>}
    </Dialog>
  </>;
}
