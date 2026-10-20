import { cardVars, computePrice, indexObs, referencePrice, reliableBase, type PriceResult, type PricingContext } from './pricing';
import { hasRange, rangeStatus, ruleStatus } from './conditions';
import { sellChance, tierRule } from './salecalc';
import { durationFor } from './duration';
import { familiesOf, familyIndex, RARITY_ORDER } from './families';
import { evalFormula } from './formula';
import { reliableRate, type SellRate } from './sellrate';
import { normalize, sameTag } from './text';
import { DEFAULT_CRITERIA } from './sorting';
import type { Card, CardFamily, MyAuction, Priority, Settings, SortCriterion, StoreShape, TagRule } from './types';

export interface Candidate {
  card: Card;
  pricing: PriceResult;
  /** Exemplaires vendables (quantité − garderMin − déjà en vente). */
  sellable: number;
  /** Score de priorité (le plus haut d'abord). */
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
  /** Mode « meilleures cartes » : slot rempli par la liste commune à toutes les étiquettes. */
  pool?: boolean;
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
  /** Dans une de mes familles (protégées). */
  family: number;
}

/** Carte d'une de mes familles, protégée de la vente (sauf si l'étiquette vise justement cette famille). */
export function protectedByFamily(card: Card, ctx: PricingContext, rule?: TagRule): boolean {
  if (!ctx.settings.protectFamilies || !ctx.families) return false;
  const mine = familiesOf(ctx.families, card.siteId ?? null, card.name);
  if (!mine.length) return false;
  // Exception : une étiquette (mode « par étiquette ») posée sur cette famille par l'étiquetage (Familles).
  const targets = new Set(
    [rule?.when?.family ?? '', ...(rule ? ctx.settings.familyTags.filter((f) => f.active && sameTag(f.tag, rule.tag)).map((f) => f.family) : [])].map(normalize).filter(Boolean),
  );
  return !mine.some((f) => targets.has(normalize(f.name)));
}

/** Tdv fiable sous le minimum : la carte n'est pas proposée (elle reste vendable à la main). */
export function belowMinRate(card: Card, ctx: PricingContext): boolean {
  const min = ctx.settings.minSellRate;
  if (min == null) return false;
  const rate = reliableRate(ctx.sellRate?.(card), ctx.settings.sellRateMinSamples);
  return !!rate && rate.pct < min;
}

/** Compte les cartes d'une règle écartées, par motif. */
export function exclusions(rule: TagRule, ctx: PricingContext, onSale: Map<string, number>): Exclusions {
  const blacklist = new Set(ctx.settings.blacklist.map(normalize));
  const out: Exclusions = { total: 0, favorite: 0, blacklist: 0, onSale: 0, keep: 0, lowRate: 0, family: 0 };
  for (const card of Object.values(ctx.cards)) {
    if (!cardMatchesRule(card, rule, ctx)) continue;
    out.total++;
    if (card.favorite) out.favorite++;
    else if (blacklist.has(normalize(card.id)) || blacklist.has(normalize(card.name))) out.blacklist++;
    else if (protectedByFamily(card, ctx, rule)) out.family++;
    else if ((onSale.get(card.id) ?? 0) > 0 && !ctx.settings.allowDuplicateListing) out.onSale++;
    else if (card.quantity - rule.keepMin <= 0) out.keep++;
    else if (belowMinRate(card, ctx)) out.lowRate++;
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
  /** Mode « meilleures cartes » : nombre de cartes vendables et rang de la première proposée. */
  pool?: { size: number; offset: number };
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
  /** Mode « meilleures cartes » : rang de la première carte proposée. */
  poolOffset?: number;
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
  if (rule.tier) {
    // Palier de prix : filtre d'étiquettes des ventes, puis prix moyen dans la plage (sans plage : toutes les cartes).
    if (!passesSaleTags(card, ctx.settings)) return false;
    return !hasRange(rule) || rangeStatus(rule, referencePrice(card, ctx)) === 'yes';
  }
  if (rule.match === 'price') {
    // Plage de prix et conditions (texte, famille, taux de vente) ; sans plage, le prix n'est pas nécessaire.
    return ruleStatus(card, rule, hasRange(rule) ? referencePrice(card, ctx) : null, ctx) === 'yes';
  }
  return card.tags.some((t) => sameTag(t, rule.tag));
}

/** Filtre d'étiquettes du mode « meilleures cartes ». */
export function passesSaleTags(card: Card, settings: Settings): boolean {
  const { mode, tags } = settings.saleTags;
  if (!tags.length) return mode === 'exclude';
  const has = card.tags.some((t) => tags.some((x) => sameTag(t, x)));
  return mode === 'include' ? has : !has;
}

/**
 * Groupes de vente : les étiquettes (mode « par étiquette ») ou les paliers de prix (mode « meilleures cartes », un
 * seul groupe « toutes les cartes » sans palier), présentés au reste du moteur comme des règles.
 */
export function saleRules(input: Pick<AllocationInput, 'rules' | 'settings'>): TagRule[] {
  const { settings } = input;
  if (settings.allocationMode !== 'pool') return input.rules;
  const tiers = settings.priceTiers.filter((t) => t.active);
  if (!tiers.length) return [tierRule({ id: 'all', active: true, from: null, to: null, slots: settings.slots, calc: { ...settings.defaultCalc, mode: 'default' }, durationMin: null }, settings.keepMin)];
  return tiers.map((t) => tierRule(t, settings.keepMin));
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
    if (protectedByFamily(card, ctx, rule)) continue;
    const listed = (onSale.get(card.id) ?? 0) + (reserved.get(card.id) ?? 0);
    if (listed > 0 && !settings.allowDuplicateListing) continue;
    const sellable = card.quantity - rule.keepMin - listed;
    if (sellable <= 0) continue;
    if (belowMinRate(card, ctx)) continue;
    out.push({ card, sellable, pricing: computePrice(card, rule, ctx, peers) });
  }
  return sortCandidates(out, ctx);
}

