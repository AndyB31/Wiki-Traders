/**
 * Lecture des données du jeu via l'API Supabase de WikiMasters, avec la session de l'utilisateur.
 *
 * ⚠️ Option désactivée par défaut : les appels directs aux API internes sortent du cadre « copilote »
 * de la spec. Ce module ne fait QUE des lectures (GET) ; aucune écriture n'est possible ici.
 *
 * L'adresse et la clé publique (anon) sont retrouvées dans les scripts du site ; la session est lue
 * dans le cookie `sb-<ref>-auth-token` posé par le site (format @supabase/ssr, éventuellement découpé
 * en `.0`, `.1`… et préfixé `base64-`).
 */
import type { BidStatus, CardAuctionsResult, MyAuction, MyBid, MyBidsResult, MySalesResult, PriceObs, Rarity, SoldItem } from '../lib/types';
import { median } from '../lib/pricing';
import { slugify } from '../lib/text';
import type { ScannedCard } from '../lib/messages';

export class ApiError extends Error {}

export interface ApiConfig {
  url: string;
  anonKey: string;
}

export interface Session {
  accessToken: string;
  userId: string;
  expiresAt: number;
}

let configCache: ApiConfig | null = null;

function b64urlDecode(s: string): string {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '=');
  const bin = atob(b64);
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

export function jwtPayload(token: string): Record<string, unknown> | null {
  try {
    return JSON.parse(b64urlDecode(token.split('.')[1]));
  } catch {
    return null;
  }
}

/** Adresse Supabase et clé anon trouvées dans un texte de script. */
export function findApiConfig(text: string): ApiConfig | null {
  const url = text.match(/https:\/\/([a-z0-9]{10,})\.supabase\.co/)?.[0];
  if (!url) return null;
  const ref = url.slice(8).split('.')[0];
  for (const m of text.matchAll(/eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g)) {
    const p = jwtPayload(m[0]);
    if (p?.role === 'anon' && (!p.ref || p.ref === ref)) return { url, anonKey: m[0] };
  }
  return null;
}

/** Cherche la configuration dans les scripts Next.js chargés par la page (mis en cache). */
export async function discoverConfig(): Promise<ApiConfig> {
  if (configCache) return configCache;
  const srcs = [...document.scripts].map((s) => s.src).filter((s) => s.includes('/_next/static/'));
  for (const src of srcs) {
    try {
      const found = findApiConfig(await (await fetch(src)).text());
      if (found) return (configCache = found);
    } catch {
      /* script suivant */
    }
  }
  throw new ApiError('configuration Supabase introuvable dans les scripts du site');
}

/** Valeur d'un cookie de session Supabase (recolle les morceaux `.0`, `.1`…). */
export function sessionCookie(cookieString: string, ref: string): string | null {
  const jar = new Map<string, string>();
  for (const part of cookieString.split(/;\s*/)) {
    const i = part.indexOf('=');
    if (i > 0) jar.set(part.slice(0, i), decodeURIComponent(part.slice(i + 1)));
  }
  const name = `sb-${ref}-auth-token`;
  if (jar.has(name)) return jar.get(name)!;
  const chunks: string[] = [];
  for (let i = 0; jar.has(`${name}.${i}`); i++) chunks.push(jar.get(`${name}.${i}`)!);
  return chunks.length ? chunks.join('') : null;
}

export function parseSession(raw: string): Session | null {
  try {
    const json = raw.startsWith('base64-') ? b64urlDecode(raw.slice(7)) : raw;
    const data = JSON.parse(json);
    const token: string | undefined = data.access_token ?? data.currentSession?.access_token ?? (Array.isArray(data) ? data[0] : undefined);
    if (!token) return null;
    const p = jwtPayload(token);
    if (!p || typeof p.sub !== 'string') return null;
    return { accessToken: token, userId: p.sub, expiresAt: Number(p.exp ?? 0) * 1000 };
  } catch {
    return null;
  }
}

export function readSession(cfg: ApiConfig): Session {
  const ref = cfg.url.slice(8).split('.')[0];
  const raw = sessionCookie(document.cookie, ref) ?? localStorage.getItem(`sb-${ref}-auth-token`);
  const session = raw ? parseSession(raw) : null;
  if (!session) throw new ApiError('session introuvable : connecte-toi sur WikiMasters');
  if (session.expiresAt && session.expiresAt < Date.now()) throw new ApiError('session expirée : recharge la page pour la renouveler');
  return session;
}

