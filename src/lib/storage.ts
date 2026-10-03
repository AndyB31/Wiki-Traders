import { ext } from './browser';
import { DEFAULT_META, DEFAULT_SETTINGS, DEFAULT_STORE } from './defaults';
import type { StoreShape } from './types';

export type StoreKey = keyof StoreShape;

/** Lit des clés de chrome.storage.local avec leurs valeurs par défaut. */
export async function load<K extends StoreKey>(...keys: K[]): Promise<Pick<StoreShape, K>> {
  const raw = (await ext.storage.local.get(keys)) as Partial<StoreShape>;
  const out = {} as Pick<StoreShape, K>;
  for (const k of keys) {
    const v = raw[k] ?? structuredClone(DEFAULT_STORE[k]);
    (out as Record<string, unknown>)[k] = v;
  }
  if ('settings' in out) (out as Pick<StoreShape, 'settings'>).settings = { ...DEFAULT_SETTINGS, ...(out as Pick<StoreShape, 'settings'>).settings };
  if ('meta' in out) (out as Pick<StoreShape, 'meta'>).meta = { ...DEFAULT_META, ...(out as Pick<StoreShape, 'meta'>).meta };
  return out;
}

export async function loadAll(): Promise<StoreShape> {
  return load(...(Object.keys(DEFAULT_STORE) as StoreKey[]));
}

export async function save(patch: Partial<StoreShape>): Promise<void> {
  await ext.storage.local.set(patch);
}

export async function clearAll(): Promise<void> {
  await ext.storage.local.clear();
}

/** Appelle `cb` quand une des clés change. */
export function onStoreChange(keys: StoreKey[], cb: () => void): void {
  ext.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && keys.some((k) => k in changes)) cb();
  });
}
