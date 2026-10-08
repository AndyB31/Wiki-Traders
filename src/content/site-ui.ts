/**
 * Wiki-Traders intégré au site, à la manière de « Familles » (violet) de l'extension « Prix moyen collection », en orange :
 *  - barre latérale plus compacte, liens regroupés en menus (Social, Progression) ;
 *  - résumé toujours visible (synchro, slots libres, mises en cours gagnées / perdues) et menu Wiki-Traders ;
 *  - fonctionnalités en fenêtre par-dessus la page (vendre, mises…) ou en page (cartes, ventes conclues) ;
 *  - onglet « Wiki-Traders » dans Paramètres (/settings?wiky=settings).
 * Les liens du site ne sont jamais déplacés (React les gère) : ils sont masqués et reproduits dans nos menus,
 * un clic sur la copie déclenche le lien d'origine (navigation du site, sans rechargement).
 */
import { allocate, type AllocationInput } from '../lib/allocation';
import { ext } from '../lib/browser';
import { STALE_AFTER_MS } from '../lib/defaults';
import { featureFlags, type FeatureKey } from '../lib/features';
import { formatDuration, formatPrice } from '../lib/text';
import { bindTips, hideTip } from './features/dom';
import type { Meta, MyBidsResult } from '../lib/types';

export type SiteUiStore = AllocationInput & { bidsCache: MyBidsResult | null; meta: Meta };

export interface SiteUiActions {
  /** Relit mes ventes et mes mises (bouton ↻ du résumé). */
  refresh: () => void;
}

type View = 'sell' | 'running' | 'bids' | 'sold' | 'cards' | 'families' | 'tags' | 'tools';

const ICONS: Record<string, string> = {
  coins: '<circle cx="8" cy="8" r="6"/><path d="M18.09 10.37A6 6 0 1 1 10.34 18"/><path d="M7 6h1v4"/><path d="m16.71 13.88.7.71-2.82 2.82"/>',
  tag: '<path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z"/><circle cx="7.5" cy="7.5" r=".5" fill="currentColor"/>',
  hourglass: '<path d="M5 22h14"/><path d="M5 2h14"/><path d="M17 22v-4.172a2 2 0 0 0-.586-1.414L12 12l-4.414 4.414A2 2 0 0 0 7 17.828V22"/><path d="M7 2v4.172a2 2 0 0 0 .586 1.414L12 12l4.414-4.414A2 2 0 0 0 17 6.172V2"/>',
  bid: '<circle cx="12" cy="12" r="10"/><path d="M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8"/><path d="M12 18V6"/>',
  layers: '<path d="m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z"/><path d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65"/><path d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65"/>',
  receipt: '<path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z"/><path d="M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8"/><path d="M12 17.5v-11"/>',
  tags: '<path d="m15 5 6.3 6.3a2.4 2.4 0 0 1 0 3.4L17 19"/><path d="M9.586 5.586A2 2 0 0 0 8.172 5H3a1 1 0 0 0-1 1v5.172a2 2 0 0 0 .586 1.414L8.29 18.29a2.426 2.426 0 0 0 3.42 0l3.58-3.58a2.426 2.426 0 0 0 0-3.42z"/><circle cx="6.5" cy="9.5" r=".5" fill="currentColor"/>',
  wrench: '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.106-3.105c.32-.322.863-.22.983.218a6 6 0 0 1-8.259 7.057l-7.91 7.91a1 1 0 0 1-2.999-3l7.91-7.91a6 6 0 0 1 7.057-8.259c.438.12.54.662.219.984z"/>',
  sliders: '<line x1="21" x2="14" y1="4" y2="4"/><line x1="10" x2="3" y1="4" y2="4"/><line x1="21" x2="12" y1="12" y2="12"/><line x1="8" x2="3" y1="12" y2="12"/><line x1="21" x2="16" y1="20" y2="20"/><line x1="12" x2="3" y1="20" y2="20"/><line x1="14" x2="14" y1="2" y2="6"/><line x1="8" x2="8" y1="10" y2="14"/><line x1="16" x2="16" y1="18" y2="22"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><path d="M16 3.128a4 4 0 0 1 0 7.744"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><circle cx="9" cy="7" r="4"/>',
  trending: '<polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/>',
  chevron: '<path d="m9 18 6-6-6-6"/>',
  refresh: '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  history: '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/>',
  gavel: '<path d="m14 13-8.381 8.38a1 1 0 0 1-3.001-3l8.384-8.381"/><path d="m16 16 6-6"/><path d="m21.5 10.5-8-8"/><path d="m8 8 6-6"/><path d="m8.5 7.5 8 8"/>',
  folder: '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
};

function icon(name: string, size = 20): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;
}

/**
 * Fonctionnalités de la popup : en fenêtre par-dessus la page, ou en page quand la liste est longue.
 * `native` : page dessinée directement dans le DOM du site par un module (features/), pas d'iframe ;
 * `feature` : masquée si cette fonctionnalité est désactivée.
 */
const ITEMS: { view: View; label: string; title: string; icon: string; page?: string; wide?: boolean; native?: boolean; feature?: FeatureKey }[] = [
  { view: 'sell', label: 'Vendre', title: 'Slots à remplir', icon: 'tag' },
  { view: 'running', label: 'Mes ventes', title: 'Mes ventes en cours', icon: 'hourglass' },
  { view: 'bids', label: 'Mes mises', title: 'Mes mises', icon: 'bid' },
  { view: 'cards', label: 'Cartes & prix', title: 'Cartes & prix', icon: 'layers', page: '/collection' },
  { view: 'families', label: 'Familles', title: 'Familles', icon: 'folder', page: '/collection', native: true, feature: 'families' },
  { view: 'sold', label: 'Ventes conclues', title: 'Ventes conclues', icon: 'receipt', page: '/marketplace' },
  { view: 'tags', label: 'Étiquettes', title: 'Étiquetage', icon: 'tags' },
  { view: 'tools', label: 'Outils', title: 'Outils', icon: 'wrench' },
];

/**
 * Arborescence de la barre latérale (barre compacte) : « Paquets » reste en haut, le reste est rangé en menus ;
 * le récapitulatif Wiki-Traders puis « Paramètres » ferment la barre. Les pages de l'extension sont rangées avec
 * celles du site, reconnaissables à leur icône orange.
 *  - `site` : lien du site (masqué, reproduit dans le menu ; `label` remplace son libellé) ;
 *  - `wiky` : fonctionnalité Wiki-Traders (fenêtre ou page) ;
 *  - `link` : page Wiki-Traders sans vue de popup (réglages).
 */