/** Requête en lecture seule (GET) sur l'API REST. */
export async function get<T>(cfg: ApiConfig, session: Session, path: string): Promise<T> {
  const res = await fetch(`${cfg.url}/rest/v1/${path}`, {
    method: 'GET',
    headers: { apikey: cfg.anonKey, Authorization: `Bearer ${session.accessToken}`, Accept: 'application/json' },
  });
  if (!res.ok) throw new ApiError(`API ${res.status} sur ${path.split('?')[0]}`);
  return res.json() as Promise<T>;
}

/** Taille de page demandée ; le serveur peut plafonner plus bas (Supabase : 1 000 lignes par défaut). */
export const PAGE_SIZE = 1000;

/**
 * Lecture complète d'une requête, page par page. L'API (PostgREST de Supabase) plafonne chaque réponse
 * (1 000 lignes par défaut), même si l'on demande plus : sans pagination, les ventes d'un lot de cartes ou une
 * grosse collection sont tronquées. Le total est demandé à la première page (`Prefer: count=exact`), puis les pages
 * suivantes sont lues jusqu'à l'avoir atteint. Un ordre stable est imposé (`order=id` par défaut).
 */
export async function getAll<T>(cfg: ApiConfig, session: Session, path: string, max = 100_000): Promise<T[]> {
  const sep = path.includes('?') ? '&' : '?';
  const ordered = /[?&]order=/.test(path) ? path : `${path}${sep}order=id`;
  const out: T[] = [];
  let total: number | null = null;
  while (out.length < max) {
    const res = await fetch(`${cfg.url}/rest/v1/${ordered}&limit=${PAGE_SIZE}&offset=${out.length}`, {
      method: 'GET',
      headers: {
        apikey: cfg.anonKey,
        Authorization: `Bearer ${session.accessToken}`,
        Accept: 'application/json',
        ...(total == null ? { Prefer: 'count=exact' } : {}),
      },
    });
    if (!res.ok) throw new ApiError(`API ${res.status} sur ${path.split('?')[0]}`);
    if (total == null) {
      const m = /\/(\d+)\s*$/.exec(res.headers.get('content-range') ?? '');
      total = m ? Number(m[1]) : null;
    }
    const rows = (await res.json()) as T[];
    out.push(...rows);
    // Fin : plus rien, total atteint, ou (sans total connu) une page incomplète par rapport à la taille demandée.
    if (!rows.length || (total != null ? out.length >= total : rows.length < PAGE_SIZE)) break;
  }
  return out;
}

export const inList = (ids: string[]) => `in.(${ids.map((i) => `"${i}"`).join(',')})`;

interface BidRow {
  auction_id: string;
  amount: number;
  placed_at: string;
}
interface AuctionRow {
  id: string;
  card_id: string;
  seller_id?: string;
  base_amount: number | null;
  current_bid: number | null;
  current_bidder_id: string | null;
  final_price: number | null;
  status: string;
  end_at: string;
  winner_id: string | null;
  snapshot_rarity: Rarity | null;
  is_shiny: boolean | null;
}
interface CardRow {
  id: string;
  wikipedia_title: string;
  rarity: Rarity | null;
}

function bidStatus(a: AuctionRow, me: string, now: number): BidStatus {
  if (a.status === 'cancelled') return 'cancelled';
  const settled = a.status.startsWith('settled') || Date.parse(a.end_at) <= now;
  if (settled) return a.winner_id === me ? 'won' : 'lost';
  return a.current_bidder_id === me ? 'leading' : 'outbid';
}

/**
 * Mise à jour légère de mes mises en cours (une requête, quelques champs) : prix actuel, qui est en tête, fin.
 * Sert au suivi « en direct » toutes les 2 secondes ; le relevé complet (`fetchMyBids`) garde son rythme.
 */
export async function refreshBidStates(bids: MyBid[]): Promise<MyBid[] | null> {
  if (!bids.length) return null;
  const cfg = await discoverConfig();
  const session = readSession(cfg);
  const now = Date.now();
  const rows = await get<AuctionRow[]>(
    cfg,
    session,
    `auctions?select=id,card_id,base_amount,current_bid,current_bidder_id,final_price,status,end_at,winner_id,snapshot_rarity,is_shiny&id=${inList(bids.map((b) => b.auctionId))}`,
  );
  const byId = new Map(rows.map((r) => [r.id, r]));
  let changed = false;
  const next = bids.map((b) => {
    const a = byId.get(b.auctionId);
    if (!a) return b;
    const upd: MyBid = { ...b, current: a.final_price ?? a.current_bid ?? a.base_amount, status: bidStatus(a, session.userId, now), endsAt: Date.parse(a.end_at) || b.endsAt };
    if (upd.current !== b.current || upd.status !== b.status || upd.endsAt !== b.endsAt) changed = true;
    return upd;
  });
  return changed ? next : null;
}

