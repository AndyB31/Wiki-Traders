/**
 * Briques d'interface des familles, dans le style du site (variables --color-*, cartes natives, orange
 * Wiky-Traders) : styles, boîtes de dialogue (confirmation, saisie, code), menu « Ajouter à une famille »,
 * balisage des cartes. Tout nœud ajouté porte `data-wiky` (ignoré par l'observateur de la page).
 */
import { RARITIES, formatPrice } from '../../lib/text';
import type { CardFamily, CatalogCard, Rarity } from '../../lib/types';

export const ICON: Record<string, string> = {
  folder: '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
  plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  star: '<path d="M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z"/>',
  pencil: '<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/>',
  trash: '<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>',
  share: '<path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" x2="12" y1="2" y2="15"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/>',
  back: '<path d="m15 18-6-6 6-6"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  chevron: '<path d="m6 9 6 6 6-6"/>',
  cart: '<circle cx="8" cy="21" r="1"/><circle cx="19" cy="21" r="1"/><path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  refresh: '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
  folderPlus: '<path d="M12 10v6"/><path d="M9 13h6"/><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
};

export function icon(name: string, size = 16): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[name]}</svg>`;
}

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export function esc(s: string | null | undefined): string {
  return (s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
}

/** Prix en W (unité du site). */
export function money(n: number | null | undefined): string {
  return n == null ? '—' : `${formatPrice(n)} W`;
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n.toLocaleString('fr-FR')} ${n > 1 ? many : one}`;
}

export const RARITY_LIST: Rarity[] = ['L', 'UR', 'SR', 'R', 'PC', 'C'];

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, html = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (html) node.innerHTML = html;
  return node;
}

