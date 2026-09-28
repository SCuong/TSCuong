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
        <Spinner label={`Opening ${state.name}…`} />
      </div>
    );
  }

  if (state.status === 'password') {
    return <PasswordPrompt name={state.file.name} error={state.error} onSubmit={submitPassword} onCancel={reset} />;
  }

  return (
    <div className="flex flex-col gap-3">
      {state.status === 'error' && <ErrorMessage error={state.error} title="Could not open the PDF" />}
      <FileDrop
        accept={PDF_ACCEPT}
        onFiles={(files) => void open(files[0])}
        title={title}
        icon={FileText}
        hint={hint ?? 'PDF files are processed on this device and never uploaded.'}
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
          <span>{pluralize(pdf.pageCount, 'page')}</span>
          <span aria-hidden>·</span>
          <span>{formatBytes(pdf.file.size)}</span>
          {pdf.encrypted && (
            <Badge tone="warning" className="ml-0.5">
              <Lock size={11} aria-hidden /> Encrypted
            </Badge>
          )}
        </p>
      </div>
      <div className="flex items-center gap-1.5">
        {extra}
        <Button size="sm" variant="secondary" icon={RefreshCw} onClick={() => input.current?.click()}>
          Change
        </Button>
        <IconButton icon={X} label="Close file" size="sm" onClick={onClose} />
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
          <p className="text-sm font-medium break-words text-fg">"{name}" is password-protected</p>
          <p className="text-[13px] text-fg-muted">
            Enter the password to open it. The password is only used in this tab to decrypt the file.
          </p>
        </div>
      </div>
      <div className="max-w-sm">
        <Label htmlFor={id}>Password</Label>
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
          Open PDF
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          Choose another file
        </Button>
      </div>
    </form>
  );
}

/**
 * Warning for encrypted PDFs in tools that rewrite the file with pdf-lib.
 * Returns whether the tool may proceed.
 */
export function useEncryptionGate(pdf: LoadedPdf | null) {
  const [allowed, setAllowed] = useState<LoadedPdf | null>(null);
  const ok = !pdf?.encrypted || allowed === pdf;
  const notice = pdf?.encrypted ? (
    <Alert
      tone="warning"
      title="This PDF is encrypted"
      action={
        allowed === pdf ? undefined : (
          <Button size="sm" variant="secondary" onClick={() => setAllowed(pdf)}>
            Try anyway
          </Button>
        )
      }
    >
      {pdf.password
        ? 'It is protected with an open password. The in-browser PDF editor cannot re-encrypt or decrypt files, so edited pages may come out blank or unreadable. '
        : 'It has permission restrictions (an owner password). The in-browser PDF editor cannot decrypt it, so the result may be blank or unreadable. '}
      {allowed === pdf
        ? 'You chose to try anyway: check the result before relying on it.'
        : 'Remove the protection in your PDF app first for reliable results.'}
    </Alert>
  ) : null;
  return { ok, ignoreEncryption: Boolean(pdf?.encrypted && allowed === pdf), notice };
}