/** Enchères des autres joueurs sur lesquelles j'ai misé, avec l'historique de prix de chaque carte. */
export async function fetchMyBids(limit = 200): Promise<MyBidsResult> {
  const cfg = await discoverConfig();
  const session = readSession(cfg);
  const now = Date.now();
  const bids = await get<BidRow[]>(cfg, session, `auction_bids?select=auction_id,amount,placed_at&bidder_id=eq.${session.userId}&order=placed_at.desc&limit=${limit}`);
  const ids = [...new Set(bids.map((b) => b.auction_id))].slice(0, 100);
  if (!ids.length) return { at: now, bids: [] };

  const auctions = await get<AuctionRow[]>(
    cfg,
    session,
    `auctions?select=id,card_id,base_amount,current_bid,current_bidder_id,final_price,status,end_at,winner_id,snapshot_rarity,is_shiny&id=${inList(ids)}`,
  );
  const cardIds = [...new Set(auctions.map((a) => a.card_id))];
  const [cards, sales] = await Promise.all([
    get<CardRow[]>(cfg, session, `cards?select=id,wikipedia_title,rarity&id=${inList(cardIds)}`),
    getAll<{ card_id: string; final_price: number | null }>(cfg, session, `auctions?select=card_id,final_price&status=eq.settled_sold&card_id=${inList(cardIds)}`).catch(
      () => [] as { card_id: string; final_price: number | null }[],
    ),
  ]);
  const cardById = new Map(cards.map((c) => [c.id, c]));
  const salesByCard = new Map<string, number[]>();
  for (const s of sales) if (s.final_price != null) salesByCard.set(s.card_id, [...(salesByCard.get(s.card_id) ?? []), s.final_price]);
  const auctionById = new Map(auctions.map((a) => [a.id, a]));

  const out: MyBid[] = [];
  for (const id of ids) {
    const a = auctionById.get(id);
    if (!a) continue;
    const mine = bids.filter((b) => b.auction_id === id);
    const card = cardById.get(a.card_id);
    const prices = salesByCard.get(a.card_id) ?? [];
    out.push({
      auctionId: id,
      cardId: card ? slugify(card.wikipedia_title) : a.card_id,
      cardName: card?.wikipedia_title ?? '(carte inconnue)',
      rarity: a.snapshot_rarity ?? card?.rarity ?? null,
      shiny: !!a.is_shiny,
      myMax: Math.max(...mine.map((b) => b.amount)),
      myBids: mine.length,
      lastBidAt: Math.max(...mine.map((b) => Date.parse(b.placed_at))),
      current: a.final_price ?? a.current_bid ?? a.base_amount,
      status: bidStatus(a, session.userId, now),
      endsAt: Date.parse(a.end_at) || null,
      cardSales: prices.length,
      cardMedian: median(prices),
    });
  }
  return { at: now, bids: out };
}

/**
 * Mes enchères en cours, celles de l'onglet « Mes ventes » du marché, lues sans passer par la page.
 * Liste complète : une enchère absente est considérée comme terminée (même règle que le relevé de la page).
 */
export async function fetchMyAuctions(limit = 100): Promise<MyAuction[]> {
  const cfg = await discoverConfig();
  const session = readSession(cfg);
  const now = Date.now();
  const rows = await get<AuctionRow[]>(
    cfg,
    session,
    `auctions?select=id,card_id,base_amount,current_bid,end_at,status&seller_id=eq.${session.userId}&status=eq.active&order=end_at.asc&limit=${limit}`,
  );
  // Terminée mais pas encore réglée par le site : déjà comptée comme finie par l'extension (heure de fin dépassée).
  const live = rows.filter((r) => !r.end_at || Date.parse(r.end_at) > now);
  const cardIds = [...new Set(live.map((r) => r.card_id))];
  const cards = cardIds.length ? await get<CardRow[]>(cfg, session, `cards?select=id,wikipedia_title,rarity&id=${inList(cardIds)}`) : [];
  const cardById = new Map(cards.map((c) => [c.id, c]));
  return live.map((r) => {
    const card = cardById.get(r.card_id);
    return {
      id: r.id,
      cardId: card ? slugify(card.wikipedia_title) : r.card_id,
      cardName: card?.wikipedia_title ?? '(carte inconnue)',
      tag: null,
      startPrice: r.base_amount,
      currentPrice: r.current_bid ?? r.base_amount,
      endsAt: Date.parse(r.end_at) || null,
      seenAt: now,
    };
  });
}

