/**
 * Marché → « Mes enchères » : panneau de mes mises (au-dessus de la liste du site) ;
 * Marché → « Historique » : mes ventes terminées avec statistiques (à la place de la grille du site, réaffichable).
 *
 * Les panneaux sont construits une fois (filtres, recherche) ; seule la liste est redessinée quand sa clé change.
 * Aucun appel réseau ici, sauf les prix moyens de l'historique (une fois par ouverture, en lots via catalog.ts).
 */
import type { BidStatus, MyBid, Rarity, SoldItem } from '../../lib/types';
import { cardIdsByTitles, cardPrices, displayPrice, knownCardId, knownPrice } from '../catalog';
import { formatRemaining, nextMinBid, quickOutbidWithToast } from './bid-watch';
import { allocationInput, type MarketData } from './market-data';
import { filterBids, filterSales, gap, isRunningBid, salesStats, type BidsFilter, type SalesFilter, type SalesSort } from './market-tabs-logic';
import { makeContext as pricingContext } from '../../lib/allocation';
import { rarityBase } from '../../lib/pricing';
import type { FeatureContext } from './runtime';
import { button, ensureFeatureStyle, node, RARITY_COLORS, wiki } from './ui';

const CSS = `
.wiky-mt { margin: 0; padding: 14px 16px; border-radius: 16px; border: 1px solid var(--color-border, rgba(255,255,255,.12)); background: var(--color-surface, #1c1917);
  color: var(--color-foreground, #e7e5e4); font-size: 13px; line-height: 1.4; }
.wiky-mt-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 10px; }
.wiky-mt-head h2 { margin: 0; font-size: 15px; font-weight: 700; }
.wiky-mt-head .wiky-mt-kicker { font-size: 10px; font-weight: 700; letter-spacing: .05em; text-transform: uppercase; color: #fb923c; }
.wiky-mt-status { font-size: 12px; color: color-mix(in srgb, var(--color-foreground, #e7e5e4) 55%, transparent); }
.wiky-mt-tools { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin-left: auto; }
.wiky-mt-chip { all: unset; cursor: pointer; padding: 4px 10px; border-radius: 999px; font-size: 12px; font-weight: 600; border: 1px solid var(--color-border, rgba(255,255,255,.15));
  color: color-mix(in srgb, var(--color-foreground, #e7e5e4) 70%, transparent); }
.wiky-mt-chip:hover { color: var(--color-foreground, #fff); }
.wiky-mt-chip[aria-pressed="true"] { border-color: rgba(249,115,22,.6); background: rgba(249,115,22,.14); color: #fdba74; }
.wiky-mt input[type="search"], .wiky-mt select { padding: 4px 10px; border-radius: 10px; font: inherit; font-size: 12px; border: 1px solid var(--color-border, rgba(255,255,255,.15));
  background: var(--color-surface-light, rgba(255,255,255,.04)); color: var(--color-foreground, #e7e5e4); }
.wiky-mt-list { display: flex; flex-direction: column; }
.wiky-mt-row { display: grid; grid-template-columns: 10px minmax(0, 1fr) auto; gap: 2px 10px; align-items: center; padding: 8px 6px; border-top: 1px solid var(--color-border, rgba(255,255,255,.08)); }
.wiky-mt-row:first-child { border-top: 0; }
.wiky-mt-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--wiky-rar, #94a3b8); }
.wiky-mt-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; color: inherit; text-decoration: none; }
a.wiky-mt-name:hover { text-decoration: underline; }
.wiky-mt-right { display: flex; align-items: center; gap: 8px; justify-content: flex-end; font-variant-numeric: tabular-nums; }
.wiky-mt-sub { grid-column: 2 / -1; display: flex; flex-wrap: wrap; gap: 4px 10px; font-size: 11.5px; color: color-mix(in srgb, var(--color-foreground, #e7e5e4) 55%, transparent); }
.wiky-mt-pill { padding: 1px 8px; border-radius: 999px; font-size: 11px; font-weight: 700; white-space: nowrap; }
.wiky-mt-pill.leading, .wiky-mt-pill.won { background: rgba(34,197,94,.16); color: #4ade80; }
.wiky-mt-pill.outbid, .wiky-mt-pill.unsold { background: rgba(239,68,68,.16); color: #f87171; }
.wiky-mt-pill.lost, .wiky-mt-pill.cancelled { background: var(--color-surface-light, rgba(255,255,255,.08)); color: color-mix(in srgb, var(--color-foreground, #e7e5e4) 60%, transparent); }
.wiky-mt-time { font-weight: 700; }
.wiky-mt-row.soon .wiky-mt-time { color: #fdba74; }
.wiky-mt-row.urgent .wiky-mt-time { color: #f87171; }
.wiky-mt .up { color: #4ade80; } .wiky-mt .down { color: #f87171; }
.wiky-mt-empty { padding: 14px 6px; text-align: center; color: color-mix(in srgb, var(--color-foreground, #e7e5e4) 50%, transparent); }
.wiky-mt-stats { display: grid; grid-template-columns: repeat(auto-fill, minmax(130px, 1fr)); gap: 8px; margin-bottom: 12px; }
.wiky-mt-stat { padding: 8px 10px; border-radius: 12px; background: var(--color-surface-light, rgba(255,255,255,.04)); border: 1px solid var(--color-border, rgba(255,255,255,.08)); min-width: 0; }
.wiky-mt-stat small { display: block; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .04em; color: color-mix(in srgb, var(--color-foreground, #e7e5e4) 50%, transparent); }
.wiky-mt-stat b { display: block; font-size: 15px; font-variant-numeric: tabular-nums; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wiky-mt-more { display: flex; justify-content: center; padding-top: 8px; }
[data-wiky-hidden] { display: none !important; }
`;

