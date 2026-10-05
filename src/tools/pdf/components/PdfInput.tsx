import { useId, useRef, useState, type ReactNode } from 'react';
import { FileText, Lock, RefreshCw, X } from 'lucide-react';
import { FileDrop, matchesAccept } from '@/components/ui/FileDrop';
import { Alert, ErrorMessage } from '@/components/ui/Alert';
import { Button, IconButton } from '@/components/ui/Button';
import { Input, Label } from '@/components/ui/Field';
import { Badge } from '@/components/ui/Panel';
import { Spinner } from '@/components/ui/Feedback';
import { formatBytes, pluralize } from '@/lib/utils';
import type { LoadedPdf, PdfFileController } from './usePdfFile';
import { t } from '@/lib/i18n';
import { usePdfWorkspace } from './PdfWorkspaceContext';
import { readerErrorMessage } from '@/reader/errorMessage';
import { Link } from 'react-router';

export const PDF_ACCEPT = 'application/pdf,.pdf';

/**
 * Standard single-PDF input for tools: drop zone, loading, password prompt,
 * friendly errors and a compact file bar once the document is open.
 */
export function PdfInput({
  controller,
  children,
  title = 'Drop a PDF here',
  hint,
}: {
  controller: PdfFileController;
  children: (pdf: LoadedPdf) => ReactNode;
  title?: ReactNode;
  hint?: ReactNode;
}) {
  const { state, open, submitPassword, reset } = controller;
  const workspace = usePdfWorkspace();

  if (state.status === 'ready') {
    return (
      <>
        <PdfFileBar pdf={state.pdf} onReplace={open} onClose={reset} />
        {children(state.pdf)}
      </>
    );
  }

  if (state.status === 'loading') {
    return (
      <div className="flex min-h-40 items-center justify-center rounded-xl border border-line bg-surface shadow-card">
        <Spinner label={t('Opening {name}…', { name: state.name })} />
      </div>
    );
  }

  if (state.status === 'password') {
    return <PasswordPrompt name={state.file.name} error={state.error && workspace ? t('That PDF password is incorrect. Try again.') : state.error} onSubmit={submitPassword} onCancel={reset} />;
  }

  return (
    <div className="flex flex-col gap-3">
      {state.status === 'error' && <ErrorMessage error={workspace ? readerErrorMessage(state.error, state.name) : state.error} title={t('Could not open the PDF')} />}
      <FileDrop
        accept={PDF_ACCEPT}
        onFiles={(files) => void open(files[0])}
        title={title}
        icon={FileText}
        hint={hint ?? t('PDF files are processed on this device and never uploaded.')}
      />
    </div>
  );
}

export function PdfFileBar({
  pdf,
  onReplace,
  onClose,
  extra,
}: {
  pdf: LoadedPdf;
  onReplace: (file: File) => void;
  onClose: () => void;
  extra?: ReactNode;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const file = Array.from(e.dataTransfer.files).find((f) => matchesAccept(f, PDF_ACCEPT));
        if (file) onReplace(file);
      }}
      className={`flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border bg-surface px-3 py-2.5 shadow-card ${
        over ? 'border-accent bg-accent-soft' : 'border-line'
      }`}
    >
      <div className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-line bg-surface-raised text-fg-secondary">
        <FileText size={17} aria-hidden />
      </div>
      <div className="min-w-0 flex-1 basis-40">
        <p className="truncate text-[13.5px] font-medium text-fg" title={pdf.file.name}>
          {pdf.file.name}
        </p>
        <p className="flex flex-wrap items-center gap-x-2 text-[12.5px] text-fg-muted">
          <span>{pluralize(pdf.pageCount, t('page'), t('pages'))}</span>
          <span aria-hidden>·</span>
          <span>{formatBytes(pdf.file.size)}</span>
          {pdf.encrypted && (
            <Badge tone="warning" className="ml-0.5">
              <Lock size={11} aria-hidden />{' '}{t('Encrypted')}
            </Badge>
          )}
        </p>
      </div>
      <div className="flex items-center gap-1.5">
        {extra}
        <Button size="sm" variant="secondary" icon={RefreshCw} onClick={() => input.current?.click()}>
          {t('Change')}
        </Button>
        <IconButton icon={X} label={t('Close file')} size="sm" onClick={onClose} />
        <input
          ref={input}
          type="file"
          accept={PDF_ACCEPT}
          className="sr-only"
          tabIndex={-1}
          aria-hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onReplace(file);
            e.target.value = '';
          }}
        />
      </div>
    </div>
  );
}

