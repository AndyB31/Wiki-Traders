/**
 * Prix moyen d'une carte sur la page d'une enchère (/marketplace/<uuid>) et dans la fiche d'une carte ouverte
 * par le site : moyenne des ventes conclues (comme le site), médiane, nombre de ventes, plus bas et plus haut, et
 * taux de vente (enchères conclues sur toutes les enchères terminées de la carte).
 * L'enchère → carte et le titre → carte passent par le catalogue (mis en cache), les prix par `cardPrices`,
 * le taux de vente par `cardSalesHistory`.
 */
import { cardIdForAuction, cardIdsByTitles, cardPrices, cardSalesHistory, knownCardId, knownPrice, type CardPrice } from '../catalog';
import { ensureStyle, formatW, isolateClicks, myCard, openCardPanels } from './dom';
import { historyStats } from './price-history-logic';
import { registerFeature, type FeatureContext } from './runtime';

const CSS = `
.wiky-mprice { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 16px; margin: 12px 0; padding: 10px 14px; border-radius: 12px;
  border: 1px solid rgba(249,115,22,.35); background: linear-gradient(180deg, rgba(249,115,22,.10), rgba(249,115,22,.03));
  color: var(--color-foreground); font-size: 13px; }
.wiky-mprice-label { font-size: 10.5px; font-weight: 700; letter-spacing: .05em; text-transform: uppercase; color: #fb923c; }
.wiky-mprice-value { font-size: 20px; font-weight: 800; color: #fdba74; font-variant-numeric: tabular-nums; }
.wiky-mprice-meta { color: color-mix(in srgb, var(--color-foreground) 60%, transparent); font-variant-numeric: tabular-nums; }
.wiky-mprice-meta b { color: var(--color-foreground); font-weight: 600; }
.wiky-mprice.in-panel { margin: 10px 0 0; }
`;

const AUCTION_RE = /^\/marketplace\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/?$/i;

let lastCtx: FeatureContext | null = null;
const requested = new Map<string, number>();
const RETRY_MS = 60_000;

/** Lance une requête au plus une fois par minute par clé ; repeint à la fin. */
function once(key: string, job: () => Promise<unknown>): void {
  const now = Date.now();
  if (now - (requested.get(key) ?? 0) < RETRY_MS) return;
  requested.set(key, now);
  void job()
    .catch(() => undefined)
    .finally(() => lastCtx && paint(lastCtx));
}

/** Taux de vente d'une carte : enchères conclues sur l'ensemble des enchères terminées (vendues, sans acheteur, annulées). */
export interface SellRate {
  sold: number;
  total: number;
  pct: number;
}

/** Taux de vente par carte du catalogue (lu avec l'historique des ventes, mis en cache 5 min par le catalogue). */
const rates = new Map<string, SellRate | null>();

export function priceSummary(p: CardPrice | undefined, rate?: SellRate | null): { value: string; meta: string } {
  const rateText = rate ? ` · taux de vente <b>${rate.pct} %</b> (${rate.sold}/${rate.total})` : '';
  if (!p) return { value: '…', meta: 'Chargement des ventes…' };
  if (!p.count) return { value: '—', meta: `Aucune vente conclue${rateText}` };
  const range = p.min != null && p.max != null ? ` · min <b>${formatW(p.min)}</b> · max <b>${formatW(p.max)}</b>` : '';
  const median = p.median != null ? ` · médiane <b>${formatW(p.median)}</b>` : '';
  return { value: `${formatW(p.mean)} W`, meta: `<b>${p.count}</b> vente${p.count > 1 ? 's' : ''}${median}${range}${rateText}` };
}

function box(host: Element, where: 'after' | 'append', siteId: string, extraClass = ''): void {
  const s = priceSummary(knownPrice(siteId), rates.get(siteId));
  const key = `${siteId}|${s.value}|${s.meta}`;
  const existing = (where === 'after' ? host.parentElement : host)?.querySelector<HTMLElement>(':scope > [data-wiky="mprice"]') ?? null;
  if (existing?.dataset.key === key) return;
  const el = existing ?? document.createElement('div');
  el.setAttribute('data-wiky', 'mprice');
  el.className = `wiky-mprice ${extraClass}`.trim();
  el.dataset.key = key;
  el.innerHTML = `<span class="wiky-mprice-label">Prix moyen</span><span class="wiky-mprice-value"></span><span class="wiky-mprice-meta"></span>`;
  el.querySelector('.wiky-mprice-value')!.textContent = s.value;
  el.querySelector('.wiky-mprice-meta')!.innerHTML = s.meta;
  el.title = 'Moyenne des ventes conclues ; taux de vente : enchères conclues sur toutes les enchères terminées (Wiki-Traders)';
  if (!existing) {
    isolateClicks(el);
    if (where === 'after') host.after(el);
    else host.append(el);
  }
  if (!knownPrice(siteId)) once(`p:${siteId}`, () => cardPrices([siteId]));
  if (!rates.has(siteId))
    once(`r:${siteId}`, () =>
      cardSalesHistory(siteId).then((list) => {
        const st = historyStats(list);
        rates.set(siteId, st.sellRate == null ? null : { sold: st.sold, total: list.length, pct: st.sellRate });
      }),
    );
}

function paintAuctionPage(ctx: FeatureContext): void {
  const auctionId = ctx.path.match(AUCTION_RE)?.[1];
  const current = document.querySelector<HTMLElement>('main [data-wiky="mprice"]:not(.in-panel)');
  if (!auctionId) {
    current?.remove();
    return;
  }
  if (current && current.dataset.auction !== auctionId) current.remove();
  const h1 = document.querySelector('main h1');
  // Bloc du titre (titre + ligne d'informations), comme « Prix moyen collection ».
  const host = h1?.parentElement?.parentElement ?? h1?.parentElement;
  if (!host || host.closest('[data-wiky]')) return;
  if (!auctionCards.has(auctionId)) once(`a:${auctionId}`, () => cardIdForAuction(auctionId).then((id) => auctionCards.set(auctionId, id)));
  const siteId = auctionCards.get(auctionId);
  if (!siteId) return;
  box(host, 'after', siteId);
  host.parentElement?.querySelector<HTMLElement>(':scope > [data-wiky="mprice"]')?.setAttribute('data-auction', auctionId);
}

const auctionCards = new Map<string, string | null>();

function paintPanels(ctx: FeatureContext): void {
  const panels = openCardPanels();
  const live = new Set<Element>();
  for (const { panel, title } of panels) {
    if (!title) continue;
    const siteId = myCard(ctx, title)?.siteId ?? knownCardId(title);
    if (siteId === undefined) {
      once(`t:${title}`, () => cardIdsByTitles([title]));
      continue;
    }
    if (!siteId) continue;
    box(panel, 'append', siteId, 'in-panel');
    const el = panel.querySelector(':scope > [data-wiky="mprice"]');
    if (el) live.add(el);
  }
  for (const el of document.querySelectorAll('[data-wiky="mprice"].in-panel')) if (!live.has(el)) el.remove();
}

function paint(ctx: FeatureContext): void {
  ensureStyle('wiky-mprice-style', CSS);
  paintAuctionPage(ctx);
  paintPanels(ctx);
}

registerFeature({
  keys: ['marketplacePrice'],
  needsApi: true,
  render(ctx) {
    lastCtx = ctx;
    paint(ctx);
  },
  cleanup() {
    lastCtx = null;
    document.querySelectorAll('[data-wiky="mprice"]').forEach((n) => n.remove());
  },
});