/** Ventes conclues récentes du marché (toutes cartes), pour les prix de référence par rareté. */
export async function fetchMarketSales(days = 7, limit = 1000): Promise<PriceObs[]> {
  const cfg = await discoverConfig();
  const session = readSession(cfg);
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const query = (select: string) =>
    get<(AuctionRow & { card?: { wikipedia_title?: string } | null })[]>(
      cfg,
      session,
      `auctions?select=${select}&status=eq.settled_sold&end_at=gte.${since}&order=end_at.desc&limit=${limit}`,
    );
  const base = 'id,card_id,final_price,snapshot_rarity,is_shiny,end_at,status';
  // Avec le titre de la carte (jointure), les ventes comptent aussi dans l'historique de CETTE carte ;
  // si la jointure est refusée, on garde au moins la rareté.
  const rows = await query(`${base},card:cards(wikipedia_title)`).catch(() => query(base));
  return rows
    .filter((r) => r.final_price != null)
    .map((r) => ({
      cardId: r.card?.wikipedia_title ? slugify(r.card.wikipedia_title) : `site:${r.card_id}`,
      price: r.final_price!,
      type: 'sold' as const,
      at: Date.parse(r.end_at),
      auctionId: r.id,
      rarity: r.snapshot_rarity,
      shiny: !!r.is_shiny,
    }));
}

/** Enchères en cours pour une carte (identifiant du site), de la moins chère à la plus chère. */
export async function fetchCardAuctions(siteCardId: string): Promise<CardAuctionsResult> {
  const cfg = await discoverConfig();
  const session = readSession(cfg);
  const id = encodeURIComponent(siteCardId);
  const [active, sales] = await Promise.all([
    get<AuctionRow[]>(cfg, session, `auctions?select=id,seller_id,base_amount,current_bid,end_at,is_shiny,status&card_id=eq.${id}&status=eq.active&limit=200`),
    getAll<{ final_price: number | null }>(cfg, session, `auctions?select=final_price&card_id=eq.${id}&status=eq.settled_sold`).catch(() => []),
  ]);
  const now = Date.now();
  const auctions = active
    .filter((a) => !a.end_at || Date.parse(a.end_at) > now)
    .map((a) => ({
      id: a.id,
      price: a.current_bid ?? a.base_amount ?? 0,
      hasBid: a.current_bid != null && a.current_bid > (a.base_amount ?? 0),
      endsAt: Date.parse(a.end_at) || null,
      shiny: !!a.is_shiny,
      mine: a.seller_id === session.userId,
    }))
    .sort((a, b) => a.price - b.price || (a.endsAt ?? 0) - (b.endsAt ?? 0));
  const prices = sales.map((s) => s.final_price).filter((p): p is number => p != null);
  return { auctions, sales: prices.length, median: median(prices) };
}

interface UserCardRow {
  id: string;
  card_id: string;
  count: number | null;
  starred: boolean | null;
  snapshot_title: string | null;
  snapshot_rarity: Rarity | null;
  snapshot_category: string | null;
  is_shiny: boolean | null;
}

