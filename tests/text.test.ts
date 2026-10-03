import { describe, expect, it } from 'vitest';
import { detectRarity, formatDuration, parseCountdown, parseNumber, sameTag, slugify } from '../src/lib/text';
import { inQuietHours } from '../src/lib/time';

describe('parseNumber', () => {
  it.each([
    ['86', 86],
    ['1 250', 1250],
    ['1 250 💰', 1250],
    ['1.250', 1250],
    ['12,5', 12.5],
    ['1,5k', 1500],
    ['Enchère : 340 pièces', 340],
    ['aucun', null],
  ])('%s → %s', (raw, expected) => expect(parseNumber(raw)).toBe(expected));
});

describe('parseCountdown', () => {
  const H = 3_600_000;
  const M = 60_000;
  it.each([
    ['2 j 3 h', 2 * 24 * H + 3 * H],
    ['1 h 12 min', H + 12 * M],
    ['1h12', H + 12 * M],
    ['1 h 12', H + 12 * M],
    ['12min 30s', 12 * M + 30_000],
    ['Se termine dans 45 min', 45 * M],
    ['05:12:33', 5 * H + 12 * M + 33_000],
    ['1:02:03:04', 26 * H + 3 * M + 4_000],
    ['Terminée', 0],
    ['Vendu', 0],
    ['Albert Einstein', null],
    ['86', null],
  ])('%s', (raw, expected) => expect(parseCountdown(raw)).toBe(expected));

  it('n\'accepte « mm:ss » qu\'avec un contexte', () => {
    expect(parseCountdown('12:30')).toBeNull();
    expect(parseCountdown('dans 12:30')).toBe(12 * M + 30_000);
  });
});

describe('detectRarity', () => {
  it('par libellé, en préférant le plus long', () => {
    expect(detectRarity('Super Rare')).toBe('SR');
    expect(detectRarity('Peu Commun')).toBe('PC');
    expect(detectRarity('Commun')).toBe('C');
    expect(detectRarity('Légendaire')).toBe('L');
    expect(detectRarity('Rare')).toBe('R');
  });
  it('par image de fond ou variable CSS', () => {
    expect(detectRarity('', '<div style="background-image:url(/ultra_rare.png)">')).toBe('UR');
    expect(detectRarity('', '<span style="color: var(--color-rarity-pc)">')).toBe('PC');
  });
  it('rien sinon', () => expect(detectRarity('Chat')).toBeNull());
});

describe('divers', () => {
  it('slugify', () => expect(slugify('Cléopâtre VII')).toBe('cleopatre-vii'));
  it('sameTag ignore casse et espaces', () => expect(sameTag('20 - 50', '20-50')).toBe(true));
  it('formatDuration', () => {
    expect(formatDuration(72 * 60_000)).toBe('1 h 12');
    expect(formatDuration(5 * 60_000)).toBe('5 min');
    expect(formatDuration(26 * 3_600_000)).toBe('1 j 2 h');
  });
});

describe('inQuietHours', () => {
  const at = (h: number, m = 0) => new Date(2026, 9, 3, h, m);
  it('plage qui passe minuit', () => {
    expect(inQuietHours(at(23, 30), '23:00', '08:00')).toBe(true);
    expect(inQuietHours(at(7, 59), '23:00', '08:00')).toBe(true);
    expect(inQuietHours(at(8, 0), '23:00', '08:00')).toBe(false);
    expect(inQuietHours(at(15), '23:00', '08:00')).toBe(false);
  });
  it('plage dans la journée', () => {
    expect(inQuietHours(at(13), '12:00', '14:00')).toBe(true);
    expect(inQuietHours(at(15), '12:00', '14:00')).toBe(false);
  });
  it('désactivé', () => expect(inQuietHours(at(3), null, null)).toBe(false));
});
