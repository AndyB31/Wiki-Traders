import { describe, expect, it } from 'vitest';
import { adviceForCard, allocate, cardMatchesRule, makeContext } from '../src/lib/allocation';
import { planAutoTags } from '../src/lib/autotag';
import { conditionsSummary, EMPTY_CONDITIONS } from '../src/lib/conditions';
import { DEFAULT_SETTINGS } from '../src/lib/defaults';
import { newFamily } from '../src/lib/families';
import { evalFormula, formulaError } from '../src/lib/formula';
import { rateOf, type SellRate } from '../src/lib/sellrate';
import type { Card, RuleConditions, RuleSale, TagRule } from '../src/lib/types';
import { validateOptions } from '../src/ui/options-logic';
import { NOW, card, cardsById, input } from './helpers';

const rate = (sold: number, total: number): SellRate => rateOf({ rate: { sold, total } })!;
const rates = (byId: Record<string, SellRate>) => (c: Card) => byId[c.id] ?? null;
const rule = (tag: string, over: Partial<TagRule> = {}): TagRule => ({ id: `r-${tag}`, tag, quota: 1, pct: 100, floor: null, ceiling: null, keepMin: 0, active: true, match: 'tag', ...over });
const when = (over: Partial<RuleConditions>): RuleConditions => ({ ...EMPTY_CONDITIONS, ...over });
const sale = (over: Partial<RuleSale>): RuleSale => ({ minSellRate: null, sellRateRules: [], durationRules: [], sort: 'desc', score: '', ...over });

describe('formules de score', () => {
  it('calcule avec variables, priorités, fonctions et comparaisons', () => {
    const v = { prix: 40, tdv: 50, doublons: 2 };
    expect(evalFormula('{prix} * {tdv} / 100 + {doublons} * 10', v)).toBe(40);
    expect(evalFormula('2 ^ 3 ^ 2', {})).toBe(512);
    expect(evalFormula('-{prix} + max(1, 5, 3)', v)).toBe(-35);
    expect(evalFormula('si({tdv} < 20, 0, {prix})', v)).toBe(40);
    expect(evalFormula('{tdv} >= 50 && !({prix} > 100)', v)).toBe(1);
    expect(evalFormula('arrondi(1.6) + plancher(1.6) + racine(9)', {})).toBe(6);
    expect(evalFormula('{quantite}', {})).toBe(0);
    expect(evalFormula('1 / 0', {})).toBeNull();
  });

  it('erreurs lisibles, avec la position', () => {
    expect(formulaError('{prix} * 2')).toBeNull();
    expect(formulaError('{prix * 2')).toBe('« { » sans « } » (caractère 1)');
    expect(formulaError('{cote} + 1')).toBe('variable inconnue {cote} (caractère 1)');
    expect(formulaError('prix + 1')).toContain('fonction inconnue « prix »');
    expect(formulaError('max(1')).toContain('« ) » attendu');
    expect(formulaError('1 2')).toContain('en trop');
    expect(formulaError('si(1, 2)')).toContain('mauvais nombre d\'arguments');
  });
});

describe('étiquetage automatique avec conditions', () => {
  const films = newFamily('Films', [], [{ siteId: 's-titanic', title: 'Titanic (film)', rarity: 'R', category: null, imageUrl: null, wikipediaUrl: null, atk: null, def: null }], NOW);
  const cards = cardsById(
    card('france', { name: 'France', category: 'Pays', sitePrice: 30 }),
    card('perou', { name: 'Pérou', category: 'Pays d\'Amérique', sitePrice: 80, tags: ['Films'] }),
    card('titanic', { name: 'Titanic (film)', siteId: 's-titanic', sitePrice: 30 }),
    card('lyon', { name: 'Lyon', category: 'Ville', sitePrice: 30, tags: ['Pays'] }),
  );
  const rules = [
    rule('20-50', { floor: 20, ceiling: 50 }),
    rule('50-100', { floor: 50, ceiling: 100 }),
    rule('Pays', { when: when({ text: 'PAYS, nation' }) }),
    rule('Films', { when: when({ family: 'films' }) }),
    rule('Invendable', { when: when({ rateMax: 15 }) }),
  ];
  const plan = (sellRate = rates({})) =>
    Object.fromEntries(planAutoTags(input({ cards, rules, myFamilies: [films], sellRate }), { removeOthers: true }, NOW).map((c) => [c.cardId, c]));

  it('texte (sans accents ni majuscules), famille et plage s\'ajoutent ; une condition non remplie retire l\'étiquette', () => {
    const p = plan();
    expect(p.france).toMatchObject({ target: '20-50, Pays', add: ['20-50', 'Pays'], remove: [] });
    expect(p.perou).toMatchObject({ target: '50-100, Pays', add: ['50-100', 'Pays'], remove: ['Films'] });
    expect(p.titanic).toMatchObject({ target: '20-50, Films', add: ['20-50', 'Films'] });
    expect(p.lyon).toMatchObject({ target: '20-50', add: ['20-50'], remove: ['Pays'] });
  });

  it('taux de vente : posé sous le seuil, jamais décidé sur trop peu d\'enchères', () => {
    const p = plan(rates({ france: rate(1, 10), lyon: rate(0, 3) }));
    expect(p.france.add).toContain('Invendable');
    expect(p.lyon.add).not.toContain('Invendable');
    expect(conditionsSummary(rules[2])).toBe('nom contient « PAYS » ou « nation »');
  });

  it('appartenance « prix dans la plage » : les conditions comptent, sans plage le prix n\'est pas nécessaire', () => {
    const ctx = makeContext(input({ cards, rules, myFamilies: [films] }), NOW);
    expect(cardMatchesRule(cards.france, rule('Pays', { match: 'price', when: when({ text: 'pays' }) }), ctx)).toBe(true);
    expect(cardMatchesRule(cards.lyon, rule('Pays', { match: 'price', when: when({ text: 'pays' }) }), ctx)).toBe(false);
    expect(cardMatchesRule(cards.france, rule('x', { match: 'price', floor: 50, when: when({ text: 'pays' }) }), ctx)).toBe(false);
  });
});

