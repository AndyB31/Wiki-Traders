// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_RULES, DEFAULT_SETTINGS } from '../src/lib/defaults';
import type { Card, MyAuction, MyBid, Settings, SoldItem } from '../src/lib/types';

const storage = vi.hoisted(() => {
  const data: Record<string, unknown> = {};
  const sent: unknown[] = [];
  (globalThis as unknown as { chrome: unknown }).chrome = {
    runtime: {
      getURL: (p: string) => `chrome-extension://wiky/${p}`,
      sendMessage: async (m: { type: string }) => {
        sent.push(m);
        return m.type === 'tabId' ? { tabId: 42 } : undefined;
      },
    },
    storage: {
      local: {
        get: async (keys: string | string[]) => Object.fromEntries((Array.isArray(keys) ? keys : [keys]).filter((k) => k in data).map((k) => [k, structuredClone(data[k])])),
        set: async (o: Record<string, unknown>) => void Object.assign(data, structuredClone(o)),
      },
      onChanged: { addListener: () => {} },
    },
  };
  return { data, sent };
});

const { runFeatures, makeContext } = await import('../src/content/features/runtime');
await import('../src/content/features/market-tabs');
const { resetMarketTabsForTest } = await import('../src/content/features/market-tabs');
const { setMarketDataForTest } = await import('../src/content/features/market-data');
const { activeMarketTab, filterBids, marketTabBar, randomCandidate, salesCounter, salesStats, tagCandidates, withoutWtab } = await import('../src/content/features/market-tabs-logic');
const { performSale } = await import('../src/content/features/market-slots');
const { resetPanelsForTest, saleReference } = await import('../src/content/features/market-panels');
const { createListing, SellError } = await import('../src/content/features/market-sell');

const NOW = Date.now();
const ACTIVE = 'px-4 py-3 text-sm font-medium transition-colors whitespace-nowrap text-orange-400 border-b-2 border-orange-400';
const IDLE = 'px-4 py-3 text-sm font-medium transition-colors whitespace-nowrap text-[var(--color-foreground)]/50 border-b-2 border-transparent';
const LABELS = ['Parcourir', 'Mes ventes (2/5)', 'Mes enchères (2)', 'Gagnées', 'Historique (8)'];

/** Page « Marché » réelle (export du site), avec des onglets qui changent de classes au clic comme React. */
function marketPage(active = 'Parcourir', auctions = ['u1', 'u2']): { clicks: string[] } {
  const clicks: string[] = [];
  const tabs = LABELS.map((l) => `<button class="${l.startsWith(active) ? ACTIVE : IDLE}">${l}</button>`).join('');
  const cards = auctions
    .map(
      (id) => `<div id="marketplace-auction-${id}"><a class="card-frame block p-3 w-[172px]" href="/marketplace/${id}"><div class="flex flex-col items-center gap-2.5">
        <div class="overflow-hidden rounded-2xl"><div class="glow-r relative"><h3>Carte ${id}</h3></div></div>
        <div class="w-full flex items-center justify-between"><div class="flex flex-col min-w-0"><span class="text-[10px] uppercase">Mise actuelle</span><span class="inline-flex items-center gap-1 font-semibold">24</span></div>
        <div class="flex flex-col items-end"><span>Durée</span><span class="tabular-nums font-medium">3m 18s</span></div></div></div>
        <p class="w-full text-[10px] truncate">Vendu par osmonoz</p></a></div>`,
    )
    .join('');
  document.body.innerHTML = `<main><div><div class="flex-1 p-4 md:p-6 space-y-6">
    <div class="flex items-start justify-between gap-4"><div><h1>Marché</h1><p>Enchérissez sur des cartes ou vendez les vôtres…</p></div></div>
    <div class="flex overflow-x-auto border-b border-[var(--color-border)]">${tabs}</div>
    <div class="animate-fade-in-up"><div class="flex flex-wrap justify-center gap-4">${cards}</div></div>
  </div></div></main>`;
  const bar = marketTabBar(document)!;
  for (const b of bar.querySelectorAll('button')) {
    b.addEventListener('click', () => {
      clicks.push(b.textContent!);
      for (const o of bar.querySelectorAll('button')) o.className = o === b ? ACTIVE : IDLE;
    });
  }
  return { clicks };
}

