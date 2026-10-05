import { adviceForCard, type AllocationInput } from '../lib/allocation';
import { save } from '../lib/storage';
import { formatPrice, normalize } from '../lib/text';
import type { Card, PendingFocus } from '../lib/types';
import { fillInput, filledInputs } from './actions';
import { openSellDialog, selectSellDuration } from './automation';
import { durationFor, durationLabel } from '../lib/duration';
import { joinedText } from './parsers/dom';
import { qsa, re, type SelectorConfig } from './parsers/selectors';
import { hideToast, priceToast, progressToast } from './toast';

const PENDING_TTL = 15 * 60 * 1000;

export interface OverlayState {
  store: AllocationInput & { pendingFocus: PendingFocus | null };
  cfg: SelectorConfig;
  kind: string;
  root: Element;
  /** Tuiles de la collection (si la page est la collection). */
  tiles: Map<string, Element> | null;
  /** Couleurs des étiquettes (nom → couleur du site). */
  tagColors?: Map<string, string>;
}

/** Texte noir ou blanc selon la clarté de la couleur de fond. */
function readableOn(hex: string): string {
  const m = hex.replace('#', '').match(/^([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i);
  if (!m) return '#fff';
  const [r, g, b] = m.slice(1).map((x) => parseInt(x, 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.6 ? '#1c1917' : '#fff';
}

const MAX_CHIPS = 3;

/** Pastilles des étiquettes en haut de la carte, sur l'image (loin du texte et des badges de prix). */
function renderTagChips(host: HTMLElement, tags: string[], colors: Map<string, string>, style: 'label' | 'dot' = 'label'): void {
  const key = JSON.stringify([style, tags.map((t) => [t, colors.get(t) ?? ''])]);
  const existing = host.querySelector<HTMLElement>(':scope > [data-wiky="tags"]');
  // Rien n'a changé : on ne touche pas au DOM (pas de mutation, pas de clignotement).
  if (existing?.dataset.key === key) return;
  existing?.remove();
  if (!tags.length) return;
  // Les pastilles sont positionnées par rapport à la carte (une seule fois, si besoin).
  if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
  const box = document.createElement('div');
  box.setAttribute('data-wiky', 'tags');
  box.dataset.key = key;
  box.dataset.style = style;
  box.title = `Étiquettes : ${tags.join(', ')}`;
  Object.assign(box.style, {
    position: 'absolute', left: '6px', right: '6px', top: '30px', zIndex: '40', display: 'flex', flexWrap: 'wrap', gap: style === 'dot' ? '4px' : '3px',
    justifyContent: 'flex-start', pointerEvents: 'none',
  });
  if (style === 'dot') {
    // Simples ronds de couleur : discrets, le nom apparaît au survol (title).
    for (const tag of tags.slice(0, 8)) {
      const dot = document.createElement('span');
      dot.title = tag;
      Object.assign(dot.style, {
        width: '12px', height: '12px', borderRadius: '50%', background: colors.get(tag) ?? '#57534e',
        border: '2px solid rgba(255,255,255,.9)', boxShadow: '0 1px 3px rgba(0,0,0,.5)', boxSizing: 'border-box',
      });
      box.append(dot);
    }
    host.appendChild(box);
    return;
  }
  for (const tag of tags.slice(0, MAX_CHIPS)) {
    const chip = document.createElement('span');
    const bg = colors.get(tag) ?? '#57534e';
    chip.textContent = tag;
    Object.assign(chip.style, {
      maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', padding: '1px 7px', borderRadius: '999px',
      background: bg, color: readableOn(bg), font: '600 10px/1.5 system-ui, sans-serif', boxShadow: '0 1px 3px rgba(0,0,0,.45)',
    });
    box.append(chip);
  }
  if (tags.length > MAX_CHIPS) {
    const more = document.createElement('span');
    more.textContent = `+${tags.length - MAX_CHIPS}`;
    Object.assign(more.style, { padding: '1px 6px', borderRadius: '999px', background: 'rgba(0,0,0,.65)', color: '#fff', font: '600 10px/1.5 system-ui, sans-serif' });
    box.append(more);
  }
  host.appendChild(box);
}

let scrolledFor: string | null = null;
/** Une automatisation est en cours : le toast de progression a la main. */
let busy = false;

function hidePanel(): void {
  hideToast('price');
}

function showPanel(title: string, price: number | null, detail: string, onClose: () => void): void {
  priceToast({ cardName: title, price, priceText: price != null ? formatPrice(price) : 'Prix à saisir', detail, onClose });
}

/** Toast de progression (automatisations) avec bouton Arrêter. Le texte peut tenir sur plusieurs lignes : la 1re est l'étape. */
export function showProgress(
  title: string,
  text: string,
  opts: { onStop?: () => void; error?: boolean; done?: boolean; step?: number; total?: number } = {},
): void {
  busy = !opts.done && !opts.error;
  // Pendant une automatisation, le prix conseillé laisse la place à la progression.
  if (busy) hidePanel();
  const [first, ...lines] = text.split('\n');
  progressToast({
    title,
    text: first,
    lines,
    done: opts.step,
    total: opts.total,
    error: opts.error,
    finished: opts.done,
    onStop: opts.onStop,
    onClose: () => {
      busy = false;
      opts.onStop?.();
    },
  });
}

export function endProgress(): void {
  busy = false;
  hideToast('progress');
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

/** Conteneur où poser les pastilles : le wrapper « relative isolate group » de la carte (au-dessus des effets de la carte). */
function chipHost(tile: Element): HTMLElement {
  const parent = tile.parentElement;
  if (parent && /\b(group|isolate)\b/.test(parent.className) && parent.children.length <= 4) return parent;
  return tile as HTMLElement;
}

export let lastChipCount = 0;

/** Pastilles des étiquettes sur les cartes de la collection (mises à jour seulement si elles changent). */
function renderBadges(state: OverlayState): void {
  for (const old of qsa(document, '[data-wiky-focus]')) {
    (old as HTMLElement).style.outline = '';
    old.removeAttribute('data-wiky-focus');
  }
  const keep = new Set<Element>();
  lastChipCount = 0;
  if (state.tiles && state.store.settings.showTagOverlay) {
    for (const [cardId, tile] of state.tiles) {
      const tags = state.store.cards[cardId]?.tags ?? [];
      const host = chipHost(tile);
      renderTagChips(host, tags, state.tagColors ?? new Map(), state.store.settings.tagOverlayStyle);
      const box = host.querySelector(':scope > [data-wiky="tags"]');
      if (box) {
        keep.add(box);
        lastChipCount++;
      }
    }
  }
  // Pastilles de cartes qui ne sont plus affichées (ou option désactivée).
  for (const box of qsa(document, '[data-wiky="tags"], [data-wiky="badge"]')) if (!keep.has(box)) box.remove();
}

export function updateOverlay(state: OverlayState): void {
  renderBadges(state);
  if (busy) return;

  const sell = findSellDialog(state);
  if (sell) {
    const advice = sell.card ? adviceForCard(state.store, sell.card.id) : null;
    // Carte ouverte depuis Wiky-Traders : son prix proposé (règle du slot) fait foi, pas un recalcul.
    const pending = state.store.pendingFocus;
    const fromProposal = !!pending && (!sell.card || sell.card.id === pending.cardId);
    // V4 : à l'ouverture de la fenêtre, la mise (pré-remplie à 10 par le site) et la durée sont réglées une fois ;
    // le clic « Mettre aux enchères » reste humain.
    const price = fromProposal ? pending!.price : advice?.pricing.price ?? null;
    const minutes = fromProposal && pending!.durationMin !== undefined ? pending!.durationMin ?? null : durationFor(price, state.store.settings.durationRules);
    const withDuration = (detail: string) => (minutes != null ? `${detail}\nDurée conseillée : ${durationLabel(minutes)}` : detail);
    const open = state.store.settings.prefill ? openSellDialog(state.cfg) : null;
    if (open && !filledInputs.has(open.input)) {
      filledInputs.add(open.input);
      if (price != null) fillInput(open.input, String(price));
      if (minutes != null) selectSellDuration(state.cfg, minutes);
    }
    if (fromProposal) showPanel(pending!.cardName, pending!.price, withDuration(pending!.detail), () => {});
    else if (sell.card && advice) showPanel(sell.card.name, advice.pricing.price, withDuration(`${advice.pricing.detail} · étiquette ${advice.rule.tag}`), () => {});
    else hidePanel();
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
