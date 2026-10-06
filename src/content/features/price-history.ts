/**
 * Page d'une enchère (`/marketplace/<id>`) : sous l'historique des mises, une section dépliable « Historique des
 * prix » : chiffres clés de la carte (ventes, moyenne, médiane, extrêmes, dernière vente, tendance 30 j, taux de
 * vente, gain moyen) et graphique de l'évolution du prix (une vente = un point coloré selon la rareté, moyenne
 * glissante, mise actuelle en pointillé), filtres de rareté et de période, liste des ventes.
 * Données : toutes les enchères terminées de la carte (une requête paginée), mises en cache 5 min.
 */
import { formatDuration, RARITIES as RARITY_INFO } from '../../lib/text';
import type { Rarity } from '../../lib/types';
import { auctionInfo, cardSalesHistory, type AuctionInfo, type CardSale } from '../catalog';
import { filterSales, historyStats, niceTicks, rollingMean, type HistoryFilter } from './price-history-logic';
import { registerFeature } from './runtime';

const AUCTION_RE = /^\/marketplace\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/?$/i;
const OPEN_KEY = 'wiky-price-history-open';
const ORDER: Rarity[] = ['C', 'PC', 'R', 'SR', 'UR', 'L'];
/** Couleur de rareté du site (variables CSS du site), avec une valeur de secours distincte par rareté. */
const RARITY_FALLBACK: Record<Rarity, string> = { C: '#9ca3af', PC: '#22c55e', R: '#3b82f6', SR: '#a855f7', UR: '#ef4444', L: '#f59e0b' };
const rarityColor = (r: Rarity | null) => (r ? `var(--color-rarity-${r.toLowerCase()}, ${RARITY_FALLBACK[r]})` : '#9ca3af');

