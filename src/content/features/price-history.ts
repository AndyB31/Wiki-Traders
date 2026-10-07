/**
 * Page d'une enchère (`/marketplace/<id>`) : sous l'historique des mises, une section dépliable « Historique des
 * prix » : chiffres clés de la carte (ventes, moyenne, médiane, extrêmes, dernière vente, tendance 30 j, taux de
 * vente, gain moyen) et graphique de l'évolution du prix (une vente = un point coloré selon la rareté, moyenne
 * glissante, mise actuelle en pointillé), filtres de rareté et de période, liste des ventes.
 * Données : toutes les enchères terminées de la carte (une requête paginée), mises en cache 5 min.
 * La section est aussi affichée sous la fenêtre « Mettre aux enchères » (voir `sell-market.ts`) : `PriceHistoryPanel`.
 */
import { formatDuration } from '../../lib/text';
import { auctionInfo, cardSalesHistory, type AuctionInfo, type CardSale } from '../catalog';
import { candles, filterSales, historyStats, niceTicks, rollingMeanByTime, saleLine, type HistoryFilter, type OutcomeFilter } from './price-history-logic';
import { bindTips, hideTip } from './dom';
import { registerFeature } from './runtime';

const AUCTION_RE = /^\/marketplace\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/?$/i;
const OPEN_KEY = 'wiky-price-history-open';
/** Ventes (points, ligne) : bleu ciel, bien distinct de l'orange de la moyenne glissante, quelle que soit la rareté. */
const SALES_COLOR = '#38bdf8';

