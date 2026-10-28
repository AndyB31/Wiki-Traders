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

/** Réglages avec ces vues ; par défaut, affichage « filtres du site » (celui de ces tests-là). */
function settingsWith(views: CollectionView[], viewsMode: Settings['viewsMode'] = 'native'): Settings {
  const features = Object.fromEntries(FEATURES.map((f) => [f.key, false])) as FeatureFlags;
  return { ...DEFAULT_SETTINGS, apiRead: false, features, collectionViews: views, viewsMode };
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

// ---------------------------------------------------------------- champs du site

const { pickSiteSort, remainingView, siteFilters, siteTagName } = await import('../src/lib/views');
const { applySiteFilters, resetSiteFilters } = await import('../src/content/collection-controls');

/** Contrôles de la collection du site, tels que relevés le 2026-10-26 (listes à boutons role=option). */
function mountControls(titles: string[] = ['Zola', 'Balzac']) {
  const listbox = (id: string, label: string, value: string) => `
    <div class="relative"><button type="button" id="b${id}" aria-haspopup="listbox" aria-expanded="false" aria-controls="${id}" aria-label="${label}"><span>${value}</span></button></div>`;
  document.body.innerHTML = `<main><div class="flex-1"><div class="flex items-center"><h1>Collection</h1></div>
    <div class="space-y-3"><div class="flex"><input type="text" placeholder="Rechercher par titre ou catégorie...">
      ${listbox('tags', 'Filtrer par étiquette', 'Toutes les étiquettes')}${listbox('sort', 'Trier la collection', 'Rareté')}</div>
      <div class="flex flex-wrap gap-2">${['L', 'UR', 'SR', 'R', 'PC', 'C'].map((r) => `<button class="px-3 py-1 rounded-full opacity-50" style="background-color: var(--color-rarity-${r.toLowerCase()})30;">${r}</button>`).join('')}</div></div>
    <div class="grid">${titles.map((t) => nativeCard(t)).join('')}</div></div></main>`;
  const options: Record<string, string[]> = {
    tags: ['Toutes les étiquettes', 'Sans étiquette', '#10-100 (142)', '#Galaxy (48)', 'Gérer les étiquettes…'],
    sort: ['Rareté', 'Nom', 'Favoris', 'Date d\'ajout'],
  };
  // Comme le site : un clic ouvre la liste (portail), un clic sur une option la choisit et la referme.
  for (const id of ['tags', 'sort']) {
    const button = document.getElementById(`b${id}`)!;
    button.addEventListener('click', () => {
      const open = document.getElementById(id);
      if (open) return open.remove();
      const list = document.createElement('div');
      list.id = id;
      list.setAttribute('role', 'listbox');
      for (const o of options[id]) {
        const b = document.createElement('button');
        b.setAttribute('role', 'option');
        b.textContent = o;
        b.addEventListener('click', () => {
          button.querySelector('span')!.textContent = o;
          list.remove();
          // Comme le site, mais tout de suite : la liste des cartes suit l'étiquette et le tri.
          const grid = document.querySelector('.grid')!;
          const shown = titles.filter((t) => !(id === 'tags' && o.startsWith('#10-100')) || ['Zola', 'Balzac'].includes(t));
          if (id === 'tags') grid.innerHTML = shown.map((t) => nativeCard(t)).join('');
          if (id === 'sort' && o === 'Nom') grid.replaceChildren(...[...grid.children].sort((a, b) => a.textContent!.trim().localeCompare(b.textContent!.trim())));
        });
        list.append(b);
      }
      document.body.append(list);
    });
  }
  for (const chip of document.querySelectorAll<HTMLElement>('[style*="color-rarity"]')) chip.addEventListener('click', () => chip.classList.toggle('opacity-50'));
  const input = document.querySelector('input')!;
  return {
    q: () => input.value,
    tag: () => document.querySelector('#btags')!.textContent!.trim(),
    sort: () => document.querySelector('#bsort')!.textContent!.trim(),
    rarities: () => [...document.querySelectorAll('[style*="color-rarity"]:not(.opacity-50)')].map((b) => b.textContent),
  };
}

describe('champs de la collection du site', () => {
  it('ce que le site sait faire : une recherche, une étiquette (ou « sans étiquette »), les raretés', () => {
    expect(siteFilters(view({}, { q: ' roi ', tags: ['10-100'], rarities: ['L', 'UR'] }))).toEqual({ q: 'roi', tag: '10-100', untagged: false, rarities: ['L', 'UR'] });
    expect(siteFilters(view({}, { q: 'roi, reine', tags: ['a', 'b'] }))).toMatchObject({ q: '', tag: null });
    expect(siteFilters(view({}, { tags: ['a', 'b'], tagMode: 'all' })).tag).toBe('a');
    expect(siteFilters(view({}, { untagged: true, tags: ['a'] }))).toMatchObject({ tag: null, untagged: true });
    expect(siteTagName('#20-100 (142)')).toBe('20-100');
    expect(siteTagName('#Mettre au Enchère (227)')).toBe('Mettre au Enchère');
  });

  it('tri du site : Nom = A → Z, Rareté = Légendaire d\'abord ; les autres tris n\'y sont pas', () => {
    const labels = ['Rareté', 'Nom', 'Favoris', 'Date d\'ajout'];
    expect(pickSiteSort(labels, 'name', 'asc')).toEqual({ index: 1, exact: true });
    expect(pickSiteSort(labels, 'name', 'desc')).toEqual({ index: 1, exact: false });
    expect(pickSiteSort(labels, 'rarity', 'desc')).toEqual({ index: 0, exact: true });
    expect(pickSiteSort(labels, 'favorite', 'desc')).toEqual({ index: 2, exact: true });
    expect(pickSiteSort(labels, 'added', 'asc')).toEqual({ index: 3, exact: true });
    expect(pickSiteSort(labels, 'price', 'desc')).toBeNull();
  });

  it('ce que le site a déjà fait n\'est pas refait sur la page ; son ordre est gardé quand c\'est le bon', () => {
    const v = view({ sort: 'name' }, { q: 'roi', tags: ['10-100', 'Garder'], tagMode: 'all', rarities: ['L'], minPrice: 10 });
    const rest = remainingView(v, { q: 'roi', tag: '10-100', untagged: false, rarities: ['L'], sortExact: true });
    expect(rest.filter).toMatchObject({ q: '', tags: ['Garder'], rarities: [], minPrice: 10 });
    expect(rest.sort).toBe('added');
    expect(remainingView(v, null)).toBe(v);
    expect(remainingView(view({ sort: 'price' }, { tags: ['10-100'] }), { q: '', tag: '10-100', untagged: false, rarities: [], sortExact: false })).toMatchObject({ sort: 'price', filter: { tags: [] } });
  });

  it('remplit recherche, étiquette, raretés et tri ; puis remet tout comme au chargement', async () => {
    const site = mountControls();
    const v = view({ sort: 'name' }, { q: 'roi', tags: ['10-100'], rarities: ['L', 'SR'] });
    const applied = await applySiteFilters(v, siteFilters(v));
    expect([site.q(), site.tag(), site.sort(), site.rarities()]).toEqual(['roi', '#10-100 (142)', 'Nom', ['L', 'SR']]);
    expect(applied).toMatchObject({ q: 'roi', tag: '10-100', rarities: ['L', 'SR'], sort: 'Nom', sortExact: true });
    // Tri inconnu du site (prix) : son tri par défaut ; « sans étiquette » ; raretés changées.
    const p = view({ sort: 'price', dir: 'desc' }, { untagged: true, rarities: ['C'] });
    expect(await applySiteFilters(p, siteFilters(p))).toMatchObject({ q: '', untagged: true, rarities: ['C'], sort: 'Rareté', sortExact: false });
    expect([site.q(), site.tag(), site.rarities()]).toEqual(['', 'Sans étiquette', ['C']]);
    await resetSiteFilters();
    expect([site.q(), site.tag(), site.sort(), site.rarities()]).toEqual(['', 'Toutes les étiquettes', 'Rareté', []]);
  });

  it('ouvrir une vue remplit les champs du site ; la quitter les remet à zéro', async () => {
    const site = mountControls(['Zola', 'Balzac', 'Hugo']);
    // Le dernier relevé de l'extension ne connaît pas encore l'étiquette de Zola : le site, si.
    const v = view({ icon: 'star' }, { tags: ['10-100'] });
    CARDS[0].tags = [];
    history.replaceState(null, '', `/collection?wview=${v.id}`);
    const ctx = makeContext(settingsWith([v]), cardsById(...CARDS), []);
    runFeatures(ctx);
    await vi.waitFor(() => expect([site.tag(), site.sort()]).toEqual(['#10-100 (142)', 'Nom']));
    await vi.waitFor(() => expect(document.querySelector('[data-note="site"]')?.textContent).toBe('Réglé sur le site : étiquette 10-100 · tri Nom.'));
    runFeatures(ctx);
    expect(visible()).toEqual(['Balzac', 'Zola']);
    CARDS[0].tags = ['10-100'];
    document.querySelector<HTMLButtonElement>('[data-act="quit"]')!.click();
    await vi.waitFor(() => expect([site.tag(), site.sort()]).toEqual(['Toutes les étiquettes', 'Rareté']));
  });
});

// ---------------------------------------------------------------- page Wiki-Traders

describe('vue en page Wiki-Traders (réglage par défaut)', () => {
  const NAV = readFileSync(resolve(import.meta.dirname, 'fixtures/site-nav.html'), 'utf8');
  const v = view({ id: 'v1', name: '10-100 A→Z' }, { tags: ['10-100'] });
  const open = (views: CollectionView[] = [v], over: Partial<Settings> = {}) => {
    const settings = { ...settingsWith(views, 'app'), ...over };
    renderSiteUi({ ...input({ settings }), meta: DEFAULT_META, bidsCache: null }, { refresh: () => {} });
    runFeatures(makeContext(settings, cardsById(...CARDS), []));
  };
  const titles = () => [...document.querySelectorAll('[data-wiky="view-page"] .wf-card h3')].map((h) => h.textContent);

  beforeEach(() => {
    document.body.innerHTML = `<div class="flex">${NAV}<main><div class="flex-1"><h1>Collection</h1><div class="grid">${nativeCard('Hugo')}</div></div></main></div>`;
    history.replaceState(null, '', `/collection?wview=${v.id}`);
    sessionStorage.clear();
  });

  it('par défaut : page propre avec toutes les cartes de la vue (pas seulement celles de la page du site)', () => {
    expect(DEFAULT_SETTINGS.viewsMode).toBe('app');
    expect(migrateSettings({ viewsMode: 'autre' } as unknown as Partial<Settings>).viewsMode).toBe('app');
    open();
    expect(document.documentElement.getAttribute('data-wiky-route')).toBe('view');
    expect(document.querySelector('#wiky-page h1')!.textContent).toBe('10-100 A→Z');
    // La collection du site n'a qu'Hugo sur sa page : la vue montre quand même Balzac et Zola, par nom.
    expect(titles()).toEqual(['Balzac', 'Zola']);
    expect(document.querySelector('[data-part="info"]')!.textContent).toContain('2 cartes');
    // Rien n'est masqué ni réordonné dans la collection du site, aucun bandeau.
    expect(document.querySelectorAll('[data-wiky-vhide], [data-wiky="view-bar"]')).toHaveLength(0);
    // Favori et étiquettes visibles sur la carte.
    const balzac = document.querySelector('[data-wiky="view-page"] .wf-card')!;
    expect(balzac.querySelector('[title="Favori"]')).not.toBeNull();
    expect(balzac.textContent).toContain('#Garder');
  });

  it('affiner sur place : raretés, recherche, étiquette, tri ; « Réinitialiser »', async () => {
    open([view({ id: 'v1', name: 'Tout' })]);
    const page = document.querySelector<HTMLElement>('[data-wiky="view-page"]')!;
    expect(titles()).toEqual(['Balzac', 'Hugo', 'Molière', 'Zola']);
    page.querySelector<HTMLElement>('[data-act="rarity"][data-r="L"]')!.click();
    page.querySelector<HTMLElement>('[data-act="rarity"][data-r="UR"]')!.click();
    expect(titles()).toEqual(['Hugo', 'Molière']);
    const sort = page.querySelector<HTMLSelectElement>('[data-in="sort"]')!;
    sort.value = 'name:desc';
    sort.dispatchEvent(new Event('change', { bubbles: true }));
    expect(titles()).toEqual(['Molière', 'Hugo']);
    page.querySelector<HTMLElement>('[data-act="reset"]')!.click();
    expect(titles()).toHaveLength(4);

    const tag = page.querySelector<HTMLSelectElement>('[data-in="tag"]')!;
    expect([...tag.options].map((o) => o.textContent)).toEqual(['Toutes les étiquettes', 'Sans étiquette', '#10-100 (2)', '#100+ (1)', '#Garder (1)']);
    tag.value = 'none';
    tag.dispatchEvent(new Event('change', { bubbles: true }));
    expect(titles()).toEqual(['Hugo']);
    tag.value = '';
    tag.dispatchEvent(new Event('change', { bubbles: true }));

    const q = page.querySelector<HTMLInputElement>('[data-in="q"]')!;
    q.value = 'dramaturge';
    q.dispatchEvent(new Event('input', { bubbles: true }));
    await vi.waitFor(() => expect(titles()).toEqual(['Molière']));
  });

  it('clic sur une carte : la collection du site, recherche remplie avec son nom', () => {
    open();
    document.querySelector<HTMLElement>('[data-wiky="view-page"] .wf-card h3')!.click();
    expect(location.pathname + location.search).toBe('/collection');
    expect(sessionStorage.getItem('wiky-view-site-search')).toBe('Balzac');
  });

  it('aucune carte : message ; réglage « filtres du site » : pas de page, la collection du site est filtrée', () => {
    open([view({ id: 'v1' }, { rarities: ['PC'] })]);
    expect(document.querySelector('[data-wiky="view-page"] .wf-empty')!.textContent).toContain('Aucune carte');

    open([v], { viewsMode: 'native' });
    expect(document.getElementById('wiky-page')).toBeNull();
    expect(document.documentElement.hasAttribute('data-wiky-route')).toBe(false);
    expect(document.querySelector('[data-wiky="view-bar"]')).not.toBeNull();
  });
});
