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
    expect(diagnoseAutoTags(base, NOW)).toEqual({ cards: 2, rulesWithRange: 2, pricedCards: 1 });
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
