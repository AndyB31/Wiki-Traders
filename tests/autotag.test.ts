import { describe, expect, it } from 'vitest';
import { diagnoseAutoTags, planAutoTags, ruleForPrice } from '../src/lib/autotag';
import { NOW, card, cardsById, input, sales } from './helpers';

describe('ruleForPrice', () => {
  const rules = input().rules;
  it('plage contenant le prix, la plus étroite', () => {
    expect(ruleForPrice(rules, 30)?.tag).toBe('20-50');
    expect(ruleForPrice(rules, 80)?.tag).toBe('50-100');
    expect(ruleForPrice(rules, 50)?.tag).toBe('20-50');
    expect(ruleForPrice(rules, 500)).toBeNull();
  });
});

describe('planAutoTags', () => {
  it('ajoute la bonne étiquette et retire les autres', () => {
    const cards = cardsById(
      card('a', { sitePrice: 80, tags: ['20-50', 'perso'] }),
      card('b', { sitePrice: 30, tags: ['20-50'] }),
      card('c'),
      card('d', { tags: [] }),
    );
    const plan = planAutoTags(input({ cards, priceObs: sales('d', [25, 30, 35]) }), true, NOW);
    expect(plan).toEqual([
      { cardId: 'a', cardName: 'a', base: 80, target: '50-100', add: ['50-100'], remove: ['20-50'] },
      { cardId: 'd', cardName: 'd', base: 30, target: '20-50', add: ['20-50'], remove: [] },
    ]);
  });
  it('sans retrait, garde les anciennes étiquettes', () => {
    const plan = planAutoTags(input({ cards: cardsById(card('a', { sitePrice: 80, tags: ['20-50'] })) }), false, NOW);
    expect(plan[0].remove).toEqual([]);
  });
});

describe('diagnoseAutoTags', () => {
  it('compte règles avec plage et cartes au prix connu', () => {
    const base = input({ cards: cardsById(card('a', { sitePrice: 30 }), card('b')) });
    expect(diagnoseAutoTags(base, NOW)).toEqual({ cards: 2, rulesWithRange: 2, pricedCards: 1, unpricedCards: 1 });
    base.rules = base.rules.map((r) => ({ ...r, floor: null, ceiling: null }));
    expect(diagnoseAutoTags(base, NOW).rulesWithRange).toBe(0);
  });
});

describe('favoris', () => {
  it('ne sont jamais réétiquetés', () => {
    const cards = cardsById(card('fav', { sitePrice: 80, tags: ['20-50'], favorite: true }), card('autre', { sitePrice: 80, tags: ['20-50'] }));
    expect(planAutoTags(input({ cards }), true, NOW).map((c) => c.cardId)).toEqual(['autre']);
  });
});

describe('étiquetage auto : prix propre à la carte uniquement', () => {
  const rule20100 = { id: 'r', tag: '20-100', quota: 1, pct: 70, floor: 20, ceiling: 100, keepMin: 0, active: true, match: 'tag' as const };
  const rarityObs = Array.from({ length: 6 }, (_, i) => ({ cardId: `autre${i}`, price: 40, type: 'sold' as const, at: NOW - 1000, rarity: 'C' as const }));

  it('ne classe pas une carte d\'après la médiane de sa rareté', () => {
    const base = input({ cards: cardsById(card('sans-prix', { rarity: 'C' })), priceObs: rarityObs });
    base.rules = [rule20100];
    expect(planAutoTags(base, { removeOthers: true }, NOW)).toEqual([]);
  });

  it('prix propre hors de toutes les plages (6, 134) : l\'étiquette de plage est retirée', () => {
    const base = input({ cards: cardsById(card('six', { sitePrice: 6, tags: ['20-100', 'Galaxy'] }), card('cent34', { sitePrice: 134, tags: ['20-100'] }), card('ok', { sitePrice: 50, tags: ['20-100'] })) });
    base.rules = [rule20100];
    const plan = planAutoTags(base, { removeOthers: true }, NOW);
    expect(plan.map((c) => [c.cardId, c.target, c.remove])).toEqual([
      ['cent34', '', ['20-100']],
      ['six', '', ['20-100']],
    ]);
  });

  it('nettoyage : retire les étiquettes de plage des cartes sans prix propre (si demandé)', () => {
    const base = input({ cards: cardsById(card('inconnue', { rarity: 'C', tags: ['20-100', 'Galaxy'] })), priceObs: rarityObs });
    base.rules = [rule20100];
    expect(planAutoTags(base, { removeOthers: true }, NOW)).toEqual([]);
    expect(planAutoTags(base, { removeOthers: true, clearUnpriced: true }, NOW)).toEqual([
      { cardId: 'inconnue', cardName: 'inconnue', base: null, target: '', add: [], remove: ['20-100'] },
    ]);
  });

  it('un prix moyen de 0 affiché par le site est ignoré', () => {
    const base = input({ cards: cardsById(card('zero', { sitePrice: 0, tags: [] })) });
    base.rules = [{ ...rule20100, floor: 0 }];
    expect(planAutoTags(base, { removeOthers: true }, NOW)).toEqual([]);
  });

  it('une seule vente de la carte suffit comme prix propre', () => {
    const base = input({ cards: cardsById(card('une', { tags: [] })), priceObs: [{ cardId: 'une', price: 60, type: 'sold', at: NOW - 1000 }] });
    base.rules = [rule20100];
    expect(planAutoTags(base, { removeOthers: true }, NOW)[0]).toMatchObject({ cardId: 'une', target: '20-100', base: 60 });
  });
});

describe('prix moyen de chaque carte (ventes du site)', () => {
  it('une carte sans vente récente est classée grâce à la moyenne de toutes ses ventes (dans sa rareté)', async () => {
    const { catalogPriceOf } = await import('../src/lib/autotag');
    const cards = cardsById(card('vieille', { siteId: 's1', rarity: 'R' }), card('jamais', { siteId: 's2' }), card('sansid'));
    const cache = { s1: { mean: 90, count: 5, byRarity: { R: { mean: 62, count: 4 } } }, s2: { mean: null, count: 0 } };
    const base = input({ cards });
    // Sans les prix moyens : aucune carte classée (pas de vente sur 7 jours, pas de prix du site).
    expect(planAutoTags(base, { removeOthers: true })).toEqual([]);
    const extraPrice = catalogPriceOf(cache);
    const plan = planAutoTags(base, { removeOthers: true, extraPrice });
    expect(plan.map((c) => [c.cardId, c.base, c.target])).toEqual([['vieille', 62, '50-100']]);
    expect(diagnoseAutoTags(base, NOW, extraPrice)).toMatchObject({ pricedCards: 1, unpricedCards: 2 });
  });
});
