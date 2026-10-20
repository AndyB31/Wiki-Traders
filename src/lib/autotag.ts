import { makeContext, type AllocationInput } from './allocation';
import { EMPTY_CONDITIONS, hasConditions, isAutoTagRule, ruleStatus, type Tri } from './conditions';
import { ownPrice } from './pricing';
import { sameTag } from './text';
import type { Card, Rarity, Settings, TagRule } from './types';

/** Prix moyen d'une carte relevé dans les ventes du site (cache des prix, voir content/catalog.ts). */
export interface CatalogPriceEntry {
  mean: number | null;
  count: number;
  byRarity?: Partial<Record<Rarity, { mean: number; count: number }>>;
}

/**
 * Moyenne des ventes de la carte dans la rareté de l'exemplaire, comme le « Prix moyen » du site. Jamais la moyenne
 * toutes raretés quand la rareté est connue : une Commune ne prend pas le prix des ventes de la carte en Légendaire.
 * undefined : prix inconnu (pas encore lu) ; null : lu, jamais vendue dans cette rareté.
 */
export function catalogPrice(entry: CatalogPriceEntry | undefined, rarity: Rarity | null): number | null | undefined {
  if (!entry) return undefined;
  // Ventes dont la rareté est connue : seule celle de l'exemplaire compte.
  if (rarity && entry.byRarity && Object.keys(entry.byRarity).length) return entry.byRarity[rarity]?.mean ?? null;
  return entry.count ? entry.mean ?? null : null;
}

/** Fonction de prix « catalogue », à partir du cache des prix (clé : identifiant du site). */
export function catalogPriceOf(cache: Record<string, CatalogPriceEntry> | null | undefined): (card: Card) => number | null | undefined {
  return (card) => (card.siteId && cache ? catalogPrice(cache[card.siteId], card.rarity) : undefined);
}

export interface TagChange {
  cardId: string;
  cardName: string;
  /** Prix propre à la carte ayant servi au classement (null : carte sans prix connu). */
  base: number | null;
  /** Étiquettes visées, séparées par des virgules ; '' = aucune (prix hors de toutes les plages, aucune condition remplie). */
  target: string;
  add: string[];
  remove: string[];
}

/**
 * Règle de plage de prix seule (sans condition) qui contient le prix moyen, la plus étroite si plusieurs :
 * une carte n'a qu'une plage de prix.
 */
export function ruleForPrice(rules: TagRule[], price: number): TagRule | null {
  const fits = rules.filter(
    (r) => r.active && !hasConditions(r) && (r.floor != null || r.ceiling != null) && (r.floor == null || price >= r.floor) && (r.ceiling == null || price <= r.ceiling),
  );
  const width = (r: TagRule) => (r.ceiling ?? Infinity) - (r.floor ?? 0);
  return fits.sort((a, b) => width(a) - width(b))[0] ?? null;
}

/** Familles → étiquette, présentées au planificateur comme des règles à une seule condition (la famille). */
export function familyTagRules(settings: Pick<Settings, 'familyTags'>): TagRule[] {
  return (settings.familyTags ?? [])
    .filter((f) => f.active && f.family.trim() && f.tag.trim())
    .map((f) => ({ id: `fam:${f.id}`, tag: f.tag.trim(), quota: 0, floor: null, ceiling: null, keepMin: 0, active: true, match: 'tag', when: { ...EMPTY_CONDITIONS, family: f.family } }));
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
  extraPrice?: (card: Card) => number | null | undefined;
}

/**
 * Étiquetage automatique. Deux sortes de règles :
 *  - plage de prix seule : la carte reçoit l'étiquette dont la plage contient son prix PROPRE (moyenne du site, ses
 *    ventes, prix saisi), une seule (la plus étroite) ; la médiane de la rareté n'est jamais utilisée ;
 *  - avec des conditions (texte dans le nom, famille, taux de vente, et la plage si elle est remplie) : chaque règle
 *    remplie ajoute son étiquette, indépendamment des autres (« Pays », « Films »…).
 * Une étiquette n'est retirée que si sa règle répond non (jamais sur un prix ou un taux de vente inconnu, sauf
 * l'option « cartes sans prix »). Les favoris sont ignorés.
 */
export function planAutoTags(input: AllocationInput, opts: AutoTagOptions | boolean, now = Date.now()): TagChange[] {
  const { removeOthers, clearUnpriced = false, extraPrice } = typeof opts === 'boolean' ? { removeOthers: opts } : opts;
  const ctx = makeContext(input, now);
  const autoRules = [...input.rules, ...familyTagRules(input.settings)].filter(isAutoTagRule);
  const priceOnly = autoRules.filter((r) => !hasConditions(r));
  const withConditions = autoRules.filter(hasConditions);
  const out: TagChange[] = [];
  for (const card of Object.values(input.cards)) {
    // Les favoris ne sont jamais réétiquetés.
    if (card.quantity < 1 || card.favorite) continue;
    const base = ownPrice(card, ctx) ?? extraPrice?.(card) ?? null;
    const winner = base != null ? ruleForPrice(priceOnly, base) : null;
    const status = new Map<TagRule, Tri>();
    for (const r of priceOnly) status.set(r, base == null ? 'unknown' : r === winner ? 'yes' : 'no');
    for (const r of withConditions) status.set(r, ruleStatus(card, r, base, ctx));
    const targets = autoRules.filter((r) => status.get(r) === 'yes').map((r) => r.tag);
    const add = targets.filter((t) => !card.tags.some((c) => sameTag(c, t)));
    const remove = autoRules
      .filter((r) => {
        const s = status.get(r);
        return (removeOthers && s === 'no') || (clearUnpriced && s === 'unknown' && base == null);
      })
      .map((r) => r.tag)
      .filter((t) => card.tags.some((c) => sameTag(c, t)) && !targets.some((x) => sameTag(x, t)));
    if (add.length || remove.length) out.push({ cardId: card.id, cardName: card.name, base, target: targets.join(', '), add, remove });
  }
  return out.sort((a, b) => a.cardName.localeCompare(b.cardName));
}

export interface AutoTagDiagnosis {
  cards: number;
  /** Règles actives d'étiquetage automatique (plage de prix ou conditions). */
  rulesWithRange: number;
  /** Cartes dont le prix de référence est connu. */
  pricedCards: number;
  /** Cartes (hors favoris) sans aucun prix connu : jamais vendues, ou prix pas encore chargés. */
  unpricedCards: number;
}

/** Pourquoi le plan d'étiquetage est vide. */
export function diagnoseAutoTags(input: AllocationInput, now = Date.now(), extraPrice?: (card: Card) => number | null | undefined): AutoTagDiagnosis {
  const ctx = makeContext(input, now);
  const cards = Object.values(input.cards).filter((c) => c.quantity >= 1 && !c.favorite);
  const priced = cards.filter((c) => (ownPrice(c, ctx) ?? extraPrice?.(c) ?? null) != null).length;
  return {
    cards: Object.keys(input.cards).length,
    rulesWithRange: [...input.rules, ...familyTagRules(input.settings)].filter(isAutoTagRule).length,
    pricedCards: priced,
    unpricedCards: cards.length - priced,
  };
}
