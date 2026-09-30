import { readRaw, writeRaw } from './storage/local';

/**
 * Interface language.
 *
 * Strings are written in English in the source and wrapped in `t()`; the English text is the
 * lookup key for the translation, so a missing translation simply shows the English original.
 * The dictionary is loaded once, before the app renders, and changing the language saves the
 * choice and reloads the page, so every component and module-level label picks it up.
 */
export type Locale = 'en' | 'vi';

export const LOCALES: ReadonlyArray<{ id: Locale; label: string }> = [
  { id: 'en', label: 'English' },
  { id: 'vi', label: 'Tiếng Việt' },
];

const LOCALE_KEY = 'locale';

let locale: Locale = 'en';
let messages: ReadonlyMap<string, string> | null = null;
let ready = false;

export type Params = Record<string, string | number>;

function detectLocale(): Locale {
  const saved = readRaw(LOCALE_KEY);
  if (saved === 'en' || saved === 'vi') return saved;
  const preferred = typeof navigator !== 'undefined' ? (navigator.languages?.[0] ?? navigator.language ?? '') : '';
  return /^vi\b/i.test(preferred) ? 'vi' : 'en';
}

/** Loads the saved (or browser) language. The app renders once this settles. */
export async function initLocale(): Promise<void> {
  if (detectLocale() === 'vi') {
    try {
      const { default: vi } = await import('@/i18n/vi');
      messages = new Map(Object.entries(vi));
      locale = 'vi';
    } catch {
      // The dictionary could not be loaded (offline before it was ever cached): stay in English.
    }
  }
  ready = true;
  document.documentElement.lang = locale;
}

export function getLocale(): Locale {
  return locale;
}

/** Saves the choice and reloads the page in that language. Pages with unsaved work can still cancel. */
export function setLocale(next: Locale) {
  writeRaw(LOCALE_KEY, next);
  if (next !== locale) window.location.reload();
}

function format(template: string, params: Params): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => (Object.hasOwn(params, key) ? String(params[key]) : match));
}

/**
 * Translates `text` (English) into the current language, filling `{name}` placeholders from `params`.
 * Pass whole sentences with placeholders, never fragments glued together, so word order can change.
 */
export function t(text: string, params?: Params): string {
  if (import.meta.env.DEV && import.meta.env.MODE !== 'test' && !ready) {
    console.error(`t() ran before the language loaded (move it into a component or function): ${text}`);
  }
  const template = messages?.get(text) ?? text;
  return params ? format(template, params) : template;
}

/** Test hook: switch the dictionary without storage or a reload. */
export function setMessagesForTests(next: Locale, dictionary: Record<string, string> | null) {
  locale = next;
  messages = dictionary ? new Map(Object.entries(dictionary)) : null;
  ready = true;
}