/** « 05/10 14:32 ». */
function formatDate(ms: number): string {
  return new Date(ms).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function style(): void {
  ensureFeatureStyle();
  ensureFeatureStyle(CSS, 'market-panels');
}

const pct = (g: number | null) => (g == null ? '—' : `${g >= 0 ? '+' : ''}${Math.round(g * 100)} %`);
const signed = (n: number) => `${n >= 0 ? '+' : '−'}${wiki(Math.abs(n))}`;

function gapSpan(value: number | null, ref: number | null, label: string): HTMLElement | null {
  const g = gap(value, ref);
  if (g == null || value == null || ref == null) return null;
  return node('span', 'part', g >= 0 ? 'up' : 'down', `${signed(value - ref)} (${pct(g)}) vs ${label}`);
}

function rarityDot(r: Rarity | null): HTMLElement {
  const dot = node('span', 'part', 'wiky-mt-dot');
  if (r) dot.style.setProperty('--wiky-rar', RARITY_COLORS[r]);
  dot.title = r ?? 'rareté inconnue';
  return dot;
}

function readPref<T extends string>(key: string, allowed: T[], fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return allowed.includes(v as T) ? (v as T) : fallback;
  } catch {
    return fallback;
  }
}

function writePref(key: string, v: string): void {
  try {
    localStorage.setItem(key, v);
  } catch {
    // Stockage du navigateur indisponible.
  }
}

function chips<T extends string>(options: [T, string][], current: () => T, onPick: (v: T) => void): HTMLElement {
  const wrap = node('div', 'part', 'wiky-mt-tools');
  wrap.setAttribute('role', 'group');
  const draw = () => {
    for (const b of wrap.querySelectorAll<HTMLElement>('button')) b.setAttribute('aria-pressed', String(b.dataset.value === current()));
  };
  for (const [v, label] of options) {
    const b = node('button', 'part', 'wiky-mt-chip', label);
    b.type = 'button';
    b.dataset.value = v;
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      onPick(v);
      draw();
    });
    wrap.append(b);
  }
  draw();
  return wrap;
}

/** Place `panel` juste après la barre d'onglets (sans toucher aux nœuds du site). */
function placeAfter(bar: HTMLElement, panel: HTMLElement): void {
  if (panel.previousElementSibling !== bar) bar.after(panel);
}

// ---------------------------------------------------------------- mes mises

export const BID_FILTER_KEY = 'wiky-mt-bids-filter';
const BID_STATUS: Record<BidStatus, string> = { leading: 'En tête', outbid: 'Surenchéri', won: 'Gagnée', lost: 'Perdue', cancelled: 'Annulée' };

let bidsFilter: BidsFilter = readPref<BidsFilter>(BID_FILTER_KEY, ['current', 'history', 'all'], 'current');
let bidsRefreshing = false;
let bidsRefreshTimer: ReturnType<typeof setTimeout> | undefined;
let bidsRefreshAt = 0;
let ticker: ReturnType<typeof setInterval> | undefined;