/** Valeur d'un critère de tri pour une carte (null : inconnue, toujours en dernier). */
export function criterionValue(c: Candidate, key: SortCriterion['key'], ctx: PricingContext): number | null {
  const rate = ctx.sellRate?.(c.card) ?? null;
  switch (key) {
    case 'prix':
      return c.pricing.price;
    case 'prix_moyen':
      return c.pricing.base.value;
    case 'tdv':
      return reliableRate(rate, ctx.settings.sellRateMinSamples)?.pct ?? null;
    case 'chance':
      return Math.round(sellChance(rate) * 1000) / 10;
    case 'ventes':
      return rate?.sold ?? null;
    case 'encheres':
      return rate?.total ?? null;
    case 'doublons':
      return Math.max(0, c.card.quantity - 1);
    case 'rarete':
      return c.card.rarity ? RARITY_ORDER[c.card.rarity] + 1 : null;
    case 'hasard':
      return shuffleRank(c.card.id, ctx.settings.randomSeed);
  }
}

/** Score de priorité d'une carte (le plus haut d'abord ; null = inconnu, en dernier). */
export function priorityScore(c: Candidate, priority: Priority, ctx: PricingContext): number | null {
  const price = c.pricing.price;
  const rate = ctx.sellRate?.(c.card) ?? null;
  switch (priority) {
    case 'balanced':
      return price == null ? null : price * sellChance(rate);
    case 'value':
      return price;
    case 'formula':
      return evalFormula(ctx.settings.priorityFormula, scoreVars(c, ctx));
    default:
      return null;
  }
}

/** Critères équivalents aux priorités « vendre vite » et « écouler ». */
const PRIORITY_CRITERIA: Partial<Record<Priority, SortCriterion[]>> = {
  fast: [{ key: 'chance', dir: 'desc' }, { key: 'prix', dir: 'desc' }],
  clear: [{ key: 'doublons', dir: 'desc' }, { key: 'prix', dir: 'asc' }],
};

/** Trie des cartes candidates selon la priorité réglée (doublons d'abord si demandé). */
export function sortCandidates(out: Candidate[], ctx: PricingContext): Candidate[] {
  const { settings } = ctx;
  const priority = settings.priority;
  const criteria = priority === 'custom' ? (settings.sortCriteria.length ? settings.sortCriteria : DEFAULT_CRITERIA) : PRIORITY_CRITERIA[priority];
  const keys = new Map(
    out.map((c) => {
      c.score = criteria ? null : priorityScore(c, priority, ctx);
      // Chaque clé : valeur où le plus grand passe d'abord (null = inconnu, en dernier).
      const parts: (number | null)[] = criteria ? criteria.map((k) => { const v = criterionValue(c, k.key, ctx); return v == null ? null : k.dir === 'asc' ? -v : v; }) : [c.score];
      // Doublons d'abord : le plus d'exemplaires en premier.
      if (settings.duplicatesFirst) parts.unshift(c.card.quantity);
      return [c, parts];
    }),
  );
  return out.sort((a, b) => {
    const ka = keys.get(a)!;
    const kb = keys.get(b)!;
    for (let i = 0; i < ka.length; i++) {
      const x = ka[i];
      const y = kb[i];
      if (x === y) continue;
      if (x == null) return 1;
      if (y == null) return -1;
      return y - x;
    }
    return a.card.name.localeCompare(b.card.name);
  });
}

/** Variables d'une carte pour la formule de priorité (voir lib/formula.ts). */
export function scoreVars(c: Candidate, ctx: PricingContext): Record<string, number | null> {
  return { ...cardVars(c.card, ctx, c.pricing.base.value, { trustSales: ctx.settings.defaultCalc.trustSales, keepMin: c.card.quantity - c.sellable }), prix_conseille: c.pricing.price, vendables: c.sellable };
}

/**
 * F1–F3 – répartition des slots libres.
 * Par étiquette : chaque étiquette remplit ses slots réservés. Meilleures cartes : les paliers qui réservent des slots
 * (si l'option est activée) les remplissent d'abord, puis les slots restants reçoivent les cartes les mieux classées,
 * tous paliers confondus.
 */
