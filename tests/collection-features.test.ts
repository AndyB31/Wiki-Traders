// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../src/lib/defaults';
import { FEATURES, type FeatureFlags, type FeatureKey } from '../src/lib/features';
import type { Card } from '../src/lib/types';
import { card, cardsById } from './helpers';

vi.hoisted(() => {
  (globalThis as unknown as { chrome: unknown }).chrome = {
    runtime: { getURL: (p: string) => `chrome-extension://wiky/${p}` },
    storage: { local: { get: async () => ({}), set: async () => {} }, onChanged: { addListener: () => {} } },
  };
});

vi.mock('../src/content/api', async (orig) => ({
  ...(await orig<typeof import('../src/content/api')>()),
  discoverConfig: async () => ({ url: 'https://ref.supabase.co', anonKey: 'anon' }),
  readSession: () => ({ accessToken: 'tok', userId: 'me', expiresAt: 0 }),
}));

const { makeContext, runFeatures } = await import('../src/content/features/runtime');
await import('../src/content/features');
const { resetCatalog } = await import('../src/content/catalog');
const { resetPriceBadges } = await import('../src/content/features/price-badges');
const { rankCards, rankTotals, openRanking, closeRanking, EMPTY_FILTER } = await import('../src/content/features/ranking');
const { createListing, pickCopy, SellError } = await import('../src/content/features/market-sell');
const { resolveImages, resetWikiImages } = await import('../src/content/wiki-images');
const { resetMissingImages } = await import('../src/content/features/missing-images');

/** Réglages avec seulement les fonctionnalités demandées. */
function ctxWith(on: FeatureKey[], cards: Record<string, Card>, apiRead = true) {
  const features = Object.fromEntries(FEATURES.map((f) => [f.key, on.includes(f.key)])) as FeatureFlags;
  return makeContext({ ...DEFAULT_SETTINGS, apiRead, features }, cards, []);
}

/** Carte du site (même structure que /collection). */
function nativeCard(title: string, rarity = 'r', img = `/_next/image?url=%2Fcards%2F${encodeURIComponent(title)}.jpg`) {
  return `<div class="relative isolate group"><div class="w-[10rem] glow-${rarity} relative rounded-2xl overflow-hidden cursor-pointer">
    <img alt="" src="/rare.png"><div class="absolute inset-0 bg-gradient-to-b"></div>
    <div class="absolute top-0 left-0 right-0 h-[45%] z-20"><div class="relative h-full w-full"><img alt="${title}" src="${img}"></div></div>
    <div class="absolute top-2 left-2">${rarity.toUpperCase()}</div>
    <div class="absolute top-[45%] left-0 right-0 bottom-0 flex flex-col p-3"><h3>${title}</h3><p>catégorie</p></div>
  </div></div>`;
}

function mount(titles: string[], img?: (t: string) => string) {
  document.body.innerHTML = `<main><div class="flex-1 space-y-6">
    <div class="flex items-center justify-between gap-3"><h1>Collection</h1><button type="button">Sélectionner</button></div>
    <div class="grid">${titles.map((t) => nativeCard(t, 'r', img?.(t))).join('')}</div></div></main>`;
}

const flush = async (n = 6) => {
  for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0));
};

type Call = { url: string; init?: RequestInit };
let calls: Call[] = [];

function stubFetch(handler: (url: string, init?: RequestInit) => unknown) {
  calls = [];
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const body = handler(url, init);
    return new Response(typeof body === 'string' ? body : JSON.stringify(body ?? []), { status: 200 });
  });
}

beforeEach(() => {
  resetCatalog();
  resetPriceBadges();
  resetWikiImages();
  resetMissingImages();
  closeRanking();
  localStorage.clear();
  history.replaceState(null, '', '/collection');
});

afterEach(() => {
  vi.unstubAllGlobals();
  runFeatures(ctxWith([], {}));
});

