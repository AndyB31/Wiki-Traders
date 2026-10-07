/**
 * Catalogue des cartes et prix moyens, partagés par toutes les fonctionnalités (familles, prix sur les cartes,
 * classement, échanges, paquets…). Pensé pour être rapide :
 *  - recherche au fil de la frappe (une requête, annulable) ;
 *  - cartes par identifiant en lots de 150 ;
 *  - prix moyens de **toutes** les cartes demandées en une requête par lot de 150 (au lieu d'une par carte),
 *    gardés en mémoire et dans le stockage de l'extension (6 h) ;
 *  - les demandes simultanées sont regroupées (une seule requête en vol par carte).
 */
import { catalogPrice } from '../lib/autotag';
import { ext } from '../lib/browser';
import { CARD_PRICES_KEY } from '../lib/defaults';
import { median } from '../lib/pricing';
import type { Card, CatalogCard, Rarity } from '../lib/types';
import { discoverConfig, get, getAll, inList, readSession } from './api';

const RARITIES = new Set<Rarity>(['C', 'PC', 'R', 'SR', 'UR', 'L']);
const CARD_FIELDS = 'id,wikipedia_title,rarity,category,image_url,wikipedia_url,atk,def';
const BATCH = 150;

interface CardRow {
  id: string;
  wikipedia_title: string;
  rarity: string | null;
  category: string | null;
  image_url: string | null;
  wikipedia_url: string | null;
  atk: number | null;
  def: number | null;
}

export function toCatalogCard(r: CardRow): CatalogCard {
  return {
    siteId: r.id,
    title: r.wikipedia_title,
    rarity: RARITIES.has(r.rarity as Rarity) ? (r.rarity as Rarity) : null,
    category: r.category ?? null,
    imageUrl: r.image_url ?? null,
    wikipediaUrl: r.wikipedia_url ?? null,
    atk: r.atk ?? null,
    def: r.def ?? null,
  };
}

async function api() {
  const cfg = await discoverConfig();
  return { cfg, session: readSession(cfg) };
}

const cardCache = new Map<string, CatalogCard>();

/** Caractères spéciaux de PostgREST neutralisés dans un motif `ilike`. */
function pattern(q: string): string {
  return encodeURIComponent(`*${q.trim().replace(/[*,()"\\]/g, ' ').replace(/\s+/g, '*')}*`);
}

export interface SearchResult {
  cards: CatalogCard[];
  hasMore: boolean;
}

/** Recherche dans tout le catalogue (titre ou catégorie), triée par titre. */
export async function searchCards(q: string, opts: { offset?: number; limit?: number; rarity?: Rarity | null } = {}): Promise<SearchResult> {
  const limit = opts.limit ?? 60;
  const offset = opts.offset ?? 0;
  const { cfg, session } = await api();
  const p = pattern(q);
  const rarity = opts.rarity ? `&rarity=eq.${opts.rarity}` : '';
  const rows = await get<CardRow[]>(
    cfg,
    session,
    `cards?select=${CARD_FIELDS}&or=(wikipedia_title.ilike.${p},category.ilike.${p})${rarity}&order=wikipedia_title.asc&limit=${limit + 1}&offset=${offset}`,
  );
  const cards = rows.slice(0, limit).map(toCatalogCard);
  for (const c of cards) cardCache.set(c.siteId, c);
  return { cards, hasMore: rows.length > limit };
}

/** Cartes du catalogue par identifiant (en lots, avec cache). */
export async function cardsByIds(ids: string[]): Promise<Map<string, CatalogCard>> {
  const out = new Map<string, CatalogCard>();
  const missing = [...new Set(ids)].filter((id) => {
    const c = cardCache.get(id);
    if (c) out.set(id, c);
    return !c;
  });
  if (!missing.length) return out;
  const { cfg, session } = await api();
  for (let i = 0; i < missing.length; i += BATCH) {
    const rows = await get<CardRow[]>(cfg, session, `cards?select=${CARD_FIELDS}&id=${inList(missing.slice(i, i + BATCH))}`);
    for (const r of rows) {
      const c = toCatalogCard(r);
      cardCache.set(c.siteId, c);
      out.set(c.siteId, c);
    }
  }
  return out;
}

/**
 * Cartes du catalogue par titre exact (pour une carte affichée dont on ne connaît que le nom),
 * en lots de 150 titres. Clé du résultat : titre tel que demandé.
 */