function card(id: string, over: Partial<Card> = {}): Card {
  return { id, name: id, rarity: 'R', tags: ['20-50'], quantity: 2, favorite: false, sitePrice: 30, sitePriceAt: NOW, updatedAt: NOW, ...over };
}

function auction(id: string, cardId: string): MyAuction {
  return { id, cardId, cardName: cardId, tag: '20-50', startPrice: 30, currentPrice: 30, endsAt: NOW + 3_600_000, seenAt: NOW };
}

function data(over: Partial<Parameters<typeof setMarketDataForTest>[0] & object> = {}) {
  return {
    rules: structuredClone(DEFAULT_RULES),
    priceObs: [],
    myAuctions: [],
    manualPrices: {},
    slotOverrides: {},
    ignoredSlots: [],
    bidsCache: null,
    salesCache: null,
    ...over,
  };
}

function ctx(settings: Partial<Settings> = {}, cards: Record<string, Card> = {}) {
  return makeContext({ ...DEFAULT_SETTINGS, siteIntegration: true, ...settings }, cards, []);
}

function bid(over: Partial<MyBid> = {}): MyBid {
  return { auctionId: 'b1', cardId: 'hugo', cardName: 'Victor Hugo', rarity: 'SR', shiny: false, myMax: 100, myBids: 1, lastBidAt: NOW - 60_000, current: 120, status: 'outbid', endsAt: NOW + 30 * 60_000, cardSales: 3, cardMedian: 110, ...over };
}

function sale(over: Partial<SoldItem> = {}): SoldItem {
  return { auctionId: 's1', cardId: 'hugo', cardName: 'Victor Hugo', rarity: 'SR', shiny: false, sold: true, start: 100, final: 150, endedAt: NOW - 3600_000, cardMedian: 120, cardSales: 4, ...over };
}

beforeEach(() => {
  for (const k of Object.keys(storage.data)) delete storage.data[k];
  storage.sent.length = 0;
  localStorage.clear();
  resetMarketTabsForTest();
  resetPanelsForTest();
  setMarketDataForTest(data());
  history.replaceState(null, '', '/marketplace');
  document.body.innerHTML = '';
  delete document.documentElement.dataset.wikyMarketTab;
});
afterEach(() => vi.restoreAllMocks());

describe('onglets du Marché', () => {
  it('repère l\'onglet actif et le compteur « (2/5) » sur la barre réelle', () => {
    marketPage('Mes ventes');
    const bar = marketTabBar(document);
    expect(bar?.children).toHaveLength(5);
    expect(activeMarketTab(bar)).toBe('sales');
    expect(salesCounter(bar)).toEqual({ active: 2, slots: 5 });
  });

  it('reflète l\'onglet actif dans <html data-wiky-market-tab>, et le retire hors du Marché', () => {
    marketPage('Gagnées');
    runFeatures(ctx());
    expect(document.documentElement.dataset.wikyMarketTab).toBe('won');
    history.replaceState(null, '', '/collection');
    runFeatures(ctx());
    expect(document.documentElement.dataset.wikyMarketTab).toBeUndefined();
  });

  it('?wtab= : un seul clic sur l\'onglet demandé, puis le paramètre est retiré (les autres restent)', () => {
    history.replaceState(null, '', '/marketplace?wtab=bids&x=1');
    const { clicks } = marketPage('Parcourir');
    runFeatures(ctx());
    expect(clicks).toEqual(['Mes enchères (2)']);
    expect(location.search).toBe('?x=1');
    runFeatures(ctx());
    runFeatures(ctx());
    expect(clicks).toHaveLength(1);
    expect(document.documentElement.dataset.wikyMarketTab).toBe('bids');
  });

  it('?wtab= vers l\'onglet déjà actif : aucun clic', () => {
    history.replaceState(null, '', '/marketplace?wtab=sales');
    const { clicks } = marketPage('Mes ventes');
    runFeatures(ctx());
    expect(clicks).toEqual([]);
    expect(location.search).toBe('');
  });

  it('événement « wiky-market-tab » : change d\'onglet sur place', () => {
    const { clicks } = marketPage('Parcourir');
    runFeatures(ctx());
    window.dispatchEvent(new CustomEvent('wiky-market-tab', { detail: 'history' }));
    expect(clicks).toEqual(['Historique (8)']);
    window.dispatchEvent(new CustomEvent('wiky-market-tab', { detail: 'history' }));
    expect(clicks).toHaveLength(1);
  });

  it('withoutWtab garde le chemin, les autres paramètres et l\'ancre', () => {
    expect(withoutWtab('https://www.wiki-masters.com/marketplace?a=1&wtab=sales#x')).toBe('/marketplace?a=1#x');
    expect(withoutWtab('https://www.wiki-masters.com/marketplace?wtab=sales')).toBe('/marketplace');
  });
});