/** Onglets de la page Marché du site (sans adresse propre : on clique sur l'onglet, voir features/market-tabs.ts). */
export type MarketTab = 'browse' | 'sales' | 'bids' | 'history';
type TreeEntry =
  | { site: string; label?: string }
  | { wiky: View }
  | { link: string; label: string; icon: string; route: 'settings' }
  /** Onglet du Marché du site (icône neutre : c'est une page du site, enrichie par l'extension). */
  | { tab: MarketTab; label: string; icon: string }
  /** Lien du site masqué sans être reproduit (remplacé par les onglets ci-dessus). */
  | { hide: string };
interface TreeGroup {
  id: string;
  label: string;
  /** Icône reprise du lien du site `iconFrom`, sinon icône Wiki-Traders. */
  icon: string;
  iconFrom?: string;
  /** Page ouverte par un clic sur le titre du menu (lien du site). */
  href?: string;
  entries: TreeEntry[];
}

const TREE: TreeGroup[] = [
  {
    id: 'collection',
    label: 'Collection',
    icon: 'layers',
    iconFrom: '/collection',
    href: '/collection',
    entries: [{ site: '/collection', label: 'Ma collection' }, { site: '/global-collection' }, { site: '/global-collection?wm=themes' }, { wiky: 'families' }, { wiky: 'cards' }],
  },
  {
    id: 'market',
    label: 'Marché',
    icon: 'bid',
    iconFrom: '/marketplace',
    href: '/marketplace',
    entries: [
      { hide: '/marketplace' },
      { hide: '/marketplace?wm=bids' },
      { tab: 'browse', label: 'Parcourir', icon: 'search' },
      { tab: 'sales', label: 'Mes ventes', icon: 'tag' },
      { tab: 'bids', label: 'Mes enchères', icon: 'gavel' },
      { tab: 'history', label: 'Historique', icon: 'history' },
    ],
  },
  { id: 'social', label: 'Social', icon: 'users', entries: [{ site: '/trades' }, { site: '/guild' }, { site: '/friends' }, { site: '/dms' }, { site: '/battle' }] },
  { id: 'progress', label: 'Progression', icon: 'trending', entries: [{ site: '/profile' }, { site: '/achievements' }, { site: '/leaderboard' }] },
];

/** Dernier menu, tout en bas, sous le récapitulatif. */
const SETTINGS_GROUP: TreeGroup = {
  id: 'settings',
  label: 'Paramètres',
  icon: 'sliders',
  iconFrom: '/settings',
  href: '/settings',
  entries: [{ site: '/settings', label: 'Paramètres du site' }, { link: '/settings?wiky=settings', label: 'Réglages Wiki-Traders', icon: 'sliders', route: 'settings' }, { wiky: 'tools' }],
};

/** Liens du site laissés en haut, hors menus. */
const TOP_LEVEL = ['/pulls'];

/** Classes d'un lien inactif de la barre latérale du site (pour que nos en-têtes de menu lui ressemblent). */
const NAV_ITEM_CLASS =
  'flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all duration-200 text-[var(--color-foreground)]/60 hover:text-[var(--color-foreground)] hover:bg-[var(--color-surface-light)]';
const NAV_ICON_CLASS = 'flex shrink-0 items-center justify-center text-[var(--color-foreground)]';

