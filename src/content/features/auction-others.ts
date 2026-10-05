/**
 * Page d'une enchère (`/marketplace/<id>`) : dans l'espace libre en bas de la page, la liste des **autres enchères en
 * cours de la même carte** (prix, mise de départ ou en cours, temps restant, ✨), de la moins chère à la plus chère.
 * Un clic ouvre l'enchère. Une requête pour trouver la carte (mise en cache), une pour ses enchères, relue toutes
 * les 20 s tant que la page est ouverte et visible.
 */
import { formatDuration } from '../../lib/text';
import { fetchCardAuctions } from '../api';
import { cardIdForAuction } from '../catalog';
import type { CardAuction } from '../../lib/types';
import { registerFeature, type FeatureContext } from './runtime';

const AUCTION_RE = /^\/marketplace\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/?$/i;
const REFRESH_MS = 20_000;
const MAX_ROWS = 12;

const CSS = `
[data-wiky="auction-others"] { position: fixed; bottom: 16px; z-index: 40; width: 280px; max-height: min(46vh, 420px); display: flex; flex-direction: column;
  border-radius: 14px; border: 1px solid var(--color-border, #2e3431); background: var(--color-surface, #131615); color: var(--color-foreground, #f2f4f3);
  box-shadow: 0 16px 40px rgba(0,0,0,.4); font-size: 12.5px; overflow: hidden; animation: wiky-ao-in .18s ease; }
[data-wiky="auction-others"] .ao-head { display: flex; align-items: center; gap: 8px; padding: 10px 12px 8px; border-bottom: 1px solid var(--color-border, #2e3431); }
[data-wiky="auction-others"] .ao-head b { font-size: 12px; letter-spacing: .04em; text-transform: uppercase; color: #fb923c; }
[data-wiky="auction-others"] .ao-head span { color: color-mix(in srgb, var(--color-foreground, #f2f4f3) 50%, transparent); font-size: 11px; }
[data-wiky="auction-others"] .ao-close { margin-left: auto; all: unset; cursor: pointer; width: 22px; height: 22px; display: grid; place-items: center; border-radius: 6px; margin-left: auto;
  color: color-mix(in srgb, var(--color-foreground, #f2f4f3) 55%, transparent); }
[data-wiky="auction-others"] .ao-close:hover { background: var(--color-surface-light, #1b1f1d); color: var(--color-foreground, #f2f4f3); }
[data-wiky="auction-others"] .ao-list { overflow-y: auto; padding: 4px 6px 6px; }
[data-wiky="auction-others"] a.ao-row { display: grid; grid-template-columns: auto 1fr auto; gap: 8px; align-items: center; padding: 7px 8px; border-radius: 10px;
  text-decoration: none; color: inherit; }
[data-wiky="auction-others"] a.ao-row:hover { background: var(--color-surface-light, #1b1f1d); }
[data-wiky="auction-others"] .ao-price { font-weight: 700; color: var(--color-accent, #e0b04a); font-variant-numeric: tabular-nums; min-width: 48px; }
[data-wiky="auction-others"] .ao-kind { color: color-mix(in srgb, var(--color-foreground, #f2f4f3) 55%, transparent); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
[data-wiky="auction-others"] .ao-time { font-variant-numeric: tabular-nums; font-weight: 600; }
[data-wiky="auction-others"] .ao-time.soon { color: #fdba74; }
[data-wiky="auction-others"] .ao-empty { padding: 10px 12px 12px; color: color-mix(in srgb, var(--color-foreground, #f2f4f3) 50%, transparent); }
@keyframes wiky-ao-in { from { opacity: 0; transform: translateY(6px); } }
`;

let current: string | null = null;
let state: { auctionId: string; list: CardAuction[] | null; error?: string; at: number } | null = null;
let closedFor: string | null = null;
let loading = false;
let timer: ReturnType<typeof setInterval> | undefined;

function ensureStyle(): void {
  if (document.getElementById('wiky-auction-others-style')) return;
  const style = document.createElement('style');
  style.id = 'wiky-auction-others-style';
  style.setAttribute('data-wiky', 'style');
  style.textContent = CSS;
  (document.head ?? document.documentElement).append(style);
}

