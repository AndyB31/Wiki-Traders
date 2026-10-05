// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../src/lib/defaults';
import type { MyBid, Settings } from '../src/lib/types';

const storage = vi.hoisted(() => {
  const data: Record<string, unknown> = {};
  (globalThis as unknown as { chrome: unknown }).chrome = {
    runtime: { getURL: (p: string) => `chrome-extension://wiky/${p}` },
    storage: {
      local: {
        get: async (keys: string | string[]) => Object.fromEntries((Array.isArray(keys) ? keys : [keys]).filter((k) => k in data).map((k) => [k, structuredClone(data[k])])),
        set: async (o: Record<string, unknown>) => void Object.assign(data, structuredClone(o)),
      },
      onChanged: { addListener: () => {} },
    },
  };
  return data;
});

const { ingestTrades, mapTrades, matchTrade, resetTrades, tradeSides } = await import('../src/content/features/trades');
const { runFeatures } = await import('../src/content/features/runtime');
const { bidPollDelay, nextMinBid, OutbidAlerts, parseMinimumFromError, quickOutbid, formatRemaining, setBidsForTest } = await import('../src/content/features/bid-watch');
const { makeContext } = await import('../src/content/features/runtime');
const { NotificationCounter, readNotificationCount } = await import('../src/content/features/notifications');

const NOW = Date.UTC(2026, 9, 5, 12);

function bid(over: Partial<MyBid> = {}): MyBid {
  return { auctionId: 'a1', cardId: 'hugo', cardName: 'Victor Hugo', rarity: 'SR', shiny: false, myMax: 100, myBids: 1, lastBidAt: NOW - 60_000, current: 120, status: 'outbid', endsAt: NOW + 30 * 60_000, cardSales: 3, cardMedian: 110, ...over };
}

function setSettings(features: Settings['features'], apiRead = true): void {
  storage.settings = { ...DEFAULT_SETTINGS, apiRead, features };
}

beforeEach(() => {
  for (const k of Object.keys(storage)) delete storage[k];
  document.body.innerHTML = '';
});
afterEach(() => vi.unstubAllGlobals());

// ---------------------------------------------------------------- échanges

/** Réponse `/api/trades` (forme relevée par « Prix moyen collection »). */
const TRADES = {
  trades: [
    {
      id: 't1',
      status: 'pending',
      initiator_id: 'u1',
      recipient_id: 'u2',
      initiator_wikibidous: 50,
      recipient_wikibidous: 0,
      initiator: { username: 'alice' },
      recipient: { username: 'bob' },
      items: [
        { id: 'i1', offered_by: 'u1', card_id: 'c1', snapshot_rarity: 'SR', card: { id: 'c1', wikipedia_title: 'Victor Hugo', rarity: 'SR', image_url: 'https://img/hugo.jpg' } },
        { id: 'i2', offered_by: 'u1', card_id: 'c2', card: { id: 'c2', wikipedia_title: 'Paris', rarity: 'C' } },
        { id: 'i3', offered_by: 'u2', card_id: 'c3', card: { id: 'c3', wikipedia_title: 'Lune', rarity: 'UR' } },
        { id: 'i4', offered_by: 'u2', card_id: 'c4', card: { id: 'c4', wikipedia_title: 'Mars', rarity: 'R' } },
      ],
    },
    { id: 't2', initiator_id: 'u3', recipient_id: 'u1', initiator: { username: 'carol' }, recipient: { username: 'alice' }, items: [{ offered_by: 'u3', card_id: 'c5', card: { wikipedia_title: 'Rome', rarity: 'R' } }] },
    { id: 'bad' },
  ],
};

describe('valeur des échanges', () => {
  it('lit les échanges du site', () => {
    const list = mapTrades(TRADES);
    expect(list.map((t) => t.id)).toEqual(['t1', 't2']);
    expect(list[0].initiator).toEqual({ id: 'u1', name: 'alice', wikibidous: 50 });
    expect(list[0].items[0].card).toEqual({ siteId: 'c1', title: 'Victor Hugo', rarity: 'SR', imageUrl: 'https://img/hugo.jpg' });
  });

  it('total de chaque côté : prix moyens connus + WikiBidous, cartes sans prix comptées à part', () => {
    const [t] = mapTrades(TRADES);
    const prices = new Map([
      ['c1', { median: 200, mean: 200, count: 5, at: 0 }],
      ['c2', { median: 10, mean: 10, count: 1, at: 0 }],
      ['c3', { median: 300, mean: 300, count: 2, at: 0 }],
    ]);
    const [a, b] = tradeSides(t, prices);
    expect(a.user.name).toBe('alice');
    expect(a.total).toBe(260);
    expect(a.missing).toBe(0);
    expect(b.total).toBe(300);
    expect(b.missing).toBe(1);
    expect(b.cards.map((c) => c.price)).toEqual([300, null]);
  });

  it('retrouve l\'échange affiché dans la page (titres et pseudos)', () => {
    const list = mapTrades(TRADES);
    document.body.innerHTML = `<div class="card-frame"><span>carol → alice</span><span title="Rome" style="background: var(--color-rarity-r)">Rome</span></div>`;
    expect(matchTrade(document.querySelector('.card-frame')!, list, new Set())!.id).toBe('t2');
    expect(matchTrade(document.querySelector('.card-frame')!, list, new Set(['t2']))).toBeNull();
  });
});

