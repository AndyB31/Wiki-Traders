/**
 * Vues de la collection (Réglages → Interface) : /collection?wview=<id> garde visibles les cartes qui passent le
 * filtre de la vue, dans l'ordre de son tri, avec un bandeau au-dessus de la grille (nom, résumé, nombre de cartes,
 * « Modifier », « Quitter la vue »).
 *
 * Les cartes du site ne sont jamais déplacées (React les gère) : celles qui ne passent pas le filtre sont masquées
 * (`data-wiky-vhide`), les autres reçoivent un `order` CSS (la grille du site les range dans cet ordre).
 * Filtre et tri sans DOM : lib/views.ts.
 */
import { familiesOf } from '../../lib/families';
import type { Card } from '../../lib/types';
import { applyView, viewHref, viewSummary, type CollectionView, type ViewContext } from '../../lib/views';
import { cardPrices, displayCount, knownCardPrice, knownCardRate, knownPrice } from '../catalog';
import { nativeCardSiteId } from '../collection-selection';
import { getFamilyIndex } from './families-state';
import { cardRarity, cardTitle, ensureStyle, isolateClicks, myCard, nativeCards } from './dom';
import { registerFeature, type FeatureContext } from './runtime';

const HIDE = 'data-wiky-vhide';
const ORDER = 'data-wiky-vorder';

const CSS = `
[${HIDE}] { display: none !important; }
.wiky-view-bar { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 14px; margin: 0 0 14px; padding: 10px 14px; border-radius: 14px;
  border: 1px solid rgba(249,115,22,.32); background: linear-gradient(180deg, rgba(249,115,22,.11), rgba(249,115,22,.04)); color: var(--color-foreground); font-size: 13px; }
.wiky-view-bar .wiky-view-name { display: inline-flex; align-items: center; gap: 8px; font-weight: 700; color: #fdba74; }
.wiky-view-bar .wiky-view-name svg { color: #fb923c; }
.wiky-view-bar .wiky-view-sum { flex: 1 1 240px; min-width: 0; color: color-mix(in srgb, var(--color-foreground) 62%, transparent); }
.wiky-view-bar .wiky-view-count { font-variant-numeric: tabular-nums; color: color-mix(in srgb, var(--color-foreground) 75%, transparent); }
.wiky-view-bar .wiky-view-count b { color: var(--color-foreground); }
.wiky-view-bar .wiky-view-note { flex-basis: 100%; font-size: 12px; color: color-mix(in srgb, var(--color-foreground) 50%, transparent); }
.wiky-view-bar .wiky-view-btn { font: inherit; font-size: 12px; font-weight: 600; padding: 5px 11px; border-radius: 9px; cursor: pointer; text-decoration: none; white-space: nowrap;
  border: 1px solid var(--color-border); background: var(--color-surface); color: color-mix(in srgb, var(--color-foreground) 80%, transparent); }
.wiky-view-bar .wiky-view-btn:hover { color: var(--color-foreground); border-color: rgba(249,115,22,.5); }
`;

const FILTER_ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>';

let last: FeatureContext | null = null;
let listening = false;
/** Lot de prix déjà demandé (une seule requête par vue et par jeu de cartes). */
let pricesAsked = '';

/** Vue demandée par l'adresse (`?wview=`), si elle existe encore. */
export function currentView(views: CollectionView[]): CollectionView | null {
  if (location.pathname !== '/collection') return null;
  const params = new URLSearchParams(location.search);
  if (params.has('wiky')) return null;
  const id = params.get('wview');
  return id ? views.find((v) => v.id === id) ?? null : null;
}

/** Ouvre une vue (ou la collection sans vue) : sur place si l'on est déjà sur la collection, sinon par navigation. */
export function goToView(id: string | null): void {
  const href = id ? viewHref(id) : '/collection';
  if (location.pathname !== '/collection' || new URLSearchParams(location.search).has('wiky')) {
    location.href = href;
    return;
  }
  history.pushState(history.state, '', href);
  window.dispatchEvent(new CustomEvent('wiky-view-change'));
}

function viewContext(): ViewContext {
  const idx = getFamilyIndex();
  return {
    price: (c) => knownCardPrice(c) ?? c.sitePrice ?? (c.siteId ? undefined : null),
    rate: (c) => knownCardRate(c)?.pct ?? null,
    sales: (c) => (c.siteId ? displayCount(knownPrice(c.siteId), c.rarity) : null),
    families: (c) => familiesOf(idx, c.siteId ?? null, c.name).map((f) => f.name),
  };
}

/** Carte de ma collection derrière une carte affichée (identifiant du site, sinon titre) ; repli : ce que montre la carte. */
function cardOf(el: HTMLElement, ctx: FeatureContext, bySiteId: Map<string, Card>): Card {
  const siteId = nativeCardSiteId(el);
  const title = cardTitle(el);
  const known = (siteId ? bySiteId.get(siteId) : undefined) ?? myCard(ctx, title);
  if (known) return known;
  return { id: title, siteId: siteId ?? undefined, name: title, rarity: cardRarity(el), tags: [], quantity: 1, favorite: false, sitePrice: null, sitePriceAt: null, updatedAt: 0 };
}

