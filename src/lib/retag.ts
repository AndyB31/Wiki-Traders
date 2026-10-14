/**
 * Étiquettes des invendues : le site retire les étiquettes d'une carte mise en vente ; quand l'enchère se termine
 * sans acheteur, la carte revient en collection sans elles. On les note à la mise en vente, puis on les remet.
 */
import { sameTag } from './text';
import type { JournalEntry, MyAuction, PendingRetag } from './types';

/** Au-delà, une invendue non traitée (aucun onglet du site ouvert, carte jamais revenue) est abandonnée. */
export const RETAG_MAX_AGE_MS = 24 * 3600_000;

/** Étiquettes à remettre : celles notées à la mise en vente, sinon l'étiquette de l'enchère, sinon celle du slot proposé. */
export function tagsToRestore(a: MyAuction, journal: JournalEntry[], ruleTag: string | null): string[] {
  if (a.cardTags?.length) return a.cardTags;
  const proposed = [...journal].reverse().find((e) => e.type === 'proposed' && e.cardId === a.cardId && e.tag);
  const tag = a.tag ?? ruleTag ?? proposed?.tag ?? null;
  return tag ? [tag] : [];
}

/** Ajoute à la file les enchères terminées sans mise connue (le statut réel est vérifié avant d'écrire). */
export function queueRetags(
  pending: PendingRetag[],
  finished: MyAuction[],
  tagsOf: (a: MyAuction) => string[],
  now: number,
): PendingRetag[] {
  const out = pending.filter((p) => now - p.at < RETAG_MAX_AGE_MS);
  for (const a of finished) {
    // Une mise reçue : l'enchère est conclue, la carte ne revient pas.
    if (a.hasBid ?? (a.currentPrice != null && a.startPrice != null && a.currentPrice > a.startPrice)) continue;
    if (out.some((p) => p.auctionId === a.id)) continue;
    const tags = tagsOf(a).filter((t, i, all) => all.findIndex((x) => sameTag(x, t)) === i);
    if (tags.length) out.push({ auctionId: a.id, cardId: a.cardId, cardName: a.cardName, tags, at: now });
  }
  return out;
}

export interface RetagSplit {
  /** Terminées sans acheteur : étiquettes à remettre. */
  apply: PendingRetag[];
  /** À retirer de la file : vendues, ou trop anciennes. */
  drop: PendingRetag[];
}

/**
 * Tri selon le statut lu sur le site : `settled_unsold` ou `cancelled` → à remettre ; `settled_sold` → abandon ;
 * `active` ou inconnu (pas encore réglée par le site) → on réessaie plus tard, jusqu'à RETAG_MAX_AGE_MS.
 */
export function splitRetags(pending: PendingRetag[], status: Map<string, string>, now: number): RetagSplit {
  const apply: PendingRetag[] = [];
  const drop: PendingRetag[] = [];
  for (const p of pending) {
    const s = status.get(p.auctionId);
    if (s === 'settled_unsold' || s === 'cancelled') apply.push(p);
    else if (s === 'settled_sold' || now - p.at >= RETAG_MAX_AGE_MS) drop.push(p);
  }
  return { apply, drop };
}
