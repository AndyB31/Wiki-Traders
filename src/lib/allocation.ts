import { computePrice, indexObs, referencePrice, reliableBase, type PriceResult, type PricingContext } from './pricing';
import { hasRange, ruleStatus } from './conditions';
import { durationFor } from './duration';
import { familyIndex, RARITY_ORDER } from './families';
import { evalFormula } from './formula';
import { reliableRate, type SellRate } from './sellrate';
import { normalize, sameTag } from './text';
import type { Card, CardFamily, MyAuction, StoreShape, TagRule } from './types';

export interface Candidate {
  card: Card;
  pricing: PriceResult;
  /** Exemplaires vendables (quantité − garderMin − déjà en vente). */
  sellable: number;
  /** Score de la formule de l'étiquette (ordre « score »). */
  score?: number | null;
}

export interface FreeSlot {
  key: string;
  rule: TagRule;
  /** Règle d'origine si le slot a été basculé sur l'étiquette de secours. */
  fromRule: TagRule | null;
  proposal: Candidate | null;
  candidates: Candidate[];
  ignored: boolean;
  /** Pourquoi aucune carte n'est proposée (si `proposal` est vide). */
  excluded: Exclusions | null;
}

export interface Exclusions {
  /** Cartes de l'étiquette. */
  total: number;
  favorite: number;
  blacklist: number;
  onSale: number;
  /** Bloquées par « garder au moins ». */
  keep: number;
  /** Taux de vente sous le minimum réglé. */
  lowRate: number;
}

/** Tdv fiable sous le minimum (de l'étiquette, sinon global) : la carte n'est pas proposée (elle reste vendable à la main). */
export function belowMinRate(card: Card, ctx: PricingContext, rule?: TagRule): boolean {
  const min = rule?.sale ? rule.sale.minSellRate : ctx.settings.minSellRate;
  if (min == null) return false;
  const rate = reliableRate(ctx.sellRate?.(card));
  return !!rate && rate.pct < min;
}

/** Compte les cartes d'une règle écartées, par motif. */
export function exclusions(rule: TagRule, ctx: PricingContext, onSale: Map<string, number>): Exclusions {
  const blacklist = new Set(ctx.settings.blacklist.map(normalize));
  const out: Exclusions = { total: 0, favorite: 0, blacklist: 0, onSale: 0, keep: 0, lowRate: 0 };
  for (const card of Object.values(ctx.cards)) {
    if (!cardMatchesRule(card, rule, ctx)) continue;
    out.total++;
    if (card.favorite) out.favorite++;
    else if (blacklist.has(normalize(card.id)) || blacklist.has(normalize(card.name))) out.blacklist++;
    else if ((onSale.get(card.id) ?? 0) > 0 && !ctx.settings.allowDuplicateListing) out.onSale++;
    else if (card.quantity - rule.keepMin <= 0) out.keep++;
    else if (belowMinRate(card, ctx, rule)) out.lowRate++;
  }
  return out;
}

export interface BusySlot {
  auction: MyAuction;
  rule: TagRule | null;
}

export interface AllocationResult {
  slots: number;
  busy: BusySlot[];
  free: FreeSlot[];
  /** Slots libres non couverts par une règle (quotas < nombre de slots). */
  unassigned: number;
  /** Prochaine fin d'enchère (ms), null si aucune. */
  nextEnd: number | null;
  ctx: PricingContext;
}

export type AllocationInput = Pick<
  StoreShape,
  'rules' | 'settings' | 'cards' | 'priceObs' | 'myAuctions' | 'manualPrices' | 'slotOverrides' | 'ignoredSlots'
> & {
  /** Vrai prix moyen d'une carte (cache des prix lus via l'API), prioritaire sur la médiane de la rareté. */
  catalogPrice?: (card: Card) => number | null | undefined;
  /** Taux de vente d'une carte (même cache) : tdv minimum et paliers de prix. */
  sellRate?: (card: Card) => SellRate | null | undefined;
  /** Mes familles (conditions « famille » des règles). */
  myFamilies?: CardFamily[];
};

export function isActive(a: MyAuction, now: number): boolean {
  return a.endsAt == null || a.endsAt > now;
}

export function makeContext(input: AllocationInput, now: number): PricingContext {
  return {
    settings: input.settings,
    cards: input.cards,
    obsByCard: indexObs(input.priceObs),
    manualPrices: input.manualPrices,
    catalogPrice: input.catalogPrice,
    sellRate: input.sellRate,
    families: input.myFamilies?.length ? familyIndex(input.myFamilies) : undefined,
    now,
  };
}

/** Une carte relève-t-elle de cette règle ? */
export function cardMatchesRule(card: Card, rule: TagRule, ctx: PricingContext): boolean {
  if (rule.match === 'price') {
    // Plage de prix et conditions (texte, famille, taux de vente) ; sans plage, le prix n'est pas nécessaire.
    return ruleStatus(card, rule, hasRange(rule) ? referencePrice(card, ctx) : null, ctx) === 'yes';
  }
  return card.tags.some((t) => sameTag(t, rule.tag));
}

