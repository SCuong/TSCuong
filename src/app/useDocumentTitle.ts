import { useEffect } from 'react';

const BASE = 'LocalKit';

/** Sets `document.title`; pass null for the home page title. */
export function useDocumentTitle(title: string | null) {
  useEffect(() => {
    document.title = title ? `${title} · ${BASE}` : `${BASE} — Local-first developer, document & media tools`;
  }, [title]);
}
