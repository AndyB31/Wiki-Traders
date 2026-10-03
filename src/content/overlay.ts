import { adviceForCard, sellableCards, type AllocationInput } from '../lib/allocation';
import { save } from '../lib/storage';
import { formatPrice, normalize } from '../lib/text';
import type { Card, PendingFocus } from '../lib/types';
import { fillInput } from './actions';
import { openSellDialog, selectSellDuration } from './automation';
import { durationFor, durationLabel } from '../lib/duration';
import { joinedText } from './parsers/dom';
import { qsa, re, type SelectorConfig } from './parsers/selectors';

const PENDING_TTL = 15 * 60 * 1000;

const PANEL_CSS = `
:host { all: initial; }
.panel { position: fixed; left: 16px; bottom: 16px; z-index: 2147483646; max-width: 340px;
  font: 13px/1.4 system-ui, -apple-system, Segoe UI, sans-serif; color: #1c1917; background: #fffbeb;
  border: 1px solid #f59e0b; border-radius: 12px; box-shadow: 0 8px 24px rgba(0,0,0,.18); padding: 12px 14px; }
.head { display: flex; align-items: center; gap: 8px; font-weight: 600; margin-bottom: 4px; }
.head .x { margin-left: auto; cursor: pointer; border: 0; background: none; font-size: 16px; color: #78716c; }
.price { font-size: 22px; font-weight: 700; color: #b45309; }
.detail { color: #57534e; font-size: 12px; margin: 2px 0 8px; white-space: pre-line; }
.row { display: flex; gap: 8px; align-items: center; }
button.copy { cursor: pointer; border: 0; border-radius: 8px; padding: 6px 12px; background: #f59e0b; color: #fff; font-weight: 600; }
.hint { font-size: 11px; color: #78716c; margin-top: 8px; }
.progress { white-space: pre-line; font-size: 12px; color: #44403c; max-height: 160px; overflow: auto; }
.err { color: #b91c1c; }
button.stop { cursor: pointer; border: 1px solid #b91c1c; color: #b91c1c; background: #fff; border-radius: 8px; padding: 4px 10px; }
`;

export interface OverlayState {
  store: AllocationInput & { pendingFocus: PendingFocus | null };
  cfg: SelectorConfig;
  kind: string;
  root: Element;
  /** Tuiles de la collection (si la page est la collection). */
  tiles: Map<string, Element> | null;
}

let host: HTMLElement | null = null;
let shadow: ShadowRoot | null = null;
let scrolledFor: string | null = null;
/** Une automatisation est en cours : l'encart affiche sa progression. */
let busy = false;
const filledInputs = new WeakSet<HTMLInputElement>();

function ensurePanel(): ShadowRoot {
  if (shadow && host?.isConnected) return shadow;
  host = document.createElement('div');
  host.setAttribute('data-wiky', 'panel');
  shadow = host.attachShadow({ mode: 'open' });
  document.documentElement.appendChild(host);
  return shadow;
}

function hidePanel(): void {
  host?.remove();
  host = null;
  shadow = null;
}

function showPanel(title: string, price: number | null, detail: string, onClose: () => void): void {
  const key = `${title}|${price}|${detail}`;
  if (host?.isConnected && host.dataset.key === key) return;
  const root = ensurePanel();
  host!.dataset.key = key;
  root.innerHTML = '';
  const style = document.createElement('style');
  style.textContent = PANEL_CSS;
  const panel = document.createElement('div');
  panel.className = 'panel';
  panel.innerHTML = `
    <div class="head">🪙 <span class="t"></span><button class="x" title="Fermer">×</button></div>
    <div class="row"><span class="price"></span><button class="copy">Copier</button></div>
    <div class="detail"></div>
    <div class="hint">Wiky-Traders conseille, c'est toi qui cliques sur « Mettre en vente ».</div>`;
  panel.querySelector('.t')!.textContent = title;
  panel.querySelector('.price')!.textContent = price != null ? `Prix conseillé : ${formatPrice(price)}` : 'Prix à saisir';
  panel.querySelector('.detail')!.textContent = detail;
  const copy = panel.querySelector<HTMLButtonElement>('.copy')!;
  copy.disabled = price == null;
  copy.addEventListener('click', async () => {
    if (price == null) return;
    await navigator.clipboard.writeText(String(price));
    copy.textContent = 'Copié ✓';
    setTimeout(() => (copy.textContent = 'Copier'), 1500);
  });
  panel.querySelector('.x')!.addEventListener('click', () => {
    hidePanel();
    onClose();
  });
  root.append(style, panel);
}

/** Encart de progression (automatisations) avec bouton Arrêter. */
export function showProgress(title: string, text: string, opts: { onStop?: () => void; error?: boolean; done?: boolean } = {}): void {
  busy = !opts.done && !opts.error;
  const root = ensurePanel();
  host!.dataset.key = '';
  root.innerHTML = '';
  const style = document.createElement('style');
  style.textContent = PANEL_CSS;
  const panel = document.createElement('div');
  panel.className = 'panel';
  panel.innerHTML = `<div class="head">🪙 <span class="t"></span><button class="x" title="Fermer">×</button></div><div class="progress"></div><div class="row" style="margin-top:8px"></div>`;
  panel.querySelector('.t')!.textContent = title;
  const progress = panel.querySelector('.progress')!;
  progress.textContent = text;
  if (opts.error) progress.classList.add('err');
  if (opts.onStop && busy) {
    const stop = document.createElement('button');
    stop.className = 'stop';
    stop.textContent = 'Arrêter';
    stop.addEventListener('click', opts.onStop);
    panel.querySelector('.row')!.append(stop);
  }
  panel.querySelector('.x')!.addEventListener('click', () => {
    busy = false;
    opts.onStop?.();
    hidePanel();
  });
  root.append(style, panel);
}

