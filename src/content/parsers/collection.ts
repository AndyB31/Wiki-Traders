import type { Card } from '../../lib/types';
import { cardIdFor } from './auctions';
import { activeTag, cardNameIn, imageBasename, isCardImage, isFavorite, labeledNumber, leafTexts, quantityIn, rarityIn, tagsIn, tilesFromAnchors } from './dom';
import { qsa, type SelectorConfig } from './selectors';

export interface ParsedCollection {
  cards: Partial<Card>[];
  /** Étiquette du filtre actif, appliquée à toutes les cartes visibles. */
  filterTag: string | null;
  tiles: Map<string, Element>;
}

/** Tuiles de cartes de la collection, indexées par identifiant de carte. */
export function collectionTiles(root: Element, cfg: SelectorConfig): Map<string, Element> {
  const out = new Map<string, Element>();
  if (cfg.cardTile) {
    for (const tile of qsa(root, cfg.cardTile)) {
      const name = cardNameIn(tile, cfg);
      if (name) out.set(cardIdFor(tile, name, cfg), tile);
    }
    return out;
  }
  const imgs = qsa<HTMLImageElement>(root, cfg.cardImage).filter(isCardImage);
  const key = (img: HTMLImageElement) => img.getAttribute('alt')?.trim() || imageBasename(img.getAttribute('src')) || '';
  for (const tile of tilesFromAnchors(root, imgs, key).values()) {
    // Une tuile de carte porte une rareté (cadre, couleur ou libellé) : on écarte le reste.
    if (!rarityIn(tile)) continue;
    const name = cardNameIn(tile, cfg);
    if (name) out.set(cardIdFor(tile, name, cfg), tile);
  }
  return out;
}

export function parseCollection(root: Element, cfg: SelectorConfig, knownTags: string[], now: number): ParsedCollection {
  const tiles = collectionTiles(root, cfg);
  const filterTag = activeTag(root, cfg, knownTags);
  const cards: Partial<Card>[] = [];
  for (const [id, tile] of tiles) {
    const name = cardNameIn(tile, cfg) ?? id;
    const tags = tagsIn(tile, cfg, knownTags);
    if (filterTag && !tags.includes(filterTag)) tags.push(filterTag);
    const card: Partial<Card> = {
      id,
      name,
      rarity: rarityIn(tile),
      tags,
      favorite: isFavorite(tile, cfg),
      updatedAt: now,
    };
    const qty = quantityIn(tile, cfg);
    if (qty != null) card.quantity = qty;
    const sitePrice = labeledNumber(leafTexts(tile), cfg.sitePriceLabelRe);
    if (sitePrice != null) {
      card.sitePrice = sitePrice;
      card.sitePriceAt = now;
    }
    cards.push(card);
  }
  return { cards, filterTag, tiles };
}
