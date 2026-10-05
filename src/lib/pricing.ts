import { MIN_RARITY_SAMPLES, MIN_SALES } from './defaults';
import { RARITIES } from './text';
import type { Card, PriceObs, Settings, TagRule } from './types';

export type PriceSource = 'site' | 'history' | 'manual' | 'rarity' | 'estimate' | 'none';

export interface BasePrice {
  value: number | null;
  source: PriceSource;
  /** Nombre de ventes observées dans la fenêtre. */
  samples: number;
  /** Pour `rarity` : libellé du groupe (« SR », « SR brillante »). */
  group?: string;
}

export interface PriceResult {
  price: number | null;
  base: BasePrice;
  /** Détail lisible du calcul : « moyenne 86 × 70 % = 60 ». */
  detail: string;
  estimate: boolean;
}

export interface PricingContext {
  settings: Settings;
  cards: Record<string, Card>;
  /** Observations groupées par carte (voir indexObs). */
  obsByCard: Map<string, PriceObs[]>;
  manualPrices: Record<string, number>;
  now: number;
  /** Cache des prix de référence par rareté (rempli à la demande). */
  rarityCache?: Map<string, BasePrice | null>;
}

export function indexObs(obs: PriceObs[]): Map<string, PriceObs[]> {
  const map = new Map<string, PriceObs[]>();
  for (const o of obs) {
    const list = map.get(o.cardId);
    if (list) list.push(o);
    else map.set(o.cardId, [o]);
  }
  return map;
}

