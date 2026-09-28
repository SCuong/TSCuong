import { useSyncExternalStore } from 'react';

let open = false;
let initialQuery = '';
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function openPalette(query = '') {
  initialQuery = query;
  open = true;
  emit();
}

export function closePalette() {
  open = false;
  emit();
}

export function togglePalette() {
  if (open) closePalette();
  else openPalette();
}

export function getPaletteInitialQuery() {
  return initialQuery;
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export function usePaletteOpen(): boolean {
  return useSyncExternalStore(subscribe, () => open, () => open);
}
