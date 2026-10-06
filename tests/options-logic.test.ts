import { describe, expect, it } from 'vitest';
import { DEFAULT_RULES, DEFAULT_SETTINGS } from '../src/lib/defaults';
import type { Settings, TagRule } from '../src/lib/types';
import {
  DEFAULT_DURATION_TIERS,
  isDirty,
  nextTier,
  pctExample,
  quickStartChecks,
  quotaSummary,
  roundingExamples,
  snapshot,
  stableStringify,
  tiersCoverAll,
  tiersPreview,
  validateOptions,
} from '../src/ui/options-logic';

const rules = (): TagRule[] => structuredClone(DEFAULT_RULES);
const settings = (patch: Partial<Settings> = {}): Settings => ({ ...structuredClone(DEFAULT_SETTINGS), ...patch });

describe('quotaSummary', () => {
  it('résume la répartition et signale l\'égalité', () => {
    const q = quotaSummary(rules(), 5);
    expect(q.text).toBe('5 slots : 1 × 50-100, 4 × 20-50');
    expect(q.status).toBe('ok');
  });
  it('signale les slots libres et le dépassement', () => {
    expect(quotaSummary(rules(), 7)).toMatchObject({ status: 'under', sum: 5 });
    expect(quotaSummary(rules(), 7).message).toContain('2 slots sur 7');
    expect(quotaSummary(rules(), 3)).toMatchObject({ status: 'over' });
  });
  it('ignore les règles inactives', () => {
    const r = rules();
    r[1].active = false;
    expect(quotaSummary(r, 5).text).toBe('1 slot : 1 × 50-100');
    expect(quotaSummary([], 5).text).toBe('Aucun slot réservé');
  });
});

describe('pctExample / roundingExamples', () => {
  it('calcule la mise de départ comme le prix conseillé', () => {
    expect(pctExample(70, 1)).toBe('ex. carte à 40 W → départ 28 W');
    expect(pctExample(70, 0)).toBe('ex. carte à 40 W → départ 30 W');
    expect(pctExample(70, 10)).toBe('ex. carte à 40 W → départ 30 W');
    expect(pctExample(0, 0)).toBe('le % doit être positif');
  });
  it('montre l\'effet de l\'arrondi', () => {
    expect(roundingExamples(0)).toBe('17 → 17 W · 63 → 65 W · 238 → 240 W');
    expect(roundingExamples(10)).toBe('17 → 20 W · 63 → 60 W · 238 → 240 W');
  });
});

describe('paliers de durée', () => {
  it('aperçu lisible de la proposition par défaut', () => {
    expect(tiersPreview(DEFAULT_DURATION_TIERS)).toBe('0–20 W → 10 min · 21–100 W → 1 h · 101 W et + → 3 h');
    expect(tiersCoverAll(DEFAULT_DURATION_TIERS)).toBe(true);
  });
  it('mentionne la durée du site pour les prix non couverts', () => {
    expect(tiersPreview([])).toBe('Aucun palier : toujours la durée du site (1 h)');
    expect(tiersPreview([{ from: 0, to: 20, minutes: 10 }])).toBe('0–20 W → 10 min · autres prix → durée du site (1 h)');
    expect(tiersCoverAll([{ from: 0, to: 20, minutes: 10 }, { from: 30, to: null, minutes: 60 }])).toBe(false);
    expect(tiersPreview([{ from: null, to: null, minutes: 30 }])).toBe('tous les prix → 30 min');
  });
  it('le palier suivant commence après le dernier', () => {
    expect(nextTier([])).toEqual({ from: 0, to: null, minutes: 60 });
    expect(nextTier([{ from: 0, to: 20, minutes: 10 }])).toEqual({ from: 21, to: null, minutes: 60 });
  });
});

describe('validateOptions', () => {
  it('aucune erreur avec les réglages par défaut', () => {
    expect(validateOptions(rules(), settings())).toEqual([]);
  });
  it('repère les champs fautifs', () => {
    const r = rules();
    r[0].floor = 200;
    r[1].tag = ' 50-100 ';
    const errs = validateOptions(r, settings({ slots: 2, durationRules: [{ from: 0, to: 50, minutes: 10 }, { from: 40, to: null, minutes: 60 }] }), { selectorsInvalid: true });
    const keys = errs.flatMap((e) => e.keys);
    expect(keys).toContain('slots');
    expect(keys).toContain(`rule:${r[0].id}:floor`);
    expect(keys).toContain(`rule:${r[1].id}:tag`);
    expect(keys).toContain('dur:1:from');
    expect(keys).toContain('selectors');
    expect(errs.map((e) => e.section).sort()).toEqual(['advanced', 'durations', 'rules', 'rules', 'rules']);
  });
});

describe('modifications non enregistrées', () => {
  it('ignore l\'ordre des clés et détecte un vrai changement', () => {
    expect(stableStringify({ b: 1, a: { d: 2, c: 3 } })).toBe(stableStringify({ a: { c: 3, d: 2 }, b: 1 }));
    const state = { rules: rules(), settings: settings(), manualPrices: { x: 3 } };
    const base = snapshot(state);
    expect(isDirty(base, state)).toBe(false);
    state.settings.slots = 6;
    expect(isDirty(base, state)).toBe(true);
    state.settings.slots = 5;
    expect(isDirty(base, state)).toBe(false);
  });
});

describe('quickStartChecks', () => {
  it('liste ce qui reste à faire', () => {
    const checks = quickStartChecks({ cardCount: 0, rules: [], settings: settings() });
    expect(checks.map((c) => [c.id, c.ok])).toEqual([
      ['collection', false],
      ['api', false],
      ['rules', false],
      ['quotas', false],
    ]);
    const ready = quickStartChecks({ cardCount: 12, rules: rules(), settings: settings({ apiRead: true }) });
    expect(ready.every((c) => c.ok)).toBe(true);
  });
});