const CSS = `
.wf { --wf-accent: #f97316; --wf-soft: rgba(249,115,22,.12); --wf-line: var(--color-border, rgba(255,255,255,.1)); --wf-fg: var(--color-foreground, #e7e5e4);
  --wf-muted: color-mix(in srgb, var(--wf-fg) 55%, transparent); --wf-surface: var(--color-surface, #18181b); --wf-surface2: var(--color-surface-light, #27272a);
  display: flex; flex-direction: column; gap: 14px; color: var(--wf-fg); font-size: 13px; }
.wf *, .wf-pop *, .wf-dialog * { box-sizing: border-box; }
.wf-bar { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.wf-grow { flex: 1 1 auto; }
.wf-input, .wf-select { height: 34px; padding: 0 10px; border-radius: 10px; border: 1px solid var(--wf-line); background: var(--wf-surface); color: var(--wf-fg); font: inherit; font-size: 13px; outline: none; }
.wf-input:focus, .wf-select:focus { border-color: rgba(249,115,22,.6); box-shadow: 0 0 0 3px rgba(249,115,22,.15); }
.wf-search { position: relative; display: flex; align-items: center; min-width: 200px; }
.wf-search svg { position: absolute; left: 10px; opacity: .5; pointer-events: none; }
.wf-search .wf-input { width: 100%; padding-left: 32px; }
.wf-btn { display: inline-flex; align-items: center; gap: 6px; height: 34px; padding: 0 12px; border-radius: 10px; border: 1px solid var(--wf-line); background: var(--wf-surface);
  color: var(--wf-fg); font: inherit; font-size: 13px; font-weight: 600; cursor: pointer; white-space: nowrap; transition: background .15s, border-color .15s, color .15s; }
.wf-btn:hover { background: var(--wf-surface2); }
.wf-btn:disabled { opacity: .45; cursor: default; }
.wf-btn.primary { border-color: transparent; background: var(--wf-accent); color: #fff; }
.wf-btn.primary:hover { background: #ea580c; }
.wf-btn.danger:hover { border-color: rgba(248,113,113,.5); color: #f87171; }
.wf-btn.ghost { border-color: transparent; background: none; color: var(--wf-muted); }
.wf-btn.ghost:hover { color: var(--wf-fg); background: var(--wf-surface2); }
.wf-btn.sm { height: 28px; padding: 0 9px; font-size: 12px; border-radius: 8px; }
.wf-btn:focus-visible, .wf-chip:focus-visible, .wf-tile:focus-visible { outline: 2px solid rgba(251,146,60,.7); outline-offset: 2px; }
.wf-chip { height: 30px; padding: 0 12px; border-radius: 999px; border: 1px solid var(--wf-line); background: var(--wf-surface); color: var(--wf-muted); font: inherit; font-size: 12.5px; font-weight: 600; cursor: pointer; }
.wf-chip:hover { color: var(--wf-fg); }
.wf-chip.on { border-color: rgba(249,115,22,.45); background: var(--wf-soft); color: #fdba74; }
.wf-chip b { font-variant-numeric: tabular-nums; opacity: .8; margin-left: 4px; }
.wf-muted { color: var(--wf-muted); }
.wf-small { font-size: 11.5px; }
.wf-dot { display: inline-block; flex: none; width: 10px; height: 10px; border-radius: 50%; box-shadow: 0 0 0 2px rgba(0,0,0,.35); }
.wf-progress { height: 6px; border-radius: 999px; background: color-mix(in srgb, var(--wf-fg) 12%, transparent); overflow: hidden; }
.wf-progress > i { display: block; height: 100%; border-radius: inherit; background: var(--wf-accent); transition: width .3s ease; }
.wf-panel { border: 1px solid var(--wf-line); border-radius: 16px; background: var(--wf-surface); padding: 14px; }
.wf-empty { padding: 36px 16px; text-align: center; color: var(--wf-muted); border: 1px dashed var(--wf-line); border-radius: 16px; }

/* accueil : tuiles de familles */
.wf-tiles { display: grid; grid-template-columns: repeat(auto-fill, minmax(210px, 1fr)); gap: 14px; }
.wf-tile { display: flex; flex-direction: column; border: 1px solid var(--wf-line); border-radius: 16px; background: var(--wf-surface); overflow: hidden; cursor: pointer; text-align: left;
  font: inherit; color: inherit; padding: 0; transition: transform .15s ease, border-color .15s ease; }
.wf-tile:hover { transform: translateY(-2px); border-color: color-mix(in srgb, var(--wf-tile-color, #f97316) 55%, transparent); }
.wf-cover { position: relative; display: grid; grid-template-columns: 1fr 1fr; grid-template-rows: 1fr 1fr; gap: 2px; aspect-ratio: 16/10; background: var(--wf-surface2); }
.wf-cover.one { grid-template-columns: 1fr; grid-template-rows: 1fr; }
.wf-cover img { width: 100%; height: 100%; object-fit: cover; object-position: center 28%; display: block; }
.wf-cover .wf-noimg { display: grid; place-items: center; color: var(--wf-muted); }
.wf-cover::after { content: ""; position: absolute; inset: 0; background: linear-gradient(180deg, transparent 55%, rgba(0,0,0,.55)); pointer-events: none; }
.wf-tile-body { display: flex; flex-direction: column; gap: 7px; padding: 11px 12px 12px; }
.wf-tile-name { display: flex; align-items: center; gap: 8px; font-weight: 700; font-size: 14px; min-width: 0; }
.wf-tile-name span:last-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wf-row { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; font-size: 12px; color: var(--wf-muted); }
.wf-row b { color: var(--wf-fg); font-variant-numeric: tabular-nums; }

/* détail */
.wf-head { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; }
.wf-name { font-size: 22px; font-weight: 800; font-family: var(--font-heading, inherit); background: none; border: 1px solid transparent; border-radius: 10px; color: inherit; padding: 2px 8px; margin-left: -8px; min-width: 120px; max-width: 100%; }
.wf-name:hover { border-color: var(--wf-line); }
.wf-name:focus { outline: none; border-color: rgba(249,115,22,.6); background: var(--wf-surface); }
.wf-color { width: 22px; height: 22px; border-radius: 50%; border: 2px solid rgba(255,255,255,.25); cursor: pointer; padding: 0; }
.wf-stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; }
.wf-stat { border: 1px solid var(--wf-line); border-radius: 12px; padding: 10px 12px; background: var(--wf-surface); }
.wf-stat small { display: block; font-size: 10.5px; font-weight: 700; letter-spacing: .05em; text-transform: uppercase; color: var(--wf-muted); }
.wf-stat b { display: block; margin-top: 3px; font-size: 18px; font-variant-numeric: tabular-nums; }
.wf-stat em { font-style: normal; font-size: 11px; color: var(--wf-muted); }

/* cartes (même allure que les cartes natives) */
.wf-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(132px, 1fr)); gap: 12px; }
.wf-card { position: relative; aspect-ratio: 10/14; border-radius: 16px; overflow: hidden; background-color: #1f1f23; background-position: center; background-size: 180%;
  content-visibility: auto; contain-intrinsic-size: auto 190px; transition: transform .2s ease, filter .2s ease, opacity .2s ease; }
.wf-card:hover { transform: scale(1.04); z-index: 2; }
.wf-card.missing { filter: grayscale(.85); opacity: .5; }
.wf-card.missing:hover { filter: none; opacity: 1; }
.wf-art { position: absolute; top: 0; left: 0; right: 0; height: 45%; background: rgba(0,0,0,.2); overflow: hidden; }
.wf-art img { width: 100%; height: 100%; object-fit: cover; object-position: center 28%; display: block; }
.wf-art .wf-logo { width: 52%; height: 100%; margin: 0 auto; object-fit: contain; opacity: .6; }
.wf-art::after { content: ""; position: absolute; left: 0; right: 0; bottom: 0; height: 40%; background: linear-gradient(0deg, rgba(0,0,0,.5), transparent); }
.wf-rar { position: absolute; top: 8px; left: 8px; z-index: 3; padding: 1px 7px; border-radius: 6px; font-size: 11px; font-weight: 800; color: #0d1117; }
.wf-text { position: absolute; top: 45%; left: 0; right: 0; bottom: 0; display: flex; flex-direction: column; gap: 3px; padding: 9px 10px 8px; color: #111; }
.wf-text h3 { margin: 0; font-size: 12px; font-weight: 800; line-height: 1.15; font-family: var(--font-heading, inherit); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.wf-text p { margin: 0; font-size: 9px; line-height: 1.25; color: rgba(23,23,23,.85); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.wf-foot { margin-top: auto; display: flex; align-items: center; justify-content: space-between; gap: 4px; border-top: 1px solid rgba(0,0,0,.2); padding-top: 4px; font-size: 10.5px; font-weight: 800; }
.wf-own { position: absolute; top: 8px; right: 8px; z-index: 3; min-width: 22px; height: 20px; padding: 0 6px; border-radius: 999px; display: grid; place-items: center;
  font-size: 11px; font-weight: 800; background: #22c55e; color: #052e16; box-shadow: 0 0 0 2px rgba(0,0,0,.25); }
.wf-own.no { background: rgba(0,0,0,.6); color: #fca5a5; }
.wf-cover-mark { position: absolute; top: 34px; right: 8px; z-index: 3; color: #facc15; filter: drop-shadow(0 1px 2px rgba(0,0,0,.6)); }
.wf-acts { position: absolute; left: 6px; right: 6px; top: calc(45% - 34px); z-index: 4; display: flex; justify-content: flex-end; gap: 4px; opacity: 0; transition: opacity .15s; }
.wf-card:hover .wf-acts, .wf-card:focus-within .wf-acts { opacity: 1; }
.wf-acts button { display: grid; place-items: center; width: 28px; height: 28px; border: 0; border-radius: 8px; cursor: pointer; background: rgba(15,15,18,.82); color: #fff; }
.wf-acts button:hover { background: var(--wf-accent, #f97316); }
.wf-acts button.danger:hover { background: #dc2626; }
.wf-more { display: flex; justify-content: center; padding: 8px; }

/* ajout de cartes */
.wf-add { display: flex; flex-direction: column; gap: 10px; border-color: rgba(249,115,22,.35); }
.wf-results { display: grid; grid-template-columns: repeat(auto-fill, minmax(250px, 1fr)); gap: 6px; max-height: min(52vh, 520px); overflow-y: auto; padding: 2px; overscroll-behavior: contain; }
.wf-res { display: flex; align-items: center; gap: 9px; padding: 6px 8px; border-radius: 10px; border: 1px solid var(--wf-line); background: var(--wf-surface2); cursor: pointer; user-select: none; min-width: 0; }
.wf-res:hover { border-color: rgba(249,115,22,.4); }
.wf-res.sel { border-color: var(--wf-accent); background: var(--wf-soft); }
.wf-res.in { opacity: .45; cursor: default; }
.wf-res input { accent-color: #f97316; width: 16px; height: 16px; margin: 0; flex: none; pointer-events: none; }
.wf-res img, .wf-res .wf-thumb { width: 36px; height: 36px; flex: none; border-radius: 8px; object-fit: cover; background: rgba(0,0,0,.25); }
.wf-res-main { min-width: 0; flex: 1; display: flex; flex-direction: column; }
.wf-res-main b { font-size: 12.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wf-res-main span { font-size: 11px; color: var(--wf-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wf-tag { flex: none; padding: 1px 6px; border-radius: 6px; font-size: 10.5px; font-weight: 800; color: #0d1117; }
.wf-owned-tag { flex: none; font-size: 11px; font-weight: 700; color: #4ade80; }
.wf-sentinel { grid-column: 1 / -1; height: 1px; }

/* marché */
.wf-market { display: flex; flex-direction: column; gap: 6px; }
.wf-mrow { display: grid; grid-template-columns: 40px minmax(0, 1fr) auto; align-items: center; gap: 10px; padding: 7px 9px; border-radius: 12px; border: 1px solid var(--wf-line); background: var(--wf-surface2); }
.wf-mrow img, .wf-mrow .wf-thumb { width: 40px; height: 40px; border-radius: 8px; object-fit: cover; background: rgba(0,0,0,.25); }
.wf-offers { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 6px; }
.wf-offer { display: inline-flex; align-items: baseline; gap: 6px; padding: 4px 9px; border-radius: 9px; border: 1px solid var(--wf-line); background: var(--wf-surface); color: var(--wf-fg);
  text-decoration: none; font-size: 12px; font-weight: 700; font-variant-numeric: tabular-nums; }
.wf-offer:hover { border-color: rgba(249,115,22,.55); color: #fdba74; }
.wf-offer small { font-weight: 500; color: var(--wf-muted); }
details.wf-panel > summary { cursor: pointer; list-style: none; display: flex; align-items: center; gap: 8px; font-weight: 700; }
details.wf-panel > summary::-webkit-details-marker { display: none; }
details.wf-panel[open] > summary { margin-bottom: 10px; }

/* menus et boîtes de dialogue */
.wf-pop { position: fixed; z-index: 2147483646; min-width: 240px; max-width: 320px; max-height: 360px; display: flex; flex-direction: column; border-radius: 14px; overflow: hidden;
  border: 1px solid var(--color-border, rgba(255,255,255,.12)); background: var(--color-surface, #18181b); color: var(--color-foreground, #e7e5e4);
  box-shadow: 0 18px 50px rgba(0,0,0,.5); font-size: 13px; animation: wf-in .12s ease; }
.wf-pop .wf-input { margin: 8px; height: 32px; }
.wf-pop-list { overflow-y: auto; padding: 4px; display: flex; flex-direction: column; }
.wf-pop-item { display: flex; align-items: center; gap: 9px; width: 100%; padding: 8px 10px; border: 0; border-radius: 9px; background: none; color: inherit; font: inherit; text-align: left; cursor: pointer; }
.wf-pop-item:hover, .wf-pop-item:focus-visible { background: rgba(249,115,22,.12); outline: none; }
.wf-pop-item span.wf-grow { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wf-pop-item small { color: color-mix(in srgb, var(--color-foreground, #e7e5e4) 50%, transparent); font-variant-numeric: tabular-nums; }
.wf-pop-item.new { color: #fdba74; font-weight: 600; border-top: 1px solid var(--color-border, rgba(255,255,255,.1)); border-radius: 0 0 9px 9px; }
.wf-overlay { position: fixed; inset: 0; z-index: 2147483646; display: grid; place-items: center; padding: 18px; background: rgba(0,0,0,.6); backdrop-filter: blur(2px); animation: wf-in .12s ease; }
.wf-dialog { width: min(440px, 100%); display: flex; flex-direction: column; gap: 12px; padding: 18px; border-radius: 16px; border: 1px solid var(--color-border, rgba(255,255,255,.12));
  background: var(--color-surface, #18181b); color: var(--color-foreground, #e7e5e4); box-shadow: 0 24px 72px rgba(0,0,0,.5); font-size: 13px; }
.wf-dialog h2 { margin: 0; font-size: 16px; font-weight: 700; }
.wf-dialog p { margin: 0; color: color-mix(in srgb, var(--color-foreground, #e7e5e4) 70%, transparent); line-height: 1.45; }
.wf-dialog textarea { width: 100%; min-height: 110px; resize: vertical; padding: 10px; border-radius: 10px; border: 1px solid var(--color-border, rgba(255,255,255,.12));
  background: var(--color-surface-light, #27272a); color: inherit; font: 12px ui-monospace, SFMono-Regular, Menlo, monospace; word-break: break-all; }
.wf-dialog .wf-actions { display: flex; justify-content: flex-end; gap: 8px; }
.wf-dialog .wf-error { color: #f87171; font-size: 12px; min-height: 1em; }
.wf-swatches { display: flex; flex-wrap: wrap; gap: 6px; padding: 10px; }
.wf-swatches button { width: 24px; height: 24px; border-radius: 50%; border: 2px solid transparent; cursor: pointer; padding: 0; }
.wf-swatches button.on { border-color: #fff; }
.wf-selbar { position: fixed; left: 50%; bottom: 20px; transform: translateX(-50%); z-index: 2147483640; display: flex; align-items: center; gap: 12px; padding: 8px 8px 8px 16px;
  border-radius: 14px; border: 1px solid rgba(249,115,22,.4); background: var(--color-surface, #18181b); color: var(--color-foreground, #e7e5e4); box-shadow: 0 16px 48px rgba(0,0,0,.5);
  font-size: 13px; font-weight: 600; animation: wf-in .15s ease; }
.wf-modal-add { margin-left: 8px; vertical-align: middle; }
@keyframes wf-in { from { opacity: 0; transform: translateY(4px); } }
`;