export function mean(values: number[]): number | null {
  if (!values.length) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Pas d'arrondi automatique, adapté au montant (les ventes se font souvent entre 5 et 30). */
export function autoStep(value: number): number {
  if (value < 20) return 1;
  if (value < 100) return 5;
  if (value < 1000) return 10;
  return 50;
}

/** Arrondi au pas donné (0 = automatique) ; jamais en dessous de 1. */
export function roundTo(value: number, step: number): number {
  const s = !step || step <= 0 ? autoStep(value) : step;
  const r = Math.round(value / s) * s;
  return Math.max(1, r === 0 && value > 0 ? s : r);
}

/** Prix observés pour une carte dans la fenêtre glissante. */
export function windowSamples(cardId: string, ctx: PricingContext): number[] {
  const since = ctx.now - ctx.settings.windowDays * 86_400_000;
  const list = ctx.obsByCard.get(cardId) ?? [];
  const sold = list.filter((o) => o.at >= since && o.type === 'sold');
  const listings = ctx.settings.includeListings ? latestListings(list.filter((o) => o.at >= since && o.type === 'listing')) : [];
  return [...sold, ...listings].map((o) => o.price);
}

/** Une enchère en cours n'est comptée qu'une fois (dernier prix vu). */
function latestListings(list: PriceObs[]): PriceObs[] {
  const byAuction = new Map<string, PriceObs>();
  for (const o of list) {
    const key = o.auctionId ?? `${o.at}`;
    const prev = byAuction.get(key);
    if (!prev || prev.at < o.at) byAuction.set(key, o);
  }
  return [...byAuction.values()];
}

function stat(values: number[], settings: Settings): number | null {
  return settings.stat === 'median' ? median(values) : mean(values);
}

/** Prix moyen fiable (site ou historique suffisant), sans estimation. */
export function reliableBase(card: Card, ctx: PricingContext): BasePrice {
  // Un prix moyen de 0 (ou négatif) affiché par le site n'a pas de sens : on l'ignore.
  if (card.sitePrice != null && card.sitePrice > 0) return { value: card.sitePrice, source: 'site', samples: 0 };
  const samples = windowSamples(card.id, ctx);
  if (samples.length >= MIN_SALES) return { value: stat(samples, ctx.settings), source: 'history', samples: samples.length };
  return { value: null, source: 'none', samples: samples.length };
}

/**
 * Prix de référence d'une rareté : médiane (ou moyenne) des ventes observées de cette rareté,
 * toutes cartes confondues. Sur WikiMasters chaque carte est quasi unique : c'est souvent le seul
 * repère fiable. À défaut de ventes, les enchères en cours de la même rareté servent d'estimation.
 */
export function rarityBase(rarity: Card['rarity'], shiny: boolean, ctx: PricingContext): BasePrice | null {
  if (!rarity) return null;
  const key = `${rarity}|${shiny}`;
  ctx.rarityCache ??= new Map();
  if (ctx.rarityCache.has(key)) return ctx.rarityCache.get(key)!;
  const since = ctx.now - ctx.settings.windowDays * 86_400_000;
  const all = [...ctx.obsByCard.values()].flat().filter((o) => o.at >= since && o.rarity === rarity && !!o.shiny === shiny);
  const sold = all.filter((o) => o.type === 'sold').map((o) => o.price);
  const listings = latestListings(all.filter((o) => o.type === 'listing')).map((o) => o.price);
  const group = `${RARITIES[rarity].label}${shiny ? ' brillante' : ''}`;
  let out: BasePrice | null = null;
  if (sold.length >= MIN_RARITY_SAMPLES) out = { value: stat(sold, ctx.settings), source: 'rarity', samples: sold.length, group };
  else if (listings.length >= MIN_RARITY_SAMPLES) out = { value: stat(listings, ctx.settings), source: 'estimate', samples: listings.length, group: `${group} en vente` };
  ctx.rarityCache.set(key, out);
  return out;
}

/**
 * Prix PROPRE à la carte (jamais la médiane de sa rareté) : moyenne du site, ses ventes (au moins une),
 * ou prix saisi. Sert à l'étiquetage automatique, pour que des cartes de même rareté ne tombent pas
 * toutes dans la même plage.
 */
export function ownPrice(card: Card, ctx: PricingContext): number | null {
  if (card.sitePrice != null && card.sitePrice > 0) return card.sitePrice;
  const samples = windowSamples(card.id, ctx);
  if (samples.length) return stat(samples, ctx.settings);
  return ctx.manualPrices[card.id] ?? null;
}

/** Prix servant à classer une carte dans une étiquette (sans estimation par les pairs). */
export function referencePrice(card: Card, ctx: PricingContext): number | null {
  const reliable = reliableBase(card, ctx).value;
  if (reliable != null) return reliable;
  if (ctx.manualPrices[card.id] != null) return ctx.manualPrices[card.id];
  const r = rarityBase(card.rarity, !!card.shiny, ctx);
  return r?.source === 'rarity' ? r.value : null;
}

/**
 * F4 – prix moyen de référence :
 * site → historique de la carte (≥ 3 ventes) → prix saisi → médiane de la rareté (≥ 5 ventes)
 * → estimation (pairs de même rareté dans l'étiquette, enchères en cours, quelques ventes) → rien.
 */
export function basePrice(card: Card, ctx: PricingContext, peers: Card[] = []): BasePrice {
  const reliable = reliableBase(card, ctx);
  if (reliable.value != null) return reliable;

  const manual = ctx.manualPrices[card.id];
  if (manual != null) return { value: manual, source: 'manual', samples: reliable.samples };

  const byRarity = rarityBase(card.rarity, !!card.shiny, ctx);
  if (byRarity?.source === 'rarity') return byRarity;

  if (card.rarity) {
    const sameRarity = peers
      .filter((p) => p.id !== card.id && p.rarity === card.rarity)
      .map((p) => reliableBase(p, ctx).value)
      .filter((v): v is number => v != null);
    const v = stat(sameRarity, ctx.settings);
    if (v != null) return { value: v, source: 'estimate', samples: reliable.samples };
  }
  if (byRarity) return byRarity;

  const few = windowSamples(card.id, ctx);
  if (few.length) return { value: stat(few, ctx.settings), source: 'estimate', samples: few.length };

  return { value: null, source: 'none', samples: 0 };
}

const SOURCE_LABEL: Record<PriceSource, string> = {
  site: 'moyenne site',
  history: 'moyenne',
  manual: 'prix saisi',
  rarity: 'médiane',
  estimate: 'estimation',
  none: '',
};

/**
 * prix = arrondi(prix de référence × %).
 * Le plancher et le plafond d'une règle ne bornent PAS ce prix : ils ne servent qu'à classer les cartes
 * (étiquetage automatique, règles « plage de prix »).
 */
export function computePrice(card: Card, rule: TagRule, ctx: PricingContext, peers: Card[] = []): PriceResult {
  const base = basePrice(card, ctx, peers);
  if (base.value == null) {
    return { price: null, base, detail: 'aucune donnée de prix : saisis un prix', estimate: false };
  }
  const statLabel = ctx.settings.stat === 'median' ? 'médiane' : 'moyenne';
  const label =
    base.source === 'rarity' ? `${statLabel} ${base.group}` :
    base.source === 'history' ? statLabel :
    base.source === 'estimate' && base.group ? `estimation ${base.group}` :
    SOURCE_LABEL[base.source];
  const price = roundTo((base.value * rule.pct) / 100, ctx.settings.rounding);
  const samples = base.source === 'history' || base.source === 'rarity' ? ` (${base.samples} ventes)` : base.group ? ` (${base.samples})` : '';
  const detail = `${label} ${Math.round(base.value)}${samples} × ${rule.pct} % = ${price}`;
  return { price, base, detail, estimate: base.source === 'estimate' };
}
