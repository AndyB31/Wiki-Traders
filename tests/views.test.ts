// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_META, DEFAULT_SETTINGS } from '../src/lib/defaults';
import { FEATURES, type FeatureFlags } from '../src/lib/features';
import { migrateSettings } from '../src/lib/storage';
import type { Card, Settings } from '../src/lib/types';
import { applyView, EMPTY_VIEW_FILTER, matchesView, newView, normalizeView, viewSummary, type CollectionView, type ViewContext } from '../src/lib/views';
import { card, cardsById, input } from './helpers';

vi.hoisted(() => {
  (globalThis as unknown as { chrome: unknown }).chrome = {
    runtime: { getURL: (p: string) => `chrome-extension://wiky/${p}` },
    storage: { local: { get: async () => ({}), set: async () => {} }, onChanged: { addListener: () => {} } },
  };
});

const { makeContext, runFeatures } = await import('../src/content/features/runtime');
await import('../src/content/features');
const { renderSiteUi, siteNav } = await import('../src/content/site-ui');

const prices: Record<string, number> = { Zola: 80, Balzac: 15, Hugo: 40, Molière: 300 };
const vctx: ViewContext = { price: (c) => prices[c.name] ?? null, families: (c) => (c.name === 'Hugo' ? ['Écrivains'] : []) };

const CARDS: Card[] = [
  card('zola', { name: 'Zola', tags: ['10-100'], category: 'écrivain', rarity: 'SR', quantity: 1 }),
  card('balzac', { name: 'Balzac', tags: ['10-100', 'Garder'], rarity: 'C', quantity: 3, favorite: true }),
  card('hugo', { name: 'Hugo', tags: [], rarity: 'L', quantity: 1, shiny: true }),
  card('moliere', { name: 'Molière', tags: ['100+'], category: 'dramaturge', rarity: 'UR', quantity: 2 }),
];

function view(over: Partial<CollectionView> = {}, filter: Partial<CollectionView['filter']> = {}): CollectionView {
  return { ...newView('v1', '10-100 A→Z'), ...over, filter: { ...EMPTY_VIEW_FILTER, ...filter } };
}

const names = (list: Card[]) => list.map((c) => c.name);

