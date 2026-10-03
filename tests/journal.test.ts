import { describe, expect, it } from 'vitest';
import { expireAuctions, journalEntry, reconcileAuctions, tagStats } from '../src/lib/journal';
import { NOW, auction } from './helpers';

describe('reconcileAuctions', () => {
  it('détecte créations et fins, conserve le prix de départ', () => {
    const prev = [auction('a', 'x', { startPrice: 30, currentPrice: 30 }), auction('b', 'y')];
    const next = [auction('a', 'x', { startPrice: null, currentPrice: 45 }), auction('c', 'z')];
    const r = reconcileAuctions(prev, next, NOW);
    expect(r.created.map((a) => a.id)).toEqual(['c']);
    expect(r.finished.map((a) => a.id)).toEqual(['b']);
    const a = r.auctions.find((x) => x.id === 'a')!;
    expect(a.startPrice).toBe(30);
    expect(a.currentPrice).toBe(45);
  });

  it('garde l\'heure de fin connue si la nouvelle est illisible', () => {
    const r = reconcileAuctions([auction('a', 'x', { endsAt: NOW + 5 })], [auction('a', 'x', { endsAt: null })], NOW);
    expect(r.auctions[0].endsAt).toBe(NOW + 5);
  });

  it('expireAuctions', () => {
    const { kept, expired } = expireAuctions([auction('a', 'x', { endsAt: NOW - 1 }), auction('b', 'y', { endsAt: null })], NOW);
    expect(expired.map((a) => a.id)).toEqual(['a']);
    expect(kept.map((a) => a.id)).toEqual(['b']);
  });
});

describe('tagStats', () => {
  const fin = (tag: string, start: number, final: number, avg = 100) =>
    journalEntry('finished', { cardId: 'x', cardName: 'x', tag, startPrice: start, finalPrice: final, avgPrice: avg, at: NOW });

  it('conseille de remonter le % si tout part au prix de départ', () => {
    const s = tagStats([fin('20-50', 30, 30), fin('20-50', 30, 30), fin('20-50', 40, 40)]);
    expect(s[0].atStartShare).toBe(1);
    expect(s[0].hint).toMatch(/trop bas/);
  });

  it('calcule ratio et hausse', () => {
    const s = tagStats([fin('50-100', 50, 100), fin('50-100', 50, 100), fin('50-100', 50, 100)]);
    expect(s[0].avgFinalRatio).toBe(1);
    expect(s[0].avgUplift).toBe(1);
    expect(s[0].hint).toMatch(/monter/);
  });

  it('ignore les autres événements', () => {
    expect(tagStats([journalEntry('proposed', { cardId: 'x', cardName: 'x', tag: 't', startPrice: 1, finalPrice: null, avgPrice: null })])).toEqual([]);
  });
});
