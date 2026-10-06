/**
 * Classement « Plus chères » : ma collection triée par prix moyen (moyenne des ventes de la carte dans sa rareté, comme le site), avec filtres
 * (recherche, rareté, étiquette, favoris) et valeur totale. Les prix déjà connus s'affichent tout de suite,
 * les autres arrivent en lots de 150 (`cardPrices`) ; la liste est virtualisée (seules les lignes visibles
 * sont dans le DOM), elle reste fluide avec des milliers de cartes.
 *
 * Avec « Vendre depuis le classement » (risqué, désactivé par défaut), chaque ligne a un bouton « Vendre » :
 * prix conseillé et durée pré-remplis, modifiables, puis confirmation avant l'envoi.
 */
import { sellAdvice } from '../../lib/allocation';
import { DURATIONS, durationFor, durationLabel } from '../../lib/duration';
import type { FeatureFlags } from '../../lib/features';
import { load } from '../../lib/storage';
import { normalize, RARITIES } from '../../lib/text';
import type { Card, Rarity } from '../../lib/types';
import { cardPrices, displayPrice, knownPrice, type CardPrice } from '../catalog';
import { progressToast } from '../toast';
import { collectionTools, ensureStyle, formatW, isCollection, isolateClicks, RARITY_ACCENT, removeTool } from './dom';
import { createListing, SellError } from './market-sell';
import { registerFeature, type FeatureContext } from './runtime';

// ---------------------------------------------------------------- tri et filtres (sans DOM)

export interface RankFilter {
  q: string;
  rarity: Rarity | '';
  tag: string;
  favorites: boolean;
}

export interface RankRow {
  card: Card;
  price: number | null;
  sales: number;
  /** Prix × exemplaires. */
  total: number | null;
}

export const EMPTY_FILTER: RankFilter = { q: '', rarity: '', tag: '', favorites: false };

/** Cartes filtrées, de la plus chère à la moins chère ; les cartes sans prix à la fin (par nom). */
export function rankCards(cards: Card[], priceOf: (siteId: string) => CardPrice | undefined, f: RankFilter): RankRow[] {
  const q = normalize(f.q);
  const rows: RankRow[] = [];
  for (const card of cards) {
    if (f.rarity && card.rarity !== f.rarity) continue;
    if (f.favorites && !card.favorite) continue;
    if (f.tag && !card.tags.includes(f.tag)) continue;
    if (q && !normalize(`${card.name} ${card.category ?? ''}`).includes(q)) continue;
    const p = card.siteId ? priceOf(card.siteId) : undefined;
    const price = displayPrice(p, card.rarity);
    rows.push({ card, price, sales: p?.count ?? 0, total: price == null ? null : price * Math.max(1, card.quantity) });
  }
  return rows.sort((a, b) => {
    if (a.price == null || b.price == null) return a.price == null && b.price == null ? a.card.name.localeCompare(b.card.name, 'fr') : a.price == null ? 1 : -1;
    return b.price - a.price || a.card.name.localeCompare(b.card.name, 'fr');
  });
}

export function rankTotals(rows: RankRow[]): { cards: number; copies: number; value: number; unpriced: number } {
  let copies = 0;
  let value = 0;
  let unpriced = 0;
  for (const r of rows) {
    copies += Math.max(1, r.card.quantity);
    if (r.total == null) unpriced++;
    else value += r.total;
  }
  return { cards: rows.length, copies, value, unpriced };
}

// ---------------------------------------------------------------- fenêtre

const ROW_H = 46;
const OVERSCAN = 8;