const CSS = `
[data-wiky="price-history"] { width: 80%; max-width: 980px; margin: 16px auto 0; box-sizing: border-box; border-radius: 16px; border: 1px solid var(--color-border); background: var(--color-surface); color: var(--color-foreground); }
[data-wiky="price-history"] > summary { list-style: none; cursor: pointer; display: flex; align-items: center; gap: 10px; padding: 12px 16px; font-weight: 700; font-size: 15px; }
[data-wiky="price-history"] > summary::-webkit-details-marker { display: none; }
[data-wiky="price-history"] > summary .ph-ico { display: inline-grid; place-items: center; width: 28px; height: 28px; border-radius: 8px; background: rgba(249,115,22,.14); color: #fb923c; }
[data-wiky="price-history"] > summary .ph-sub { font-weight: 500; font-size: 12px; color: color-mix(in srgb, var(--color-foreground) 50%, transparent); }
[data-wiky="price-history"] > summary .ph-chev { margin-left: auto; transition: transform .2s ease; opacity: .5; }
[data-wiky="price-history"][open] > summary .ph-chev { transform: rotate(90deg); }
.ph-body { padding: 0 16px 16px; display: flex; flex-direction: column; gap: 12px; }
.ph-filters { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.ph-filters .ph-sep { width: 1px; height: 18px; background: var(--color-border); margin: 0 4px; }
.ph-chip { padding: 4px 10px; border-radius: 999px; cursor: pointer; font: inherit; font-size: 12px; font-weight: 600; border: 1px solid var(--color-border);
  background: var(--color-surface-light, var(--color-surface)); color: color-mix(in srgb, var(--color-foreground) 70%, transparent); display: inline-flex; align-items: center; gap: 6px; }
.ph-chip[aria-pressed="true"] { border-color: rgba(249,115,22,.5); background: rgba(249,115,22,.12); color: #fdba74; }
.ph-chip i { width: 8px; height: 8px; border-radius: 50%; }
.ph-tiles { display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 8px; }
.ph-tile { padding: 8px 10px; border-radius: 12px; background: var(--color-surface-light, var(--color-surface)); border: 1px solid var(--color-border); }
.ph-tile small { display: block; font-size: 10.5px; text-transform: uppercase; letter-spacing: .04em; color: color-mix(in srgb, var(--color-foreground) 50%, transparent); }
.ph-tile b { display: block; font-size: 16px; font-variant-numeric: tabular-nums; margin-top: 2px; }
.ph-tile span { font-size: 11px; color: color-mix(in srgb, var(--color-foreground) 55%, transparent); }
.ph-up { color: #4ade80; } .ph-down { color: #f87171; }
.ph-chart { position: relative; }
.ph-chart svg { display: block; width: 100%; height: 240px; overflow: visible; }
.ph-chart .grid line { stroke: color-mix(in srgb, var(--color-foreground) 9%, transparent); }
.ph-chart .axis text { fill: color-mix(in srgb, var(--color-foreground) 50%, transparent); font-size: 10.5px; font-variant-numeric: tabular-nums; }
.ph-chart .avg { fill: none; stroke: #f97316; stroke-width: 2; stroke-linejoin: round; stroke-linecap: round; }
.ph-chart .cur { stroke: var(--color-foreground); stroke-width: 1.5; stroke-dasharray: 4 4; opacity: .55; }
.ph-chart .cur-label { fill: var(--color-foreground); font-size: 10.5px; opacity: .75; }
.ph-chart .dot { stroke: var(--color-surface); stroke-width: 2; }
.ph-chart .dot.dim { opacity: .35; }
.ph-chart .hit { fill: transparent; cursor: default; }
.ph-tip { position: absolute; pointer-events: none; transform: translate(-50%, calc(-100% - 10px)); padding: 6px 9px; border-radius: 8px; font-size: 11.5px; white-space: nowrap;
  background: var(--color-background, #0c0d0c); border: 1px solid var(--color-border); box-shadow: 0 6px 20px rgba(0,0,0,.4); }
.ph-tip b { font-variant-numeric: tabular-nums; }
.ph-legend { display: flex; flex-wrap: wrap; gap: 12px; font-size: 11.5px; color: color-mix(in srgb, var(--color-foreground) 65%, transparent); }
.ph-legend span { display: inline-flex; align-items: center; gap: 6px; }
.ph-legend i { width: 9px; height: 9px; border-radius: 50%; }
.ph-legend .ln { width: 16px; height: 2px; border-radius: 2px; background: #f97316; }
.ph-legend .dash { width: 16px; height: 0; border-top: 1.5px dashed var(--color-foreground); opacity: .6; }
.ph-empty { padding: 16px; text-align: center; color: color-mix(in srgb, var(--color-foreground) 50%, transparent); }
.ph-table { max-height: 240px; overflow: auto; }
.ph-table table { width: 100%; border-collapse: collapse; font-size: 12px; font-variant-numeric: tabular-nums; }
.ph-table th, .ph-table td { text-align: left; padding: 5px 6px; border-bottom: 1px solid var(--color-border); }
.ph-table th { font-weight: 600; color: color-mix(in srgb, var(--color-foreground) 55%, transparent); position: sticky; top: 0; background: var(--color-surface); }
@media (max-width: 900px) { [data-wiky="price-history"] { width: 100%; } }
.ph-body details > summary { cursor: pointer; font-size: 12px; color: color-mix(in srgb, var(--color-foreground) 65%, transparent); }
`;

let current: string | null = null;
let info: AuctionInfo | null = null;
let sales: CardSale[] | null = null;
let error: string | null = null;
let filter: HistoryFilter = { rarity: null, days: null };
let resizeObs: ResizeObserver | null = null;

function ensureStyle(): void {
  if (document.getElementById('wiky-price-history-style')) return;
  const s = document.createElement('style');
  s.id = 'wiky-price-history-style';
  s.setAttribute('data-wiky', 'style');
  s.textContent = CSS;
  (document.head ?? document.documentElement).append(s);
}

