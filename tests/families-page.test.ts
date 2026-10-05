// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Card, CardFamily, CatalogCard } from '../src/lib/types';
import { card, cardsById, input } from './helpers';

const storage = vi.hoisted(() => {
  const data: Record<string, unknown> = {};
  (globalThis as unknown as { chrome: unknown }).chrome = {
    runtime: { getURL: (p: string) => `chrome-extension://wiky/${p}` },
    storage: {
      local: {
        get: async (keys: string[] | string) => Object.fromEntries([keys].flat().filter((k) => k in data).map((k) => [k, structuredClone(data[k])])),
        set: async (patch: Record<string, unknown>) => void Object.assign(data, structuredClone(patch)),
      },
      onChanged: { addListener: () => undefined },
    },
  };
  return data;
});

const { renderSiteUi } = await import('../src/content/site-ui');
const { makeContext, runFeatures } = await import('../src/content/features/runtime');
await import('../src/content/features');
const { resetFamiliesPage } = await import('../src/content/features/families-page');
const { resetFamiliesState, getFamilies, ensureImported } = await import('../src/content/features/families-state');
const { activeAuctionsFor, resetCatalog } = await import('../src/content/catalog');
const { DEFAULT_META } = await import('../src/lib/defaults');

const NAV = readFileSync(resolve(import.meta.dirname, 'fixtures/site-nav.html'), 'utf8');
const cc = (siteId: string, title: string, over: Partial<CatalogCard> = {}): CatalogCard => ({ siteId, title, rarity: 'R', category: 'cat', imageUrl: `https://img/${siteId}.jpg`, wikipediaUrl: null, atk: null, def: null, ...over });
const fam = (id: string, name: string, cards: CatalogCard[], over: Partial<CardFamily> = {}): CardFamily => ({ id, name, color: '#3b82f6', cards, coverSiteId: null, createdAt: 1, updatedAt: 1, ...over });

function siteStore(families: CardFamily[], cards: Record<string, Card> = {}) {
  return { ...input({ cards }), meta: { ...DEFAULT_META }, bidsCache: null, myFamilies: families };
}

/** Une relecture de la page, comme drawSiteUi() : barre latérale puis modules. */
function scan(families: CardFamily[], cards: Record<string, Card> = {}, apiRead = false): void {
  const s = siteStore(families, cards);
  s.settings.apiRead = apiRead;
  renderSiteUi(s, { refresh: () => undefined });
  runFeatures(makeContext(s.settings, cards, families));
}

const REF = 'abcdefghijklmnop';
const b64 = (s: string) => Buffer.from(s).toString('base64').replace(/=+$/, '');
const jwt = (p: object) => `${b64('{"alg":"HS256"}')}.${b64(JSON.stringify(p))}.sig`;

/** API du site simulée : `rows(url)` répond aux requêtes REST ; renvoie les adresses appelées. */
function stubApi(rows: (url: string) => unknown[]): string[] {
  document.cookie = `sb-${REF}-auth-token=${encodeURIComponent(JSON.stringify({ access_token: jwt({ sub: 'me', exp: 9_999_999_999 }) }))}`;
  document.head.innerHTML = '<script src="https://www.wiki-masters.com/_next/static/chunks/app.js"></script>';
  const calls: string[] = [];
  vi.stubGlobal('fetch', async (url: string) => {
    if (url.includes('/_next/')) return new Response(`u="https://${REF}.supabase.co";k="${jwt({ role: 'anon', ref: REF })}"`);
    calls.push(decodeURIComponent(url));
    return new Response(JSON.stringify(rows(decodeURIComponent(url))));
  });
  return calls;
}

const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  for (const k of Object.keys(storage)) delete storage[k];
  storage.familiesImportedAt = 1;
  sessionStorage.clear();
  resetFamiliesPage();
  resetFamiliesState();
  resetCatalog();
  sessionStorage.clear();
  localStorage.clear();
  document.documentElement.removeAttribute('data-wiky-route');
  document.body.innerHTML = `<div class="flex">${NAV}<main><div class="flex-1"><h1>Collection</h1></div></main></div>`;
  history.replaceState(null, '', '/collection?wiky=families');
});