/** À l'ouverture de l'onglet : relecture de mes mises demandée à index.ts (« Actualisation… » jusqu'au nouveau relevé). */
export function requestBidsRefresh(d: MarketData | null): void {
  bidsRefreshing = true;
  bidsRefreshAt = d?.bidsCache?.at ?? 0;
  clearTimeout(bidsRefreshTimer);
  bidsRefreshTimer = setTimeout(() => {
    bidsRefreshing = false;
    redrawBids();
  }, 15_000);
  window.dispatchEvent(new CustomEvent('wiky-refresh-bids'));
}

let bidsCtx: FeatureContext | null = null;
let bidsData: MarketData | null = null;

function redrawBids(): void {
  const panel = document.querySelector<HTMLElement>('[data-wiky="mt-bids"]');
  if (panel && bidsCtx && bidsData) fillBids(panel, bidsCtx, bidsData, true);
}

export function renderBidsPanel(ctx: FeatureContext, bar: HTMLElement, d: MarketData): void {
  bidsCtx = ctx;
  bidsData = d;
  if (bidsRefreshing && (d.bidsCache?.at ?? 0) > bidsRefreshAt) {
    bidsRefreshing = false;
    clearTimeout(bidsRefreshTimer);
  }
  style();
  let panel = document.querySelector<HTMLElement>('[data-wiky="mt-bids"]');
  if (!panel) {
    panel = node('section', 'mt-bids', 'wiky-mt');
    panel.setAttribute('aria-label', 'Mes mises (Wiky-Traders)');
    const head = node('div', 'part', 'wiky-mt-head');
    const titles = node('div', 'part');
    titles.append(node('div', 'part', 'wiky-mt-kicker', 'Wiky-Traders'), node('h2', 'part', '', 'Mes mises'));
    const status = node('span', 'part', 'wiky-mt-status');
    status.dataset.role = 'status';
    head.append(
      titles,
      status,
      chips<BidsFilter>(
        [
          ['current', 'En cours'],
          ['history', 'Historique'],
          ['all', 'Toutes'],
        ],
        () => bidsFilter,
        (v) => {
          bidsFilter = v;
          writePref(BID_FILTER_KEY, v);
          redrawBids();
        },
      ),
    );
    const list = node('div', 'part', 'wiky-mt-list');
    list.dataset.role = 'list';
    panel.append(head, list);
  }
  placeAfter(bar, panel);
  fillBids(panel, ctx, d, false);
  syncTicker();
}

function bidRowClass(b: MyBid, now: number): string {
  const left = b.endsAt == null ? Infinity : b.endsAt - now;
  const run = isRunningBid(b, now);
  return `wiky-mt-row${run && left <= 60_000 ? ' urgent' : run && left <= 10 * 60_000 ? ' soon' : ''}`;
}

function fillBids(panel: HTMLElement, ctx: FeatureContext, d: MarketData, force: boolean): void {
  const now = Date.now();
  const quick = ctx.flags.quickOutbid && ctx.apiRead;
  const cache = d.bidsCache;
  const list = filterBids(cache?.bids ?? [], bidsFilter, now);
  const statusText = !ctx.apiRead
    ? 'Lecture via l\'API désactivée (Réglages → Automatisations).'
    : bidsRefreshing
      ? 'Actualisation…'
      : cache
        ? `Relevé ${formatDate(cache.at)}`
        : 'Pas encore de relevé.';
  const status = panel.querySelector<HTMLElement>('[data-role="status"]');
  if (status && status.textContent !== statusText) status.textContent = statusText;
  const key = JSON.stringify([bidsFilter, quick, list.map((b) => [b.auctionId, b.status, b.current, b.myMax, b.endsAt, isRunningBid(b, now)])]);
  const box = panel.querySelector<HTMLElement>('[data-role="list"]')!;
  if (!force && box.dataset.key === key) return;
  box.dataset.key = key;
  if (!list.length) {
    const empty = bidsFilter === 'current' ? 'Aucune mise en cours.' : bidsFilter === 'history' ? 'Aucune mise terminée.' : 'Aucune mise trouvée.';
    box.replaceChildren(node('div', 'part', 'wiky-mt-empty', bidsRefreshing && !cache ? 'Actualisation…' : empty));
    return;
  }
  const frag = document.createDocumentFragment();
  for (const b of list) frag.append(bidRow(b, now, quick));
  box.replaceChildren(frag);
}