/** Ma collection complète (exemplaires, favoris, étiquettes), qui remplace le relevé de la page. */
export async function fetchMyCollection(): Promise<ScannedCard[]> {
  const cfg = await discoverConfig();
  const session = readSession(cfg);
  const [rows, tags] = await Promise.all([
    getAll<UserCardRow>(
      cfg,
      session,
      `user_cards?select=id,card_id,count,starred,snapshot_title,snapshot_rarity,snapshot_category,is_shiny&user_id=eq.${session.userId}`,
    ),
    get<{ id: string; name: string }[]>(cfg, session, `tags?select=id,name&user_id=eq.${session.userId}`),
  ]);
  const tagName = new Map(tags.map((t) => [t.id, t.name]));
  const links: { user_card_id: string; tag_id: string }[] = [];
  const ids = rows.map((r) => r.id);
  for (let i = 0; i < ids.length; i += 150) {
    links.push(...(await get<typeof links>(cfg, session, `user_card_tags?select=user_card_id,tag_id&user_card_id=${inList(ids.slice(i, i + 150))}`)));
  }
  const tagsOf = new Map<string, string[]>();
  for (const l of links) {
    const name = tagName.get(l.tag_id);
    if (name) tagsOf.set(l.user_card_id, [...(tagsOf.get(l.user_card_id) ?? []), name]);
  }
  // Une même carte peut apparaître sur plusieurs lignes (exemplaires, version brillante) : on les regroupe.
  const byId = new Map<string, ScannedCard>();
  for (const r of rows) {
    const name = r.snapshot_title?.trim();
    if (!name) continue;
    const id = slugify(name);
    const prev = byId.get(id);
    const tagsHere = tagsOf.get(r.id) ?? [];
    byId.set(id, {
      id,
      siteId: r.card_id,
      name,
      rarity: r.snapshot_rarity,
      shiny: (prev?.shiny ?? false) || !!r.is_shiny,
      category: r.snapshot_category ?? undefined,
      quantity: (prev?.quantity ?? 0) + Math.max(1, r.count ?? 1),
      favorite: (prev?.favorite ?? false) || !!r.starred,
      tags: [...new Set([...(prev?.tags ?? []), ...tagsHere])],
      tagsExact: true,
      updatedAt: Date.now(),
    });
  }
  return [...byId.values()];
}

/** Mes ventes terminées (vendues et invendues), avec la médiane des autres ventes de chaque carte. */
export async function fetchMySales(limit = 200): Promise<MySalesResult> {
  const cfg = await discoverConfig();
  const session = readSession(cfg);
  const rows = await get<(AuctionRow & { settled_at: string | null })[]>(
    cfg,
    session,
    `auctions?select=id,card_id,base_amount,final_price,status,end_at,settled_at,snapshot_rarity,is_shiny&seller_id=eq.${session.userId}&status=in.(settled_sold,settled_unsold)&order=end_at.desc&limit=${limit}`,
  );
  const cardIds = [...new Set(rows.map((r) => r.card_id))];
  if (!cardIds.length) return { at: Date.now(), items: [] };
  const [cards, sales] = await Promise.all([
    get<CardRow[]>(cfg, session, `cards?select=id,wikipedia_title,rarity&id=${inList(cardIds)}`),
    getAll<{ id: string; card_id: string; final_price: number | null }>(
      cfg,
      session,
      `auctions?select=id,card_id,final_price&status=eq.settled_sold&card_id=${inList(cardIds)}`,
    ).catch(() => [] as { id: string; card_id: string; final_price: number | null }[]),
  ]);
  const cardById = new Map(cards.map((c) => [c.id, c]));
  const items: SoldItem[] = rows.map((r) => {
    const card = cardById.get(r.card_id);
    const others = sales.filter((x) => x.card_id === r.card_id && x.id !== r.id && x.final_price != null).map((x) => x.final_price!);
    return {
      auctionId: r.id,
      cardId: card ? slugify(card.wikipedia_title) : r.card_id,
      cardName: card?.wikipedia_title ?? '(carte inconnue)',
      rarity: r.snapshot_rarity ?? card?.rarity ?? null,
      shiny: !!r.is_shiny,
      sold: r.status === 'settled_sold',
      start: r.base_amount,
      final: r.final_price,
      endedAt: Date.parse(r.settled_at ?? r.end_at) || null,
      cardMedian: median(others),
      cardSales: others.length,
    };
  });
  return { at: Date.now(), items };
}

export interface OfferStats {
  count: number;
  min: number | null;
  median: number | null;
  max: number | null;
}

export function offerStats(prices: number[]): OfferStats {
  if (!prices.length) return { count: 0, min: null, median: null, max: null };
  return { count: prices.length, min: Math.min(...prices), median: median(prices), max: Math.max(...prices) };
}

/** Identifiant d'une carte du site à partir de son titre Wikipédia. */
export async function fetchCardIdByTitle(title: string): Promise<string | null> {
  const cfg = await discoverConfig();
  const session = readSession(cfg);
  const rows = await get<{ id: string }[]>(cfg, session, `cards?select=id&wikipedia_title=eq.${encodeURIComponent(title)}&limit=1`);
  return rows[0]?.id ?? null;
}
