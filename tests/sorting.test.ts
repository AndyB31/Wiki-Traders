import { describe, expect, it } from 'vitest';
import { allocate } from '../src/lib/allocation';
import { newTier } from '../src/lib/salecalc';
import { rateOf, type SellRate } from '../src/lib/sellrate';
import { criteriaSummary } from '../src/lib/sorting';
import type { Card, Settings, SortCriterion, TagRule } from '../src/lib/types';
import { validateOptions } from '../src/ui/options-logic';
import { NOW, TEST_SETTINGS, card, cardsById, input, pctCalc } from './helpers';

const rate = (sold: number, total: number): SellRate => rateOf({ rate: { sold, total } })!;
const rates = (byId: Record<string, SellRate>) => (c: Card) => byId[c.id] ?? null;
const rule = (tag: string, over: Partial<TagRule> = {}): TagRule => ({ id: `r-${tag}`, tag, quota: 3, calc: pctCalc(100), floor: null, ceiling: null, keepMin: 0, active: true, match: 'tag', ...over });
const settings = (over: Partial<Settings>): Settings => ({ ...TEST_SETTINGS, rounding: 1, slots: 3, ...over });
const c = (id: string, tag: string, price: number, over: Partial<Card> = {}) => card(id, { tags: [tag], sitePrice: price, ...over });

describe('tri multi-critères', () => {
  const cards = cardsById(c('a', 'T', 40), c('b', 'T', 40), c('c', 'T', 30), c('d', 'T', 50));
  // a et b au même prix : départagées par le tdv, puis le nombre de ventes ; d sans tdv fiable.
  const sellRate = rates({ a: rate(6, 10), b: rate(30, 50), c: rate(9, 10), d: rate(1, 2) });
  const order = (criteria: SortCriterion[]) =>
    allocate(input({ cards, rules: [rule('T', { quota: 4 })], sellRate, settings: settings({ slots: 4, priority: 'custom', duplicatesFirst: false, sortCriteria: criteria }) }), NOW).free.map((f) => f.proposal?.card.id);

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

});

describe('mode « meilleures cartes »', () => {
  const cards = cardsById(c('a', '20-50', 45), c('b', '20-50', 25), c('p', 'Pays', 90), c('q', 'Pays', 60), c('x', 'Gardée', 99), c('both', '20-50', 30, { tags: ['20-50', 'Pays'] }));
  const run = (over: Partial<Settings> = {}, poolOffset = 0, sellRate = rates({})) =>
    allocate(input({ cards, poolOffset, sellRate, settings: settings({ allocationMode: 'pool', keepMin: 0, saleTags: { mode: 'exclude', tags: ['Gardée'] }, ...over }) }), NOW);
  const ids = (r: ReturnType<typeof run>) => r.free.map((f) => f.proposal?.card.id);

  it('sans palier : les meilleures cartes, sauf les étiquettes exclues, une fois chacune', () => {
    const res = run();
    // 70 % : p 63, q 42, a 31.5 → 30 (arrondi 1 → 32), both 21, b 18 ; x exclue.
    expect(ids(res)).toEqual(['p', 'q', 'a']);
    expect(res.free.every((f) => f.pool && f.rule.tag === 'Toutes les cartes')).toBe(true);
    expect(res.pool).toEqual({ size: 5, offset: 0 });
    expect(ids(run({ saleTags: { mode: 'include', tags: ['Pays'] } }))).toEqual(['p', 'q', 'both']);
    expect(ids(run({ saleTags: { mode: 'include', tags: [] } }))).toEqual([undefined, undefined, undefined]);
  });

  it('« Suivant » : page suivante, en boucle', () => {
    expect(ids(run({}, 3))).toEqual(['both', 'b', 'p']);
    expect(run({}, 8).pool).toEqual({ size: 5, offset: 3 });
  });

  it('paliers de prix : chacun son calcul et son minimum ; hors paliers, pas proposé', () => {
    const low = { ...newTier(null, 40), calc: { ...pctCalc(100), minPrice: 30 } };
    const high = newTier(41, 80);
    const res = run({ priceTiers: [low, high] });
    // low (100 %, min 30) : a 45 → hors palier (> 40) ; b 25 → 30, both 30. high (défaut 70 %) : a 32, q 42 ; p (90) hors paliers.
    expect(ids(res)).toEqual(['q', 'a', 'b']);
    expect(res.free.map((f) => f.rule.tag)).toEqual(['41–80 W', '41–80 W', 'jusqu\'à 40 W']);
    expect(res.free[2].proposal!.pricing.detail).toContain('minimum 30');
  });

  it('slots réservés par palier (option), le reste aux meilleures cartes', () => {
    const low = { ...newTier(null, 40), slots: 2 };
    const high = { ...newTier(41, null), slots: 0 };
    expect(ids(run({ priceTiers: [low, high] }))).toEqual(['p', 'q', 'a']);
    const res = run({ priceTiers: [low, high], reserveTierSlots: true });
    expect(ids(res)).toEqual(['both', 'b', 'p']);
    expect(res.free.map((f) => f.key)).toEqual([`${low.id}:0`, `${low.id}:1`, 'pool:0']);
  });

  it('priorité équilibrée : prix × chance de vente', () => {
    // q (42) se vend 9 fois sur 10 : 42 × 0,9 = 37,8 > p (63) vendue 1 fois sur 10 : 63 × 0,1 = 6,3.
    const sellRate = rates({ p: rate(1, 10), q: rate(9, 10) });
    expect(ids(run({ priority: 'balanced' }, 0, sellRate)).slice(0, 2)).toEqual(['q', 'a']);
    expect(ids(run({ priority: 'value' }, 0, sellRate)).slice(0, 2)).toEqual(['p', 'q']);
  });

  it('les quotas des étiquettes ne bloquent pas l\'enregistrement en mode meilleures cartes', () => {
    const over = [rule('20-50', { quota: 9 })];
    expect(validateOptions(over, settings({ allocationMode: 'pool' })).filter((e) => e.message.includes('quotas'))).toEqual([]);
    expect(validateOptions(over, settings({ allocationMode: 'quota' })).some((e) => e.message.includes('quotas'))).toBe(true);
  });
});
