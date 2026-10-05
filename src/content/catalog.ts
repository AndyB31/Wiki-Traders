/**
 * Catalogue des cartes et prix moyens, partagés par toutes les fonctionnalités (familles, prix sur les cartes,
 * classement, échanges, paquets…). Pensé pour être rapide :
 *  - recherche au fil de la frappe (une requête, annulable) ;
 *  - cartes par identifiant en lots de 150 ;
 *  - prix moyens de **toutes** les cartes demandées en une requête par lot de 150 (au lieu d'une par carte),
 *    gardés en mémoire et dans le stockage de l'extension (6 h) ;
 *  - les demandes simultanées sont regroupées (une seule requête en vol par carte).
 */
import { ext } from '../lib/browser';
import { median } from '../lib/pricing';
import type { CatalogCard, Rarity } from '../lib/types';
import { discoverConfig, get, inList, readSession } from './api';

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
      get<{ id: string; card_id: string; base_amount: number | null; current_bid: number | null; end_at: string | null; is_shiny: boolean | null; status: string }[]>(
        cfg,
        session,
        `auctions?select=id,card_id,base_amount,current_bid,end_at,is_shiny,status&status=eq.active&card_id=${inList(batch)}&limit=5000`,
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

export interface CardPrice {
  /** Médiane des ventes conclues (null : jamais vendue). */
  median: number | null;
  mean: number | null;
  count: number;
  at: number;
}

const PRICE_KEY = 'cardPrices';
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

async function fetchPrices(ids: string[]): Promise<void> {
  const { cfg, session } = await api();
  const rows = await get<{ card_id: string; final_price: number | null }[]>(
    cfg,
    session,
    `auctions?select=card_id,final_price&status=eq.settled_sold&card_id=${inList(ids)}&limit=20000`,
  );
  const byCard = new Map<string, number[]>();
  for (const r of rows) if (r.final_price != null) byCard.set(r.card_id, [...(byCard.get(r.card_id) ?? []), r.final_price]);
  const now = Date.now();
  for (const id of ids) {
    const list = byCard.get(id) ?? [];
    prices.set(id, {
      median: median(list),
      mean: list.length ? Math.round(list.reduce((a, b) => a + b, 0) / list.length) : null,
      count: list.length,
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

/** Prix affiché : médiane (plus juste que la moyenne, tirée par quelques ventes énormes). */
export function displayPrice(p: CardPrice | undefined): number | null {
  return p?.median ?? null;
}

/** Pour les tests. */
export function resetCatalog(): void {
  cardCache.clear();
  prices.clear();
  inflight.clear();
  loaded = null;
}
