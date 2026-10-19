/**
 * Taux de vente (tdv) d'une carte : enchères conclues sur toutes ses enchères terminées (vendues, sans acheteur,
 * annulées), lu avec les prix moyens (cache des prix, voir content/catalog.ts). Il sert à écarter les cartes qui
 * ne se vendent pas (tdv minimum) et à ajuster le prix conseillé (paliers de tdv).
 */
import type { Card, SellRateRule } from './types';

export interface SellRate {
  pct: number;
  sold: number;
  total: number;
}

/** Sous ce nombre d'enchères terminées, le tdv est trop peu fiable pour écarter une carte ou changer son prix. */
export const SELL_RATE_MIN_SAMPLES = 5;

/** Entrée du cache des prix : seul le décompte des enchères terminées sert ici. */
export interface RateEntry {
  rate?: { sold: number; total: number };
}

export function rateOf(entry: RateEntry | undefined): SellRate | null {
  if (!entry?.rate?.total) return null;
  return { ...entry.rate, pct: Math.round((entry.rate.sold / entry.rate.total) * 100) };
}

/** Fonction de tdv à partir du cache des prix (clé : identifiant du site). */
export function sellRateOfCache(cache: Record<string, RateEntry> | null | undefined): (card: Card) => SellRate | null {
  return (card) => (card.siteId && cache ? rateOf(cache[card.siteId]) : null);
}

/** Tdv assez fiable pour agir (au moins `min` enchères terminées, réglable), sinon null. */
export function reliableRate(rate: SellRate | null | undefined, min = SELL_RATE_MIN_SAMPLES): SellRate | null {
  return rate && rate.total >= Math.max(1, min) ? rate : null;
}

/** Premier palier dont l'intervalle [de, à] (en %) contient le tdv. */
export function rateRuleFor(pct: number, rules: SellRateRule[]): SellRateRule | null {
  return rules.find((r) => (r.from == null || pct >= r.from) && (r.to == null || pct <= r.to)) ?? null;
}

/** Paliers qui se chevauchent (le premier l'emporte, mais c'est sans doute une erreur de saisie). */
export function overlappingRateRules(rules: SellRateRule[]): [number, number] | null {
  for (let i = 0; i < rules.length; i++) {
    for (let j = i + 1; j < rules.length; j++) {
      const a = rules[i];
      const b = rules[j];
      if ((a.from ?? -Infinity) <= (b.to ?? Infinity) && (b.from ?? -Infinity) <= (a.to ?? Infinity)) return [i, j];
    }
  }
  return null;
}

/** Proposition : les cartes qui partent toutes seules montent, celles qui ne partent pas baissent. */
export const DEFAULT_RATE_TIERS: SellRateRule[] = [
  { from: 80, to: null, pricePct: 130 },
  { from: 50, to: 79, pricePct: 100 },
  { from: 20, to: 49, pricePct: 80 },
  { from: null, to: 19, pricePct: 50 },
];

/** « 130 % du prix », « 50 % du prix ». */
export function pricePctLabel(pricePct: number): string {
  return `${pricePct} % du prix`;
}

/**
 * Avant la 1.0, un palier stockait un ajustement (`adjust` : +30 = « +30 % », −50 = moitié prix), souvent lu à tort
 * comme « % du prix ». Il stocke maintenant le % du prix (`pricePct` : 100 = inchangé). Sans effet sur un palier déjà converti.
 */
export function migrateRateRule(r: SellRateRule & { adjust?: number }): SellRateRule {
  if (typeof r.pricePct === 'number') return { from: r.from, to: r.to, pricePct: r.pricePct };
  return { from: r.from ?? null, to: r.to ?? null, pricePct: 100 + (typeof r.adjust === 'number' ? r.adjust : 0) };
}

export function migrateRateRules(list: unknown): SellRateRule[] {
  return Array.isArray(list) ? list.map((r) => migrateRateRule(r as SellRateRule)) : [];
}
