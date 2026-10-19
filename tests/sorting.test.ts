import { describe, expect, it } from 'vitest';
import { allocate } from '../src/lib/allocation';
import { DEFAULT_SETTINGS } from '../src/lib/defaults';
import { rateOf, type SellRate } from '../src/lib/sellrate';
import { criteriaSummary } from '../src/lib/sorting';
import type { Card, Settings, SortCriterion, TagRule } from '../src/lib/types';
import { validateOptions } from '../src/ui/options-logic';
import { NOW, card, cardsById, input } from './helpers';

const rate = (sold: number, total: number): SellRate => rateOf({ rate: { sold, total } })!;
const rates = (byId: Record<string, SellRate>) => (c: Card) => byId[c.id] ?? null;
const rule = (tag: string, over: Partial<TagRule> = {}): TagRule => ({ id: `r-${tag}`, tag, quota: 3, pct: 100, floor: null, ceiling: null, keepMin: 0, active: true, match: 'tag', ...over });
const settings = (over: Partial<Settings>): Settings => ({ ...DEFAULT_SETTINGS, rounding: 1, slots: 3, ...over });
const c = (id: string, tag: string, price: number, over: Partial<Card> = {}) => card(id, { tags: [tag], sitePrice: price, ...over });

describe('tri multi-critères', () => {
  const cards = cardsById(c('a', 'T', 40), c('b', 'T', 40), c('c', 'T', 30), c('d', 'T', 50));
  // a et b au même prix : départagées par le tdv, puis le nombre de ventes ; d sans tdv fiable.
  const sellRate = rates({ a: rate(6, 10), b: rate(30, 50), c: rate(9, 10), d: rate(1, 2) });
  const order = (criteria: SortCriterion[]) =>
    allocate(input({ cards, rules: [rule('T', { quota: 4 })], sellRate, settings: settings({ slots: 4, sortPrice: 'custom', sortCriteria: criteria }) }), NOW).free.map((f) => f.proposal?.card.id);

  it('chaque critère départage les égalités du précédent', () => {
    expect(order([{ key: 'prix', dir: 'desc' }, { key: 'tdv', dir: 'desc' }])).toEqual(['d', 'a', 'b', 'c']);
    expect(order([{ key: 'prix', dir: 'desc' }, { key: 'ventes', dir: 'desc' }])).toEqual(['d', 'b', 'a', 'c']);
    expect(order([{ key: 'prix', dir: 'asc' }])).toEqual(['c', 'a', 'b', 'd']);
  });

  it('une valeur inconnue passe en dernier, quel que soit le sens', () => {
    expect(order([{ key: 'tdv', dir: 'desc' }])).toEqual(['c', 'a', 'b', 'd']);
    expect(order([{ key: 'tdv', dir: 'asc' }])).toEqual(['a', 'b', 'c', 'd']);
    expect(criteriaSummary([{ key: 'prix', dir: 'desc' }, { key: 'tdv', dir: 'asc' }])).toBe('Prix conseillé ↓ › Taux de vente ↑');
  });

  it('ordre « selon mes critères » propre à une étiquette', () => {
    const r = rule('T', { quota: 4, sale: { minSellRate: null, sellRateRules: [], durationRules: [], sort: 'custom', score: '', sortCriteria: [{ key: 'ventes', dir: 'desc' }] } });
    const res = allocate(input({ cards, rules: [r], sellRate, settings: settings({ slots: 4 }) }), NOW);
    expect(res.free.map((f) => f.proposal?.card.id)).toEqual(['b', 'c', 'a', 'd']);
  });
});

describe('mode « meilleures cartes »', () => {
  const cards = cardsById(c('a', '20-50', 45), c('b', '20-50', 25), c('p', 'Pays', 90), c('q', 'Pays', 60), c('x', 'Autre', 99), c('both', '20-50', 30, { tags: ['20-50', 'Pays'] }));
  const rules = [rule('20-50', { quota: 3 }), rule('Pays', { quota: 0, pct: 50 })];
  const run = (poolOffset = 0, over: Partial<Settings> = {}) => allocate(input({ cards, rules, poolOffset, settings: settings({ allocationMode: 'pool', ...over }) }), NOW);

  it('les meilleures cartes de toutes les étiquettes actives, sans quota, une fois chacune', () => {
    const res = run();
    // Prix conseillé : a 45, both 30 (première règle), b 25, p 45 (50 %), q 30 ; « Autre » n'a pas de règle.
    expect(res.free.map((f) => f.proposal?.card.id)).toEqual(['a', 'p', 'both']);
    expect(res.free.map((f) => f.rule.tag)).toEqual(['20-50', 'Pays', '20-50']);
    expect(res.free.every((f) => f.pool)).toBe(true);
    expect(res.pool).toEqual({ size: 5, offset: 0 });
  });

  it('« Suivant » : page suivante, en boucle', () => {
    expect(run(3).free.map((f) => f.proposal?.card.id)).toEqual(['q', 'b', 'a']);
    expect(run(8).pool).toEqual({ size: 5, offset: 3 });
  });

  it('les quotas ne bloquent plus l\'enregistrement', () => {
    const over = [rule('20-50', { quota: 9 })];
    expect(validateOptions(over, settings({ allocationMode: 'pool' })).filter((e) => e.message.includes('quotas'))).toEqual([]);
    expect(validateOptions(over, settings({ allocationMode: 'quota' })).some((e) => e.message.includes('quotas'))).toBe(true);
  });
});