export function ensureFamilyStyle(): void {
  if (document.getElementById('wiky-fam-style')) return;
  const style = document.createElement('style');
  style.id = 'wiky-fam-style';
  style.setAttribute('data-wiky', 'style');
  style.textContent = CSS;
  (document.head ?? document.documentElement).append(style);
}

/** Les fenêtres du site se ferment au clic à l'extérieur : un clic dans les nôtres ne doit pas les fermer. */
function isolate(node: HTMLElement): void {
  for (const type of ['click', 'mousedown', 'pointerdown']) node.addEventListener(type, (e) => e.stopPropagation());
}

// ---------------------------------------------------------------- cartes

export function rarityColor(r: Rarity | null): string {
  return `var(--color-rarity-${(r ?? 'C').toLowerCase()}, #9ca3af)`;
}

export function rarityImage(r: Rarity | null): string {
  return `/${RARITIES[r ?? 'C'].image}.png`;
}

export interface CardView {
  card: CatalogCard;
  owned: number;
  price: number | null;
  cover?: boolean;
  /** Boutons d'action (data-act) au survol. */
  actions?: { act: string; title: string; icon: string; danger?: boolean }[];
}

/** Carte au format natif du site, en une chaîne (rendu en lot, un seul innerHTML). */
export function cardHtml(v: CardView): string {
  const c = v.card;
  const r = c.rarity ?? 'C';
  const art = c.imageUrl
    ? `<img src="${esc(c.imageUrl)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">`
    : '<img class="wf-logo" src="/logo.png" alt="" loading="lazy" decoding="async">';
  const acts = v.actions?.length
    ? `<div class="wf-acts">${v.actions.map((a) => `<button type="button" data-act="${a.act}" title="${esc(a.title)}" aria-label="${esc(a.title)}"${a.danger ? ' class="danger"' : ''}>${icon(a.icon, 15)}</button>`).join('')}</div>`
    : '';
  return `<div class="wf-card glow-${r.toLowerCase()}${v.owned ? '' : ' missing'}" data-id="${esc(c.siteId)}" title="${esc(c.title)}${v.owned ? '' : ' (manquante)'}" style="background-image:url(${rarityImage(r)})">`
    + `<div class="wf-art">${art}</div>`
    + `<span class="wf-rar" style="background:${rarityColor(r)}">${r}</span>`
    + `<span class="wf-own${v.owned ? '' : ' no'}">${v.owned ? (v.owned > 1 ? `×${v.owned}` : '✓') : '✗'}</span>`
    + (v.cover ? `<span class="wf-cover-mark" title="Couverture">${icon('star', 14)}</span>` : '')
    + acts
    + `<div class="wf-text"><h3>${esc(c.title)}</h3><p>${esc(c.category)}</p><div class="wf-foot"><span>${v.price != null ? `≈ ${money(v.price)}` : '<span style="opacity:.55">sans prix</span>'}</span></div></div>`
    + '</div>';
}

