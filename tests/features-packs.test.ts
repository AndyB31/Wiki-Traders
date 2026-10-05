// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../src/lib/defaults';
import type { Settings } from '../src/lib/types';

const storage = vi.hoisted(() => {
  const data: Record<string, unknown> = {};
  (globalThis as unknown as { chrome: unknown }).chrome = {
    runtime: { getURL: (p: string) => `chrome-extension://wiky/${p}` },
    storage: {
      local: {
        get: async (keys: string | string[]) => Object.fromEntries((Array.isArray(keys) ? keys : [keys]).filter((k) => k in data).map((k) => [k, structuredClone(data[k])])),
        set: async (o: Record<string, unknown>) => void Object.assign(data, structuredClone(o)),
        clear: async () => void Object.keys(data).forEach((k) => delete data[k]),
      },
      onChanged: { addListener: () => {} },
    },
  };
  return data;
});

const { addPulls, buildRecap, emptyPullStats, loadPullStats, mapPackCards, normalizeBounds, openPackRequest, pullShares, randomDelay, recordPulls } = await import('../src/content/features/packs-logic');
const { autoTick, openAllPacks, showRecap } = await import('../src/content/features/packs');
const { resetCatalog } = await import('../src/content/catalog');

const b64url = (s: string) => Buffer.from(s).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const jwt = (payload: object) => `${b64url('{"alg":"HS256"}')}.${b64url(JSON.stringify(payload))}.sig`;
const REF = 'abcdefghijklmnop';
const ANON = jwt({ role: 'anon', ref: REF });

/** Réponse d'ouverture relevée par « Prix moyen collection ». */
const PACK = {
  cards: [
    { id: 'c1', wikipedia_title: 'Victor Hugo', rarity: 'SR', image_url: 'https://img/hugo.jpg', wikipedia_url: 'https://fr.wikipedia.org/wiki/Victor_Hugo' },
    { id: 'c2', wikipedia_title: 'Paris', rarity: 'C', image_url: null },
    { id: 'c3', wikipedia_title: 'Lune', rarity: 'R' },
    { id: 'c2', wikipedia_title: 'Paris', rarity: 'C' },
    { wikipedia_title: 'sans id' },
  ],
  packs_remaining: 3,
};

function setSettings(features: Settings['features'], apiRead = true): void {
  storage.settings = { ...DEFAULT_SETTINGS, apiRead, features };
}

beforeEach(() => {
  for (const k of Object.keys(storage)) delete storage[k];
  document.body.innerHTML = '';
  resetCatalog();
});
afterEach(() => vi.unstubAllGlobals());