function bidRow(b: MyBid, now: number, quick: boolean): HTMLElement {
  const run = isRunningBid(b, now);
  const row = node('div', 'part', bidRowClass(b, now));
  row.dataset.auction = b.auctionId;
  const link = node('a', 'part', 'wiky-mt-name', `${b.cardName}${b.shiny ? ' ✨' : ''}`);
  link.href = `/marketplace/${encodeURIComponent(b.auctionId)}`;
  link.title = 'Ouvrir l\'enchère';
  const right = node('div', 'part', 'wiky-mt-right');
  right.append(node('span', 'part', `wiky-mt-pill ${b.status}`, BID_STATUS[b.status]));
  if (run && b.endsAt != null) {
    const t = node('span', 'part', 'wiky-mt-time', formatRemaining(b.endsAt - now));
    t.dataset.ends = String(b.endsAt);
    right.append(t);
  } else if (b.endsAt != null) right.append(node('span', 'part', 'wiky-f-muted', formatDate(b.endsAt)));
  const sub = node('div', 'part', 'wiky-mt-sub');
  sub.append(
    node('span', 'part', '', `ma mise ${wiki(b.myMax)}${b.myBids > 1 ? ` (${b.myBids}×)` : ''}`),
    node('span', 'part', '', `${b.status === 'won' || b.status === 'lost' ? 'final' : 'actuel'} ${wiki(b.current)}`),
    node('span', 'part', '', b.cardMedian != null ? `réf. carte ${wiki(b.cardMedian)} (${b.cardSales} vente${b.cardSales > 1 ? 's' : ''})` : 'carte jamais vendue'),
  );
  const g = gapSpan(b.current, b.cardMedian, 'réf.');
  if (g) sub.append(g);
  if (quick && b.status === 'outbid' && run) {
    const next = nextMinBid(b.current, true);
    const btn = button(`Surenchérir${next ? ` ${next}` : ''}`, async () => {
      btn.disabled = true;
      await quickOutbidWithToast(b.auctionId);
      btn.disabled = false;
    }, '', true);
    btn.title = 'Surenchérir au minimum (+10 %), après confirmation';
    sub.append(btn);
  }
  row.append(rarityDot(b.rarity), link, right, sub);
  return row;
}

/** Compte à rebours à la seconde, seulement quand le panneau est affiché et l'onglet visible. */
function syncTicker(): void {
  const panel = document.querySelector('[data-wiky="mt-bids"]');
  const needed = !!panel?.isConnected && document.visibilityState !== 'hidden' && !!panel.querySelector('[data-ends]');
  if (needed) ticker ??= setInterval(tick, 1000);
  else {
    clearInterval(ticker);
    ticker = undefined;
  }
}

function tick(): void {
  const panel = document.querySelector('[data-wiky="mt-bids"]');
  if (!panel?.isConnected || document.visibilityState === 'hidden') return syncTicker();
  const now = Date.now();
  let ended = false;
  for (const t of panel.querySelectorAll<HTMLElement>('[data-ends]')) {
    const left = Number(t.dataset.ends) - now;
    const text = formatRemaining(left);
    if (t.textContent !== text) t.textContent = text;
    const row = t.closest<HTMLElement>('.wiky-mt-row');
    const cls = `wiky-mt-row${left <= 60_000 ? ' urgent' : left <= 10 * 60_000 ? ' soon' : ''}`;
    if (row && row.className !== cls) row.className = cls;
    if (left <= 0) ended = true;
  }
  if (ended) redrawBids();
}

if (typeof document !== 'undefined') document.addEventListener('visibilitychange', () => syncTicker());

export function removeBidsPanel(): void {
  document.querySelector('[data-wiky="mt-bids"]')?.remove();
  syncTicker();
}

// ---------------------------------------------------------------- historique de mes ventes

export const SALES_FILTER_KEY = 'wiky-mt-sales-filter';
const PAGE = 100;