const CSS = `
.wiky-rk-overlay { position: fixed; inset: 0; z-index: 2147483646; display: grid; place-items: center; padding: 18px;
  background: rgba(0,0,0,.66); backdrop-filter: blur(2px); animation: wiky-rk-fade .15s ease; }
.wiky-rk { display: flex; flex-direction: column; width: min(820px, 100%); height: min(86vh, 820px); overflow: hidden; border-radius: 16px;
  border: 1px solid var(--color-border); background: var(--color-surface); color: var(--color-foreground); box-shadow: 0 24px 72px rgba(0,0,0,.45);
  animation: wiky-rk-up .18s ease; font-size: 13px; }
.wiky-rk-head { display: flex; align-items: center; gap: 10px; padding: 14px 14px 12px 18px; border-bottom: 1px solid var(--color-border); }
.wiky-rk-head .wiky-ico { display: inline-grid; place-items: center; width: 30px; height: 30px; border-radius: 9px; background: rgba(249,115,22,.14); color: #fb923c; }
.wiky-rk-head h2 { margin: 0; font-size: 17px; font-weight: 700; font-family: var(--font-heading, inherit); }
.wiky-rk-head small { display: block; font-size: 11px; font-weight: 600; letter-spacing: .04em; text-transform: uppercase; color: #fb923c; }
.wiky-rk-refresh { margin-left: auto; padding: 6px 12px; border-radius: 10px; cursor: pointer; font: inherit; font-size: 12px; font-weight: 600;
  border: 1px solid var(--color-border); background: var(--color-surface-light); color: color-mix(in srgb, var(--color-foreground) 75%, transparent); }
.wiky-rk-refresh:hover { color: var(--color-foreground); border-color: rgba(249,115,22,.4); }
.wiky-rk-refresh:disabled { opacity: .6; cursor: default; }
.wiky-rk-close { margin-left: 4px; display: inline-grid; place-items: center; width: 32px; height: 32px; border: 0; border-radius: 10px; cursor: pointer;
  background: none; color: color-mix(in srgb, var(--color-foreground) 60%, transparent); font-size: 20px; }
.wiky-rk-close:hover { background: var(--color-surface-light); color: var(--color-foreground); }
.wiky-rk-filters { display: flex; flex-wrap: wrap; gap: 8px; padding: 12px 18px 8px; }
.wiky-rk-filters input[type="search"], .wiky-rk-filters select, .wiky-rk-sell input, .wiky-rk-sell select { font: inherit; font-size: 13px; color: var(--color-foreground);
  background: var(--color-surface-light, var(--color-surface)); border: 1px solid var(--color-border); border-radius: 10px; padding: 6px 10px; }
.wiky-rk-filters input[type="search"] { flex: 1 1 200px; min-width: 0; }
.wiky-rk-filters input:focus, .wiky-rk-filters select:focus, .wiky-rk-sell input:focus, .wiky-rk-sell select:focus { outline: 2px solid rgba(251,146,60,.6); outline-offset: 1px; }
.wiky-rk-fav { display: inline-flex; align-items: center; gap: 6px; padding: 6px 10px; border-radius: 10px; border: 1px solid var(--color-border); cursor: pointer; user-select: none; }
.wiky-rk-fav input { accent-color: #f97316; }
.wiky-rk-sum { display: flex; flex-wrap: wrap; gap: 4px 16px; padding: 4px 18px 10px; border-bottom: 1px solid var(--color-border);
  color: color-mix(in srgb, var(--color-foreground) 60%, transparent); font-variant-numeric: tabular-nums; }
.wiky-rk-sum b { color: var(--color-foreground); }
.wiky-rk-sum .wiky-rk-value { color: #fdba74; }
.wiky-rk-list { position: relative; flex: 1; overflow-y: auto; overscroll-behavior: contain; }
.wiky-rk-spacer { position: relative; width: 100%; }
.wiky-rk-row { position: absolute; left: 0; right: 0; height: ${ROW_H}px; display: grid; align-items: center; gap: 10px; padding: 0 18px;
  grid-template-columns: 36px 34px minmax(0,1fr) 44px 92px 92px auto; border-bottom: 1px solid color-mix(in srgb, var(--color-border) 60%, transparent); }
.wiky-rk-row:hover { background: var(--color-surface-light); }
.wiky-rk-rank { color: color-mix(in srgb, var(--color-foreground) 45%, transparent); font-variant-numeric: tabular-nums; text-align: right; }
.wiky-rk-rar { display: inline-grid; place-items: center; height: 20px; border-radius: 6px; font-size: 10.5px; font-weight: 800; color: #0d1117; }
.wiky-rk-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; }
.wiky-rk-name small { margin-left: 6px; font-weight: 500; color: color-mix(in srgb, var(--color-foreground) 45%, transparent); }
.wiky-rk-name .star { color: #facc15; margin-right: 4px; }
.wiky-rk-qty, .wiky-rk-price, .wiky-rk-total { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
.wiky-rk-qty { color: color-mix(in srgb, var(--color-foreground) 55%, transparent); }
.wiky-rk-price b { color: #fdba74; }
.wiky-rk-price small, .wiky-rk-total small { display: block; font-size: 10px; color: color-mix(in srgb, var(--color-foreground) 42%, transparent); }
.wiky-rk-btn { font: inherit; font-size: 12px; font-weight: 600; padding: 5px 10px; border-radius: 8px; cursor: pointer; white-space: nowrap;
  border: 1px solid rgba(249,115,22,.45); background: rgba(249,115,22,.12); color: #fdba74; }
.wiky-rk-btn:hover:not(:disabled) { background: rgba(249,115,22,.22); color: #fff; }
.wiky-rk-btn:disabled { opacity: .55; cursor: default; }
.wiky-rk-btn.primary { background: #f97316; border-color: #f97316; color: #fff; }
.wiky-rk-btn.ghost { background: none; border-color: var(--color-border); color: color-mix(in srgb, var(--color-foreground) 70%, transparent); }
.wiky-rk-empty { padding: 32px 18px; text-align: center; color: color-mix(in srgb, var(--color-foreground) 50%, transparent); }
.wiky-rk-sell { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 10px; padding: 12px 18px; border-top: 1px solid var(--color-border);
  background: linear-gradient(180deg, rgba(249,115,22,.08), rgba(249,115,22,.02)); }
.wiky-rk-sell[hidden] { display: none; }
.wiky-rk-sell .name { flex: 1 1 100%; font-weight: 700; }
.wiky-rk-sell .detail { flex: 1 1 100%; font-size: 11px; color: color-mix(in srgb, var(--color-foreground) 50%, transparent); }
.wiky-rk-sell input { width: 96px; }
.wiky-rk-sell .warn { flex: 1 1 100%; font-size: 11px; color: #fca5a5; }
@media (max-width: 640px) {
  .wiky-rk-row { grid-template-columns: 28px 30px minmax(0,1fr) 78px auto; gap: 6px; padding: 0 10px; }
  .wiky-rk-qty, .wiky-rk-total { display: none; }
}
@keyframes wiky-rk-fade { from { opacity: 0; } }
@keyframes wiky-rk-up { from { opacity: 0; transform: translateY(8px); } }
`;

const ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/></svg>';

let filter: RankFilter = { ...EMPTY_FILTER };
let lastCtx: FeatureContext | null = null;
let close: (() => void) | null = null;
/** Cartes mises en vente depuis le classement pendant cette visite. */
const listedHere = new Set<string>();

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

export function isRankingOpen(): boolean {
  return close != null;
}

export function closeRanking(): void {
  close?.();
  close = null;
}

/** Ouvre le classement (exporté pour les tests). */
export function openRanking(ctx: FeatureContext): void {
  closeRanking();
  ensureStyle('wiky-rk-style', CSS);
  const flags: Pick<FeatureFlags, 'rankingSell'> = { rankingSell: !!ctx.flags.rankingSell && ctx.apiRead };
  const cards = Object.values(ctx.cards);
  const tags = [...new Set(cards.flatMap((c) => c.tags))].sort((a, b) => a.localeCompare(b, 'fr'));

  const overlay = document.createElement('div');
  overlay.setAttribute('data-wiky', 'modal');
  overlay.className = 'wiky-rk-overlay';
  overlay.innerHTML = `
    <div class="wiky-rk" role="dialog" aria-modal="true" aria-label="Plus chères">
      <div class="wiky-rk-head"><span class="wiky-ico">${ICON.replace('<svg ', '<svg width="18" height="18" ')}</span><div><small>Wiky-Traders</small><h2>Plus chères</h2></div>
        <button type="button" class="wiky-rk-refresh" title="Relit les ventes de toutes tes cartes (sinon les prix sont gardés 6 h)">↻ Rafraîchir les prix</button>
        <button type="button" class="wiky-rk-close" aria-label="Fermer" title="Fermer">×</button></div>
      <div class="wiky-rk-filters">
        <input type="search" placeholder="Rechercher une carte…" aria-label="Rechercher">
        <select data-f="rarity" aria-label="Rareté"><option value="">Toutes les raretés</option>${(Object.keys(RARITIES) as Rarity[])
          .sort((a, b) => RARITIES[b].order - RARITIES[a].order)
          .map((r) => `<option value="${r}">${r} · ${RARITIES[r].label}</option>`)
          .join('')}</select>
        <select data-f="tag" aria-label="Étiquette"><option value="">Toutes les étiquettes</option>${tags.map((t) => `<option value="${esc(t)}">${esc(t)}</option>`).join('')}</select>
        <label class="wiky-rk-fav"><input type="checkbox" data-f="fav"><span>★ Favoris</span></label>
      </div>
      <div class="wiky-rk-sum" aria-live="polite"></div>
      <div class="wiky-rk-list" tabindex="-1"><div class="wiky-rk-spacer"></div></div>
      <div class="wiky-rk-sell" hidden></div>
    </div>`;
  const q = overlay.querySelector<HTMLInputElement>('input[type="search"]')!;
  const rar = overlay.querySelector<HTMLSelectElement>('[data-f="rarity"]')!;
  const tag = overlay.querySelector<HTMLSelectElement>('[data-f="tag"]')!;
  const fav = overlay.querySelector<HTMLInputElement>('[data-f="fav"]')!;
  const sum = overlay.querySelector<HTMLElement>('.wiky-rk-sum')!;
  const list = overlay.querySelector<HTMLElement>('.wiky-rk-list')!;
  const spacer = overlay.querySelector<HTMLElement>('.wiky-rk-spacer')!;
  const sell = overlay.querySelector<HTMLElement>('.wiky-rk-sell')!;
  q.value = filter.q;
  rar.value = filter.rarity;
  tag.value = tags.includes(filter.tag) ? filter.tag : '';
  fav.checked = filter.favorites;

  let rows: RankRow[] = [];
  let loading = true;
  let frame = 0;

  const recompute = () => {
    filter = { q: q.value, rarity: rar.value as Rarity | '', tag: tag.value, favorites: fav.checked };
    rows = rankCards(cards, knownPrice, filter);
    const t = rankTotals(rows);
    sum.innerHTML =
      `<span><b>${t.cards}</b> carte${t.cards > 1 ? 's' : ''} · <b>${t.copies}</b> exemplaire${t.copies > 1 ? 's' : ''}</span>` +
      `<span>Valeur : <b class="wiky-rk-value">${formatW(t.value)} W</b></span>` +
      (t.unpriced ? `<span>${t.unpriced} sans prix</span>` : '') +
      (loading ? '<span>Chargement des prix…</span>' : '');
    spacer.style.height = `${rows.length * ROW_H}px`;
    spacer.replaceChildren();
    drawn.clear();
    if (!rows.length) spacer.innerHTML = `<div class="wiky-rk-empty">${loading ? 'Chargement…' : 'Aucune carte ne correspond.'}</div>`;
    draw();
  };

  /** Lignes visibles seulement (+ marge), recyclées au défilement. */
  const drawn = new Map<number, HTMLElement>();
  const draw = () => {
    frame = 0;
    if (!rows.length) return;
    const h = list.clientHeight || 600;
    const first = Math.max(0, Math.floor(list.scrollTop / ROW_H) - OVERSCAN);
    const last = Math.min(rows.length - 1, Math.ceil((list.scrollTop + h) / ROW_H) + OVERSCAN);
    for (const [i, el] of drawn) {
      if (i < first || i > last) {
        el.remove();
        drawn.delete(i);
      }
    }
    for (let i = first; i <= last; i++) {
      if (drawn.has(i)) continue;
      const el = rowEl(rows[i], i);
      drawn.set(i, el);
      spacer.append(el);
    }
  };

  const rowEl = (r: RankRow, i: number): HTMLElement => {
    const el = document.createElement('div');
    el.className = 'wiky-rk-row';
    el.style.top = `${i * ROW_H}px`;
    const rarity = r.card.rarity;
    el.innerHTML =
      `<span class="wiky-rk-rank">${i + 1}</span>` +
      `<span class="wiky-rk-rar" style="background:${rarity ? RARITY_ACCENT[rarity] : '#78716c'}">${rarity ?? '?'}</span>` +
      `<span class="wiky-rk-name" title="${esc(r.card.name)}">${r.card.favorite ? '<span class="star" title="Favori">★</span>' : ''}${esc(r.card.name)}${r.card.tags.length ? `<small>${esc(r.card.tags.join(', '))}</small>` : ''}</span>` +
      `<span class="wiky-rk-qty">×${Math.max(1, r.card.quantity)}</span>` +
      `<span class="wiky-rk-price">${r.price == null ? '—' : `<b>${formatW(r.price)} W</b>`}<small>${r.sales} vente${r.sales > 1 ? 's' : ''}</small></span>` +
      `<span class="wiky-rk-total">${r.total == null ? '—' : `${formatW(r.total)} W`}<small>total</small></span>` +
      '<span class="wiky-rk-act"></span>';
    if (flags.rankingSell && r.card.siteId) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'wiky-rk-btn';
      b.setAttribute('data-act', 'sell');
      const done = listedHere.has(r.card.id);
      b.textContent = done ? 'En vente ✓' : 'Vendre';
      b.disabled = done;
      b.addEventListener('click', () => void openSell(r));
      el.querySelector('.wiky-rk-act')!.append(b);
    }
    return el;
  };

  // ------------------------------------------------ vente (option risquée)
  const openSell = async (r: RankRow) => {
    const card = r.card;
    const store = await load('rules', 'settings', 'cards', 'priceObs', 'myAuctions', 'manualPrices', 'slotOverrides', 'ignoredSlots');
    const advice = sellAdvice(store, card.id);
    const price = advice.price ?? (r.price != null ? Math.max(1, Math.round(r.price)) : null);
    const duration = durationFor(price, store.settings.durationRules) ?? 60;
    sell.hidden = false;
    sell.innerHTML = `
      <span class="name"></span>
      <label>Prix de départ <input type="number" min="1" step="1" inputmode="numeric" data-s="price"></label>
      <label>Durée <select data-s="duration">${DURATIONS.map((d) => `<option value="${d.minutes}">${d.label}</option>`).join('')}</select></label>
      <span style="flex:1"></span>
      <button type="button" class="wiky-rk-btn ghost" data-s="cancel">Annuler</button>
      <button type="button" class="wiky-rk-btn primary" data-s="go">Mettre aux enchères</button>
      <span class="detail"></span>
      <span class="warn">Mise en vente directe par l'API du site : contraire à ses règles (risque de bannissement).</span>`;
    sell.querySelector('.name')!.textContent = `Vendre « ${card.name} »`;
    sell.querySelector('.detail')!.textContent = advice.detail;
    const priceIn = sell.querySelector<HTMLInputElement>('[data-s="price"]')!;
    const durIn = sell.querySelector<HTMLSelectElement>('[data-s="duration"]')!;
    const go = sell.querySelector<HTMLButtonElement>('[data-s="go"]')!;
    priceIn.value = price != null ? String(price) : '';
    durIn.value = String(duration);
    let durTouched = false;
    let armed = false;
    durIn.addEventListener('change', () => (durTouched = true));
    priceIn.addEventListener('input', () => {
      armed = false;
      go.textContent = 'Mettre aux enchères';
      const d = durationFor(Number(priceIn.value) || null, store.settings.durationRules);
      if (!durTouched && d != null) durIn.value = String(d);
    });
    sell.querySelector('[data-s="cancel"]')!.addEventListener('click', () => {
      sell.hidden = true;
      sell.replaceChildren();
    });
    priceIn.focus();
    go.addEventListener('click', async () => {
      const amount = Number(priceIn.value);
      const minutes = Number(durIn.value);
      if (!(amount > 0)) {
        priceIn.focus();
        return;
      }
      // Étape de confirmation : un deuxième clic envoie la vente.
      if (!armed) {
        armed = true;
        go.textContent = `Confirmer : ${formatW(amount)} W · ${durationLabel(minutes)}`;
        return;
      }
      go.disabled = true;
      go.textContent = 'Envoi…';
      const send = (allowStarred: boolean) => createListing(flags, { siteCardId: card.siteId!, amount, durationMinutes: minutes, allowStarred });
      try {
        try {
          await send(false);
        } catch (e) {
          if (!(e instanceof SellError && e.code === 'STARRED') || !confirm(`« ${card.name} » : le seul exemplaire disponible est en favori.\n\nLe mettre aux enchères quand même ?`)) throw e;
          await send(true);
        }
        listedHere.add(card.id);
        progressToast({ title: 'Vente', text: `« ${card.name} » mise aux enchères : ${formatW(amount)} W, ${durationLabel(minutes)}.`, finished: true });
        sell.hidden = true;
        sell.replaceChildren();
        recompute();
      } catch (e) {
        progressToast({ title: 'Vente', text: `« ${card.name} » : mise en vente impossible (${(e as Error).message}).`, error: true, finished: true });
        go.disabled = false;
        armed = false;
        go.textContent = 'Mettre aux enchères';
      }
    });
  };

  // ------------------------------------------------ événements
  isolateClicks(overlay);
  overlay.addEventListener('mousedown', (e) => {
    if (e.target === overlay) closeRanking();
  });
  overlay.querySelector('.wiky-rk-close')!.addEventListener('click', closeRanking);
  const refreshBtn = overlay.querySelector<HTMLButtonElement>('.wiky-rk-refresh')!;
  refreshBtn.addEventListener('click', () => {
    refreshBtn.disabled = true;
    refreshBtn.textContent = 'Rafraîchissement…';
    loading = true;
    recompute();
    const all = cards.flatMap((c) => (c.siteId ? [c.siteId] : []));
    void cardPrices(all, true)
      .catch(() => undefined)
      .finally(() => {
        loading = false;
        refreshBtn.disabled = false;
        refreshBtn.textContent = '↻ Rafraîchir les prix';
        if (overlay.isConnected) recompute();
      });
  });
  let typing: ReturnType<typeof setTimeout> | undefined;
  q.addEventListener('input', () => {
    clearTimeout(typing);
    typing = setTimeout(() => {
      list.scrollTop = 0;
      recompute();
    }, 120);
  });
  for (const input of [rar, tag, fav])
    input.addEventListener('change', () => {
      list.scrollTop = 0;
      recompute();
    });
  list.addEventListener('scroll', () => {
    if (!frame) frame = requestAnimationFrame(draw);
  }, { passive: true });
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') closeRanking();
  };
  document.addEventListener('keydown', onKey);
  document.body.append(overlay);
  close = () => {
    document.removeEventListener('keydown', onKey);
    if (frame) cancelAnimationFrame(frame);
    overlay.remove();
  };

  recompute();
  q.focus();
  // Tous les prix de la collection : lots de 150, cache ; la liste se met à jour à l'arrivée.
  const ids = cards.flatMap((c) => (c.siteId ? [c.siteId] : []));
  void cardPrices(ids)
    .catch(() => undefined)
    .finally(() => {
      loading = false;
      if (overlay.isConnected) recompute();
    });
}

function renderButton(ctx: FeatureContext): void {
  if (!isCollection(ctx)) {
    removeTool('ranking');
    return;
  }
  const tools = collectionTools();
  if (!tools || tools.querySelector('[data-tool="ranking"]')) return;
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'wiky-tool';
  b.dataset.tool = 'ranking';
  b.title = 'Ma collection triée par prix moyen';
  b.innerHTML = `${ICON}<span>Plus chères</span>`;
  b.addEventListener('click', () => lastCtx && openRanking(lastCtx));
  tools.prepend(b);
}

registerFeature({
  keys: ['ranking'],
  needsApi: true,
  render(ctx) {
    lastCtx = ctx;
    renderButton(ctx);
  },
  cleanup() {
    lastCtx = null;
    removeTool('ranking');
    closeRanking();
  },
});
