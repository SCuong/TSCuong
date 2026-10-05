import { createContext, useContext } from 'react';

/** Optional mobile workspace integration; desktop tools keep their existing behavior. */
export const PdfWorkspaceContext = createContext<{
  file: File | null;
  setSource(file: File | null): void;
  openResult(file: File): void;
} | null>(null);

export function usePdfWorkspace() {
  return useContext(PdfWorkspaceContext);
}
