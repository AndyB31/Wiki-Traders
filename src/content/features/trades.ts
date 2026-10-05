/**
 * Échanges (/trades) : valeur de chaque côté (prix moyen de chaque carte + WikiBidous, total, écart) sur la liste
 * et dans « Détail de l'échange », et mini-cartes (image, rareté) à la place des noms tronqués.
 *
 * Les échanges viennent de la réponse du site (`GET /api/trades`, relayée par bridge.ts) ; si la page n'a rien
 * demandé, une seule lecture identique est faite. Les prix de toutes les cartes arrivent en un appel groupé.
 */
import type { Rarity } from '../../lib/types';
import { cardPrices, displayPrice, knownPrice, type CardPrice } from '../catalog';
import { onSiteResponse } from '../net';
import { type FeatureContext, registerFeature } from './runtime';
import { ensureFeatureStyle, node, rarityChip, RARITY_COLORS, wiki } from './ui';

const RARITIES = new Set(['C', 'PC', 'R', 'SR', 'UR', 'L']);

export interface TradeCard {
  siteId: string;
  title: string;
  rarity: Rarity | null;
  imageUrl: string | null;
}

export interface TradeUser {
  id: string;
  name: string;
  wikibidous: number;
}

export interface Trade {
  id: string;
  status: string | null;
  initiator: TradeUser;
  recipient: TradeUser;
  items: { offeredBy: string | null; card: TradeCard }[];
}

/**
 * Un échange de la réponse `/api/trades` : `{ id, status, initiator_id, recipient_id, initiator_wikibidous, recipient_wikibidous,
 * initiator: { username }, recipient: { username }, items: [{ offered_by, card_id, snapshot_rarity, card: { wikipedia_title, image_url, rarity } }] }`
 * (forme relevée par « Prix moyen collection »).
 */
export function mapTrade(raw: unknown): Trade | null {
  const t = raw as Record<string, any> | null;
  if (!t?.id || !t.initiator_id || !t.recipient_id) return null;
  const items = (Array.isArray(t.items) ? t.items : []).flatMap((it: Record<string, any>) => {
    const card = it?.card ?? {};
    const id = it?.card_id ?? card.id;
    const title = card.wikipedia_title;
    if (!id || typeof title !== 'string') return [];
    const rarity = String(it.snapshot_rarity ?? card.rarity ?? '').toUpperCase();
    return [{ offeredBy: it.offered_by ?? null, card: { siteId: String(id), title, rarity: RARITIES.has(rarity) ? (rarity as Rarity) : null, imageUrl: card.image_url ?? null } }];
  });
  return {
    id: String(t.id),
    status: t.status ?? null,
    initiator: { id: String(t.initiator_id), name: t.initiator?.username ?? 'Initiateur', wikibidous: Number(t.initiator_wikibidous) || 0 },
    recipient: { id: String(t.recipient_id), name: t.recipient?.username ?? 'Destinataire', wikibidous: Number(t.recipient_wikibidous) || 0 },
    items,
  };
}

export function mapTrades(json: unknown): Trade[] {
  const list = (json as { trades?: unknown } | null)?.trades ?? (Array.isArray(json) ? json : null) ?? ((json as { trade?: unknown } | null)?.trade ? [(json as { trade: unknown }).trade] : []);
  return Array.isArray(list) ? list.map(mapTrade).filter((t): t is Trade => !!t) : [];
}

export interface TradeSide {
  user: TradeUser;
  cards: { card: TradeCard; price: number | null }[];
  /** Somme des prix connus + WikiBidous. */
  total: number;
  /** Cartes sans prix moyen connu. */
  missing: number;
}

/** Valeur de chaque côté d'un échange (prix moyens connus + WikiBidous). */
export function tradeSides(trade: Trade, prices: Map<string, CardPrice>): [TradeSide, TradeSide] {
  const side = (user: TradeUser): TradeSide => {
    const cards = trade.items.filter((i) => i.offeredBy === user.id).map((i) => ({ card: i.card, price: displayPrice(prices.get(i.card.siteId)) }));
    return {
      user,
      cards,
      total: cards.reduce((s, c) => s + (c.price ?? 0), user.wikibidous),
      missing: cards.filter((c) => c.price == null).length,
    };
  };
  return [side(trade.initiator), side(trade.recipient)];
}