describe('aperçu des échanges', () => {
  it('mini-carte (image, rareté) à la place du nom tronqué, posée une seule fois', () => {
    resetTrades();
    history.replaceState(null, '', '/trades');
    document.body.innerHTML = `<main><div class="card-frame"><span title="Victor Hugo" style="background: var(--color-rarity-sr)">Victor H…</span></div></main>`;
    ingestTrades(TRADES);
    const ctx = makeContext({ ...DEFAULT_SETTINGS }, {}, []);
    runFeatures(ctx);
    const chip = document.querySelector('span[title="Victor Hugo"]:not([data-wiky])')!;
    const preview = chip.previousElementSibling as HTMLElement;
    expect(preview.getAttribute('data-wiky')).toBe('trade-preview');
    expect(preview.querySelector('img')!.getAttribute('src')).toBe('https://img/hugo.jpg');
    expect(preview.querySelector('.wiky-f-rar')!.textContent).toBe('SR');
    runFeatures(ctx);
    expect(document.querySelectorAll('[data-wiky="trade-preview"]')).toHaveLength(1);
    // Valeurs : pas sans la lecture via l'API.
    expect(document.querySelector('[data-wiky="trade-values"]')).toBeNull();
  });
});

// ---------------------------------------------------------------- mises

describe('suivi de mes mises', () => {
  it('mise minimale comme le site : prix de départ sans enchère, sinon +10 % arrondi au supérieur', () => {
    expect(nextMinBid(100, true)).toBe(110);
    expect(nextMinBid(101, true)).toBe(112);
    expect(nextMinBid(15, false)).toBe(15);
    expect(nextMinBid(null, true)).toBeNull();
    expect(parseMinimumFromError('La mise minimum 1 234 wikibidous est requise')).toBe(1234);
    expect(parseMinimumFromError('Erreur')).toBeNull();
  });

  it('relecture rapprochée seulement si une mise se termine dans les 10 minutes', () => {
    expect(bidPollDelay([bid()], NOW, true)).toBeNull();
    expect(bidPollDelay([bid({ endsAt: NOW + 5 * 60_000 })], NOW, true)).toBe(20_000);
    expect(bidPollDelay([bid({ endsAt: NOW + 5 * 60_000, status: 'leading' })], NOW, false)).toBe(60_000);
    // Terminée ou gagnée : plus de suivi.
    expect(bidPollDelay([bid({ endsAt: NOW - 1000 }), bid({ status: 'won', endsAt: NOW + 60_000 })], NOW, true)).toBeNull();
  });

  it('bip une seule fois quand je suis surenchéri à moins d\'une minute', () => {
    const alerts = new OutbidAlerts();
    expect(alerts.collect([bid({ endsAt: NOW + 90_000 })], NOW)).toEqual([]);
    expect(alerts.collect([bid({ endsAt: NOW + 50_000 })], NOW)).toEqual(['a1']);
    expect(alerts.collect([bid({ endsAt: NOW + 50_000 })], NOW + 1000)).toEqual([]);
    expect(alerts.collect([bid({ endsAt: NOW + 50_000, status: 'leading' })], NOW)).toEqual([]);
    expect(formatRemaining(65_000)).toBe('1 min 05 s');
    expect(formatRemaining(0)).toBe('Terminée');
  });

  it('bloc « Mises en direct » sous le résumé de la barre latérale, bouton de surenchère seulement si l\'option est active', () => {
    document.body.innerHTML = '<nav class="w-64"><a href="/collection">Collection</a><div data-wiky="nav-wiky"></div><a href="/settings">Paramètres</a></nav>';
    const now = Date.now();
    const bids = [bid({ endsAt: now + 45_000 }), bid({ auctionId: 'a2', cardName: 'Paris', status: 'leading', endsAt: now + 3_600_000 }), bid({ auctionId: 'a3', status: 'won', endsAt: now - 1000 })];
    const ctx = makeContext({ ...DEFAULT_SETTINGS, apiRead: true }, {}, []);
    setBidsForTest({ at: now, bids }, ctx);
    const box = document.querySelector<HTMLElement>('[data-wiky="bid-watch"]')!;
    expect(box.previousElementSibling!.getAttribute('data-wiky')).toBe('nav-wiky');
    const rows = [...box.querySelectorAll<HTMLElement>('.wiky-bw-row')];
    expect(rows.map((r) => r.querySelector('.wiky-bw-name')!.textContent)).toEqual(['Victor Hugo', 'Paris']);
    expect(rows[0].className).toContain('urgent');
    expect(box.querySelector('.wiky-f-btn')).toBeNull();
    setBidsForTest({ at: now, bids }, makeContext({ ...DEFAULT_SETTINGS, apiRead: true, features: { quickOutbid: true } }, {}, []));
    expect(box.querySelector('.wiky-f-btn')!.textContent).toBe('Surenchérir 132');
    setBidsForTest(null, ctx);
    expect(document.querySelector('[data-wiky="bid-watch"]')).toBeNull();
  });

  function bidFetch() {
    const calls: { url: string; init?: RequestInit }[] = [];
    const impl = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      const json = url === '/api/wikibidous' ? { balance: 500 } : url.endsWith('/bid') ? { current_bid: 132 } : { auction: { id: 'a1', current_bid: 120, base_amount: 50, end_at: new Date(NOW + 600_000).toISOString() } };
      return new Response(JSON.stringify(json), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    return { impl: impl as unknown as typeof fetch, calls };
  }

  it('surenchère : rien n\'est envoyé si l\'option est coupée', async () => {
    setSettings({ quickOutbid: false });
    storage.bidsCache = { at: NOW, bids: [bid()] };
    const { impl, calls } = bidFetch();
    const confirm = vi.fn(async () => true);
    expect(await quickOutbid('a1', { fetchImpl: impl, confirm, now: NOW })).toMatchObject({ ok: false });
    expect(calls).toHaveLength(0);
    expect(confirm).not.toHaveBeenCalled();
  });

  it('surenchère : confirmation (montant, solde) puis POST de la mise minimale', async () => {
    setSettings({ quickOutbid: true });
    storage.bidsCache = { at: NOW, bids: [bid()] };
    const { impl, calls } = bidFetch();
    const confirm = vi.fn(async (o: { text: string }) => {
      expect(o.text).toContain('132 W');
      expect(o.text).toContain('Solde : 500 W');
      return true;
    });
    const r = await quickOutbid('a1', { fetchImpl: impl, confirm: confirm as never, now: NOW });
    expect(r).toEqual({ ok: true, amount: 132 });
    const post = calls.find((c) => c.init?.method === 'POST')!;
    expect(post.url).toBe('/api/marketplace/a1/bid');
    expect(post.init).toMatchObject({ credentials: 'include', headers: { 'Content-Type': 'application/json' } });
    expect(JSON.parse(String(post.init!.body))).toEqual({ amount: 132 });
    // Une seule écriture ; relevé local mis à jour.
    expect(calls.filter((c) => c.init?.method === 'POST')).toHaveLength(1);
    expect((storage.bidsCache as { bids: MyBid[] }).bids[0]).toMatchObject({ status: 'leading', current: 132, myMax: 132 });
  });

  it('surenchère : annulée à la confirmation, ou en tête → aucune mise', async () => {
    setSettings({ quickOutbid: true });
    storage.bidsCache = { at: NOW, bids: [bid(), bid({ auctionId: 'a2', status: 'leading' })] };
    const { impl, calls } = bidFetch();
    expect(await quickOutbid('a1', { fetchImpl: impl, confirm: async () => false, now: NOW })).toMatchObject({ ok: false, error: 'Annulé.' });
    expect(await quickOutbid('a2', { fetchImpl: impl, confirm: async () => true, now: NOW })).toMatchObject({ ok: false });
    expect(calls.filter((c) => c.init?.method === 'POST')).toHaveLength(0);
  });
});

// ---------------------------------------------------------------- notifications

describe('son des notifications', () => {
  it('lit le compteur de la cloche et détecte une hausse (pas au premier relevé)', () => {
    document.body.innerHTML = '<button aria-label="Notifications"><svg></svg></button>';
    const counter = new NotificationCounter();
    expect(readNotificationCount()).toBe(0);
    expect(counter.update(readNotificationCount())).toBe(false);
    document.querySelector('button')!.insertAdjacentHTML('beforeend', '<span>2</span>');
    expect(readNotificationCount()).toBe(2);
    expect(counter.update(2)).toBe(true);
    expect(counter.update(2)).toBe(false);
    expect(counter.update(1)).toBe(false);
    expect(counter.update(3)).toBe(true);
    expect(counter.update(null)).toBe(false);
    document.body.innerHTML = '';
    expect(readNotificationCount()).toBeNull();
  });
});
