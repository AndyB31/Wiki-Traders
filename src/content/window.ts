/**
 * Fenêtre flottante dans la page WikiMasters : l'interface de la popup dans une iframe,
 * déplaçable (barre de titre), redimensionnable (coin haut-gauche), réductible et fermable.
 * Elle est ancrée par son coin bas-droit : réduite, elle devient une barre à cet endroit et
 * s'agrandit vers le haut (pratique rangée en bas à droite).
 * Position, taille et état sont mémorisés ; l'icône de l'extension l'ouvre ou la ferme.
 */
import { ext } from '../lib/browser';

export interface FloatingState {
  open: boolean;
  minimized: boolean;
  /** Distance au bord droit de la fenêtre du navigateur. */
  r: number;
  /** Distance au bord bas. */
  b: number;
  w: number;
  h: number;
}

const KEY = 'floating';
const MIN_W = 300;
const MIN_H = 220;
const HEADER = 36;

export const DEFAULT_FLOATING: FloatingState = { open: true, minimized: false, r: 16, b: 16, w: 390, h: 600 };

const CSS = `
:host { all: initial; }
.win { box-sizing: border-box; position: fixed; z-index: 2147483645; display: flex; flex-direction: column; background: #fafaf9;
  border: 1px solid #d6d3d1; border-radius: 12px; box-shadow: 0 12px 36px rgba(0,0,0,.28); overflow: hidden;
  font: 13px/1.4 system-ui, -apple-system, 'Segoe UI', sans-serif; color: #1c1917; }
.win.min { height: ${HEADER}px !important; }
.bar { height: ${HEADER}px; flex: none; display: flex; align-items: center; gap: 8px; padding: 0 6px 0 10px;
  background: linear-gradient(90deg, #f59e0b, #d97706); color: #fff; cursor: move; user-select: none; touch-action: none; }
.bar img { width: 18px; height: 18px; }
.bar .t { flex: 1; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.bar button { all: unset; cursor: pointer; width: 26px; height: 26px; border-radius: 6px; display: grid; place-items: center; font-size: 15px; line-height: 1; }
.bar button:hover { background: rgba(255,255,255,.22); }
iframe { flex: 1; width: 100%; border: 0; background: #fafaf9; }
.win.min iframe, .win.min .grip { display: none; }
.grip { position: absolute; left: 0; top: 0; width: 14px; height: 14px; cursor: nwse-resize; touch-action: none; z-index: 1;
  background: linear-gradient(135deg, rgba(255,255,255,.9) 0 2px, transparent 2px), linear-gradient(315deg, transparent 55%, rgba(255,255,255,.75) 55% 65%, transparent 65% 75%, rgba(255,255,255,.75) 75% 85%, transparent 85%);
  border-top-left-radius: 12px; }
.bar { padding-left: 16px; }
.shield { position: fixed; inset: 0; z-index: 2147483646; cursor: inherit; }
@media (prefers-color-scheme: dark) { .win, iframe { background: #1c1917; border-color: #44403c; color: #f5f5f4; } }
`;

let host: HTMLElement | null = null;
let state: FloatingState = { ...DEFAULT_FLOATING };

function clamp(s: FloatingState): FloatingState {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const w = Math.min(Math.max(s.w, MIN_W), vw - 8);
  const h = Math.min(Math.max(s.h, MIN_H), vh - 8);
  const r = Math.min(Math.max(s.r, 0), Math.max(0, vw - Math.min(w, 120)));
  // Réduite, seule la barre doit rester visible ; agrandie, le haut de la fenêtre ne doit pas sortir de l'écran.
  const b = Math.min(Math.max(s.b, 0), Math.max(0, vh - (s.minimized ? HEADER : h)));
  return { ...s, w, h, r, b };
}

async function persist(): Promise<void> {
  await ext.storage.local.set({ [KEY]: state });
}

function apply(win: HTMLElement): void {
  state = clamp(state);
  Object.assign(win.style, { right: `${state.r}px`, bottom: `${state.b}px`, width: `${state.w}px`, height: `${state.h}px` });
  win.classList.toggle('min', state.minimized);
  const btn = win.querySelector<HTMLButtonElement>('.minbtn');
  if (btn) {
    btn.textContent = state.minimized ? '▢' : '–';
    btn.title = state.minimized ? 'Agrandir' : 'Réduire';
  }
}