let salesFilter: SalesFilter = readPref<SalesFilter>(SALES_FILTER_KEY, ['all', 'sold', 'unsold'], 'all');
let salesSort: SalesSort = 'date';
let salesQuery = '';
let salesLimit = PAGE;
let showSiteList = false;
let salesRefreshing = false;
let salesRefreshAt = 0;
let salesRefreshTimer: ReturnType<typeof setTimeout> | undefined;
let pricesVersion = 0;
let histCtx: FeatureContext | null = null;
let histData: MarketData | null = null;
let histBar: HTMLElement | null = null;
/** Identifiant du site de chaque carte vendue (par nom), résolu une fois par ouverture. */
const siteIdByName = new Map<string, string>();

/** À l'ouverture de l'onglet : relecture de mes ventes (index.ts) et prix moyens des cartes (en lots). */
export function requestSalesRefresh(ctx: FeatureContext, d: MarketData | null): void {
  salesRefreshing = true;
  salesRefreshAt = d?.salesCache?.at ?? 0;
  salesLimit = PAGE;
  clearTimeout(salesRefreshTimer);
  salesRefreshTimer = setTimeout(() => {
    salesRefreshing = false;
    redrawHistory();
  }, 20_000);
  window.dispatchEvent(new CustomEvent('wiky-refresh-sales-history'));
  if (ctx.apiRead && d?.salesCache?.items.length) void loadSalePrices(ctx, d.salesCache.items);
}

async function loadSalePrices(ctx: FeatureContext, items: SoldItem[]): Promise<void> {
  try {
    const names = [...new Set(items.map((i) => i.cardName))];
    for (const n of names) {
      const id = ctx.cards[items.find((i) => i.cardName === n)!.cardId]?.siteId ?? knownCardId(n);
      if (id) siteIdByName.set(n, id);
    }
    const missing = names.filter((n) => !siteIdByName.has(n));
    if (missing.length) for (const [t, id] of await cardIdsByTitles(missing)) siteIdByName.set(t, id);
    await cardPrices([...new Set(siteIdByName.values())]);
    pricesVersion++;
    redrawHistory();
  } catch {
    // Prix indisponibles : la référence retombe sur la médiane relevée avec mes ventes.
  }
}

/** Prix de référence d'une vente : moyenne de la carte dans sa rareté (comme le site), sinon médiane, sinon rareté. */
export function saleReference(item: SoldItem, siteId: string | null | undefined, rarityFallback: (i: SoldItem) => number | null): number | null {
  const mean = siteId ? displayPrice(knownPrice(siteId), item.rarity) : null;
  if (mean != null) return mean;
  if (item.cardSales && item.cardMedian != null) return item.cardMedian;
  return rarityFallback(item);
}

function referenceFn(ctx: FeatureContext, d: MarketData): (i: SoldItem) => number | null {
  const pctx = pricingContext(allocationInput(ctx, d), Date.now());
  const memo = new Map<string, number | null>();
  return (i) => {
    if (memo.has(i.auctionId)) return memo.get(i.auctionId)!;
    const v = saleReference(i, siteIdByName.get(i.cardName) ?? ctx.cards[i.cardId]?.siteId, (x) => rarityBase(x.rarity, x.shiny, pctx)?.value ?? null);
    memo.set(i.auctionId, v);
    return v;
  };
}

function redrawHistory(): void {
  const panel = document.querySelector<HTMLElement>('[data-wiky="mt-history"]');
  if (panel && histCtx && histData) fillHistory(panel, histCtx, histData, true);
}

/** La grille du site (contenu de l'onglet) est masquée tant que notre panneau est affiché ; jamais retirée. */
function siteContent(bar: HTMLElement): HTMLElement | null {
  let n = bar.nextElementSibling;
  while (n && n.hasAttribute('data-wiky')) n = n.nextElementSibling;
  return n as HTMLElement | null;
}

export function unhideSiteContent(): void {
  document.querySelectorAll('[data-wiky-hidden]').forEach((n) => n.removeAttribute('data-wiky-hidden'));
}

function syncSiteVisibility(bar: HTMLElement): void {
  const content = siteContent(bar);
  for (const n of document.querySelectorAll('[data-wiky-hidden]')) if (n !== content || showSiteList) n.removeAttribute('data-wiky-hidden');
  if (content && !showSiteList && !content.hasAttribute('data-wiky-hidden')) content.setAttribute('data-wiky-hidden', '');
}