/** Règle d'une enchère en cours : étiquette lue sur l'enchère, sinon celle de la carte. */
export function ruleForAuction(a: MyAuction, rules: TagRule[], ctx: PricingContext): TagRule | null {
  const active = rules.filter((r) => r.active);
  if (a.tag) {
    const byTag = active.find((r) => sameTag(r.tag, a.tag));
    if (byTag) return byTag;
  }
  const card = ctx.cards[a.cardId];
  if (!card) return null;
  return active.find((r) => r.match === 'tag' && cardMatchesRule(card, r, ctx)) ?? active.find((r) => cardMatchesRule(card, r, ctx)) ?? null;
}

/** Rang pseudo-aléatoire stable d'une carte pour une graine donnée (FNV-1a). */
export function shuffleRank(id: string, seed: number): number {
  let h = (2166136261 ^ seed) >>> 0;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619) >>> 0;
  return h;
}

/** F3 – cartes vendables d'une règle, triées. */
export function rankCandidates(
  rule: TagRule,
  ctx: PricingContext,
  onSale: Map<string, number>,
  reserved: Map<string, number>,
): Candidate[] {
  const { settings } = ctx;
  const blacklist = new Set(settings.blacklist.map(normalize));
  const cards = Object.values(ctx.cards);
  const peers = cards.filter((c) => cardMatchesRule(c, rule, ctx));
  const out: Candidate[] = [];
  for (const card of peers) {
    if (card.favorite) continue;
    if (blacklist.has(normalize(card.id)) || blacklist.has(normalize(card.name))) continue;
    const listed = (onSale.get(card.id) ?? 0) + (reserved.get(card.id) ?? 0);
    if (listed > 0 && !settings.allowDuplicateListing) continue;
    const sellable = card.quantity - rule.keepMin - listed;
    if (sellable <= 0) continue;
    if (belowMinRate(card, ctx, rule)) continue;
    out.push({ card, sellable, pricing: computePrice(card, rule, ctx, peers) });
  }
  const sort = rule.sale?.sort ?? settings.sortPrice;
  if (sort === 'score') {
    // Formule de l'étiquette : le score le plus haut d'abord (score invalide en dernier).
    for (const c of out) c.score = evalFormula(rule.sale!.score, scoreVars(c, ctx));
    return out.sort((a, b) => (b.score ?? -Infinity) - (a.score ?? -Infinity) || a.card.name.localeCompare(b.card.name));
  }
  const rateOfCard = (c: Candidate) => reliableRate(ctx.sellRate?.(c.card))?.pct ?? -1;
  const dir = sort === 'asc' ? 1 : -1;
  out.sort((a, b) => {
    const dup = b.card.quantity - a.card.quantity;
    if (dup) return dup;
    // « Aléatoire » : tirage stable tant que la graine ne change pas (pas de clignotement à chaque rendu).
    if (sort === 'random') return shuffleRank(a.card.id, settings.randomSeed) - shuffleRank(b.card.id, settings.randomSeed);
    // « Meilleur taux de vente » : tdv fiable le plus haut d'abord, puis la plus chère.
    if (sort === 'rate' && rateOfCard(a) !== rateOfCard(b)) return rateOfCard(b) - rateOfCard(a);
    const pa = a.pricing.price;
    const pb = b.pricing.price;
    if (pa == null && pb == null) return a.card.name.localeCompare(b.card.name);
    if (pa == null) return 1;
    if (pb == null) return -1;
    return (pa - pb) * dir || a.card.name.localeCompare(b.card.name);
  });
  return out;
}

/** Variables d'une carte pour la formule de score (voir lib/formula.ts). */
export function scoreVars(c: Candidate, ctx: PricingContext): Record<string, number | null> {
  const rate = ctx.sellRate?.(c.card) ?? null;
  return {
    prix: c.pricing.base.value,
    prix_conseille: c.pricing.price,
    tdv: rate?.pct ?? 0,
    ventes: rate?.sold ?? 0,
    encheres: rate?.total ?? 0,
    quantite: c.card.quantity,
    doublons: Math.max(0, c.card.quantity - 1),
    vendables: c.sellable,
    rarete: c.card.rarity ? RARITY_ORDER[c.card.rarity] + 1 : 0,
    brillante: c.card.shiny ? 1 : 0,
  };
}

