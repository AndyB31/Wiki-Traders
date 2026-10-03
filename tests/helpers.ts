import type { AllocationInput } from '../src/lib/allocation';
import { DEFAULT_RULES, DEFAULT_SETTINGS } from '../src/lib/defaults';
import type { Card, MyAuction, PriceObs } from '../src/lib/types';

export const NOW = Date.UTC(2026, 9, 3, 12, 0, 0);
export const DAY = 86_400_000;

export function card(id: string, over: Partial<Card> = {}): Card {
  return { id, name: id, rarity: 'R', tags: [], quantity: 2, favorite: false, sitePrice: null, sitePriceAt: null, updatedAt: NOW, ...over };
}

export function sales(cardId: string, prices: number[], ageDays = 1): PriceObs[] {
  return prices.map((price, i) => ({ cardId, price, type: 'sold', at: NOW - ageDays * DAY - i * 1000 }));
}

export function auction(id: string, cardId: string, over: Partial<MyAuction> = {}): MyAuction {
  return { id, cardId, cardName: cardId, tag: null, startPrice: 30, currentPrice: 30, endsAt: NOW + 3_600_000, seenAt: NOW, ...over };
}

export function input(over: Partial<AllocationInput> = {}): AllocationInput {
  return {
    rules: structuredClone(DEFAULT_RULES),
    settings: { ...DEFAULT_SETTINGS },
    cards: {},
    priceObs: [],
    myAuctions: [],
    manualPrices: {},
    slotOverrides: {},
    ignoredSlots: [],
    ...over,
  };
}

export function cardsById(...list: Card[]): Record<string, Card> {
  return Object.fromEntries(list.map((c) => [c.id, c]));
}