/** Glisser (déplacement ou redimensionnement) avec un voile qui empêche l'iframe de capter la souris. */
function drag(e: PointerEvent, root: ShadowRoot, onMove: (dx: number, dy: number) => void, cursor: string): void {
  if (e.button !== 0) return;
  e.preventDefault();
  const shield = document.createElement('div');
  shield.className = 'shield';
  shield.style.cursor = cursor;
  root.append(shield);
  const sx = e.clientX;
  const sy = e.clientY;
  const move = (ev: PointerEvent) => onMove(ev.clientX - sx, ev.clientY - sy);
  const up = () => {
    shield.remove();
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    void persist();
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
}

function build(): HTMLElement {
  const el = document.createElement('div');
  el.setAttribute('data-wiky', 'window');
  const root = el.attachShadow({ mode: 'open' });
  root.innerHTML = `<style>${CSS}</style>
    <div class="win" role="dialog" aria-label="Wiky-Traders">
      <div class="bar">
        <img src="${ext.runtime.getURL('icons/icon-32.png')}" alt="">
        <span class="t">Wiky-Traders</span>
        <button class="minbtn" type="button">–</button>
        <button class="close" type="button" title="Fermer (rouvrir avec l'icône de l'extension)">×</button>
      </div>
      <iframe src="${ext.runtime.getURL('popup.html?embed=1')}" title="Wiky-Traders"></iframe>
      <div class="grip" title="Redimensionner"></div>
    </div>`;
  const win = root.querySelector<HTMLElement>('.win')!;
  const bar = root.querySelector<HTMLElement>('.bar')!;

  bar.addEventListener('pointerdown', (e) => {
    if ((e.target as Element).closest('button')) return;
    const { r, b } = state;
    drag(e, root, (dx, dy) => {
      state.r = r - dx;
      state.b = b - dy;
      apply(win);
    }, 'move');
  });
  bar.addEventListener('dblclick', (e) => {
    if ((e.target as Element).closest('button')) return;
    state.minimized = !state.minimized;
    apply(win);
    void persist();
  });
  root.querySelector('.grip')!.addEventListener('pointerdown', (e) => {
    // Poignée en haut à gauche : le coin bas-droit reste fixe.
    const { w, h } = state;
    drag(e as PointerEvent, root, (dx, dy) => {
      state.w = w - dx;
      state.h = h - dy;
      apply(win);
    }, 'nwse-resize');
  });
  root.querySelector('.minbtn')!.addEventListener('click', () => {
    state.minimized = !state.minimized;
    apply(win);
    void persist();
  });
  root.querySelector('.close')!.addEventListener('click', () => void setOpen(false));
  window.addEventListener('resize', () => apply(win));
  apply(win);
  return el;
}

function render(): void {
  if (state.open && !host?.isConnected) {
    host = build();
    document.documentElement.appendChild(host);
  } else if (!state.open && host) {
    host.remove();
    host = null;
  } else if (host) {
    apply(host.shadowRoot!.querySelector<HTMLElement>('.win')!);
  }
}

export async function setOpen(open: boolean): Promise<void> {
  state = { ...state, open, minimized: open ? false : state.minimized };
  render();
  await persist();
}

export function toggleWindow(): Promise<void> {
  return setOpen(!(state.open && host?.isConnected));
}

/** Restaure la fenêtre telle qu'elle était (ouverte par défaut à la première visite). */
export async function initWindow(): Promise<void> {
  const saved = (await ext.storage.local.get(KEY))[KEY] as Partial<FloatingState> | undefined;
  // Les anciennes versions ancraient la fenêtre en haut à gauche (x, y) : on repart du coin bas-droit.
  state = saved && 'r' in saved ? { ...DEFAULT_FLOATING, ...saved } : { ...DEFAULT_FLOATING, open: saved?.open ?? true };
  render();
  ext.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes[KEY]) return;
    const next = changes[KEY].newValue as FloatingState | undefined;
    if (!next) return;
    // Synchronise l'ouverture et l'état réduit entre les onglets ; la position reste propre à chaque onglet pendant un glisser.
    if (next.open !== state.open || next.minimized !== state.minimized) {
      state = { ...state, open: next.open, minimized: next.minimized };
      render();
    }
  });
}
