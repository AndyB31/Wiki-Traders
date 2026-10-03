import type { PageKind, Settings } from '../../lib/types';
import { qsa, re, type SelectorConfig } from './selectors';

export function rootOf(doc: Document, cfg: SelectorConfig): Element {
  return qsa(doc, cfg.root)[0] ?? doc.body;
}

const TAB_ITEMS = ':scope > button, :scope > a, :scope > [role="tab"]';

/** Barres d'onglets : conteneurs d'au moins 3 boutons frères. */
function tabBars(root: ParentNode, cfg: SelectorConfig): Element[] {
  if (cfg.tabBar) return qsa(root, cfg.tabBar);
  const bars = qsa(root, '[role="tablist"], div, nav').filter((el) => qsa(el, TAB_ITEMS).length >= 3);
  // Priorité à la barre qui contient l'onglet « Mes ventes ».
  const tab = re(cfg.myAuctionsTabRe);
  const withMine = bars.filter((b) => qsa(b, TAB_ITEMS).some((t) => tab.test(t.textContent ?? '')));
  return withMine.length ? withMine : bars;
}

/**
 * Libellé de l'onglet actif. Les onglets de WikiMasters n'ont pas d'attribut ARIA :
 * l'onglet actif est celui dont les classes diffèrent de tous les autres.
 */
export function activeTabLabel(root: ParentNode, cfg: SelectorConfig): string | null {
  for (const bar of tabBars(root, cfg)) {
    const tabs = qsa<HTMLElement>(bar, TAB_ITEMS);
    const marked = tabs.find((t) => t.matches(cfg.activeMarker));
    if (marked) return marked.textContent?.trim() ?? null;
    const classes = tabs.map((t) => t.getAttribute('class') ?? '');
    const counts = new Map<string, number>();
    for (const c of classes) counts.set(c, (counts.get(c) ?? 0) + 1);
    const unique = tabs.filter((_, i) => counts.get(classes[i]) === 1);
    if (unique.length === 1 && counts.size === 2) return unique[0].textContent?.trim() ?? null;
  }
  return null;
}

/** « Mes ventes (2/5) » → { active: 2, slots: 5 }. */
export function slotsFromTabs(root: ParentNode, cfg: SelectorConfig): { active: number; slots: number } | null {
  const tab = re(cfg.myAuctionsTabRe);
  for (const bar of tabBars(root, cfg)) {
    for (const t of qsa(bar, TAB_ITEMS)) {
      const text = t.textContent ?? '';
      const m = text.match(/\((\d+)\s*\/\s*(\d+)\)/);
      if (m && tab.test(text)) return { active: Number(m[1]), slots: Number(m[2]) };
    }
  }
  return null;
}

/** Vrai si l'onglet ou l'URL indiquent la liste de mes propres ventes. */
export function isMyAuctionsPage(doc: Document, loc: Pick<Location, 'pathname' | 'search'>, cfg: SelectorConfig, settings: Pick<Settings, 'myAuctionsPath'>): boolean {
  const url = loc.pathname + loc.search;
  // L'onglet actif fait foi : sur WikiMasters tous les onglets du marché ont la même adresse.
  const active = activeTabLabel(doc, cfg);
  const tab = re(cfg.myAuctionsTabRe);
  if (active != null) return tab.test(active);
  if (qsa(doc, cfg.activeMarker).some((el) => tab.test(el.textContent?.trim() ?? ''))) return true;
  if (settings.myAuctionsPath) return url === settings.myAuctionsPath;
  return re(cfg.myAuctionsUrlRe).test(url);
}

export function detectPage(doc: Document, loc: Pick<Location, 'pathname' | 'search'>, cfg: SelectorConfig, settings: Pick<Settings, 'myAuctionsPath'>): PageKind {
  const path = loc.pathname;
  if (re(cfg.collectionPathRe).test(path)) return 'collection';
  if (re(cfg.auctionDetailPathRe).test(path) && !re(cfg.myAuctionsUrlRe).test(path)) return 'auctionDetail';
  if (re(cfg.marketPathRe).test(path) || (settings.myAuctionsPath && path === settings.myAuctionsPath.split('?')[0])) {
    return isMyAuctionsPage(doc, loc, cfg, settings) ? 'myAuctions' : 'market';
  }
  return 'other';
}
