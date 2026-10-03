import { describe, expect, it } from 'vitest';
import { durationFor, durationLabel, overlappingDurations } from '../src/lib/duration';

const rules = [
  { from: 0, to: 20, minutes: 10 },
  { from: 21, to: 100, minutes: 60 },
  { from: 101, to: null, minutes: 180 },
];

describe('paliers de durée', () => {
  it('choisit le palier qui contient le prix', () => {
    expect(durationFor(5, rules)).toBe(10);
    expect(durationFor(20, rules)).toBe(10);
    expect(durationFor(21, rules)).toBe(60);
    expect(durationFor(5000, rules)).toBe(180);
  });
  it('sans prix ou sans palier : durée par défaut du site', () => {
    expect(durationFor(null, rules)).toBeNull();
    expect(durationFor(50, [])).toBeNull();
  });
  it('libellés identiques aux boutons du site', () => {
    expect(durationLabel(10)).toBe('10 min');
    expect(durationLabel(60)).toBe('1 h');
    expect(durationLabel(720)).toBe('12 h');
  });
  it('détecte les chevauchements', () => {
    expect(overlappingDurations(rules)).toBeNull();
    expect(overlappingDurations([{ from: 0, to: 50, minutes: 10 }, { from: 40, to: null, minutes: 60 }])).toEqual([0, 1]);
  });
});
