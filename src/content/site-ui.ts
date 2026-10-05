/**
 * Wiky-Traders intégré au site, à la manière de « Familles » (violet) de l'extension « Prix moyen collection », en orange :
 *  - barre latérale plus compacte, liens regroupés en menus (Social, Progression) ;
 *  - résumé toujours visible (synchro, slots libres, mises en cours gagnées / perdues) et menu Wiky-Traders ;
 *  - fonctionnalités en fenêtre par-dessus la page (vendre, mises…) ou en page (cartes, ventes conclues) ;
 *  - onglet « Wiky-Traders » dans Paramètres (/settings?wiky=settings).
 * Les liens du site ne sont jamais déplacés (React les gère) : ils sont masqués et reproduits dans nos menus,
 * un clic sur la copie déclenche le lien d'origine (navigation du site, sans rechargement).
 */
import { allocate, type AllocationInput } from '../lib/allocation';
import { ext } from '../lib/browser';
import { STALE_AFTER_MS } from '../lib/defaults';
import { formatDuration } from '../lib/text';
import type { Meta, MyBidsResult } from '../lib/types';

export type SiteUiStore = AllocationInput & { bidsCache: MyBidsResult | null; meta: Meta };

export interface SiteUiActions {
  /** Relit mes ventes et mes mises (bouton ↻ du résumé). */
  refresh: () => void;
}

type View = 'sell' | 'running' | 'bids' | 'sold' | 'cards' | 'tags' | 'tools';

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
};

function icon(name: string, size = 20): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;
}

/** Fonctionnalités de la popup : en fenêtre par-dessus la page, ou en page quand la liste est longue. */
const ITEMS: { view: View; label: string; title: string; icon: string; page?: string; wide?: boolean }[] = [
  { view: 'sell', label: 'Vendre', title: 'Slots à remplir', icon: 'tag' },
  { view: 'running', label: 'Mes ventes', title: 'Mes ventes en cours', icon: 'hourglass' },
  { view: 'bids', label: 'Mes mises', title: 'Mes mises', icon: 'bid' },
  { view: 'cards', label: 'Cartes & prix', title: 'Cartes & prix', icon: 'layers', page: '/collection' },
  { view: 'sold', label: 'Ventes conclues', title: 'Ventes conclues', icon: 'receipt', page: '/marketplace' },
  { view: 'tags', label: 'Étiquettes', title: 'Étiquetage', icon: 'tags' },
  { view: 'tools', label: 'Outils', title: 'Outils', icon: 'wrench' },
];

