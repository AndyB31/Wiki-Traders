/**
 * Onglets du Marché enrichis (toujours actifs avec l'intégration au site) :
 *  - contrat avec la barre latérale : `/marketplace?wtab=browse|sales|bids|history` ou l'événement `wiky-market-tab`
 *    ouvrent l'onglet du site correspondant (un seul clic), et `<html data-wiky-market-tab>` reflète l'onglet actif ;
 *  - « Mes ventes » : slots libres et fenêtre « Vendre » (market-slots.ts) ;
 *  - « Mes enchères » : panneau de mes mises ; « Historique » : mes ventes avec statistiques (market-panels.ts).
 *
 * Relectures demandées à index.ts par événements `window` (le content script ne peut pas s'envoyer de message) :
 * `wiky-refresh-bids`, `wiky-refresh-sales-history` (ouverture des onglets) et `wiky-refresh-sales` (après une vente).
 */
import { realClick } from '../actions';
import { marketData } from './market-data';
import { removeBidsPanel, removeHistoryPanel, renderBidsPanel, renderHistoryPanel, requestBidsRefresh, requestSalesRefresh, unhideSiteContent } from './market-panels';
import { clearSlots, closeSellModal, renderSlots, setSlotsData } from './market-slots';
import { activeMarketTab, asRequestedTab, isMarketplacePath, marketTabBar, tabButton, withoutWtab, type MarketTab, type RequestedTab } from './market-tabs-logic';
import { registerFeature, type FeatureContext } from './runtime';

let lastCtx: FeatureContext | null = null;
let lastTab: MarketTab | null = null;
let listening = false;
/** Première fois que `wtab` a été vu sans barre d'onglets (la page charge encore). */
let wtabWaitSince = 0;

function tabBar(): HTMLElement | null {
  return marketTabBar(document.querySelector('main') ?? document);
}

/** Clique l'onglet du site demandé s'il n'est pas déjà actif ; vrai si la barre d'onglets est là. */
export function switchMarketTab(want: RequestedTab, bar = tabBar()): boolean {
  if (!bar) return false;
  if (activeMarketTab(bar) !== want) {
    const btn = tabButton(bar, want);
    if (btn) {
      unhideSiteContent();
      realClick(btn);
      later();
    }
  }
  return true;
}

/** `?wtab=` : un seul clic, puis le paramètre est retiré de l'adresse (les autres paramètres restent). */
function handleWtab(bar: HTMLElement | null): void {
  const params = new URLSearchParams(location.search);
  if (!params.has('wtab')) {
    wtabWaitSince = 0;
    return;
  }
  const want = asRequestedTab(params.get('wtab'));
  if (want && !bar) {
    // La barre d'onglets n'est pas encore affichée : on réessaie à la prochaine relecture (10 s au plus).
    wtabWaitSince ||= Date.now();
    if (Date.now() - wtabWaitSince < 10_000) return;
  }
  if (want && bar) switchMarketTab(want, bar);
  wtabWaitSince = 0;
  history.replaceState(history.state, '', withoutWtab(location.href));
}

function setTabAttr(tab: MarketTab | '' | null): void {
  const html = document.documentElement;
  if (tab == null) {
    if ('wikyMarketTab' in html.dataset) delete html.dataset.wikyMarketTab;
  } else if (html.dataset.wikyMarketTab !== tab) html.dataset.wikyMarketTab = tab;
}

let laterTimer: ReturnType<typeof setTimeout> | undefined;
/** Relecture rapprochée après un changement d'onglet (le site redessine son contenu). */
function later(delay = 120): void {
  clearTimeout(laterTimer);
  laterTimer = setTimeout(rerender, delay);
}

function rerender(): void {
  if (lastCtx) draw({ ...lastCtx, path: location.pathname, search: new URLSearchParams(location.search) });
}

function listen(): void {
  if (listening) return;
  listening = true;
  window.addEventListener('wiky-market-tab', (e) => {
    const want = asRequestedTab((e as CustomEvent<string>).detail);
    if (want && isMarketplacePath(location.pathname)) switchMarketTab(want);
  });
  // Clic sur un onglet du site : la grille masquée par l'historique réapparaît tout de suite.
  document.addEventListener(
    'click',
    (e) => {
      const t = e.target instanceof Element ? e.target : null;
      const btn = t?.closest('button');
      if (!btn || btn.closest('[data-wiky]') || !isMarketplacePath(location.pathname)) return;
      if (btn.parentElement && btn.parentElement === tabBar()) {
        unhideSiteContent();
        later(60);
        later(400);
      }
    },
    true,
  );
}

function teardown(): void {
  setTabAttr(null);
  lastTab = null;
  clearSlots();
  removeBidsPanel();
  removeHistoryPanel();
  closeSellModal();
}

function draw(ctx: FeatureContext): void {
  lastCtx = ctx;
  if (!isMarketplacePath(ctx.path)) {
    if (lastTab != null || document.documentElement.dataset.wikyMarketTab != null) teardown();
    return;
  }
  listen();
  const bar = tabBar();
  handleWtab(bar);
  const tab = activeMarketTab(bar);
  setTabAttr(tab ?? '');
  const d = marketData(rerender);
  setSlotsData(d);
  if (tab !== lastTab) {
    lastTab = tab;
    if (tab === 'bids') requestBidsRefresh(d);
    if (tab === 'history') requestSalesRefresh(ctx, d);
  }
  if (bar && d && tab === 'sales') renderSlots(ctx, bar, d);
  else clearSlots();
  if (bar && d && tab === 'bids') renderBidsPanel(ctx, bar, d);
  else removeBidsPanel();
  if (bar && d && tab === 'history') renderHistoryPanel(ctx, bar, d);
  else removeHistoryPanel();
}

registerFeature({
  keys: [],
  when: (ctx) => ctx.settings.siteIntegration,
  render: draw,
  cleanup() {
    lastCtx = null;
    teardown();
  },
});

/** Pour les tests. */
export function resetMarketTabsForTest(): void {
  lastCtx = null;
  lastTab = null;
  wtabWaitSince = 0;
}
