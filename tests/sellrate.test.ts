import { describe, expect, it } from 'vitest';
import { adviceForCard, allocate } from '../src/lib/allocation';
import { DEFAULT_CALC, inheritCalc } from '../src/lib/salecalc';
import { migrateRateRules, rateOf, type SellRate } from '../src/lib/sellrate';
import { migrateRules, migrateSettings } from '../src/lib/storage';
import type { Card, PriceCalc, Settings } from '../src/lib/types';
import { NOW, TEST_SETTINGS, card, cardsById, input } from './helpers';

const small = (id: string) => card(id, { tags: ['20-50'], sitePrice: 40 });
const rate = (sold: number, total: number): SellRate => rateOf({ rate: { sold, total } })!;
const rates = (byId: Record<string, SellRate>) => (c: Card) => byId[c.id] ?? null;
const settings = (over: Partial<Settings>): Settings => ({ ...TEST_SETTINGS, ...over });

describe('taux de vente minimum (A3)', () => {
  it('une carte sous le minimum n\'est pas proposée, et le slot vide dit pourquoi', () => {
    const cards = cardsById(small('bad'), small('good'));
    const sellRate = rates({ bad: rate(1, 10), good: rate(8, 10) });
    const res = allocate(input({ cards, sellRate, settings: settings({ minSellRate: 15 }) }), NOW);
    const slots = res.free.filter((s) => s.rule.tag === '20-50');
    expect(slots.map((s) => s.proposal?.card.id ?? null)).toEqual(['good', null, null, null]);
    expect(slots[1].excluded).toMatchObject({ total: 2, lowRate: 1 });
  });

  it('sous 5 enchères terminées, le tdv ne compte pas ; sans minimum, rien n\'est écarté', () => {
    const cards = cardsById(small('few'), small('bad'));
    const sellRate = rates({ few: rate(0, 4), bad: rate(0, 20) });
    const proposed = (s: Partial<Settings>) => allocate(input({ cards, sellRate, settings: settings(s) }), NOW).free.flatMap((f) => (f.proposal ? [f.proposal.card.id] : []));
    expect(proposed({ minSellRate: 15 })).toEqual(['few']);
    expect(proposed({ minSellRate: null }).sort()).toEqual(['bad', 'few']);
  });
});

describe('calcul du prix de départ', () => {
  const advise = (r: SellRate | null, calc: Partial<PriceCalc> = {}, over: Partial<Settings> = {}) =>
    adviceForCard(input({ cards: cardsById(small('c')), sellRate: () => r, settings: settings({ rounding: 1, defaultCalc: { ...DEFAULT_CALC, ...calc }, ...over }) }), 'c', NOW)!.pricing;

  it('simple : prix moyen × mise de départ × bonus du taux de vente, avec le détail', () => {
    // 40 × 70 % = 28 ; tdv 80 % sur 20 enchères, influence 50 % → × 1,15 = 32,2 ; tdv 20 % → × 0,85 = 23,8.
    expect(advise(rate(16, 20))).toMatchObject({ price: 32, rateAdjust: { pct: 80, pricePct: 115 } });
    expect(advise(rate(16, 20)).detail).toContain('× 70 % × 115 % (tdv 80 % sur 20) = 32');
    expect(advise(rate(4, 20)).price).toBe(24);
    expect(advise(rate(10, 20)).rateAdjust).toBeUndefined();
  });

  it('peu d\'enchères : le taux de vente compte en partie (1 vente sur 2 ≈ inchangé)', () => {
    // 2 enchères sur 10 pour être sûr : confiance 0,2 → 100 % : × 1,05 ; 0 % : × 0,95.
    expect(advise(rate(2, 2)).price).toBe(29);
    expect(advise(rate(1, 2)).price).toBe(28);
    expect(advise(null).price).toBe(28);
    expect(advise(rate(0, 20), { tdvWeight: 0 }).price).toBe(28);
  });

  it('prix minimum et maximum', () => {
    expect(advise(null, { minPrice: 35 })).toMatchObject({ price: 35 });
    expect(advise(null, { minPrice: 35 }).detail).toContain('→ minimum 35');
    expect(advise(null, { maxPrice: 20 }).price).toBe(20);
  });

  it('formule : variables de la carte, prix du calcul par défaut, formule invalide sans prix', () => {
    expect(advise(rate(9, 10), { mode: 'formula', formula: '{prix} * {tdv} / 100' }).price).toBe(36);
    expect(advise(null, { mode: 'formula', formula: 'max({prix_conseille}, 30)' }).price).toBe(30);
    expect(advise(null, { mode: 'formula', formula: '{prix} * 0' }).price).toBeNull();
  });

  it('une étiquette suit le calcul par défaut, ou le sien', () => {
    const cards = cardsById(small('c'));
    const rules = (calc?: PriceCalc) => [{ id: 'r', tag: '20-50', quota: 1, floor: null, ceiling: null, keepMin: 0, active: true, match: 'tag' as const, calc }];
    const price = (calc?: PriceCalc) => adviceForCard(input({ cards, rules: rules(calc), settings: settings({ rounding: 1 }) }), 'c', NOW)!.pricing.price;
    expect(price()).toBe(28);
    expect(price(inheritCalc())).toBe(28);
    expect(price({ ...DEFAULT_CALC, pct: 50 })).toBe(20);
  });
});

