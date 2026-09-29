/**
 * Loads @peculiar/x509 on demand.
 *
 * The library's dependency injection container (tsyringe) throws at import time unless a Reflect
 * metadata API is present, and the `reflect-metadata` package is not installed. This installs the
 * small subset it uses (define/get/has metadata and the `Reflect.metadata` decorator factory),
 * only when missing, before the dynamic import.
 */

type MetadataMap = Map<unknown, unknown>;

interface ReflectMetadataApi {
  defineMetadata(key: unknown, value: unknown, target: object, property?: string | symbol): void;
  getOwnMetadata(key: unknown, target: object, property?: string | symbol): unknown;
  hasOwnMetadata(key: unknown, target: object, property?: string | symbol): boolean;
  getMetadata(key: unknown, target: object, property?: string | symbol): unknown;
  hasMetadata(key: unknown, target: object, property?: string | symbol): boolean;
  metadata(key: unknown, value: unknown): (target: object, property?: string | symbol) => void;
}

export function ensureReflectMetadata(): void {
  const R = Reflect as unknown as Partial<ReflectMetadataApi>;
  if (typeof R.getMetadata === 'function' && typeof R.defineMetadata === 'function') return;
  const store = new WeakMap<object, Map<string | symbol | undefined, MetadataMap>>();
  const mapFor = (target: object, property: string | symbol | undefined, create: boolean): MetadataMap | undefined => {
    let byProperty = store.get(target);
    if (!byProperty) {
      if (!create) return undefined;
      byProperty = new Map();
      store.set(target, byProperty);
    }
    let map = byProperty.get(property);
    if (!map && create) {
      map = new Map();
      byProperty.set(property, map);
    }
    return map;
  };
  const api: ReflectMetadataApi = {
    defineMetadata: (key, value, target, property) => void mapFor(target, property, true)!.set(key, value),
    getOwnMetadata: (key, target, property) => mapFor(target, property, false)?.get(key),
    hasOwnMetadata: (key, target, property) => mapFor(target, property, false)?.has(key) ?? false,
    getMetadata: (key, target, property) => {
      for (let t: object | null = target; t; t = Object.getPrototypeOf(t) as object | null) {
        const map = mapFor(t, property, false);
        if (map?.has(key)) return map.get(key);
      }
      return undefined;
    },
    hasMetadata: (key, target, property) => api.getMetadata(key, target, property) !== undefined,
    metadata: (key, value) => (target, property) => api.defineMetadata(key, value, target, property),
  };
  for (const [name, fn] of Object.entries(api)) {
    if (typeof (R as Record<string, unknown>)[name] !== 'function') {
      Object.defineProperty(Reflect, name, { value: fn, configurable: true, writable: true });
    }
  }
}

let pending: Promise<typeof import('@peculiar/x509')> | null = null;

export function loadX509(): Promise<typeof import('@peculiar/x509')> {
  if (!pending) {
    ensureReflectMetadata();
    pending = import('@peculiar/x509');
    pending.catch(() => {
      pending = null;
    });
  }
  return pending;
}
