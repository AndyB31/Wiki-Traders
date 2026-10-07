// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_META } from '../src/lib/defaults';
import type { MyBid } from '../src/lib/types';
import { auction, cardsById, card, input } from './helpers';

vi.hoisted(() => {
  (globalThis as unknown as { chrome: unknown }).chrome = { runtime: { getURL: (p: string) => `chrome-extension://wiky/${p}` } };
});
const { closeModal, openModal, renderSiteUi, siteNav, siteSummary } = await import('../src/content/site-ui');

// Barre latérale réelle du site (avec « Familles » et « Mes enchères » de l'autre extension), et barre mobile.
const NAV = readFileSync(resolve(import.meta.dirname, 'fixtures/site-nav.html'), 'utf8');
const actions = { refresh: vi.fn() };

function store(over: Partial<ReturnType<typeof input>> = {}, bids: Partial<MyBid>[] = []) {
  const now = Date.now();
  return {
    ...input(over),
    meta: { ...DEFAULT_META, lastAuctionsScan: now - 5 * 60_000 },
    bidsCache: { at: now - 5 * 60_000, bids: bids.map((b, i) => ({ auctionId: `a${i}`, cardId: `c${i}`, cardName: `Carte ${i}`, rarity: null, shiny: false, myMax: 10, myBids: 1, lastBidAt: now, current: 10, status: 'leading', endsAt: now + 3_600_000, cardSales: 0, cardMedian: null, ...b }) as MyBid) },
  };
}

beforeEach(() => {
  closeModal();
  document.documentElement.removeAttribute('data-wiky-route');
  document.body.innerHTML = `<div class="flex">${NAV}<main><div class="flex-1"><h1>Collection</h1></div></main></div>`;
  history.replaceState(null, '', '/collection');
  localStorage.clear();
});