// ---------------------------------------------------------------- menu « Ajouter à une famille »

let popCleanup: (() => void) | null = null;

export function closePopover(): void {
  popCleanup?.();
  popCleanup = null;
}

function place(pop: HTMLElement, anchor: HTMLElement): void {
  const r = anchor.getBoundingClientRect();
  const h = Math.min(360, pop.offsetHeight || 300);
  const below = r.bottom + 6 + h < innerHeight || r.top < h + 6;
  pop.style.top = `${Math.max(6, below ? r.bottom + 6 : r.top - 6 - h)}px`;
  pop.style.left = `${Math.max(6, Math.min(innerWidth - 330, r.left))}px`;
}

function popover(anchor: HTMLElement, build: (pop: HTMLElement) => void): HTMLElement {
  closePopover();
  ensureFamilyStyle();
  const pop = el('div', { 'data-wiky': 'fam-pop', class: 'wf-pop', role: 'menu' });
  build(pop);
  isolate(pop);
  document.body.append(pop);
  place(pop, anchor);
  const onDown = (e: Event) => {
    if (!pop.contains(e.target as Node) && !anchor.contains(e.target as Node)) closePopover();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') closePopover();
  };
  setTimeout(() => document.addEventListener('mousedown', onDown, true));
  document.addEventListener('keydown', onKey);
  popCleanup = () => {
    document.removeEventListener('mousedown', onDown, true);
    document.removeEventListener('keydown', onKey);
    pop.remove();
  };
  return pop;
}