const CSS = `
nav[data-wiky-nav="compact"] { padding: 16px 12px !important; gap: 2px !important; }
nav[data-wiky-nav="compact"] > div:first-child { margin-bottom: 12px !important; }
nav[data-wiky-nav="compact"] > a, nav[data-wiky-nav="compact"] .wiky-group-head { padding-top: 7px !important; padding-bottom: 7px !important; }
nav[data-wiky-nav="compact"] > a svg, nav[data-wiky-nav="compact"] .wiky-group-head > span:first-child svg { width: 20px !important; height: 20px !important; }
nav[data-wiky-nav] > a[data-wiky-grouped] { display: none !important; }
.wiky-group-head { width: 100%; border: 0; background: none; cursor: pointer; text-align: left; font: inherit; }
.wiky-group-head.is-active { color: var(--color-accent) !important; }
nav[data-wiky-nav] .wiky-group-head.split { padding: 0 !important; gap: 0 !important; }
.wiky-group-head.split > .wiky-head-main { all: unset; flex: 1; display: flex; align-items: center; gap: 12px; padding: 7px 0 7px 16px; cursor: pointer; border-radius: 12px 0 0 12px; }
.wiky-group-head.split > .wiky-head-toggle { all: unset; display: inline-grid; place-items: center; width: 34px; align-self: stretch; cursor: pointer; border-radius: 0 12px 12px 0; }
.wiky-group-head.split > .wiky-head-toggle .wiky-chev { margin: 0; }
.wiky-group-head > .wiky-head-main svg, .wiky-group-head > span:first-child svg { width: 20px !important; height: 20px !important; }
.wiky-group-items > .wiky-sub { display: flex; align-items: center; gap: 10px; padding: 6px 10px; border-radius: 10px; font-size: 13px; font-weight: 500; text-decoration: none; cursor: pointer;
  border: 0; background: none; font-family: inherit; text-align: left; width: 100%; box-sizing: border-box; color: color-mix(in srgb, var(--color-foreground) 60%, transparent); transition: all .2s ease; }
.wiky-group-items > .wiky-sub:hover { color: var(--color-foreground); background: var(--color-surface-light); }
.wiky-group-items > .wiky-sub.is-active { color: var(--color-accent); background: color-mix(in srgb, var(--color-accent) 10%, transparent); }
.wiky-group-items > .wiky-sub .wiky-ico { display: inline-flex; color: #fb923c; }
.wiky-group-items > .wiky-sub.site-tab .wiky-ico { color: var(--color-foreground); }
.wiky-group-items > .wiky-sub .wiky-count { margin-left: auto; min-width: 18px; padding: 0 6px; border-radius: 999px; background: #f97316; color: #fff; font-size: 10.5px; font-weight: 700; text-align: center; line-height: 18px; }
.wiky-group-items > .wm-family-nav { border-color: transparent !important; background: none !important; }
nav[data-wiky-nav] > [data-wiky="nav-recap"] { margin: auto 0 4px; padding-top: 10px; }
.wiky-chev { margin-left: auto; display: inline-flex; opacity: .45; transition: transform .2s ease; }
[data-open="true"] > .wiky-group-head .wiky-chev, [data-open="true"] .wiky-status-toggle .wiky-chev { transform: rotate(90deg); }
.wiky-group-items { display: none; flex-direction: column; gap: 1px; margin: 2px 0 4px 22px; padding-left: 8px; border-left: 1px solid var(--color-border); }
[data-open="true"] > .wiky-group-items { display: flex; }
.wiky-group-items > a { padding: 6px 10px !important; font-size: 13px !important; gap: 10px !important; }
.wiky-group-items > a svg { width: 18px !important; height: 18px !important; }
.wiky-group-items > a > div.ml-auto { display: none; }

.wiky-section { display: flex; flex-direction: column; margin: 8px 0 4px; }
.wiky-status { display: block; width: 100%; box-sizing: border-box; text-align: left; cursor: pointer; padding: 10px 12px; border-radius: 12px; font: inherit;
  border: 1px solid rgba(249,115,22,.28); background: linear-gradient(180deg, rgba(249,115,22,.11), rgba(249,115,22,.04)); color: var(--color-foreground); transition: border-color .2s ease; }
.wiky-status:hover { border-color: rgba(251,146,60,.55); }
.wiky-status-head { display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 700; color: #fdba74; }
.wiky-status-head .wiky-ico { color: #fb923c; display: inline-flex; }
.wiky-dot { width: 7px; height: 7px; border-radius: 50%; background: #22c55e; box-shadow: 0 0 0 3px rgba(34,197,94,.15); }
.wiky-dot.stale { background: #f59e0b; box-shadow: 0 0 0 3px rgba(245,158,11,.15); }
.wiky-dot.none { background: color-mix(in srgb, var(--color-foreground) 30%, transparent); box-shadow: none; }
.wiky-status-toggle { margin-left: auto; display: inline-grid; place-items: center; width: 22px; height: 22px; border-radius: 6px; color: color-mix(in srgb, var(--color-foreground) 55%, transparent); }
.wiky-status-toggle:hover { background: rgba(249,115,22,.16); color: #fff; }
.wiky-row { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; margin-top: 7px; font-size: 11.5px; color: color-mix(in srgb, var(--color-foreground) 58%, transparent); }
.wiky-row b { color: var(--color-foreground); font-weight: 600; font-variant-numeric: tabular-nums; }
.wiky-slots { display: flex; gap: 3px; margin-top: 5px; }
.wiky-seg { flex: 1; min-width: 0; display: flex; flex-direction: column; align-items: center; gap: 2px; }
.wiky-seg[data-tip] { cursor: help; }
.wiky-slots i { display: block; width: 100%; height: 4px; border-radius: 2px; background: color-mix(in srgb, var(--color-foreground) 14%, transparent); }
.wiky-slots i.on { background: #f97316; }
.wiky-slots i.on.bid { background: #22c55e; }
.wiky-seg small { max-width: 100%; overflow: hidden; text-overflow: clip; white-space: nowrap; font-size: 9px; line-height: 1; font-weight: 600; font-variant-numeric: tabular-nums;
  letter-spacing: -.02em; color: color-mix(in srgb, var(--color-foreground) 60%, transparent); }
.wiky-seg small:empty { display: none; }
.wiky-win { color: #4ade80 !important; }
.wiky-lose { color: #f87171 !important; }
.wiky-update { display: block; margin-top: 8px; padding: 5px 8px; border-radius: 8px; font-size: 11.5px; font-weight: 600; text-decoration: none;
  color: #fff; background: rgba(249,115,22,.85); }
.wiky-update:hover { background: #f97316; }
.wiky-sync { display: flex; align-items: center; gap: 6px; margin-top: 8px; font-size: 10.5px; color: color-mix(in srgb, var(--color-foreground) 42%, transparent); }
.wiky-sync .wiky-refresh { margin-left: auto; display: inline-grid; place-items: center; width: 20px; height: 20px; border-radius: 6px; }
.wiky-sync .wiky-refresh:hover { background: rgba(249,115,22,.16); color: #fff; }
.wiky-sync .wiky-refresh.spin svg { animation: wiky-spin 1s linear infinite; }
.wiky-items { display: none; flex-direction: column; gap: 1px; margin-top: 4px; }
.wiky-section[data-open="true"] .wiky-items { display: flex; }
.wiky-nav { display: flex; align-items: center; gap: 10px; padding: 6px 12px; border-radius: 10px; font-size: 13px; font-weight: 500; text-decoration: none; cursor: pointer;
  border: 1px solid transparent; background: none; color: color-mix(in srgb, var(--color-foreground) 62%, transparent); transition: all .2s ease; font-family: inherit; width: 100%; text-align: left; }
.wiky-nav .wiky-ico { display: inline-flex; color: #fb923c; }
.wiky-nav:hover, .wiky-nav.is-active { border-color: rgba(249,115,22,.3); background: rgba(249,115,22,.1); color: #fff; }
.wiky-nav .wiky-count { margin-left: auto; min-width: 18px; padding: 0 6px; border-radius: 999px; background: #f97316; color: #fff; font-size: 10.5px; font-weight: 700; text-align: center; line-height: 18px; }

.wiky-modal-overlay { position: fixed; inset: 0; z-index: 2147483646; display: grid; place-items: center; padding: 18px;
  background: rgba(0,0,0,.66); backdrop-filter: blur(2px); animation: wiky-fade .15s ease; }
.wiky-modal { display: flex; flex-direction: column; width: min(560px, 100%); height: min(82vh, 780px); overflow: hidden; border-radius: 16px;
  border: 1px solid var(--color-border); background: var(--color-surface); color: var(--color-foreground); box-shadow: 0 24px 72px rgba(0,0,0,.45); animation: wiky-up .18s ease; }
.wiky-modal.wide { width: min(820px, 100%); }
.wiky-modal-head { display: flex; align-items: center; gap: 10px; padding: 14px 14px 12px 18px; border-bottom: 1px solid var(--color-border); }
.wiky-modal-head .wiky-ico { display: inline-grid; place-items: center; width: 30px; height: 30px; border-radius: 9px; background: rgba(249,115,22,.14); color: #fb923c; }
.wiky-modal-head h2 { margin: 0; font-size: 17px; font-weight: 700; font-family: var(--font-heading, inherit); }
.wiky-modal-head small { display: block; font-size: 11px; font-weight: 600; letter-spacing: .04em; text-transform: uppercase; color: #fb923c; }
.wiky-modal-close { margin-left: auto; display: inline-grid; place-items: center; width: 32px; height: 32px; border: 0; border-radius: 10px; cursor: pointer;
  background: none; color: color-mix(in srgb, var(--color-foreground) 60%, transparent); }
.wiky-modal-close:focus { outline: none; }
.wiky-modal-close:focus-visible, .wiky-status:focus-visible, .wiky-nav:focus-visible { outline: 2px solid rgba(251,146,60,.7); outline-offset: 2px; }
.wiky-modal-close:hover { background: var(--color-surface-light); color: var(--color-foreground); }
.wiky-modal iframe, #wiky-page iframe { flex: 1; width: 100%; border: 0; background: var(--color-surface); color-scheme: dark; }

html[data-wiky-route] main > :not(#wiky-page) { display: none !important; }
#wiky-page { display: flex; flex-direction: column; gap: 16px; padding: 16px; }
@media (min-width: 768px) { #wiky-page { padding: 24px; } }
#wiky-page .wiky-page-head { display: flex; align-items: center; gap: 12px; }
#wiky-page .wiky-page-head .wiky-ico { display: inline-grid; place-items: center; width: 36px; height: 36px; border-radius: 10px; background: rgba(249,115,22,.14); color: #fb923c; }
#wiky-page .wiky-frame { display: flex; height: calc(100dvh - 11rem); min-height: 480px; overflow: hidden; border-radius: 16px; border: 1px solid var(--color-border); background: var(--color-surface); }
.wiky-tabs { display: flex; gap: 6px; flex-wrap: wrap; }
.wiky-tab { padding: 7px 14px; border-radius: 999px; font-size: 13px; font-weight: 600; text-decoration: none; cursor: pointer; border: 1px solid var(--color-border);
  color: color-mix(in srgb, var(--color-foreground) 65%, transparent); background: var(--color-surface); }
.wiky-tab:hover { color: var(--color-foreground); background: var(--color-surface-light); }
.wiky-tab.is-active { border-color: rgba(249,115,22,.45); background: rgba(249,115,22,.12); color: #fdba74; }
@keyframes wiky-fade { from { opacity: 0; } }
@keyframes wiky-up { from { opacity: 0; transform: translateY(8px); } }
@keyframes wiky-spin { to { transform: rotate(360deg); } }
`;