describe('vues de la collection : filtre et tri', () => {
  it('« 10-100 A→Z » : seulement l\'étiquette 10-100, par nom', () => {
    expect(names(applyView(CARDS, view({}, { tags: ['10-100'] }), vctx))).toEqual(['Balzac', 'Zola']);
    expect(names(applyView(CARDS, view({ dir: 'desc' }, { tags: ['10-100'] }), vctx))).toEqual(['Zola', 'Balzac']);
  });

  it('étiquettes : au moins une / toutes / exclues / sans étiquette (sans tenir compte des majuscules)', () => {
    expect(names(applyView(CARDS, view({}, { tags: ['10-100', '100+'] }), vctx))).toEqual(['Balzac', 'Molière', 'Zola']);
    expect(names(applyView(CARDS, view({}, { tags: ['10-100', 'garder'], tagMode: 'all' }), vctx))).toEqual(['Balzac']);
    expect(names(applyView(CARDS, view({}, { excludeTags: ['Garder'] }), vctx))).toEqual(['Hugo', 'Molière', 'Zola']);
    expect(names(applyView(CARDS, view({}, { untagged: true }), vctx))).toEqual(['Hugo']);
  });

  it('nom ou catégorie, rareté, favoris, brillantes, famille, exemplaires, prix', () => {
    expect(names(applyView(CARDS, view({}, { q: 'ecrivain, moliere' }), vctx))).toEqual(['Molière', 'Zola']);
    expect(names(applyView(CARDS, view({}, { rarities: ['UR', 'L'] }), vctx))).toEqual(['Hugo', 'Molière']);
    expect(names(applyView(CARDS, view({}, { favorite: 'yes' }), vctx))).toEqual(['Balzac']);
    expect(names(applyView(CARDS, view({}, { shiny: 'no' }), vctx))).toEqual(['Balzac', 'Molière', 'Zola']);
    expect(names(applyView(CARDS, view({}, { family: 'écrivains' }), vctx))).toEqual(['Hugo']);
    expect(names(applyView(CARDS, view({}, { minQty: 2 }), vctx))).toEqual(['Balzac', 'Molière']);
    expect(names(applyView(CARDS, view({}, { minPrice: 20, maxPrice: 100 }), vctx))).toEqual(['Hugo', 'Zola']);
  });

  it('tri par prix, valeur, rareté, exemplaires ; valeur inconnue toujours à la fin', () => {
    const noPrice = card('x', { name: 'Aaa' });
    expect(names(applyView([...CARDS, noPrice], view({ sort: 'price', dir: 'desc' }), vctx))).toEqual(['Molière', 'Zola', 'Hugo', 'Balzac', 'Aaa']);
    expect(names(applyView([...CARDS, noPrice], view({ sort: 'price', dir: 'asc' }), vctx))).toEqual(['Balzac', 'Hugo', 'Zola', 'Molière', 'Aaa']);
    expect(names(applyView(CARDS, view({ sort: 'total', dir: 'desc' }), vctx))).toEqual(['Molière', 'Zola', 'Balzac', 'Hugo']);
    expect(names(applyView(CARDS, view({ sort: 'rarity', dir: 'desc' }), vctx))).toEqual(['Hugo', 'Molière', 'Zola', 'Balzac']);
    expect(names(applyView(CARDS, view({ sort: 'quantity', dir: 'desc' }), vctx))).toEqual(['Balzac', 'Molière', 'Hugo', 'Zola']);
  });

  it('résumé lisible, et vues anciennes ou incomplètes complétées', () => {
    expect(viewSummary(view({}, { tags: ['10-100'] }))).toBe('Étiquette 10-100 · Nom A → Z');
    expect(viewSummary(view({ sort: 'price', dir: 'desc' }, { rarities: ['L'], minPrice: 10 }))).toBe('Légendaire · ≥ 10 W · Prix moyen plus chère d\'abord');
    const v = normalizeView({ id: 'a', name: 'X', sort: 'bad' as never, filter: { tags: ['t'] } as never });
    expect(v.sort).toBe('name');
    expect(v.filter.rarities).toEqual([]);
    expect(matchesView(CARDS[0], v.filter, vctx)).toBe(false);
    const s = migrateSettings({ collectionViews: [{ id: 'a', name: 'A' }, null] } as unknown as Partial<Settings>);
    expect(s.collectionViews).toHaveLength(1);
    expect(s.collectionViews[0].filter.tagMode).toBe('any');
    expect(migrateSettings(undefined).collectionViews).toEqual([]);
  });
});

/** Carte du site (même structure que /collection). */
function nativeCard(title: string, rarity = 'r') {
  return `<div class="relative isolate group"><div class="glow-${rarity} relative rounded-2xl overflow-hidden"><img alt="${title}" src="/x.jpg">
    <div class="absolute top-[45%]"><h3>${title}</h3><p>catégorie</p></div></div></div>`;
}

function mountCollection(titles: string[]) {
  document.body.innerHTML = `<main><div class="flex-1"><div class="flex items-center"><h1>Collection</h1></div><div class="grid">${titles.map((t) => nativeCard(t)).join('')}</div></div></main>`;
}

function settingsWith(views: CollectionView[]): Settings {
  const features = Object.fromEntries(FEATURES.map((f) => [f.key, false])) as FeatureFlags;
  return { ...DEFAULT_SETTINGS, apiRead: false, features, collectionViews: views };
}

const cells = () => [...document.querySelectorAll<HTMLElement>('.grid > .group')];
const visible = () =>
  cells()
    .filter((c) => !c.hasAttribute('data-wiky-vhide'))
    .sort((a, b) => Number(a.style.order) - Number(b.style.order))
    .map((c) => c.querySelector('h3')!.textContent);

