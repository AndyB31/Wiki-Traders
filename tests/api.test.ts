// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchCardAuctions, fetchMarketSales, fetchMyAuctions, fetchMyBids, fetchMyCollection, fetchMySales, findApiConfig, parseSession, sessionCookie } from '../src/content/api';
import { NOW } from './helpers';

const b64url = (s: string) => Buffer.from(s).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const jwt = (payload: object) => `${b64url('{"alg":"HS256"}')}.${b64url(JSON.stringify(payload))}.sig`;
const REF = 'abcdefghijklmnop';
const ANON = jwt({ role: 'anon', ref: REF });
const ME = 'user-me';

describe('configuration et session', () => {
  it('trouve l\'adresse Supabase et la clé anon dans un script', () => {
    const script = `x="https://${REF}.supabase.co",k="${jwt({ role: 'service_role' })}",a="${ANON}";`;
    expect(findApiConfig(script)).toEqual({ url: `https://${REF}.supabase.co`, anonKey: ANON });
    expect(findApiConfig('rien')).toBeNull();
  });

  it('recolle un cookie découpé et décode le format base64-', () => {
    const value = 'base64-' + b64url(JSON.stringify({ access_token: jwt({ sub: ME, exp: 9_999_999_999 }), refresh_token: 'r' }));
    const half = Math.floor(value.length / 2);
    const cookies = `other=1; sb-${REF}-auth-token.0=${encodeURIComponent(value.slice(0, half))}; sb-${REF}-auth-token.1=${encodeURIComponent(value.slice(half))}`;
    const raw = sessionCookie(cookies, REF)!;
    expect(raw).toBe(value);
    expect(parseSession(raw)).toMatchObject({ userId: ME });
  });
});