describe('réglages d\'avant la 1.0', () => {
  it('paliers de taux de vente : ajustement → % du prix', () => {
    expect(migrateRateRules([{ from: 80, to: null, adjust: 30 }, { from: null, to: 19, adjust: -50 }, { from: 0, to: 5, pricePct: 70 }])).toEqual([
      { from: 80, to: null, pricePct: 130 },
      { from: null, to: 19, pricePct: 50 },
      { from: 0, to: 5, pricePct: 70 },
    ]);
  });

  it('mise de départ et paliers deviennent un calcul qui donne les mêmes prix', () => {
    const stored = { sortPrice: 'asc', allocationMode: 'quota', sellRateRules: [{ from: 0, to: 42, adjust: -19 }] } as never;
    const s = migrateSettings(stored);
    expect(s).toMatchObject({ priority: 'clear', allocationMode: 'quota' });
    expect('sortPrice' in s || 'sellRateRules' in s).toBe(false);
    const [r50, r70] = migrateRules([{ id: 'a', tag: 'A', quota: 1, pct: 50, floor: null, ceiling: null, keepMin: 1, active: true, match: 'tag' }, { id: 'b', tag: 'B', quota: 1, pct: 70, floor: null, ceiling: null, keepMin: 1, active: true, match: 'tag' }] as never, stored);
    expect(r50.calc).toMatchObject({ mode: 'formula', formula: '{prix} * 0.5 * si({tdv_fiable}, si({tdv} >= 0 && {tdv} <= 42, 0.81, 1), 1)' });
    expect(r70.calc).toMatchObject({ mode: 'default' });
    expect(s.defaultCalc.formula).toBe('{prix} * 0.7 * si({tdv_fiable}, si({tdv} >= 0 && {tdv} <= 42, 0.81, 1), 1)');
    const cards = cardsById(small('c'));
    const price = (r: SellRate) => adviceForCard(input({ cards, rules: [{ ...r50, tag: '20-50' }], sellRate: () => r, settings: { ...s, rounding: 1 } }), 'c', NOW)!.pricing.price;
    // 40 × 50 % = 20 ; tdv 10 % (fiable) → × 0,81 = 16,2 ; sur 3 enchères seulement : inchangé.
    expect(price(rate(1, 10))).toBe(16);
    expect(price(rate(0, 3))).toBe(20);
  });

  it('ancien mode « meilleures cartes » : seulement les cartes des étiquettes suivies', () => {
    const rules = [{ id: 'a', tag: '20-50', quota: 1, pct: 70, floor: null, ceiling: null, keepMin: 1, active: true, match: 'tag' }] as never;
    expect(migrateSettings({ sortPrice: 'desc', allocationMode: 'pool' } as never, rules).saleTags).toEqual({ mode: 'include', tags: ['20-50'] });
    expect(migrateSettings({}).allocationMode).toBe('pool');
  });
});