describe('prix moyen sur les cartes', () => {
  const titles = ['Zico', 'Colisée', 'Origami', 'Albert Einstein', 'Tour Eiffel'];
  const cards = cardsById(...titles.map((t, i) => card(t.toLowerCase().replace(/ /g, '-').normalize('NFD').replace(/[̀-ͯ]/g, ''), { name: t, siteId: `id${i}` })));

  it('une seule requête pour toutes les cartes affichées, puis « Moy. N W »', async () => {
    mount(titles);
    stubFetch((url) => (url.includes('/auctions') ? [{ card_id: 'id0', final_price: 10 }, { card_id: 'id0', final_price: 14 }, { card_id: 'id1', final_price: 30 }] : []));
    runFeatures(ctxWith(['priceBadges'], cards));
    // État de chargement tout de suite.
    expect([...document.querySelectorAll('[data-wiky="avg"]')].map((b) => b.textContent)).toEqual(Array(5).fill('Prix…'));
    await flush();
    const priceCalls = calls.filter((c) => c.url.includes('/rest/v1/auctions'));
    expect(priceCalls).toHaveLength(1);
    for (let i = 0; i < 5; i++) expect(decodeURIComponent(priceCalls[0].url)).toContain(`"id${i}"`);
    const badges = [...document.querySelectorAll('[data-wiky="avg"]')].map((b) => b.textContent);
    expect(badges).toEqual(['Moy. 12 W', 'Moy. 30 W', 'Moy. —', 'Moy. —', 'Moy. —']);
    // Badge juste sous le titre.
    expect(document.querySelector('h3')!.nextElementSibling!.getAttribute('data-wiky')).toBe('avg');
  });

  it('deuxième rendu : aucune mutation du DOM, aucune requête', async () => {
    mount(titles);
    stubFetch(() => [{ card_id: 'id0', final_price: 10 }]);
    const ctx = ctxWith(['priceBadges', 'wikipediaButtons', 'compactMode', 'ranking', 'premiumCards', 'hideCardStats', 'missingImages', 'copyCardImage', 'marketplacePrice'], cards);
    runFeatures(ctx);
    await flush();
    runFeatures(ctx);
    await flush();
    const n = calls.length;
    const records: MutationRecord[] = [];
    const obs = new MutationObserver((m) => records.push(...m));
    obs.observe(document.documentElement, { childList: true, subtree: true, attributes: true, characterData: true });
    runFeatures(ctx);
    await flush();
    obs.disconnect();
    expect(records).toEqual([]);
    expect(calls.length).toBe(n);
  });

  it('le prix en cache s\'affiche aussitôt après un nouveau rendu du site', async () => {
    mount(titles);
    stubFetch(() => [{ card_id: 'id0', final_price: 10 }]);
    const ctx = ctxWith(['priceBadges'], cards);
    runFeatures(ctx);
    await flush();
    mount(titles); // React redessine la grille
    runFeatures(ctx);
    expect(document.querySelector('[data-wiky="avg"]')!.textContent).toBe('Moy. 10 W');
  });
});

describe('boutons de la collection', () => {
  it('« Plus chères » et « Compact » sur la ligne du titre, avant « Sélectionner » ; compact mémorisé', () => {
    mount(['Zico']);
    runFeatures(ctxWith(['ranking', 'compactMode'], {}));
    const tools = document.querySelector('[data-wiky="coll-tools"]')!;
    expect([...tools.children].map((b) => b.textContent)).toEqual(['Plus chères', 'Étiquettes', 'Compact']);
    expect(tools.nextElementSibling!.textContent).toBe('Sélectionner');
    (tools.querySelector('[data-tool="compact"]') as HTMLButtonElement).click();
    expect(document.documentElement.hasAttribute('data-wiky-compact')).toBe(true);
    expect(localStorage.getItem('wiky-compact')).toBe('1');
    (tools.querySelector('[data-tool="compact"]') as HTMLButtonElement).click();
    expect(document.documentElement.hasAttribute('data-wiky-compact')).toBe(false);
  });

  it('bouton Wikipédia : lien vers l\'article, le clic ne remonte pas à la carte', () => {
    mount(['Tour Eiffel']);
    runFeatures(ctxWith(['wikipediaButtons'], {}));
    const a = document.querySelector<HTMLAnchorElement>('[data-wiky="wiki"]')!;
    expect(a.href).toBe('https://fr.wikipedia.org/wiki/Tour_Eiffel');
    const onCard = vi.fn();
    a.closest('div[class*="glow-"]')!.addEventListener('click', onCard);
    a.addEventListener('click', (e) => e.preventDefault());
    a.click();
    expect(onCard).not.toHaveBeenCalled();
  });
});