const CSS = `
.wiky-ph { width: 80%; max-width: 980px; margin: 16px auto 0; box-sizing: border-box; border-radius: 16px; border: 1px solid var(--color-border); background: var(--color-surface); color: var(--color-foreground); }
.wiky-ph > summary { list-style: none; cursor: pointer; display: flex; align-items: center; gap: 10px; padding: 12px 16px; font-weight: 700; font-size: 15px; }
.wiky-ph > summary::-webkit-details-marker { display: none; }
.wiky-ph > summary .ph-ico { display: inline-grid; place-items: center; width: 28px; height: 28px; border-radius: 8px; background: rgba(249,115,22,.14); color: #fb923c; }
.wiky-ph > summary .ph-sub { font-weight: 500; font-size: 12px; color: color-mix(in srgb, var(--color-foreground) 50%, transparent); }
.wiky-ph > summary .ph-chev { margin-left: auto; transition: transform .2s ease; opacity: .5; }
.wiky-ph[open] > summary .ph-chev { transform: rotate(90deg); }
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
.ph-chart .avg { fill: none; stroke: #f97316; stroke-width: 2.5; stroke-linejoin: round; stroke-linecap: round; }
.ph-chart .avg-halo { fill: none; stroke: var(--color-surface); stroke-width: 6; stroke-linejoin: round; stroke-linecap: round; opacity: .9; }
.ph-chart .dot.soft { opacity: .7; }
.ph-chart .sales-line { fill: none; stroke-width: 1.25; stroke-linejoin: round; stroke-linecap: round; opacity: .85; }
.ph-chart .candle line { stroke-width: 1.5; }
.ph-chart .candle.up line, .ph-chart .candle.up rect { stroke: #22c55e; fill: #22c55e; }
.ph-chart .candle.down line, .ph-chart .candle.down rect { stroke: #ef4444; fill: #ef4444; }
.ph-lbl { font-size: 11px; text-transform: uppercase; letter-spacing: .04em; color: color-mix(in srgb, var(--color-foreground) 50%, transparent); margin-right: 2px; }
.ph-chart .cur { stroke: var(--color-foreground); stroke-width: 1.5; stroke-dasharray: 4 4; opacity: .55; }
.ph-chart .cur-label { fill: var(--color-foreground); font-size: 10.5px; opacity: .75; }
.ph-chart .dot { stroke: var(--color-surface); stroke-width: 1; }
.ph-chart .dot.unsold { fill: var(--color-surface); stroke: color-mix(in srgb, var(--color-foreground) 50%, transparent); stroke-width: 1.2; }
.ph-chart .hit { fill: transparent; cursor: default; }
.ph-tip { position: absolute; pointer-events: none; transform: translate(-50%, calc(-100% - 10px)); padding: 6px 9px; border-radius: 8px; font-size: 11.5px; white-space: nowrap;
  background: var(--color-background, #0c0d0c); border: 1px solid var(--color-border); box-shadow: 0 6px 20px rgba(0,0,0,.4); }
.ph-tip b { font-variant-numeric: tabular-nums; }
.ph-legend { display: flex; flex-wrap: wrap; gap: 12px; font-size: 11.5px; color: color-mix(in srgb, var(--color-foreground) 65%, transparent); }
.ph-legend span { display: inline-flex; align-items: center; gap: 6px; }
.ph-legend i { width: 9px; height: 9px; border-radius: 50%; box-sizing: border-box; }
.ph-legend i.sq { border-radius: 2px; } .ph-legend i.sq.up { background: #22c55e; } .ph-legend i.sq.down { background: #ef4444; }
.ph-legend i.hollow { border: 1.5px solid color-mix(in srgb, var(--color-foreground) 55%, transparent); }
.ph-legend .ln { width: 16px; height: 2px; border-radius: 2px; background: #f97316; }
.ph-legend .dash { width: 16px; height: 0; border-top: 1.5px dashed var(--color-foreground); opacity: .6; }
.ph-empty { padding: 16px; text-align: center; color: color-mix(in srgb, var(--color-foreground) 50%, transparent); }
.ph-table { max-height: 240px; overflow: auto; }
.ph-table table { width: 100%; border-collapse: collapse; font-size: 12px; font-variant-numeric: tabular-nums; }
.ph-table th, .ph-table td { text-align: left; padding: 5px 6px; border-bottom: 1px solid var(--color-border); }
.ph-table th { font-weight: 600; color: color-mix(in srgb, var(--color-foreground) 55%, transparent); position: sticky; top: 0; background: var(--color-surface); }
@media (max-width: 900px) { .wiky-ph { width: 100%; } }
.wiky-ph.ph-sell { width: 100%; margin: 0; box-sizing: border-box; }
.wiky-ph.ph-compact .ph-tiles { grid-template-columns: repeat(auto-fill, minmax(88px, 1fr)); gap: 6px; }
.wiky-ph.ph-compact .ph-tile { padding: 5px 8px; border-radius: 10px; }
.wiky-ph.ph-compact .ph-tile b { font-size: 13.5px; }
.wiky-ph.ph-compact .ph-tile small { font-size: 9.5px; }
.ph-tile[data-tip] { cursor: help; }
.ph-body details > summary { cursor: pointer; font-size: 12px; color: color-mix(in srgb, var(--color-foreground) 65%, transparent); }
`;

/** Affichage du graphique et moyenne glissante (jours, 0 = aucune), mémorisés et partagés par toutes les sections. */
type ChartView = 'points' | 'candles' | 'line';
let view: ChartView = (localStorageGet('wiky-ph-view') as ChartView | null) ?? 'points';
/** Fenêtres de la moyenne glissante (jours) et leur libellé. */
const AVG_WINDOWS: [days: number, label: string][] = [[0, 'Aucune'], [2, '2 j'], [5, '5 j'], [7, '7 j'], [14, '2 sem'], [30, '1 mois']];
const savedAvg = Number(localStorageGet('wiky-ph-avg'));
let avgDays = AVG_WINDOWS.some(([d]) => d === savedAvg) && localStorageGet('wiky-ph-avg') != null ? savedAvg : 7;
const avgLabel = (d: number) => AVG_WINDOWS.find(([x]) => x === d)?.[1] ?? `${d} j`;

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

const OUTCOME_LABEL = { sold: 'vendue', unsold: 'sans enchère', cancelled: 'annulée' } as const;