describe('Mes ventes : slots libres', () => {
  const cards = { a: card('a', { quantity: 3 }), b: card('b', { quantity: 2 }), u1: card('u1'), u2: card('u2') };

  it('ajoute autant de slots libres que le compteur « (2/5) » en indique, après les cartes du site', () => {
    setMarketDataForTest(data({ myAuctions: [auction('u1', 'u1'), auction('u2', 'u2')] }));
    marketPage('Mes ventes');
    runFeatures(ctx({}, cards));
    const grid = document.querySelector('#marketplace-auction-u1')!.parentElement!;
    const slots = grid.querySelectorAll('[data-wiky="mt-slot"]');
    expect(slots).toHaveLength(3);
    expect(grid.lastElementChild).toBe(slots[2]);
    expect(slots[0].textContent).toContain('Slot libre');
    expect(slots[0].textContent).toContain('20-50');
    // Slots occupés : étiquette de la règle.
    expect(document.querySelector('#marketplace-auction-u1 [data-wiky="mt-slot-badge"]')?.textContent).toBe('20-50');
    // Idempotent : rien n'est recréé.
    runFeatures(ctx({}, cards));
    expect(grid.querySelectorAll('[data-wiky="mt-slot"]')[0]).toBe(slots[0]);
    expect(grid.querySelectorAll('[data-wiky="mt-slot"]')).toHaveLength(3);
  });

  it('retire les slots en quittant l\'onglet', () => {
    marketPage('Mes ventes');
    runFeatures(ctx({}, cards));
    expect(document.querySelectorAll('[data-wiky="mt-slot"]').length).toBe(3);
    const bar = marketTabBar(document)!;
    (bar.children[0] as HTMLElement).click();
    runFeatures(ctx({}, cards));
    expect(document.querySelectorAll('[data-wiky="mt-slot"]').length).toBe(0);
  });

  it('clic sur un slot libre : fenêtre « Vendre » avec la carte proposée', () => {
    marketPage('Mes ventes');
    runFeatures(ctx({}, cards));
    (document.querySelector('[data-wiky="mt-slot"]') as HTMLElement).click();
    const modal = document.querySelector('[data-wiky="mt-sell"]')!;
    expect(modal).not.toBeNull();
    expect(modal.querySelector('[data-act="sell"]')?.textContent).toBe('Ouvrir et pré-remplir');
    expect(modal.querySelector('.wiky-sell-card')?.textContent).toMatch(/×\d/);
    expect(modal.querySelectorAll('.wiky-sell-durations button')).toHaveLength(6);
  });

  it('avec « Vendre depuis le classement » : bouton « Mettre aux enchères »', () => {
    marketPage('Mes ventes');
    runFeatures(ctx({ features: { rankingSell: true } }, cards));
    (document.querySelector('[data-wiky="mt-slot"]') as HTMLElement).click();
    expect(document.querySelector('[data-wiky="mt-sell"] [data-act="sell"]')?.textContent).toBe('Mettre aux enchères');
  });
});