describe('réglages de vente par étiquette', () => {
  const cheap = (id: string, over: Partial<Card> = {}) => card(id, { tags: ['20-50'], sitePrice: 40, ...over });
  const rules20 = (s?: RuleSale) => [rule('20-50', { quota: 3, pct: 50, sale: s })];
  const proposed = (cards: Record<string, Card>, s: RuleSale | undefined, sellRate = rates({})) =>
    allocate(input({ cards, rules: rules20(s), sellRate, settings: { ...DEFAULT_SETTINGS, rounding: 1 } }), NOW).free.map((f) => f.proposal?.card.id ?? null);

  it('tdv minimum propre à l\'étiquette, à la place du global', () => {
    const cards = cardsById(cheap('a'), cheap('b'));
    const sellRate = rates({ a: rate(1, 10), b: rate(9, 10) });
    expect(proposed(cards, sale({ minSellRate: 20 }), sellRate)).toEqual(['b', null, null]);
    expect(proposed(cards, undefined, sellRate).sort()).toEqual(['a', 'b', null].sort());
  });

  it('ordre « meilleur taux de vente » et « formule de score »', () => {
    const cards = cardsById(cheap('a', { sitePrice: 45 }), cheap('b', { sitePrice: 25 }), cheap('c', { sitePrice: 30, quantity: 3 }));
    const sellRate = rates({ a: rate(2, 10), b: rate(9, 10), c: rate(5, 10) });
    // Doublons d'abord, puis le meilleur tdv.
    expect(proposed(cards, sale({ sort: 'rate' }), sellRate)).toEqual(['c', 'b', 'a']);
    // Score = prix × tdv : a 9, b 22.5, c 15.
    expect(proposed(cards, sale({ sort: 'score', score: '{prix} * {tdv} / 100' }), sellRate)).toEqual(['b', 'c', 'a']);
    // Formule invalide : cartes classées par nom.
    expect(proposed(cards, sale({ sort: 'score', score: '{prix' }), sellRate)).toEqual(['a', 'b', 'c']);
  });

  it('paliers de prix et de durée propres à l\'étiquette', () => {
    const cards = cardsById(cheap('a'));
    const s = sale({ sellRateRules: [{ from: null, to: 30, adjust: -50 }], durationRules: [{ from: null, to: 15, minutes: 10 }] });
    const advice = adviceForCard(input({ cards, rules: rules20(s), sellRate: () => rate(1, 10), settings: { ...DEFAULT_SETTINGS, rounding: 1 } }), 'a', NOW)!;
    expect(advice.pricing).toMatchObject({ price: 10, durationMin: 10 });
    const global = adviceForCard(input({ cards, rules: rules20(), sellRate: () => rate(1, 10), settings: { ...DEFAULT_SETTINGS, rounding: 1 } }), 'a', NOW)!;
    expect(global.pricing).toMatchObject({ price: 20, durationMin: null });
  });

  it('validation : conditions et réglages de l\'étiquette', () => {
    const errors = validateOptions(
      [rule('X', { when: when({ rateMin: 60, rateMax: 40 }), sale: sale({ sort: 'score', score: '{prix} +', durationRules: [{ from: 0, to: 20, minutes: 10 }, { from: 10, to: 30, minutes: 60 }] }) })],
      DEFAULT_SETTINGS,
    ).map((e) => e.message);
    expect(errors).toEqual([
      '« X » : taux de vente : « de » dépasse « à ».',
      '« X » : Les paliers de durée 1 et 2 se chevauchent.',
      '« X » : formule de score : formule incomplète (caractère 9).',
    ]);
  });
});
