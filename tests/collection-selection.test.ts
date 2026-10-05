// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import {
  isCardSelected,
  nativeCardSiteId,
  nativeCardTitle,
  nativeCards,
  selectedCollectionCards,
  selectionModeActive,
  siteSelectedCount,
  siteSelectionBar,
} from '../src/content/collection-selection';

/** Carte native de /collection (structure réelle simplifiée : conteneur `relative isolate group` > `glow-*`). */
function tile(title: string, opts: { ref?: string; wm?: string; wrapAttrs?: string; cardClass?: string; inner?: string } = {}): string {
  return `<div class="relative isolate group" ${opts.wrapAttrs ?? ''}><div class="w-[clamp(8.4rem,43vw,10rem)] glow-r relative ${opts.cardClass ?? ''}"${opts.ref ? ` data-wiky-ref="card:${opts.ref}"` : ''}${opts.wm ? ` data-wm-card-id="${opts.wm}"` : ''}>
    <img alt="" src="/rare.png"><div><img alt="${title}" src="https://img/${title}.jpg"></div><h3>${title}</h3><p>catégorie</p>${opts.inner ?? ''}</div></div>`;
}

const SITE_BAR = (n: number) => `<div class="fixed bottom-4 z-[80] flex flex-col gap-3 card-frame bg-[var(--color-background)] p-3 shadow-xl animate-fade-in-up"><div class="flex flex-wrap items-center gap-3">
  <div class="flex items-center gap-2 text-sm"><span class="font-semibold text-[var(--color-accent)]">${n}</span><span class="text-[var(--color-foreground)]/60">cartes sélectionnées</span></div>
  <div class="ml-auto flex flex-wrap items-center gap-2"><button>Tout sélectionner (page)</button><button class="inline-flex px-3">Étiqueter</button><button disabled>Retirer l'étiquette</button><button class="bg-red-500/90">Défausser (+${n})</button></div></div></div>`;

function page(button: string, cards: string, extra = ''): void {
  document.body.innerHTML = `<main><div class="flex"><h1>Collection</h1><button>${button}</button></div><div class="grid">${cards}</div></main>${extra}`;
}

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('cartes natives', () => {
  it('trouve les cartes, leur titre et leur identifiant (bridge, puis « Prix moyen collection »)', () => {
    page('Sélectionner', tile('Mont Fuji', { ref: 'uuid-1' }) + tile('Marie Curie', { wm: 'uuid-2' }) + tile('Inconnue'));
    const cards = nativeCards();
    expect(cards.map(nativeCardTitle)).toEqual(['Mont Fuji', 'Marie Curie', 'Inconnue']);
    expect(cards.map(nativeCardSiteId)).toEqual(['uuid-1', 'uuid-2', null]);
  });

  it('identifiant posé par le bridge sur le conteneur', () => {
    page('Sélectionner', tile('Mont Fuji', { wrapAttrs: 'data-wiky-ref="card:uuid-9"' }));
    expect(nativeCardSiteId(nativeCards()[0])).toBe('uuid-9');
  });

  it('ignore nos propres cartes (data-wiky)', () => {
    page('Sélectionner', `<div data-wiky="page">${tile('À nous')}</div>${tile('Du site')}`);
    expect(nativeCards().map(nativeCardTitle)).toEqual(['Du site']);
  });
});

describe('mode sélection (relevé sur le site)', () => {
  it('« Sélectionner » = inactif, aucune carte retournée même si une classe ressemble à une sélection', () => {
    page('Sélectionner', tile('A', { cardClass: 'ring-2' }) + tile('B'));
    expect(selectionModeActive()).toBe(false);
    expect(selectedCollectionCards()).toEqual([]);
  });

  it('« Quitter la sélection » = actif', () => {
    page('Quitter la sélection', tile('A') + tile('B'));
    expect(selectionModeActive()).toBe(true);
    expect(selectedCollectionCards()).toEqual([]);
  });

  it('barre d\'actions du site : trouvée, compteur lu', () => {
    page('Quitter la sélection', tile('A'), SITE_BAR(2));
    expect(siteSelectionBar()?.textContent).toContain('Défausser');
    expect(siteSelectedCount()).toBe(2);
    expect(selectionModeActive()).toBe(true);
  });

  it('sans barre du site : pas de compteur', () => {
    page('Quitter la sélection', tile('A'));
    expect(siteSelectionBar()).toBeNull();
    expect(siteSelectedCount()).toBeNull();
  });

  it('bouton « Sélectionner » enfoncé (aria-pressed) = actif', () => {
    page('Sélectionner', tile('A'));
    document.querySelector('main button')!.setAttribute('aria-pressed', 'true');
    expect(selectionModeActive()).toBe(true);
  });
});

