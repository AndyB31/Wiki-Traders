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
const { closeModal, renderSiteUi, siteNav, siteSummary } = await import('../src/content/site-ui');

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

  it('regroupe Échanges, Guilde, Amis, Messages, Bataille (ordre du site) dans « Social » sans déplacer les liens du site', () => {
    renderSiteUi(store(), actions);
    const nav = siteNav()!;
    expect(nav.getAttribute('data-wiky-nav')).toBe('compact');
    const social = nav.querySelector<HTMLElement>('[data-wiky="nav-group"][data-group="social"]')!;
    expect(social.querySelector('.wiky-group-head')!.textContent).toContain('Social');
    expect([...social.querySelectorAll('.wiky-group-items a')].map((a) => a.getAttribute('href'))).toEqual(['/trades', '/guild', '/friends', '/dms', '/battle']);
    // Les liens d'origine restent dans la barre (React les gère), masqués.
    const friends = nav.querySelector<HTMLAnchorElement>(':scope > a[href="/friends"]')!;
    expect(friends.getAttribute('data-wiky-grouped')).toBe('social');
    // Un clic sur la copie déclenche le lien d'origine (navigation du site).
    const clicked = vi.fn((e: Event) => e.preventDefault());
    friends.addEventListener('click', clicked);
    social.querySelector<HTMLAnchorElement>('.wiky-group-items a[href="/friends"]')!.click();
    expect(clicked).toHaveBeenCalledTimes(1);
    // Progression : Profil, Succès, Classement.
    expect([...nav.querySelectorAll('[data-group="progress"] .wiky-group-items a')].map((a) => a.textContent)).toEqual(['Profil', 'Succès', 'Classement']);
    // Restent visibles : Paquets, Collection, Familles, Marché, Mes enchères, Toutes les cartes, Paramètres.
    const visible = [...nav.querySelectorAll(':scope > a:not([data-wiky-grouped])')].map((a) => a.textContent!.trim());
    expect(visible).toEqual(['Paquets', 'Collection', 'Familles', 'Marché', 'Mes enchères', 'Toutes les cartes', 'Paramètres']);
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

describe('résumé Wiky-Traders toujours visible', () => {
  it('slots, mises gagnées / perdues et synchro, avant « Paramètres »', () => {
    const now = Date.now();
    const s = store(
      { cards: cardsById(card('a')), myAuctions: [auction('x', 'a', { endsAt: now + 3_600_000, seenAt: now })] },
      [{ status: 'leading' }, { status: 'leading' }, { status: 'outbid' }, { status: 'won', endsAt: now - 3_600_000 }, { status: 'lost', endsAt: now - 7_200_000 }],
    );
    const sum = siteSummary(s, now);
    expect(sum).toMatchObject({ slots: 5, occupied: 1, leading: 2, outbid: 1, won24: 1, lost24: 1 });
    renderSiteUi(s, actions);
    const section = document.querySelector<HTMLElement>('[data-wiky="nav-wiky"]')!;
    expect(section.nextElementSibling!.getAttribute('href')).toBe('/settings');
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
    const bids = [...document.querySelectorAll<HTMLButtonElement>('.wiky-items button')].find((b) => b.textContent!.includes('Mes mises'))!;
    bids.click();
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
    expect(document.querySelector('.wiky-items a.is-active')!.getAttribute('href')).toBe('/collection?wiky=cards');
  });
});

describe('Paramètres du site', () => {
  it('ajoute un onglet « Wiky-Traders » à côté des onglets du site', () => {
    history.replaceState(null, '', '/settings');
    document.querySelector('main')!.innerHTML = '<h1>Paramètres</h1><div role="tablist"><button role="tab" aria-selected="true" class="tab">Compte</button><button role="tab" aria-selected="false" class="tab">Affichage</button></div>';
    renderSiteUi(store(), actions);
    const tabs = [...document.querySelectorAll('[role="tablist"] [role="tab"]')];
    expect(tabs.map((t) => t.textContent)).toEqual(['Compte', 'Affichage', 'Wiky-Traders']);
    expect(tabs[2].className).toBe('tab');
  });

  it('/settings?wiky=settings : les réglages de l\'extension dans la page du site', () => {
    history.replaceState(null, '', '/settings?wiky=settings');
    renderSiteUi(store(), actions);
    const page = document.getElementById('wiky-page')!;
    expect(page.querySelector('.wiky-tab.is-active')!.textContent).toBe('Wiky-Traders');
    expect(page.querySelector('iframe')!.getAttribute('src')).toContain('options.html?embed=1');
  });
});