afterEach(() => vi.unstubAllGlobals());

describe('page Familles dans le site', () => {
  it('entrée « Familles » dans le menu Wiky-Traders, page native (pas d\'iframe)', () => {
    scan([fam('f1', 'Rois', [cc('c1', 'Louis XIV')])]);
    const link = document.querySelector<HTMLAnchorElement>('[data-group="collection"] a[href="/collection?wiky=families"]')!;
    expect(link.textContent).toContain('Familles');
    expect(link.className).toContain('is-active');
    const page = document.getElementById('wiky-page')!;
    expect(page.querySelector('iframe')).toBeNull();
    expect(page.querySelector('[data-wiky-mount="families"] .wf')).not.toBeNull();
  });

  it('accueil : tuiles avec possession, progression ; recherche', () => {
    const mine = cardsById(card('louis', { name: 'Louis XIV', siteId: 'c1', quantity: 2 }));
    const list = [fam('f1', 'Rois', [cc('c1', 'Louis XIV'), cc('c2', 'Henri IV')]), fam('f2', 'Peintres', [cc('p1', 'Monet')])];
    scan(list, mine);
    const tiles = [...document.querySelectorAll<HTMLElement>('.wf-tile')];
    // Modifiées récemment, puis par nom.
    expect(tiles.map((t) => t.querySelector('.wf-tile-name')!.textContent)).toEqual(['Peintres', 'Rois']);
    expect(tiles[1].textContent).toContain('1/2 possédées');
    expect(tiles[1].textContent).toContain('50%');
    expect(tiles[0].textContent).toContain('0/1 possédées');
    const search = document.querySelector<HTMLInputElement>('[data-in="homeQuery"]')!;
    search.value = 'pein';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    expect([...document.querySelectorAll('.wf-tile-name')].map((t) => t.textContent)).toEqual(['Peintres']);
  });

  it('relecture sans changement : aucune mutation', async () => {
    const list = [fam('f1', 'Rois', [cc('c1', 'Louis XIV')])];
    scan(list);
    const records: MutationRecord[] = [];
    const obs = new MutationObserver((r) => records.push(...r));
    obs.observe(document.getElementById('wiky-page')!, { childList: true, subtree: true, attributes: true });
    scan(list.map((f) => ({ ...f })));
    scan(list);
    await Promise.resolve();
    obs.disconnect();
    expect(records).toHaveLength(0);
  });

  it('détail : filtres Possédées / Manquantes, renommage sur place, retrait d\'une carte', async () => {
    const mine = cardsById(card('louis', { name: 'Louis XIV', siteId: 'c1', quantity: 3 }));
    scan([fam('f1', 'Rois', [cc('c1', 'Louis XIV'), cc('c2', 'Henri IV'), cc('c3', 'Clovis', { rarity: 'L' })])], mine);
    document.querySelector<HTMLElement>('.wf-tile')!.click();
    await flush();
    const cards = () => [...document.querySelectorAll<HTMLElement>('.wf-grid .wf-card')];
    expect(cards()).toHaveLength(3);
    expect(cards()[0].dataset.id).toBe('c1');
    expect(cards()[0].querySelector('.wf-own')!.textContent).toBe('×3');
    expect(cards()[1].classList.contains('missing')).toBe(true);
    document.querySelector<HTMLElement>('[data-filter="missing"]')!.click();
    await flush();
    expect(cards().map((c) => c.dataset.id)).toEqual(['c3', 'c2']);

    const name = document.querySelector<HTMLInputElement>('[data-name]')!;
    expect(name.value).toBe('Rois');
    name.value = 'Rois de France';
    name.dispatchEvent(new Event('change', { bubbles: true }));
    await flush();
    expect(getFamilies()[0].name).toBe('Rois de France');
    expect((storage.myFamilies as CardFamily[])[0].name).toBe('Rois de France');

    cards()[0].querySelector<HTMLElement>('[data-act="remove"]')!.click();
    await flush();
    expect(getFamilies()[0].cards.map((c) => c.siteId)).toEqual(['c1', 'c2']);
    expect(document.querySelector('[data-wiky="toast"][data-id="notice"]')!.textContent).toContain('retirée');
  });

  it('suppression : confirmation dans le style du site (pas window.confirm)', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm');
    scan([fam('f1', 'Rois', [cc('c1', 'Louis XIV')])]);
    document.querySelector<HTMLElement>('.wf-tile')!.click();
    await flush();
    document.querySelector<HTMLElement>('[data-act="delete"]')!.click();
    await flush();
    const dialog = document.querySelector<HTMLElement>('[data-wiky="fam-dialog"]')!;
    expect(dialog.textContent).toContain('Supprimer « Rois »');
    dialog.querySelector<HTMLElement>('[data-r="1"]')!.click();
    await flush();
    await flush();
    expect(getFamilies()).toEqual([]);
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it('grande famille (600 cartes) : premier rendu rapide, le reste par lots', async () => {
    const big = fam('big', 'Grande', Array.from({ length: 600 }, (_, i) => cc(`id${i}`, `Carte ${String(i).padStart(3, '0')}`)));
    sessionStorage.setItem('wiky-families-ui', JSON.stringify({ familyId: 'big' }));
    resetFamiliesPage();
    const t0 = performance.now();
    scan([big]);
    const ms = performance.now() - t0;
    const first = document.querySelectorAll('.wf-grid .wf-card').length;
    expect(first).toBeLessThan(600);
    expect(first).toBeGreaterThan(0);
    // jsdom est bien plus lent qu'un navigateur : marge large, l'important est de ne pas tout poser d'un coup.
    expect(ms).toBeLessThan(1500);
    for (let i = 0; i < 10; i++) await new Promise((r) => requestAnimationFrame(() => r(null)));
    expect(document.querySelectorAll('.wf-grid .wf-card')).toHaveLength(600);
    expect(document.querySelector('.wf-grid img')!.getAttribute('loading')).toBe('lazy');
  });
});

describe('ajout rapide de cartes', () => {
  it('recherche au fil de la frappe (une requête après la pause), sélection multiple, Maj+clic, « Ajouter N cartes »', async () => {
    const row = (i: number) => ({ id: `s${i}`, wikipedia_title: `Roi ${i}`, rarity: 'R', category: 'roi de France', image_url: null, wikipedia_url: null, atk: 1, def: 1 });
    const calls = stubApi((url) => (url.includes('/cards?') ? [0, 1, 2, 3, 4].map(row) : []));
    sessionStorage.setItem('wiky-families-ui', JSON.stringify({ familyId: 'f1', addOpen: true }));
    resetFamiliesPage();
    scan([fam('f1', 'Rois', [cc('s1', 'Roi 1')])], {}, true);
    const input = document.querySelector<HTMLInputElement>('.wf-add input[type="search"]')!;
    for (const v of ['r', 'ro', 'roi']) {
      input.value = v;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
    await new Promise((r) => setTimeout(r, 260));
    await flush();
    const searches = calls.filter((u) => u.includes('/cards?'));
    expect(searches).toHaveLength(1);
    expect(searches[0]).toContain('ilike.*roi*');
    // « Roi 1 » est déjà dans la famille : masquée.
    const rows = () => [...document.querySelectorAll<HTMLElement>('.wf-res')];
    expect(rows().map((r) => r.dataset.id)).toEqual(['s0', 's2', 's3', 's4']);
    rows()[0].click();
    rows()[2].dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true }));
    expect(rows().filter((r) => r.classList.contains('sel')).map((r) => r.dataset.id)).toEqual(['s0', 's2', 's3']);
    const go = document.querySelector<HTMLButtonElement>('[data-add="go"]')!;
    expect(go.textContent).toBe('Ajouter 3 cartes');
    go.click();
    await flush();
    expect(getFamilies()[0].cards.map((c) => c.siteId)).toEqual(['s1', 's0', 's2', 's3']);
  });
});