const w = (n: number | null | undefined) => (n == null ? '—' : `${Math.round(n).toLocaleString('fr-FR')} W`);
const dateFr = (t: number) => new Date(t).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit' });
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** Où placer la section : sous le bloc « Historique des mises / enchères » du site, sinon à la fin du contenu. */
function anchor(): { parent: Element; after: Element | null } | null {
  const main = document.querySelector('main');
  if (!main) return null;
  const heading = [...main.querySelectorAll('h1, h2, h3, h4, p, span, div')].find(
    (el) => !el.closest('[data-wiky]') && el.children.length <= 2 && /^\s*historique\s+des\s+(mises|ench[eè]res|offres)/i.test(el.textContent ?? ''),
  );
  if (heading) {
    // Le bloc de l'historique : l'ancêtre « carte » le plus proche, sinon le parent du titre.
    const block = heading.closest('.card-frame, section, [class*="rounded"]') ?? heading.parentElement;
    if (block?.parentElement) return { parent: block.parentElement, after: block };
  }
  const col = main.querySelector('h1')?.closest('div.flex-1, div[class*="space-y"]') ?? main.firstElementChild ?? main;
  return { parent: col, after: null };
}

function summaryText(): string {
  if (error) return 'indisponible';
  if (!sales) return 'chargement…';
  const s = historyStats(filterSales(sales, { rarity: info?.rarity ?? null, days: null }));
  return s.sold ? `${s.sold} vente${s.sold > 1 ? 's' : ''}${info?.rarity ? ` en ${info.rarity}` : ''} · moyenne ${w(s.mean)}` : 'aucune vente conclue';
}

function tilesHtml(): string {
  const rows = filterSales(sales ?? [], filter);
  const s = historyStats(rows);
  const trend = s.trend30 == null ? '<b>—</b><span>pas assez de ventes</span>' : `<b class="${s.trend30 >= 0 ? 'ph-up' : 'ph-down'}">${s.trend30 > 0 ? '+' : ''}${s.trend30} %</b><span>30 j vs 30 j avant</span>`;
  const cur = info?.current;
  const vsMean = cur != null && s.mean ? Math.round(((cur - s.mean) / s.mean) * 100) : null;
  const tile = (label: string, value: string, sub = '') => `<div class="ph-tile"><small>${label}</small>${value}${sub ? `<span>${sub}</span>` : ''}</div>`;
  return [
    tile('Ventes', `<b>${s.sold}</b>`, `${s.unsold} invendue${s.unsold > 1 ? 's' : ''}`),
    tile('Moyenne', `<b>${w(s.mean)}</b>`, `médiane ${w(s.median)}`),
    tile('Plus bas · haut', `<b>${w(s.min)}</b>`, `jusqu'à ${w(s.max)}`),
    tile('Dernière vente', `<b>${w(s.last?.price)}</b>`, s.last ? `il y a ${formatDuration(Date.now() - s.last.at)}` : ''),
    `<div class="ph-tile"><small>Tendance</small>${trend}</div>`,
    tile('Taux de vente', `<b>${s.sellRate == null ? '—' : `${s.sellRate} %`}</b>`, s.avgGainPct == null ? '' : `gain moyen ${s.avgGainPct > 0 ? '+' : ''}${s.avgGainPct} % sur le départ`),
    cur != null ? tile('Cette enchère', `<b>${w(cur)}</b>`, vsMean == null ? (info?.hasBid ? 'mise actuelle' : 'mise de départ') : `${vsMean > 0 ? '+' : ''}${vsMean} % vs moyenne`) : '',
  ].join('');
}