describe('barre latérale du site', () => {
  it('trouve la barre latérale de bureau, pas la barre mobile', () => {
    expect(siteNav()!.className).toContain('w-64');
  });

  it('arborescence : Paquets en haut, menus, récapitulatif puis Paramètres tout en bas ; pages Wiki-Traders rangées avec celles du site', () => {
    renderSiteUi(store(), actions);
    const nav = siteNav()!;
    expect(nav.getAttribute('data-wiky-nav')).toBe('compact');
    // Seul « Paquets » reste visible hors des menus.
    expect([...nav.querySelectorAll(':scope > a:not([data-wiky-grouped])')].map((a) => a.textContent!.trim())).toEqual(['Paquets']);
    // Ordre de la barre : Paquets, Collection, Marché, Social, Progression, récapitulatif, Paramètres.
    const order = [...nav.children]
      .filter((c) => (c as HTMLElement).dataset.group || c.getAttribute('data-wiky') === 'nav-recap' || (c.matches('a') && !c.hasAttribute('data-wiky-grouped')))
      .map((c) => (c as HTMLElement).dataset.group ?? (c.getAttribute('data-wiky') === 'nav-recap' ? 'recap' : c.textContent!.trim()));
    expect(order).toEqual(['Paquets', 'collection', 'market', 'social', 'progress', 'recap', 'settings']);
    expect(nav.lastElementChild!.getAttribute('data-group')).toBe('settings');
    const items = (g: string) => [...nav.querySelectorAll(`[data-group="${g}"] .wiky-group-items > *`)].map((a) => a.textContent!.trim().replace(/\d+$/, ''));
    expect(items('collection')).toEqual(['Ma collection', 'Toutes les cartes', 'Familles', 'Familles', 'Cartes & prix']);
    expect(items('market')).toEqual(['Parcourir', 'Mes ventes', 'Mes enchères', 'Historique']);
    expect(items('social')).toEqual(['Échanges', 'Guilde', 'Amis', 'Messages', 'Bataille']);
    expect(items('progress')).toEqual(['Profil', 'Succès', 'Classement']);
    expect(items('settings')).toEqual(['Paramètres du site', 'Réglages Wiki-Traders', 'Outils']);
    // Les pages de l'extension se distinguent par leur icône orange ; les onglets du Marché (pages du site) restent neutres.
    expect(nav.querySelectorAll('[data-group="collection"] .wiky-sub:not(.site-tab) .wiky-ico')).toHaveLength(2);
    expect(nav.querySelectorAll('[data-group="market"] .wiky-sub.site-tab')).toHaveLength(4);
    // Les liens d'origine restent dans la barre (React les gère), masqués ; la copie déclenche l'original.
    const friends = nav.querySelector<HTMLAnchorElement>(':scope > a[href="/friends"]')!;
    expect(friends.getAttribute('data-wiky-grouped')).toBe('social');
    const clicked = vi.fn((e: Event) => e.preventDefault());
    friends.addEventListener('click', clicked);
    nav.querySelector<HTMLAnchorElement>('[data-group="social"] .wiky-group-items a[href="/friends"]')!.click();
    expect(clicked).toHaveBeenCalledTimes(1);
  });

  it('Marché : Parcourir, Mes ventes, Mes enchères, Historique = onglets du site (changement sur place si on est déjà sur le Marché)', () => {
    renderSiteUi(store(), actions);
    const tab = (t: string) => document.querySelector<HTMLAnchorElement>(`[data-group="market"] a[data-wiky-tab="${t}"]`)!;
    expect(tab('sales').getAttribute('href')).toBe('/marketplace?wtab=sales');
    history.replaceState(null, '', '/marketplace');
    document.documentElement.dataset.wikyMarketTab = 'bids';
    renderSiteUi(store(), actions);
    expect(tab('bids').classList.contains('is-active')).toBe(true);
    const asked = vi.fn();
    window.addEventListener('wiky-market-tab', (e) => asked((e as CustomEvent).detail));
    tab('history').click();
    expect(asked).toHaveBeenCalledWith('history');
    expect(location.pathname).toBe('/marketplace');
    delete document.documentElement.dataset.wikyMarketTab;
  });

  it('menu de la page affichée ouvert ; clic sur « Marché » : ouvre la page et le menu, la flèche ne fait que replier', () => {
    renderSiteUi(store(), actions);
    const nav = siteNav()!;
    const collection = nav.querySelector<HTMLElement>('[data-group="collection"]')!;
    expect(collection.dataset.open).toBe('true');
    expect(collection.querySelector('.wiky-group-head')!.classList.contains('is-active')).toBe(true);
    const market = nav.querySelector<HTMLElement>('[data-group="market"]')!;
    const marketLink = nav.querySelector<HTMLAnchorElement>(':scope > a[href="/marketplace"]')!;
    const go = vi.fn((e: Event) => e.preventDefault());
    marketLink.addEventListener('click', go);
    market.querySelector<HTMLButtonElement>('.wiky-head-main')!.click();
    expect(go).toHaveBeenCalledTimes(1);
    expect(market.dataset.open).toBe('true');
    market.querySelector<HTMLButtonElement>('.wiky-head-toggle')!.click();
    expect(market.dataset.open).toBe('false');
    expect(go).toHaveBeenCalledTimes(1);
  });

  it('ouvre et mémorise un menu ; ne refait rien quand rien ne change', () => {
    renderSiteUi(store(), actions);
    const social = document.querySelector<HTMLElement>('[data-group="social"]')!;
    expect(social.dataset.open).toBe('false');
    social.querySelector<HTMLButtonElement>('.wiky-group-head')!.click();
    expect(social.dataset.open).toBe('true');
    const head = social.querySelector('.wiky-group-head');
    renderSiteUi(store(), actions);
    expect(social.querySelector('.wiky-group-head')).toBe(head);
  });

  it('désactivable : la barre du site redevient intacte', () => {
    const s = store();
    renderSiteUi(s, actions);
    s.settings = { ...s.settings, compactNav: false, siteIntegration: false };
    renderSiteUi(s, actions);
    const nav = siteNav()!;
    expect(nav.hasAttribute('data-wiky-nav')).toBe(false);
    expect(nav.querySelector('[data-wiky], [data-wiky-grouped]')).toBeNull();
  });
});