export async function cardsByTitles(titles: string[]): Promise<Map<string, CatalogCard>> {
  const out = new Map<string, CatalogCard>();
  const wanted = [...new Set(titles.map((t) => t.trim()).filter((t) => t && !/["\\]/.test(t)))];
  const set = new Set(wanted);
  for (const c of cardCache.values()) if (set.has(c.title)) out.set(c.title, c);
  const missing = wanted.filter((t) => !out.has(t));
  if (!missing.length) return out;
  const { cfg, session } = await api();
  for (let i = 0; i < missing.length; i += BATCH) {
    const list = missing.slice(i, i + BATCH).map((t) => `"${t}"`).join(',');
    const rows = await get<CardRow[]>(cfg, session, `cards?select=${CARD_FIELDS}&wikipedia_title=in.(${encodeURIComponent(list)})`);
    for (const r of rows) {
      const c = toCatalogCard(r);
      cardCache.set(c.siteId, c);
      out.set(c.title, c);
    }
  }
  return out;
}

/** Enchère en cours d'une carte (marché). */
export interface ActiveAuction {
  id: string;
  cardId: string;
  /** Mise actuelle, sinon prix de départ. */
  price: number;
  hasBid: boolean;
  endsAt: number | null;
  shiny: boolean;
}

/**
 * Enchères en cours de toutes les cartes demandées : une requête par lot de 150 cartes (au lieu d'une
 * recherche par carte). Résultat groupé par carte, la moins chère d'abord.
 */
export async function activeAuctionsFor(ids: string[]): Promise<Map<string, ActiveAuction[]>> {
  const out = new Map<string, ActiveAuction[]>();
  const wanted = [...new Set(ids)];
  if (!wanted.length) return out;
  const { cfg, session } = await api();
  const now = Date.now();
  const batches: Promise<void>[] = [];
  for (let i = 0; i < wanted.length; i += BATCH) {
    const batch = wanted.slice(i, i + BATCH);
    batches.push(
      getAll<{ id: string; card_id: string; base_amount: number | null; current_bid: number | null; end_at: string | null; is_shiny: boolean | null; status: string }>(
        cfg,
        session,
        `auctions?select=id,card_id,base_amount,current_bid,end_at,is_shiny,status&status=eq.active&card_id=${inList(batch)}`,
      ).then((rows) => {
        for (const r of rows) {
          const endsAt = r.end_at ? Date.parse(r.end_at) || null : null;
          if (endsAt != null && endsAt <= now) continue;
          const a: ActiveAuction = {
            id: r.id,
            cardId: r.card_id,
            price: r.current_bid ?? r.base_amount ?? 0,
            hasBid: r.current_bid != null && r.current_bid > (r.base_amount ?? 0),
            endsAt,
            shiny: !!r.is_shiny,
          };
          out.set(a.cardId, [...(out.get(a.cardId) ?? []), a]);
        }
      }),
    );
  }
  await Promise.all(batches);
  for (const list of out.values()) list.sort((a, b) => a.price - b.price || (a.endsAt ?? Infinity) - (b.endsAt ?? Infinity));
  return out;
}

// ---------------------------------------------------------------- prix moyens

/** Ventes conclues d'une carte pour une rareté donnée (le site calcule sa moyenne rareté par rareté). */
export interface RarityPrice {
  mean: number;
  count: number;
}

export interface CardPrice {
  /** Médiane des ventes conclues (null : jamais vendue). */
  median: number | null;
  /** Moyenne de toutes les ventes conclues, toutes raretés confondues. */
  mean: number | null;
  count: number;
  /**
   * Moyenne par rareté de la carte au moment de la vente (`snapshot_rarity`), comme le « Prix moyen » du site :
   * une même carte peut avoir été vendue en Rare et en Super Rare, à des prix très différents.
   */
  byRarity?: Partial<Record<Rarity, RarityPrice>>;
  /** Vente la plus basse / la plus haute (absentes des anciennes entrées du cache). */
  min?: number | null;
  max?: number | null;
  at: number;
}

// v3 : ventes lues en entier (pagination) ; les entrées des versions précédentes, parfois tronquées, sont ignorées.
const PRICE_KEY = CARD_PRICES_KEY;
const PRICE_TTL = 6 * 3600_000;
const prices = new Map<string, CardPrice>();
let loaded: Promise<void> | null = null;
const inflight = new Map<string, Promise<void>>();
let persistTimer: ReturnType<typeof setTimeout> | undefined;

function loadPrices(): Promise<void> {
  loaded ??= (async () => {
    try {
      const raw = (await ext.storage.local.get(PRICE_KEY))[PRICE_KEY] as Record<string, CardPrice> | undefined;
      const now = Date.now();
      for (const [id, p] of Object.entries(raw ?? {})) if (now - p.at < PRICE_TTL) prices.set(id, p);
    } catch {
      // Stockage indisponible (tests) : cache en mémoire seulement.
    }
  })();
  return loaded;
}

/** Enregistre tout de suite le cache des prix (la popup le lit pour l'étiquetage). */
export async function flushPrices(): Promise<void> {
  clearTimeout(persistTimer);
  try {
    await ext.storage.local.set({ [PRICE_KEY]: Object.fromEntries(prices) });
  } catch {
    // Stockage indisponible (tests).
  }
}

function persistPrices(): void {
  clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    try {
      void ext.storage.local.set({ [PRICE_KEY]: Object.fromEntries(prices) });
    } catch {
      // idem
    }
  }, 1000);
}

/** Prix déjà connus (synchrone, pour un affichage immédiat). */
export function knownPrice(siteId: string): CardPrice | undefined {
  return prices.get(siteId);
}

/** Vrai prix moyen d'une carte de ma collection d'après le cache (pour le prix conseillé) ; lit le cache stocké au besoin. */
export function knownCardPrice(card: Card): number | null {
  void loadPrices();
  return card.siteId ? catalogPrice(knownPrice(card.siteId), card.rarity) : null;
}

async function fetchPrices(ids: string[]): Promise<void> {
  const { cfg, session } = await api();
  // Toutes les ventes du lot, page par page : le serveur plafonne chaque réponse (1 000 lignes), et un lot de cartes
  // courantes en dépasse vite le total — sans pagination, des cartes apparaîtraient sans vente (« — »).
  const rows = await getAll<{ card_id: string; final_price: number | null; snapshot_rarity: string | null }>(
    cfg,
    session,
    `auctions?select=card_id,final_price,snapshot_rarity&status=eq.settled_sold&card_id=${inList(ids)}`,
  );
  const byCard = new Map<string, number[]>();
  const byCardRarity = new Map<string, Map<Rarity, number[]>>();
  for (const r of rows) {
    if (r.final_price == null) continue;
    byCard.set(r.card_id, [...(byCard.get(r.card_id) ?? []), r.final_price]);
    if (RARITIES.has(r.snapshot_rarity as Rarity)) {
      const m = byCardRarity.get(r.card_id) ?? new Map<Rarity, number[]>();
      m.set(r.snapshot_rarity as Rarity, [...(m.get(r.snapshot_rarity as Rarity) ?? []), r.final_price]);
      byCardRarity.set(r.card_id, m);
    }
  }
  const now = Date.now();
  const avg = (list: number[]) => Math.round(list.reduce((a, b) => a + b, 0) / list.length);
  for (const id of ids) {
    const list = byCard.get(id) ?? [];
    const byRarity: Partial<Record<Rarity, RarityPrice>> = {};
    for (const [r, l] of byCardRarity.get(id) ?? []) byRarity[r] = { mean: avg(l), count: l.length };
    prices.set(id, {
      byRarity,
      median: median(list),
      mean: list.length ? Math.round(list.reduce((a, b) => a + b, 0) / list.length) : null,
      count: list.length,
      min: list.length ? Math.min(...list) : null,
      max: list.length ? Math.max(...list) : null,
      at: now,
    });
  }
}

/**
 * Prix moyens des cartes demandées : le cache répond tout de suite, le reste est chargé par lots de 150
 * (une requête par lot, en parallèle limité). `force` ignore le cache.
 */
export async function cardPrices(ids: string[], force = false): Promise<Map<string, CardPrice>> {
  await loadPrices();
  const now = Date.now();
  const wanted = [...new Set(ids)];
  const todo = wanted.filter((id) => force || !prices.has(id) || now - prices.get(id)!.at > PRICE_TTL);
  const waits: Promise<void>[] = [];
  const fresh = todo.filter((id) => {
    const pending = inflight.get(id);
    if (pending) waits.push(pending);
    return !pending;
  });
  for (let i = 0; i < fresh.length; i += BATCH) {
    const batch = fresh.slice(i, i + BATCH);
    const job = fetchPrices(batch).finally(() => batch.forEach((id) => inflight.delete(id)));
    batch.forEach((id) => inflight.set(id, job));
    waits.push(job);
  }
  if (waits.length) {
    await Promise.allSettled(waits);
    persistPrices();
  }
  return new Map(wanted.flatMap((id) => (prices.has(id) ? [[id, prices.get(id)!] as const] : [])));
}

/** Prix affiché : moyenne des ventes, dans la rareté de la carte si elle est connue (comme le site). */
export function displayPrice(p: CardPrice | undefined, rarity?: Rarity | null): number | null {
  if (!p) return null;
  // Comme le « Prix moyen » du site : la moyenne des ventes de la carte dans sa rareté, à défaut toutes raretés.
  return (rarity ? p.byRarity?.[rarity]?.mean : undefined) ?? p.mean ?? null;
}

/** Nombre de ventes derrière le prix affiché (même rareté si connue). */
export function displayCount(p: CardPrice | undefined, rarity?: Rarity | null): number {
  if (!p) return 0;
  return (rarity ? p.byRarity?.[rarity]?.count : undefined) ?? p.count;
}

// ---------------------------------------------------------------- titre → identifiant, enchère → carte

const idByTitle = new Map<string, string | null>();

/** Filtre PostgREST `in.(…)` pour des textes quelconques (guillemets échappés, valeurs encodées). */
function textInList(values: string[]): string {
  return `in.(${values.map((v) => `"${encodeURIComponent(v.replace(/["\\]/g, '\\$&'))}"`).join(',')})`;
}