export function renderHistoryPanel(ctx: FeatureContext, bar: HTMLElement, d: MarketData): void {
  histCtx = ctx;
  histData = d;
  histBar = bar;
  if (salesRefreshing && (d.salesCache?.at ?? 0) > salesRefreshAt) {
    salesRefreshing = false;
    clearTimeout(salesRefreshTimer);
    if (ctx.apiRead && d.salesCache?.items.length) void loadSalePrices(ctx, d.salesCache.items);
  }
  style();
  let panel = document.querySelector<HTMLElement>('[data-wiky="mt-history"]');
  if (!panel) panel = buildHistoryPanel();
  placeAfter(bar, panel);
  syncSiteVisibility(bar);
  fillHistory(panel, ctx, d, false);
}

function buildHistoryPanel(): HTMLElement {
  const panel = node('section', 'mt-history', 'wiky-mt');
  panel.setAttribute('aria-label', 'Historique de mes ventes (Wiky-Traders)');
  const head = node('div', 'part', 'wiky-mt-head');
  const titles = node('div', 'part');
  titles.append(node('div', 'part', 'wiky-mt-kicker', 'Wiky-Traders'), node('h2', 'part', '', 'Historique de mes ventes'));
  const status = node('span', 'part', 'wiky-mt-status');
  status.dataset.role = 'status';
  const siteToggle = node('button', 'part', 'wiky-mt-chip', 'Liste du site');
  siteToggle.type = 'button';
  siteToggle.dataset.role = 'site-toggle';
  siteToggle.title = 'Affiche aussi la liste d\'origine du site';
  siteToggle.addEventListener('click', (e) => {
    e.stopPropagation();
    showSiteList = !showSiteList;
    siteToggle.setAttribute('aria-pressed', String(showSiteList));
    if (histBar) syncSiteVisibility(histBar);
  });
  siteToggle.setAttribute('aria-pressed', String(showSiteList));
  head.append(titles, status, siteToggle);
  const stats = node('div', 'part', 'wiky-mt-stats');
  stats.dataset.role = 'stats';
  const tools = node('div', 'part', 'wiky-mt-head');
  const search = node('input', 'part');
  search.type = 'search';
  search.placeholder = 'Chercher une carte…';
  search.setAttribute('aria-label', 'Chercher une carte');
  search.value = salesQuery;
  search.addEventListener('input', () => {
    salesQuery = search.value;
    salesLimit = PAGE;
    redrawHistory();
  });
  const sort = node('select', 'part');
  sort.setAttribute('aria-label', 'Trier');
  for (const [v, label] of [
    ['date', 'Plus récentes'],
    ['price', 'Prix'],
    ['gap', 'Écart vs prix de la carte'],
  ] as [SalesSort, string][]) {
    const o = node('option', 'part', '', label);
    o.value = v;
    o.selected = v === salesSort;
    sort.append(o);
  }
  sort.addEventListener('change', () => {
    salesSort = sort.value as SalesSort;
    redrawHistory();
  });
  tools.append(
    chips<SalesFilter>(
      [
        ['all', 'Toutes'],
        ['sold', 'Vendues'],
        ['unsold', 'Invendues'],
      ],
      () => salesFilter,
      (v) => {
        salesFilter = v;
        salesLimit = PAGE;
        writePref(SALES_FILTER_KEY, v);
        redrawHistory();
      },
    ),
    search,
    sort,
  );
  tools.firstElementChild!.setAttribute('style', 'margin-left:0');
  const list = node('div', 'part', 'wiky-mt-list');
  list.dataset.role = 'list';
  const more = node('div', 'part', 'wiky-mt-more');
  more.dataset.role = 'more';
  panel.append(head, stats, tools, list, more);
  return panel;
}

function stat(label: string, value: string, title = ''): HTMLElement {
  const s = node('div', 'part', 'wiky-mt-stat');
  s.append(node('small', 'part', '', label), node('b', 'part', '', value));
  if (title) s.title = title;
  return s;
}