describe('carte au hasard', () => {
  const input = (cards: Record<string, Card>, myAuctions: MyAuction[] = []) => ({
    rules: structuredClone(DEFAULT_RULES),
    settings: { ...DEFAULT_SETTINGS },
    cards,
    priceObs: [],
    myAuctions,
    manualPrices: {},
    slotOverrides: {},
    ignoredSlots: [],
  });

  it('écarte les favorites, les cartes déjà en vente et celles à garder (keepMin)', () => {
    const cards = {
      fav: card('fav', { favorite: true, quantity: 5 }),
      sale: card('sale', { quantity: 5 }),
      keep: card('keep', { quantity: 1 }),
      ok: card('ok', { quantity: 2 }),
      other: card('other', { tags: ['50-100'], quantity: 4 }),
    };
    const inp = input(cards, [auction('x', 'sale')]);
    expect(tagCandidates(inp, '20-50').map((c) => c.card.id)).toEqual(['ok']);
    for (const r of [0, 0.5, 0.999]) expect(randomCandidate(inp, '20-50', () => r)?.card.id).toBe('ok');
    expect(randomCandidate(inp, '50-100', () => 0)?.card.id).toBe('other');
    expect(randomCandidate(input({ fav: cards.fav }), '20-50')).toBeNull();
  });

  it('tire au hasard parmi plusieurs cartes, en évitant la carte déjà choisie', () => {
    const inp = input({ a: card('a'), b: card('b'), c: card('c') });
    const picks = new Set([0, 0.4, 0.8].map((r) => randomCandidate(inp, '20-50', () => r)!.card.id));
    expect(picks.size).toBe(3);
    expect(randomCandidate(inp, '20-50', () => 0, Date.now(), ['a', 'b'])?.card.id).toBe('c');
  });
});

