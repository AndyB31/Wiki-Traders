import { makeContext, type AllocationInput } from './allocation';
import { referencePrice } from './pricing';
import { sameTag } from './text';
import type { TagRule } from './types';

export interface TagChange {
  cardId: string;
  cardName: string;
  /** Prix moyen ayant servi au classement. */
  base: number;
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

/**
 * Étiquetage automatique : pour chaque carte au prix connu (site, historique, saisi ou médiane de sa rareté),
 * l'étiquette dont la plage contient ce prix. Les estimations ne servent pas à étiqueter ; les favoris sont ignorés.
 */
export function planAutoTags(input: AllocationInput, removeOthers: boolean, now = Date.now()): TagChange[] {
  const ctx = makeContext(input, now);
  const ruleTags = input.rules.filter((r) => r.active).map((r) => r.tag);
  const out: TagChange[] = [];
  for (const card of Object.values(input.cards)) {
    // Les favoris ne sont jamais réétiquetés.
    if (card.quantity < 1 || card.favorite) continue;
    const base = referencePrice(card, ctx);
    if (base == null) continue;
    const rule = ruleForPrice(input.rules, base);
    if (!rule) continue;
    const add = card.tags.some((t) => sameTag(t, rule.tag)) ? [] : [rule.tag];
    const remove = removeOthers ? ruleTags.filter((t) => !sameTag(t, rule.tag) && card.tags.some((c) => sameTag(c, t))) : [];
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
}

/** Pourquoi le plan d'étiquetage est vide. */
export function diagnoseAutoTags(input: AllocationInput, now = Date.now()): AutoTagDiagnosis {
  const ctx = makeContext(input, now);
  const cards = Object.values(input.cards);
  return {
    cards: cards.length,
    rulesWithRange: input.rules.filter((r) => r.active && (r.floor != null || r.ceiling != null)).length,
    pricedCards: cards.filter((c) => referencePrice(c, ctx) != null).length,
  };
}
