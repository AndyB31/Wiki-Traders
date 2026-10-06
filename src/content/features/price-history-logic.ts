/**
 * Historique des prix d'une carte (page d'une enchère) : logique sans DOM ni réseau.
 * Ventes conclues et invendues de la carte → points datés, moyenne glissante, statistiques.
 */
import { median } from '../../lib/pricing';
import type { Rarity } from '../../lib/types';

export interface SaleRow {
  id: string;
  /** Prix final (ventes conclues) ; null pour une invendue. */
  price: number | null;
  start: number | null;
  rarity: Rarity | null;
  shiny: boolean;
  /** Date de fin (ms). */
  at: number;
  sold: boolean;
  /** Terminée sans acheteur (aucune mise) ou annulée. */
  outcome?: 'sold' | 'unsold' | 'cancelled';
}

/** Enchères à montrer : toutes, vendues, ou sans acheteur (terminées sans mise ou annulées). */
export type OutcomeFilter = 'all' | 'sold' | 'unsold';

export interface HistoryFilter {
  outcome: OutcomeFilter;
  /** Fenêtre en jours (null : tout l'historique). */
  days: number | null;
}

export interface HistoryStats {
  sold: number;
  /** Sans acheteur : terminées sans mise ou annulées. */
  unsold: number;
  /** Dont annulées. */
  cancelled: number;
  /** Ventes conclues / (conclues + invendues), en %. */
  sellRate: number | null;
  mean: number | null;
  median: number | null;
  min: number | null;
  max: number | null;
  last: SaleRow | null;
  /** Moyenne des 30 derniers jours comparée aux 30 jours précédents, en % (null : pas assez de ventes). */
  trend30: number | null;
  /** Gain moyen par rapport à la mise de départ, en %. */
  avgGainPct: number | null;
}

const DAY = 86_400_000;

export function filterSales<T extends SaleRow>(rows: T[], f: HistoryFilter, now = Date.now()): T[] {
  return rows.filter(
    (r) => (f.outcome === 'all' || (f.outcome === 'sold' ? r.sold : !r.sold)) && (f.days == null || now - r.at <= f.days * DAY),
  );
}

const mean = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null);

export function historyStats(rows: SaleRow[], now = Date.now()): HistoryStats {
  const sold = rows.filter((r) => r.sold && r.price != null).sort((a, b) => a.at - b.at);
  const prices = sold.map((r) => r.price!);
  const unsold = rows.length - sold.length;
  const recent = sold.filter((r) => now - r.at <= 30 * DAY).map((r) => r.price!);
  const before = sold.filter((r) => now - r.at > 30 * DAY && now - r.at <= 60 * DAY).map((r) => r.price!);
  const mRecent = mean(recent);
  const mBefore = mean(before);
  const gains = sold.filter((r) => r.start != null && r.start > 0).map((r) => ((r.price! - r.start!) / r.start!) * 100);
  return {
    sold: sold.length,
    unsold,
    cancelled: rows.filter((r) => r.outcome === 'cancelled').length,
    sellRate: rows.length ? Math.round((sold.length / rows.length) * 100) : null,
    mean: mean(prices),
    median: median(prices),
    min: prices.length ? Math.min(...prices) : null,
    max: prices.length ? Math.max(...prices) : null,
    last: sold.at(-1) ?? null,
    trend30: mRecent != null && mBefore != null && mBefore > 0 && recent.length >= 2 && before.length >= 2 ? Math.round(((mRecent - mBefore) / mBefore) * 100) : null,
    avgGainPct: gains.length ? Math.round(gains.reduce((a, b) => a + b, 0) / gains.length) : null,
  };
}

/** Moyenne glissante (sur les `window` dernières ventes conclues), un point par vente. */
export function rollingMean(rows: SaleRow[], window = 5): { at: number; value: number }[] {
  const sold = rows.filter((r) => r.sold && r.price != null).sort((a, b) => a.at - b.at);
  return sold.map((r, i) => {
    const slice = sold.slice(Math.max(0, i - window + 1), i + 1);
    return { at: r.at, value: Math.round(slice.reduce((s, x) => s + x.price!, 0) / slice.length) };
  });
}

/** Graduations « rondes » de 0 au maximum (4 à 5 lignes). */
export function niceTicks(max: number, count = 4): number[] {
  if (!(max > 0)) return [0];
  const raw = max / count;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= raw) ?? raw;
  const ticks: number[] = [];
  for (let v = 0; v <= max + step * 0.001; v += step) ticks.push(Math.round(v * 100) / 100);
  if (ticks[ticks.length - 1] < max) ticks.push(Math.round((ticks[ticks.length - 1] + step) * 100) / 100);
  return ticks;
}