function fillHistory(panel: HTMLElement, ctx: FeatureContext, d: MarketData, force: boolean): void {
  const items = d.salesCache?.items ?? [];
  const statusText = !ctx.apiRead
    ? 'Lecture via l\'API désactivée (Réglages → Automatisations).'
    : salesRefreshing
      ? 'Actualisation…'
      : d.salesCache
        ? `Relevé ${formatDate(d.salesCache.at)} · ${items.length} vente(s) terminée(s)`
        : 'Pas encore de relevé.';
  const status = panel.querySelector<HTMLElement>('[data-role="status"]');
  if (status && status.textContent !== statusText) status.textContent = statusText;
  const key = JSON.stringify([d.salesCache?.at, salesFilter, salesSort, salesQuery, salesLimit, pricesVersion, salesRefreshing && !items.length]);
  const list = panel.querySelector<HTMLElement>('[data-role="list"]')!;
  if (!force && list.dataset.key === key) return;
  list.dataset.key = key;
  const refOf = referenceFn(ctx, d);
  const s = salesStats(items, refOf);
  const statsBox = panel.querySelector<HTMLElement>('[data-role="stats"]')!;
  statsBox.replaceChildren(
    stat('Ventes conclues', String(s.sold)),
    stat('Invendues', String(s.unsold)),
    stat('Taux de vente', s.rate == null ? '—' : `${Math.round(s.rate * 100)} %`),
    stat('Total encaissé', wiki(s.total)),
    stat('Gain moyen vs départ', pct(s.avgVsStart)),
    stat('Écart moyen vs prix carte', pct(s.avgVsRef), 'Prix de la carte : moyenne de ses ventes dans sa rareté, comme le site'),
    stat('Meilleure vente', s.best ? `${wiki(s.best.final)}` : '—', s.best ? s.best.cardName : ''),
  );
  const rows = filterSales(items, salesFilter, salesQuery, salesSort, refOf);
  const more = panel.querySelector<HTMLElement>('[data-role="more"]')!;
  if (!rows.length) {
    list.replaceChildren(node('div', 'part', 'wiky-mt-empty', salesRefreshing && !items.length ? 'Actualisation…' : items.length ? 'Aucune vente ne correspond.' : 'Aucune vente terminée.'));
    more.replaceChildren();
    return;
  }
  const frag = document.createDocumentFragment();
  for (const i of rows.slice(0, salesLimit)) frag.append(saleRow(i, refOf(i)));
  list.replaceChildren(frag);
  more.replaceChildren();
  if (rows.length > salesLimit) {
    more.append(
      button(`Afficher plus (${rows.length - salesLimit} restante${rows.length - salesLimit > 1 ? 's' : ''})`, () => {
        salesLimit += PAGE;
        redrawHistory();
      }, 'ghost', true),
    );
  }
}

function saleRow(i: SoldItem, ref: number | null): HTMLElement {
  const row = node('div', 'part', 'wiky-mt-row');
  const link = node('a', 'part', 'wiky-mt-name', `${i.cardName}${i.shiny ? ' ✨' : ''}`);
  link.href = `/marketplace/${encodeURIComponent(i.auctionId)}`;
  link.title = 'Ouvrir l\'enchère';
  const right = node('div', 'part', 'wiky-mt-right');
  if (i.sold) {
    right.append(node('span', 'part', 'wiky-f-muted', wiki(i.start)), node('span', 'part', '', '→'), node('b', 'part', '', wiki(i.final)));
    const g = gap(i.final, i.start);
    if (g != null) right.append(node('span', 'part', g >= 0 ? 'up' : 'down', pct(g)));
  } else right.append(node('span', 'part', 'wiky-f-muted', `départ ${wiki(i.start)}`), node('span', 'part', 'wiky-mt-pill unsold', 'Invendue'));
  const sub = node('div', 'part', 'wiky-mt-sub');
  sub.append(node('span', 'part', '', ref != null ? `réf. ${wiki(ref)}` : 'pas de prix de référence'));
  if (i.sold) {
    const g = gapSpan(i.final, ref, 'réf.');
    if (g) sub.append(g);
  }
  sub.append(node('span', 'part', '', i.endedAt ? formatDate(i.endedAt) : ''));
  row.append(rarityDot(i.rarity), link, right, sub);
  return row;
}

export function removeHistoryPanel(): void {
  document.querySelector('[data-wiky="mt-history"]')?.remove();
  unhideSiteContent();
}

/** Pour les tests. */
export function resetPanelsForTest(): void {
  bidsFilter = readPref<BidsFilter>(BID_FILTER_KEY, ['current', 'history', 'all'], 'current');
  salesFilter = readPref<SalesFilter>(SALES_FILTER_KEY, ['all', 'sold', 'unsold'], 'all');
  salesSort = 'date';
  salesQuery = '';
  salesLimit = PAGE;
  showSiteList = false;
  bidsRefreshing = salesRefreshing = false;
  siteIdByName.clear();
}
