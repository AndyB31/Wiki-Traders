import { describe, expect, it } from 'vitest';
import { adviceForCard, allocate, cardMatchesRule, makeContext } from '../src/lib/allocation';
import { planAutoTags } from '../src/lib/autotag';
import { conditionsSummary, EMPTY_CONDITIONS } from '../src/lib/conditions';
import { newFamily } from '../src/lib/families';
import { evalFormula, formulaError } from '../src/lib/formula';
import { rateOf, type SellRate } from '../src/lib/sellrate';
import type { Card, RuleConditions, TagRule } from '../src/lib/types';
import { validateOptions } from '../src/ui/options-logic';
import { migrateRules, migrateSettings } from '../src/lib/storage';
import { NOW, TEST_SETTINGS, card, cardsById, input, pctCalc } from './helpers';

const rate = (sold: number, total: number): SellRate => rateOf({ rate: { sold, total } })!;
const rates = (byId: Record<string, SellRate>) => (c: Card) => byId[c.id] ?? null;
const rule = (tag: string, over: Partial<TagRule> = {}): TagRule => ({ id: `r-${tag}`, tag, quota: 1, calc: pctCalc(100), floor: null, ceiling: null, keepMin: 0, active: true, match: 'tag', ...over });
const when = (over: Partial<RuleConditions>): RuleConditions => ({ ...EMPTY_CONDITIONS, ...over });

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

describe('étiquette par famille (onglet Familles)', () => {
  const films = newFamily('Films', [], [{ siteId: 's-titanic', title: 'Titanic (film)', rarity: 'R', category: null, imageUrl: null, wikipediaUrl: null, atk: null, def: null }], NOW);
  const cards = cardsById(card('titanic', { name: 'Titanic (film)', siteId: 's-titanic', sitePrice: 30 }), card('lyon', { name: 'Lyon', sitePrice: 30, tags: ['Cinéma'] }));

  it('pose l\'étiquette sur les cartes de la famille, la retire des autres', () => {
    const settings = { ...TEST_SETTINGS, familyTags: [{ id: 'x', active: true, family: 'Films', tag: 'Cinéma' }] };
    const plan = planAutoTags(input({ cards, rules: [], settings, myFamilies: [films] }), { removeOthers: true }, NOW);
    expect(plan.map((c) => [c.cardId, c.add, c.remove])).toEqual([['lyon', [], ['Cinéma']], ['titanic', ['Cinéma'], []]]);
    expect(planAutoTags(input({ cards, rules: [], settings: { ...settings, familyTags: [{ ...settings.familyTags[0], active: false }] }, myFamilies: [films] }), { removeOthers: true }, NOW)).toEqual([]);
  });

  it('conversion : la condition « famille » d\'une étiquette devient une famille étiquetée', () => {
    const legacy = [
      { id: 'a', tag: 'Films', quota: 0, pct: 70, floor: null, ceiling: null, keepMin: 0, active: true, match: 'tag', when: { text: '', family: 'Films', rateMin: null, rateMax: null } },
      { id: 'b', tag: 'Pays', quota: 0, pct: 70, floor: null, ceiling: null, keepMin: 0, active: true, match: 'tag', when: { text: 'pays', family: 'Monde', rateMin: null, rateMax: null } },
    ] as never;
    expect(migrateSettings({ sortPrice: 'desc' } as never, legacy).familyTags).toEqual([
      { id: 'ft-a', active: true, family: 'Films', tag: 'Films' },
      { id: 'ft-b', active: true, family: 'Monde', tag: 'Pays' },
    ]);
    expect(migrateRules(legacy, { sortPrice: 'desc' } as never).map((r) => [r.tag, r.when?.family, r.when?.text])).toEqual([['Pays', '', 'pays']]);
  });
});

describe('cartes de mes familles protégées de la vente', () => {
  const films = newFamily('Films', [], [{ siteId: 's-titanic', title: 'Titanic (film)', rarity: 'R', category: null, imageUrl: null, wikipediaUrl: null, atk: null, def: null }], NOW);
  const cards = cardsById(card('titanic', { name: 'Titanic (film)', siteId: 's-titanic', tags: ['20-50'], sitePrice: 40, quantity: 2 }));
  const proposed = (rules: TagRule[], protectFamilies: boolean) =>
    allocate(input({ cards, rules, myFamilies: [films], settings: { ...TEST_SETTINGS, slots: 1, protectFamilies } }), NOW).free.map((f) => f.proposal?.card.id ?? null);

  it('jamais proposées par défaut, sauf si l\'étiquette vise cette famille ou si la protection est coupée', () => {
    expect(proposed([rule('20-50')], true)).toEqual([null]);
    expect(proposed([rule('20-50')], false)).toEqual(['titanic']);
    expect(proposed([rule('20-50', { match: 'price', when: when({ family: 'Films' }) })], true)).toEqual(['titanic']);
  });
});

describe('réglages de vente par étiquette', () => {
  const cheap = (id: string, over: Partial<Card> = {}) => card(id, { tags: ['20-50'], sitePrice: 40, ...over });
  const rules20 = (over: Partial<TagRule> = {}) => [rule('20-50', { quota: 3, calc: pctCalc(50), ...over })];

  it('calcul, minimum et durée propres à l\'étiquette', () => {
    const cards = cardsById(cheap('a'));
    const advice = (over: Partial<TagRule>) => adviceForCard(input({ cards, rules: rules20(over), settings: { ...TEST_SETTINGS, rounding: 1 } }), 'a', NOW)!.pricing;
    expect(advice({})).toMatchObject({ price: 20, durationMin: null });
    expect(advice({ calc: { ...pctCalc(50), minPrice: 25 }, durationMin: 10 })).toMatchObject({ price: 25, durationMin: 10 });
    expect(advice({ calc: { ...pctCalc(50), mode: 'formula', formula: '{prix} / 4' } })).toMatchObject({ price: 10 });
  });

  it('priorité « ma formule » : le score le plus haut d\'abord, formule invalide par nom', () => {
    const cards = cardsById(cheap('a', { sitePrice: 45 }), cheap('b', { sitePrice: 25 }), cheap('c', { sitePrice: 30 }));
    const sellRate = rates({ a: rate(2, 10), b: rate(9, 10), c: rate(5, 10) });
    const proposed = (formula: string) =>
      allocate(input({ cards, rules: rules20(), sellRate, settings: { ...TEST_SETTINGS, rounding: 1, priority: 'formula', priorityFormula: formula } }), NOW).free.map((f) => f.proposal?.card.id ?? null);
    // Score = prix moyen × tdv : a 9, b 22.5, c 15.
    expect(proposed('{prix} * {tdv} / 100')).toEqual(['b', 'c', 'a']);
    expect(proposed('{prix')).toEqual(['a', 'b', 'c']);
  });

  it('validation : conditions et calcul de l\'étiquette', () => {
    const errors = validateOptions(
      [rule('X', { when: when({ rateMin: 60, rateMax: 40 }), calc: { ...pctCalc(50), mode: 'formula', formula: '{prix} +', minPrice: 30, maxPrice: 20 } })],
      TEST_SETTINGS,
    ).map((e) => e.message);
    expect(errors).toEqual([
      '« X » : taux de vente : « de » dépasse « à ».',
      '« X » : formule : formule incomplète (caractère 9).',
      '« X » : le prix minimum dépasse le maximum.',
    ]);
  });
});
