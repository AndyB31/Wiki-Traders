import { makeContext, type AllocationInput } from './allocation';
import { ownPrice } from './pricing';
import { sameTag } from './text';
import type { Card, Rarity, TagRule } from './types';

/** Prix moyen d'une carte relevé dans les ventes du site (cache des prix, voir content/catalog.ts). */
export interface CatalogPriceEntry {
  mean: number | null;
  count: number;
  byRarity?: Partial<Record<Rarity, { mean: number; count: number }>>;
}

/** Moyenne des ventes de la carte dans sa rareté (comme le site), à défaut toutes raretés ; null si jamais vendue. */
export function catalogPrice(entry: CatalogPriceEntry | undefined, rarity: Rarity | null): number | null {
  if (!entry || !entry.count) return null;
  return (rarity ? entry.byRarity?.[rarity]?.mean : undefined) ?? entry.mean ?? null;
}

/** Fonction de prix « catalogue » pour l'étiquetage, à partir du cache des prix (clé : identifiant du site). */
export function catalogPriceOf(cache: Record<string, CatalogPriceEntry> | null | undefined): (card: Card) => number | null {
  return (card) => (card.siteId && cache ? catalogPrice(cache[card.siteId], card.rarity) : null);
}

export interface TagChange {
  cardId: string;
  cardName: string;
  /** Prix propre à la carte ayant servi au classement (null : carte sans prix connu). */
  base: number | null;
  /** Étiquette visée ; '' = aucune (prix hors de toutes les plages, ou carte sans prix connu). */
  target: string;
  add: string[];
  remove: string[];
}

/** Règle dont la plage plancher–plafond contient le prix moyen (la plus étroite si plusieurs). */
export function ruleForPrice(rules: TagRule[], price: number): TagRule | null {
  const fits = rules.filter(
    (r) => r.active && (r.floor != null || r.ceiling != null) && (r.floor == null || price >= r.floor) && (r.ceiling == null || price <= r.ceiling),
  );
  const width = (r: TagRule) => (r.ceiling ?? Infinity) - (r.floor ?? 0);
  return fits.sort((a, b) => width(a) - width(b))[0] ?? null;
}

export interface AutoTagOptions {
  /** Retirer les autres étiquettes de plage (y compris quand le prix sort de toutes les plages). */
  removeOthers: boolean;
  /** Retirer les étiquettes de plage des cartes sans prix propre connu. */
  clearUnpriced?: boolean;
  /**
   * Prix de secours : moyenne de toutes les ventes de la carte sur le site (badge « Moy. »). Sans lui, seules les
   * cartes vendues au moins 3 fois sur les 7 derniers jours (ou au prix affiché par le site) étaient classées.
   */
  extraPrice?: (card: Card) => number | null;
}

/**
 * Étiquetage automatique : chaque carte au prix PROPRE connu (moyenne du site, ses ventes, prix saisi)
 * reçoit l'étiquette dont la plage contient ce prix. La médiane de la rareté n'est jamais utilisée
 * (sinon toute une rareté tomberait dans la même plage). Les favoris sont ignorés.
 */
export function planAutoTags(input: AllocationInput, opts: AutoTagOptions | boolean, now = Date.now()): TagChange[] {
  const { removeOthers, clearUnpriced = false, extraPrice } = typeof opts === 'boolean' ? { removeOthers: opts } : opts;
  const ctx = makeContext(input, now);
  const ruleTags = input.rules.filter((r) => r.active && (r.floor != null || r.ceiling != null)).map((r) => r.tag);
  const managed = (card: { tags: string[] }) => ruleTags.filter((t) => card.tags.some((c) => sameTag(c, t)));
  const out: TagChange[] = [];
  for (const card of Object.values(input.cards)) {
    // Les favoris ne sont jamais réétiquetés.
    if (card.quantity < 1 || card.favorite) continue;
    const base = ownPrice(card, ctx) ?? extraPrice?.(card) ?? null;
    if (base == null) {
      const remove = clearUnpriced ? managed(card) : [];
      if (remove.length) out.push({ cardId: card.id, cardName: card.name, base: null, target: '', add: [], remove });
      continue;
    }
    const rule = ruleForPrice(input.rules, base);
    if (!rule) {
      // Prix hors de toutes les plages : on retire les étiquettes de plage restantes.
      const remove = removeOthers ? managed(card) : [];
      if (remove.length) out.push({ cardId: card.id, cardName: card.name, base, target: '', add: [], remove });
      continue;
    }
    const add = card.tags.some((t) => sameTag(t, rule.tag)) ? [] : [rule.tag];
    const remove = removeOthers ? managed(card).filter((t) => !sameTag(t, rule.tag)) : [];
    if (add.length || remove.length) out.push({ cardId: card.id, cardName: card.name, base, target: rule.tag, add, remove });
  }
  return out.sort((a, b) => a.cardName.localeCompare(b.cardName));
}

export interface AutoTagDiagnosis {
  cards: number;
  /** Règles actives avec un plancher et/ou un plafond. */
  rulesWithRange: number;
  /** Cartes dont le prix de référence est connu. */
  pricedCards: number;
  /** Cartes (hors favoris) sans aucun prix connu : jamais vendues, ou prix pas encore chargés. */
  unpricedCards: number;
}

/** Pourquoi le plan d'étiquetage est vide. */
export function diagnoseAutoTags(input: AllocationInput, now = Date.now(), extraPrice?: (card: Card) => number | null): AutoTagDiagnosis {
  const ctx = makeContext(input, now);
  const cards = Object.values(input.cards).filter((c) => c.quantity >= 1 && !c.favorite);
  const priced = cards.filter((c) => (ownPrice(c, ctx) ?? extraPrice?.(c) ?? null) != null).length;
  return {
    cards: Object.keys(input.cards).length,
    rulesWithRange: input.rules.filter((r) => r.active && (r.floor != null || r.ceiling != null)).length,
    pricedCards: priced,
    unpricedCards: cards.length - priced,
  };
}