const tipOf = (r: CardSale) =>
  r.sold
    ? `<b>${w(r.price)}</b> · vendue${r.shiny ? ' ✨' : ''}<br>${dateFr(r.at)}${r.start != null ? ` · départ ${w(r.start)}` : ''}`
    : `<b>${w(r.start)}</b> · ${OUTCOME_LABEL[r.outcome ?? 'unsold']} (mise de départ)<br>${dateFr(r.at)}`;

/**
 * Une section « Historique des prix » (élément `<details>`) : son état (ventes, filtres, info-bulles) et son rendu.
 * L'appelant la place dans la page et lui donne les ventes (`setSales`) ou l'erreur (`setError`).
 */
export class PriceHistoryPanel {
  readonly el: HTMLDetailsElement;
  info: AuctionInfo | null = null;
  sales: CardSale[] | null = null;
  error: string | null = null;
  filter: HistoryFilter = { outcome: 'all', days: null };
  /** Texte des info-bulles, dans l'ordre des zones de survol du graphique. */
  private tips: string[] = [];
  private resizeObs: ResizeObserver | null = null;

  /** `wiky`: valeur de `data-wiky` ; `openKey` : clé où l'état replié / déplié est mémorisé. */
  /** `compact` : tuiles plus petites, leurs précisions en info-bulle (fenêtre de vente). */
  constructor(wiky: string, openKey: string, extraClass = '', private readonly compact = false) {
    ensureStyle();
    const box = document.createElement('details');
    this.el = box;
    box.setAttribute('data-wiky', wiky);
    box.className = `wiky-ph ${extraClass}${compact ? ' ph-compact' : ''}`.trim();
    box.open = localStorageGet(openKey) !== '0';
    box.innerHTML = `<summary><span class="ph-ico"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/></svg></span><span>Historique des prix <span class="ph-sub"></span></span><svg class="ph-chev" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m9 18 6-6-6-6"/></svg></summary><div class="ph-body"></div>`;
    bindTips(box);
    box.addEventListener('toggle', () => {
      localStorageSet(openKey, box.open ? '1' : '0');
      if (box.open) this.paintBody();
    });
    if (typeof ResizeObserver !== 'undefined') {
      // Largeur du graphique : redessiné quand la page change de taille.
      this.resizeObs = new ResizeObserver(() => box.open && this.sales && this.paintBody());
      this.resizeObs.observe(box);
    }
  }

  setSales(list: CardSale[]): void {
    this.sales = list;
    this.error = null;
    this.update();
  }

  setError(message: string): void {
    this.error = message;
    this.update();
  }

  /** Repeint le résumé et le contenu si les données ont changé. */
  update(): void {
    const key = JSON.stringify([!!this.sales, this.error, this.info?.current, this.sales?.length]);
    if (this.el.dataset.key === key) return;
    this.el.dataset.key = key;
    this.el.querySelector('.ph-sub')!.textContent = `· ${this.summaryText()}`;
    if (this.el.open) this.paintBody();
  }

  destroy(): void {
    hideTip();
    this.resizeObs?.disconnect();
    this.resizeObs = null;
    this.el.remove();
  }

  private summaryText(): string {
    if (this.error) return 'indisponible';
    if (!this.sales) return 'chargement…';
    const s = historyStats(this.sales);
    if (!s.sold) return 'aucune vente conclue';
    return `${s.sold} vente${s.sold > 1 ? 's' : ''} · moyenne ${w(s.mean)}${s.sellRate == null ? '' : ` · ${s.sellRate} % vendues`}`;
  }

  private rows(): CardSale[] {
    return filterSales(this.sales ?? [], this.filter);
  }