/**
 * Identifiants du site pour des titres de cartes (collection globale, fiche d'une carte) : lots de 150 titres
 * par requête, résultats (même absents) gardés en mémoire.
 */
export async function cardIdsByTitles(titles: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const missing: string[] = [];
  for (const t of new Set(titles.map((x) => x.trim()).filter(Boolean))) {
    if (idByTitle.has(t)) {
      const id = idByTitle.get(t);
      if (id) out.set(t, id);
    } else missing.push(t);
  }
  if (!missing.length) return out;
  const { cfg, session } = await api();
  for (let i = 0; i < missing.length; i += BATCH) {
    const batch = missing.slice(i, i + BATCH);
    const rows = await get<CardRow[]>(cfg, session, `cards?select=${CARD_FIELDS}&wikipedia_title=${textInList(batch)}`);
    for (const t of batch) idByTitle.set(t, null);
    const wanted = new Set(batch);
    for (const r of rows) {
      const c = toCatalogCard(r);
      cardCache.set(c.siteId, c);
      idByTitle.set(c.title, c.siteId);
      if (wanted.has(c.title)) out.set(c.title, c.siteId);
    }
  }
  return out;
}

/** Identifiant déjà connu pour un titre (synchrone ; undefined : jamais demandé, null : introuvable). */
export function knownCardId(title: string): string | null | undefined {
  return idByTitle.get(title.trim());
}

