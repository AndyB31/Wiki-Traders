// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { updateOverlay } from '../src/content/overlay';
import { DEFAULT_SELECTORS } from '../src/content/parsers/selectors';
import { card, cardsById, input } from './helpers';

function mountRealTile(id: string): Element {
  const wrap = document.createElement('div');
  wrap.className = 'relative isolate group';
  wrap.innerHTML = `<div class="w-[clamp(8.4rem,43vw,10rem)] glow-r relative" data-wm-premium-fx="1"><img alt="" src="/rare.png"><h3>${id}</h3>
    <div class="absolute top-2 right-2 z-30"><button aria-label="Ajouter aux favoris"></button></div></div>`;
  document.querySelector('main')!.append(wrap);
  return wrap.firstElementChild!;
}

describe('surcouche de la collection', () => {
  it('pose les étiquettes sur le wrapper de la carte, avec leur couleur, sans pastille de prix', () => {
    document.body.innerHTML = '<main></main>';
    const a = mountRealTile('a');
    const b = mountRealTile('b');
    const store = {
      ...input({ cards: cardsById(card('a', { tags: ['Mettre au Enchère', 'Galaxy'], sitePrice: 40 }), card('b', { tags: [] })) }),
      pendingFocus: null,
    };
    updateOverlay({
      store,
      cfg: DEFAULT_SELECTORS,
      kind: 'collection',
      root: document.querySelector('main')!,
      tiles: new Map([['a', a], ['b', b]]),
      tagColors: new Map([['Mettre au Enchère', '#ff0095']]),
    });
    const box = a.parentElement!.querySelector<HTMLElement>(':scope > [data-wiky="tags"]')!;
    expect(box).not.toBeNull();
    // En haut, sur l'image : loin du titre et des badges « Moy. » de l'autre extension.
    expect(box.style.top).toBe('30px');
    expect(box.style.bottom).toBe('');
    expect([...box.querySelectorAll('span')].map((s) => s.textContent)).toEqual(['Mettre au Enchère', 'Galaxy']);
    expect(box.querySelector('span')!.style.background).toBe('rgb(255, 0, 149)');
    expect(b.parentElement!.querySelector('[data-wiky="tags"]')).toBeNull();
    expect(document.body.textContent).not.toContain('🪙');
  });

  it('désactivable dans les réglages', () => {
    document.body.innerHTML = '<main></main>';
    const a = mountRealTile('a');
    const store = { ...input({ cards: cardsById(card('a', { tags: ['Galaxy'] })) }), pendingFocus: null };
    store.settings.showTagOverlay = false;
    updateOverlay({ store, cfg: DEFAULT_SELECTORS, kind: 'collection', root: document.querySelector('main')!, tiles: new Map([['a', a]]) });
    expect(document.querySelector('[data-wiky="tags"]')).toBeNull();
  });

  it('ne touche pas au DOM des cartes quand rien ne change', async () => {
    document.body.innerHTML = '<main></main>';
    const a = mountRealTile('a');
    const store = { ...input({ cards: cardsById(card('a', { tags: ['Galaxy'] })) }), pendingFocus: null };
    const state = { store, cfg: DEFAULT_SELECTORS, kind: 'collection', root: document.querySelector('main')!, tiles: new Map([['a', a]]) };
    updateOverlay(state);
    const records: MutationRecord[] = [];
    const obs = new MutationObserver((r) => records.push(...r));
    obs.observe(document.querySelector('main')!, { childList: true, attributes: true, subtree: true });
    updateOverlay(state);
    updateOverlay(state);
    await Promise.resolve();
    obs.disconnect();
    expect(records).toHaveLength(0);
  });
});

describe('fenêtre de vente : un seul prix, celui de la proposition', () => {
  /** Carte dans deux étiquettes : la proposition (règle du slot) vaut 21, la 1re règle de la carte donnerait 25. */
  function setup(prefill = true) {
    document.body.innerHTML = `<main></main><div class="fixed inset-0 z-[60]"><div class="card-frame"><h2>Mettre aux enchères</h2><p>Zico</p>
      <label>Mise de départ</label><input type="number" aria-label="Mise de départ" value="10"><button>Mettre aux enchères</button></div></div>`;
    const base = input({ cards: cardsById(card('zico', { name: 'Zico', tags: ['A', 'B'], sitePrice: 25 })) });
    base.rules = [
      { id: 'a', tag: 'A', quota: 1, pct: 100, floor: null, ceiling: null, keepMin: 0, active: true, match: 'tag' },
      { id: 'b', tag: 'B', quota: 1, pct: 84, floor: null, ceiling: null, keepMin: 0, active: true, match: 'tag' },
    ];
    base.settings.prefill = prefill;
    const store = { ...base, pendingFocus: { cardId: 'zico', cardName: 'Zico', price: 21, detail: 'moyenne site 25 × 84 % = 21', at: Date.now(), durationMin: null } };
    return { store, cfg: DEFAULT_SELECTORS, kind: 'collection', root: document.querySelector('main')!, tiles: null };
  }
  const value = () => document.querySelector<HTMLInputElement>('input[aria-label="Mise de départ"]')!.value;

  it('remplit le prix de la proposition (21), pas un recalcul avec une autre règle (25)', () => {
    const state = setup();
    updateOverlay(state);
    expect(value()).toBe('21');
    updateOverlay(state);
    expect(value()).toBe('21');
  });

  it('après le pré-remplissage V4, la surcouche ne réécrit pas la mise', async () => {
    const state = setup();
    const { fillSellPrice } = await import('../src/content/automation');
    fillSellPrice(DEFAULT_SELECTORS, 21);
    updateOverlay(state);
    expect(value()).toBe('21');
  });

  it('une valeur modifiée à la main n\'est jamais écrasée', () => {
    const state = setup();
    updateOverlay(state);
    document.querySelector<HTMLInputElement>('input[aria-label="Mise de départ"]')!.value = '30';
    updateOverlay(state);
    expect(value()).toBe('30');
  });
});

describe('style des étiquettes sur les cartes', () => {
  it('pastilles de couleur seulement : ronds colorés, nom au survol, sans texte', () => {
    document.body.innerHTML = '<main></main>';
    const a = mountRealTile('a');
    const store = { ...input({ cards: cardsById(card('a', { tags: ['Mettre au Enchère', 'Galaxy'] })) }), pendingFocus: null };
    store.settings.tagOverlayStyle = 'dot';
    const state = { store, cfg: DEFAULT_SELECTORS, kind: 'collection', root: document.querySelector('main')!, tiles: new Map([['a', a]]), tagColors: new Map([['Galaxy', '#ffdd00']]) };
    updateOverlay(state);
    const box = a.parentElement!.querySelector<HTMLElement>('[data-wiky="tags"]')!;
    const dots = [...box.querySelectorAll<HTMLElement>('span')];
    expect(dots.map((d) => d.title)).toEqual(['Mettre au Enchère', 'Galaxy']);
    expect(dots.every((d) => d.textContent === '')).toBe(true);
    expect(dots[1].style.background).toBe('rgb(255, 221, 0)');
    // Changer de style redessine les pastilles.
    store.settings.tagOverlayStyle = 'label';
    updateOverlay(state);
    expect(a.parentElement!.querySelector('[data-wiky="tags"] span')!.textContent).toBe('Mettre au Enchère');
  });
});