describe('réponse d\'ouverture de paquet', () => {
  it('lit les cartes obtenues et ignore les lignes incomplètes', () => {
    const cards = mapPackCards(PACK);
    expect(cards.map((c) => [c.siteId, c.title, c.rarity])).toEqual([
      ['c1', 'Victor Hugo', 'SR'],
      ['c2', 'Paris', 'C'],
      ['c3', 'Lune', 'R'],
      ['c2', 'Paris', 'C'],
    ]);
    expect(cards[0].imageUrl).toBe('https://img/hugo.jpg');
    expect(mapPackCards({ error: 'x' })).toEqual([]);
  });

  it('récapitulatif : prix moyens, déjà possédée, doublon, total et tri par prix', () => {
    const cards = mapPackCards(PACK);
    const prices = new Map([
      ['c1', { median: 120, mean: 120, count: 4, at: 0 }],
      ['c2', { median: 8, mean: 8, count: 2, at: 0 }],
      ['c3', { median: null, mean: null, count: 0, at: 0 }],
    ]);
    const recap = buildRecap(cards, prices, (c) => (c.siteId === 'c1' ? 2 : 0));
    expect(recap.rows.map((r) => [r.title, r.price, r.ownedBefore, r.repeat])).toEqual([
      ['Victor Hugo', 120, 2, false],
      ['Paris', 8, 0, false],
      ['Paris', 8, 0, true],
      ['Lune', null, 0, false],
    ]);
    expect(recap.total).toBe(136);
    expect(recap.priced).toBe(3);
    // Nouvelles : Paris (une fois) et Lune.
    expect(recap.fresh).toBe(2);
  });

  it('panneau récapitulatif : prix de toutes les cartes en UNE requête groupée', async () => {
    document.cookie = `sb-${REF}-auth-token=${encodeURIComponent(JSON.stringify({ access_token: jwt({ sub: 'me', exp: 9_999_999_999 }) }))}`;
    document.head.innerHTML = `<script src="https://www.wiki-masters.com/_next/static/chunks/app.js"></script>`;
    const calls: string[] = [];
    vi.stubGlobal('fetch', async (url: string) => {
      calls.push(url);
      if (url.includes('/_next/')) return new Response(`u="https://${REF}.supabase.co";k="${ANON}"`);
      return new Response(JSON.stringify([
        { card_id: 'c1', final_price: 100 },
        { card_id: 'c1', final_price: 140 },
        { card_id: 'c2', final_price: 8 },
      ]));
    });
    const cards = mapPackCards(PACK);
    await showRecap({ cards, packs: 1, at: 1, title: '4 cartes obtenues', owned: new Map([['id:c1', 1]]) }, true);
    const priceCalls = calls.filter((u) => u.includes('/rest/v1/auctions'));
    expect(priceCalls).toHaveLength(1);
    expect(decodeURIComponent(priceCalls[0])).toContain('card_id=in.("c1","c2","c3")');
    const panel = document.querySelector('[data-wiky="pack-recap"]')!;
    expect(panel.textContent).toContain('Victor Hugo');
    expect(panel.textContent).toContain('120 W');
    expect(panel.textContent).toContain('Nouvelle');
    expect(panel.querySelector('.wiky-f-foot b')!.textContent).toBe('136 W');
  });
});

describe('statistiques de tirage', () => {
  it('cumule les raretés et les paquets', () => {
    let s = emptyPullStats(0);
    s = addPulls(s, mapPackCards(PACK), 1, 1);
    s = addPulls(s, [{ rarity: 'L' }, { rarity: null }], 1, 2);
    expect(s.counts).toEqual({ C: 2, PC: 0, R: 1, SR: 1, UR: 0, L: 1 });
    expect(s.total).toBe(5);
    expect(s.packs).toBe(2);
    expect(pullShares(s).find((r) => r.rarity === 'C')!.pct).toBe(40);
  });

  it('enregistre dans le stockage de l\'extension, sans perdre de tirage rapproché', async () => {
    const cards = mapPackCards(PACK);
    await Promise.all([recordPulls(cards), recordPulls(cards.slice(0, 1))]);
    const s = await loadPullStats();
    expect(s.total).toBe(5);
    expect(s.packs).toBe(2);
    expect((storage.pullStats as { counts: Record<string, number> }).counts.SR).toBe(2);
  });
});

