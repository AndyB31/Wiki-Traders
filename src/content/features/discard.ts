/**
 * Défausse des cartes obtenues dans un paquet (fonctionnalité « Tout défausser après ouverture », risquée, désactivée
 * par défaut). Même requête que le bouton « Défausser » de la fiche d'une carte du site, relevée dans son code :
 *   POST /api/user-cards/<exemplaire possédé>/discard   → retire UN exemplaire de cette ligne de collection.
 * La défausse groupée du site (`POST /api/user-cards/bulk-discard { card_ids }`) n'est pas utilisée : elle porte sur des
 * lignes entières de collection, qui peuvent contenir d'anciens exemplaires en plus de la carte du paquet.
 * Une carte en favori est verrouillée par le site (ni défausse, ni vente, ni échange) : on ne la choisit jamais.
 */
import type { Rarity } from '../../lib/types';
import { discoverConfig, get, inList, readSession } from '../api';
import type { PackCard } from './packs-logic';

export interface CopyRow {
  id: string;
  starred: boolean;
  rarity: Rarity | null;
  shiny: boolean;
  count: number;
}

/** Ligne de collection à défausser pour une carte du paquet : même rareté, jamais un favori, non brillante de préférence. */
export function pickDiscardRow(rows: CopyRow[], rarity: Rarity | null): CopyRow | null {
  const free = rows.filter((r) => !r.starred && r.count > 0);
  const same = rarity ? free.filter((r) => r.rarity === rarity) : free;
  return [...same].sort((a, b) => Number(a.shiny) - Number(b.shiny))[0] ?? null;
}

/** Mes exemplaires de toutes les cartes du paquet, en une requête (clé : identifiant de la carte du catalogue). */
async function copiesOf(siteCardIds: string[]): Promise<Map<string, CopyRow[]>> {
  const cfg = await discoverConfig();
  const session = readSession(cfg);
  const rows = await get<{ id: string; card_id: string; starred: boolean | null; snapshot_rarity: Rarity | null; is_shiny: boolean | null; count: number | null }[]>(
    cfg,
    session,
    `user_cards?select=id,card_id,starred,snapshot_rarity,is_shiny,count&user_id=eq.${session.userId}&card_id=${inList([...new Set(siteCardIds)])}&limit=1000`,
  );
  const out = new Map<string, CopyRow[]>();
  for (const r of rows) {
    const row = { id: r.id, starred: !!r.starred, rarity: r.snapshot_rarity, shiny: !!r.is_shiny, count: Math.max(1, r.count ?? 1) };
    out.set(r.card_id, [...(out.get(r.card_id) ?? []), row]);
  }
  return out;
}

export interface DiscardPlan {
  /** Lignes dont tous les exemplaires partent : une seule défausse groupée. */
  whole: { row: CopyRow; titles: string[] }[];
  /** Lignes dont il reste des exemplaires : défausse à l'unité, autant de fois que de cartes obtenues. */
  partial: { row: CopyRow; titles: string[] }[];
  /** Cartes en favori : ignorées (le site les verrouille). */
  favorites: string[];
  /** Cartes que je ne possède plus (déjà défaussées, vendues…). */
  missing: string[];
}

/**
 * Répartit les cartes obtenues (une par exemplaire à retirer) sur mes lignes de collection. Une ligne entièrement
 * prise passe par la défausse groupée du site (retirer la ligne = retirer exactement ces cartes) ; une ligne qui
 * garde d'anciens exemplaires passe par la défausse à l'unité.
 */