function PasswordPrompt({
  name,
  error,
  onSubmit,
  onCancel,
}: {
  name: string;
  error?: string;
  onSubmit: (password: string) => void;
  onCancel: () => void;
}) {
  const [password, setPassword] = useState('');
  const id = useId();
  return (
    <form
      className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-4 shadow-card sm:p-5"
      onSubmit={(e) => {
        e.preventDefault();
        if (password) onSubmit(password);
      }}
    >
      <div className="flex items-start gap-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-line bg-surface-raised text-warning">
          <Lock size={17} aria-hidden />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-medium break-words text-fg">{t('"{name}" is password-protected', { name })}</p>
          <p className="text-[13px] text-fg-muted">
            {t('Enter the password to open it. The password is only used in this tab to decrypt the file.')}
          </p>
        </div>
      </div>
      <div className="max-w-sm">
        <Label htmlFor={id}>{t('Password')}</Label>
        <Input
          id={id}
          type="password"
          autoComplete="off"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          aria-invalid={error ? true : undefined}
          autoFocus
        />
        {error && (
          <p role="alert" className="mt-1.5 text-[13px] text-danger">
            {error}
          </p>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="primary" disabled={!password}>
          {t('Open PDF')}
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          {t('Choose another file')}
        </Button>
      </div>
    </form>
  );
}

/**
 * What an edit does to an encrypted PDF. The in-browser editor (pdf-lib) can neither decrypt
 * nor encrypt, so:
 * - 'copy': pages are copied into a new file, where their still-encrypted content is unreadable
 *   (blank pages);
 * - 'draw': new text or images are added to the file, but readers "decrypt" them into garbage,
 *   so the additions do not show up;
 * - 'structure': only page boxes, rotation or dictionary entries change; the file keeps its
 *   encryption and stays readable with the same password.
 */
export type EncryptionImpact = 'copy' | 'draw' | 'structure';

const PROTECTION_HINT = 'Remove the protection in your PDF app first (for example by printing to a new PDF), then open that copy here.';

/**
 * Notice (and, where the result would be broken, a gate) for encrypted PDFs in tools that
 * rewrite the file with pdf-lib. `ok` says whether the tool may proceed. `detail` replaces the
 * default explanation of what goes wrong for 'copy'/'draw' tools.
 */
export function useEncryptionGate(pdf: LoadedPdf | null, impact: EncryptionImpact, detail?: string) {
  const workspace = usePdfWorkspace();
  const [allowed, setAllowed] = useState<LoadedPdf | null>(null);
  if (!pdf?.encrypted) return { ok: true, ignoreEncryption: false, notice: null };
  const protection = pdf.password ? 'an open password' : 'permission restrictions (an owner password)';
  if (impact === 'structure') {
    return {
      ok: true,
      ignoreEncryption: true,
      notice: (
        <Alert tone="info" title={t('This PDF is encrypted')}>
          {pdf.password
            ? t('It is protected with {protection}. The edited copy keeps the same protection, so it opens with the same password.', { protection })
            : t('It is protected with {protection}. The edited copy keeps the same protection.', { protection })}
        </Alert>
      ),
    };
  }
  if (workspace) return {
    ok: false, ignoreEncryption: false,
    notice: <Alert tone="warning" title={t('This PDF is encrypted')}>{t('Unlock a copy in PDF passwords before using this tool. Text and forms will be preserved.')} <Link className="text-accent underline" to="/read/tools/pdf-protection">{t('PDF passwords')}</Link></Alert>,
  };
  const tried = allowed === pdf;
  const consequence =
    detail ??
    (impact === 'copy'
      ? 'Pages copied out of an encrypted PDF come out blank or unreadable, because the in-browser PDF editor cannot decrypt them.'
      : 'Text or images added to an encrypted PDF will not show up, because the in-browser PDF editor cannot encrypt them with the file’s key.');
  return {
    ok: tried && !workspace,
    ignoreEncryption: tried,
    notice: (
      <Alert
        tone="warning"
        title={t('This PDF is encrypted')}
        action={
          tried || workspace ? undefined : (
            <Button size="sm" variant="secondary" onClick={() => setAllowed(pdf)}>
              {t('Try anyway')}
            </Button>
          )
        }
      >
        {t('It is protected with {protection}. {consequence}', { protection, consequence })}{' '}
        {tried ? t('You chose to try anyway: check the result before relying on it.') : PROTECTION_HINT}
      </Alert>
    ),
  };
}