  private tilesHtml(): string {
    const s = historyStats(this.rows());
    const trend = s.trend30 == null ? '<b>—</b>' : `<b class="${s.trend30 >= 0 ? 'ph-up' : 'ph-down'}">${s.trend30 > 0 ? '+' : ''}${s.trend30} %</b>`;
    const cur = this.info?.current;
    const vsMean = cur != null && s.mean ? Math.round(((cur - s.mean) / s.mean) * 100) : null;
    // Précision sous la valeur, ou en info-bulle en mode compact.
    const tile = (label: string, value: string, sub = '') =>
      this.compact
        ? `<div class="ph-tile"${sub ? ` data-tip="${esc(sub)}"` : ''}><small>${label}</small>${value}</div>`
        : `<div class="ph-tile"><small>${label}</small>${value}${sub ? `<span>${sub}</span>` : ''}</div>`;
    return [
      tile('Ventes', `<b>${s.sold}</b>`, `${s.unsold} sans acheteur${s.cancelled ? ` (dont ${s.cancelled} annulée${s.cancelled > 1 ? 's' : ''})` : ''}`),
      tile('Moyenne', `<b>${w(s.mean)}</b>`, `médiane ${w(s.median)}`),
      tile('Plus bas · haut', `<b>${w(s.min)}</b>`, `jusqu'à ${w(s.max)}`),
      tile('Dernière vente', `<b>${w(s.last?.price)}</b>`, s.last ? `il y a ${formatDuration(Date.now() - s.last.at)}` : ''),
      tile('Tendance', trend, s.trend30 == null ? 'pas assez de ventes' : '30 j vs 30 j avant'),
      tile(
        'Taux de vente',
        `<b>${s.sellRate == null ? '—' : `${s.sellRate} %`}</b>`,
        [s.sellRate == null ? '' : `${s.sold} sur ${s.sold + s.unsold} enchères`, s.avgGainPct == null ? '' : `gain moyen ${s.avgGainPct > 0 ? '+' : ''}${s.avgGainPct} % sur le départ`].filter(Boolean).join(' · '),
      ),
      cur != null ? tile('Cette enchère', `<b>${w(cur)}</b>`, vsMean == null ? (this.info?.hasBid ? 'mise actuelle' : 'mise de départ') : `${vsMean > 0 ? '+' : ''}${vsMean} % vs moyenne`) : '',
    ].join('');
  }

  /** Enchères affichées en mode points : vendues (au prix final), sans acheteur / annulées (à la mise de départ). */
  private plotted(): { r: CardSale; v: number }[] {
    return this.rows().flatMap((r) => {
      const v = r.sold ? r.price : r.start;
      return v != null ? [{ r, v }] : [];
    });
  }