// ---------------------------------------------------------------- état

const trades = new Map<string, Trade>();
const byTitle = new Map<string, TradeCard>();
let prices = new Map<string, CardPrice>();
let ctx: FeatureContext | null = null;
let fetchedFor = '';
let pricesFor = '';
let pricesLoading = false;

const norm = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
const isTradesPage = (path: string) => path === '/trades' || path.startsWith('/trades/');

export function ingestTrades(json: unknown): void {
  const list = mapTrades(json);
  if (!list.length) return;
  for (const t of list) {
    trades.set(t.id, t);
    for (const i of t.items) byTitle.set(norm(i.card.title), i.card);
  }
  void loadPrices();
  redraw();
}

async function loadPrices(): Promise<void> {
  if (!ctx?.flags.tradeValues || !ctx.apiRead) return;
  const ids = [...new Set([...trades.values()].flatMap((t) => t.items.map((i) => i.card.siteId)))];
  const key = ids.sort().join(',');
  if (!ids.length || key === pricesFor) return;
  pricesFor = key;
  for (const id of ids) {
    const p = knownPrice(id);
    if (p) prices.set(id, p);
  }
  pricesLoading = true;
  try {
    prices = new Map([...prices, ...(await cardPrices(ids))]);
  } catch {
    pricesFor = '';
  } finally {
    pricesLoading = false;
  }
  redraw();
}

function redraw(): void {
  if (ctx) render(ctx);
}

// ---------------------------------------------------------------- valeurs

const CSS = `
[data-wiky="trade-values"] { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 10px; padding: 10px; border-radius: 12px; font-size: 12px;
  border: 1px solid rgba(249,115,22,.28); background: linear-gradient(180deg, rgba(249,115,22,.08), rgba(249,115,22,.02)); color: var(--color-foreground, #e7e5e4); }
[data-wiky="trade-values"] .wiky-tv-side { min-width: 0; }
[data-wiky="trade-values"] .wiky-tv-head { display: flex; justify-content: space-between; gap: 6px; font-weight: 700; margin-bottom: 4px; }
[data-wiky="trade-values"] .wiky-tv-head b { color: #fdba74; font-variant-numeric: tabular-nums; }
[data-wiky="trade-values"] .wiky-tv-row { display: flex; align-items: center; gap: 6px; padding: 2px 0; }
[data-wiky="trade-values"] .wiky-tv-row span:nth-child(2) { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
[data-wiky="trade-values"] .wiky-tv-row span:last-child { font-variant-numeric: tabular-nums; font-weight: 600; }
[data-wiky="trade-values"] .wiky-tv-diff { grid-column: 1 / -1; text-align: center; font-weight: 700; color: color-mix(in srgb, var(--color-foreground, #e7e5e4) 70%, transparent); }
[data-wiky="trade-preview"] { display: inline-flex; flex-direction: column; width: 76px; flex: 0 0 76px; overflow: hidden; vertical-align: top; border-radius: 9px;
  border: 1px solid color-mix(in srgb, var(--wiky-rar, #94a3b8) 70%, transparent); background: var(--color-surface, #1c1917); }
[data-wiky="trade-preview"] .wiky-tp-art { position: relative; height: 64px; display: grid; place-items: center; font-weight: 800; font-size: 18px;
  background: linear-gradient(145deg, color-mix(in srgb, var(--wiky-rar, #94a3b8) 30%, transparent), #0c0a09); color: rgba(255,255,255,.8); }
[data-wiky="trade-preview"] .wiky-tp-art img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
[data-wiky="trade-preview"] .wiky-f-rar { position: absolute; left: 4px; top: 4px; }
[data-wiky="trade-preview"] .wiky-tp-title { padding: 3px 5px 0; font-size: 10.5px; font-weight: 600; line-height: 1.2; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
[data-wiky="trade-preview"] .wiky-tp-price { padding: 1px 5px 4px; font-size: 10.5px; font-weight: 700; color: #fdba74; }
[data-wiky="trade-preview"] + span[title][style*="--color-rarity-"] { display: none !important; }
`;

