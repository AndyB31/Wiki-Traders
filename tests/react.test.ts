// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { extract } from '../src/content/bridge';
import { auctionFromItem, cardFromItem } from '../src/content/parsers/react';
import { NOW } from './helpers';

/** Simule le rattachement React : élément DOM → fibre hôte → composants parents. */
function attach(el: Element, ...propsChain: unknown[]): void {
  let parent: unknown = { tag: 5, memoizedProps: {}, return: null };
  for (const props of [...propsChain].reverse()) parent = { tag: 0, memoizedProps: props, return: parent };
  (el as unknown as Record<string, unknown>)['__reactFiber$abc123'] = { tag: 5, memoizedProps: {}, return: parent };
}

describe('bridge.extract', () => {
  beforeEach(() => (document.body.innerHTML = '<main><ul><li id="a"><img><span>x</span></li><li id="b"></li></ul><div id="c"></div></main>'));

  it('trouve cartes imbriquées et enchères, et marque leurs éléments', () => {
    const card = { id: 'uuid-1', title: 'Albert Einstein', rarity: 'UR', atk: 7470 };
    attach(document.getElementById('a')!, { userCard: { quantity: 3, tags: [{ name: '50-100' }], card }, onClick: () => {} });
    // L'enfant du même composant ne doit pas créer de doublon.
    attach(document.querySelector('#a span')!, { label: 'x' });
    attach(document.getElementById('b')!, { title: 'Chat', rarity: 'C', count: 5 });
    attach(document.getElementById('c')!, { auction: { id: 'auc-1', ends_at: '2026-10-03T14:00:00Z', current_bid: 120, card: { title: 'Mont Fuji', rarity: 'R' } } });
    const items = extract();
    expect(items.map((i) => i.kind)).toEqual(['card', 'card', 'auction']);
    // Référence stable : l'identifiant de la donnée, pas un numéro d'ordre.
    expect(document.getElementById('a')!.getAttribute('data-wiky-ref')).toBe('card:uuid-1');
    expect(items[0].container).toMatchObject({ quantity: 3 });
    expect(items[0].container).not.toHaveProperty('onClick');
  });

  it('ignore les listes (props d\'un composant parent)', () => {
    attach(document.querySelector('ul')!, { cards: [{ title: 'Chat', rarity: 'C' }] });
    expect(extract()).toEqual([]);
  });
});

describe('normalisation', () => {
  it('carte : quantité, étiquettes, favori, prix moyen', () => {
    const c = cardFromItem(
      { kind: 'card', ref: '', data: { id: 'u1', title: 'Cléopâtre VII', rarity: 'ur', avg_price: 88 }, container: { quantity: 2, is_favorite: true, tags: ['50-100'] } },
      NOW,
    );
    expect(c).toMatchObject({ id: 'cleopatre-vii', siteId: 'u1', rarity: 'UR', quantity: 2, favorite: true, tags: ['50-100'], sitePrice: 88 });
  });

  it('enchère : prix courant, départ, fin, statut, vendeur', () => {
    const a = auctionFromItem(
      {
        kind: 'auction',
        ref: '',
        data: { id: 'auc-1', starting_price: 40, bids: [{ amount: 45 }, { amount: 60 }], ends_at: 1791050000, status: 'active', seller_id: 'me', card: { title: 'Mont Fuji', rarity: 'R', tags: ['20-50'] } },
        container: null,
      },
      ['20-50'],
      NOW,
    );
    expect(a).toMatchObject({ id: 'auc-1', cardId: 'mont-fuji', rarity: 'R', tag: '20-50', startPrice: 40, currentPrice: 60, endsAt: 1791050000 * 1000, sellerId: 'me' });
    const sold = auctionFromItem({ kind: 'auction', ref: '', data: { id: 'x', card_name: 'Chat', price: 30, end_time: '2020-01-01', status: 'SOLD' }, container: null }, [], NOW);
    expect(sold).toMatchObject({ sold: true, ended: true, currentPrice: 30 });
  });
});

describe('schéma réel de WikiMasters (Supabase)', () => {
  it('user_cards : snapshot_title, snapshot_rarity, count, starred, étiquettes par id', () => {
    const tagNames = new Map([['t1', 'Mettre au Enchère']]);
    const c = cardFromItem(
      {
        kind: 'card',
        ref: '',
        data: { id: 'uc1', card_id: 'c1', count: 1, starred: true, snapshot_rarity: 'SR', snapshot_title: 'Zico', snapshot_atk: 6000, is_shiny: false },
        container: { userCard: null, tagIds: ['t1'] },
      },
      NOW,
      tagNames,
    );
    expect(c).toMatchObject({ id: 'zico', siteId: 'c1', name: 'Zico', rarity: 'SR', quantity: 1, favorite: true, shiny: false, tags: ['Mettre au Enchère'] });
  });

  it('auctions : base_amount, current_bid, end_at ; « settled_unsold » n\'est pas une vente', () => {
    const row = { id: 'a1', seller_id: 'me', card_id: 'c1', base_amount: 9, current_bid: null, end_at: '2026-10-03T18:38:29+00:00', status: 'settled_unsold', final_price: null, snapshot_rarity: 'SR', is_shiny: false, card: { wikipedia_title: 'Zico', rarity: 'SR' } };
    const unsold = auctionFromItem({ kind: 'auction', ref: '', data: row, container: null }, [], NOW);
    expect(unsold).toMatchObject({ cardName: 'Zico', rarity: 'SR', startPrice: 9, currentPrice: 9, sold: false, ended: true });
    const sold = auctionFromItem({ kind: 'auction', ref: '', data: { ...row, status: 'settled_sold', current_bid: 22, final_price: 24 }, container: null }, [], NOW);
    expect(sold).toMatchObject({ sold: true, ended: true, currentPrice: 24 });
    const active = auctionFromItem({ kind: 'auction', ref: '', data: { ...row, status: 'active', end_at: new Date(NOW + 60_000).toISOString(), current_bid: 12 }, container: null }, [], NOW);
    expect(active).toMatchObject({ sold: false, ended: false, currentPrice: 12, endsAt: NOW + 60_000 });
  });

  it('bridge : définitions d\'étiquettes { id, name, color }', () => {
    document.body.innerHTML = '<main><div id="t"></div></main>';
    const el = document.getElementById('t')!;
    (el as unknown as Record<string, unknown>)['__reactFiber$x'] = { tag: 5, memoizedProps: {}, return: { tag: 0, memoizedProps: { tags: [{ id: 't1', name: 'Galaxy', color: '#ffdd00', user_id: 'me' }] }, return: null } };
    const items = extract();
    expect(items).toEqual([{ kind: 'tag', ref: '', data: { id: 't1', name: 'Galaxy', color: '#ffdd00' }, container: null }]);
  });
});

describe('bridge : pas de mutations inutiles', () => {
  it('ne réécrit pas data-wiky-ref quand rien ne change', async () => {
    document.body.innerHTML = '<main><div id="a"></div></main>';
    attach(document.getElementById('a')!, { card: { id: 'c1', title: 'Zico', rarity: 'SR' } });
    extract();
    const records: MutationRecord[] = [];
    const obs = new MutationObserver((r) => records.push(...r));
    obs.observe(document.body, { attributes: true, subtree: true });
    extract();
    await Promise.resolve();
    obs.disconnect();
    expect(records).toHaveLength(0);
  });
});