export function allocate(input: AllocationInput, now = Date.now()): AllocationResult {
  const ctx = makeContext(input, now);
  const { settings } = input;
  const rules = saleRules(input);
  const pool = settings.allocationMode === 'pool';
  const active = input.myAuctions.filter((a) => isActive(a, now)).sort((a, b) => (a.endsAt ?? Infinity) - (b.endsAt ?? Infinity));

  const busy: BusySlot[] = active.map((auction) => ({ auction, rule: ruleForAuction(auction, rules, ctx) }));
  const onSale = new Map<string, number>();
  for (const a of active) onSale.set(a.cardId, (onSale.get(a.cardId) ?? 0) + 1);

  let freeCount = Math.max(0, settings.slots - active.length);
  const reserved = new Map<string, number>();
  const free: FreeSlot[] = [];
  const ignored = new Set(input.ignoredSlots);
  const fallback = !pool && settings.fallbackTag ? rules.find((r) => r.active && sameTag(r.tag, settings.fallbackTag)) ?? null : null;

  const quotas = !pool || settings.reserveTierSlots ? rules.filter((r) => r.active && r.quota > 0).sort((a, b) => b.quota - a.quota) : [];
  for (const rule of quotas) {
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
  const result: AllocationResult = { slots: settings.slots, busy, free, unassigned: freeCount, nextEnd: ends.length ? Math.min(...ends) : null, ctx };
  if (!pool) return result;
  const rest = poolSlots(input, rules, ctx, onSale, reserved, freeCount, ignored);
  result.free.push(...rest.free);
  result.unassigned = freeCount - rest.free.length;
  result.pool = { size: rest.size, offset: rest.offset };
  return result;
}

/**
 * Meilleures cartes : toutes les cartes vendables des paliers (une carte prend le calcul du premier palier qui la
 * couvre) forment une seule liste triée par priorité ; les slots libres reçoivent les cartes à partir du rang
 * `poolOffset` (« Suivant » avance d'une page, en boucle).
 */
function poolSlots(input: AllocationInput, rules: TagRule[], ctx: PricingContext, onSale: Map<string, number>, reserved: Map<string, number>, freeCount: number, ignored: Set<string>) {
  const active = rules.filter((r) => r.active);
  const all: Candidate[] = [];
  const ruleOf = new Map<string, TagRule>();
  for (const rule of active) {
    for (const c of rankCandidates(rule, ctx, onSale, reserved)) {
      if (ruleOf.has(c.card.id)) continue;
      ruleOf.set(c.card.id, rule);
      all.push(c);
    }
  }
  sortCandidates(all, ctx);
  const offset = all.length ? ((input.poolOffset ?? 0) % all.length + all.length) % all.length : 0;
  const page = [...all.slice(offset), ...all.slice(0, offset)];
  const taken = new Set<string>();
  const free: FreeSlot[] = [];
  if (!active.length) return { free, size: 0, offset: 0 };
  for (let i = 0; i < freeCount; i++) {
    const key = `pool:${i}`;
    const overrideId = input.slotOverrides[key];
    const proposal = page.find((c) => c.card.id === overrideId && !taken.has(c.card.id)) ?? page.find((c) => !taken.has(c.card.id)) ?? null;
    if (proposal) taken.add(proposal.card.id);
    const rule = proposal ? ruleOf.get(proposal.card.id)! : active[0];
    free.push({ key, rule, fromRule: null, proposal, candidates: page, ignored: ignored.has(key), excluded: proposal ? null : exclusions(rule, ctx, onSale), pool: true });
  }
  return { free, size: all.length, offset };
}

/** Prix conseillé pour une carte donnée, avec la première règle active qui la couvre. */
export function adviceForCard(input: AllocationInput, cardId: string, now = Date.now()): { rule: TagRule; pricing: PriceResult } | null {
  const ctx = makeContext(input, now);
  const card = ctx.cards[cardId];
  if (!card) return null;
  const active = saleRules(input).filter((r) => r.active);
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
    return { price: advice.pricing.price, detail: `${advice.pricing.detail} · ${advice.rule.tier ? 'palier' : 'étiquette'} ${advice.rule.tag}`, durationMin: advice.pricing.durationMin ?? null };
  }
  const ctx = makeContext(input, now);
  const card = ctx.cards[cardId];
  const base = card ? reliableBase(card, ctx).value : null;
  if (base == null) return { price: null, detail: 'Aucun prix connu pour cette carte : saisis-le.', durationMin: null };
  const price = Math.max(1, Math.round(base));
  return { price, detail: `prix moyen ${price} (carte hors de tes ventes)`, durationMin: durationFor(price, input.settings.durationRules) };
}

/** Cartes vendables selon les règles (pour les pastilles sur la collection). */
export function sellableCards(input: AllocationInput, now = Date.now()): Map<string, { rule: TagRule; price: number | null }> {
  const ctx = makeContext(input, now);
  const onSale = new Map<string, number>();
  for (const a of input.myAuctions.filter((x) => isActive(x, now))) onSale.set(a.cardId, (onSale.get(a.cardId) ?? 0) + 1);
  const out = new Map<string, { rule: TagRule; price: number | null }>();
  for (const rule of saleRules(input).filter((r) => r.active)) {
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