describe('résumé Wiki-Traders toujours visible', () => {
  it('slots, mises gagnées / perdues et synchro, avant « Paramètres »', () => {
    const now = Date.now();
    const s = store(
      { cards: cardsById(card('a')), myAuctions: [auction('x', 'a', { endsAt: now + 3_600_000, seenAt: now })] },
      [{ status: 'leading' }, { status: 'leading' }, { status: 'outbid' }, { status: 'won', endsAt: now - 3_600_000 }, { status: 'lost', endsAt: now - 7_200_000 }],
    );
    const sum = siteSummary(s, now);
    expect(sum).toMatchObject({ slots: 5, occupied: 1, leading: 2, outbid: 1, won24: 1, lost24: 1 });
    renderSiteUi(s, actions);
    const section = document.querySelector<HTMLElement>('[data-wiky="nav-recap"]')!;
    expect(section.nextElementSibling!.getAttribute('data-group')).toBe('settings');
    const text = section.querySelector('.wiky-status')!.textContent!.replace(/\s+/g, ' ');
    expect(text).toContain('1/5 · 4 libres');
    expect(text).toContain('2 en tête · 1 surenchérie');
    expect(text).toContain('1 gagnée · 1 perdue');
    expect(text).toContain('Synchro il y a 5 min');
    section.querySelector<HTMLElement>('[data-act="refresh"]')!.click();
    expect(actions.refresh).toHaveBeenCalled();
  });

  it('les fonctionnalités s\'ouvrent par-dessus la page, aux couleurs du site', () => {
    renderSiteUi(store(), actions);
    openModal('bids');
    const frame = document.querySelector<HTMLIFrameElement>('[data-wiky="modal"] iframe')!;
    expect(frame.src).toContain('popup.html?embed=1&view=bids&theme=');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(document.querySelector('[data-wiky="modal"]')).toBeNull();
  });

  it('« Cartes & prix » est une page du site : le contenu du site est masqué, pas retiré', () => {
    history.replaceState(null, '', '/collection?wiky=cards');
    renderSiteUi(store(), actions);
    expect(document.documentElement.getAttribute('data-wiky-route')).toBe('cards');
    const page = document.querySelector('main > #wiky-page')!;
    expect(page.querySelector('h1')!.textContent).toBe('Cartes & prix');
    expect(page.querySelector('iframe')!.getAttribute('src')).toContain('view=cards');
    expect(document.querySelector('main h1')!.textContent).toBe('Collection');
    expect(document.querySelector('.wiky-group-items a.wiky-sub.is-active')!.getAttribute('href')).toBe('/collection?wiky=cards');
    // Sur une page Wiki-Traders, « Ma collection » (lien du site) ne paraît pas active.
    const mine = [...document.querySelectorAll('[data-group="collection"] .wiky-group-items a')].find((a) => a.textContent!.includes('Ma collection'))!;
    expect(mine.className).not.toMatch(/color-accent\)\]\/10/);
  });
});

describe('Paramètres du site', () => {
  it('ajoute un onglet « Wiki-Traders » à côté des onglets du site', () => {
    history.replaceState(null, '', '/settings');
    document.querySelector('main')!.innerHTML = '<h1>Paramètres</h1><div role="tablist"><button role="tab" aria-selected="true" class="tab">Compte</button><button role="tab" aria-selected="false" class="tab">Affichage</button></div>';
    renderSiteUi(store(), actions);
    const tabs = [...document.querySelectorAll('[role="tablist"] [role="tab"]')];
    expect(tabs.map((t) => t.textContent)).toEqual(['Compte', 'Affichage', 'Wiki-Traders']);
    expect(tabs[2].className).toBe('tab');
  });

  it('/settings?wiky=settings : les réglages de l\'extension dans la page du site', () => {
    history.replaceState(null, '', '/settings?wiky=settings');
    renderSiteUi(store(), actions);
    const page = document.getElementById('wiky-page')!;
    expect(page.querySelector('.wiky-tab.is-active')!.textContent).toBe('Wiki-Traders');
    expect(page.querySelector('iframe')!.getAttribute('src')).toContain('options.html?embed=1');
  });
});

describe('bouton « Étiquettes » de la collection', () => {
  it('juste après « Plus chères » sur la ligne du titre, ouvre la fenêtre d\'étiquetage ; absent ailleurs', async () => {
    const { makeContext, runFeatures } = await import('../src/content/features/runtime');
    await import('../src/content/features/ranking');
    await import('../src/content/features/tag-tool');
    document.querySelector('main')!.innerHTML = '<div class="flex"><h1>Collection</h1><button>Sélectionner</button></div>';
    const s = { ...store().settings, apiRead: true };
    runFeatures(makeContext(s, {}, []));
    const tools = document.querySelector('[data-wiky="coll-tools"]')!;
    expect([...tools.querySelectorAll<HTMLElement>('[data-tool]')].map((b) => b.dataset.tool).slice(0, 2)).toEqual(['ranking', 'tags']);
    tools.querySelector<HTMLButtonElement>('[data-tool="tags"]')!.click();
    expect(document.querySelector<HTMLIFrameElement>('[data-wiky="modal"] iframe')!.src).toContain('view=tags');
    closeModal();
    history.replaceState(null, '', '/marketplace');
    runFeatures(makeContext(s, {}, []));
    expect(document.querySelector('[data-tool="tags"]')).toBeNull();
  });
});
