import type { JournalEntry, MyAuction } from './types';

export interface ReconcileResult {
  auctions: MyAuction[];
  created: MyAuction[];
  finished: MyAuction[];
}

/**
 * Compare la liste complète de mes enchères relevée sur la page avec celle en mémoire.
 * Une enchère absente de la nouvelle liste est considérée terminée.
 */
export function reconcileAuctions(prev: MyAuction[], next: MyAuction[], now: number): ReconcileResult {
  const prevById = new Map(prev.map((a) => [a.id, a]));
  const nextIds = new Set(next.map((a) => a.id));
  const created: MyAuction[] = [];
  const auctions: MyAuction[] = [];

  for (const a of next) {
    const old = prevById.get(a.id);
    if (!old) created.push(a);
    auctions.push({
      ...a,
      // Le prix de départ est celui vu la première fois.
      startPrice: old?.startPrice ?? a.startPrice ?? a.currentPrice,
      endsAt: a.endsAt ?? old?.endsAt ?? null,
      tag: a.tag ?? old?.tag ?? null,
      seenAt: now,
    });
  }
  const finished = prev.filter((a) => !nextIds.has(a.id));
  return { auctions, created, finished };
}

/** Sépare les enchères terminées (heure de fin dépassée) des actives, sans relevé de page. */
export function expireAuctions(list: MyAuction[], now: number): { kept: MyAuction[]; expired: MyAuction[] } {
  const kept: MyAuction[] = [];
  const expired: MyAuction[] = [];
  for (const a of list) (a.endsAt != null && a.endsAt <= now ? expired : kept).push(a);
  return { kept, expired };
}

export function journalEntry(
  type: JournalEntry['type'],
  data: Omit<JournalEntry, 'id' | 'type' | 'at'> & { at?: number },
): JournalEntry {
  const at = data.at ?? Date.now();
  return { ...data, type, at, id: `${type}:${data.auctionId ?? data.cardId}:${at}` };
}

export interface TagStats {
  tag: string;
  finished: number;
  /** Ratio moyen prix final / prix moyen. */
  avgFinalRatio: number | null;
  /** Part des ventes terminées au prix de départ. */
  atStartShare: number | null;
  /** Hausse moyenne entre prix de départ et prix final. */
  avgUplift: number | null;
  hint: string;
}

/** F6 – statistiques par étiquette pour ajuster les %. */
export function tagStats(journal: JournalEntry[]): TagStats[] {
  const byTag = new Map<string, JournalEntry[]>();
  for (const e of journal) {
    if (e.type !== 'finished') continue;
    const tag = e.tag ?? 'hors répartition';
    byTag.set(tag, [...(byTag.get(tag) ?? []), e]);
  }
  return [...byTag.entries()].map(([tag, list]) => {
    const ratios = list.filter((e) => e.finalPrice != null && e.avgPrice).map((e) => e.finalPrice! / e.avgPrice!);
    const withStart = list.filter((e) => e.finalPrice != null && e.startPrice != null);
    const atStart = withStart.filter((e) => e.finalPrice! <= e.startPrice!).length;
    const uplifts = withStart.filter((e) => e.startPrice! > 0).map((e) => e.finalPrice! / e.startPrice! - 1);
    const avgFinalRatio = ratios.length ? ratios.reduce((a, b) => a + b, 0) / ratios.length : null;
    const atStartShare = withStart.length ? atStart / withStart.length : null;
    const avgUplift = uplifts.length ? uplifts.reduce((a, b) => a + b, 0) / uplifts.length : null;
    let hint = 'Pas encore assez de ventes pour conclure.';
    if (withStart.length >= 3 && atStartShare != null) {
      if (atStartShare >= 0.8) hint = 'Presque tout part au prix de départ : ton % est sans doute trop bas.';
      else if (avgUplift != null && avgUplift > 0.3) hint = 'Les enchères montent beaucoup : tu peux sans doute monter ton %.';
      else hint = 'Répartition équilibrée.';
    }
    return { tag, finished: list.length, avgFinalRatio, atStartShare, avgUplift, hint };
  });
}