/** F1–F3 – répartition des slots libres entre les étiquettes. */
export function allocate(input: AllocationInput, now = Date.now()): AllocationResult {
  const ctx = makeContext(input, now);
  const { settings, rules } = input;
  const active = input.myAuctions.filter((a) => isActive(a, now)).sort((a, b) => (a.endsAt ?? Infinity) - (b.endsAt ?? Infinity));

  const busy: BusySlot[] = active.map((auction) => ({ auction, rule: ruleForAuction(auction, rules, ctx) }));
  const onSale = new Map<string, number>();
  for (const a of active) onSale.set(a.cardId, (onSale.get(a.cardId) ?? 0) + 1);

  let freeCount = Math.max(0, settings.slots - active.length);
  const reserved = new Map<string, number>();
  const free: FreeSlot[] = [];
  const ignored = new Set(input.ignoredSlots);
  const fallback = settings.fallbackTag ? rules.find((r) => r.active && sameTag(r.tag, settings.fallbackTag)) ?? null : null;

  const ordered = rules.filter((r) => r.active && r.quota > 0).sort((a, b) => b.quota - a.quota);
  for (const rule of ordered) {
    const current = busy.filter((b) => b.rule?.id === rule.id).length;
    const missing = Math.max(0, rule.quota - current);
    for (let i = 0; i < missing && freeCount > 0; i++) {
      freeCount--;
      const key = `${rule.id}:${i}`;
      let target = rule;
      let candidates = rankCandidates(rule, ctx, onSale, reserved);
      let fromRule: TagRule | null = null;
      if (!candidates.length && fallback && fallback.id !== rule.id) {
        candidates = rankCandidates(fallback, ctx, onSale, reserved);
        target = fallback;
        fromRule = rule;
      }
      const overrideId = input.slotOverrides[key];
      const proposal = candidates.find((c) => c.card.id === overrideId) ?? candidates[0] ?? null;
      if (proposal) reserved.set(proposal.card.id, (reserved.get(proposal.card.id) ?? 0) + 1);
      const excluded = proposal ? null : exclusions(rule, ctx, onSale);
      free.push({ key, rule: target, fromRule, proposal, candidates, ignored: ignored.has(key), excluded });
    }
  }

  const ends = active.map((a) => a.endsAt).filter((e): e is number => e != null);
  return {
    slots: settings.slots,
    busy,
    free,
    unassigned: freeCount,
    nextEnd: ends.length ? Math.min(...ends) : null,
    ctx,
  };
}

/** Prix conseillé pour une carte donnée, avec la première règle active qui la couvre. */
export function adviceForCard(input: AllocationInput, cardId: string, now = Date.now()): { rule: TagRule; pricing: PriceResult } | null {
  const ctx = makeContext(input, now);
  const card = ctx.cards[cardId];
  if (!card) return null;
  const active = input.rules.filter((r) => r.active);
  const rule = active.find((r) => r.match === 'tag' && cardMatchesRule(card, r, ctx)) ?? active.find((r) => cardMatchesRule(card, r, ctx));
  if (!rule) return null;
  const peers = Object.values(ctx.cards).filter((c) => cardMatchesRule(c, rule, ctx));
  return { rule, pricing: computePrice(card, rule, ctx, peers) };
}

/**
 * Prix à proposer pour mettre une carte aux enchères depuis la collection (mode enchère) : le prix de sa règle
 * d'étiquette, ou à défaut son prix moyen (ventes ou prix du site).
 */
export function sellAdvice(input: AllocationInput, cardId: string, now = Date.now()): { price: number | null; detail: string; durationMin: number | null } {
  const advice = adviceForCard(input, cardId, now);
  if (advice?.pricing.price != null) {
    return { price: advice.pricing.price, detail: `${advice.pricing.detail} · étiquette ${advice.rule.tag}`, durationMin: advice.pricing.durationMin ?? null };
  }
  const ctx = makeContext(input, now);
  const card = ctx.cards[cardId];
  const base = card ? reliableBase(card, ctx).value : null;
  if (base == null) return { price: null, detail: 'Aucun prix connu pour cette carte : saisis-le.', durationMin: null };
  const price = Math.max(1, Math.round(base));
  return { price, detail: `prix moyen ${price} (aucune règle d'étiquette pour cette carte)`, durationMin: durationFor(price, input.settings.durationRules) };
}

/** Cartes vendables selon les règles (pour les pastilles sur la collection). */
export function sellableCards(input: AllocationInput, now = Date.now()): Map<string, { rule: TagRule; price: number | null }> {
  const ctx = makeContext(input, now);
  const onSale = new Map<string, number>();
  for (const a of input.myAuctions.filter((x) => isActive(x, now))) onSale.set(a.cardId, (onSale.get(a.cardId) ?? 0) + 1);
  const out = new Map<string, { rule: TagRule; price: number | null }>();
  for (const rule of input.rules.filter((r) => r.active)) {
    for (const c of rankCandidates(rule, ctx, onSale, new Map())) {
      if (!out.has(c.card.id)) out.set(c.card.id, { rule, price: c.pricing.price });
    }
  }
  return out;
}

/** Nombre de slots libres (pour le badge). */
export function freeSlotCount(input: Pick<StoreShape, 'settings' | 'myAuctions'>, now = Date.now()): number {
  return Math.max(0, input.settings.slots - input.myAuctions.filter((a) => isActive(a, now)).length);
}

/** Somme des quotas des règles actives (doit rester ≤ nombre de slots). */
export function quotaSum(rules: TagRule[]): number {
  return rules.filter((r) => r.active).reduce((s, r) => s + r.quota, 0);
}