/** Carte du catalogue déjà chargée (synchrone). */
export function knownCard(siteId: string): CatalogCard | undefined {
  return cardCache.get(siteId);
}

const cardByAuction = new Map<string, string | null>();

/** Carte (identifiant du site) mise en vente dans une enchère. */
export async function cardIdForAuction(auctionId: string): Promise<string | null> {
  if (cardByAuction.has(auctionId)) return cardByAuction.get(auctionId)!;
  const { cfg, session } = await api();
  const rows = await get<{ card_id: string }[]>(cfg, session, `auctions?select=card_id&id=eq.${encodeURIComponent(auctionId)}&limit=1`);
  const id = rows[0]?.card_id ?? null;
  cardByAuction.set(auctionId, id);
  return id;
}

/** Pour les tests. */
export function resetCatalog(): void {
  idByTitle.clear();
  cardByAuction.clear();
  cardCache.clear();
  prices.clear();
  inflight.clear();
  loaded = null;
}

// ---------------------------------------------------------------- historique des ventes d'une carte

export interface CardSale {
  id: string;
  price: number | null;
  start: number | null;
  rarity: Rarity | null;
  shiny: boolean;
  at: number;
  sold: boolean;
  outcome: 'sold' | 'unsold' | 'cancelled';
}

const historyCache = new Map<string, { at: number; value: Promise<CardSale[]> }>();
const HISTORY_TTL = 5 * 60_000;

