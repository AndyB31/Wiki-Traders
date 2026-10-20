import { MIN_RARITY_SAMPLES, MIN_SALES } from './defaults';
import { durationFor } from './duration';
import type { FamilyIndex } from './families';
import { evalFormula } from './formula';
import { clampPrice, confidence, effectiveCalc, rateBonus, sellChance, simplePrice } from './salecalc';
import { reliableRate, type SellRate } from './sellrate';
import { RARITIES } from './text';
import type { Card, PriceCalc, PriceObs, Settings, TagRule } from './types';

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
  /** Durée conseillée (minutes) selon les paliers de durée de l'étiquette ou globaux ; null = durée du site. */
  durationMin?: number | null;
  /** Ajustement appliqué selon le taux de vente (palier de tdv), en %. */
  rateAdjust?: { pct: number; pricePct: number };
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
  /**
   * Vrai prix moyen de la carte dans sa rareté (ventes lues via l'API du site). Fait foi dès qu'il est lu :
   * undefined = pas encore lu ; null = jamais vendue dans cette rareté (ni prix de tuile ni relevés ne s'y substituent).
   */
  catalogPrice?: (card: Card) => number | null | undefined;
  /** Taux de vente de la carte (même cache que `catalogPrice`) ; null ou absent : inconnu. */
  sellRate?: (card: Card) => SellRate | null | undefined;
  /** Mes familles, indexées (conditions « famille » des règles). */
  families?: FamilyIndex;
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
  // Vrai prix moyen de la carte lu via l'API : fait foi (prioritaire sur le prix lu sur la tuile, nos relevés et la rareté).
  const api = ctx.catalogPrice?.(card);
  if (api != null && api > 0) return { value: api, source: 'site', samples: 0 };
  if (api === null) return { value: null, source: 'none', samples: 0 };
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
  const api = ctx.catalogPrice?.(card);
  if (api != null && api > 0) return api;
  // Jamais vendue dans sa rareté d'après le site : seul un prix saisi compte.
  if (api === null) return ctx.manualPrices[card.id] ?? null;
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

  // Relevés de la carte (peut-être d'une autre rareté) : ignorés si le site dit qu'elle n'a jamais été vendue dans la sienne.
  const few = ctx.catalogPrice?.(card) === null ? [] : windowSamples(card.id, ctx);
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

const RARITY_RANK: Record<NonNullable<Card['rarity']>, number> = { C: 1, PC: 2, R: 3, SR: 4, UR: 5, L: 6 };

/** Variables d'une carte pour les formules (prix et priorité, voir lib/formula.ts). */
export function cardVars(card: Card, ctx: PricingContext, base: number | null, extra: { trustSales: number; keepMin: number }): Record<string, number | null> {
  const rate = ctx.sellRate?.(card) ?? null;
  return {
    prix: base,
    tdv: rate?.total ? rate.pct : 50,
    confiance: confidence(rate, extra.trustSales),
    chance: sellChance(rate),
    tdv_fiable: reliableRate(rate, ctx.settings.sellRateMinSamples) ? 1 : 0,
    ventes: rate?.sold ?? 0,
    encheres: rate?.total ?? 0,
    quantite: card.quantity,
    doublons: Math.max(0, card.quantity - 1),
    vendables: Math.max(0, card.quantity - extra.keepMin),
    rarete: card.rarity ? RARITY_RANK[card.rarity] : 0,
    brillante: card.shiny ? 1 : 0,
  };
}

/** Prix brut d'un calcul (avant bornes et arrondi) ; null si la formule ne donne pas de nombre. */
function rawPrice(calc: PriceCalc, base: number, card: Card, ctx: PricingContext, keepMin: number, defaultPrice: () => number | null): number | null {
  if (calc.mode !== 'formula') return simplePrice(base, ctx.sellRate?.(card), calc);
  const v = evalFormula(calc.formula, { ...cardVars(card, ctx, base, { trustSales: calc.trustSales, keepMin }), prix_conseille: defaultPrice() });
  return v != null && Number.isFinite(v) && v > 0 ? v : null;
}

/**
 * Prix de départ = calcul de la règle (ou calcul par défaut), borné par son prix minimum et maximum, puis arrondi.
 * Le plancher et le plafond d'une étiquette ne bornent PAS ce prix : ils ne servent qu'à classer les cartes
 * (étiquetage automatique, paliers de prix).
 */
export function computePrice(card: Card, rule: TagRule, ctx: PricingContext, peers: Card[] = []): PriceResult {
  const base = basePrice(card, ctx, peers);
  if (base.value == null) {
    return { price: null, base, detail: 'aucune donnée de prix : saisis un prix', estimate: false, durationMin: null };
  }
  const statLabel = ctx.settings.stat === 'median' ? 'médiane' : 'moyenne';
  const label =
    base.source === 'rarity' ? `${statLabel} ${base.group}` :
    base.source === 'history' ? statLabel :
    base.source === 'estimate' && base.group ? `estimation ${base.group}` :
    SOURCE_LABEL[base.source];
  const value = base.value;
  const def = ctx.settings.defaultCalc;
  const calc = effectiveCalc(rule.calc, def);
  const defaultPrice = () => {
    const v = rawPrice(def.mode === 'formula' ? { ...def, mode: 'simple' } : def, value, card, ctx, rule.keepMin, () => null);
    return v == null ? null : roundTo(clampPrice(v, def), ctx.settings.rounding);
  };
  const raw = rawPrice(calc, value, card, ctx, rule.keepMin, defaultPrice);
  const samples = base.source === 'history' || base.source === 'rarity' ? ` (${base.samples} ventes)` : base.group ? ` (${base.samples})` : '';
  const head = `${label} ${Math.round(value)}${samples}`;
  if (raw == null) return { price: null, base, detail: `${head} : la formule ne donne pas de prix`, estimate: base.source === 'estimate', durationMin: null };
  const clamped = clampPrice(raw, calc);
  const price = roundTo(clamped, ctx.settings.rounding);
  const rate = ctx.sellRate?.(card) ?? null;
  const bonus = calc.mode === 'simple' ? rateBonus(rate, calc) : 1;
  const rateText = calc.mode === 'simple' && Math.abs(bonus - 1) >= 0.005 ? ` × ${Math.round(bonus * 100)} % (tdv ${rate!.pct} % sur ${rate!.total})` : '';
  const how = calc.mode === 'formula' ? ' → formule' : ` × ${calc.pct} %${rateText}`;
  const bound = clamped !== raw ? (clamped > raw ? ` → minimum ${calc.minPrice}` : ` → maximum ${calc.maxPrice}`) : '';
  const detail = `${head}${how}${bound} = ${price}`;
  const durationMin = rule.durationMin ?? durationFor(price, ctx.settings.durationRules);
  return { price, base, detail, estimate: base.source === 'estimate', durationMin, ...(rateText ? { rateAdjust: { pct: rate!.pct, pricePct: Math.round(bonus * 100) } } : {}) };
}