function ensureStyle(): void {
  if (document.getElementById('wiky-site-style')) return;
  const style = document.createElement('style');
  style.id = 'wiky-site-style';
  style.setAttribute('data-wiky', 'style');
  style.textContent = CSS;
  (document.head ?? document.documentElement).append(style);
}

function el(tag: string, attrs: Record<string, string> = {}, html = ''): HTMLElement {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (html) node.innerHTML = html;
  return node;
}

const isOpen = (id: string, fallback: boolean) => {
  try {
    const v = localStorage.getItem(`wiky-open-${id}`);
    return v == null ? fallback : v === '1';
  } catch {
    return fallback;
  }
};
const setOpen = (id: string, open: boolean) => {
  try {
    localStorage.setItem(`wiky-open-${id}`, open ? '1' : '0');
  } catch {
    // Stockage indisponible : l'état n'est simplement pas mémorisé.
  }
};

/** Barre latérale du site (bureau) ; la barre du bas sur mobile n'est pas modifiée. */
export function siteNav(): HTMLElement | null {
  return [...document.querySelectorAll<HTMLElement>('nav')].find((n) => n.querySelector('a[href="/collection"]') && !/\bmd:hidden\b/.test(n.className)) ?? null;
}

/** Couleurs du site, transmises aux pages de l'extension affichées dans le site. */
function themeParam(): string {
  const css = getComputedStyle(document.documentElement);
  const v = (name: string) => css.getPropertyValue(name).trim() || undefined;
  return encodeURIComponent(
    JSON.stringify({
      background: v('--color-background'),
      surface: v('--color-surface'),
      surfaceLight: v('--color-surface-light'),
      border: v('--color-border'),
      foreground: v('--color-foreground'),
    }),
  );
}

function frameUrl(page: 'popup' | 'options', view?: View): string {
  return ext.runtime.getURL(`${page}.html?embed=1${view ? `&view=${view}` : ''}&theme=${themeParam()}`);
}

// ---------------------------------------------------------------- menus regroupés

/** Lien du site actif (classes de l'élément actif du site, ou aria-current). */
function isActiveLink(a: Element): boolean {
  return /color-accent\)\]\/10/.test(a.className) || a.getAttribute('aria-current') === 'page' || a.classList.contains('is-active');
}

/** Liens de premier niveau de la barre du site, par adresse. */
function siteLinks(nav: HTMLElement): Map<string, HTMLAnchorElement> {
  const map = new Map<string, HTMLAnchorElement>();
  for (const a of nav.querySelectorAll<HTMLAnchorElement>(':scope > a[href]')) map.set(a.getAttribute('href') ?? '', a);
  return map;
}

/** Retire l'arborescence et rend la barre du site intacte. */
function clearTree(nav: HTMLElement): void {
  nav.removeAttribute('data-wiky-nav');
  for (const a of nav.querySelectorAll('[data-wiky-grouped]')) a.removeAttribute('data-wiky-grouped');
  for (const g of nav.querySelectorAll('[data-wiky="nav-group"], [data-wiky="nav-recap"]')) g.remove();
}

/** Copie d'un lien du site pour un menu : même apparence, navigation par le lien d'origine (sans rechargement). */
function copyOfSiteLink(a: HTMLAnchorElement, label: string | undefined, inactive: boolean): HTMLAnchorElement {
  const copy = a.cloneNode(true) as HTMLAnchorElement;
  copy.removeAttribute('data-wiky-grouped');
  copy.removeAttribute('id');
  // Sur une page Wiki-Traders (ex. /collection?wiky=families), le lien du site ne doit pas paraître actif.
  if (inactive && isActiveLink(copy)) {
    copy.className = copy.classList.contains('wm-family-nav') ? copy.className.replace(/\bis-active\b/, '') : NAV_ITEM_CLASS;
    copy.removeAttribute('aria-current');
    copy.querySelector(':scope > div.ml-auto')?.remove();
  }
  if (label) {
    const text = [...copy.childNodes].find((n) => n.nodeType === Node.TEXT_NODE && n.textContent?.trim()) ?? [...copy.querySelectorAll('span')].reverse().find((n) => n.textContent?.trim());
    if (text) text.textContent = label;
  }
  copy.addEventListener('click', (e) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    a.click();
  });
  return copy;
}

/** Élément Wiki-Traders d'un menu (icône orange) : fenêtre par-dessus la page, ou page du site. */
function wikySub(item: (typeof ITEMS)[number], route: View | 'settings' | null, count: number): HTMLElement {
  const inner = `<span class="wiky-ico">${icon(item.icon, 18)}</span><span>${item.label}</span>${count ? `<span class="wiky-count">${count}</span>` : ''}`;
  if (item.page) return el('a', { class: `wiky-sub${route === item.view ? ' is-active' : ''}`, href: `${item.page}?wiky=${item.view}`, 'data-wiky-view': item.view }, inner);
  const b = el('button', { type: 'button', class: 'wiky-sub', 'data-wiky-view': item.view }, inner);
  b.addEventListener('click', () => openModal(item.view));
  return b;
}

