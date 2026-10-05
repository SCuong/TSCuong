import { lazy, Suspense, useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router';
import { ArrowLeft, BookOpen, ShieldCheck, Highlighter, FormInput, LockKeyhole } from 'lucide-react';
import { pdfTools } from '@/tools/registry/pdf';
import { PdfWorkspaceContext } from '@/tools/pdf/components/PdfWorkspaceContext';
import { ToolErrorBoundary } from '@/components/ToolErrorBoundary';
import { LanguageToggle } from '@/app/LanguageSwitcher';
import { Spinner } from '@/components/ui/Feedback';
import { t, type Locale } from '@/lib/i18n';
import { useDocumentTitle } from '@/app/useDocumentTitle';
import './toolkit.css';

const GROUPS = [
  { title: 'Annotate and fill', ids: ['pdf-annotate', 'pdf-forms', 'pdf-protection'] },
  { title: 'Arrange pages', ids: ['pdf-merge', 'pdf-split', 'pdf-organize', 'pdf-extract-pages', 'pdf-delete-pages', 'pdf-rotate'] },
  { title: 'Convert and extract', ids: ['pdf-from-images', 'pdf-to-images', 'pdf-extract-text', 'pdf-extract-images', 'pdf-ocr', 'image-ocr'] },
  { title: 'Finish your document', ids: ['pdf-compress', 'pdf-crop', 'pdf-watermark', 'pdf-page-numbers', 'pdf-metadata', 'pdf-inspector'] },
];
const WORKSPACES = [...pdfTools,
  { id: 'pdf-protection', name: 'PDF passwords', description: 'Protect a copy with AES-256 or unlock it locally with your password, preserving text and forms.', icon: LockKeyhole, load: () => import('./PdfProtection') },
  { id: 'pdf-annotate', name: 'Annotate & sign', description: 'Highlight text, draw, add notes and visual signatures. Keep editable drafts on this device.', icon: Highlighter, load: () => import('./PdfAnnotate') },
  { id: 'pdf-forms', name: 'Fill PDF forms', description: 'Fill text fields, checkboxes, radio buttons and lists, then export an editable PDF copy.', icon: FormInput, load: () => import('./PdfForms') },
];

export function PdfToolkit({ file, onRead, onSource, onLanguage }: { file: File | null; onRead(file: File): void; onSource(file: File | null): void; onLanguage(locale: Locale): void }) {
  const location = useLocation();
  const id = location.pathname.split('/')[3];
  const tool = WORKSPACES.find((entry) => entry.id === id && entry.id !== 'pdf-viewer');
  useDocumentTitle(t(tool?.name ?? 'PDF Toolkit'));
  const Tool = useMemo(() => (tool ? lazy(tool.load) : null), [tool]);
  const context = useMemo(() => ({ file, openResult: onRead, setSource: onSource }), [file, onRead, onSource]);
  const [query, setQuery] = useState('');
  return (
    <PdfWorkspaceContext value={context}>
      <div className="pdf-toolkit">
        <header className="pdf-kit-header">
          <Link to={tool ? '/read/tools' : '/read'} aria-label={tool ? t('All PDF tools') : t('Back to library')}>
            <ArrowLeft size={22} />
          </Link>
          <div><span>{t('LocalKit PDF')}</span><h1>{t(tool?.name ?? 'PDF Toolkit')}</h1></div>
          <LanguageToggle onChange={onLanguage} />
          {file && <button className="reader-icon" onClick={() => onRead(file)} aria-label={t('Read source PDF')}><BookOpen size={22} /></button>}
          <Link to="/read" className="pdf-kit-library" aria-label={t('PDF library')}><BookOpen size={22} /></Link>
        </header>
        <main className="pdf-kit-content">
          <p className="pdf-kit-privacy"><ShieldCheck size={17} />{t('Every export is a new file. Your originals stay unchanged.')}</p>
          {tool && Tool ? (
            <>
              <p className="pdf-kit-description">{t(tool.description)}</p>
              <ToolErrorBoundary toolId={tool.id}>
                <Suspense fallback={<div className="pdf-kit-loading"><Spinner />{t('Opening your workspace…')}</div>}>
                  <Tool key={tool.id} />
                </Suspense>
              </ToolErrorBoundary>
            </>
          ) : (
            <>
              {id && <p role="status">{t('That workspace is unavailable. Choose a PDF tool below.')}</p>}
              <p className="pdf-kit-description">{t('Read, arrange, convert, and finish your documents in one private workspace.')}</p>
              {file && <p className="pdf-kit-source">{t('Ready to edit: {name}', { name: file.name })}</p>}
              <input className="reader-input" type="search" aria-label={t('Find a PDF tool')} placeholder={t('Find a PDF tool')} value={query} onChange={(e) => setQuery(e.target.value)} />
              {GROUPS.map((group) => {
                const tools = group.ids.map((item) => WORKSPACES.find((entry) => entry.id === item)!).filter((entry) => (t(entry.name) + ' ' + t(entry.description)).toLocaleLowerCase().includes(query.toLocaleLowerCase()));
                if (!tools.length) return null;
                return <section key={group.title} className="pdf-kit-group"><h2>{t(group.title)}</h2><div className="pdf-kit-grid">
                  {tools.map((entry) => <Link key={entry.id} to={'/read/tools/' + entry.id}><entry.icon size={24} /><div><h3>{t(entry.name)}</h3><p>{t(entry.description)}</p></div></Link>)}
                </div></section>;
              })}
              {query && !WORKSPACES.some((entry) => GROUPS.some((group) => group.ids.includes(entry.id)) && (t(entry.name) + ' ' + t(entry.description)).toLocaleLowerCase().includes(query.toLocaleLowerCase())) && <p role="status">{t('No PDF tools match your search.')}</p>}
            </>
          )}
        </main>
      </div>
    </PdfWorkspaceContext>
  );
}
