// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  (globalThis as unknown as { chrome: unknown }).chrome = { runtime: { getURL: (p: string) => p } };
});
const A1 = '09ee8b59-edef-40e4-bdb4-14fe11ff82df';
const A2 = '3b72bb92-6fc2-4c88-aa1b-8a14b92e0126';
const A3 = '11111111-2222-4333-8444-555555555555';
const known = new Map<string, { cardId: string; rarity: 'SR' | 'UR'; shiny: boolean } | null>();
const prices = new Map<string, { median: number; mean: number; count: number; at: number }>();
vi.mock('../src/content/catalog', () => ({
  knownAuctionCard: (id: string) => known.get(id),
  cardsForAuctions: vi.fn(async (ids: string[]) => {
    known.set(A1, { cardId: 'c1', rarity: 'SR', shiny: false });
    known.set(A2, { cardId: 'c2', rarity: 'UR', shiny: false });
    known.set(A3, { cardId: 'c3', rarity: 'SR', shiny: false });
    return new Map(ids.map((id) => [id, known.get(id)!]));
  }),
  cardPrices: vi.fn(async () => {
    prices.set('c1', { median: 40, mean: 40, count: 6, at: 0 });
    prices.set('c2', { median: 80, mean: 80, count: 3, at: 0 });
    prices.set('c3', { median: 0, mean: null as unknown as number, count: 0, at: 0 });
  }),
  knownPrice: (id: string) => prices.get(id),
  displayPrice: (p: { mean: number | null } | undefined) => p?.mean ?? null,
  displayCount: (p: { count: number } | undefined) => p?.count ?? 0,
}));

/** Carte d'enchère telle que relevée sur /marketplace (prix « Mise de départ » / « Mise actuelle »). */
const auction = (id: string, label: string, price: number) => `<div id="marketplace-auction-${id}"><a class="card-frame block p-3 w-[172px]" href="/marketplace/${id}">
  <div class="flex flex-col items-center gap-2.5"><div class="overflow-hidden rounded-2xl"><div class="glow-sr"><h3>Carte</h3></div></div>
  <div class="w-full flex items-center justify-between"><div class="flex flex-col min-w-0"><span class="text-[10px] uppercase">${label}</span><span class="inline-flex items-center gap-1 font-semibold">${price}<svg></svg></span></div>
  <div class="flex flex-col items-end"><span class="text-[10px] uppercase">Durée</span><span class="tabular-nums">3m 18s</span></div></div>
  <p class="w-full text-[10px] truncate">Vendu par osmonoz</p></div></a></div>`;

describe('marché : prix moyen et écart sur chaque enchère', () => {
  it('sous la moyenne en vert, au-dessus en rouge, jamais vendue indiqué ; badge sous la ligne du prix', async () => {
    const { auctionPrice, dealGap } = await import('../src/content/features/market-deals');
    const { makeContext, runFeatures } = await import('../src/content/features/runtime');
    const { DEFAULT_SETTINGS } = await import('../src/lib/defaults');
    history.replaceState(null, '', '/marketplace');
    document.body.innerHTML = `<main><div class="flex flex-wrap">${auction(A1, 'Mise de départ', 24)}${auction(A2, 'Mise actuelle', 100)}${auction(A3, 'Mise de départ', 10)}</div></main>`;
    expect(auctionPrice(document.getElementById(`marketplace-auction-${A2}`)!)).toBe(100);
    expect(dealGap(24, 40)).toBe(-40);
    const ctx = makeContext({ ...DEFAULT_SETTINGS, apiRead: true }, {}, []);
    runFeatures(ctx);
    await vi.waitFor(() => {
      runFeatures(ctx);
      expect(document.querySelectorAll('[data-wiky="deal"]')).toHaveLength(3);
    });
    const deal = (id: string) => document.querySelector<HTMLElement>(`#marketplace-auction-${id} [data-wiky="deal"]`)!;
    expect(deal(A1).className).toBe('good');
    expect(deal(A1).textContent).toContain('Moy. 40 W');
    expect(deal(A1).textContent).toContain('−40 %');
    expect(deal(A2).className).toBe('bad');
    expect(deal(A2).textContent).toContain('+25 %');
    expect(deal(A3).textContent).toBe('Jamais vendue');
    expect(deal(A1).previousElementSibling!.textContent).toContain('Durée');
  });
});
