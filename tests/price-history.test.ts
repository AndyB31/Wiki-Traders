// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { filterSales, historyStats, niceTicks, rollingMean, type SaleRow } from '../src/content/features/price-history-logic';

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 9, 6);
const sale = (daysAgo: number, price: number | null, over: Partial<SaleRow> = {}): SaleRow => ({
  id: `s${daysAgo}-${price}`, price, start: 10, rarity: 'R', shiny: false, at: NOW - daysAgo * DAY, sold: price != null, ...over,
});

describe('historique des prix : calculs', () => {
  const rows = [sale(50, 20), sale(40, 30), sale(20, 40), sale(10, 60), sale(5, null), sale(3, 500, { rarity: 'SR' })];

  it('statistiques : ventes, invendues, taux de vente, moyenne, médiane, extrêmes, dernière vente, gain', () => {
    const s = historyStats(filterSales(rows, { rarity: 'R', days: null }, NOW), NOW);
    expect(s).toMatchObject({ sold: 4, unsold: 1, sellRate: 80, mean: 38, median: 35, min: 20, max: 60 });
    expect(s.last!.price).toBe(60);
    expect(s.avgGainPct).toBe(275);
    // Tendance : 30 derniers jours (40, 60 → 50) contre 30 jours précédents (20, 30 → 25) = +100 %.
    expect(s.trend30).toBe(100);
  });

  it('filtres de rareté et de période', () => {
    expect(filterSales(rows, { rarity: 'SR', days: null }, NOW)).toHaveLength(1);
    expect(filterSales(rows, { rarity: null, days: 30 }, NOW).map((r) => r.price)).toEqual([40, 60, null, 500]);
  });

  it('moyenne glissante sur les dernières ventes, graduations rondes', () => {
    expect(rollingMean(rows.filter((r) => r.rarity === 'R'), 2).map((p) => p.value)).toEqual([20, 25, 35, 50]);
    expect(niceTicks(540)).toEqual([0, 200, 400, 600]);
    expect(niceTicks(0)).toEqual([0]);
  });
});

vi.hoisted(() => {
  (globalThis as unknown as { chrome: unknown }).chrome = { runtime: { getURL: (p: string) => p } };
});
const ID = '09ee8b59-edef-40e4-bdb4-14fe11ff82df';
vi.mock('../src/content/catalog', () => ({
  auctionInfo: vi.fn(async () => ({ cardId: 'card-1', rarity: 'R', shiny: false, current: 45, start: 20, hasBid: true })),
  cardSalesHistory: vi.fn(async () => [sale(30, 20), sale(20, 40), sale(10, 60), sale(5, null)]),
}));

describe('page d\'une enchère : section « Historique des prix »', () => {
  it('sous l\'historique des mises, dépliable, avec chiffres clés, graphique (un point par vente) et légende', async () => {
    const { makeContext, runFeatures } = await import('../src/content/features/runtime');
    await import('../src/content/features/price-history');
    const { DEFAULT_SETTINGS } = await import('../src/lib/defaults');
    document.body.innerHTML = `<main><div class="flex-1"><h1>Enchère</h1>
      <div class="card-frame" id="bids"><h3>Historique des mises</h3><ul><li>30 W</li></ul></div><div id="after"></div></div></main>`;
    history.replaceState(null, '', `/marketplace/${ID}`);
    runFeatures(makeContext({ ...DEFAULT_SETTINGS, apiRead: true }, {}, []));
    await vi.waitFor(() => expect(document.querySelectorAll('[data-wiky="price-history"] circle.dot')).toHaveLength(3));
    const box = document.querySelector<HTMLDetailsElement>('[data-wiky="price-history"]')!;
    expect(box.previousElementSibling!.id).toBe('bids');
    expect(box.tagName).toBe('DETAILS');
    const text = box.textContent!.replace(/\s+/g, ' ');
    expect(text).toContain('3 ventes en R');
    expect(text).toContain('Taux de vente');
    expect(text).toContain('75 %');
    expect(box.querySelector('.cur')).not.toBeNull();
    expect(box.querySelector('table')!.querySelectorAll('tbody tr')).toHaveLength(4);
    // Replier : mémorisé.
    box.open = false;
    box.dispatchEvent(new Event('toggle'));
    expect(localStorage.getItem('wiky-price-history-open')).toBe('0');
  });
});
