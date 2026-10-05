import { describe, expect, it } from 'vitest';
import {
  addCards,
  decodeFamilyCode,
  encodeFamilyCode,
  familiesOf,
  familyIndex,
  familyStats,
  mergeFamilies,
  newFamily,
  ownedCount,
  ownedIndex,
  parseLegacyFamilies,
  removeCards,
  sortCards,
  sortFamilies,
} from '../src/lib/families';
import type { CardFamily, CatalogCard } from '../src/lib/types';
import { card, cardsById } from './helpers';

const cc = (siteId: string, title: string, over: Partial<CatalogCard> = {}): CatalogCard => ({
  siteId, title, rarity: 'R', category: null, imageUrl: null, wikipediaUrl: null, atk: null, def: null, ...over,
});

function fam(name: string, cards: CatalogCard[], over: Partial<CardFamily> = {}): CardFamily {
  return { id: name, name, color: '#f97316', cards, coverSiteId: null, createdAt: 1, updatedAt: 1, ...over };
}

/** Code produit exactement comme « Prix moyen collection » (theme-tracker.js, compactFamilyPayload + F0). */
function referenceF0(family: { name: string; coverCardId: string | null; cards: { id: string; title: string; rarity?: string; category?: string | null; imageUrl?: string | null; atk?: number | null; def?: number | null }[] }): string {
  const coverIndex = family.coverCardId ? family.cards.findIndex((c) => c.id === family.coverCardId) : -1;
  const payload = [
    family.name.trim(),
    coverIndex,
    family.cards.map((c) => [c.id, c.title, c.rarity || '', c.category || '', c.imageUrl || '', Number.isFinite(Number(c.atk)) && c.atk != null ? Number(c.atk) : '', Number.isFinite(Number(c.def)) && c.def != null ? Number(c.def) : '']),
  ];
  return `F0.${Buffer.from(JSON.stringify(payload)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')}`;
}

