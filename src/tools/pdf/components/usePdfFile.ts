import { useCallback, useEffect, useRef, useState } from 'react';
import { readPdfFile, looksEncrypted } from '../lib/bytes';
import { toPdfError } from '../lib/errors';
import { openPdf, type OpenedPdf, type PDFDocumentProxy } from '../lib/pdfjs';
import { releaseThumbnails } from '../lib/thumbnails';
import { usePdfWorkspace } from './PdfWorkspaceContext';

export interface LoadedPdf {
  file: File;
  bytes: Uint8Array;
  doc: PDFDocumentProxy;
  pageCount: number;
  /** The file has an /Encrypt dictionary (owner and/or user password). */
  encrypted: boolean;
  /** Password used to open it, if one was needed. */
  password?: string;
}

export type PdfFileState =
  | { status: 'idle' }
  | { status: 'loading'; name: string }
  | { status: 'password'; file: File; bytes: Uint8Array; error?: string }
  | { status: 'error'; error: string; name?: string }
  | { status: 'ready'; pdf: LoadedPdf };

/**
 * Load a PDF for a tool: validates the file, opens it with pdf.js (asking for
 * a password when needed), and destroys the previous document (plus its
 * thumbnails) when replaced or when the component unmounts.
 */
export function usePdfFile() {
  const workspace = usePdfWorkspace();
  const initialFile = workspace?.file;
  const setSource = workspace?.setSource;
  const source = useRef<File | null>(null);
  const [state, setState] = useState<PdfFileState>({ status: 'idle' });
  const opened = useRef<OpenedPdf | null>(null);
  const generation = useRef(0);

  const dispose = useCallback(() => {
    if (opened.current) {
      releaseThumbnails(opened.current.doc);
      opened.current.destroy();
      opened.current = null;
    }
  }, []);

  useEffect(
    () => () => {
      source.current = null;
      generation.current++;
      dispose();
    },
    [dispose],
  );

  const openBytes = useCallback(
    async (file: File, bytes: Uint8Array, password: string | undefined, gen: number) => {
      try {
        const result = await openPdf(bytes, { password, fileName: file.name });
        if (gen !== generation.current) {
          result.destroy();
          return;
        }
        let encrypted = looksEncrypted(bytes);
        try {
          const meta = await result.doc.getMetadata();
          const info = meta.info as Record<string, unknown> | undefined;
          if (info?.EncryptFilterName) encrypted = true;
        } catch {
          /* metadata is optional */
        }
        if (gen !== generation.current) {
          result.destroy();
          return;
        }
        dispose();
        opened.current = result;
        setState({
          status: 'ready',
          pdf: { file, bytes, doc: result.doc, pageCount: result.doc.numPages, encrypted, password },
        });
      } catch (error) {
        if (gen !== generation.current) return;
        const e = toPdfError(error, file.name);
        if (e.kind === 'password' || e.kind === 'wrong-password') {
          setState({ status: 'password', file, bytes, error: e.kind === 'wrong-password' ? e.message : undefined });
        } else {
          setState({ status: 'error', error: e.message, name: file.name });
        }
      }
    },
    [dispose],
  );

  const open = useCallback(
    async (file: File) => {
      source.current = file;
      setSource?.(file);
      const gen = ++generation.current;
      dispose();
      setState({ status: 'loading', name: file.name });
      try {
        const bytes = await readPdfFile(file);
        if (gen !== generation.current) return;
        await openBytes(file, bytes, undefined, gen);
      } catch (error) {
        if (gen !== generation.current) return;
        setState({ status: 'error', error: toPdfError(error, file.name).message, name: file.name });
      }
    },
    [openBytes, dispose, setSource],
  );

  const submitPassword = useCallback(
    async (password: string) => {
      if (state.status !== 'password') return;
      const gen = ++generation.current;
      const { file, bytes } = state;
      setState({ status: 'loading', name: file.name });
      await openBytes(file, bytes, password, gen);
    },
    [state, openBytes],
  );

  const reset = useCallback(() => {
    source.current = null;
    setSource?.(null);
    generation.current++;
    dispose();
    setState({ status: 'idle' });
  }, [dispose, setSource]);

  useEffect(() => {
    if (source.current !== initialFile && (initialFile?.type === 'application/pdf' || initialFile?.name.toLowerCase().endsWith('.pdf'))) void open(initialFile);
  }, [initialFile, open]);

  return { state, open, submitPassword, reset, pdf: state.status === 'ready' ? state.pdf : null };
}

export type PdfFileController = ReturnType<typeof usePdfFile>;
