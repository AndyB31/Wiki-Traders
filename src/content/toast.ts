/**
 * Toasts « comme le site » : posés dans le DOM de la page (pas de shadow root), ils reprennent la surface
 * `card-frame`, l'animation `animate-fade-in-up` et les variables de couleur du site (--color-foreground,
 * --color-accent, --color-border). Les styles en ligne ne servent que de repli et à la mise en page.
 */

export type ToastId = 'price' | 'progress';

/** Couleur du texte du site à une opacité donnée (équivalent de `text-[var(--color-foreground)]/45`). */
export const fg = (pct: number) => `color-mix(in srgb, var(--color-foreground, #e7e5e4) ${pct}%, transparent)`;
const ACCENT = 'var(--color-accent, #f59e0b)';
const BORDER = 'var(--color-border, rgba(255,255,255,.12))';
const DANGER = '#f87171';

const LABEL_CLASS = 'text-[10px] font-semibold uppercase tracking-wide text-[var(--color-foreground)]/45';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, style: Partial<CSSStyleDeclaration> = {}, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  Object.assign(node.style, style);
  if (text != null) node.textContent = text;
  return node;
}

function stack(): HTMLElement {
  let box = document.querySelector<HTMLElement>('[data-wiky="toasts"]');
  if (box?.isConnected) return box;
  box = el('div', 'fixed bottom-4 right-4 flex flex-col gap-2', {
    position: 'fixed', right: '16px', bottom: '16px', zIndex: '2147483646', display: 'flex', flexDirection: 'column', alignItems: 'stretch',
    gap: '8px', width: 'min(360px, calc(100vw - 32px))', pointerEvents: 'none',
  });
  box.setAttribute('data-wiky', 'toasts');
  // Les fenêtres du site se ferment au clic à l'extérieur : un clic dans un toast ne doit pas les fermer.
  for (const type of ['click', 'mousedown', 'pointerdown']) box.addEventListener(type, (e) => e.stopPropagation());
  document.body.append(box);
  return box;
}

const timers = new Map<ToastId, ReturnType<typeof setTimeout>>();

/** Toast existant (mis à jour sur place : pas de nouvelle animation) ou nouveau toast. */
function slot(id: ToastId): { toast: HTMLElement; fresh: boolean } {
  clearTimeout(timers.get(id));
  const existing = document.querySelector<HTMLElement>(`[data-wiky="toast"][data-id="${id}"]`);
  if (existing?.isConnected) return { toast: existing, fresh: false };
  const toast = el('div', 'card-frame animate-fade-in-up', {
    // La classe « card-frame » donne la surface du site ; la position est la nôtre.
    position: 'relative', inset: 'auto', margin: '0', width: '100%', maxWidth: 'none', boxSizing: 'border-box', padding: '12px 14px',
    pointerEvents: 'auto', fontSize: '13px', lineHeight: '1.4', color: fg(90),
  });
  toast.setAttribute('data-wiky', 'toast');
  toast.dataset.id = id;
  toast.setAttribute('role', 'status');
  toast.setAttribute('aria-live', 'polite');
  // Le plus récent en bas, comme une pile de notifications.
  stack().append(toast);
  return { toast, fresh: true };
}

export function hideToast(id: ToastId): void {
  clearTimeout(timers.get(id));
  timers.delete(id);
  const toast = document.querySelector(`[data-wiky="toast"][data-id="${id}"]`);
  const box = toast?.parentElement;
  toast?.remove();
  if (box && !box.children.length) box.remove();
}

function header(label: string, onClose: () => void, error = false): HTMLElement {
  const row = el('div', 'flex items-center justify-between gap-3', { display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '4px' });
  const p = el('p', LABEL_CLASS, { margin: '0', fontSize: '10px', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '.05em', color: error ? DANGER : fg(45) }, label);
  const x = el('button', 'text-[var(--color-foreground)]/40 hover:text-[var(--color-foreground)]', {
    all: 'unset', cursor: 'pointer', marginLeft: 'auto', width: '20px', height: '20px', display: 'grid', placeItems: 'center', borderRadius: '6px',
    fontSize: '15px', lineHeight: '1', color: fg(40),
  }, '×');
  x.type = 'button';
  x.title = 'Fermer';
  x.setAttribute('aria-label', 'Fermer');
  x.addEventListener('click', onClose);
  row.append(p, x);
  return row;
}

function button(text: string, variant: 'accent' | 'ghost', onClick: () => void): HTMLButtonElement {
  const b = el('button', variant === 'accent' ? 'rounded-lg px-3 py-1.5 text-xs font-semibold' : 'rounded-lg px-3 py-1.5 text-xs font-semibold border', {
    cursor: 'pointer', borderRadius: '8px', padding: '5px 12px', fontSize: '12px', fontWeight: '600', fontFamily: 'inherit',
    ...(variant === 'accent'
      ? { border: '0', background: ACCENT, color: '#fff' }
      : { border: `1px solid ${BORDER}`, background: 'transparent', color: fg(75) }),
  }, text);
  b.type = 'button';
  b.addEventListener('click', onClick);
  return b;
}