describe('lectures', () => {
  afterEach(() => vi.unstubAllGlobals());

  function setup(routes: Record<string, unknown>) {
    document.cookie = `sb-${REF}-auth-token=${encodeURIComponent(JSON.stringify({ access_token: jwt({ sub: ME, exp: 9_999_999_999 }) }))}`;
    document.head.innerHTML = `<script src="https://www.wiki-masters.com/_next/static/chunks/app.js"></script>`;
    const calls: { url: string; method: string }[] = [];
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method ?? 'GET' });
      if (url.includes('/_next/')) return new Response(`u="https://${REF}.supabase.co";k="${ANON}"`);
      const table = new URL(url).pathname.split('/').pop()!;
      const key = Object.keys(routes).find((k) => k.split('?')[0] === table && url.includes(k.split('?')[1] ?? ''))!;
      return new Response(JSON.stringify(routes[key] ?? []));
    });
    return calls;
  }

  it('mes ventes en cours : enchères actives dont je suis le vendeur, sans les terminées non réglées ; uniquement des GET', async () => {
    const future = new Date(Date.now() + 3_600_000).toISOString();
    const past = new Date(Date.now() - 60_000).toISOString();
    const calls = setup({
      'auctions?select=id,card_id,base_amount,current_bid,current_bidder_id,end_at,status': [
        { id: 'v1', card_id: 'c1', base_amount: 20, current_bid: 26, current_bidder_id: 'u2', end_at: future, status: 'active' },
        { id: 'v2', card_id: 'c2', base_amount: 40, current_bid: null, current_bidder_id: null, end_at: future, status: 'active' },
        { id: 'v3', card_id: 'c3', base_amount: 10, current_bid: null, end_at: past, status: 'active' },
      ],
      'cards?': [
        { id: 'c1', wikipedia_title: 'Mont Fuji', rarity: 'R' },
        { id: 'c2', wikipedia_title: 'Marie Curie', rarity: 'SR' },
      ],
    });
    const list = await fetchMyAuctions();
    expect(list.map((a) => [a.id, a.cardId, a.cardName, a.startPrice, a.currentPrice])).toEqual([
      ['v1', 'mont-fuji', 'Mont Fuji', 20, 26],
      ['v2', 'marie-curie', 'Marie Curie', 40, 40],
    ]);
    expect(list[0].endsAt).toBe(Date.parse(future));
    // Au moins une enchère reçue : barre verte dans le récapitulatif.
    expect(list.map((a) => a.hasBid)).toEqual([true, false]);
    const auctionsCall = calls.find((c) => c.url.includes('/auctions?'))!.url;
    expect(auctionsCall).toContain(`seller_id=eq.${ME}`);
    expect(auctionsCall).toContain('status=eq.active');
    expect(calls.every((c) => c.method === 'GET')).toBe(true);
  });

  it('mes mises : statut, mise max, prix de la carte ; uniquement des GET', async () => {
    const future = new Date(Date.now() + 3_600_000).toISOString();
    const calls = setup({
      'auction_bids?': [
        { auction_id: 'a1', amount: 40, placed_at: '2026-10-03T10:00:00Z' },
        { auction_id: 'a1', amount: 55, placed_at: '2026-10-03T10:05:00Z' },
        { auction_id: 'a2', amount: 20, placed_at: '2026-10-02T10:00:00Z' },
      ],
      'auctions?select=id,': [
        { id: 'a1', card_id: 'c1', base_amount: 30, current_bid: 60, current_bidder_id: 'other', final_price: null, status: 'active', end_at: future, winner_id: null, snapshot_rarity: 'SR', is_shiny: false },
        { id: 'a2', card_id: 'c2', base_amount: 10, current_bid: 20, current_bidder_id: ME, final_price: 20, status: 'settled_sold', end_at: '2026-10-02T11:00:00Z', winner_id: ME, snapshot_rarity: 'C', is_shiny: true },
      ],
      'cards?': [
        { id: 'c1', wikipedia_title: 'Zico', rarity: 'SR' },
        { id: 'c2', wikipedia_title: 'Chat', rarity: 'C' },
      ],
      'auctions?select=card_id,final_price': [
        { card_id: 'c1', final_price: 50 },
        { card_id: 'c1', final_price: 70 },
      ],
    });
    const { bids } = await fetchMyBids();
    expect(bids).toHaveLength(2);
    expect(bids[0]).toMatchObject({ cardName: 'Zico', cardId: 'zico', myMax: 55, myBids: 2, current: 60, status: 'outbid', cardSales: 2, cardMedian: 60 });
    expect(bids[1]).toMatchObject({ cardName: 'Chat', status: 'won', current: 20, shiny: true, cardSales: 0, cardMedian: null });
    expect(calls.every((c) => c.method === 'GET')).toBe(true);
    expect(calls.some((c) => c.url.includes(`bidder_id=eq.${ME}`))).toBe(true);
  });

  it('ventes du marché → observations de prix avec rareté', async () => {
    setup({ 'auctions?': [{ id: 'x', card_id: 'c9', final_price: 15, snapshot_rarity: 'R', is_shiny: false, end_at: new Date(NOW).toISOString(), status: 'settled_sold' }] });
    const obs = await fetchMarketSales();
    expect(obs).toEqual([{ cardId: 'site:c9', price: 15, type: 'sold', at: NOW, auctionId: 'x', rarity: 'R', shiny: false }]);
  });

  it('enchères d\'une carte : en cours seulement, de la moins chère à la plus chère', async () => {
    const future = (ms: number) => new Date(Date.now() + ms).toISOString();
    const calls = setup({
      'auctions?select=id,seller_id': [
        { id: 'x1', seller_id: 'a', base_amount: 50, current_bid: null, end_at: future(60_000), is_shiny: false, status: 'active' },
        { id: 'x2', seller_id: ME, base_amount: 20, current_bid: 35, end_at: future(120_000), is_shiny: true, status: 'active' },
        { id: 'x3', seller_id: 'b', base_amount: 10, current_bid: null, end_at: new Date(Date.now() - 1000).toISOString(), is_shiny: false, status: 'active' },
      ],
      'auctions?select=final_price': [{ final_price: 40 }, { final_price: 60 }],
    });
    const r = await fetchCardAuctions('card-uuid');
    expect(r.auctions.map((a) => [a.id, a.price, a.hasBid, a.mine])).toEqual([
      ['x2', 35, true, true],
      ['x1', 50, false, false],
    ]);
    expect(r).toMatchObject({ sales: 2, median: 50 });
    expect(calls.some((c) => c.url.includes('card_id=eq.card-uuid') && c.url.includes('status=eq.active'))).toBe(true);
  });

  it('collection complète : exemplaires regroupés, favoris, étiquettes par nom', async () => {
    setup({
      'user_cards?': [
        { id: 'u1', card_id: 'c1', count: 1, starred: false, snapshot_title: 'Zico', snapshot_rarity: 'SR', snapshot_category: 'footballeur', is_shiny: false },
        { id: 'u2', card_id: 'c1', count: 1, starred: true, snapshot_title: 'Zico', snapshot_rarity: 'SR', snapshot_category: 'footballeur', is_shiny: true },
        { id: 'u3', card_id: 'c2', count: 2, starred: false, snapshot_title: 'Chat', snapshot_rarity: 'C', snapshot_category: null, is_shiny: false },
      ],
      'tags?': [{ id: 't1', name: 'Mettre au Enchère' }, { id: 't2', name: 'Galaxy' }],
      'user_card_tags?': [{ user_card_id: 'u1', tag_id: 't1' }, { user_card_id: 'u2', tag_id: 't2' }],
    });
    const cards = await fetchMyCollection();
    expect(cards).toEqual([
      expect.objectContaining({ id: 'zico', siteId: 'c1', quantity: 2, favorite: true, shiny: true, category: 'footballeur', tags: ['Mettre au Enchère', 'Galaxy'], tagsExact: true }),
      expect.objectContaining({ id: 'chat', quantity: 2, favorite: false, tags: [] }),
    ]);
  });

  it('mes ventes : prix final, invendues, médiane des AUTRES ventes de la carte', async () => {
    const calls = setup({
      'auctions?select=id,card_id,base_amount,final_price,status': [
        { id: 's1', card_id: 'c1', base_amount: 20, final_price: 30, status: 'settled_sold', end_at: '2026-10-03T10:00:00Z', settled_at: '2026-10-03T10:00:05Z', snapshot_rarity: 'SR', is_shiny: false },
        { id: 's2', card_id: 'c2', base_amount: 9, final_price: null, status: 'settled_unsold', end_at: '2026-10-03T09:00:00Z', settled_at: null, snapshot_rarity: 'C', is_shiny: false },
      ],
      'cards?': [{ id: 'c1', wikipedia_title: 'Zico', rarity: 'SR' }, { id: 'c2', wikipedia_title: 'Chat', rarity: 'C' }],
      'auctions?select=id,card_id,final_price': [
        { id: 's1', card_id: 'c1', final_price: 30 },
        { id: 'o1', card_id: 'c1', final_price: 40 },
        { id: 'o2', card_id: 'c1', final_price: 60 },
      ],
    });
    const { items } = await fetchMySales();
    expect(items[0]).toMatchObject({ cardName: 'Zico', sold: true, start: 20, final: 30, cardSales: 2, cardMedian: 50 });
    expect(items[1]).toMatchObject({ cardName: 'Chat', sold: false, final: null, cardSales: 0, cardMedian: null });
    expect(calls.some((c) => c.url.includes(`seller_id=eq.${ME}`))).toBe(true);
    expect(calls.every((c) => c.method === 'GET')).toBe(true);
  });

  it('ventes du marché : rattachées à la carte par son titre ; repli sans jointure si refusée', async () => {
    const row = { id: 'x', card_id: 'c9', final_price: 15, snapshot_rarity: 'R', is_shiny: false, end_at: new Date(NOW).toISOString(), status: 'settled_sold' };
    setup({ 'auctions?': [{ ...row, card: { wikipedia_title: 'Mont Fuji' } }] });
    expect((await fetchMarketSales())[0]).toMatchObject({ cardId: 'mont-fuji', price: 15, rarity: 'R' });

    let calls = 0;
    vi.stubGlobal('fetch', async (url: string) => {
      if (url.includes('/_next/')) return new Response(`u="https://${REF}.supabase.co";k="${ANON}"`);
      calls++;
      if (decodeURIComponent(url).includes('card:cards')) return new Response('{"message":"relation"}', { status: 400 });
      return new Response(JSON.stringify([row]));
    });
    expect((await fetchMarketSales())[0]).toMatchObject({ cardId: 'site:c9', price: 15 });
    expect(calls).toBe(2);
  });
});
