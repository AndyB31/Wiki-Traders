import { parseCountdown, parseNumber, sameTag, slugify } from '../../lib/text';
import type { Rarity } from '../../lib/types';
import { cardNameIn, joinedText, labeledNumber, leafTexts, rarityIn, tilesFromAnchors } from './dom';
import { qs, qsa, re, type SelectorConfig } from './selectors';

export interface ParsedAuction {
  id: string;
  cardId: string;
  cardName: string;
  rarity: Rarity | null;
  shiny?: boolean;
  tag: string | null;
  currentPrice: number | null;
  startPrice: number | null;
  endsAt: number | null;
  sold: boolean;
  ended: boolean;
}

export function auctionIdFromHref(href: string | null, cfg: SelectorConfig): string | null {
  if (!href) return null;
  try {
    const path = new URL(href, 'https://www.wiki-masters.com').pathname;
    return path.match(re(cfg.auctionDetailPathRe))?.[1] ?? null;
  } catch {
    return null;
  }
}

export function cardIdFor(tile: Element, name: string, cfg: SelectorConfig): string {
  const attr = cfg.cardIdAttr;
  if (attr) {
    const own = tile.getAttribute(attr) ?? qs(tile, `[${CSS_escape(attr)}]`)?.getAttribute(attr);
    if (own) return own;
  }
  return slugify(name);
}

function CSS_escape(s: string): string {
  return s.replace(/[^a-zA-Z0-9_-]/g, (c) => `\\${c}`);
}

/** Heure de fin : attribut datetime/data-end, sinon compte à rebours affiché. */
export function endsAtIn(tile: Element, cfg: SelectorConfig, now: number): number | null {
  for (const el of qsa(tile, cfg.endTime)) {
    const raw = el.getAttribute('datetime') ?? el.getAttribute('data-end') ?? el.getAttribute('data-ends-at');
    if (!raw) continue;
    const t = /^\d{10,13}$/.test(raw) ? Number(raw) * (raw.length === 10 ? 1000 : 1) : Date.parse(raw);
    if (Number.isFinite(t)) return t;
  }
  const texts = leafTexts(tile);
  for (const t of texts) {
    if (!/(\d\s*(j|h|min|s)\b|\d:\d\d|termin|expir)/i.test(t)) continue;
    const ms = parseCountdown(t);
    if (ms != null) return now + ms;
  }
  // Compte à rebours éclaté sur plusieurs éléments (« 01 » « h » « 12 » « min »).
  const ms = parseCountdown(texts.join(' ').match(/(?:fin|termine|reste|dans)[^|]*?((?:\d+\s*(?:j|h|min|s)\s*)+)/i)?.[1]);
  return ms != null ? now + ms : null;
}

export function priceIn(tile: Element, cfg: SelectorConfig): number | null {
  if (cfg.price) {
    const n = parseNumber(qs(tile, cfg.price)?.textContent);
    if (n != null) return n;
  }
  const texts = leafTexts(tile);
  const labeled = labeledNumber(texts, cfg.priceLabelRe);
  if (labeled != null) return labeled;
  // À défaut : premier nombre « nu » qui n'est ni une stat, ni une quantité, ni un compte à rebours.
  for (let i = 0; i < texts.length; i++) {
    const t = texts[i];
    if (!/^\D{0,3}\d[\d\s.,]*\s*[kK]?\D{0,12}$/.test(t)) continue;
    if (/^[x×]|[x×]$|:/i.test(t) || parseCountdown(t) != null) continue;
    if (/^(atk|def|pv|hp)$/i.test(texts[i - 1] ?? '') || /(atk|def|pv|hp)/i.test(t)) continue;
    const n = parseNumber(t);
    if (n != null) return n;
  }
  return null;
}

export function parseAuctionTile(tile: Element, id: string, cfg: SelectorConfig, knownTags: string[], now: number): ParsedAuction | null {
  const cardName = cardNameIn(tile, cfg);
  if (!cardName) return null;
  const texts = leafTexts(tile);
  const joined = texts.join(' | ');
  const endsAt = endsAtIn(tile, cfg, now);
  const ended = endsAt != null && endsAt <= now;
  return {
    id,
    cardId: cardIdFor(tile, cardName, cfg),
    cardName,
    rarity: rarityIn(tile),
    tag: knownTags.find((k) => texts.some((t) => sameTag(k, t))) ?? null,
    currentPrice: priceIn(tile, cfg),
    startPrice: labeledNumber(texts, cfg.startPriceLabelRe),
    endsAt,
    sold: re(cfg.soldRe).test(joined),
    ended: ended || re(cfg.soldRe).test(joined),
  };
}

/** Toutes les enchères listées sur la page (liens vers /marketplace/<id>). */
export function parseAuctionList(root: Element, cfg: SelectorConfig, knownTags: string[], now: number): ParsedAuction[] {
  let tiles: Map<string, Element>;
  if (cfg.auctionTile) {
    tiles = new Map();
    for (const t of qsa(root, cfg.auctionTile)) {
      const href = t.matches(cfg.auctionLink) ? t.getAttribute('href') : qs(t, cfg.auctionLink)?.getAttribute('href') ?? null;
      const id = auctionIdFromHref(href, cfg);
      if (id) tiles.set(id, t);
    }
  } else {
    const links = qsa<HTMLAnchorElement>(root, cfg.auctionLink);
    tiles = tilesFromAnchors(root, links, (a) => auctionIdFromHref(a.getAttribute('href'), cfg) ?? '');
  }
  const out: ParsedAuction[] = [];
  for (const [id, tile] of tiles) {
    const a = parseAuctionTile(tile, id, cfg, knownTags, now);
    if (a) out.push(a);
  }
  return out;
}

/** Page d'une enchère : toute la zone principale est la « tuile ». */
export function parseAuctionDetail(root: Element, id: string, cfg: SelectorConfig, knownTags: string[], now: number): ParsedAuction | null {
  const h1 = qs(root, 'h1')?.textContent?.trim();
  const parsed = parseAuctionTile(root, id, cfg, knownTags, now);
  if (!parsed) return null;
  if (h1 && h1.length < 80) {
    parsed.cardName = h1;
    parsed.cardId = cardIdFor(root, h1, cfg);
  }
  return parsed;
}

export function hasEmptyState(root: Element, cfg: SelectorConfig): boolean {
  return re(cfg.emptyStateRe).test(joinedText(root));
}