/** Toast « prix conseillé » : carte, prix (couleur d'accent du site), détail du calcul, bouton Copier. */
export function priceToast(opts: { cardName: string; price: number | null; priceText: string; detail: string; onClose: () => void }): void {
  const key = JSON.stringify([opts.cardName, opts.price, opts.priceText, opts.detail]);
  const { toast } = slot('price');
  if (toast.dataset.key === key) return;
  toast.dataset.key = key;
  toast.replaceChildren();
  toast.append(header('Wiky-Traders · prix conseillé', () => {
    hideToast('price');
    opts.onClose();
  }));
  const row = el('div', 'flex items-baseline justify-between gap-3', { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '12px' });
  const name = el('span', 'min-w-0 truncate text-sm font-semibold', { minWidth: '0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: '14px', fontWeight: '600', color: fg(90) }, opts.cardName);
  const price = el('span', 'font-semibold tabular-nums text-[var(--color-accent)]', { flexShrink: '0', fontSize: '20px', fontWeight: '700', fontVariantNumeric: 'tabular-nums', color: opts.price != null ? ACCENT : fg(50) }, opts.priceText);
  row.append(name, price);
  const detail = el('p', 'text-[11px] text-[var(--color-foreground)]/50', { margin: '4px 0 0', fontSize: '11px', whiteSpace: 'pre-line', color: fg(50) }, opts.detail);
  const actions = el('div', 'flex items-center gap-2', { display: 'flex', alignItems: 'center', gap: '8px', marginTop: '10px' });
  const hint = el('span', 'text-[10px] text-[var(--color-foreground)]/35', { flex: '1', fontSize: '10px', color: fg(35) }, 'Le clic « Mettre aux enchères » reste le tien.');
  actions.append(hint);
  if (opts.price != null) {
    const value = String(opts.price);
    const copy = button('Copier', 'accent', async () => {
      await navigator.clipboard.writeText(value);
      copy.textContent = 'Copié ✓';
      setTimeout(() => (copy.textContent = 'Copier'), 1500);
    });
    actions.append(copy);
  }
  toast.append(row, detail, actions);
}

export interface ProgressToast {
  title: string;
  /** Première ligne : étape en cours ou résumé. */
  text: string;
  /** Lignes suivantes (journal court). */
  lines?: string[];
  done?: number;
  total?: number;
  error?: boolean;
  finished?: boolean;
  onStop?: () => void;
  onClose?: () => void;
}

const AUTO_HIDE = 10_000;

/** Toast de progression d'une automatisation : barre de progression, étape, journal court, bouton Arrêter. */
export function progressToast(p: ProgressToast): void {
  const { toast } = slot('progress');
  toast.dataset.key = '';
  toast.replaceChildren();
  toast.setAttribute('role', p.error ? 'alert' : 'status');
  toast.append(header(`Wiky-Traders · ${p.title}`, () => {
    hideToast('progress');
    p.onClose?.();
  }, p.error));
  const text = el('p', 'text-xs font-semibold text-[var(--color-foreground)]/85', { margin: '0', fontSize: '12px', fontWeight: '600', whiteSpace: 'pre-line', color: p.error ? DANGER : fg(85) }, p.text);
  toast.append(text);
  if (p.total) {
    const pct = Math.max(0, Math.min(100, ((p.done ?? 0) / p.total) * 100));
    const track = el('div', 'h-1 rounded-full overflow-hidden', { height: '4px', borderRadius: '999px', overflow: 'hidden', margin: '8px 0 2px', background: BORDER });
    track.setAttribute('role', 'progressbar');
    track.setAttribute('aria-valuemin', '0');
    track.setAttribute('aria-valuemax', String(p.total));
    track.setAttribute('aria-valuenow', String(p.done ?? 0));
    const fill = el('div', '', { height: '100%', width: `${pct}%`, borderRadius: 'inherit', background: p.error ? DANGER : ACCENT, transition: 'width .3s ease' });
    track.append(fill);
    toast.append(track);
  }
  if (p.lines?.length) {
    const log = el('div', 'text-[11px] text-[var(--color-foreground)]/50', { marginTop: '6px', maxHeight: '120px', overflowY: 'auto', fontSize: '11px', whiteSpace: 'pre-line', color: fg(50) });
    log.textContent = p.lines.join('\n');
    toast.append(log);
  }
  if (p.onStop && !p.finished && !p.error) {
    const actions = el('div', 'flex justify-end', { display: 'flex', justifyContent: 'flex-end', marginTop: '10px' });
    actions.append(button('Arrêter', 'ghost', p.onStop));
    toast.append(actions);
  }
  // Un résumé sans erreur disparaît de lui-même, comme une notification du site.
  if (p.finished && !p.error) timers.set('progress', setTimeout(() => hideToast('progress'), AUTO_HIDE));
}
