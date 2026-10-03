import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../src/lib/defaults';
import { computePrice, indexObs, median, roundTo, type PricingContext } from '../src/lib/pricing';
import type { PriceObs, TagRule } from '../src/lib/types';
import { DAY, NOW, card, cardsById, sales } from './helpers';

const rule: TagRule = { id: 'r', tag: '50-100', quota: 1, pct: 70, floor: 50, ceiling: 100, keepMin: 1, active: true, match: 'tag' };

function ctx(obs: PriceObs[] = [], over: Partial<PricingContext> = {}): PricingContext {
  return { settings: { ...DEFAULT_SETTINGS }, cards: {}, obsByCard: indexObs(obs), manualPrices: {}, now: NOW, ...over };
}

describe('computePrice', () => {
  it('moyenne × % arrondie à la dizaine (exemple de la spec)', () => {
    const c = card('a');
    const r = computePrice(c, { ...rule, floor: null }, ctx(sales('a', [80, 86, 92]), { settings: { ...DEFAULT_SETTINGS, stat: 'mean' } }));
    expect(r.price).toBe(60);
    expect(r.detail).toBe('moyenne 86 (3 ventes) × 70 % = 60');
    expect(r.estimate).toBe(false);
  });

  it('applique plancher et plafond', () => {
    const low = computePrice(card('a'), rule, ctx(sales('a', [40, 40, 40])));
    expect(low.price).toBe(50);
    expect(low.detail).toContain('→ plancher 50');
    const high = computePrice(card('b'), rule, ctx(sales('b', [500, 500, 500])));
    expect(high.price).toBe(100);
    expect(high.detail).toContain('→ plafond 100');
  });

  it('le prix affiché par le site est prioritaire', () => {
    const r = computePrice(card('a', { sitePrice: 120 }), rule, ctx(sales('a', [10, 10, 10])));
    expect(r.price).toBe(80);
    expect(r.base.source).toBe('site');
  });

  it('ignore les ventes hors fenêtre', () => {
    const old = sales('a', [300, 300, 300], 30);
    const recent = sales('a', [100, 100, 100], 1);
    expect(computePrice(card('a'), { ...rule, ceiling: null }, ctx([...old, ...recent])).base.value).toBe(100);
  });

  it('médiane en option', () => {
    const c = ctx(sales('a', [100, 100, 1000]), { settings: { ...DEFAULT_SETTINGS, stat: 'median' } });
    const r = computePrice(card('a'), { ...rule, ceiling: null }, c);
    expect(r.base.value).toBe(100);
    expect(r.detail.startsWith('médiane')).toBe(true);
  });

  it('sous 3 ventes : estimation par rareté dans l\'étiquette', () => {
    const peers = [card('a', { rarity: 'SR' }), card('b', { rarity: 'SR', sitePrice: 90 }), card('c', { rarity: 'SR', sitePrice: 70 })];
    const r = computePrice(peers[0], { ...rule, floor: null }, ctx(sales('a', [500])), peers);
    expect(r.base.value).toBe(80);
    expect(r.estimate).toBe(true);
    expect(r.detail).toContain('estimation 80');
  });

  it('sous 3 ventes sans pair de même rareté : estimation sur les quelques ventes', () => {
    const r = computePrice(card('a'), { ...rule, floor: null }, ctx(sales('a', [60, 80])));
    expect(r.base.value).toBe(70);
    expect(r.estimate).toBe(true);
  });

  it('prix saisi à la main', () => {
    const r = computePrice(card('a'), { ...rule, floor: null }, ctx([], { manualPrices: { a: 100 } }));
    expect(r.price).toBe(70);
    expect(r.base.source).toBe('manual');
  });

  it('aucune donnée : demande un prix', () => {
    const r = computePrice(card('a'), rule, ctx());
    expect(r.price).toBeNull();
    expect(r.detail).toContain('saisis un prix');
  });

  it('les enchères en cours ne comptent que si l\'option est active, une fois par enchère', () => {
    const listings: PriceObs[] = [
      { cardId: 'a', price: 50, type: 'listing', at: NOW - DAY, auctionId: 'x' },
      { cardId: 'a', price: 100, type: 'listing', at: NOW - DAY + 1000, auctionId: 'x' },
      { cardId: 'a', price: 100, type: 'listing', at: NOW - DAY, auctionId: 'y' },
    ];
    const base = sales('a', [100]);
    expect(computePrice(card('a'), rule, ctx([...base, ...listings])).base.source).toBe('estimate');
    const on = ctx([...base, ...listings], { settings: { ...DEFAULT_SETTINGS, includeListings: true } });
    const r = computePrice(card('a'), rule, on);
    expect(r.base.source).toBe('history');
    expect(r.base.samples).toBe(3);
    expect(r.base.value).toBe(100);
  });
});

describe('utilitaires', () => {
  it('roundTo', () => {
    expect(roundTo(63, 10)).toBe(60);
    expect(roundTo(65, 10)).toBe(70);
    expect(roundTo(3, 10)).toBe(10);
    expect(roundTo(63.4, 0)).toBe(63);
  });
  it('median', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(median([])).toBeNull();
  });
  it('cardsById', () => expect(Object.keys(cardsById(card('x'), card('y')))).toEqual(['x', 'y']));
});

describe('prix de référence par rareté', () => {
  const soldOf = (rarity: 'SR' | 'UR', prices: number[], shiny = false): PriceObs[] =>
    prices.map((price, i) => ({ cardId: `autre-${rarity}-${i}`, price, type: 'sold', at: NOW - DAY, rarity, shiny }));

  it('médiane des ventes de même rareté quand la carte n\'a pas d\'historique', () => {
    const r = computePrice(card('a', { rarity: 'SR' }), { ...rule, floor: null, ceiling: null }, ctx(soldOf('SR', [10, 15, 15, 20, 2000])));
    expect(r.base).toMatchObject({ source: 'rarity', value: 15, samples: 5 });
    expect(r.detail).toBe('médiane Super Rare 15 (5 ventes) × 70 % = 10');
    expect(r.estimate).toBe(false);
  });

  it('les brillantes sont cotées à part', () => {
    const obs = [...soldOf('SR', [10, 10, 10, 10, 10]), ...soldOf('SR', [100, 100, 100, 100, 100], true)];
    expect(computePrice(card('a', { rarity: 'SR', shiny: true }), { ...rule, floor: null, ceiling: null }, ctx(obs)).base.value).toBe(100);
  });

  it('sous 5 ventes : estimation à partir des enchères en cours de la rareté', () => {
    const listings: PriceObs[] = [20, 30, 40, 50, 60].map((price, i) => ({ cardId: `l${i}`, price, type: 'listing', at: NOW - DAY, auctionId: `x${i}`, rarity: 'UR' }));
    const r = computePrice(card('a', { rarity: 'UR' }), { ...rule, floor: null, ceiling: null }, ctx(listings));
    expect(r.base.source).toBe('estimate');
    expect(r.estimate).toBe(true);
    expect(r.detail).toContain('estimation Ultra Rare en vente');
  });

  it('l\'historique de la carte reste prioritaire', () => {
    const r = computePrice(card('a', { rarity: 'SR' }), { ...rule, ceiling: null }, ctx([...soldOf('SR', [10, 10, 10, 10, 10]), ...sales('a', [200, 200, 200])]));
    expect(r.base.source).toBe('history');
  });
});