/** Icône du titre d'un menu : celle du lien du site correspondant (même rendu), sinon la nôtre. */
function headIcon(group: TreeGroup, links: Map<string, HTMLAnchorElement>): string {
  const svg = group.iconFrom ? links.get(group.iconFrom)?.querySelector('svg') : null;
  return `<span class="${NAV_ICON_CLASS}">${svg ? svg.outerHTML : icon(group.icon, 24)}</span>`;
}

function buildGroup(
  group: TreeGroup,
  links: Map<string, HTMLAnchorElement>,
  route: View | 'settings' | null,
  counts: Partial<Record<View, number>>,
  integration: boolean,
  flags: ReturnType<typeof featureFlags>,
): HTMLElement | null {
  const items: HTMLElement[] = [];
  let active = false;
  for (const entry of group.entries) {
    if ('hide' in entry) {
      const a = links.get(entry.hide);
      if (a && a.getAttribute('data-wiky-grouped') !== group.id) a.setAttribute('data-wiky-grouped', group.id);
      if (a && !route && isActiveLink(a)) active = true;
      continue;
    }
    if ('tab' in entry) {
      const on = !route && location.pathname === '/marketplace' && (document.documentElement.dataset.wikyMarketTab || 'browse') === entry.tab;
      active ||= on;
      const count = entry.tab === 'sales' ? counts.sell ?? 0 : entry.tab === 'bids' ? counts.bids ?? 0 : 0;
      const a = el(
        'a',
        { class: `wiky-sub site-tab${on ? ' is-active' : ''}`, href: `/marketplace?wtab=${entry.tab}`, 'data-wiky-tab': entry.tab },
        `<span class="wiky-ico">${icon(entry.icon, 18)}</span><span>${entry.label}</span>${count ? `<span class="wiky-count">${count}</span>` : ''}`,
      );
      // Déjà sur le Marché : on change d'onglet sur place (sans recharger).
      a.addEventListener('click', (e) => {
        if (location.pathname !== '/marketplace' || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        window.dispatchEvent(new CustomEvent('wiky-market-tab', { detail: entry.tab }));
      });
      items.push(a);
      continue;
    }
    if ('site' in entry) {
      const a = links.get(entry.site);
      if (!a) continue;
      if (a.getAttribute('data-wiky-grouped') !== group.id) a.setAttribute('data-wiky-grouped', group.id);
      const on = !route && isActiveLink(a);
      active ||= on;
      items.push(copyOfSiteLink(a, entry.label, !!route));
    } else if (!integration) {
      continue;
    } else if ('wiky' in entry) {
      const item = ITEMS.find((i) => i.view === entry.wiky);
      if (!item || (item.feature && !flags[item.feature])) continue;
      active ||= route === item.view;
      items.push(wikySub(item, route, counts[item.view] ?? 0));
    } else {
      const on = route === entry.route;
      active ||= on;
      items.push(el('a', { class: `wiky-sub${on ? ' is-active' : ''}`, href: entry.link }, `<span class="wiky-ico">${icon(entry.icon, 18)}</span><span>${entry.label}</span>`));
    }
  }
  if (!items.length) return null;
  const box = el('div', { 'data-wiky': 'nav-group', 'data-group': group.id });
  box.dataset.open = String(active || isOpen(group.id, false));
  const toggle = () => {
    const open = box.dataset.open !== 'true';
    box.dataset.open = String(open);
    box.querySelector('[aria-expanded]')?.setAttribute('aria-expanded', String(open));
    setOpen(group.id, open);
  };
  const chev = `<span class="wiky-chev">${icon('chevron', 16)}</span>`;
  const target = group.href ? links.get(group.href) : undefined;
  let head: HTMLElement;
  if (target) {
    // Titre = lien vers la page (et ouvre le menu) ; flèche = ouvrir / fermer seulement.
    head = el('div', { class: `wiky-group-head split ${NAV_ITEM_CLASS}${active ? ' is-active' : ''}` });
    const main = el('button', { type: 'button', class: 'wiky-head-main', title: `Ouvrir ${group.label}` }, `${headIcon(group, links)}${group.label}`);
    main.addEventListener('click', () => {
      if (box.dataset.open !== 'true') toggle();
      target.click();
    });
    const tg = el('button', { type: 'button', class: 'wiky-head-toggle', 'aria-expanded': box.dataset.open, 'aria-label': `Menu ${group.label}` }, chev);
    tg.addEventListener('click', toggle);
    head.append(main, tg);
  } else {
    head = el('button', { type: 'button', class: `wiky-group-head ${NAV_ITEM_CLASS}${active ? ' is-active' : ''}`, 'aria-expanded': box.dataset.open }, `${headIcon(group, links)}${group.label}${chev}`);
    head.addEventListener('click', toggle);
  }
  const list = el('div', { class: 'wiky-group-items' });
  list.append(...items);
  box.append(head, list);
  return box;
}

/**
 * Barre latérale compacte : « Paquets » en haut, puis les menus (liens du site et pages Wiki-Traders mêlés),
 * le récapitulatif Wiki-Traders et « Paramètres » tout en bas. Reconstruite seulement si quelque chose change.
 */
function renderTree(nav: HTMLElement, store: SiteUiStore, actions: SiteUiActions): void {
  const integration = store.settings.siteIntegration;
  if (nav.getAttribute('data-wiky-nav') !== 'compact') nav.setAttribute('data-wiky-nav', 'compact');
  nav.querySelector(':scope > [data-wiky="nav-wiky"]')?.remove();
  const links = siteLinks(nav);
  const route = currentRoute();
  const now = Date.now();
  const summary = integration ? siteSummary(store, now) : null;
  const counts: Partial<Record<View, number>> = summary ? { sell: summary.toSell, running: summary.occupied, bids: summary.leading + summary.outbid } : {};
  const flags = featureFlags(store.settings.features);
  const groups = integration ? [...TREE, SETTINGS_GROUP] : TREE;
  const key = JSON.stringify([
    [...links.entries()].map(([h, a]) => [h, a.className, a.textContent]),
    route,
    counts,
    integration,
    store.settings.features,
    location.pathname,
    document.documentElement.dataset.wikyMarketTab ?? '',
  ]);
  const existing = [...nav.querySelectorAll<HTMLElement>(':scope > [data-wiky="nav-group"]')];
  if (nav.dataset.wikyTree !== key || existing.length === 0) {
    nav.dataset.wikyTree = key;
    // Les menus gardent leur état ouvert / fermé d'une reconstruction à l'autre.
    const openNow = new Map(existing.map((g) => [g.dataset.group!, g.dataset.open === 'true']));
    for (const [id, open] of openNow) setOpen(id, open);
    existing.forEach((g) => g.remove());
    if (!integration) links.get('/settings')?.removeAttribute('data-wiky-grouped');
    const built = groups.map((g) => [g, buildGroup(g, links, route, counts, integration, flags)] as const);
    // Ordre : après les liens laissés en haut (Paquets), puis récapitulatif et Paramètres en dernier.
    let anchor: Element | null = TOP_LEVEL.map((h) => links.get(h)).filter(Boolean).pop() ?? nav.firstElementChild;
    for (const [g, box] of built) {
      if (!box) continue;
      if (g === SETTINGS_GROUP) nav.append(box);
      else {
        anchor ? anchor.after(box) : nav.prepend(box);
        anchor = box;
      }
    }
  }
  // Récapitulatif juste au-dessus de « Paramètres » (le dernier menu).
  let recap = nav.querySelector<HTMLElement>(':scope > [data-wiky="nav-recap"]');
  if (!integration || !summary) {
    recap?.remove();
    return;
  }
  if (!recap) recap = el('div', { 'data-wiky': 'nav-recap' });
  const settingsBox = nav.querySelector(':scope > [data-wiky="nav-group"][data-group="settings"]');
  // (« Mises en direct » peut se glisser entre le récapitulatif et Paramètres : seul l'ordre compte.)
  const misplaced = settingsBox ? recap.parentElement !== nav || !(recap.compareDocumentPosition(settingsBox) & Node.DOCUMENT_POSITION_FOLLOWING) : recap.parentElement !== nav;
  if (misplaced) {
    if (settingsBox) nav.insertBefore(recap, settingsBox);
    else nav.append(recap);
  }
  const recapKey = JSON.stringify([summary, Math.floor(now / 30_000), updatesAvailable]);
  if (recap.dataset.key === recapKey) return;
  recap.dataset.key = recapKey;
  // Avec le suivi des mises, la liste « Mises en direct » (bid-watch.ts) remplace le compte en tête / surenchéries.
  const liveList = flags.bidWatch && store.settings.apiRead;
  const status = el('div', { class: 'wiky-status', role: 'button', tabindex: '0', 'aria-label': 'Ouvrir les slots à remplir' }, statusHtml(summary, now, false, !liveList));
  bindTips(status);
  const live = recap.querySelector('[data-wiky="bid-watch"]');
  if (live) status.append(live);
  status.addEventListener('click', (e) => {
    // Les lignes des mises (liens, bouton de surenchère) gardent leur rôle.
    if ((e.target as Element).closest('[data-wiky="bid-watch"]')) return;
    const act = (e.target as Element).closest<HTMLElement>('[data-act]');
    if (act?.dataset.act === 'update') return;
    if (act?.dataset.act === 'refresh') {
      act.classList.add('spin');
      actions.refresh();
    } else openModal('sell');
  });
  status.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target === status) openModal('sell');
  });
  hideTip();
  recap.replaceChildren(status);
}