async function load(auctionId: string): Promise<void> {
  if (loading) return;
  loading = true;
  try {
    const cardId = await cardIdForAuction(auctionId);
    if (!cardId) throw new Error('carte introuvable');
    const res = await fetchCardAuctions(cardId);
    if (current !== auctionId) return;
    state = { auctionId, list: res.auctions.filter((a) => a.id !== auctionId), at: Date.now() };
  } catch (e) {
    if (current === auctionId) state = { auctionId, list: null, error: (e as Error).message, at: Date.now() };
  } finally {
    loading = false;
    paint();
  }
}

/** Côté le plus dégagé : à gauche du contenu, juste à droite de la barre latérale (les toasts sont à droite). */
function place(box: HTMLElement): void {
  const main = document.querySelector('main');
  const left = Math.max(16, Math.round((main?.getBoundingClientRect().left ?? 0) + 16));
  if (box.style.left !== `${left}px`) box.style.left = `${left}px`;
}

function paint(): void {
  const existing = document.querySelector<HTMLElement>('[data-wiky="auction-others"]');
  if (!current || closedFor === current || !state || state.auctionId !== current) {
    if (existing && (!current || closedFor === current)) existing.remove();
    return;
  }
  const now = Date.now();
  const list = state.list;
  const key = JSON.stringify([current, state.error ?? '', list?.map((a) => [a.id, a.price, a.hasBid, a.endsAt]), Math.floor(now / 1000)]);
  if (existing?.dataset.key === key) return;
  ensureStyle();
  const box = existing ?? document.createElement('div');
  box.setAttribute('data-wiky', 'auction-others');
  box.dataset.key = key;
  const head = document.createElement('div');
  head.className = 'ao-head';
  head.innerHTML = `<b>Même carte</b><span>${list ? `${list.length} autre${list.length > 1 ? 's' : ''} enchère${list.length > 1 ? 's' : ''}` : ''}</span>`;
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'ao-close';
  close.title = 'Masquer';
  close.setAttribute('aria-label', 'Masquer');
  close.textContent = '×';
  close.addEventListener('click', () => {
    closedFor = current;
    box.remove();
  });
  head.append(close);
  const body = document.createElement('div');
  body.className = 'ao-list';
  if (state.error) body.innerHTML = `<div class="ao-empty">Enchères indisponibles (${state.error}).</div>`;
  else if (!list?.length) body.innerHTML = '<div class="ao-empty">Aucune autre enchère en cours pour cette carte.</div>';
  else {
    for (const a of list.slice(0, MAX_ROWS)) {
      const row = document.createElement('a');
      row.className = 'ao-row';
      row.href = `/marketplace/${a.id}`;
      const left = a.endsAt ? a.endsAt - now : null;
      row.innerHTML = `<span class="ao-price">${a.price} W</span><span class="ao-kind"></span><span class="ao-time${left != null && left < 10 * 60_000 ? ' soon' : ''}">${left != null ? (left > 0 ? formatDuration(left) : 'terminée') : '—'}</span>`;
      row.querySelector('.ao-kind')!.textContent = `${a.hasBid ? 'mise en cours' : 'mise de départ'}${a.shiny ? ' · ✨' : ''}${a.mine ? ' · à toi' : ''}`;
      body.append(row);
    }
    if (list.length > MAX_ROWS) body.insertAdjacentHTML('beforeend', `<div class="ao-empty">+ ${list.length - MAX_ROWS} autre(s)</div>`);
  }
  box.replaceChildren(head, body);
  place(box);
  if (!existing) document.body.append(box);
}

function stop(): void {
  clearInterval(timer);
  timer = undefined;
  current = null;
  state = null;
  document.querySelector('[data-wiky="auction-others"]')?.remove();
}

registerFeature({
  keys: ['marketplacePrice'],
  needsApi: true,
  render(ctx: FeatureContext) {
    const auctionId = ctx.path.match(AUCTION_RE)?.[1] ?? null;
    if (!auctionId) {
      if (current) stop();
      return;
    }
    if (auctionId !== current) {
      current = auctionId;
      state = null;
      void load(auctionId);
      clearInterval(timer);
      // Relecture (prix, nouvelles enchères) et compte à rebours, tant que l'onglet est visible.
      timer = setInterval(() => {
        if (document.visibilityState !== 'visible' || !current) return;
        if (state && Date.now() - state.at > REFRESH_MS) void load(current);
        else paint();
      }, 1000);
    }
    paint();
  },
  cleanup: stop,
});

/** Pour les tests. */
export function auctionOthersForTest(): { current: string | null; state: typeof state } {
  return { current, state };
}
