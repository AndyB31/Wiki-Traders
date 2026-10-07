/**
 * Petits éléments d'interface « comme le site » partagés par les modules (paquets, échanges, mises) :
 * panneau, boutons, pastille de rareté, fenêtre de confirmation. Mêmes variables de couleur que le site
 * (--color-surface, --color-border, --color-foreground) et orange Wiki-Traders (#f97316).
 * Tout nœud porte `data-wiky` (ignoré par l'observateur de mutations).
 */
import type { Rarity } from '../../lib/types';

/** Couleurs des raretés (proches de celles du site). */
export const RARITY_COLORS: Record<Rarity, string> = {
  C: '#b7c1ce',
  PC: '#6ee7ad',
  R: '#64bfff',
  SR: '#c98cff',
  UR: '#ff9f43',
  L: '#ffd45a',
};

export const RARITY_ORDER: Rarity[] = ['C', 'PC', 'R', 'SR', 'UR', 'L'];

const CSS = `
.wiky-f-panel { box-sizing: border-box; border-radius: 14px; border: 1px solid var(--color-border, rgba(255,255,255,.12)); background: var(--color-surface, #1c1917);
  color: var(--color-foreground, #e7e5e4); font-size: 13px; line-height: 1.4; box-shadow: 0 18px 48px rgba(0,0,0,.45); }
.wiky-f-float { position: fixed; right: 16px; bottom: 16px; z-index: 2147483645; width: min(380px, calc(100vw - 32px)); max-height: min(70vh, 640px);
  display: flex; flex-direction: column; overflow: hidden; animation: wiky-f-up .18s ease; }
.wiky-f-head { display: flex; align-items: center; gap: 8px; padding: 10px 12px 8px 14px; border-bottom: 1px solid var(--color-border, rgba(255,255,255,.12)); }
.wiky-f-head small { display: block; font-size: 10px; font-weight: 700; letter-spacing: .05em; text-transform: uppercase; color: #fb923c; }
.wiky-f-head strong { font-size: 14px; }
.wiky-f-x { margin-left: auto; all: unset; cursor: pointer; width: 24px; height: 24px; display: grid; place-items: center; border-radius: 7px; font-size: 16px;
  color: color-mix(in srgb, var(--color-foreground, #e7e5e4) 55%, transparent); }
.wiky-f-head .wiky-f-x { margin-left: auto; }
.wiky-f-x:hover { background: var(--color-surface-light, rgba(255,255,255,.08)); color: var(--color-foreground, #fff); }
.wiky-f-body { overflow-y: auto; padding: 6px 8px; }
.wiky-f-foot { padding: 8px 14px 10px; border-top: 1px solid var(--color-border, rgba(255,255,255,.12)); font-size: 12px;
  color: color-mix(in srgb, var(--color-foreground, #e7e5e4) 65%, transparent); display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.wiky-f-foot b { color: #fdba74; font-size: 14px; font-variant-numeric: tabular-nums; }
.wiky-f-row { display: flex; align-items: center; gap: 8px; padding: 5px 6px; border-radius: 8px; }
.wiky-f-row:hover { background: var(--color-surface-light, rgba(255,255,255,.05)); }
.wiky-f-row .wiky-f-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; }
.wiky-f-row .wiky-f-price { flex-shrink: 0; font-variant-numeric: tabular-nums; font-weight: 700; }
.wiky-f-muted { color: color-mix(in srgb, var(--color-foreground, #e7e5e4) 50%, transparent); }
.wiky-f-rar { flex-shrink: 0; min-width: 22px; padding: 1px 5px; border-radius: 6px; font-size: 10px; font-weight: 800; text-align: center; color: #111;
  background: var(--wiky-rar, #94a3b8); }
.wiky-f-tag { flex-shrink: 0; padding: 1px 6px; border-radius: 999px; font-size: 10px; font-weight: 700; }
.wiky-f-tag.new { background: rgba(34,197,94,.16); color: #4ade80; }
.wiky-f-tag.dup { background: var(--color-surface-light, rgba(255,255,255,.08)); color: color-mix(in srgb, var(--color-foreground, #e7e5e4) 60%, transparent); }
.wiky-f-btn { cursor: pointer; border-radius: 10px; padding: 6px 12px; font: inherit; font-size: 12.5px; font-weight: 700; border: 1px solid transparent;
  background: #f97316; color: #fff; transition: filter .15s ease; }
.wiky-f-btn:hover { filter: brightness(1.08); }
.wiky-f-btn:disabled { opacity: .55; cursor: default; filter: none; }
.wiky-f-btn.ghost { background: transparent; border-color: var(--color-border, rgba(255,255,255,.18)); color: color-mix(in srgb, var(--color-foreground, #e7e5e4) 80%, transparent); }
.wiky-f-btn.ghost:hover { background: var(--color-surface-light, rgba(255,255,255,.06)); }
.wiky-f-btn.small { padding: 3px 8px; font-size: 11px; border-radius: 8px; }
.wiky-f-confirm { position: fixed; inset: 0; z-index: 2147483647; display: grid; place-items: center; padding: 18px; background: rgba(0,0,0,.6); animation: wiky-f-fade .15s ease; }
.wiky-f-confirm .wiky-f-panel { width: min(420px, 100%); padding: 16px 18px; }
.wiky-f-confirm h2 { margin: 0 0 8px; font-size: 16px; font-weight: 700; }
.wiky-f-confirm p { margin: 0 0 6px; white-space: pre-line; color: color-mix(in srgb, var(--color-foreground, #e7e5e4) 75%, transparent); }
.wiky-f-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 14px; }
@keyframes wiky-f-up { from { opacity: 0; transform: translateY(8px); } }
@keyframes wiky-f-fade { from { opacity: 0; } }
`;

