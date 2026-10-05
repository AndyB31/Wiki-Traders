// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  (globalThis as unknown as { chrome: unknown }).chrome = { runtime: { getURL: (p: string) => p }, storage: { local: { get: async () => ({}), set: async () => {} }, onChanged: { addListener() {} } } };
});
const ID = '09ee8b59-edef-40e4-bdb4-14fe11ff82df';
vi.mock('../src/content/catalog', () => ({ cardIdForAuction: vi.fn(async () => 'card-1') }));
vi.mock('../src/content/api', () => ({
  fetchCardAuctions: vi.fn(async () => ({
    auctions: [
      { id: 'other-1', price: 28, hasBid: false, endsAt: Date.now() + 600_000, shiny: false, mine: false },
      { id: ID, price: 30, hasBid: true, endsAt: Date.now() + 60_000, shiny: false, mine: false },
      { id: 'other-2', price: 60, hasBid: true, endsAt: Date.now() + 9_000_000, shiny: true, mine: false },
    ],
    sales: 2,
    median: 40,
  })),
}));
const { makeContext, runFeatures } = await import('../src/content/features/runtime');
await import('../src/content/features/auction-others');
const { DEFAULT_SETTINGS } = await import('../src/lib/defaults');

describe('page d\'une enchère : autres enchères de la même carte', () => {
  it('liste les autres enchères (pas celle affichée), de la moins chère à la plus chère, chacune cliquable', async () => {
    document.body.innerHTML = '<main><h1>Enchère</h1></main>';
    history.replaceState(null, '', `/marketplace/${ID}`);
    const ctx = makeContext({ ...DEFAULT_SETTINGS, apiRead: true }, {}, []);
    runFeatures(ctx);
    await vi.waitFor(() => expect(document.querySelectorAll('[data-wiky="auction-others"] a.ao-row')).toHaveLength(2));
    const rows = [...document.querySelectorAll<HTMLAnchorElement>('[data-wiky="auction-others"] a.ao-row')];
    expect(rows.map((r) => r.getAttribute('href'))).toEqual(['/marketplace/other-1', '/marketplace/other-2']);
    expect(rows[1].textContent).toContain('✨');
    // Quitter la page retire la liste.
    history.replaceState(null, '', '/marketplace');
    runFeatures(makeContext({ ...DEFAULT_SETTINGS, apiRead: true }, {}, []));
    expect(document.querySelector('[data-wiky="auction-others"]')).toBeNull();
  });
});