/** Menus de la barre latérale : liens du site regroupés. */
const GROUPS: { id: string; label: string; icon: string; hrefs: string[] }[] = [
  { id: 'social', label: 'Social', icon: 'users', hrefs: ['/trades', '/friends', '/dms', '/guild', '/battle'] },
  { id: 'progress', label: 'Progression', icon: 'trending', hrefs: ['/profile', '/achievements', '/leaderboard'] },
];

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
.wiky-slots i { flex: 1; height: 4px; border-radius: 2px; background: color-mix(in srgb, var(--color-foreground) 14%, transparent); }
.wiky-slots i.on { background: #f97316; }
.wiky-win { color: #4ade80 !important; }
.wiky-lose { color: #f87171 !important; }
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

function renderGroups(nav: HTMLElement, compact: boolean): void {
  if (!compact) {
    nav.removeAttribute('data-wiky-nav');
    for (const a of nav.querySelectorAll('[data-wiky-grouped]')) a.removeAttribute('data-wiky-grouped');
    for (const g of nav.querySelectorAll('[data-wiky="nav-group"]')) g.remove();
    return;
  }
  if (nav.getAttribute('data-wiky-nav') !== 'compact') nav.setAttribute('data-wiky-nav', 'compact');
  for (const group of GROUPS) {
    const originals = [...nav.querySelectorAll<HTMLAnchorElement>(':scope > a[href]')].filter((a) => group.hrefs.includes(a.getAttribute('href') ?? ''));
    let box = nav.querySelector<HTMLElement>(`:scope > [data-wiky="nav-group"][data-group="${group.id}"]`);
    if (!originals.length) {
      box?.remove();
      continue;
    }
    for (const a of originals) if (a.getAttribute('data-wiky-grouped') !== group.id) a.setAttribute('data-wiky-grouped', group.id);
    const active = originals.some((a) => /color-accent\)\]\/10|aria-current/.test(a.className) || a.getAttribute('aria-current') === 'page');
    const key = originals.map((a) => `${a.getAttribute('href')}|${a.className}|${a.textContent}`).join('\n');
    if (!box) {
      box = el('div', { 'data-wiky': 'nav-group', 'data-group': group.id });
      nav.insertBefore(box, originals[0]);
    }
    if (box.dataset.key === key) continue;
    box.dataset.key = key;
    box.dataset.open = String(active || isOpen(group.id, false));
    const head = el('button', { type: 'button', class: `wiky-group-head ${NAV_ITEM_CLASS}${active ? ' is-active' : ''}`, 'aria-expanded': box.dataset.open },
      `<span class="${NAV_ICON_CLASS}">${icon(group.icon, 24).replace('<svg ', '<svg class="w-5 h-5 md:w-6 md:h-6 shrink-0" ')}</span>${group.label}<span class="wiky-chev">${icon('chevron', 16)}</span>`);
    head.addEventListener('click', () => {
      const open = box!.dataset.open !== 'true';
      box!.dataset.open = String(open);
      head.setAttribute('aria-expanded', String(open));
      setOpen(group.id, open);
    });
    const items = el('div', { class: 'wiky-group-items' });
    for (const a of originals) {
      const copy = a.cloneNode(true) as HTMLAnchorElement;
      copy.removeAttribute('data-wiky-grouped');
      // Le lien d'origine (caché) fait la navigation du site, sans rechargement complet.
      copy.addEventListener('click', (e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        a.click();
      });
      items.append(copy);
    }
    box.replaceChildren(head, items);
  }
}

// ---------------------------------------------------------------- résumé et menu Wiky-Traders

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
}

