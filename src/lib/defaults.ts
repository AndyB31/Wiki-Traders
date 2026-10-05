import type { Meta, Settings, StoreShape, TagRule } from './types';

export const SITE_ORIGIN = 'https://www.wiki-masters.com';

export const DEFAULT_SETTINGS: Settings = {
  slots: 5,
  windowDays: 7,
  // Les prix du marché sont très dispersés (quelques ventes énormes) : la médiane est plus juste.
  stat: 'median',
  // 0 = arrondi automatique (unité sous 20, 5 sous 100, 10 sous 1 000, 50 au-delà).
  rounding: 0,
  sortPrice: 'desc',
  randomSeed: 1,
  allowDuplicateListing: false,
  includeListings: false,
  fallbackTag: null,
  blacklist: [],
  notifications: true,
  quietStart: '23:00',
  quietEnd: '08:00',
  myAuctionsPath: null,
  sellPath: '/collection',
  durationRules: [],
  apiRead: false,
  sellMarketSummary: true,
  sellMarketList: true,
  apiWrite: false,
  showTagOverlay: true,
  tagOverlayStyle: 'label',
  prefill: false,
  autoTag: false,
  autoTagRemoveOthers: true,
  autoTagClearUnpriced: false,
  selectorOverrides: {},
};

export const DEFAULT_RULES: TagRule[] = [
  { id: 'r-50-100', tag: '50-100', quota: 1, pct: 70, floor: 50, ceiling: 100, keepMin: 1, active: true, match: 'tag' },
  { id: 'r-20-50', tag: '20-50', quota: 4, pct: 70, floor: 20, ceiling: 50, keepMin: 1, active: true, match: 'tag' },
];

export const DEFAULT_META: Meta = { lastAuctionsScan: null, lastCollectionScan: null, lastPage: null };

export const DEFAULT_STORE: StoreShape = {
  rules: DEFAULT_RULES,
  settings: DEFAULT_SETTINGS,
  cards: {},
  priceObs: [],
  myAuctions: [],
  journal: [],
  manualPrices: {},
  slotOverrides: {},
  ignoredSlots: [],
  meta: DEFAULT_META,
  pendingFocus: null,
  intent: null,
  bidsCache: null,
  salesCache: null,
  families: null,
};

/** Au-delà, la popup demande de rouvrir la page des enchères. */
export const STALE_AFTER_MS = 30 * 60 * 1000;
/** Les observations de prix plus vieilles sont purgées. */
export const PRICE_OBS_MAX_AGE_MS = 90 * 24 * 3600 * 1000;
export const PRICE_OBS_MAX = 5000;
export const JOURNAL_MAX = 2000;
/** Sous ce nombre de ventes observées, le prix est une estimation. */
export const MIN_SALES = 3;
/** Ventes de même rareté nécessaires pour un prix de référence par rareté. */
export const MIN_RARITY_SAMPLES = 5;
