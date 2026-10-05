/**
 * Onglets du Marché (logique sans affichage) : repérage des onglets du site, contrat avec la barre latérale
 * (`?wtab=…`), slots libres, carte au hasard, filtres de mes mises, statistiques de mes ventes.
 *
 * Barre d'onglets réelle (/marketplace) : boutons frères sans attribut ARIA, l'onglet actif ne diffère que par
 * ses classes : « Parcourir », « Mes ventes (2/5) », « Mes enchères (2) », « Gagnées », « Historique (8) ».
 */
import { cardMatchesRule, isActive, makeContext, rankCandidates, type AllocationInput, type Candidate } from '../../lib/allocation';
import { normalize, sameTag } from '../../lib/text';
import type { MyBid, SoldItem } from '../../lib/types';

export type MarketTab = 'browse' | 'sales' | 'bids' | 'history' | 'won';
/** Onglets que la barre latérale peut demander (`?wtab=`, événement `wiky-market-tab`). */
export type RequestedTab = Exclude<MarketTab, 'won'>;

export const TAB_RES: Record<MarketTab, RegExp> = {
  browse: /^parcourir/i,
  sales: /^mes ventes/i,
  bids: /^mes ench[eè]res/i,
  history: /^historique/i,
  won: /^gagn[ée]/i,
};

const REQUESTABLE: RequestedTab[] = ['browse', 'sales', 'bids', 'history'];

export function asRequestedTab(v: unknown): RequestedTab | null {
  return typeof v === 'string' && (REQUESTABLE as string[]).includes(v) ? (v as RequestedTab) : null;
}

const clean = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();

export function tabKeyOf(label: string | null | undefined): MarketTab | null {
  const t = clean(label);
  for (const [k, rx] of Object.entries(TAB_RES) as [MarketTab, RegExp][]) if (rx.test(t)) return k;
  return null;
}

/** Page « Marché » (liste), pas la page d'une enchère. */
export function isMarketplacePath(path: string): boolean {
  return /^\/marketplace\/?$/.test(path);
}

/** Barre d'onglets du Marché : conteneur d'au moins 3 boutons frères dont « Mes ventes ». */
export function marketTabBar(root: ParentNode = document): HTMLElement | null {
  for (const btn of root.querySelectorAll<HTMLElement>('button')) {
    if (btn.closest('[data-wiky]') || !TAB_RES.sales.test(clean(btn.textContent))) continue;
    const bar = btn.parentElement;
    if (bar && bar.querySelectorAll(':scope > button').length >= 3) return bar;
  }
  return null;
}

export function tabButtons(bar: Element): HTMLElement[] {
  return [...bar.querySelectorAll<HTMLElement>(':scope > button')];
}

export function tabButton(bar: Element, tab: MarketTab): HTMLElement | null {
  return tabButtons(bar).find((b) => TAB_RES[tab].test(clean(b.textContent))) ?? null;
}

/** Onglet actif : marqué ARIA s'il l'est un jour, sinon le seul bouton dont les classes diffèrent des autres. */
export function activeMarketTab(bar: Element | null): MarketTab | null {
  if (!bar) return null;
  const tabs = tabButtons(bar);
  const marked = tabs.find((t) => t.getAttribute('aria-selected') === 'true' || t.getAttribute('data-state') === 'active');
  if (marked) return tabKeyOf(marked.textContent);
  const classes = tabs.map((t) => t.getAttribute('class') ?? '');
  const counts = new Map<string, number>();
  for (const c of classes) counts.set(c, (counts.get(c) ?? 0) + 1);
  const unique = tabs.filter((_, i) => counts.get(classes[i]) === 1);
  if (unique.length === 1 && counts.size === 2) return tabKeyOf(unique[0].textContent);
  return null;
}

/** « Mes ventes (2/5) » → { active: 2, slots: 5 }. */
export function salesCounter(bar: Element | null): { active: number; slots: number } | null {
  const btn = bar ? tabButton(bar, 'sales') : null;
  const m = clean(btn?.textContent).match(/\((\d+)\s*\/\s*(\d+)\)/);
  return m ? { active: Number(m[1]), slots: Number(m[2]) } : null;
}

/** URL sans le paramètre `wtab` (les autres paramètres sont gardés). */
export function withoutWtab(href: string): string {
  const u = new URL(href);
  u.searchParams.delete('wtab');
  return u.pathname + (u.searchParams.toString() ? `?${u.searchParams}` : '') + u.hash;
}

// ---------------------------------------------------------------- vente

/** Mes cartes en vente (enchères en cours), par carte. */
export function onSaleMap(input: Pick<AllocationInput, 'myAuctions'>, now: number): Map<string, number> {
  const onSale = new Map<string, number>();
  for (const a of input.myAuctions.filter((x) => isActive(x, now))) onSale.set(a.cardId, (onSale.get(a.cardId) ?? 0) + 1);
  return onSale;
}

/**
 * Cartes vendables d'une étiquette, avec les règles de l'allocation (`rankCandidates`) : ni favorite, ni sur liste
 * noire, ni déjà en vente, et au-delà du « garder au moins » de la règle.
 */
export function tagCandidates(input: AllocationInput, tag: string, now = Date.now()): Candidate[] {
  const rule = input.rules.find((r) => r.active && sameTag(r.tag, tag));
  if (!rule) return [];
  return rankCandidates(rule, makeContext(input, now), onSaleMap(input, now), new Map());
}