describe('codes de partage F0 / F1', () => {
  const family = fam('Rois de France', [
    cc('u1', 'Louis XIV', { rarity: 'UR', category: 'roi de France', imageUrl: 'https://img/louis.jpg', atk: 120, def: 80 }),
    cc('u2', 'Henri IV', { rarity: 'SR', category: 'roi de France' }),
    cc('u3', 'Clovis Ier', { rarity: null }),
  ], { coverSiteId: 'u2' });

  it('aller-retour sans perte (nom, couverture, cartes, stats)', async () => {
    const code = await encodeFamilyCode(family);
    expect(code).toMatch(/^F[01]\./);
    const back = await decodeFamilyCode(code);
    expect(back.name).toBe('Rois de France');
    expect(back.coverSiteId).toBe('u2');
    expect(back.cards.map((c) => [c.siteId, c.title, c.rarity, c.category, c.imageUrl, c.atk, c.def])).toEqual([
      ['u1', 'Louis XIV', 'UR', 'roi de France', 'https://img/louis.jpg', 120, 80],
      ['u2', 'Henri IV', 'SR', 'roi de France', null, null, null],
      ['u3', 'Clovis Ier', null, null, null, null, null],
    ]);
    expect(back.id).not.toBe(family.id);
  });

  it('gros code compressé en F1 (gzip), relu à l\'identique', async () => {
    const big = fam('Pays', Array.from({ length: 300 }, (_, i) => cc(`id-${i}`, `Pays numéro ${i}`, { category: 'pays d\'Europe' })));
    const code = await encodeFamilyCode(big);
    expect(code.startsWith('F1.')).toBe(true);
    expect((await decodeFamilyCode(code)).cards).toHaveLength(300);
  });

  it('lit un code F0 produit par « Prix moyen collection »', async () => {
    const code = referenceF0({
      name: '  Peintres  ',
      coverCardId: 'p2',
      cards: [
        { id: 'p1', title: 'Claude Monet', rarity: 'SR', category: 'peintre français', imageUrl: 'https://img/monet.jpg', atk: 50, def: 60 },
        { id: 'p2', title: 'Édouard Manet', rarity: 'XX', category: null, imageUrl: null, atk: null, def: null },
        { id: 'p1', title: 'Doublon', rarity: 'C' },
      ],
    });
    const f = await decodeFamilyCode(`  ${code.slice(0, 20)}\n${code.slice(20)} `);
    expect(f.name).toBe('Peintres');
    expect(f.coverSiteId).toBe('p2');
    expect(f.cards.map((c) => [c.siteId, c.title, c.rarity, c.atk])).toEqual([
      ['p1', 'Claude Monet', 'SR', 50],
      ['p2', 'Édouard Manet', null, null],
    ]);
    expect(f.cards[0].wikipediaUrl).toBe('https://fr.wikipedia.org/wiki/Claude_Monet');
  });

  it('notre code F0 a la forme attendue par « Prix moyen collection »', async () => {
    const small = fam('A', [cc('x', 'Y', { rarity: 'C', atk: 1 })]);
    const code = await encodeFamilyCode(small);
    const json = JSON.parse(Buffer.from(code.slice(3).replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString());
    if (code.startsWith('F0.')) expect(json).toEqual(['A', -1, [['x', 'Y', 'C', '', '', 1, '']]]);
  });

  it('erreurs lisibles', async () => {
    await expect(decodeFamilyCode('')).rejects.toThrow('Colle un code');
    await expect(decodeFamilyCode('n\'importe quoi')).rejects.toThrow('invalide');
    await expect(decodeFamilyCode('F9.abcd')).rejects.toThrow('non prise en charge');
    await expect(decodeFamilyCode(`F0.${Buffer.from('pas du json').toString('base64')}`)).rejects.toThrow('corrompu');
  });
});

describe('import de wm_families_v1', () => {
  const raw = JSON.stringify([
    {
      id: 'family-1', name: 'Rois de France', coverCardId: 'c2', createdAt: 10, updatedAt: 20, mode: 'manual',
      cards: [
        { id: 'c1', title: 'Louis XIV', rarity: 'UR', category: 'roi de France', imageUrl: 'https://i/1.jpg', wikipediaUrl: 'https://fr.wikipedia.org/wiki/Louis_XIV', atk: 1, def: 2, owned: true, ownedCount: 1 },
        { id: 'c2', title: 'Henri IV', rarity: 'SR', category: null, owned: null },
        { id: 'c2', title: 'Henri IV (doublon)' },
        { title: 'sans id' },
      ],
    },
    { id: 'family-2', name: 'Vide', coverCardId: 'zz', cards: [] },
    { name: 'cassée' },
  ]);

  it('toutes les familles, cartes complètes, couverture gardée, couleurs distinctes', () => {
    const list = parseLegacyFamilies(raw, [], 99);
    expect(list.map((f) => f.name)).toEqual(['Rois de France', 'Vide']);
    const [a, b] = list;
    expect(a.cards).toEqual([
      { siteId: 'c1', title: 'Louis XIV', rarity: 'UR', category: 'roi de France', imageUrl: 'https://i/1.jpg', wikipediaUrl: 'https://fr.wikipedia.org/wiki/Louis_XIV', atk: 1, def: 2 },
      { siteId: 'c2', title: 'Henri IV', rarity: 'SR', category: null, imageUrl: null, wikipediaUrl: null, atk: null, def: null },
    ]);
    expect(a.coverSiteId).toBe('c2');
    expect(b.coverSiteId).toBeNull();
    expect(a.createdAt).toBe(10);
    expect(b.createdAt).toBe(99);
    expect(a.color).not.toBe(b.color);
  });

  it('tolère l\'absence ou un contenu invalide', () => {
    expect(parseLegacyFamilies(null)).toEqual([]);
    expect(parseLegacyFamilies('{')).toEqual([]);
    expect(parseLegacyFamilies('{"a":1}')).toEqual([]);
  });

  it('réimport : fusion par nom (casse et accents ignorés), sans doublon', () => {
    const mine = [fam('rois de france', [cc('c1', 'Louis XIV')], { color: '#3b82f6' })];
    const first = mergeFamilies(mine, parseLegacyFamilies(raw, mine), 5);
    expect(first.created).toBe(1);
    expect(first.cardsAdded).toBe(1);
    expect(first.families.map((f) => [f.name, f.cards.length])).toEqual([['rois de france', 2], ['Vide', 0]]);
    expect(first.families[0].coverSiteId).toBe('c2');
    const again = mergeFamilies(first.families, parseLegacyFamilies(raw, first.families));
    expect(again).toMatchObject({ created: 0, cardsAdded: 0 });
    expect(again.families).toHaveLength(2);
  });
});

describe('possession, statistiques et coût pour compléter', () => {
  const mine = cardsById(
    card('louis-xiv', { name: 'Louis XIV', siteId: 'c1', quantity: 3 }),
    card('henri-iv', { name: 'Henri IV', quantity: 1 }),
    card('vendue', { name: 'Vendue', siteId: 'c9', quantity: 0 }),
  );
  const idx = ownedIndex(mine);
  const f = fam('Rois', [cc('c1', 'Louis XIV'), cc('c2', 'Henri IV'), cc('c3', 'Clovis'), cc('c4', 'Dagobert'), cc('c9', 'Vendue')]);
  const prices: Record<string, number> = { c1: 100, c2: 40, c3: 25 };

  it('par identifiant du site, sinon par nom ; 0 exemplaire = manquante', () => {
    expect(ownedCount(f.cards[0], idx)).toBe(3);
    expect(ownedCount(f.cards[1], idx)).toBe(1);
    expect(ownedCount(f.cards[2], idx)).toBe(0);
    expect(ownedCount(f.cards[4], idx)).toBe(0);
  });

  it('valeur possédée, coût pour compléter, cartes sans prix', () => {
    expect(familyStats(f, idx, (id) => prices[id] ?? null)).toEqual({
      total: 5, owned: 2, missing: 3, pct: 40, valueOwned: 140, costToComplete: 25, missingUnpriced: 2,
    });
    expect(familyStats(fam('vide', []), idx).pct).toBe(0);
  });

  it('tris des familles et des cartes', () => {
    const a = fam('Beta', [cc('c1', 'Louis XIV')], { updatedAt: 1 });
    const b = fam('alpha', [cc('c3', 'Clovis'), cc('c4', 'x')], { updatedAt: 5 });
    const stats = (x: CardFamily) => familyStats(x, idx);
    expect(sortFamilies([a, b], 'name', stats).map((x) => x.name)).toEqual(['alpha', 'Beta']);
    expect(sortFamilies([a, b], 'progress', stats).map((x) => x.name)).toEqual(['Beta', 'alpha']);
    expect(sortFamilies([a, b], 'size', stats).map((x) => x.name)).toEqual(['alpha', 'Beta']);
    expect(sortFamilies([a, b], 'recent', stats).map((x) => x.name)).toEqual(['alpha', 'Beta']);
    const cards = [cc('c3', 'Clovis', { rarity: 'L' }), cc('c1', 'Louis XIV', { rarity: 'C' }), cc('c2', 'Henri IV', { rarity: 'SR' })];
    const own = (c: CatalogCard) => ownedCount(c, idx);
    const price = (id: string) => prices[id] ?? null;
    expect(sortCards(cards, 'owned', own, price).map((c) => c.siteId)).toEqual(['c2', 'c1', 'c3']);
    expect(sortCards(cards, 'price', own, price).map((c) => c.siteId)).toEqual(['c1', 'c2', 'c3']);
    expect(sortCards(cards, 'rarity', own, price).map((c) => c.siteId)).toEqual(['c3', 'c2', 'c1']);
    expect(sortCards(cards, 'name', own, price).map((c) => c.siteId)).toEqual(['c3', 'c2', 'c1']);
  });
});

describe('édition et index des pastilles', () => {
  it('ajout sans doublon, retrait (la couverture retirée est oubliée)', () => {
    const f = newFamily('  ', [], [cc('a', 'A'), cc('a', 'A bis')], 1);
    expect(f.name).toBe('Nouvelle famille');
    expect(f.cards).toHaveLength(1);
    const { family, added } = addCards({ ...f, coverSiteId: 'a' }, [cc('a', 'A'), cc('b', 'B'), cc('c', 'C')], 2);
    expect(added).toBe(2);
    expect(family.updatedAt).toBe(2);
    expect(addCards(family, [cc('b', 'B')]).added).toBe(0);
    const removed = removeCards(family, ['a', 'zz'], 3);
    expect(removed.cards.map((c) => c.siteId)).toEqual(['b', 'c']);
    expect(removed.coverSiteId).toBeNull();
  });

  it('carte → familles par identifiant puis par titre normalisé', () => {
    const a = fam('A', [cc('1', 'Édith Piaf')]);
    const b = fam('B', [cc('1', 'Édith Piaf'), cc('2', 'Mont Fuji')]);
    const idx = familyIndex([a, b]);
    expect(familiesOf(idx, '1', null).map((f) => f.name)).toEqual(['A', 'B']);
    expect(familiesOf(idx, null, '  edith piaf ').map((f) => f.name)).toEqual(['A', 'B']);
    expect(familiesOf(idx, 'inconnu', 'Mont Fuji').map((f) => f.name)).toEqual(['B']);
    expect(familiesOf(idx, null, 'rien')).toEqual([]);
  });
});