describe('vue appliquée à la collection du site', () => {
  beforeEach(() => mountCollection(['Zola', 'Molière', 'Balzac', 'Hugo']));

  it('/collection?wview= : masque les autres cartes, ordonne celles de la vue, bandeau ; sans vue : page intacte', () => {
    const v = view({}, { tags: ['10-100'] });
    history.replaceState(null, '', `/collection?wview=${v.id}`);
    runFeatures(makeContext(settingsWith([v]), cardsById(...CARDS), []));
    expect(visible()).toEqual(['Balzac', 'Zola']);
    const bar = document.querySelector('[data-wiky="view-bar"]')!;
    expect(bar.nextElementSibling).toBe(document.querySelector('.grid'));
    expect(bar.textContent).toContain('10-100 A→Z');
    expect(bar.textContent).toContain('2 cartes sur 4 affichées');

    // « Quitter la vue » : retour à la collection complète, sur place.
    bar.querySelector<HTMLButtonElement>('[data-act="quit"]')!.click();
    expect(location.search).toBe('');
    expect(document.querySelectorAll('[data-wiky-vhide], [data-wiky-vorder], [data-wiky="view-bar"]')).toHaveLength(0);
  });

  it('signale les cartes de la vue qui ne sont pas sur la page', () => {
    mountCollection(['Zola', 'Hugo']);
    const v = view({}, { tags: ['10-100'] });
    history.replaceState(null, '', `/collection?wview=${v.id}`);
    runFeatures(makeContext(settingsWith([v]), cardsById(...CARDS), []));
    expect(visible()).toEqual(['Zola']);
    expect(document.querySelector('[data-wiky="view-bar"]')!.textContent).toContain('1 autre carte de ta collection correspond');
  });

  it('vue inconnue ou aucune vue : rien n\'est touché', () => {
    history.replaceState(null, '', '/collection?wview=nope');
    runFeatures(makeContext(settingsWith([view()]), cardsById(...CARDS), []));
    expect(visible()).toHaveLength(4);
    expect(document.querySelector('[data-wiky="view-bar"]')).toBeNull();
  });
});

describe('vues dans la barre latérale', () => {
  const NAV = readFileSync(resolve(import.meta.dirname, 'fixtures/site-nav.html'), 'utf8');
  const store = (views: CollectionView[], over: Partial<Settings> = {}) => ({ ...input({ settings: { ...input().settings, collectionViews: views, ...over } }), meta: DEFAULT_META, bidsCache: null });

  beforeEach(() => {
    document.body.innerHTML = `<div class="flex">${NAV}<main><h1>Collection</h1></main></div>`;
    history.replaceState(null, '', '/collection');
    localStorage.clear();
  });

  it('sous « Ma collection » dans le menu Collection ; seulement les vues affichées ; active quand ouverte', () => {
    const views = [view({ id: 'a', name: '10-100 A→Z' }), view({ id: 'b', name: 'Cachée', active: false }), view({ id: 'c', name: 'Légendaires' })];
    renderSiteUi(store(views), { refresh: () => {} });
    const items = [...siteNav()!.querySelectorAll('[data-group="collection"] .wiky-group-items > *')].map((a) => a.textContent!.trim());
    expect(items.slice(0, 3)).toEqual(['Ma collection', '10-100 A→Z', 'Légendaires']);
    expect(siteNav()!.querySelector<HTMLAnchorElement>('[data-wiky-view-id="a"]')!.getAttribute('href')).toBe('/collection?wview=a');

    // Clic : on reste sur la collection, l'adresse porte la vue et l'entrée devient active.
    siteNav()!.querySelector<HTMLAnchorElement>('[data-wiky-view-id="c"]')!.click();
    expect(location.search).toBe('?wview=c');
    expect(siteNav()!.querySelector('[data-wiky-view-id="c"]')!.classList.contains('is-active')).toBe(true);
    renderSiteUi(store(views), { refresh: () => {} });
    expect(siteNav()!.querySelector('[data-wiky-view-id="c"]')!.classList.contains('is-active')).toBe(true);
    expect(siteNav()!.querySelector('[data-wiky-view-id="a"]')!.classList.contains('is-active')).toBe(false);
    // « Ma collection » ne paraît plus active : c'est la vue qui l'est.
    const mine = siteNav()!.querySelector('[data-group="collection"] .wiky-group-items > a')!;
    expect(mine.textContent!.trim()).toBe('Ma collection');
    expect(mine.className).not.toContain('color-accent)]/10');
  });

  it('barre du site non compacte : les vues sous le lien « Collection »', () => {
    renderSiteUi(store([view({ id: 'a', name: 'Ma vue' })], { compactNav: false, siteIntegration: false }), { refresh: () => {} });
    const box = siteNav()!.querySelector('[data-wiky="nav-views"]')!;
    expect(box.previousElementSibling!.getAttribute('href')).toBe('/collection');
    expect(box.textContent).toContain('Ma vue');
  });
});