/**
 * Menu des familles sous `anchor` : choisir une famille, ou « Nouvelle famille… » (`onPick(null)`).
 * Avec beaucoup de familles, un champ filtre la liste au fil de la frappe.
 */
export function openFamilyPicker(anchor: HTMLElement, families: CardFamily[], onPick: (f: CardFamily | null) => void, opts: { exclude?: string; title?: string } = {}): void {
  popover(anchor, (pop) => {
    const list = el('div', { class: 'wf-pop-list' });
    const shown = families.filter((f) => f.id !== opts.exclude).sort((a, b) => b.updatedAt - a.updatedAt);
    const draw = (q: string) => {
      const n = q.trim().toLowerCase();
      list.replaceChildren();
      for (const f of shown) {
        if (n && !f.name.toLowerCase().includes(n)) continue;
        const b = el('button', { type: 'button', class: 'wf-pop-item', role: 'menuitem' },
          `<span class="wf-dot" style="background:${esc(f.color)}"></span><span class="wf-grow">${esc(f.name)}</span><small>${f.cards.length}</small>`);
        b.addEventListener('click', () => {
          closePopover();
          onPick(f);
        });
        list.append(b);
      }
      const add = el('button', { type: 'button', class: 'wf-pop-item new', role: 'menuitem' }, `${icon('plus', 15)}<span class="wf-grow">Nouvelle famille…</span>`);
      add.addEventListener('click', () => {
        closePopover();
        onPick(null);
      });
      list.append(add);
    };
    if (shown.length > 6) {
      const input = el('input', { class: 'wf-input', type: 'search', placeholder: opts.title ?? 'Filtrer les familles…', 'aria-label': 'Filtrer les familles' });
      input.addEventListener('input', () => draw(input.value));
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') list.querySelector<HTMLButtonElement>('.wf-pop-item')?.click();
      });
      pop.append(input);
      setTimeout(() => input.focus());
    }
    draw('');
    pop.append(list);
  });
}

