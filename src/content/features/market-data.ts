/**
 * Données des onglets du Marché, lues dans le stockage de l'extension et gardées en mémoire :
 * règles, mes ventes en cours, prix observés, mises et ventes terminées. Rechargées quand elles changent.
 */
import type { AllocationInput } from '../../lib/allocation';
import { load, onStoreChange, type StoreKey } from '../../lib/storage';
import type { MyBidsResult, MySalesResult, StoreShape } from '../../lib/types';
import type { FeatureContext } from './runtime';

export type MarketData = Pick<StoreShape, 'rules' | 'priceObs' | 'myAuctions' | 'manualPrices' | 'slotOverrides' | 'ignoredSlots'> & {
  bidsCache: MyBidsResult | null;
  salesCache: MySalesResult | null;
};

const KEYS: StoreKey[] = ['rules', 'priceObs', 'myAuctions', 'manualPrices', 'slotOverrides', 'ignoredSlots', 'bidsCache', 'salesCache'];

let data: MarketData | null = null;
let loading: Promise<void> | null = null;
let watching = false;
const listeners = new Set<() => void>();

async function reload(): Promise<void> {
  try {
    data = (await load(...(KEYS as (keyof MarketData)[]))) as MarketData;
  } catch {
    // Hors extension (tests) : données laissées telles quelles.
  }
  for (const cb of listeners) cb();
}

/** Données en mémoire (null tant que le premier chargement n'est pas fini ; `onChange` est alors appelé). */
export function marketData(onChange: () => void): MarketData | null {
  listeners.add(onChange);
  if (!watching) {
    watching = true;
    try {
      onStoreChange(KEYS, () => void reload());
    } catch {
      // idem
    }
  }
  if (!data) loading ??= reload();
  return data;
}

/** Entrée de l'allocation : réglages et collection du contexte, le reste du stockage. */
export function allocationInput(ctx: FeatureContext, d: MarketData): AllocationInput {
  return {
    settings: ctx.settings,
    cards: ctx.cards,
    rules: d.rules,
    priceObs: d.priceObs,
    myAuctions: d.myAuctions,
    manualPrices: d.manualPrices,
    slotOverrides: d.slotOverrides,
    ignoredSlots: d.ignoredSlots,
  };
}

/** Pour les tests. */
export function setMarketDataForTest(d: MarketData | null): void {
  data = d;
  loading = d ? Promise.resolve() : null;
}