/** Feuille de style des modules (une seule fois). */
export function ensureFeatureStyle(extra = '', id = 'base'): void {
  const sid = `wiky-f-style-${id}`;
  if (document.getElementById(sid)) return;
  const style = document.createElement('style');
  style.id = sid;
  style.setAttribute('data-wiky', 'style');
  style.textContent = id === 'base' ? CSS + extra : extra;
  (document.head ?? document.documentElement).append(style);
}

/** Élément marqué `data-wiky` (classe, texte). */
export function node<K extends keyof HTMLElementTagNameMap>(tag: K, wiky: string, className = '', text?: string): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  n.setAttribute('data-wiky', wiky);
  if (className) n.className = className;
  if (text != null) n.textContent = text;
  return n;
}

export function button(text: string, onClick: (e: MouseEvent) => void, variant: '' | 'ghost' = '', small = false): HTMLButtonElement {
  const b = node('button', 'btn', `wiky-f-btn${variant ? ` ${variant}` : ''}${small ? ' small' : ''}`, text);
  b.type = 'button';
  b.addEventListener('click', (e) => {
    // Les fenêtres du site se ferment au clic à l'extérieur, et certaines cartes sont cliquables.
    e.preventDefault();
    e.stopPropagation();
    onClick(e);
  });
  return b;
}

export function rarityChip(rarity: Rarity | null): HTMLElement {
  const chip = node('span', 'rar', 'wiky-f-rar', rarity ?? '—');
  if (rarity) chip.style.setProperty('--wiky-rar', RARITY_COLORS[rarity]);
  return chip;
}

/** « 1 234 W » ; « — » si inconnu. */
export function wiki(n: number | null | undefined): string {
  return n == null ? '—' : `${Math.round(n).toLocaleString('fr-FR')} W`;
}

/** Panneau flottant (bas à droite) avec en-tête et bouton de fermeture ; le corps est rempli par l'appelant. */
export function floatingPanel(id: string, kicker: string, title: string, onClose: () => void): { panel: HTMLElement; body: HTMLElement; foot: HTMLElement } {
  ensureFeatureStyle();
  document.querySelector(`[data-wiky="${id}"]`)?.remove();
  const panel = node('aside', id, 'wiky-f-panel wiky-f-float');
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', title);
  const head = node('div', 'part', 'wiky-f-head');
  const titles = node('div', 'part');
  titles.append(node('small', 'part', '', kicker), node('strong', 'part', '', title));
  const x = node('button', 'part', 'wiky-f-x', '×');
  x.type = 'button';
  x.title = 'Fermer';
  x.setAttribute('aria-label', 'Fermer');
  x.addEventListener('click', (e) => {
    e.stopPropagation();
    panel.remove();
    onClose();
  });
  head.append(titles, x);
  const body = node('div', 'part', 'wiky-f-body');
  const foot = node('div', 'part', 'wiky-f-foot');
  panel.append(head, body, foot);
  for (const type of ['click', 'mousedown', 'pointerdown']) panel.addEventListener(type, (e) => e.stopPropagation());
  document.body.append(panel);
  return { panel, body, foot };
}

/** Fenêtre de confirmation du style du site ; résout `true` si l'utilisateur confirme. */
export function confirmDialog(opts: { title: string; text: string; confirm: string; cancel?: string }): Promise<boolean> {
  ensureFeatureStyle();
  return new Promise((resolve) => {
    const overlay = node('div', 'confirm', 'wiky-f-confirm');
    const box = node('div', 'part', 'wiky-f-panel');
    box.setAttribute('role', 'alertdialog');
    box.setAttribute('aria-modal', 'true');
    box.setAttribute('aria-label', opts.title);
    const actions = node('div', 'part', 'wiky-f-actions');
    const done = (v: boolean) => {
      document.removeEventListener('keydown', onKey, true);
      overlay.remove();
      resolve(v);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        done(false);
      }
    };
    const ok = button(opts.confirm, () => done(true));
    ok.dataset.act = 'confirm';
    const no = button(opts.cancel ?? 'Annuler', () => done(false), 'ghost');
    no.dataset.act = 'cancel';
    actions.append(no, ok);
    box.append(node('h2', 'part', '', opts.title), node('p', 'part', '', opts.text), actions);
    overlay.append(box);
    for (const type of ['click', 'mousedown', 'pointerdown']) overlay.addEventListener(type, (e) => e.stopPropagation());
    overlay.addEventListener('mousedown', (e) => {
      if (e.target === overlay) done(false);
    });
    document.addEventListener('keydown', onKey, true);
    document.body.append(overlay);
    ok.focus();
  });
}
