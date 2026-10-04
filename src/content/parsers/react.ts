import { slugify } from '../../lib/text';
import type { Card, Rarity } from '../../lib/types';
import type { BridgeItem } from '../bridge';
import type { ParsedAuction } from './auctions';

type Obj = Record<string, unknown>;

const NAME = /^(title|name|nom|card_?name|cardTitle|label|snapshot_?title|wikipedia_?title)$/i;
const SITE_ID = /^(card_?id|cardId|id|uuid|slug)$/i;
const QTY = /^(quantity|qty|count|copies|amount|owned|owned_?count|nb|number|total|card_?count|quantite|exemplaires)$/i;
const FAV = /^(is_?)?(favorite|favourite|favori|pinned|starred|is_?pinned)$/i;
const TAGS = /^(tags|labels|etiquettes|user_?tags|album_?tags|tag_?names|tag_?ids|user_?card_?tags)$/i;
const TAG = /^(tag|label|etiquette|tag_?name)$/i;
const AVG = /^((avg|average|mean|median)_?(sale_?|market_?)?(price|value)|price_?(avg|average|mean)|market_?(price|value)|prix_?moyen|cote|estimated_?value)$/i;
const AUCTION_ID = /^(id|auction_?id|auctionId|uuid)$/i;
const FINAL = /^(final_?price|sold_?price|winning_?bid)$/i;
const CURRENT = /^(current_?(bid|price)|effective_?bid|highest_?bid|top_?bid|last_?bid|best_?bid|bid_?amount|current|price|prix)$/i;
const START = /^(base_?amount|listing_?base_?amount|start(ing)?_?(price|bid|amount)|min(imum)?_?(bid|price)|base_?price|reserve_?price|initial_?price|opening_?bid|mise_?a_?prix)$/i;
const END = /^(ends?_?at|end_?(time|date)|expires?_?at|expir(y|ation)(_?(at|date))?|closes?_?at|deadline|finish(es)?_?at|ending_?at)$/i;
const STATUS = /^(status|state|etat)$/i;
const SELLER = /^(seller_?id|owner_?id|user_?id|created_?by|seller|owner)$/i;

function pick(o: Obj | null | undefined, re: RegExp): unknown {
  if (!o) return undefined;
  for (const [k, v] of Object.entries(o)) if (re.test(k) && v != null && v !== '') return v;
  return undefined;
}

function num(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && /^\s*\d+([.,]\d+)?\s*$/.test(v)) return Number(v.replace(',', '.'));
  return null;
}

function pickNum(re: RegExp, ...objs: (Obj | null | undefined)[]): number | null {
  for (const o of objs) {
    const n = num(pick(o, re));
    if (n != null) return n;
  }
  return null;
}

function str(v: unknown): string | null {
  if (typeof v === 'string' && v.trim()) return v.trim();
  if (typeof v === 'number') return String(v);
  if (v && typeof v === 'object') return str((v as Obj).id ?? (v as Obj).name ?? (v as Obj).label);
  return null;
}

function date(v: unknown): number | null {
  if (typeof v === 'number') return v < 1e12 ? v * 1000 : v;
  if (typeof v === 'string') {
    if (/^\d{10,13}$/.test(v)) return date(Number(v));
    const t = Date.parse(v);
    return Number.isFinite(t) ? t : null;
  }
  return null;
}

/** Étiquettes : chaînes, objets { name } ou { tag: { name } }, ou identifiants résolus via `tagNames`. */
function tagsOf(tagNames: Map<string, string>, ...objs: (Obj | null | undefined)[]): string[] | undefined {
  const nameOf = (t: unknown): string | null => {
    if (typeof t === 'string') return tagNames.get(t) ?? (/^[0-9a-f-]{36}$/i.test(t) ? null : t);
    if (!t || typeof t !== 'object') return null;
    const o = t as Obj;
    if (typeof o.name === 'string') return o.name;
    if (o.tag && typeof o.tag === 'object') return nameOf(o.tag);
    const id = o.tag_id ?? o.id;
    return typeof id === 'string' ? tagNames.get(id) ?? null : str(o.label ?? o.title);
  };
  for (const o of objs) {
    const list = pick(o, TAGS);
    if (Array.isArray(list)) return list.map(nameOf).filter((t): t is string => !!t);
    const one = pick(o, TAG);
    if (typeof one === 'string') return [one];
  }
  return undefined;
}

function rarityField(o: Obj | null | undefined): string {
  return String(o?.rarity ?? o?.snapshot_rarity ?? '').toUpperCase();
}

function nested(o: Obj): Obj | null {
  for (const v of Object.values(o)) if (v && typeof v === 'object' && !Array.isArray(v) && rarityField(v as Obj)) return v as Obj;
  return null;
}

function shinyOf(...objs: (Obj | null | undefined)[]): boolean {
  return objs.some((o) => o?.is_shiny === true || o?.shiny === true);
}

