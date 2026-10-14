// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  (globalThis as unknown as { chrome: unknown }).chrome = { runtime: { getURL: (p: string) => p }, storage: { local: { get: async () => ({}), set: async () => {} } } };
});
const { getAll, PAGE_SIZE } = await import('../src/content/api');
const { cardPrices, resetCatalog } = await import('../src/content/catalog');

const b64url = (s: string) => Buffer.from(s).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const jwt = (payload: object) => `${b64url('{"alg":"HS256"}')}.${b64url(JSON.stringify(payload))}.sig`;
const REF = 'abcdefghijklmnop';
const cfg = { url: `https://${REF}.supabase.co`, anonKey: 'anon' };
const session = { accessToken: 't', userId: 'me', expiresAt: 0 };

/** Faux serveur PostgREST : plafonne chaque réponse à 1 000 lignes, annonce le total si `Prefer: count=exact`. */
function server(all: unknown[]) {
  const calls: string[] = [];
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    if (url.includes('/_next/')) return new Response(`u="https://${REF}.supabase.co";k="${jwt({ role: 'anon', ref: REF })}"`);
    calls.push(url);
    const u = new URL(url);
    const offset = Number(u.searchParams.get('offset') ?? 0);
    const limit = Math.min(Number(u.searchParams.get('limit') ?? 1000), 1000);
    const rows = all.slice(offset, offset + limit);
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if ((init?.headers as Record<string, string>)?.Prefer === 'count=exact') headers['content-range'] = `${offset}-${offset + rows.length - 1}/${all.length}`;
    return new Response(JSON.stringify(rows), { headers });
  });
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

describe('pagination de l\'API (plafond de 1 000 lignes par réponse)', () => {
  it('lit toutes les pages jusqu\'au total annoncé, dans un ordre stable', async () => {
    const calls = server(Array.from({ length: 2500 }, (_, i) => ({ i })));
    const rows = await getAll<{ i: number }>(cfg, session, 'auctions?select=i&status=eq.settled_sold');
    expect(rows).toHaveLength(2500);
    expect(rows.at(-1)!.i).toBe(2499);
    expect(calls).toHaveLength(3);
    expect(calls.every((c) => c.includes('order=id') && c.includes(`limit=${PAGE_SIZE}`))).toBe(true);
  });

  it('prix moyens : une carte dont les ventes sont au-delà de la 1 000e ligne a bien son prix (plus de « — »)', async () => {
    resetCatalog();
    document.cookie = `sb-${REF}-auth-token=${encodeURIComponent(JSON.stringify({ access_token: jwt({ sub: 'me', exp: 9_999_999_999 }) }))}`;
    document.head.innerHTML = '<script src="https://www.wiki-masters.com/_next/static/chunks/app.js"></script>';
    // 1 200 ventes de la carte A, puis 300 de la carte B : B n'apparaît qu'en deuxième page.
    const sales = [
      ...Array.from({ length: 1200 }, () => ({ card_id: 'A', final_price: 10, status: 'settled_sold', snapshot_rarity: 'C' })),
      ...Array.from({ length: 300 }, () => ({ card_id: 'B', final_price: 40, status: 'settled_sold', snapshot_rarity: 'R' })),
    ];
    server(sales);
    const prices = await cardPrices(['A', 'B']);
    // Toutes les lignes lues, mais la moyenne porte sur les 200 ventes les plus récentes (comme le site).
    expect(prices.get('A')!.count).toBe(200);
    expect(prices.get('B')!.count).toBe(200);
    expect(prices.get('B')!.byRarity!.R!.mean).toBe(40);
  });

  it('prix moyen comme le site : moyenne des 200 ventes conclues les plus récentes, dans la rareté de la carte', async () => {
    resetCatalog();
    const day = (n: number) => new Date(Date.UTC(2026, 0, 1) + n * 86_400_000).toISOString();
    // 50 vieilles ventes à 1 000, puis 200 récentes à 100 : le site affiche 100.
    server([
      ...Array.from({ length: 50 }, (_, i) => ({ card_id: 'Y', final_price: 1000, status: 'settled_sold', snapshot_rarity: 'UR', settled_at: day(i) })),
      ...Array.from({ length: 200 }, (_, i) => ({ card_id: 'Y', final_price: 100, status: 'settled_sold', snapshot_rarity: 'UR', settled_at: day(100 + i) })),
    ]);
    const p = (await cardPrices(['Y'])).get('Y')!;
    expect(p.mean).toBe(100);
    expect(p.byRarity!.UR).toEqual({ mean: 100, count: 200 });
  });
});
