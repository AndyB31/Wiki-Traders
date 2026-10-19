/**
 * Défausse des cartes obtenues dans un paquet (fonctionnalité « Tout défausser après ouverture », risquée, désactivée
 * par défaut). Même requête que le bouton « Défausser » de la fiche d'une carte du site, relevée dans son code :
 *   POST /api/user-cards/<exemplaire possédé>/discard   → retire UN exemplaire de cette ligne de collection.
 * La défausse groupée du site (`POST /api/user-cards/bulk-discard { card_ids }`) n'est pas utilisée : elle porte sur des
 * lignes entières de collection, qui peuvent contenir d'anciens exemplaires en plus de la carte du paquet.
 * Une carte en favori est verrouillée par le site (ni défausse, ni vente, ni échange) : on ne la choisit jamais.
 */
import type { Rarity } from '../../lib/types';
import { discoverConfig, get, readSession } from '../api';
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

async function copiesOf(siteCardId: string): Promise<CopyRow[]> {
  const cfg = await discoverConfig();
  const session = readSession(cfg);
  const rows = await get<{ id: string; starred: boolean | null; snapshot_rarity: Rarity | null; is_shiny: boolean | null; count: number | null }[]>(
    cfg,
    session,
    `user_cards?select=id,starred,snapshot_rarity,is_shiny,count&user_id=eq.${session.userId}&card_id=eq.${encodeURIComponent(siteCardId)}&limit=200`,
  );
  return rows.map((r) => ({ id: r.id, starred: !!r.starred, rarity: r.snapshot_rarity, shiny: !!r.is_shiny, count: Math.max(1, r.count ?? 1) }));
}

export interface DiscardResult {
  done: string[];
  failed: { title: string; error: string }[];
}

/** Défausse un exemplaire par carte obtenue (une carte en double dans le paquet est défaussée deux fois). */
export async function discardPackCards(cards: PackCard[], onProgress: (done: number, total: number) => void = () => {}): Promise<DiscardResult> {
  const out: DiscardResult = { done: [], failed: [] };
  for (const [i, card] of cards.entries()) {
    try {
      // Relu à chaque fois : une ligne peut disparaître quand son dernier exemplaire est défaussé.
      const row = pickDiscardRow(await copiesOf(card.siteId), card.rarity);
      if (!row) throw new Error('plus d\'exemplaire défaussable (favori, ou déjà défaussée)');
      const res = await fetch(`/api/user-cards/${encodeURIComponent(row.id)}/discard`, { method: 'POST', credentials: 'include', headers: { accept: '*/*' } });
      const json = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`);
      out.done.push(card.title);
    } catch (e) {
      out.failed.push({ title: card.title, error: (e as Error).message });
    }
    onProgress(i + 1, cards.length);
  }
  return out;
}