describe('import au premier passage', () => {
  it('importe wm_families_v1 une seule fois', async () => {
    delete storage.familiesImportedAt;
    localStorage.setItem('wm_families_v1', JSON.stringify([{ id: 'x', name: 'Rois', coverCardId: 'c1', cards: [{ id: 'c1', title: 'Louis XIV', rarity: 'UR' }] }]));
    await ensureImported();
    expect((storage.myFamilies as CardFamily[]).map((f) => [f.name, f.coverSiteId, f.cards.length])).toEqual([['Rois', 'c1', 1]]);
    expect(storage.familiesImportedAt).toEqual(expect.any(Number));
    expect(getFamilies()).toHaveLength(1);
  });
});

describe('collection en mode sélection', () => {
  it('bouton « Ajouter à une famille » dans la barre d\'actions du site, avant « Défausser »', () => {
    history.replaceState(null, '', '/collection');
    document.querySelector('main')!.innerHTML = `<div><h1>Collection</h1><button>Quitter la sélection</button></div>`;
    document.body.insertAdjacentHTML('beforeend', `<div class="fixed bottom-4 card-frame"><div><div><span class="font-semibold">2</span><span>cartes sélectionnées</span></div>
      <div class="ml-auto"><button>Tout sélectionner (page)</button><button class="inline-flex px-3 rounded-lg">Étiqueter</button><button>Défausser (+2)</button></div></div></div>`);
    scan([]);
    const btn = document.querySelector<HTMLElement>('[data-wiky="fam-sitebtn"]')!;
    expect(btn.textContent).toContain('Ajouter à une famille');
    expect(btn.className).toBe('inline-flex px-3 rounded-lg');
    expect(btn.nextElementSibling!.textContent).toContain('Défausser');
    scan([]);
    expect(document.querySelectorAll('[data-wiky="fam-sitebtn"]')).toHaveLength(1);
  });
});

