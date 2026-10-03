import { describe, expect, it } from 'vitest';
import { adviceForCard, allocate, freeSlotCount, quotaSum, sellableCards } from '../src/lib/allocation';
import { NOW, auction, card, cardsById, input, sales } from './helpers';

const big = (id: string, over = {}) => card(id, { tags: ['50-100'], sitePrice: 100, ...over });
const small = (id: string, over = {}) => card(id, { tags: ['20-50'], sitePrice: 40, ...over });

describe('allocate', () => {
  it('remplit 1 × « 50-100 » + 4 × « 20-50 » quand tout est libre', () => {
    const cards = cardsById(big('b1'), small('s1'), small('s2'), small('s3'), small('s4'), small('s5'));
    const res = allocate(input({ cards }), NOW);
    expect(res.free).toHaveLength(5);
    expect(res.free.filter((s) => s.rule.tag === '50-100')).toHaveLength(1);
    expect(res.free.filter((s) => s.rule.tag === '20-50')).toHaveLength(4);
    expect(res.free.find((s) => s.rule.tag === '50-100')?.proposal?.pricing.price).toBe(70);
    // Jamais deux fois la même carte.
    const ids = res.free.map((s) => s.proposal?.card.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('calcule le manque à partir des enchères en cours', () => {
    const cards = cardsById(big('b1'), big('b2'), small('s1'), small('s2'), small('s3'));
    const myAuctions = [auction('a1', 'b1'), auction('a2', 's1'), auction('a3', 's2')];
    const res = allocate(input({ cards, myAuctions }), NOW);
    expect(res.busy).toHaveLength(3);
    expect(res.free).toHaveLength(2);
    expect(res.free.every((s) => s.rule.tag === '20-50')).toBe(true);
    // b2 n'est pas proposée (quota 50-100 rempli), s1/s2 sont déjà en vente.
    expect(res.free[0].proposal?.card.id).toBe('s3');
    expect(res.free[1].proposal).toBeNull();
  });

  it('une enchère terminée libère son slot', () => {
    const cards = cardsById(small('s1'), small('s2'));
    const myAuctions = [auction('a1', 's1', { endsAt: NOW - 1000 })];
    expect(freeSlotCount(input({ cards, myAuctions }), NOW)).toBe(5);
  });

  it('une enchère hors règles occupe un slot sans casser les quotas', () => {
    const cards = cardsById(big('b1'), small('s1'), small('s2'), small('s3'), small('s4'), card('x', { tags: ['autre'] }));
    const myAuctions = [auction('a1', 'x')];
    const res = allocate(input({ cards, myAuctions }), NOW);
    expect(res.busy[0].rule).toBeNull();
    expect(res.free).toHaveLength(4);
    // La règle au plus gros quota passe en premier.
    expect(res.free.filter((s) => s.rule.tag === '20-50')).toHaveLength(4);
  });

  it('respecte « garder au moins », favoris et liste noire', () => {
    const cards = cardsById(small('last', { quantity: 1 }), small('fav', { favorite: true }), small('black'), small('ok'));
    const base = input({ cards });
    base.settings.blacklist = ['black'];
    const res = allocate(base, NOW);
    const proposed = res.free.map((s) => s.proposal?.card.id).filter(Boolean);
    expect(proposed).toEqual(['ok']);
  });

  it('classe par doublons puis par prix', () => {
    const cards = cardsById(small('cheap3', { quantity: 3, sitePrice: 30 }), small('rich2', { sitePrice: 70 }), small('mid2', { sitePrice: 50 }));
    const res = allocate(input({ cards }), NOW);
    const order = res.free.filter((s) => s.rule.tag === '20-50').map((s) => s.proposal?.card.id);
    expect(order.slice(0, 3)).toEqual(['cheap3', 'rich2', 'mid2']);

    const asc = input({ cards });
    asc.settings.sortPrice = 'asc';
    const order2 = allocate(asc, NOW).free.filter((s) => s.rule.tag === '20-50').map((s) => s.proposal?.card.id);
    expect(order2.slice(0, 3)).toEqual(['cheap3', 'mid2', 'rich2']);
  });

  it('bascule sur l\'étiquette de secours', () => {
    const cards = cardsById(small('s1'), small('s2'), small('s3'), small('s4'), small('s5'));
    const base = input({ cards });
    base.settings.fallbackTag = '20-50';
    const res = allocate(base, NOW);
    const slot = res.free.find((s) => s.fromRule?.tag === '50-100');
    expect(slot?.rule.tag).toBe('20-50');
    expect(slot?.proposal?.card.id).toBeDefined();
  });

  it('applique le choix manuel de carte et les slots ignorés', () => {
    const cards = cardsById(big('b1'), big('b2', { sitePrice: 60 }));
    const res = allocate(input({ cards, slotOverrides: { 'r-50-100:0': 'b2' }, ignoredSlots: ['r-20-50:0'] }), NOW);
    expect(res.free.find((s) => s.key === 'r-50-100:0')?.proposal?.card.id).toBe('b2');
    expect(res.free.find((s) => s.key === 'r-20-50:0')?.ignored).toBe(true);
  });

  it('autorise une carte déjà en vente si l\'option est active', () => {
    const cards = cardsById(small('s1', { quantity: 4 }));
    const base = input({ cards, myAuctions: [auction('a1', 's1')] });
    expect(allocate(base, NOW).free.some((s) => s.proposal)).toBe(false);
    base.settings.allowDuplicateListing = true;
    // 4 exemplaires − 1 gardé − 1 en vente = 2 propositions possibles.
    expect(allocate(base, NOW).free.filter((s) => s.proposal?.card.id === 's1')).toHaveLength(2);
  });

  it('règle par plage de prix quand les étiquettes ne sont pas lisibles', () => {
    const cards = cardsById(card('a'), card('b', { sitePrice: 30 }), card('c', { sitePrice: 80 }));
    const base = input({ cards, priceObs: sales('a', [60, 70, 80]) });
    base.rules = base.rules.map((r) => ({ ...r, match: 'price' as const }));
    const res = allocate(base, NOW);
    const big = res.free.find((s) => s.rule.tag === '50-100');
    expect(['a', 'c']).toContain(big?.proposal?.card.id);
    expect(res.free.filter((s) => s.rule.tag === '20-50').map((s) => s.proposal?.card.id)).toContain('b');
  });

  it('prochaine fin d\'enchère', () => {
    const myAuctions = [auction('a1', 'x', { endsAt: NOW + 5000 }), auction('a2', 'y', { endsAt: NOW + 1000 })];
    expect(allocate(input({ myAuctions }), NOW).nextEnd).toBe(NOW + 1000);
  });
});

describe('aides', () => {
  it('adviceForCard et sellableCards', () => {
    const cards = cardsById(big('b1'), small('s1', { quantity: 1 }));
    const advice = adviceForCard(input({ cards }), 'b1', NOW);
    expect(advice?.rule.tag).toBe('50-100');
    expect(advice?.pricing.price).toBe(70);
    const sellable = sellableCards(input({ cards }), NOW);
    expect([...sellable.keys()]).toEqual(['b1']);
  });
  it('quotaSum ignore les règles inactives', () => {
    const rules = input().rules;
    expect(quotaSum(rules)).toBe(5);
    rules[0].active = false;
    expect(quotaSum(rules)).toBe(4);
  });
});

describe('explications', () => {
  it('slot vide : cartes bloquées par « garder au moins »', () => {
    const cards = cardsById(small('s1', { quantity: 1 }), small('s2', { quantity: 1, favorite: true }));
    const slot = allocate(input({ cards }), NOW).free.find((s) => s.rule.tag === '20-50')!;
    expect(slot.proposal).toBeNull();
    expect(slot.excluded).toEqual({ total: 2, favorite: 1, blacklist: 0, onSale: 0, keep: 1 });
  });
});