/** Palette de couleurs sous `anchor`. */
export function openColorPicker(anchor: HTMLElement, palette: string[], current: string, onPick: (color: string) => void): void {
  popover(anchor, (pop) => {
    const box = el('div', { class: 'wf-swatches' });
    for (const c of palette) {
      const b = el('button', { type: 'button', title: c, 'aria-label': `Couleur ${c}`, class: c === current ? 'on' : '', style: `background:${c}` });
      b.addEventListener('click', () => {
        closePopover();
        onPick(c);
      });
      box.append(b);
    }
    const custom = el('input', { type: 'color', value: /^#[0-9a-f]{6}$/i.test(current) ? current : '#f97316', title: 'Autre couleur', style: 'width:28px;height:28px;border:0;padding:0;background:none;cursor:pointer' });
    custom.addEventListener('change', () => {
      closePopover();
      onPick(custom.value);
    });
    box.append(custom);
    pop.append(box);
  });
}

// ---------------------------------------------------------------- boîtes de dialogue

function dialog(build: (box: HTMLElement, close: () => void) => void, onClose: () => void): void {
  ensureFamilyStyle();
  const overlay = el('div', { 'data-wiky': 'fam-dialog', class: 'wf-overlay' });
  const box = el('div', { class: 'wf-dialog', role: 'dialog', 'aria-modal': 'true' });
  overlay.append(box);
  isolate(overlay);
  const close = () => {
    document.removeEventListener('keydown', onKey, true);
    overlay.remove();
    onClose();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
    }
  };
  overlay.addEventListener('mousedown', (e) => {
    if (e.target === overlay) close();
  });
  document.addEventListener('keydown', onKey, true);
  build(box, close);
  document.body.append(overlay);
}

/** Confirmation dans le style du site (au lieu de window.confirm). */
export function confirmDialog(title: string, message: string, opts: { ok?: string; danger?: boolean } = {}): Promise<boolean> {
  return new Promise((resolve) => {
    let result = false;
    dialog((box, close) => {
      box.innerHTML = `<h2>${esc(title)}</h2><p>${esc(message)}</p><div class="wf-actions"><button type="button" class="wf-btn ghost" data-r="0">Annuler</button><button type="button" class="wf-btn primary" data-r="1"${opts.danger ? ' style="background:#dc2626"' : ''}>${esc(opts.ok ?? 'Confirmer')}</button></div>`;
      box.addEventListener('click', (e) => {
        const r = (e.target as Element).closest<HTMLElement>('[data-r]')?.dataset.r;
        if (r == null) return;
        result = r === '1';
        close();
      });
      setTimeout(() => box.querySelector<HTMLButtonElement>('[data-r="1"]')?.focus());
    }, () => resolve(result));
  });
}

/** Saisie d'un texte (nom de famille…). */
export function promptDialog(title: string, opts: { value?: string; placeholder?: string; ok?: string } = {}): Promise<string | null> {
  return new Promise((resolve) => {
    let result: string | null = null;
    dialog((box, close) => {
      box.innerHTML = `<h2>${esc(title)}</h2><input class="wf-input" maxlength="120" style="width:100%" placeholder="${esc(opts.placeholder ?? '')}"><div class="wf-actions"><button type="button" class="wf-btn ghost" data-r="0">Annuler</button><button type="button" class="wf-btn primary" data-r="1">${esc(opts.ok ?? 'Valider')}</button></div>`;
      const input = box.querySelector('input')!;
      input.value = opts.value ?? '';
      const done = (ok: boolean) => {
        if (ok && !input.value.trim()) return input.focus();
        result = ok ? input.value.trim() : null;
        close();
      };
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') done(true);
      });
      box.addEventListener('click', (e) => {
        const r = (e.target as Element).closest<HTMLElement>('[data-r]')?.dataset.r;
        if (r != null) done(r === '1');
      });
      setTimeout(() => {
        input.focus();
        input.select();
      });
    }, () => resolve(result));
  });
}