export function endProgress(): void {
  busy = false;
}

/** Fenêtre « mettre en vente » ouverte : renvoie le conteneur et la carte reconnue. */
function findSellDialog(state: OverlayState): { dialog: Element; card: Card | null } | null {
  const textRe = re(state.cfg.sellDialogRe);
  const dialogs = qsa(document, state.cfg.sellDialog).filter((d) => d.querySelector('input') && textRe.test(joinedText(d)));
  const dialog = dialogs[dialogs.length - 1];
  if (!dialog) return null;
  const text = normalize(joinedText(dialog));
  const pending = state.store.pendingFocus;
  const cards = Object.values(state.store.cards);
  const card =
    (pending && text.includes(normalize(pending.cardName)) ? state.store.cards[pending.cardId] : undefined) ??
    cards.filter((c) => c.name.length > 2 && text.includes(normalize(c.name))).sort((a, b) => b.name.length - a.name.length)[0] ??
    null;
  return { dialog, card };
}

/** Pastilles « vendable · prix » sur les cartes de la collection. */
function renderBadges(state: OverlayState): void {
  for (const old of qsa(document, '[data-wiky="badge"]')) old.remove();
  for (const old of qsa(document, '[data-wiky-focus]')) {
    (old as HTMLElement).style.outline = '';
    old.removeAttribute('data-wiky-focus');
  }
  if (!state.tiles) return;
  const sellable = sellableCards(state.store);
  for (const [cardId, tile] of state.tiles) {
    const info = sellable.get(cardId);
    if (!info) continue;
    const el = tile as HTMLElement;
    if (getComputedStyle(el).position === 'static') el.style.position = 'relative';
    const badge = document.createElement('span');
    badge.setAttribute('data-wiky', 'badge');
    badge.title = `Vendable (étiquette ${info.rule.tag})`;
    badge.textContent = `🪙 ${info.price != null ? formatPrice(info.price) : '?'}`;
    Object.assign(badge.style, {
      position: 'absolute', top: '4px', left: '4px', zIndex: '5', padding: '1px 6px', borderRadius: '999px',
      background: '#f59e0b', color: '#fff', font: '600 11px/1.6 system-ui, sans-serif', pointerEvents: 'none',
    });
    el.appendChild(badge);
  }
}

export function updateOverlay(state: OverlayState): void {
  renderBadges(state);
  if (busy) return;

  const sell = findSellDialog(state);
  if (sell) {
    const advice = sell.card ? adviceForCard(state.store, sell.card.id) : null;
    // V4 : à l'ouverture de la fenêtre, la mise (pré-remplie à 10 par le site) et la durée sont réglées une fois ;
    // le clic « Mettre aux enchères » reste humain.
    const price = advice?.pricing.price ?? state.store.pendingFocus?.price ?? null;
    const minutes = durationFor(price, state.store.settings.durationRules);
    const withDuration = (detail: string) => (minutes != null ? `${detail}\nDurée conseillée : ${durationLabel(minutes)}` : detail);
    const open = state.store.settings.prefill ? openSellDialog(state.cfg) : null;
    if (open && !filledInputs.has(open.input)) {
      filledInputs.add(open.input);
      if (price != null) fillInput(open.input, String(price));
      if (minutes != null) selectSellDuration(state.cfg, minutes);
    }
    if (sell.card && advice) {
      showPanel(sell.card.name, advice.pricing.price, withDuration(`${advice.pricing.detail} · étiquette ${advice.rule.tag}`), () => {});
    } else {
      const p = state.store.pendingFocus;
      if (p) showPanel(p.cardName, p.price, withDuration(p.detail), () => {});
      else hidePanel();
    }
    return;
  }

  const pending = state.store.pendingFocus;
  if (pending && Date.now() - pending.at < PENDING_TTL && state.kind === 'collection') {
    const tile = state.tiles?.get(pending.cardId) as HTMLElement | undefined;
    if (tile) {
      tile.setAttribute('data-wiky-focus', '');
      tile.style.outline = '3px solid #f59e0b';
      if (scrolledFor !== pending.cardId) {
        scrolledFor = pending.cardId;
        tile.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
    const where = !tile
      ? 'Carte non visible : cherche-la dans la collection.'
      : pending.prefilledAt
        ? 'Prix rempli : vérifie et clique sur « Mettre en vente ».'
        : 'Clique sur la carte puis « Mettre en vente ».';
    const duration = pending.durationMin != null ? `\nDurée conseillée : ${durationLabel(pending.durationMin)}` : '';
    showPanel(pending.cardName, pending.price, `${pending.detail}${duration}\n${where}`, () => void save({ pendingFocus: null }));
    return;
  }
  hidePanel();
}