/** Graphique : un point par vente (couleur = rareté), moyenne glissante, mise actuelle. */
function chartSvg(width: number): string {
  const all = filterSales(sales ?? [], { rarity: null, days: filter.days });
  const sold = all.filter((r) => r.sold && r.price != null);
  const focus = filterSales(sales ?? [], filter).filter((r) => r.sold);
  if (!sold.length) return '';
  const H = 240;
  const pad = { l: 44, r: 12, t: 12, b: 24 };
  const now = Date.now();
  const t0 = Math.min(...sold.map((r) => r.at));
  const t1 = Math.max(now, ...sold.map((r) => r.at));
  const span = Math.max(t1 - t0, 86_400_000);
  const maxY = Math.max(...sold.map((r) => r.price!), info?.current ?? 0) * 1.08;
  const ticks = niceTicks(maxY);
  const top = ticks[ticks.length - 1] || 1;
  const x = (t: number) => pad.l + ((t - t0) / span) * (width - pad.l - pad.r);
  const y = (v: number) => pad.t + (1 - v / top) * (H - pad.t - pad.b);
  const grid = ticks.map((v) => `<line x1="${pad.l}" x2="${width - pad.r}" y1="${y(v)}" y2="${y(v)}"/>`).join('');
  const ylabels = ticks.map((v) => `<text x="${pad.l - 6}" y="${y(v) + 3.5}" text-anchor="end">${v.toLocaleString('fr-FR')}</text>`).join('');
  const xticks = [0, 1 / 3, 2 / 3, 1].map((f) => t0 + f * span);
  const xlabels = xticks.map((t, i) => `<text x="${x(t)}" y="${H - 6}" text-anchor="${i === 0 ? 'start' : i === 3 ? 'end' : 'middle'}">${dateFr(t)}</text>`).join('');
  const dots = sold
    .map((r) => {
      const dim = filter.rarity && r.rarity !== filter.rarity ? ' dim' : '';
      return `<circle class="dot${dim}" cx="${x(r.at).toFixed(1)}" cy="${y(r.price!).toFixed(1)}" r="${r.shiny ? 5 : 4}" fill="${rarityColor(r.rarity)}"/>`;
    })
    .join('');
  const avgPts = rollingMean(focus);
  const avg = avgPts.length > 1 ? `<polyline class="avg" points="${avgPts.map((p) => `${x(p.at).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ')}"/>` : '';
  const cur =
    info?.current != null
      ? `<line class="cur" x1="${pad.l}" x2="${width - pad.r}" y1="${y(info.current)}" y2="${y(info.current)}"/><text class="cur-label" x="${width - pad.r}" y="${y(info.current) - 5}" text-anchor="end">cette enchère ${w(info.current)}</text>`
      : '';
  // Zones de survol plus larges que les points.
  const hits = sold.map((r, i) => `<circle class="hit" data-i="${i}" cx="${x(r.at).toFixed(1)}" cy="${y(r.price!).toFixed(1)}" r="10"/>`).join('');
  return `<svg viewBox="0 0 ${width} ${H}" role="img" aria-label="Évolution du prix de vente de la carte">
    <g class="grid">${grid}</g><g class="axis">${ylabels}${xlabels}</g>${avg}${cur}<g>${dots}</g><g>${hits}</g></svg><div class="ph-tip" hidden></div>`;
}

function filtersHtml(): string {
  const present = ORDER.filter((r) => sales?.some((s) => s.rarity === r && s.sold));
  const chip = (attr: string, label: string, on: boolean, dot?: string) =>
    `<button type="button" class="ph-chip" ${attr} aria-pressed="${on}">${dot ? `<i style="background:${dot}"></i>` : ''}${label}</button>`;
  const rar = [chip('data-rarity=""', 'Toutes raretés', !filter.rarity), ...present.map((r) => chip(`data-rarity="${r}"`, RARITY_INFO[r].label, filter.rarity === r, rarityColor(r)))];
  const per = ([[30, '30 j'], [90, '90 j'], [null, 'Tout']] as const).map(([d, l]) => chip(`data-days="${d ?? ''}"`, l, filter.days === d));
  return `${rar.join('')}<span class="ph-sep"></span>${per.join('')}`;
}

function legendHtml(): string {
  const present = ORDER.filter((r) => filterSales(sales ?? [], { rarity: null, days: filter.days }).some((s) => s.rarity === r && s.sold));
  return [
    ...present.map((r) => `<span><i style="background:${rarityColor(r)}"></i>${RARITY_INFO[r].label}</span>`),
    '<span><span class="ln"></span>moyenne glissante (5 ventes)</span>',
    info?.current != null ? '<span><span class="dash"></span>cette enchère</span>' : '',
    '<span>✨ point plus gros : brillante</span>',
  ].join('');
}

function tableHtml(): string {
  const rows = filterSales(sales ?? [], filter).slice().reverse();
  if (!rows.length) return '';
  return `<details><summary>Voir les ${rows.length} enchère${rows.length > 1 ? 's' : ''} terminée${rows.length > 1 ? 's' : ''}</summary><div class="ph-table"><table>
    <thead><tr><th>Date</th><th>Rareté</th><th>Départ</th><th>Prix final</th></tr></thead><tbody>${rows
      .map((r) => `<tr><td>${dateFr(r.at)}</td><td>${r.rarity ?? '—'}${r.shiny ? ' ✨' : ''}</td><td>${w(r.start)}</td><td>${r.sold ? w(r.price) : 'invendue'}</td></tr>`)
      .join('')}</tbody></table></div></details>`;
}

function bodyHtml(width: number): string {
  if (error) return `<div class="ph-empty">Historique indisponible (${esc(error)}).</div>`;
  if (!sales) return '<div class="ph-empty">Chargement des ventes de la carte…</div>';
  if (!sales.some((s) => s.sold)) return `<div class="ph-empty">Cette carte n'a encore jamais été vendue${sales.length ? ` (${sales.length} enchère${sales.length > 1 ? 's' : ''} sans acheteur)` : ''}.</div>`;
  const chart = chartSvg(width);
  return `<div class="ph-filters">${filtersHtml()}</div><div class="ph-tiles">${tilesHtml()}</div>
    ${chart ? `<div class="ph-chart">${chart}</div><div class="ph-legend">${legendHtml()}</div>` : '<div class="ph-empty">Aucune vente sur cette période.</div>'}
    ${tableHtml()}`;
}

function bindBody(box: HTMLDetailsElement): void {
  const body = box.querySelector<HTMLElement>('.ph-body')!;
  body.querySelectorAll<HTMLButtonElement>('[data-rarity]').forEach((b) =>
    b.addEventListener('click', () => {
      filter = { ...filter, rarity: (b.dataset.rarity || null) as Rarity | null };
      paintBody(box);
    }),
  );
  body.querySelectorAll<HTMLButtonElement>('[data-days]').forEach((b) =>
    b.addEventListener('click', () => {
      filter = { ...filter, days: b.dataset.days ? Number(b.dataset.days) : null };
      paintBody(box);
    }),
  );
  // Info-bulle au survol d'une vente.
  const chart = body.querySelector<HTMLElement>('.ph-chart');
  const tip = chart?.querySelector<HTMLElement>('.ph-tip');
  if (!chart || !tip) return;
  const sold = filterSales(sales ?? [], { rarity: null, days: filter.days }).filter((r) => r.sold && r.price != null);
  chart.addEventListener('mousemove', (e) => {
    const hit = (e.target as Element).closest<SVGCircleElement>('.hit');
    if (!hit) {
      tip.hidden = true;
      return;
    }
    const r = sold[Number(hit.dataset.i)];
    if (!r) return;
    const box2 = chart.getBoundingClientRect();
    const c = hit.getBoundingClientRect();
    tip.innerHTML = `<b>${w(r.price)}</b> · ${r.rarity ? RARITY_INFO[r.rarity].label : '—'}${r.shiny ? ' ✨' : ''}<br>${dateFr(r.at)}${r.start != null ? ` · départ ${w(r.start)}` : ''}`;
    tip.style.left = `${c.left + c.width / 2 - box2.left}px`;
    tip.style.top = `${c.top - box2.top}px`;
    tip.hidden = false;
  });
  chart.addEventListener('mouseleave', () => (tip.hidden = true));
}

function paintBody(box: HTMLDetailsElement): void {
  const body = box.querySelector<HTMLElement>('.ph-body')!;
  const width = Math.max(320, Math.round(body.clientWidth || 640) - 0);
  body.innerHTML = bodyHtml(width);
  bindBody(box);
}

function paint(): void {
  const existing = document.querySelector<HTMLDetailsElement>('[data-wiky="price-history"]');
  if (!current) {
    existing?.remove();
    return;
  }
  const place = anchor();
  if (!place) return;
  ensureStyle();
  const key = JSON.stringify([current, !!sales, error, info?.current, sales?.length]);
  let box = existing;
  if (!box) {
    box = document.createElement('details');
    box.setAttribute('data-wiky', 'price-history');
    box.open = localStorageGet(OPEN_KEY) !== '0';
    box.innerHTML = `<summary><span class="ph-ico"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/></svg></span><span>Historique des prix <span class="ph-sub"></span></span><svg class="ph-chev" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m9 18 6-6-6-6"/></svg></summary><div class="ph-body"></div>`;
    box.addEventListener('toggle', () => {
      localStorageSet(OPEN_KEY, box!.open ? '1' : '0');
      if (box!.open) paintBody(box!);
    });
    resizeObs?.disconnect();
    if (typeof ResizeObserver !== 'undefined') {
      // Largeur du graphique : redessiné quand la page change de taille.
      resizeObs = new ResizeObserver(() => box!.open && sales && paintBody(box!));
      resizeObs.observe(box);
    }
  }
  // Toujours juste après le bloc d'historique du site (React peut avoir redessiné la page).
  const misplaced = place.after ? box.previousElementSibling !== place.after : box.parentElement !== place.parent;
  if (misplaced) {
    if (place.after) place.after.after(box);
    else place.parent.append(box);
  }
  if (box.dataset.key === key) return;
  box.dataset.key = key;
  box.querySelector('.ph-sub')!.textContent = `· ${summaryText()}`;
  if (box.open) paintBody(box);
}

function localStorageGet(k: string): string | null {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
}
function localStorageSet(k: string, v: string): void {
  try {
    localStorage.setItem(k, v);
  } catch {
    // Préférence non mémorisée.
  }
}

async function load(auctionId: string): Promise<void> {
  try {
    const i = await auctionInfo(auctionId);
    if (current !== auctionId) return;
    if (!i) throw new Error('enchère introuvable');
    info = i;
    // Par défaut : la rareté de cette enchère (comme la moyenne du site).
    filter = { rarity: i.rarity, days: null };
    paint();
    const list = await cardSalesHistory(i.cardId);
    if (current !== auctionId) return;
    sales = list;
    if (filter.rarity && !list.some((s) => s.rarity === filter.rarity && s.sold)) filter = { ...filter, rarity: null };
  } catch (e) {
    if (current === auctionId) error = (e as Error).message;
  }
  paint();
}

function stop(): void {
  current = null;
  info = null;
  sales = null;
  error = null;
  resizeObs?.disconnect();
  resizeObs = null;
  document.querySelector('[data-wiky="price-history"]')?.remove();
}

registerFeature({
  keys: ['marketplacePrice'],
  needsApi: true,
  render(ctx) {
    const id = ctx.path.match(AUCTION_RE)?.[1] ?? null;
    if (!id) {
      if (current) stop();
      return;
    }
    if (id !== current) {
      stop();
      current = id;
      void load(id);
    }
    paint();
  },
  cleanup: stop,
});

/** Pour les tests. */
export function priceHistoryState(): { current: string | null; sales: CardSale[] | null; filter: HistoryFilter } {
  return { current, sales, filter };
}