describe('cartes cochées (heuristique)', () => {
  it('case à cocher cochée dans la carte', () => {
    page('Quitter la sélection', tile('A', { inner: '<input type="checkbox" checked>' }) + tile('B', { inner: '<input type="checkbox">' }));
    expect(selectedCollectionCards().map(nativeCardTitle)).toEqual(['A']);
  });

  it('role=checkbox / aria-checked', () => {
    page('Quitter la sélection', tile('A', { inner: '<div role="checkbox" aria-checked="true"></div>' }) + tile('B', { inner: '<div role="checkbox" aria-checked="false"></div>' }));
    expect(selectedCollectionCards().map(nativeCardTitle)).toEqual(['A']);
  });

  it('attribut d\'état sur le conteneur (aria-selected, data-state)', () => {
    page('Quitter la sélection', tile('A', { wrapAttrs: 'aria-selected="true"' }) + tile('B', { wrapAttrs: 'data-state="checked"' }) + tile('C', { wrapAttrs: 'data-state="closed"' }));
    expect(selectedCollectionCards().map(nativeCardTitle)).toEqual(['A', 'B']);
  });

  it('classe de sélection (ring) seulement en mode sélection', () => {
    page('Quitter la sélection', tile('A', { cardClass: 'ring-2 ring-[var(--color-accent)]' }) + tile('B'));
    expect(selectedCollectionCards().map(nativeCardTitle)).toEqual(['A']);
    const a = nativeCards()[0];
    expect(isCardSelected(a, false)).toBe(false);
  });

  it('une carte cochée suffit à détecter le mode (bouton absent)', () => {
    document.body.innerHTML = `<main>${tile('A', { inner: '<input type="checkbox" checked>' })}</main>`;
    expect(selectionModeActive()).toBe(true);
  });
});

describe('cartes cochées : repère réel du site', () => {
  /** Case en haut à droite du conteneur, telle que relevée sur wiki-masters.com en mode « Sélectionner ». */
  const realTile = (title: string, id: string, checked: boolean) =>
    `<div class="relative isolate group"><div class="w-[clamp(8.4rem,43vw,10rem)] glow-ur relative rounded-2xl" data-wiky-ref="card:${id}"><img alt=""><h3>${title}</h3></div>
      <div class="pointer-events-none absolute inset-0 z-10 rounded-2xl ${checked ? 'ring-4 ring-[var(--color-accent)]' : 'bg-black/0 hover:bg-black/10'}" aria-hidden="true"></div>
      <span class="pointer-events-none absolute top-1.5 right-1.5 z-30 flex size-6 rounded-md border-2 ${checked ? 'bg-[var(--color-accent)]' : 'bg-black/60'}" aria-hidden="true">${checked ? '<svg class="lucide lucide-check size-4"></svg>' : '<svg class="lucide lucide-square size-3.5 opacity-0"></svg>'}</span></div>`;

  it('seules les cartes avec ✓ sont retournées, avec leur identifiant exact, et le compte correspond à la barre du site', () => {
    page('Quitter la sélection', realTile('Meg Ryan', 'id-1', false) + realTile('Tour de France Femmes 2024', 'id-2', true) + realTile('Djilsi', 'id-3', true) + realTile('Backrooms', 'id-4', false), SITE_BAR(2));
    const selected = selectedCollectionCards();
    expect(selected.map(nativeCardTitle)).toEqual(['Tour de France Femmes 2024', 'Djilsi']);
    expect(selected.map(nativeCardSiteId)).toEqual(['id-2', 'id-3']);
    expect(selected.length).toBe(siteSelectedCount());
  });

  it('case visible mais vide (lucide-square) : non cochée, même avec un calque coloré', () => {
    document.body.innerHTML = `<main>${realTile('Meg Ryan', 'id-1', false)}</main>`;
    const card = document.querySelector('[data-wiky-ref]')!;
    expect(isCardSelected(card, true)).toBe(false);
  });
});