/** Grille des cartes : plus proche parent commun ; chaque carte y occupe une case (son ancêtre direct dans la grille). */
function gridOf(cards: HTMLElement[]): { grid: HTMLElement; cell: (card: HTMLElement) => HTMLElement } | null {
  if (!cards.length) return null;
  let grid: HTMLElement | null;
  if (cards.length === 1) {
    const cell = cards[0].closest<HTMLElement>('.group') ?? cards[0];
    grid = cell.parentElement;
  } else {
    grid = cards[0].parentElement;
    const lastCard = cards[cards.length - 1];
    while (grid && !grid.contains(lastCard)) grid = grid.parentElement;
  }
  if (!grid) return null;
  const g = grid;
  return {
    grid: g,
    cell: (card) => {
      let c = card;
      while (c.parentElement && c.parentElement !== g) c = c.parentElement;
      return c;
    },
  };
}

function clearView(): void {
  for (const n of document.querySelectorAll<HTMLElement>(`[${HIDE}]`)) n.removeAttribute(HIDE);
  for (const n of document.querySelectorAll<HTMLElement>(`[${ORDER}]`)) {
    n.style.removeProperty('order');
    n.removeAttribute(ORDER);
  }
  document.querySelector('[data-wiky="view-bar"]')?.remove();
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n > 1 ? many : one}`;
}

function renderBar(grid: HTMLElement, view: CollectionView, shown: number, total: number, onPage: number): void {
  let bar = document.querySelector<HTMLElement>('[data-wiky="view-bar"]');
  const key = JSON.stringify([view, shown, total, onPage]);
  if (bar && bar.nextElementSibling === grid && bar.dataset.key === key) return;
  if (!bar) {
    bar = document.createElement('div');
    bar.setAttribute('data-wiky', 'view-bar');
    bar.className = 'wiky-view-bar';
    isolateClicks(bar);
  }
  if (bar.nextElementSibling !== grid) grid.parentElement?.insertBefore(bar, grid);
  bar.dataset.key = key;
  const missing = total - shown;
  bar.innerHTML = `
    <span class="wiky-view-name">${FILTER_ICON}<span></span></span>
    <span class="wiky-view-sum"></span>
    <span class="wiky-view-count"><b>${plural(shown, 'carte')}</b> sur ${onPage} affichée${onPage > 1 ? 's' : ''}</span>
    <a class="wiky-view-btn" href="/settings?wiky=settings#interface">Modifier</a>
    <button type="button" class="wiky-view-btn" data-act="quit">✕ Quitter la vue</button>
    ${missing > 0 ? `<span class="wiky-view-note">${plural(missing, 'autre carte')} de ta collection ${missing > 1 ? 'correspondent' : 'correspond'} à cette vue mais ${missing > 1 ? 'ne sont' : 'n\'est'} pas sur cette page : change de page ou fais défiler la collection.</span>` : ''}
    ${!shown && !missing ? '<span class="wiky-view-note">Aucune carte ne correspond à cette vue.</span>' : ''}`;
  bar.querySelector('.wiky-view-name > span:last-child')!.textContent = view.name || 'Vue';
  bar.querySelector('.wiky-view-sum')!.textContent = viewSummary(view);
  bar.querySelector('[data-act="quit"]')!.addEventListener('click', () => goToView(null));
}

function render(ctx: FeatureContext): void {
  last = ctx;
  if (!listening) {
    listening = true;
    // Changement de vue sur place (barre latérale, « Quitter la vue ») : on n'attend pas la relecture de la page.
    window.addEventListener('wiky-view-change', () => last && render(last));
    window.addEventListener('popstate', () => last && setTimeout(() => last && render(last), 0));
  }
  const view = currentView(ctx.settings.collectionViews ?? []);
  if (!view) return clearView();
  ensureStyle('wiky-views-style', CSS);
  const main = document.querySelector('main') ?? document.body;
  const els = nativeCards(main);
  const layout = gridOf(els);
  const vctx = viewContext();
  const all = Object.values(ctx.cards);
  const bySiteId = new Map(all.filter((c) => c.siteId).map((c) => [c.siteId!, c]));
  const pairs = els.map((el) => ({ el, card: cardOf(el, ctx, bySiteId) }));
  const ordered = applyView(
    pairs.map((p) => p.card),
    view,
    vctx,
  );
  const rank = new Map(ordered.map((c, i) => [c, i]));
  for (const { el, card } of pairs) {
    const cell = layout?.cell(el) ?? el;
    const i = rank.get(card);
    if (i == null) {
      if (!cell.hasAttribute(HIDE)) cell.setAttribute(HIDE, '');
      continue;
    }
    if (cell.hasAttribute(HIDE)) cell.removeAttribute(HIDE);
    if (cell.style.order !== String(i)) cell.style.order = String(i);
    if (!cell.hasAttribute(ORDER)) cell.setAttribute(ORDER, '');
  }
  const total = applyView(all, view, vctx).length;
  if (layout) renderBar(layout.grid, view, ordered.length, Math.max(total, ordered.length), els.length);

  // Prix pas encore lus : demandés une fois (filtre ou tri par prix, valeur, taux de vente, ventes), puis on réapplique.
  const f = view.filter;
  const needsPrices = f.minPrice != null || f.maxPrice != null || ['price', 'total', 'rate', 'sales'].includes(view.sort);
  if (needsPrices && ctx.apiRead) {
    const ids = pairs.map((p) => p.card.siteId).filter((id): id is string => !!id && !knownPrice(id));
    const ask = `${view.id}|${ids.join(',')}`;
    if (ids.length && ask !== pricesAsked) {
      pricesAsked = ask;
      void cardPrices(ids)
        .then(() => last && render(last))
        .catch(() => {});
    }
  }
}

registerFeature({
  keys: [],
  when: (ctx) => (ctx.settings.collectionViews?.length ?? 0) > 0,
  render,
  cleanup: clearView,
});