describe('marché des manquantes', () => {
  it('une requête par lot de 150 cartes, groupée par carte, la moins chère d\'abord', async () => {
    const REF = 'abcdefghijklmnop';
    const b64 = (s: string) => Buffer.from(s).toString('base64').replace(/=+$/, '');
    const jwt = (p: object) => `${b64('{"alg":"HS256"}')}.${b64(JSON.stringify(p))}.sig`;
    document.cookie = `sb-${REF}-auth-token=${encodeURIComponent(JSON.stringify({ access_token: jwt({ sub: 'me', exp: 9_999_999_999 }) }))}`;
    document.head.innerHTML = '<script src="https://www.wiki-masters.com/_next/static/chunks/app.js"></script>';
    const future = new Date(Date.now() + 3_600_000).toISOString();
    const calls: string[] = [];
    vi.stubGlobal('fetch', async (url: string) => {
      if (url.includes('/_next/')) return new Response(`u="https://${REF}.supabase.co";k="${jwt({ role: 'anon', ref: REF })}"`);
      calls.push(url);
      const rows = url.includes('"c1"')
        ? [
            { id: 'a2', card_id: 'c1', base_amount: 30, current_bid: 45, end_at: future, is_shiny: false, status: 'active' },
            { id: 'a1', card_id: 'c1', base_amount: 20, current_bid: null, end_at: future, is_shiny: true, status: 'active' },
            { id: 'old', card_id: 'c2', base_amount: 1, current_bid: null, end_at: new Date(Date.now() - 1000).toISOString(), is_shiny: false, status: 'active' },
          ]
        : [];
      return new Response(JSON.stringify(rows));
    });
    const ids = ['c1', 'c2', ...Array.from({ length: 200 }, (_, i) => `x${i}`)];
    const res = await activeAuctionsFor(ids);
    expect(calls).toHaveLength(2);
    expect(calls.every((u) => u.includes('status=eq.active') && u.includes('card_id=in.('))).toBe(true);
    expect(res.get('c1')!.map((a) => [a.id, a.price, a.hasBid, a.shiny])).toEqual([['a1', 20, false, true], ['a2', 45, true, false]]);
    expect(res.has('c2')).toBe(false);
  });
});