function valuesPanel(trade: Trade, showCards: boolean): HTMLElement {
  const sides = tradeSides(trade, prices);
  const panel = node('div', 'trade-values');
  const loading = pricesLoading;
  for (const s of sides) {
    const col = node('div', 'part', 'wiky-tv-side');
    const head = node('div', 'part', 'wiky-tv-head');
    head.append(node('span', 'part', '', s.user.name), node('b', 'part', '', s.missing && s.missing === s.cards.length && !s.user.wikibidous ? '—' : wiki(s.total)));
    col.append(head);
    if (showCards) {
      for (const c of s.cards) {
        const row = node('div', 'part', 'wiky-tv-row');
        const name = node('span', 'part', '', c.card.title);
        name.title = c.card.title;
        row.append(rarityChip(c.card.rarity), name, node('span', 'part', c.price == null ? 'wiky-f-muted' : '', loading ? '…' : wiki(c.price)));
        col.append(row);
      }
      if (s.user.wikibidous) {
        const row = node('div', 'part', 'wiky-tv-row');
        row.append(node('span', 'part', 'wiky-f-rar', 'W'), node('span', 'part', '', 'WikiBidous'), node('span', 'part', '', wiki(s.user.wikibidous)));
        col.append(row);
      }
    }
    if (s.missing) col.append(node('div', 'part', 'wiky-f-muted', `${s.missing} carte${s.missing > 1 ? 's' : ''} sans prix moyen`));
    panel.append(col);
  }
  const diff = sides[1].total - sides[0].total;
  panel.append(node('div', 'part', 'wiky-tv-diff', diff === 0 ? 'Échange équilibré' : `Écart : ${wiki(Math.abs(diff))} en faveur de ${diff > 0 ? sides[1].user.name : sides[0].user.name}`));
  return panel;
}

function valuesKey(trade: Trade): string {
  return JSON.stringify([trade.id, trade.items.map((i) => [i.card.siteId, displayPrice(prices.get(i.card.siteId))]), pricesLoading]);
}

/** Échange qui correspond le mieux à un bloc de la page (titres des cartes, pseudos). */
export function matchTrade(el: Element, list: Iterable<Trade>, used: Set<string>): Trade | null {
  const titles = new Set([...el.querySelectorAll('[title], h3')].map((n) => norm(n.getAttribute('title') ?? n.textContent)));
  const text = norm(el.textContent);
  let best: Trade | null = null;
  let bestScore = 0;
  for (const t of list) {
    if (used.has(t.id)) continue;
    const names = t.items.map((i) => norm(i.card.title));
    const hit = names.filter((n) => titles.has(n) || text.includes(n)).length;
    let score = hit * 30 + (names.length && hit === names.length ? 100 : -(names.length - hit) * 20);
    for (const u of [t.initiator.name, t.recipient.name]) if (u && text.includes(norm(u))) score += 12;
    if (score > bestScore) {
      bestScore = score;
      best = t;
    }
  }
  return best;
}

function mountValues(host: Element, trade: Trade, showCards: boolean): void {
  const key = valuesKey(trade) + showCards;
  const existing = host.querySelector<HTMLElement>(':scope > [data-wiky="trade-values"]');
  if (existing?.dataset.key === key) return;
  const panel = valuesPanel(trade, showCards);
  panel.dataset.key = key;
  if (existing) existing.replaceWith(panel);
  else host.append(panel);
}

function renderValues(): void {
  const used = new Set<string>();
  // Liste des échanges : un bloc par échange (bouton « Voir le détail de l'échange »).
  for (const btn of document.querySelectorAll('button[aria-label="Voir le détail de l\'échange"]')) {
    const block = btn.closest('.card-frame') ?? btn.parentElement?.parentElement;
    if (!block || block.closest('[data-wiky]')) continue;
    const trade = matchTrade(block, trades.values(), used);
    if (!trade) continue;
    used.add(trade.id);
    mountValues(block, trade, !ctx?.flags.tradePreviews);
  }
  // Fenêtre « Détail de l'échange ».
  const h2 = [...document.querySelectorAll('h2')].find((h) => norm(h.textContent) === norm('Détail de l\'échange'));
  if (h2) {
    const modal = h2.closest('div[class*="fixed"][class*="inset-0"]') ?? h2.parentElement?.parentElement;
    const trade = modal ? matchTrade(modal, trades.values(), new Set()) : null;
    if (modal && trade) {
      // Le cadre de la fenêtre : premier parent du titre qui contient aussi les cartes.
      const h3s = [...modal.querySelectorAll('h3')];
      let box: Element = h2;
      while (box.parentElement && box !== modal && !h3s.every((h) => box.contains(h))) box = box.parentElement;
      mountValues(box, trade, true);
    }
  }
}

