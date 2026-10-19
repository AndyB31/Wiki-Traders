import { describe, expect, it } from 'vitest';
import { adviceForCard, allocate } from '../src/lib/allocation';
import { DEFAULT_SETTINGS } from '../src/lib/defaults';
import { DEFAULT_RATE_TIERS, overlappingRateRules, rateOf, rateRuleFor, type SellRate } from '../src/lib/sellrate';
import type { Card, Settings } from '../src/lib/types';
import { validateOptions } from '../src/ui/options-logic';
import { NOW, card, cardsById, input } from './helpers';

const small = (id: string) => card(id, { tags: ['20-50'], sitePrice: 40 });
const rate = (sold: number, total: number): SellRate => rateOf({ rate: { sold, total } })!;
const rates = (byId: Record<string, SellRate>) => (c: Card) => byId[c.id] ?? null;
const settings = (over: Partial<Settings>): Settings => ({ ...DEFAULT_SETTINGS, ...over });

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

describe('prix selon le taux de vente (A2)', () => {
  const advise = (r: SellRate | null, over: Partial<Settings> = { sellRateRules: DEFAULT_RATE_TIERS }) =>
    adviceForCard(input({ cards: cardsById(small('c')), sellRate: () => r, settings: settings({ rounding: 1, ...over }) }), 'c', NOW)!.pricing;

  it('le palier du tdv ajuste le prix conseillé, avec le détail du calcul', () => {
    // 40 × 70 % = 28 ; tdv 90 % → +30 % ; tdv 10 % → −50 %.
    expect(advise(rate(9, 10))).toMatchObject({ price: 36, rateAdjust: { pct: 90, adjust: 30 } });
    expect(advise(rate(9, 10)).detail).toContain('× 70 % +30 % (tdv 90 %) = 36');
    expect(advise(rate(1, 10)).price).toBe(14);
    expect(advise(rate(6, 10))).toMatchObject({ price: 28 });
    expect(advise(rate(6, 10)).rateAdjust).toBeUndefined();
  });

  it('sans palier, tdv inconnu ou trop peu d\'enchères : prix inchangé', () => {
    expect(advise(rate(1, 10), { sellRateRules: [] }).price).toBe(28);
    expect(advise(null).price).toBe(28);
    expect(advise(rate(0, 3)).price).toBe(28);
  });

  it('paliers : premier qui correspond, chevauchements et saisies invalides signalés', () => {
    expect(rateRuleFor(80, DEFAULT_RATE_TIERS)?.adjust).toBe(30);
    expect(rateRuleFor(19, DEFAULT_RATE_TIERS)?.adjust).toBe(-50);
    expect(overlappingRateRules(DEFAULT_RATE_TIERS)).toBeNull();
    const errors = validateOptions([], settings({
      minSellRate: 120,
      sellRateRules: [{ from: 60, to: 40, adjust: 0 }, { from: 0, to: 50, adjust: -100 }],
    }));
    expect(errors.filter((e) => e.section === 'sellRate').map((e) => e.message)).toEqual([
      'Le taux de vente minimum doit être entre 0 et 100 %.',
      'Palier de taux de vente 1 : « de » dépasse « à ».',
      'Palier de taux de vente 2 : l\'ajustement doit être au-dessus de −100 %.',
    ]);
  });
});