/** Affiche un code de partage (copie en un clic). */
export function showCodeDialog(title: string, code: string, hint: string): void {
  dialog((box, close) => {
    box.innerHTML = `<h2>${esc(title)}</h2><p>${esc(hint)}</p><textarea readonly></textarea><div class="wf-actions"><button type="button" class="wf-btn ghost" data-r="0">Fermer</button><button type="button" class="wf-btn primary" data-r="copy">Copier</button></div>`;
    const area = box.querySelector('textarea')!;
    area.value = code;
    box.addEventListener('click', async (e) => {
      const r = (e.target as Element).closest<HTMLElement>('[data-r]');
      if (!r) return;
      if (r.dataset.r === '0') return close();
      area.select();
      try {
        await navigator.clipboard.writeText(code);
      } catch {
        document.execCommand?.('copy');
      }
      r.textContent = 'Copié ✓';
    });
    setTimeout(() => area.select());
  }, () => undefined);
}

/** Demande un code de partage et le valide avec `accept` (qui lève une erreur lisible si le code est mauvais). */
export function importCodeDialog(accept: (code: string) => Promise<string>): void {
  dialog((box, close) => {
    box.innerHTML = `<h2>Importer une famille</h2><p>Colle un code de famille (commençant par F0. ou F1.).</p><textarea placeholder="F1.…"></textarea><div class="wf-error" role="alert"></div><div class="wf-actions"><button type="button" class="wf-btn ghost" data-r="0">Annuler</button><button type="button" class="wf-btn primary" data-r="1">Importer</button></div>`;
    const area = box.querySelector('textarea')!;
    const err = box.querySelector<HTMLElement>('.wf-error')!;
    box.addEventListener('click', async (e) => {
      const r = (e.target as Element).closest<HTMLButtonElement>('[data-r]');
      if (!r) return;
      if (r.dataset.r === '0') return close();
      r.disabled = true;
      try {
        err.textContent = '';
        await accept(area.value);
        close();
      } catch (ex) {
        err.textContent = (ex as Error).message;
        r.disabled = false;
      }
    });
    setTimeout(() => area.focus());
  }, () => undefined);
}