describe('classement « Plus chères »', () => {
  const list = [
    card('a', { name: 'Alpha', siteId: 'A', rarity: 'R', tags: ['20-50'], quantity: 2 }),
    card('b', { name: 'Bêta', siteId: 'B', rarity: 'L', favorite: true, quantity: 1 }),
    card('c', { name: 'Gamma', siteId: 'C', rarity: 'R', tags: ['20-50'], quantity: 1 }),
    card('d', { name: 'Delta', rarity: 'C', quantity: 3 }),
  ];
  const price = (median: number | null) => ({ median, mean: median, count: median == null ? 0 : 2, at: 0 });
  const prices: Record<string, ReturnType<typeof price>> = { A: price(40), B: price(300), C: price(null) };
  const priceOf = (id: string) => prices[id];

  it('trie par prix décroissant, cartes sans prix à la fin', () => {
    expect(rankCards(list, priceOf, EMPTY_FILTER).map((r) => r.card.name)).toEqual(['Bêta', 'Alpha', 'Delta', 'Gamma']);
  });

  it('filtres : rareté, étiquette, favoris, recherche (sans accents)', () => {
    expect(rankCards(list, priceOf, { ...EMPTY_FILTER, rarity: 'R' }).map((r) => r.card.id)).toEqual(['a', 'c']);
    expect(rankCards(list, priceOf, { ...EMPTY_FILTER, tag: '20-50' }).map((r) => r.card.id)).toEqual(['a', 'c']);
    expect(rankCards(list, priceOf, { ...EMPTY_FILTER, favorites: true }).map((r) => r.card.id)).toEqual(['b']);
    expect(rankCards(list, priceOf, { ...EMPTY_FILTER, q: 'beta' }).map((r) => r.card.id)).toEqual(['b']);
  });

  it('valeur de la collection = prix × exemplaires', () => {
    expect(rankTotals(rankCards(list, priceOf, EMPTY_FILTER))).toEqual({ cards: 4, copies: 7, value: 300 + 80, unpriced: 2 });
  });

  it('une requête de prix pour toute la collection ; pas de bouton « Vendre » sans l\'option', async () => {
    mount([]);
    stubFetch(() => []);
    openRanking(ctxWith(['ranking'], cardsById(...list)));
    await flush();
    expect(calls.filter((c) => c.url.includes('/auctions'))).toHaveLength(1);
    expect(document.querySelectorAll('.wiky-rk-row')).toHaveLength(4);
    expect(document.querySelector('[data-act="sell"]')).toBeNull();
    closeRanking();
    openRanking(ctxWith(['ranking', 'rankingSell'], cardsById(...list)));
    // Delta n'a pas d'identifiant du site : pas de vente possible.
    expect(document.querySelectorAll('[data-act="sell"]')).toHaveLength(3);
  });
});

describe('vente depuis le classement', () => {
  it('jamais envoyée sans l\'option', async () => {
    stubFetch(() => ({}));
    await expect(createListing({ rankingSell: false }, { siteCardId: 'card-1', amount: 30, durationMinutes: 60 })).rejects.toMatchObject({ code: 'DISABLED' });
    expect(calls).toHaveLength(0);
  });

  it('POST /api/marketplace avec l\'exemplaire libre, le prix et la durée', async () => {
    stubFetch((url) => {
      if (url.includes('/user_cards')) return [{ id: 'uc-fav', starred: true }, { id: 'uc-listed', starred: false }, { id: 'uc-free', starred: false }];
      if (url === '/api/marketplace/mine') return JSON.stringify({ auctions: [{ card_id: 'uc-listed' }] });
      return { id: 'auction-1' };
    });
    await createListing({ rankingSell: true }, { siteCardId: 'card-1', amount: 42.4, durationMinutes: 180 });
    const post = calls.find((c) => c.init?.method === 'POST')!;
    expect(post.url).toBe('/api/marketplace');
    expect(post.init!.credentials).toBe('include');
    expect((post.init!.headers as Record<string, string>)['content-type']).toBe('application/json');
    expect(JSON.parse(post.init!.body as string)).toEqual({ card_id: 'uc-free', base_amount: 42, duration_minutes: 180 });
    expect(decodeURIComponent(calls.find((c) => c.url.includes('/user_cards'))!.url)).toContain('card_id=eq.card-1');
  });

  it('choix de l\'exemplaire : jamais un exemplaire déjà en vente, favori seulement si autorisé', () => {
    expect(() => pickCopy([], '', false)).toThrow(SellError);
    expect(() => pickCopy([{ id: 'x', starred: false }], '"x"', false)).toThrow(/déjà en vente/);
    expect(() => pickCopy([{ id: 'x', starred: true }], '', false)).toThrow(/favori/);
    expect(pickCopy([{ id: 'x', starred: true }], '', true).id).toBe('x');
  });
});