// ---------------------------------------------------------------- résumé et menu Wiki-Traders

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n > 1 ? many : one}`;
}

function ago(ts: number, now: number): string {
  const min = Math.round((now - ts) / 60_000);
  if (min < 1) return 'à l\'instant';
  if (min < 60) return `il y a ${min} min`;
  return `il y a ${formatDuration(now - ts)}`;
}

export interface SiteSummary {
  slots: number;
  occupied: number;
  toSell: number;
  nextEnd: number | null;
  leading: number;
  outbid: number;
  won24: number;
  lost24: number;
  lastSync: number | null;
  /** Mes ventes en cours (ordre de fin) : prix actuel et enchère reçue, pour les barres des slots. */
  listings: { name: string; price: number | null; hasBid: boolean; endsAt: number | null }[];
}

/** Résumé affiché en permanence dans la barre latérale. */
export function siteSummary(store: SiteUiStore, now = Date.now()): SiteSummary {
  const alloc = allocate(store, now);
  const bids = store.bidsCache?.bids ?? [];
  const running = bids.filter((b) => (b.status === 'leading' || b.status === 'outbid') && (b.endsAt == null || b.endsAt > now));
  const recent = bids.filter((b) => b.endsAt != null && b.endsAt <= now && now - b.endsAt < 24 * 3600_000);
  const syncs = [store.meta.lastAuctionsScan, store.bidsCache?.at ?? null].filter((t): t is number => t != null);
  const listings = alloc.busy
    .map(({ auction: a }) => ({
      name: a.cardName,
      price: a.currentPrice ?? a.startPrice,
      hasBid: a.hasBid ?? (a.currentPrice != null && a.startPrice != null && a.currentPrice > a.startPrice),
      endsAt: a.endsAt,
    }))
    .sort((a, b) => (a.endsAt ?? Infinity) - (b.endsAt ?? Infinity));
  return {
    listings,
    slots: alloc.slots,
    occupied: alloc.busy.length,
    toSell: alloc.free.filter((s) => !s.ignored && s.proposal).length,
    nextEnd: alloc.nextEnd,
    leading: running.filter((b) => b.status === 'leading').length,
    outbid: running.filter((b) => b.status === 'outbid').length,
    won24: recent.filter((b) => b.status === 'won').length,
    lost24: recent.filter((b) => b.status === 'lost').length,
    lastSync: syncs.length ? Math.max(...syncs) : null,
  };
}

/** Nouveautés disponibles sur main (0 : à jour) — renseigné par index.ts depuis la vérification des mises à jour. */
let updatesAvailable = 0;
export function setUpdatesAvailable(n: number): void {
  updatesAvailable = n;
}

/** Prix court pour les barres des slots : 950, 1,2k, 15k. */
function shortPrice(v: number): string {
  if (v < 1000) return String(Math.round(v));
  const k = v / 1000;
  return `${k < 10 ? k.toFixed(1).replace('.', ',').replace(',0', '') : Math.round(k)}k`;
}

const escAttr = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

function statusHtml(s: SiteSummary, now: number, toggle = true, bidsRow = true): string {
  const free = Math.max(0, s.slots - s.occupied);
  const stale = s.lastSync == null ? 'none' : now - s.lastSync > STALE_AFTER_MS ? 'stale' : '';
  // Une barre par slot : orange = en vente, verte = au moins une enchère reçue ; prix actuel dessous.
  const segs = Array.from({ length: Math.min(s.slots, 12) }, (_, i) => {
    const l = s.listings[i];
    if (!l) return `<span class="wiky-seg"><i class="${i < s.occupied ? 'on' : ''}"></i><small></small></span>`;
    const tip = `${l.name} · ${l.price != null ? `${formatPrice(l.price)} W` : 'prix inconnu'} · ${l.hasBid ? 'au moins une enchère' : 'aucune enchère'}${l.endsAt ? ` · fin dans ${formatDuration(l.endsAt - now)}` : ''}`;
    return `<span class="wiky-seg" data-tip="${escAttr(tip)}"><i class="on${l.hasBid ? ' bid' : ''}"></i><small>${l.price != null ? shortPrice(l.price) : '?'}</small></span>`;
  }).join('');
  const bids = s.leading || s.outbid
    ? `${s.leading ? `<b class="wiky-win">${s.leading} en tête</b>` : ''}${s.leading && s.outbid ? ' · ' : ''}${s.outbid ? `<b class="wiky-lose">${s.outbid} surenchérie${s.outbid > 1 ? 's' : ''}</b>` : ''}`
    : '<b>aucune en cours</b>';
  const results = s.won24 || s.lost24
    ? `<div class="wiky-row"><span>24 h</span><span>${s.won24 ? `<b class="wiky-win">${plural(s.won24, 'gagnée')}</b>` : ''}${s.won24 && s.lost24 ? ' · ' : ''}${s.lost24 ? `<b class="wiky-lose">${plural(s.lost24, 'perdue')}</b>` : ''}</span></div>`
    : '';
  return `
    <div class="wiky-status-head"><span class="wiky-ico">${icon('coins', 18)}</span>Wiki-Traders<span class="wiky-dot ${stale}" title="${stale === 'none' ? 'Jamais synchronisé' : stale ? 'Données anciennes' : 'Données à jour'}"></span>
      ${toggle ? `<span class="wiky-status-toggle" role="button" tabindex="0" data-act="toggle" title="Afficher / masquer le menu"><span class="wiky-chev" style="margin:0">${icon('chevron', 14)}</span></span>` : ''}</div>
    <div class="wiky-row"><span>Slots</span><span><b>${s.occupied}/${s.slots}</b> · ${free ? `<b class="wiky-win">${plural(free, 'libre')}</b>` : 'complets'}</span></div>
    <div class="wiky-slots">${segs}</div>
    ${s.nextEnd ? `<div class="wiky-row"><span>Prochaine fin</span><b>${formatDuration(s.nextEnd - now)}</b></div>` : ''}
    ${bidsRow || !(s.leading || s.outbid) ? `<div class="wiky-row"><span>Mises</span><span>${bids}</span></div>` : ''}
    ${results}
    ${updatesAvailable ? `<a class="wiky-update" data-act="update" href="/settings?wiky=settings#maj">↑ Mise à jour disponible (${updatesAvailable})</a>` : ''}
    <div class="wiky-sync">${s.lastSync ? `Synchro ${ago(s.lastSync, now)}` : 'Pas encore synchronisé'}
      <span class="wiky-refresh" role="button" tabindex="0" data-act="refresh" title="Actualiser mes ventes et mes mises">${icon('refresh', 12)}</span></div>`;
}

function currentRoute(): View | 'settings' | null {
  const wiky = new URLSearchParams(location.search).get('wiky');
  if (wiky === 'settings' && location.pathname === '/settings') return 'settings';
  return ITEMS.find((i) => i.page && i.view === wiky)?.view ?? null;
}

/** Conteneur d'une page « native » (dessinée par un module), s'il est affiché. */
export function nativeMount(view: View): HTMLElement | null {
  return document.querySelector<HTMLElement>(`#wiky-page [data-wiky-mount="${view}"]`);
}