/** Résumé affiché en permanence dans la barre latérale. */
export function siteSummary(store: SiteUiStore, now = Date.now()): SiteSummary {
  const alloc = allocate(store, now);
  const bids = store.bidsCache?.bids ?? [];
  const running = bids.filter((b) => (b.status === 'leading' || b.status === 'outbid') && (b.endsAt == null || b.endsAt > now));
  const recent = bids.filter((b) => b.endsAt != null && b.endsAt <= now && now - b.endsAt < 24 * 3600_000);
  const syncs = [store.meta.lastAuctionsScan, store.bidsCache?.at ?? null].filter((t): t is number => t != null);
  return {
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

function statusHtml(s: SiteSummary, now: number): string {
  const free = Math.max(0, s.slots - s.occupied);
  const stale = s.lastSync == null ? 'none' : now - s.lastSync > STALE_AFTER_MS ? 'stale' : '';
  const segs = Array.from({ length: Math.min(s.slots, 12) }, (_, i) => `<i class="${i < s.occupied ? 'on' : ''}"></i>`).join('');
  const bids = s.leading || s.outbid
    ? `${s.leading ? `<b class="wiky-win">${s.leading} en tête</b>` : ''}${s.leading && s.outbid ? ' · ' : ''}${s.outbid ? `<b class="wiky-lose">${s.outbid} surenchérie${s.outbid > 1 ? 's' : ''}</b>` : ''}`
    : '<b>aucune en cours</b>';
  const results = s.won24 || s.lost24
    ? `<div class="wiky-row"><span>24 h</span><span>${s.won24 ? `<b class="wiky-win">${plural(s.won24, 'gagnée')}</b>` : ''}${s.won24 && s.lost24 ? ' · ' : ''}${s.lost24 ? `<b class="wiky-lose">${plural(s.lost24, 'perdue')}</b>` : ''}</span></div>`
    : '';
  return `
    <div class="wiky-status-head"><span class="wiky-ico">${icon('coins', 18)}</span>Wiky-Traders<span class="wiky-dot ${stale}" title="${stale === 'none' ? 'Jamais synchronisé' : stale ? 'Données anciennes' : 'Données à jour'}"></span>
      <span class="wiky-status-toggle" role="button" tabindex="0" data-act="toggle" title="Afficher / masquer le menu"><span class="wiky-chev" style="margin:0">${icon('chevron', 14)}</span></span></div>
    <div class="wiky-row"><span>Slots</span><span><b>${s.occupied}/${s.slots}</b> · ${free ? `<b class="wiky-win">${plural(free, 'libre')}</b>` : 'complets'}</span></div>
    <div class="wiky-slots">${segs}</div>
    ${s.nextEnd ? `<div class="wiky-row"><span>Prochaine fin</span><b>${formatDuration(s.nextEnd - now)}</b></div>` : ''}
    <div class="wiky-row"><span>Mises</span><span>${bids}</span></div>
    ${results}
    <div class="wiky-sync">${s.lastSync ? `Synchro ${ago(s.lastSync, now)}` : 'Pas encore synchronisé'}
      <span class="wiky-refresh" role="button" tabindex="0" data-act="refresh" title="Actualiser mes ventes et mes mises">${icon('refresh', 12)}</span></div>`;
}

function currentRoute(): View | 'settings' | null {
  const wiky = new URLSearchParams(location.search).get('wiky');
  if (wiky === 'settings' && location.pathname === '/settings') return 'settings';
  return ITEMS.find((i) => i.page && i.view === wiky)?.view ?? null;
}

function renderWikySection(nav: HTMLElement, store: SiteUiStore, actions: SiteUiActions): void {
  const now = Date.now();
  const s = siteSummary(store, now);
  const route = currentRoute();
  const key = JSON.stringify([s, Math.floor(now / 30_000), route]);
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

  const status = el('div', { class: 'wiky-status', role: 'button', tabindex: '0', title: 'Ouvrir les slots à remplir' }, statusHtml(s, now));
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
  for (const item of ITEMS) {
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
  const head = el('div', { class: 'wiky-modal-head' }, `<span class="wiky-ico">${icon(item.icon, 18)}</span><div><small>Wiky-Traders</small><h2></h2></div>`);
  head.querySelector('h2')!.textContent = item.title;
  const close = el('button', { type: 'button', class: 'wiky-modal-close', 'aria-label': 'Fermer', title: 'Fermer' }, icon('x', 18));
  head.append(close);
  const frame = el('iframe', { src: frameUrl('popup', view), title: `Wiky-Traders – ${item.title}` }) as HTMLIFrameElement;
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
    tabs.append(el('span', { class: 'wiky-tab is-active', role: 'tab', 'aria-selected': 'true' }, 'Wiky-Traders'));
    page.append(tabs);
  }
  const frameBox = el('div', { class: 'wiky-frame' });
  frameBox.append(el('iframe', { src: route === 'settings' ? frameUrl('options') : frameUrl('popup', route), title: `Wiky-Traders – ${title}` }));
  page.append(frameBox);
  main.append(page);
}

/** Page Paramètres du site : un onglet « Wiky-Traders » à côté des siens (ou un raccourci sous le titre). */
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
    entry.textContent = 'Wiky-Traders';
    entry.style.color = '#fdba74';
    tablist.append(entry);
  } else {
    entry = el('div', { class: 'wiky-tabs' });
    entry.append(el('span', { class: 'wiky-tab is-active' }, 'Général'));
    entry.append(el('a', { class: 'wiky-tab', href: '/settings?wiky=settings' }, 'Wiky-Traders'));
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
    document.querySelector('[data-wiky="settings-entry"]')?.remove();
    document.getElementById('wiky-page')?.remove();
    document.documentElement.removeAttribute('data-wiky-route');
    closeModal();
  }
  if (!siteIntegration && !compactNav && !document.getElementById('wiky-site-style')) return;
  ensureStyle();
  if (nav) {
    renderGroups(nav, compactNav);
    if (siteIntegration) renderWikySection(nav, store, actions);
  }
  if (siteIntegration) {
    renderPage();
    renderSettingsEntry();
  }
}