describe('images manquantes', () => {
  it('50 titres par requête Wikipédia, Wikidata seulement pour ceux sans image', async () => {
    const titles = Array.from({ length: 120 }, (_, i) => `Titre ${i}`);
    stubFetch((url) => {
      const u = new URL(url);
      const asked = u.searchParams.get('titles')!.split('|');
      if (u.hostname === 'fr.wikipedia.org') {
        return { query: { pages: Object.fromEntries(asked.map((t, i) => [String(i), { title: t, ...(t.endsWith('7') ? {} : { thumbnail: { source: `https://upload.wikimedia.org/${t}.jpg` } }) }])) } };
      }
      return { entities: Object.fromEntries(asked.map((t, i) => [`Q${i}`, { sitelinks: { frwiki: { title: t } }, claims: { P18: [{ mainsnak: { datavalue: { value: `${t}.png` } } }] } }])) };
    });
    const got = await resolveImages(titles);
    const wiki = calls.filter((c) => c.url.includes('wikipedia.org'));
    expect(wiki.map((c) => new URL(c.url).searchParams.get('titles')!.split('|').length)).toEqual([50, 50, 20]);
    const wd = calls.filter((c) => c.url.includes('wikidata.org'));
    expect(wd).toHaveLength(3);
    expect(wd.flatMap((c) => new URL(c.url).searchParams.get('titles')!.split('|'))).toEqual(titles.filter((t) => t.endsWith('7')));
    expect(got.get('Titre 1')).toBe('https://upload.wikimedia.org/Titre 1.jpg');
    expect(got.get('Titre 7')).toContain('Special:FilePath/Titre_7.png');
    // Déjà en cache : aucune nouvelle requête.
    const n = calls.length;
    await resolveImages(titles.slice(0, 10));
    expect(calls.length).toBe(n);
  });

  it('remplace le logo des cartes sans illustration, en une requête pour toutes', async () => {
    mount(['Sans image', 'Autre'], () => '/_next/image?url=%2Flogo.png&w=128');
    stubFetch(() => ({ query: { normalized: [{ from: 'Sans image', to: 'Sans image' }], pages: { 1: { title: 'Sans image', thumbnail: { source: 'https://upload.wikimedia.org/x.jpg' } }, 2: { title: 'Autre', missing: '' } } } }));
    runFeatures(ctxWith(['missingImages'], {}));
    await flush();
    expect(calls.filter((c) => c.url.includes('wikipedia.org'))).toHaveLength(1);
    const img = document.querySelector<HTMLImageElement>('img[data-wiky-img]')!;
    expect(img.src).toBe('https://upload.wikimedia.org/x.jpg');
    expect(img.getAttribute('data-wiky-img')).toBe('Sans image');
  });
});

describe('prix affiché : comme le « Prix moyen » du site', () => {
  it('moyenne des ventes dans la rareté de la carte, pas la médiane ni les autres raretés', async () => {
    const { displayPrice, displayCount } = await import('../src/content/catalog');
    // Ventes 15, 20, 61 en Rare (moyenne 32, médiane 20) et 400 en Super Rare.
    const p = { median: 40, mean: 124, count: 4, at: 0, byRarity: { R: { mean: 32, count: 3 }, SR: { mean: 400, count: 1 } } };
    expect(displayPrice(p, 'R')).toBe(32);
    expect(displayCount(p, 'R')).toBe(3);
    expect(displayPrice(p, 'SR')).toBe(400);
    // Rareté inconnue ou jamais vendue dans cette rareté : moyenne toutes raretés.
    expect(displayPrice(p, null)).toBe(124);
    expect(displayPrice(p, 'UR')).toBe(124);
  });
});

describe('bandeau « Prix moyen »', () => {
  it('taux de vente après min, médiane et max', async () => {
    const { priceSummary } = await import('../src/content/features/marketplace-price');
    const p = { median: 30, mean: 32, count: 3, min: 20, max: 45, at: 0 };
    expect(priceSummary(p).meta).not.toContain('tdv');
    expect(priceSummary(p, { sold: 3, total: 100, pct: 3 }).meta).toMatch(/max <b>45<\/b> · <span title="Taux de vente[^"]*">tdv<\/span> <b>3 %<\/b> \(3\/100\)$/);
  });
});