function renderWikySection(nav: HTMLElement, store: SiteUiStore, actions: SiteUiActions): void {
  const now = Date.now();
  const s = siteSummary(store, now);
  const route = currentRoute();
  const key = JSON.stringify([s, Math.floor(now / 30_000), route, store.settings.features]);
  let box = nav.querySelector<HTMLElement>(':scope > [data-wiky="nav-wiky"]');
  if (!box) {
    box = el('div', { 'data-wiky': 'nav-wiky', class: 'wiky-section' });
    box.dataset.open = String(isOpen('wiky', true));
    // Sous les menus du site, juste avant « Paramètres ».
    const settings = nav.querySelector(':scope > a[href="/settings"]');
    if (settings) nav.insertBefore(box, settings);
    else nav.append(box);
  }
  if (box.dataset.key === key) return;
  box.dataset.key = key;

  const status = el('div', { class: 'wiky-status', role: 'button', tabindex: '0', 'aria-label': 'Ouvrir les slots à remplir' }, statusHtml(s, now));
  bindTips(status);
  status.addEventListener('click', (e) => {
    const act = (e.target as Element).closest<HTMLElement>('[data-act]')?.dataset.act;
    if (act === 'toggle') {
      const open = box!.dataset.open !== 'true';
      box!.dataset.open = String(open);
      setOpen('wiky', open);
    } else if (act === 'refresh') {
      (e.target as Element).closest('[data-act]')!.classList.add('spin');
      actions.refresh();
    } else openModal('sell');
  });
  status.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target === status) openModal('sell');
  });

  const items = el('div', { class: 'wiky-items' });
  const counts: Partial<Record<View, number>> = { sell: s.toSell, running: s.occupied, bids: s.leading + s.outbid };
  const flags = featureFlags(store.settings.features);
  for (const item of ITEMS) {
    if (item.feature && !flags[item.feature]) continue;
    const count = counts[item.view] ? `<span class="wiky-count">${counts[item.view]}</span>` : '';
    const inner = `<span class="wiky-ico">${icon(item.icon, 18)}</span><span>${item.label}</span>${count}`;
    if (item.page) {
      items.append(el('a', { class: `wiky-nav${route === item.view ? ' is-active' : ''}`, href: `${item.page}?wiky=${item.view}` }, inner));
    } else {
      const b = el('button', { type: 'button', class: 'wiky-nav' }, inner);
      b.addEventListener('click', () => openModal(item.view));
      items.append(b);
    }
  }
  items.append(el('a', { class: `wiky-nav${route === 'settings' ? ' is-active' : ''}`, href: '/settings?wiky=settings' }, `<span class="wiky-ico">${icon('sliders', 18)}</span><span>Réglages</span>`));
  box.replaceChildren(status, items);
}

// ---------------------------------------------------------------- fenêtres par-dessus la page

let modalCleanup: (() => void) | null = null;

export function isModalOpen(): boolean {
  return modalCleanup != null;
}

export function closeModal(): void {
  modalCleanup?.();
  modalCleanup = null;
}

