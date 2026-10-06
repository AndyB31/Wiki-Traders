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

const HOUR = 3_600_000;

/** Ventes conclues, de la plus ancienne à la plus récente. */
function soldSorted(rows: SaleRow[]): SaleRow[] {
  return rows.filter((r) => r.sold && r.price != null).sort((a, b) => a.at - b.at);
}

/**
 * Moyenne glissante sur une durée : à chaque vente, moyenne des ventes des `days` derniers jours (vente comprise).
 * Plus parlante qu'une moyenne sur N ventes quand le rythme des ventes varie.
 */
export function rollingMeanByTime(rows: SaleRow[], days: number): { at: number; value: number }[] {
  const sold = soldSorted(rows);
  const span = days * DAY;
  let start = 0;
  let sum = 0;
  return sold.map((r, i) => {
    sum += r.price!;
    while (sold[start].at <= r.at - span) sum -= sold[start++].price!;
    return { at: r.at, value: Math.round(sum / (i - start + 1)) };
  });
}

export interface Candle {
  /** Début de la période (ms). */
  at: number;
  open: number;
  close: number;
  high: number;
  low: number;
  count: number;
}

/** Bougies : ventes regroupées par période (un jour par défaut) — premier, dernier, plus haut, plus bas. */
export function candles(rows: SaleRow[], bucket = DAY): Candle[] {
  const out: Candle[] = [];
  for (const r of soldSorted(rows)) {
    const at = Math.floor(r.at / bucket) * bucket;
    const last = out[out.length - 1];
    if (last && last.at === at) {
      last.close = r.price!;
      last.high = Math.max(last.high, r.price!);
      last.low = Math.min(last.low, r.price!);
      last.count++;
    } else out.push({ at, open: r.price!, close: r.price!, high: r.price!, low: r.price!, count: 1 });
  }
  return out;
}

/** Ligne des ventes : une vente par point, moyenne des ventes tombées dans la même heure. */
export function saleLine(rows: SaleRow[], bucket = HOUR): { at: number; value: number; count: number }[] {
  const out: { at: number; value: number; count: number; sum: number }[] = [];
  for (const r of soldSorted(rows)) {
    const key = Math.floor(r.at / bucket);
    const last = out[out.length - 1];
    if (last && Math.floor(last.at / bucket) === key) {
      last.sum += r.price!;
      last.count++;
      last.value = Math.round(last.sum / last.count);
    } else out.push({ at: r.at, value: r.price!, count: 1, sum: r.price! });
  }
  return out.map(({ at, value, count }) => ({ at, value, count }));
}