describe('vente depuis un slot', () => {
  const choice = { card: card('hugo', { siteId: 'site-hugo', name: 'Victor Hugo' }), price: 42, detail: 'moyenne 60 × 70 %', durationMin: 60, tag: '20-50', avgPrice: 60 };

  it('option coupée : « Ouvrir et pré-remplir » (message proposed + pendingFocus de cet onglet), aucune mise en vente', async () => {
    const list = vi.fn();
    const res = await performSale({ rankingSell: false }, choice, { list: list as never });
    expect(res).toEqual({ ok: true, mode: 'prefill' });
    expect(list).not.toHaveBeenCalled();
    expect(storage.sent).toContainEqual({ type: 'proposed', cardId: 'hugo', cardName: 'Victor Hugo', tag: '20-50', price: 42, avgPrice: 60 });
    expect(storage.data.pendingFocus).toMatchObject({ cardId: 'hugo', price: 42, durationMin: 60, autoOpen: true, tabId: 42 });
  });

  it('option activée : confirmation puis createListing, et demande de relecture de mes ventes', async () => {
    const list = vi.fn(async () => ({}));
    const refreshed = vi.fn();
    window.addEventListener('wiky-refresh-sales', refreshed);
    const res = await performSale({ rankingSell: true }, choice, { list, confirm: async () => true });
    window.removeEventListener('wiky-refresh-sales', refreshed);
    expect(res.ok).toBe(true);
    expect(list).toHaveBeenCalledWith({ rankingSell: true }, { siteCardId: 'site-hugo', amount: 42, durationMinutes: 60, allowStarred: false });
    expect(refreshed).toHaveBeenCalledTimes(1);
    expect(storage.data.pendingFocus).toBeUndefined();
  });

  it('option activée mais confirmation refusée : rien n\'est envoyé', async () => {
    const list = vi.fn();
    const res = await performSale({ rankingSell: true }, choice, { list: list as never, confirm: async () => false });
    expect(res.ok).toBe(false);
    expect(list).not.toHaveBeenCalled();
  });

  it('createListing refuse sans l\'option, sans appel réseau', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    await expect(createListing({ rankingSell: false }, { siteCardId: 'x', amount: 10, durationMinutes: 60 })).rejects.toBeInstanceOf(SellError);
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});

describe('Mes enchères', () => {
  const now = NOW;
  const bids = [
    bid({ auctionId: 'run1', status: 'leading', endsAt: now + 600_000 }),
    bid({ auctionId: 'run2', status: 'outbid', endsAt: now + 60_000 }),
    bid({ auctionId: 'won', status: 'won', endsAt: now - 3600_000 }),
    bid({ auctionId: 'lost', status: 'lost', endsAt: now - 60_000 }),
    bid({ auctionId: 'stale', status: 'leading', endsAt: now - 1000 }),
  ];

  it('filtres En cours / Historique / Toutes', () => {
    expect(filterBids(bids, 'current', now).map((b) => b.auctionId)).toEqual(['run2', 'run1']);
    expect(filterBids(bids, 'history', now).map((b) => b.auctionId)).toEqual(['stale', 'lost', 'won']);
    expect(filterBids(bids, 'all', now)).toHaveLength(5);
  });

  it('panneau au-dessus de la liste du site, relecture demandée une fois à l\'ouverture, filtre mémorisé', () => {
    setMarketDataForTest(data({ bidsCache: { at: now, bids } }));
    const asked = vi.fn();
    window.addEventListener('wiky-refresh-bids', asked);
    marketPage('Mes enchères');
    runFeatures(ctx({ apiRead: true }));
    runFeatures(ctx({ apiRead: true }));
    window.removeEventListener('wiky-refresh-bids', asked);
    expect(asked).toHaveBeenCalledTimes(1);
    const panel = document.querySelector('[data-wiky="mt-bids"]')!;
    expect(panel.previousElementSibling).toBe(marketTabBar(document));
    expect(panel.textContent).toContain('Actualisation…');
    expect(panel.querySelectorAll('.wiky-mt-row')).toHaveLength(2);
    expect(panel.querySelector('.wiky-mt-pill')?.textContent).toBe('Surenchéri');
    (panel.querySelector('[data-value="all"]') as HTMLElement).click();
    expect(panel.querySelectorAll('.wiky-mt-row')).toHaveLength(5);
    expect(localStorage.getItem('wiky-mt-bids-filter')).toBe('all');
    expect(panel.querySelector<HTMLAnchorElement>('a.wiky-mt-name')?.getAttribute('href')).toBe('/marketplace/run2');
  });
});

describe('Historique', () => {
  const items = [
    sale({ auctionId: 's1', start: 100, final: 150, cardMedian: 120, cardSales: 4 }),
    sale({ auctionId: 's2', cardName: 'Paris', start: 50, final: 50, cardMedian: 100, cardSales: 2 }),
    sale({ auctionId: 's3', cardName: 'Lune', sold: false, start: 80, final: null }),
  ];

  it('statistiques : ventes, invendues, taux, total, gains moyens, meilleure vente', () => {
    const s = salesStats(items, (i) => i.cardMedian);
    expect(s.sold).toBe(2);
    expect(s.unsold).toBe(1);
    expect(s.rate).toBeCloseTo(2 / 3);
    expect(s.total).toBe(200);
    expect(s.avgVsStart).toBeCloseTo((0.5 + 0) / 2);
    expect(s.avgVsRef).toBeCloseTo((0.25 - 0.5) / 2);
    expect(s.best?.auctionId).toBe('s1');
    expect(salesStats([], () => null)).toMatchObject({ sold: 0, unsold: 0, rate: null, total: 0, avgVsStart: null, best: null });
  });

  it('référence : médiane de mes ventes relevées si la moyenne du site n\'est pas connue, sinon médiane rareté', () => {
    expect(saleReference(sale({ cardMedian: 120, cardSales: 4 }), null, () => 99)).toBe(120);
    expect(saleReference(sale({ cardMedian: null, cardSales: 0 }), null, () => 99)).toBe(99);
  });

  it('remplace la grille du site (masquée, jamais retirée), filtres et « Liste du site »', () => {
    setMarketDataForTest(data({ salesCache: { at: NOW, items } }));
    const asked = vi.fn();
    window.addEventListener('wiky-refresh-sales-history', asked);
    marketPage('Historique');
    runFeatures(ctx());
    window.removeEventListener('wiky-refresh-sales-history', asked);
    expect(asked).toHaveBeenCalledTimes(1);
    const panel = document.querySelector('[data-wiky="mt-history"]')!;
    const site = document.querySelector('.animate-fade-in-up')!;
    expect(site.hasAttribute('data-wiky-hidden')).toBe(true);
    expect(panel.querySelectorAll('.wiky-mt-row')).toHaveLength(3);
    expect(panel.querySelector('.wiky-mt-stats')?.textContent).toContain('67 %');
    (panel.querySelector('[data-value="unsold"]') as HTMLElement).click();
    expect(panel.querySelectorAll('.wiky-mt-row')).toHaveLength(1);
    (panel.querySelector('[data-role="site-toggle"]') as HTMLElement).click();
    expect(site.hasAttribute('data-wiky-hidden')).toBe(false);
    // Autre onglet : panneau retiré, grille du site intacte.
    (marketTabBar(document)!.children[0] as HTMLElement).click();
    runFeatures(ctx());
    expect(document.querySelector('[data-wiky="mt-history"]')).toBeNull();
    expect(document.querySelector('.animate-fade-in-up')).toBe(site);
    expect(site.hasAttribute('data-wiky-hidden')).toBe(false);
  });
});

