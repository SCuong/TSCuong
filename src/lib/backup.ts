import { COLLECTIONS, NON_EXPORTABLE, collection, getDB, kvEntries, kvSet, type CollectionName } from './storage/db';
import { listLocalKeys, readRaw, writeRaw } from './storage/local';
import { ALL_LOCAL_STORES } from './userPrefs';

export const BACKUP_FORMAT = 'localkit-backup';
export const BACKUP_VERSION = 1;

export interface Backup {
  format: typeof BACKUP_FORMAT;
  version: number;
  createdAt: string;
  local: Record<string, string>;
  collections: Partial<Record<CollectionName, unknown[]>>;
  kv: Array<[string, unknown]>;
}

/** Keys that are never exported (derived or device-specific). */
const LOCAL_EXCLUDE = [/^tool:/];

export async function createBackup(): Promise<Backup> {
  const local: Record<string, string> = {};
  for (const key of listLocalKeys()) {
    if (LOCAL_EXCLUDE.some((re) => re.test(key))) continue;
    const value = readRaw(key);
    if (value !== null) local[key] = value;
  }
  const collections: Backup['collections'] = {};
  for (const name of COLLECTIONS) {
    if (NON_EXPORTABLE.has(name)) continue;
    collections[name] = await collection(name).all();
  }
  const kv = (await kvEntries()).filter(([, value]) => isCloneableToJson(value));
  return { format: BACKUP_FORMAT, version: BACKUP_VERSION, createdAt: new Date().toISOString(), local, collections, kv };
}

function isCloneableToJson(value: unknown): boolean {
  try {
    JSON.stringify(value);
    return !(value instanceof Blob);
  } catch {
    return false;
  }
}

export interface BackupSummary {
  createdAt: string;
  settings: number;
  items: Partial<Record<CollectionName, number>>;
}

export function parseBackup(text: string): { backup: Backup; summary: BackupSummary } {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('This file is not valid JSON, so it cannot be a LocalKit backup.');
  }
  const b = data as Partial<Backup>;
  if (!b || typeof b !== 'object' || b.format !== BACKUP_FORMAT) {
    throw new Error('This JSON file is not a LocalKit backup.');
  }
  if (typeof b.version !== 'number' || b.version > BACKUP_VERSION) {
    throw new Error('This backup was made by a newer version of LocalKit. Update the app and try again.');
  }
  if (typeof b.local !== 'object' || b.local === null || typeof b.collections !== 'object' || b.collections === null) {
    throw new Error('The backup file is incomplete or damaged.');
  }
  const items: BackupSummary['items'] = {};
  for (const name of COLLECTIONS) {
    const list = (b.collections as Record<string, unknown>)[name];
    if (list === undefined) continue;
    if (!Array.isArray(list) || !list.every((x) => typeof x === 'object' && x !== null && typeof (x as { id?: unknown }).id === 'string')) {
      throw new Error(`The backup's "${name}" data is damaged.`);
    }
    items[name] = list.length;
  }
  const backup: Backup = {
    format: BACKUP_FORMAT,
    version: b.version,
    createdAt: typeof b.createdAt === 'string' ? b.createdAt : '',
    local: Object.fromEntries(Object.entries(b.local).filter(([, v]) => typeof v === 'string')) as Record<string, string>,
    collections: b.collections as Backup['collections'],
    kv: Array.isArray(b.kv) ? b.kv.filter((e): e is [string, unknown] => Array.isArray(e) && typeof e[0] === 'string') : [],
  };
  return { backup, summary: { createdAt: backup.createdAt, settings: Object.keys(backup.local).length, items } };
}

/**
 * Restores a backup. `merge` keeps existing items and overwrites ones with
 * the same id; `replace` clears each collection present in the backup first.
 */
export async function restoreBackup(backup: Backup, mode: 'merge' | 'replace'): Promise<void> {
  for (const [key, value] of Object.entries(backup.local)) writeRaw(key, value);
  for (const store of ALL_LOCAL_STORES) store.reload();
  await getDB();
  for (const name of COLLECTIONS) {
    const list = backup.collections[name];
    if (!list || NON_EXPORTABLE.has(name)) continue;
    const coll = collection<{ id: string }>(name);
    if (mode === 'replace') await coll.clear();
    await coll.putMany(list as Array<{ id: string }>);
  }
  for (const [key, value] of backup.kv) await kvSet(key, value);
}

export async function clearAllData(): Promise<void> {
  for (const key of listLocalKeys()) {
    if (key === 'theme') continue;
    writeRaw(key, null);
  }
  for (const store of ALL_LOCAL_STORES) store.reload();
  for (const name of COLLECTIONS) await collection(name).clear();
  const db = await getDB();
  if (db) await db.clear('kv');
}