/** Carte au hasard parmi les cartes vendables d'une étiquette (null : aucune). */
export function randomCandidate(input: AllocationInput, tag: string, rand: () => number = Math.random, now = Date.now(), exclude: string[] = []): Candidate | null {
  const all = tagCandidates(input, tag, now);
  const pool = all.filter((c) => !exclude.includes(c.card.id));
  const list = pool.length ? pool : all;
  if (!list.length) return null;
  return list[Math.min(list.length - 1, Math.floor(rand() * list.length))];
}

/** Toutes mes cartes vendables (une entrée par carte, première règle qui la couvre), pour la recherche. */
export function sellablePool(input: AllocationInput, now = Date.now()): Candidate[] {
  const ctx = makeContext(input, now);
  const onSale = onSaleMap(input, now);
  const out = new Map<string, Candidate>();
  for (const rule of input.rules.filter((r) => r.active)) {
    for (const c of rankCandidates(rule, ctx, onSale, new Map())) if (!out.has(c.card.id)) out.set(c.card.id, c);
  }
  return [...out.values()];
}

export function searchPool(pool: Candidate[], q: string, limit = 8): Candidate[] {
  const n = normalize(q.trim());
  if (!n) return [];
  return pool.filter((c) => normalize(`${c.card.name} ${c.card.category ?? ''}`).includes(n)).sort((a, b) => a.card.name.localeCompare(b.card.name)).slice(0, limit);
}

/** Étiquettes proposées pour la carte au hasard : règles actives qui ont au moins une carte. */
export function randomTags(input: AllocationInput, now = Date.now()): string[] {
  const ctx = makeContext(input, now);
  const cards = Object.values(input.cards);
  return input.rules.filter((r) => r.active && cards.some((c) => cardMatchesRule(c, r, ctx))).map((r) => r.tag);
}

// ---------------------------------------------------------------- mes mises

export type BidsFilter = 'current' | 'history' | 'all';

export function isRunningBid(b: MyBid, now: number): boolean {
  return (b.status === 'leading' || b.status === 'outbid') && (b.endsAt == null || b.endsAt > now);
}

/** Mises filtrées et triées : en cours d'abord (fin la plus proche), puis les plus récentes. */
export function filterBids(bids: MyBid[], filter: BidsFilter, now: number): MyBid[] {
  const list = bids.filter((b) => (filter === 'all' ? true : filter === 'current' ? isRunningBid(b, now) : !isRunningBid(b, now)));
  return list.sort((a, b) => {
    const ra = isRunningBid(a, now);
    const rb = isRunningBid(b, now);
    if (ra !== rb) return ra ? -1 : 1;
    if (ra) return (a.endsAt ?? Infinity) - (b.endsAt ?? Infinity);
    return (b.endsAt ?? b.lastBidAt) - (a.endsAt ?? a.lastBidAt);
  });
}

/** Écart relatif (−0,12 = −12 %) ; null si une valeur manque. */
export function gap(value: number | null | undefined, ref: number | null | undefined): number | null {
  if (value == null || ref == null || !(ref > 0)) return null;
  return (value - ref) / ref;
}

// ---------------------------------------------------------------- mes ventes

export type SalesFilter = 'all' | 'sold' | 'unsold';
export type SalesSort = 'date' | 'price' | 'gap';

export interface SalesStats {
  sold: number;
  unsold: number;
  /** Part des ventes conclues (0–1), null sans vente terminée. */
  rate: number | null;
  /** Total encaissé (prix finaux des ventes conclues). */
  total: number;
  /** Gain moyen par rapport au prix de départ (relatif), ventes conclues seulement. */
  avgVsStart: number | null;
  /** Écart moyen par rapport au prix de référence de la carte (relatif). */
  avgVsRef: number | null;
  best: SoldItem | null;
}

const mean = (l: number[]) => (l.length ? l.reduce((a, b) => a + b, 0) / l.length : null);

export function salesStats(items: SoldItem[], refOf: (i: SoldItem) => number | null): SalesStats {
  const sold = items.filter((i) => i.sold);
  const vsStart = sold.map((i) => gap(i.final, i.start)).filter((g): g is number => g != null);
  const vsRef = sold.map((i) => gap(i.final, refOf(i))).filter((g): g is number => g != null);
  return {
    sold: sold.length,
    unsold: items.length - sold.length,
    rate: items.length ? sold.length / items.length : null,
    total: sold.reduce((t, i) => t + (i.final ?? 0), 0),
    avgVsStart: mean(vsStart),
    avgVsRef: mean(vsRef),
    best: sold.reduce<SoldItem | null>((b, i) => (i.final != null && (b == null || i.final > (b.final ?? 0)) ? i : b), null),
  };
}

export function filterSales(items: SoldItem[], filter: SalesFilter, q: string, sort: SalesSort, refOf: (i: SoldItem) => number | null): SoldItem[] {
  const n = normalize(q.trim());
  const list = items.filter((i) => (filter === 'all' || (filter === 'sold') === i.sold) && (!n || normalize(i.cardName).includes(n)));
  const priceOf = (i: SoldItem) => (i.sold ? i.final : i.start) ?? -Infinity;
  const gapOf = (i: SoldItem) => (i.sold ? gap(i.final, refOf(i)) : null) ?? -Infinity;
  return list.sort((a, b) => {
    if (sort === 'price') return priceOf(b) - priceOf(a);
    if (sort === 'gap') return gapOf(b) - gapOf(a);
    return (b.endedAt ?? 0) - (a.endedAt ?? 0);
  });
}