describe('ouvrir tous les paquets', () => {
  function packFetch(sequence: { status: number; body: unknown }[]) {
    const calls: { url: string; init?: RequestInit }[] = [];
    const impl = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      const r = sequence[Math.min(calls.length - 1, sequence.length - 1)];
      return new Response(JSON.stringify(r.body), { status: r.status, headers: { 'content-type': 'application/json' } });
    });
    return { impl: impl as unknown as typeof fetch, calls };
  }

  it('ne fait rien si l\'option est désactivée', async () => {
    setSettings({ openAllPacks: false });
    const { impl, calls } = packFetch([{ status: 200, body: PACK }]);
    expect(await openAllPacks({ fetchImpl: impl, pause: () => 0 })).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it('ouvre les paquets un par un avec la requête du site, jusqu\'au dernier', async () => {
    setSettings({ openAllPacks: true }, false);
    const { impl, calls } = packFetch([
      { status: 200, body: { ...PACK, packs_remaining: 1 } },
      { status: 200, body: { cards: [{ id: 'c9', wikipedia_title: 'Mars', rarity: 'UR' }], packs_remaining: 0 } },
      { status: 400, body: { error: 'Aucun paquet', packs_remaining: 0 } },
    ]);
    const result = await openAllPacks({ fetchImpl: impl, pause: () => 0 });
    expect(result).toMatchObject({ opened: 2, remaining: 0, error: null, cancelled: false });
    expect(result!.cards).toHaveLength(5);
    expect(calls).toHaveLength(2);
    expect(calls[0].url).toBe('/api/packs/open');
    expect(calls[0].init).toMatchObject({ method: 'POST', credentials: 'include' });
    expect(openPackRequest()[1].body).toBeUndefined();
    // Récapitulatif de tout ce qui a été obtenu, et statistiques.
    expect(document.querySelector('[data-wiky="pack-recap"]')!.textContent).toContain('Mars');
    await vi.waitFor(async () => expect((await loadPullStats()).packs).toBe(2));
  });

  it('s\'arrête sur une erreur du site sans réessayer', async () => {
    setSettings({ openAllPacks: true }, false);
    const { impl, calls } = packFetch([{ status: 429, body: { rate_limit_daily: true } }]);
    const result = await openAllPacks({ fetchImpl: impl, pause: () => 0 });
    expect(result).toMatchObject({ opened: 0, error: 'Limite quotidienne atteinte.' });
    expect(calls).toHaveLength(1);
  });

  it('ouverture automatique : rien ne part si l\'option est coupée ; sinon un cycle à l\'heure prévue', async () => {
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    storage.autoOpenPacks = { on: true, min: 1, max: 2, nextAt: 0, lastRun: null };
    setSettings({ autoOpenPacks: false });
    const off = packFetch([{ status: 200, body: { ...PACK, packs_remaining: 0 } }]);
    await autoTick(Date.now(), off.impl);
    expect(off.calls).toHaveLength(0);

    setSettings({ autoOpenPacks: true }, false);
    const on = packFetch([{ status: 200, body: { ...PACK, packs_remaining: 0 } }]);
    await autoTick(Date.now(), on.impl);
    expect(on.calls).toHaveLength(1);
    const state = storage.autoOpenPacks as { nextAt: number; lastRun: { opened: number } };
    expect(state.nextAt).toBeGreaterThan(Date.now());
    expect(state.lastRun.opened).toBe(1);
  });

  it('délai aléatoire entre les bornes, bornes remises dans l\'ordre', () => {
    expect(normalizeBounds('90', 30)).toEqual({ min: 30, max: 90 });
    expect(normalizeBounds('', 0)).toEqual({ min: 1, max: 30 });
    expect(randomDelay(10, 20, () => 0)).toBe(10 * 60_000);
    expect(randomDelay(10, 20, () => 1)).toBe(20 * 60_000);
  });
});

describe('statistiques de tirage : import et ouverture', () => {
  it('import depuis une autre extension : plus grand compteur par rareté (pas de double comptage)', async () => {
    const { readOtherPullStats, mergePullStats, emptyPullStats } = await import('../src/content/features/packs-logic');
    expect(readOtherPullStats(null)).toBeNull();
    expect(readOtherPullStats('{"counts":{"C":0}}')).toBeNull();
    const other = readOtherPullStats(JSON.stringify({ counts: { C: 120, PC: 40, R: 12, SR: 3, UR: 1, L: 0 } }))!;
    const ours = { ...emptyPullStats(0), counts: { C: 20, PC: 50, R: 2, SR: 0, UR: 0, L: 1 }, total: 73, packs: 9 };
    const merged = mergePullStats(ours, other, 1);
    expect(merged.counts).toEqual({ C: 120, PC: 50, R: 12, SR: 3, UR: 1, L: 1 });
    expect(merged.total).toBe(187);
    expect(merged.packs).toBe(9);
  });
});
