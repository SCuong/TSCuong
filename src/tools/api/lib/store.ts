import { collection } from '@/lib/storage/db';
import { readRaw, writeRaw } from '@/lib/storage/local';
import type { ApiCollection, ApiEnvironment, HistoryEntry, SavedRequest } from './model';
import { DEFAULT_COMPANION_PORT } from './companion';

/** IndexedDB collections used by the API client (defined in src/lib/storage/db.ts). */
export const requestsDb = collection<SavedRequest>('apiRequests');
export const collectionsDb = collection<ApiCollection>('apiCollections');
export const environmentsDb = collection<ApiEnvironment>('apiEnvironments');
export const historyDb = collection<HistoryEntry>('apiHistory');

/** kv key for the editor session (current draft and the saved request it belongs to). */
export const SESSION_KEY = 'api-client:session';

export type SendVia = 'browser' | 'companion';

export interface ClientSettings {
  via: SendVia;
  port: number;
  token: string;
  activeEnvId: string | null;
}

const SETTINGS_KEY = 'api-client:settings';

/** Small preferences in localStorage (the companion token lives here, as documented). */
export function loadSettings(): ClientSettings {
  const fallback: ClientSettings = { via: 'browser', port: DEFAULT_COMPANION_PORT, token: '', activeEnvId: null };
  const raw = readRaw(SETTINGS_KEY);
  if (!raw) return fallback;
  try {
    const data = JSON.parse(raw) as Partial<ClientSettings>;
    return {
      via: data.via === 'companion' ? 'companion' : 'browser',
      port: Number.isInteger(data.port) && data.port! > 0 && data.port! < 65536 ? data.port! : DEFAULT_COMPANION_PORT,
      token: typeof data.token === 'string' ? data.token : '',
      activeEnvId: typeof data.activeEnvId === 'string' ? data.activeEnvId : null,
    };
  } catch {
    return fallback;
  }
}

export function saveSettings(settings: ClientSettings) {
  writeRaw(SETTINGS_KEY, JSON.stringify(settings));
}