/** Toutes les enchères terminées d'une carte (vendues, sans acheteur, annulées), de la plus ancienne à la plus récente. */
export function cardSalesHistory(siteId: string, force = false): Promise<CardSale[]> {
  const hit = historyCache.get(siteId);
  if (!force && hit && Date.now() - hit.at < HISTORY_TTL) return hit.value;
  const value = (async () => {
    const { cfg, session } = await api();
    const rows = await getAll<{ id: string; final_price: number | null; base_amount: number | null; snapshot_rarity: string | null; is_shiny: boolean | null; end_at: string | null; settled_at: string | null; status: string }>(
      cfg,
      session,
      `auctions?select=id,final_price,base_amount,snapshot_rarity,is_shiny,end_at,settled_at,status&card_id=eq.${encodeURIComponent(siteId)}&status=in.(settled_sold,settled_unsold,cancelled)&order=end_at.asc`,
    );
    return rows.flatMap((r) => {
      const at = Date.parse(r.settled_at ?? r.end_at ?? '');
      if (!Number.isFinite(at)) return [];
      return [{
        id: r.id,
        price: r.status === 'settled_sold' ? r.final_price : null,
        start: r.base_amount,
        rarity: RARITIES.has(r.snapshot_rarity as Rarity) ? (r.snapshot_rarity as Rarity) : null,
        shiny: !!r.is_shiny,
        at,
        sold: r.status === 'settled_sold' && r.final_price != null,
        outcome: r.status === 'settled_sold' && r.final_price != null ? ('sold' as const) : r.status === 'cancelled' ? ('cancelled' as const) : ('unsold' as const),
      }];
    });
  })();
  historyCache.set(siteId, { at: Date.now(), value });
  value.catch(() => historyCache.delete(siteId));
  return value;
}

export interface AuctionInfo {
  cardId: string;
  rarity: Rarity | null;
  shiny: boolean;
  current: number | null;
  start: number | null;
  hasBid: boolean;
}

/** Carte, rareté et mise actuelle d'une enchère. */
export async function auctionInfo(auctionId: string): Promise<AuctionInfo | null> {
  const { cfg, session } = await api();
  const rows = await get<{ card_id: string; snapshot_rarity: string | null; is_shiny: boolean | null; current_bid: number | null; base_amount: number | null }[]>(
    cfg,
    session,
    `auctions?select=card_id,snapshot_rarity,is_shiny,current_bid,base_amount&id=eq.${encodeURIComponent(auctionId)}&limit=1`,
  );
  const r = rows[0];
  if (!r) return null;
  return {
    cardId: r.card_id,
    rarity: RARITIES.has(r.snapshot_rarity as Rarity) ? (r.snapshot_rarity as Rarity) : null,
    shiny: !!r.is_shiny,
    current: r.current_bid ?? r.base_amount,
    start: r.base_amount,
    hasBid: r.current_bid != null && r.current_bid > (r.base_amount ?? 0),
  };
}

// ---------------------------------------------------------------- enchères → cartes (par lots)

export interface AuctionCard {
  cardId: string;
  rarity: Rarity | null;
  shiny: boolean;
}

const auctionCards = new Map<string, AuctionCard | null>();

/** Carte, rareté et brillance de chaque enchère (150 par requête, mis en cache). */
export async function cardsForAuctions(ids: string[]): Promise<Map<string, AuctionCard>> {
  const todo = [...new Set(ids)].filter((id) => !auctionCards.has(id));
  if (todo.length) {
    const { cfg, session } = await api();
    for (let i = 0; i < todo.length; i += BATCH) {
      const batch = todo.slice(i, i + BATCH);
      const rows = await get<{ id: string; card_id: string; snapshot_rarity: string | null; is_shiny: boolean | null }[]>(
        cfg,
        session,
        `auctions?select=id,card_id,snapshot_rarity,is_shiny&id=${inList(batch)}`,
      );
      for (const id of batch) auctionCards.set(id, null);
      for (const r of rows) {
        auctionCards.set(r.id, { cardId: r.card_id, rarity: RARITIES.has(r.snapshot_rarity as Rarity) ? (r.snapshot_rarity as Rarity) : null, shiny: !!r.is_shiny });
        cardByAuction.set(r.id, r.card_id);
      }
    }
  }
  return new Map(ids.flatMap((id) => (auctionCards.get(id) ? [[id, auctionCards.get(id)!] as const] : [])));
}

/** Carte d'une enchère déjà connue (synchrone). */
export function knownAuctionCard(auctionId: string): AuctionCard | null | undefined {
  return auctionCards.get(auctionId);
}
