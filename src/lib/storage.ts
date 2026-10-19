import { ext } from './browser';
import { DEFAULT_META, DEFAULT_SETTINGS, DEFAULT_STORE } from './defaults';
import { migrateRateRules } from './sellrate';
import type { Settings, StoreShape, TagRule } from './types';

export type StoreKey = keyof StoreShape;

/** Lit des clés de chrome.storage.local avec leurs valeurs par défaut. */
export async function load<K extends StoreKey>(...keys: K[]): Promise<Pick<StoreShape, K>> {
  const raw = (await ext.storage.local.get(keys)) as Partial<StoreShape>;
  const out = {} as Pick<StoreShape, K>;
  for (const k of keys) {
    const v = raw[k] ?? structuredClone(DEFAULT_STORE[k]);
    (out as Record<string, unknown>)[k] = v;
  }
  if ('settings' in out) (out as Pick<StoreShape, 'settings'>).settings = migrateSettings((out as Pick<StoreShape, 'settings'>).settings);
  if ('rules' in out) (out as Pick<StoreShape, 'rules'>).rules = migrateRules((out as Pick<StoreShape, 'rules'>).rules);
  if ('meta' in out) (out as Pick<StoreShape, 'meta'>).meta = { ...DEFAULT_META, ...(out as Pick<StoreShape, 'meta'>).meta };
  return out;
}

/** Réglages complétés des valeurs par défaut, paliers de taux de vente d'avant la 1.0 convertis. */
export function migrateSettings(stored: Partial<Settings> | undefined): Settings {
  const s = { ...DEFAULT_SETTINGS, ...(stored ?? {}) };
  return { ...s, sellRateRules: migrateRateRules(s.sellRateRules) };
}

export function migrateRules(rules: TagRule[]): TagRule[] {
  return rules.map((r) => (r.sale ? { ...r, sale: { ...r.sale, sellRateRules: migrateRateRules(r.sale.sellRateRules) } } : r));
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