  /**
   * Graphique de l'évolution du prix, selon l'affichage choisi :
   *  - points : une vente = un point plein, une enchère sans acheteur = un point vide (mise de départ) ;
   *  - bougies : une bougie par jour (premier, dernier, plus haut, plus bas) ;
   *  - ligne : les ventes reliées (moyenne des ventes d'une même heure).
   * La moyenne glissante (1 à 3 jours) est dessinée par-dessus, avec un liseré, pour rester visible.
   */
  private chartSvg(width: number): string {
    const info = this.info;
    const rows = this.rows();
    const sold = rows.filter((r) => r.sold && r.price != null);
    const pts = view === 'points' ? this.plotted() : [];
    const cdl = view === 'candles' ? candles(sold) : [];
    const line = view === 'line' ? saleLine(sold) : [];
    const values = view === 'points' ? pts.map((p) => p.v) : view === 'candles' ? cdl.flatMap((c) => [c.high, c.low]) : line.map((l) => l.value);
    const times = view === 'points' ? pts.map((p) => p.r.at) : view === 'candles' ? cdl.map((c) => c.at + 43_200_000) : line.map((l) => l.at);
    if (!values.length) return '';
    const H = 240;
    const pad = { l: 44, r: 12, t: 12, b: 24 };
    const now = Date.now();
    const t0 = Math.min(...times);
    const t1 = Math.max(now, ...times);
    const span = Math.max(t1 - t0, 86_400_000);
    const maxY = Math.max(...values, info?.current ?? 0) * 1.08;
    const ticks = niceTicks(maxY);
    const top = ticks[ticks.length - 1] || 1;
    const plotW = width - pad.l - pad.r;
    const x = (t: number) => pad.l + ((t - t0) / span) * plotW;
    const y = (v: number) => pad.t + (1 - v / top) * (H - pad.t - pad.b);
    const color = SALES_COLOR;
    const showAvg = avgDays > 0 && sold.length > 1 && this.filter.outcome !== 'unsold';
    const grid = ticks.map((v) => `<line x1="${pad.l}" x2="${width - pad.r}" y1="${y(v)}" y2="${y(v)}"/>`).join('');
    const ylabels = ticks.map((v) => `<text x="${pad.l - 6}" y="${y(v) + 3.5}" text-anchor="end">${v.toLocaleString('fr-FR')}</text>`).join('');
    const xlabels = [0, 1 / 3, 2 / 3, 1]
      .map((f, i) => `<text x="${x(t0 + f * span)}" y="${H - 6}" text-anchor="${i === 0 ? 'start' : i === 3 ? 'end' : 'middle'}">${dateFr(t0 + f * span)}</text>`)
      .join('');
    const tips: string[] = (this.tips = []);
    const hits: string[] = [];
    const hit = (cx: number, cy: number, tip: string, r = 10) => {
      hits.push(`<circle class="hit" data-i="${tips.length}" cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${r}"/>`);
      tips.push(tip);
    };
    let marks = '';
    if (view === 'points') {
      marks = pts
        .map(({ r, v }) => {
          hit(x(r.at), y(v), tipOf(r));
          return r.sold
            ? `<circle class="dot${showAvg ? ' soft' : ''}" cx="${x(r.at).toFixed(1)}" cy="${y(v).toFixed(1)}" r="${r.shiny ? 3.5 : 2.5}" fill="${color}"/>`
            : `<circle class="dot unsold" cx="${x(r.at).toFixed(1)}" cy="${y(v).toFixed(1)}" r="2.5"/>`;
        })
        .join('');
    } else if (view === 'candles') {
      const dayW = (86_400_000 / span) * plotW;
      const bw = Math.max(3, Math.min(14, dayW * 0.65));
      marks = cdl
        .map((c) => {
          const cx = x(c.at + 43_200_000);
          const up = c.close >= c.open;
          const yTop = y(Math.max(c.open, c.close));
          const yBot = y(Math.min(c.open, c.close));
          hit(cx, (yTop + yBot) / 2, `<b>${dateFr(c.at)}</b> · ${c.count} vente${c.count > 1 ? 's' : ''}<br>ouverture ${w(c.open)} · clôture ${w(c.close)}<br>plus haut ${w(c.high)} · plus bas ${w(c.low)}`, Math.max(10, bw));
          return `<g class="candle ${up ? 'up' : 'down'}"><line x1="${cx.toFixed(1)}" x2="${cx.toFixed(1)}" y1="${y(c.high).toFixed(1)}" y2="${y(c.low).toFixed(1)}"/><rect x="${(cx - bw / 2).toFixed(1)}" y="${yTop.toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(2, yBot - yTop).toFixed(1)}" rx="2"/></g>`;
        })
        .join('');
    } else {
      marks = `<polyline class="sales-line" stroke="${color}" points="${line.map((l) => `${x(l.at).toFixed(1)},${y(l.value).toFixed(1)}`).join(' ')}"/>`;
      for (const l of line) hit(x(l.at), y(l.value), `<b>${w(l.value)}</b>${l.count > 1 ? ` · moyenne de ${l.count} ventes` : ' · vente'}<br>${dateFr(l.at)}`, 8);
    }
    const avgPts = showAvg ? rollingMeanByTime(sold, avgDays) : [];
    const avgLine = avgPts.length > 1 ? avgPts.map((p) => `${x(p.at).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ') : '';
    const avg = avgLine ? `<polyline class="avg-halo" points="${avgLine}"/><polyline class="avg" points="${avgLine}"/>` : '';
    const cur =
      info?.current != null
        ? `<line class="cur" x1="${pad.l}" x2="${width - pad.r}" y1="${y(info.current)}" y2="${y(info.current)}"/><text class="cur-label" x="${width - pad.r}" y="${y(info.current) - 5}" text-anchor="end">cette enchère ${w(info.current)}</text>`
        : '';
    // Ordre : grille, mise de l'enchère, ventes, puis la moyenne par-dessus (toujours visible), puis les zones de survol.
    return `<svg viewBox="0 0 ${width} ${H}" role="img" aria-label="Évolution du prix de vente de la carte">
    <g class="grid">${grid}</g><g class="axis">${ylabels}${xlabels}</g>${cur}<g>${marks}</g>${avg}<g>${hits.join('')}</g></svg><div class="ph-tip" hidden></div>`;
  }

  private filtersHtml(): string {
    const all = this.sales ?? [];
    const nSold = all.filter((r) => r.sold).length;
    const chip = (attr: string, label: string, on: boolean) => `<button type="button" class="ph-chip" ${attr} aria-pressed="${on}">${label}</button>`;
    const out = ([['all', `Toutes (${all.length})`], ['sold', `Vendues (${nSold})`], ['unsold', `Sans acheteur (${all.length - nSold})`]] as const).map(([o, l]) =>
      chip(`data-outcome="${o}"`, l, this.filter.outcome === o),
    );
    const per = ([[30, '30 j'], [90, '90 j'], [null, 'Tout']] as const).map(([d, l]) => chip(`data-days="${d ?? ''}"`, l, this.filter.days === d));
    const views = ([['points', 'Points'], ['candles', 'Bougies'], ['line', 'Ligne']] as const).map(([v, l]) => chip(`data-view="${v}"`, l, view === v));
    const avgs = AVG_WINDOWS.map(([d, l]) => chip(`data-avg="${d}"`, l, avgDays === d));
    return `<div class="ph-filters">${out.join('')}<span class="ph-sep"></span>${per.join('')}</div>
    <div class="ph-filters"><span class="ph-lbl">Affichage</span>${views.join('')}<span class="ph-sep"></span><span class="ph-lbl">Moyenne glissante</span>${avgs.join('')}</div>`;
  }

  private legendHtml(): string {
    const rows = this.rows();
    const color = SALES_COLOR;
    const showAvg = avgDays > 0 && rows.filter((r) => r.sold).length > 1 && this.filter.outcome !== 'unsold';
    return [
      view === 'points' && rows.some((r) => r.sold) ? `<span><i style="background:${color}"></i>vente (prix final)</span>` : '',
      view === 'points' && rows.some((r) => !r.sold) ? '<span><i class="hollow"></i>sans acheteur ou annulée (mise de départ)</span>' : '',
      view === 'candles' ? '<span><i class="sq up"></i>hausse dans la journée</span><span><i class="sq down"></i>baisse dans la journée</span><span>mèche : plus haut / plus bas</span>' : '',
      view === 'line' ? `<span><span class="ln" style="background:${color}"></span>ventes (moyenne par heure)</span>` : '',
      showAvg ? `<span><span class="ln"></span>moyenne glissante (${avgLabel(avgDays)})</span>` : '',
      this.info?.current != null ? '<span><span class="dash"></span>cette enchère</span>' : '',
      view === 'points' && rows.some((r) => r.shiny) ? '<span>✨ point plus gros : brillante</span>' : '',
    ].join('');
  }

  private tableHtml(): string {
    const rows = this.rows().slice().reverse();
    if (!rows.length) return '';
    return `<details><summary>Voir les ${rows.length} enchère${rows.length > 1 ? 's' : ''} terminée${rows.length > 1 ? 's' : ''}</summary><div class="ph-table"><table>
    <thead><tr><th>Date</th><th>Résultat</th><th>Départ</th><th>Prix final</th></tr></thead><tbody>${rows
      .map((r) => `<tr><td>${dateFr(r.at)}${r.shiny ? ' ✨' : ''}</td><td>${OUTCOME_LABEL[r.outcome ?? (r.sold ? 'sold' : 'unsold')]}</td><td>${w(r.start)}</td><td>${r.sold ? w(r.price) : '—'}</td></tr>`)
      .join('')}</tbody></table></div></details>`;
  }

  private bodyHtml(width: number): string {
    if (this.error) return `<div class="ph-empty">Historique indisponible (${esc(this.error)}).</div>`;
    if (!this.sales) return '<div class="ph-empty">Chargement des ventes de la carte…</div>';
    if (!this.sales.length) return '<div class="ph-empty">Aucune enchère terminée pour cette carte.</div>';
    const chart = this.chartSvg(width);
    return `${this.filtersHtml()}<div class="ph-tiles">${this.tilesHtml()}</div>
    ${chart ? `<div class="ph-chart">${chart}</div><div class="ph-legend">${this.legendHtml()}</div>` : '<div class="ph-empty">Aucune enchère sur cette période.</div>'}
    ${this.tableHtml()}`;
  }

  private bindBody(): void {
    const body = this.el.querySelector<HTMLElement>('.ph-body')!;
    const on = (sel: string, fn: (b: HTMLButtonElement) => void) =>
      body.querySelectorAll<HTMLButtonElement>(sel).forEach((b) =>
        b.addEventListener('click', () => {
          fn(b);
          this.paintBody();
        }),
      );
    on('[data-outcome]', (b) => (this.filter = { ...this.filter, outcome: b.dataset.outcome as OutcomeFilter }));
    on('[data-view]', (b) => {
      view = b.dataset.view as ChartView;
      localStorageSet('wiky-ph-view', view);
    });
    on('[data-avg]', (b) => {
      avgDays = Number(b.dataset.avg);
      localStorageSet('wiky-ph-avg', String(avgDays));
    });
    on('[data-days]', (b) => (this.filter = { ...this.filter, days: b.dataset.days ? Number(b.dataset.days) : null }));
    // Info-bulle au survol d'une vente.
    const chart = body.querySelector<HTMLElement>('.ph-chart');
    const tip = chart?.querySelector<HTMLElement>('.ph-tip');
    if (!chart || !tip) return;
    chart.addEventListener('mousemove', (e) => {
      const hit = (e.target as Element).closest<SVGCircleElement>('.hit');
      if (!hit) {
        tip.hidden = true;
        return;
      }
      const text = this.tips[Number(hit.dataset.i)];
      if (!text) return;
      const box2 = chart.getBoundingClientRect();
      const c = hit.getBoundingClientRect();
      tip.innerHTML = text;
      tip.style.left = `${c.left + c.width / 2 - box2.left}px`;
      tip.style.top = `${c.top - box2.top}px`;
      tip.hidden = false;
    });
    chart.addEventListener('mouseleave', () => (tip.hidden = true));
  }

  private paintBody(): void {
    const body = this.el.querySelector<HTMLElement>('.ph-body')!;
    const width = Math.max(320, Math.round(body.clientWidth || 640));
    body.innerHTML = this.bodyHtml(width);
    this.bindBody();
  }
}

// ---------------------------------------------------------------- page d'une enchère

let current: string | null = null;
let panel: PriceHistoryPanel | null = null;

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

function paint(): void {
  if (!current || !panel) return;
  const place = anchor();
  if (!place) return;
  const box = panel.el;
  // Toujours juste après le bloc d'historique du site (React peut avoir redessiné la page).
  const misplaced = place.after ? box.previousElementSibling !== place.after : box.parentElement !== place.parent;
  if (misplaced) {
    if (place.after) place.after.after(box);
    else place.parent.append(box);
  }
  panel.update();
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

async function load(auctionId: string, p: PriceHistoryPanel): Promise<void> {
  try {
    const i = await auctionInfo(auctionId);
    if (!i) throw new Error('enchère introuvable');
    p.info = i;
    p.update();
    p.setSales(await cardSalesHistory(i.cardId));
  } catch (e) {
    p.setError((e as Error).message);
  }
  if (current === auctionId) paint();
}

function stop(): void {
  current = null;
  panel?.destroy();
  panel = null;
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
      panel = new PriceHistoryPanel('price-history', OPEN_KEY);
      void load(id, panel);
    }
    paint();
  },
  cleanup: stop,
});

/** Pour les tests. */
export function priceHistoryState(): { current: string | null; sales: CardSale[] | null; filter: HistoryFilter } {
  return { current, sales: panel?.sales ?? null, filter: panel?.filter ?? { outcome: 'all', days: null } };
}
