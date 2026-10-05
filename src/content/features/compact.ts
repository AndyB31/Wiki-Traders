/**
 * Mode compact de la collection (et de la collection globale) : bouton « Compact » sur la ligne du titre,
 * cartes réduites par CSS seulement (aucun traitement par carte), choix mémorisé dans localStorage.
 */
import { collectionTools, ensureStyle, isCollection, isGlobalCollection, removeTool, toggleRootAttr } from './dom';
import { registerFeature } from './runtime';

const KEY = 'wiky-compact';
const ATTR = 'data-wiky-compact';

const CSS = `
html[${ATTR}] main div[class*="glow-"]:has(> div[class*="h-[45%]"]) { zoom: .76; }
`;

const ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 15 6 6"/><path d="m15 9 6-6"/><path d="M21 16v5h-5"/><path d="M21 8V3h-5"/><path d="M3 16v5h5"/><path d="m3 21 6-6"/><path d="M3 8V3h5"/><path d="M9 9 3 3"/></svg>';

function readOn(): boolean {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

let on = readOn();

function setOn(v: boolean): void {
  on = v;
  try {
    localStorage.setItem(KEY, v ? '1' : '0');
  } catch {
    // Stockage indisponible : le choix vaut jusqu'au rechargement.
  }
}

function sync(eligible: boolean): void {
  toggleRootAttr(ATTR, on && eligible);
  const b = document.querySelector('[data-tool="compact"]');
  if (b && b.getAttribute('aria-pressed') !== String(on)) b.setAttribute('aria-pressed', String(on));
}

registerFeature({
  keys: ['compactMode'],
  render(ctx) {
    const eligible = isCollection(ctx) || isGlobalCollection(ctx);
    if (!eligible) {
      removeTool('compact');
      sync(false);
      return;
    }
    ensureStyle('wiky-compact-style', CSS);
    sync(true);
    const tools = collectionTools();
    if (!tools || tools.querySelector('[data-tool="compact"]')) return;
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'wiky-tool';
    b.dataset.tool = 'compact';
    b.title = 'Réduire la taille des cartes pour en afficher davantage';
    b.setAttribute('aria-pressed', String(on));
    b.innerHTML = `${ICON}<span>Compact</span>`;
    b.addEventListener('click', () => {
      setOn(!on);
      sync(true);
    });
    tools.append(b);
  },
  cleanup() {
    removeTool('compact');
    toggleRootAttr(ATTR, false);
  },
});