export function planDiscard(cards: PackCard[], copies: Map<string, CopyRow[]>): DiscardPlan {
  const left = new Map<string, CopyRow>();
  const used = new Map<string, { row: CopyRow; titles: string[] }>();
  const missing: string[] = [];
  const favorites: string[] = [];
  for (const card of cards) {
    const rows = (copies.get(card.siteId) ?? []).map((r) => ({ ...r, count: left.get(r.id)?.count ?? r.count }));
    const row = pickDiscardRow(rows, card.rarity);
    if (!row) {
      // Il en reste, mais seulement en favori : ignorée sans erreur.
      (rows.some((r) => r.starred && r.count > 0) ? favorites : missing).push(card.title);
      continue;
    }
    left.set(row.id, { ...row, count: row.count - 1 });
    const original = (copies.get(card.siteId) ?? []).find((r) => r.id === row.id)!;
    const u = used.get(row.id) ?? { row: original, titles: [] };
    u.titles.push(card.title);
    used.set(row.id, u);
  }
  const all = [...used.values()];
  return { whole: all.filter((u) => u.titles.length >= u.row.count), partial: all.filter((u) => u.titles.length < u.row.count), favorites, missing };
}

export interface DiscardResult {
  done: string[];
  /** Cartes en favori, ignorées. */
  skipped: string[];
  failed: { title: string; error: string }[];
}

async function post(url: string, body?: unknown): Promise<unknown> {
  const res = await fetch(url, {
    method: 'POST',
    credentials: 'include',
    headers: { accept: '*/*', ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = (await res.json().catch(() => null)) as { error?: string } | null;
  if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`);
  return json;
}

/**
 * Défausse un exemplaire par carte obtenue : une lecture de mes exemplaires, une défausse groupée pour les lignes
 * entièrement prises, et des défausses à l'unité (en parallèle d'une ligne à l'autre) pour les autres.
 */
export async function discardPackCards(cards: PackCard[], onProgress: (done: number, total: number) => void = () => {}): Promise<DiscardResult> {
  const out: DiscardResult = { done: [], skipped: [], failed: [] };
  let copies: Map<string, CopyRow[]>;
  try {
    copies = await copiesOf(cards.map((c) => c.siteId));
  } catch (e) {
    return { done: [], skipped: [], failed: cards.map((c) => ({ title: c.title, error: (e as Error).message })) };
  }
  const plan = planDiscard(cards, copies);
  out.skipped.push(...plan.favorites);
  for (const title of plan.missing) out.failed.push({ title, error: 'plus dans ta collection (déjà défaussée ?)' });
  const total = cards.length;
  const progress = () => onProgress(out.done.length + out.skipped.length + out.failed.length, total);
  progress();

  const one = async (u: { row: CopyRow; titles: string[] }) => {
    // Plusieurs exemplaires de la même ligne : l'un après l'autre.
    for (const title of u.titles) {
      try {
        await post(`/api/user-cards/${encodeURIComponent(u.row.id)}/discard`);
        out.done.push(title);
      } catch (e) {
        out.failed.push({ title, error: (e as Error).message });
      }
      progress();
    }
  };
  const bulk = async () => {
    if (!plan.whole.length) return;
    try {
      const res = (await post('/api/user-cards/bulk-discard', { card_ids: plan.whole.map((u) => u.row.id) })) as { failed?: unknown[] } | null;
      // Lignes refusées par le site (identifiant seul, ou objet avec l'identifiant et la raison).
      const refused = new Map<string, string>();
      for (const f of res?.failed ?? []) {
        const o = f as { id?: string; card_id?: string; error?: string; reason?: string } | string;
        const id = typeof o === 'string' ? o : o?.card_id ?? o?.id;
        if (id) refused.set(id, typeof o === 'string' ? 'refusée par le site' : o.error ?? o.reason ?? 'refusée par le site');
      }
      for (const u of plan.whole) {
        for (const title of u.titles) (refused.has(u.row.id) ? out.failed.push({ title, error: refused.get(u.row.id)! }) : out.done.push(title));
      }
      progress();
    } catch {
      // Défausse groupée refusée : repli sur la défausse à l'unité.
      await Promise.all(plan.whole.map(one));
    }
  };
  await Promise.all([bulk(), ...plan.partial.map(one)]);
  return out;
}