export function openModal(view: View): void {
  closeModal();
  ensureStyle();
  const item = ITEMS.find((i) => i.view === view)!;
  const overlay = el('div', { 'data-wiky': 'modal', class: 'wiky-modal-overlay' });
  const box = el('div', { class: `wiky-modal${item.wide ? ' wide' : ''}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': item.title });
  const head = el('div', { class: 'wiky-modal-head' }, `<span class="wiky-ico">${icon(item.icon, 18)}</span><div><small>Wiki-Traders</small><h2></h2></div>`);
  head.querySelector('h2')!.textContent = item.title;
  const close = el('button', { type: 'button', class: 'wiky-modal-close', 'aria-label': 'Fermer', title: 'Fermer' }, icon('x', 18));
  head.append(close);
  const frame = el('iframe', { src: frameUrl('popup', view), title: `Wiki-Traders – ${item.title}` }) as HTMLIFrameElement;
  box.append(head, frame);
  overlay.append(box);
  // Les fenêtres du site se ferment au clic à l'extérieur : un clic dans la nôtre ne doit pas les fermer.
  for (const type of ['click', 'mousedown', 'pointerdown']) overlay.addEventListener(type, (e) => e.stopPropagation());
  overlay.addEventListener('mousedown', (e) => {
    if (e.target === overlay) closeModal();
  });
  close.addEventListener('click', closeModal);
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') closeModal();
  };
  const onMessage = (e: MessageEvent) => {
    if (e.source === frame.contentWindow && (e.data as { wiky?: string } | null)?.wiky === 'close') closeModal();
  };
  document.addEventListener('keydown', onKey);
  window.addEventListener('message', onMessage);
  document.body.append(overlay);
  close.focus();
  modalCleanup = () => {
    document.removeEventListener('keydown', onKey);
    window.removeEventListener('message', onMessage);
    overlay.remove();
  };
}

// ---------------------------------------------------------------- pages (cartes, ventes conclues, réglages)

function renderPage(): void {
  const route = currentRoute();
  const main = document.querySelector('main');
  let page = document.getElementById('wiky-page');
  if (!route || !main) {
    page?.remove();
    document.documentElement.removeAttribute('data-wiky-route');
    return;
  }
  if (document.documentElement.getAttribute('data-wiky-route') !== route) document.documentElement.setAttribute('data-wiky-route', route);
  if (page?.dataset.route === route) {
    if (page.parentElement !== main) main.append(page);
    return;
  }
  page?.remove();
  page = el('section', { id: 'wiky-page', 'data-wiky': 'page', 'data-route': route });
  const item = ITEMS.find((i) => i.view === route);
  const title = route === 'settings' ? 'Paramètres' : item!.title;
  const head = el('div', { class: 'wiky-page-head' }, `<span class="wiky-ico">${icon(route === 'settings' ? 'sliders' : item!.icon, 20)}</span><h1 class="text-2xl md:text-3xl font-bold"></h1>`);
  head.querySelector('h1')!.textContent = title;
  page.append(head);
  if (route === 'settings') {
    const tabs = el('div', { class: 'wiky-tabs', role: 'tablist' });
    tabs.append(el('a', { class: 'wiky-tab', href: '/settings', role: 'tab', 'aria-selected': 'false' }, 'Général'));
    tabs.append(el('span', { class: 'wiky-tab is-active', role: 'tab', 'aria-selected': 'true' }, 'Wiki-Traders'));
    page.append(tabs);
  }
  if (item?.native) {
    // Rempli par le module de la fonctionnalité (features/), à la relecture suivante.
    page.append(el('div', { 'data-wiky-mount': route }));
    main.append(page);
    return;
  }
  const frameBox = el('div', { class: 'wiky-frame' });
  frameBox.append(el('iframe', { src: route === 'settings' ? frameUrl('options') : frameUrl('popup', route), title: `Wiki-Traders – ${title}` }));
  page.append(frameBox);
  main.append(page);
}

/** Page Paramètres du site : un onglet « Wiki-Traders » à côté des siens (ou un raccourci sous le titre). */
function renderSettingsEntry(): void {
  const existing = document.querySelector('[data-wiky="settings-entry"]');
  if (location.pathname !== '/settings' || currentRoute() === 'settings') {
    existing?.remove();
    return;
  }
  if (existing?.isConnected) return;
  const main = document.querySelector('main');
  if (!main) return;
  const tablist = main.querySelector<HTMLElement>('[role="tablist"]');
  const lastTab = tablist?.querySelector<HTMLElement>('[role="tab"]:last-of-type');
  let entry: HTMLElement;
  if (tablist && lastTab) {
    // Même apparence qu'un onglet inactif du site.
    entry = lastTab.cloneNode(false) as HTMLElement;
    entry.removeAttribute('id');
    entry.removeAttribute('aria-controls');
    entry.setAttribute('aria-selected', 'false');
    entry.removeAttribute('data-state');
    entry.textContent = 'Wiki-Traders';
    entry.style.color = '#fdba74';
    tablist.append(entry);
  } else {
    entry = el('div', { class: 'wiky-tabs' });
    entry.append(el('span', { class: 'wiky-tab is-active' }, 'Général'));
    entry.append(el('a', { class: 'wiky-tab', href: '/settings?wiky=settings' }, 'Wiki-Traders'));
    const h1 = main.querySelector('h1');
    if (h1?.parentElement) h1.parentElement.insertBefore(entry, h1.nextSibling);
    else main.prepend(entry);
  }
  entry.setAttribute('data-wiky', 'settings-entry');
  entry.addEventListener('click', (e) => {
    if ((e.target as Element).closest('a')) return;
    e.preventDefault();
    location.href = '/settings?wiky=settings';
  });
}

// ---------------------------------------------------------------- point d'entrée

export function renderSiteUi(store: SiteUiStore, actions: SiteUiActions): void {
  const { siteIntegration, compactNav } = store.settings;
  const nav = siteNav();
  if (!siteIntegration) {
    nav?.querySelector('[data-wiky="nav-wiky"]')?.remove();
    nav?.querySelector('[data-wiky="nav-recap"]')?.remove();
    document.querySelector('[data-wiky="settings-entry"]')?.remove();
    document.getElementById('wiky-page')?.remove();
    document.documentElement.removeAttribute('data-wiky-route');
    closeModal();
  }
  if (!siteIntegration && !compactNav && !document.getElementById('wiky-site-style')) return;
  ensureStyle();
  if (nav) {
    if (compactNav) renderTree(nav, store, actions);
    else {
      // Barre du site intacte ; Wiki-Traders en un seul bloc (récapitulatif et menu) au-dessus de « Paramètres ».
      clearTree(nav);
      delete nav.dataset.wikyTree;
      if (siteIntegration) renderWikySection(nav, store, actions);
    }
  }
  if (siteIntegration) {
    renderPage();
    renderSettingsEntry();
  }
}
