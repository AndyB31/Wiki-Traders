import { ext } from './browser';
import { DEFAULT_META, DEFAULT_SETTINGS, DEFAULT_STORE } from './defaults';
import { hasConditions, hasRange } from './conditions';
import { inheritCalc, legacyCalc } from './salecalc';
import { migrateRateRules } from './sellrate';
import { normalizeView } from './views';
import type { Priority, SellRateRule, Settings, StoreShape, TagRule } from './types';

export type StoreKey = keyof StoreShape;

/** Lit des clés de chrome.storage.local avec leurs valeurs par défaut. */
export async function load<K extends StoreKey>(...keys: K[]): Promise<Pick<StoreShape, K>> {
  // Réglages et étiquettes d'avant la 1.0 se convertissent ensemble : on lit toujours les deux.
  const fetch: StoreKey[] = keys.some((k) => k === 'rules' || k === 'settings') ? [...new Set<StoreKey>([...keys, 'rules', 'settings'])] : keys;
  const raw = (await ext.storage.local.get(fetch)) as Partial<StoreShape>;
  const out = {} as Pick<StoreShape, K>;
  for (const k of keys) {
    const v = raw[k] ?? structuredClone(DEFAULT_STORE[k]);
    (out as Record<string, unknown>)[k] = v;
  }
  if ('rules' in out) (out as Pick<StoreShape, 'rules'>).rules = migrateRules((out as Pick<StoreShape, 'rules'>).rules, raw.settings);
  if ('settings' in out) (out as Pick<StoreShape, 'settings'>).settings = migrateSettings((out as Pick<StoreShape, 'settings'>).settings, raw.rules);
  if ('meta' in out) (out as Pick<StoreShape, 'meta'>).meta = { ...DEFAULT_META, ...(out as Pick<StoreShape, 'meta'>).meta };
  return out;
}

/** Réglages enregistrés avant la 1.0 (mise de départ par étiquette, paliers de taux de vente, ordre `sortPrice`). */
type LegacySettings = Partial<Settings> & { sortPrice?: string; sellRateRules?: unknown; sellRateTiersOn?: boolean };
type LegacyRule = TagRule & { pct?: number; sale?: { sellRateRules?: unknown } };

const LEGACY_PRIORITY: Record<string, Priority> = { desc: 'value', asc: 'clear', random: 'balanced', custom: 'custom' };

function legacyTiers(stored: LegacySettings | undefined): SellRateRule[] {
  return stored?.sellRateTiersOn === false ? [] : migrateRateRules(stored?.sellRateRules);
}

/**
 * Réglages complétés des valeurs par défaut. Ceux d'avant la 1.0 sont convertis pour donner les mêmes ventes :
 * calcul par défaut sans influence du taux de vente (ou formule reprenant les paliers), ordre équivalent, et en mode
 * « meilleures cartes », seulement les cartes des étiquettes suivies.
 */
export function migrateSettings(stored: LegacySettings | undefined, rules?: LegacyRule[]): Settings {
  const s = { ...DEFAULT_SETTINGS, ...(stored ?? {}) } as Settings & LegacySettings;
  if (stored && 'sortPrice' in stored) {
    s.priority = LEGACY_PRIORITY[stored.sortPrice ?? ''] ?? 'balanced';
    s.defaultCalc = legacyCalc(70, legacyTiers(stored), DEFAULT_SETTINGS.defaultCalc);
    if (stored.allocationMode === 'pool') s.saleTags = { mode: 'include', tags: (rules ?? []).filter((r) => r.active && r.tag.trim()).map((r) => r.tag.trim()) };
  }
  // Condition « famille » d'une étiquette (avant la 1.0) → Familles : « famille X → étiquette Y ».
  if (!stored?.familyTags) {
    s.familyTags = (rules ?? [])
      .filter((r) => r.when?.family?.trim() && r.tag.trim())
      .map((r) => ({ id: `ft-${r.id}`, active: r.active, family: r.when!.family.trim(), tag: r.tag.trim() }));
  }
  s.collectionViews = Array.isArray(s.collectionViews) ? s.collectionViews.filter((v) => v && typeof v.id === 'string').map(normalizeView) : [];
  delete s.sortPrice;
  delete s.sellRateRules;
  delete s.sellRateTiersOn;
  return s;
}

/** Étiquettes d'avant la 1.0 : leur mise de départ (et leurs paliers de taux de vente) devient leur calcul. */
export function migrateRules(rules: LegacyRule[], stored?: LegacySettings): TagRule[] {
  const defaultCalc = migrateSettings(stored).defaultCalc;
  return rules.flatMap((r) => {
    // La famille passe dans Familles (voir migrateSettings) ; une étiquette qui n'existait que pour elle disparaît.
    if (r.when?.family?.trim()) {
      const when = { ...r.when, family: '' };
      if (!hasConditions({ when }) && !hasRange(r) && !r.quota) return [];
      r = { ...r, when };
    }
    if (r.calc || r.pct == null) return [r];
    const { pct, sale, ...rest } = r;
    const own = sale?.sellRateRules != null;
    const tiers = own ? migrateRateRules(sale!.sellRateRules) : legacyTiers(stored);
    return [{ ...rest, calc: pct === 70 && !own ? inheritCalc() : legacyCalc(pct, tiers, defaultCalc) }];
  });
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