export function cardFromItem(item: BridgeItem, now: number, tagNames: Map<string, string> = new Map()): Partial<Card> | null {
  const d = item.data;
  const c = item.container;
  const name = str(pick(d, NAME)) ?? str(pick(c, NAME));
  if (!name) return null;
  const rarity = (rarityField(d) || rarityField(c)) as Rarity;
  const card: Partial<Card> = { id: slugify(name), siteId: str(d.card_id ?? d.cardId) ?? str(pick(d, SITE_ID)) ?? undefined, name, rarity, shiny: shinyOf(c, d), updatedAt: now };
  const category = str(d.category ?? d.snapshot_category ?? c?.snapshot_category);
  if (category) card.category = category;
  const qty = pickNum(QTY, c, d);
  if (qty != null) card.quantity = qty;
  const fav = pick(c, FAV) ?? pick(d, FAV);
  if (typeof fav === 'boolean') card.favorite = fav;
  const tags = tagsOf(tagNames, c, d);
  if (tags) card.tags = tags;
  const avg = pickNum(AVG, c, d);
  if (avg != null) {
    card.sitePrice = avg;
    card.sitePriceAt = now;
  }
  return card;
}

export interface ReactAuction extends ParsedAuction {
  sellerId: string | null;
}

/** Dictionnaire id → nom des étiquettes trouvées dans la page. */
export function tagDictionary(items: BridgeItem[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const i of items) if (i.kind === 'tag' && typeof i.data.id === 'string' && typeof i.data.name === 'string') map.set(i.data.id, i.data.name);
  return map;
}

/** Couleur de chaque étiquette (nom → couleur), telle que définie sur le site. */
export function tagColors(items: BridgeItem[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const i of items) if (i.kind === 'tag' && typeof i.data.name === 'string' && typeof i.data.color === 'string') map.set(i.data.name, i.data.color);
  return map;
}

export function auctionFromItem(item: BridgeItem, knownTags: string[], now: number, tagNames: Map<string, string> = new Map()): ReactAuction | null {
  const d = item.data;
  const cardObj = nested(d);
  const name = str(pick(cardObj, NAME)) ?? str(pick(d, /^(card_?name|card_?title|snapshot_?title|title|name)$/i));
  const id = str(pick(d, AUCTION_ID));
  if (!name || !id) return null;
  const bids = Object.values(d).find((v) => Array.isArray(v) && v.length && typeof v[0] === 'object' && num((v[0] as Obj).amount ?? (v[0] as Obj).price) != null) as Obj[] | undefined;
  const fromBids = bids ? Math.max(...bids.map((b) => num(b.amount ?? b.price) ?? 0)) : null;
  const start = pickNum(START, d);
  const status = String(pick(d, STATUS) ?? '').toLowerCase();
  // « settled_unsold » contient « sold » : on exclut explicitement les invendus.
  const unsold = /(unsold|invendu|no_?bid)/.test(status);
  const sold = !unsold && /(sold|vendu|won|completed|adjug)/.test(status);
  const current = (sold ? pickNum(FINAL, d) : null) ?? pickNum(CURRENT, d) ?? fromBids ?? start;
  const endsAt = date(pick(d, END));
  const ended = sold || unsold || /(settled|ended|closed|expired|cancel|termin|finished)/.test(status) || (endsAt != null && endsAt <= now);
  const tags = tagsOf(tagNames, cardObj, d) ?? [];
  return {
    id,
    cardId: slugify(name),
    cardName: name,
    rarity: ((rarityField(cardObj) || rarityField(d)) as Rarity) || null,
    shiny: shinyOf(cardObj, d),
    tag: knownTags.find((k) => tags.some((t) => t.toLowerCase() === k.toLowerCase())) ?? null,
    currentPrice: current,
    startPrice: start,
    endsAt,
    sold,
    ended,
    sellerId: str(pick(d, SELLER)),
  };
}

let seq = 0;

/** Demande au script de page les données React affichées. null si le script ne répond pas. */
export function requestBridge(timeout = 1200): Promise<BridgeItem[] | null> {
  return new Promise((resolve) => {
    const id = `${Date.now()}-${seq++}`;
    const done = (v: BridgeItem[] | null) => {
      window.removeEventListener('message', onMsg);
      clearTimeout(t);
      resolve(v);
    };
    const onMsg = (e: MessageEvent) => {
      if (e.source === window && e.data?.__wiky === 'res' && e.data.id === id) done(Array.isArray(e.data.items) ? e.data.items : []);
    };
    const t = setTimeout(() => done(null), timeout);
    window.addEventListener('message', onMsg);
    window.postMessage({ __wiky: 'req', id }, '*');
  });
}

export function refElement(ref: string): Element | null {
  if (!ref) return null;
  return document.querySelector(`[data-wiky-ref="${ref.replace(/["\\]/g, '\\$&')}"]`);
}
