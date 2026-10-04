import { describe, expect, it } from 'vitest';
import { parseFamilies } from '../src/content/families';

describe('familles (extension « Prix moyen collection »)', () => {
  it('lit le format wm_families_v1', () => {
    const raw = JSON.stringify([
      {
        id: 'family-1',
        name: 'Rois de France',
        coverCardId: 'c1',
        updatedAt: 1,
        cards: [
          { id: 'c1', title: 'Louis XIV', rarity: 'UR', category: 'roi de France', owned: true, ownedCount: 1 },
          { id: 'c2', title: 'Henri IV', rarity: 'SR', category: null, owned: null, ownedCount: 0 },
          { id: 'c3', title: 'Clovis', rarity: 'XX', ownedCount: 2 },
          { title: 'sans id' },
        ],
      },
      { name: 'cassée' },
    ]);
    expect(parseFamilies(raw)).toEqual([
      {
        id: 'family-1',
        name: 'Rois de France',
        cards: [
          { siteId: 'c1', name: 'Louis XIV', rarity: 'UR', category: 'roi de France', owned: true },
          { siteId: 'c2', name: 'Henri IV', rarity: 'SR', category: null, owned: false },
          { siteId: 'c3', name: 'Clovis', rarity: null, category: null, owned: true },
        ],
      },
    ]);
  });
  it('tolère l\'absence ou un contenu invalide', () => {
    expect(parseFamilies(null)).toEqual([]);
    expect(parseFamilies('pas du json')).toEqual([]);
    expect(parseFamilies('{"a":1}')).toEqual([]);
  });
});
