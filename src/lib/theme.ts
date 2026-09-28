import { useSyncExternalStore } from 'react';
import { readRaw, writeRaw } from './storage/local';

export type ThemePreference = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

/** Stored as a raw string because the pre-paint script in index.html reads it directly. */
const THEME_KEY = 'theme';
const THEME_COLORS: Record<ResolvedTheme, string> = { light: '#f6f7f9', dark: '#0b0e14' };

const media = typeof window !== 'undefined' ? window.matchMedia('(prefers-color-scheme: light)') : null;

function readPreference(): ThemePreference {
  const raw = readRaw(THEME_KEY);
  return raw === 'light' || raw === 'dark' ? raw : 'system';
}

function resolve(pref: ThemePreference): ResolvedTheme {
  if (pref === 'system') return media?.matches ? 'light' : 'dark';
  return pref;
}

interface ThemeState {
  preference: ThemePreference;
  resolved: ResolvedTheme;
}

let state: ThemeState = { preference: readPreference(), resolved: resolve(readPreference()) };
const listeners = new Set<() => void>();

function apply(resolved: ResolvedTheme) {
  const root = document.documentElement;
  if (root.dataset.theme === resolved) return;
  // Suppress transitions while every token flips at once.
  root.classList.add('lk-theme-switching');
  root.dataset.theme = resolved;
  root.style.colorScheme = resolved;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLORS[resolved]);
  requestAnimationFrame(() => requestAnimationFrame(() => root.classList.remove('lk-theme-switching')));
}

function update(preference: ThemePreference) {
  const next = { preference, resolved: resolve(preference) };
  if (next.preference === state.preference && next.resolved === state.resolved) return;
  state = next;
  apply(state.resolved);
  listeners.forEach((l) => l());
}

export function setThemePreference(preference: ThemePreference) {
  writeRaw(THEME_KEY, preference === 'system' ? null : preference);
  update(preference);
}

export function cycleTheme() {
  setThemePreference(state.resolved === 'dark' ? 'light' : 'dark');
}

export function getTheme(): ThemeState {
  return state;
}

if (typeof window !== 'undefined') {
  apply(state.resolved);
  media?.addEventListener('change', () => {
    if (state.preference === 'system') update('system');
  });
  window.addEventListener('storage', (event) => {
    if (event.key === 'localkit:' + THEME_KEY) update(readPreference());
  });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useTheme(): ThemeState {
  return useSyncExternalStore(subscribe, getTheme, getTheme);
}
