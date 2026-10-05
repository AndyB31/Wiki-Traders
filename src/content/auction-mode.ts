/**
 * Mode enchère de la collection : un interrupteur sur la ligne du titre « Collection » (à côté de « Sélectionner »).
 * Activé, un clic sur une carte ouvre directement sa fenêtre « Mettre aux enchères », prix et durée pré-remplis ;
 * le clic final « Mettre aux enchères » reste toujours à toi.
 * Seuls les vrais clics sont interceptés (`isTrusted`) : ceux que fait l'extension pour ouvrir la carte passent.
 */
export interface AuctionModeHooks {
  /** Carte de la collection sous le clic. */
  findTile: (target: Element) => { cardId: string; tile: Element } | null;
  /** Ouvre la vente de la carte, prix et durée remplis. */
  sell: (cardId: string, tile: Element) => void;
  /** Le pré-remplissage (V4) est-il autorisé dans les réglages ? */
  prefillAllowed: () => boolean;
  /** Autorise le pré-remplissage (après confirmation). */
  allowPrefill: () => Promise<void>;
}

const KEY = 'wiky-auction-mode';

const CSS = `
.wiky-switch { margin-left: auto; display: inline-flex; align-items: center; gap: 8px; padding: 6px 12px 6px 8px; border-radius: 10px; cursor: pointer;
  border: 1px solid var(--color-border); background: var(--color-surface-light, var(--color-surface)); font: inherit; font-size: 14px; font-weight: 500;
  color: color-mix(in srgb, var(--color-foreground) 70%, transparent); transition: all .2s ease; white-space: nowrap; }
.wiky-switch:hover { color: var(--color-foreground); border-color: rgba(249,115,22,.4); }
.wiky-switch:focus-visible { outline: 2px solid rgba(251,146,60,.7); outline-offset: 2px; }
.wiky-switch-track { position: relative; width: 30px; height: 18px; border-radius: 999px; flex: none; transition: background .2s ease;
  background: color-mix(in srgb, var(--color-foreground) 18%, transparent); }
.wiky-switch-knob { position: absolute; top: 2px; left: 2px; width: 14px; height: 14px; border-radius: 50%; background: #fff; transition: transform .2s ease; box-shadow: 0 1px 2px rgba(0,0,0,.4); }
.wiky-switch[aria-checked="true"] { border-color: rgba(249,115,22,.5); background: rgba(249,115,22,.12); color: #fdba74; }
.wiky-switch[aria-checked="true"] .wiky-switch-track { background: #f97316; }
.wiky-switch[aria-checked="true"] .wiky-switch-knob { transform: translateX(12px); }
html[data-wiky-auction] main .group.isolate > div[class*="glow-"] { cursor: pointer; transition: outline-color .15s ease; outline: 2px solid transparent; outline-offset: 3px; border-radius: 12px; }
html[data-wiky-auction] main .group.isolate:hover > div[class*="glow-"] { outline-color: #f97316; }
html[data-wiky-auction] main .group.isolate:hover::after { content: 'Mettre aux enchères'; position: absolute; left: 50%; bottom: -10px; transform: translateX(-50%); z-index: 45;
  padding: 2px 8px; border-radius: 999px; background: #f97316; color: #fff; font: 600 10px/1.6 system-ui, sans-serif; white-space: nowrap; pointer-events: none; }
`;

let enabled = readEnabled();
let hooks: AuctionModeHooks | null = null;
let listening = false;

function readEnabled(): boolean {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

function setEnabled(on: boolean): void {
  enabled = on;
  try {
    localStorage.setItem(KEY, on ? '1' : '0');
  } catch {
    // Stockage indisponible : le mode reste actif jusqu'au rechargement.
  }
  syncDocument();
}

export function auctionModeEnabled(): boolean {
  return enabled;
}

function onCollection(): boolean {
  return location.pathname === '/collection' && !new URLSearchParams(location.search).has('wiky');
}

function syncDocument(): void {
  const on = enabled && onCollection();
  if (on !== document.documentElement.hasAttribute('data-wiky-auction')) document.documentElement.toggleAttribute('data-wiky-auction', on);
  const sw = document.querySelector('[data-wiky="auction-switch"]');
  if (sw && sw.getAttribute('aria-checked') !== String(enabled)) sw.setAttribute('aria-checked', String(enabled));
}

function ensureStyle(): void {
  if (document.getElementById('wiky-auction-style')) return;
  const style = document.createElement('style');
  style.id = 'wiky-auction-style';
  style.setAttribute('data-wiky', 'style');
  style.textContent = CSS;
  (document.head ?? document.documentElement).append(style);
}

function onClick(e: MouseEvent): void {
  if (!enabled || !hooks || !onCollection() || !e.isTrusted || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  const target = e.target instanceof Element ? e.target : null;
  // Les boutons de la carte (favori, Wikipédia…) et nos propres éléments gardent leur rôle.
  if (!target || target.closest('button, a, input, select, textarea, [role="button"], [data-wiky="auction-switch"], [data-wiky="modal"]')) return;
  const hit = hooks.findTile(target);
  if (!hit) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  hooks.sell(hit.cardId, hit.tile);
}

/** Titre « Collection » et sa ligne (où se trouve « Sélectionner »). */
function titleRow(): { row: Element; before: Element | null } | null {
  const h1 = [...document.querySelectorAll('main h1')].find((h) => /^\s*(ma\s+)?collection\s*$/i.test(h.textContent ?? ''));
  const row = h1?.parentElement;
  if (!h1 || !row) return null;
  // Juste avant « Sélectionner » (dernier élément de la ligne) ; sinon après le titre.
  const last = row.lastElementChild;
  return { row, before: last && last !== h1 && !last.matches('[data-wiky]') ? last : null };
}

export function renderAuctionSwitch(h: AuctionModeHooks): void {
  hooks = h;
  if (!listening) {
    listening = true;
    document.addEventListener('click', onClick, true);
  }
  syncDocument();
  const existing = document.querySelector<HTMLElement>('[data-wiky="auction-switch"]');
  if (!onCollection()) {
    existing?.remove();
    return;
  }
  if (existing?.isConnected) return;
  const place = titleRow();
  if (!place) return;
  ensureStyle();
  const sw = document.createElement('button');
  sw.type = 'button';
  sw.className = 'wiky-switch';
  sw.setAttribute('data-wiky', 'auction-switch');
  sw.setAttribute('role', 'switch');
  sw.setAttribute('aria-checked', String(enabled));
  sw.title = 'Mode enchère : un clic sur une carte ouvre « Mettre aux enchères », prix et durée pré-remplis';
  sw.innerHTML = '<span class="wiky-switch-track"><span class="wiky-switch-knob"></span></span><span>Mode enchère</span>';
  sw.addEventListener('click', async () => {
    if (!enabled && !h.prefillAllowed()) {
      const ok = confirm(
        'Mode enchère\n\nUn clic sur une carte ouvrira sa fenêtre « Mettre aux enchères » et remplira le prix et la durée (le clic final reste le tien).\n\n' +
          'Les règles de WikiMasters (section 3) interdisent les outils qui interagissent à ta place : ton compte peut être banni sans préavis.\n\nActiver quand même ?',
      );
      if (!ok) return;
      await h.allowPrefill();
    }
    setEnabled(!enabled);
  });
  if (place.before) place.row.insertBefore(sw, place.before);
  else place.row.append(sw);
}
