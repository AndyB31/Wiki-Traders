import { describe, expect, it } from 'vitest';
import { reconcileAuctions } from '../src/lib/journal';
import { queueRetags, RETAG_MAX_AGE_MS, splitRetags, tagsToRestore } from '../src/lib/retag';
import type { JournalEntry, MyAuction, PendingRetag } from '../src/lib/types';

const auction = (id: string, over: Partial<MyAuction> = {}): MyAuction => ({
  id,
  cardId: `card-${id}`,
  cardName: `Carte ${id}`,
  tag: null,
  startPrice: 20,
  currentPrice: 20,
  endsAt: 1000,
  seenAt: 0,
  ...over,
});

const pending = (auctionId: string, at = 0): PendingRetag => ({ auctionId, cardId: `card-${auctionId}`, cardName: `Carte ${auctionId}`, tags: ['20-50'], at });

describe('étiquettes des invendues', () => {
  it('les étiquettes notées à la mise en vente survivent aux relevés suivants', () => {
    const first = reconcileAuctions([], [auction('a')], 1).auctions.map((a) => ({ ...a, cardTags: ['20-50', 'Galaxy'] }));
    const { auctions } = reconcileAuctions(first, [auction('a', { currentPrice: 20 })], 2);
    expect(auctions[0].cardTags).toEqual(['20-50', 'Galaxy']);
  });

  it('étiquettes à remettre : celles de la mise en vente, sinon l\'étiquette de l\'enchère, de la règle, du slot proposé', () => {
    const journal: JournalEntry[] = [{ id: 'p', type: 'proposed', at: 0, cardId: 'card-a', cardName: 'Carte a', tag: '50-100', startPrice: 60, finalPrice: null, avgPrice: 80 }];
    expect(tagsToRestore(auction('a', { cardTags: ['Galaxy'] }), journal, '20-50')).toEqual(['Galaxy']);
    expect(tagsToRestore(auction('a', { tag: 'X' }), journal, '20-50')).toEqual(['X']);
    expect(tagsToRestore(auction('a'), journal, '20-50')).toEqual(['20-50']);
    expect(tagsToRestore(auction('a'), journal, null)).toEqual(['50-100']);
    expect(tagsToRestore(auction('b'), journal, null)).toEqual([]);
  });

  it('seules les enchères sans mise entrent en file, une fois, et les vieilles entrées sont purgées', () => {
    const now = RETAG_MAX_AGE_MS + 10;
    const finished = [
      auction('a'),
      auction('b', { hasBid: true }),
      auction('c', { currentPrice: 30 }), // mise déduite du prix
      auction('d', { cardTags: [] }),
      auction('e'),
    ];
    const tagsOf = (a: MyAuction) => (a.id === 'd' ? [] : ['20-50', '20-50 ']);
    const out = queueRetags([pending('e', now - 5), pending('old', 0)], finished, tagsOf, now);
    expect(out.map((p) => p.auctionId)).toEqual(['e', 'a']);
    expect(out[1].tags).toEqual(['20-50']);
  });

  it('statut du site : invendue ou annulée → à remettre, vendue → abandon, pas encore réglée → plus tard', () => {
    const now = 5000;
    const status = new Map([
      ['u', 'settled_unsold'],
      ['c', 'cancelled'],
      ['s', 'settled_sold'],
      ['a', 'active'],
    ]);
    const { apply, drop } = splitRetags([pending('u'), pending('c'), pending('s'), pending('a'), pending('x', now - RETAG_MAX_AGE_MS)], status, now);
    expect(apply.map((p) => p.auctionId)).toEqual(['u', 'c']);
    expect(drop.map((p) => p.auctionId)).toEqual(['s', 'x']);
  });
});