// ---------------------------------------------------------------- mini-cartes

function renderPreviews(): void {
  for (const chip of document.querySelectorAll<HTMLElement>('span[title][style*="--color-rarity-"]')) {
    if (chip.closest('[data-wiky]')) continue;
    const title = chip.getAttribute('title') ?? '';
    const rarity = (chip.getAttribute('style') ?? '').match(/--color-rarity-([a-z]+)\)/i)?.[1]?.toUpperCase() ?? '';
    if (!title) continue;
    const card = byTitle.get(norm(title));
    const r = (RARITIES.has(rarity) ? rarity : card?.rarity ?? null) as Rarity | null;
    const price = ctx?.flags.tradeValues && card ? displayPrice(prices.get(card.siteId)) : null;
    const key = JSON.stringify([title, r, card?.imageUrl ?? null, price]);
    const prev = chip.previousElementSibling as HTMLElement | null;
    if (prev?.getAttribute('data-wiky') === 'trade-preview' && prev.dataset.key === key) continue;
    const preview = node('span', 'trade-preview');
    preview.dataset.key = key;
    preview.title = title;
    if (r) preview.style.setProperty('--wiky-rar', RARITY_COLORS[r]);
    const art = node('span', 'part', 'wiky-tp-art', title.split(/\s+/).slice(0, 2).map((w) => w[0] ?? '').join('').toUpperCase());
    if (card?.imageUrl) {
      const img = node('img', 'part');
      img.alt = '';
      img.loading = 'lazy';
      img.decoding = 'async';
      img.referrerPolicy = 'no-referrer';
      img.src = card.imageUrl;
      img.addEventListener('error', () => img.remove(), { once: true });
      art.append(img);
    }
    art.append(rarityChip(r));
    preview.append(art, node('span', 'part', 'wiky-tp-title', title));
    if (price != null) preview.append(node('span', 'part', 'wiky-tp-price', wiki(price)));
    if (prev?.getAttribute('data-wiky') === 'trade-preview') prev.replaceWith(preview);
    else chip.before(preview);
  }
}

function clear(): void {
  for (const n of document.querySelectorAll('[data-wiky="trade-values"], [data-wiky="trade-preview"]')) n.remove();
}

/** Si la page n'a pas (encore) demandé les échanges, une lecture identique à la sienne. */
async function fetchTrades(): Promise<void> {
  try {
    const res = await fetch('/api/trades', { method: 'GET', credentials: 'include', headers: { accept: '*/*' } });
    if (res.ok) ingestTrades(await res.json());
  } catch {
    // Pas d'échanges : rien à afficher.
  }
}

function render(c: FeatureContext): void {
  ctx = c;
  if (!isTradesPage(c.path)) return;
  if (!trades.size && fetchedFor !== c.path) {
    fetchedFor = c.path;
    // Laisse d'abord au site le temps de faire sa propre requête (relayée par bridge.ts).
    setTimeout(() => {
      if (!trades.size && ctx && isTradesPage(location.pathname)) void fetchTrades();
    }, 1500);
  }
  ensureFeatureStyle();
  ensureFeatureStyle(CSS, 'trades');
  // Valeurs : prix moyens lus via l'API (option « lecture via l'API »).
  const values = c.flags.tradeValues && c.apiRead;
  if (values) {
    void loadPrices();
    renderValues();
  } else for (const n of document.querySelectorAll('[data-wiky="trade-values"]')) n.remove();
  if (c.flags.tradePreviews) renderPreviews();
  else for (const n of document.querySelectorAll('[data-wiky="trade-preview"]')) n.remove();
}

onSiteResponse(/\/api\/trades/, (r) => {
  if (r.method === 'GET' && r.status < 400) ingestTrades(r.body);
});

registerFeature({
  keys: ['tradeValues', 'tradePreviews'],
  render,
  cleanup() {
    ctx = null;
    clear();
  },
});

/** Pour les tests. */
export function resetTrades(): void {
  trades.clear();
  byTitle.clear();
  prices = new Map();
  ctx = null;
  fetchedFor = '';
  pricesFor = '';
  pricesLoading = false;
}
