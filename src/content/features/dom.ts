/**
 * Outils communs aux modules d'affichage des cartes : repérage des cartes du site, de leur titre,
 * de la fiche ouverte, de la ligne du titre de la collection, et styles injectés une seule fois.
 *
 * Structure d'une carte du site (collection, collection globale, marché, fiche) :
 *   div.glow-{l|ur|sr|r|pc|c}.relative.rounded-2xl.overflow-hidden
 *     > img (fond de rareté) > div.inset-0.bg-gradient-to-b
 *     > div.absolute.top-0.h-[45%] (illustration ; logo /logo.png si la carte n'a pas d'image)
 *     > div.top-2.left-2 (rareté) > div.top-[45%] (h3 titre, p catégorie, ATK / DEF)
 */
import { slugify } from '../../lib/text';
import type { Card, Rarity } from '../../lib/types';
import type { FeatureContext } from './runtime';

/** Carte du site qui contient ce titre. */
export function cardRootOf(h3: Element): HTMLElement | null {
  return h3.closest<HTMLElement>('div[class*="glow-"]');
}

/** Toutes les cartes du site dans `scope` (une par titre). */
export function nativeCards(scope: ParentNode = document): HTMLElement[] {
  const out: HTMLElement[] = [];
  const seen = new Set<Element>();
  for (const h3 of scope.querySelectorAll('div[class*="glow-"] h3')) {
    const card = cardRootOf(h3);
    if (card && !seen.has(card) && !card.closest('[data-wiky]')) {
      seen.add(card);
      out.push(card);
    }
  }
  return out;
}

export function cardTitle(card: Element): string {
  return (card.querySelector('h3')?.textContent ?? '').replace(/\s+/g, ' ').trim();
}

const RARITY_CLASSES: [string, Rarity][] = [
  ['glow-l', 'L'],
  ['glow-ur', 'UR'],
  ['glow-sr', 'SR'],
  ['glow-r', 'R'],
  ['glow-pc', 'PC'],
  ['glow-c', 'C'],
];

export function cardRarity(card: Element): Rarity | null {
  for (const [cls, r] of RARITY_CLASSES) if (card.classList.contains(cls)) return r;
  return null;
}

/** Carte de ma collection correspondant à un titre (la collection est indexée par slug du nom). */
export function myCard(ctx: FeatureContext, title: string): Card | undefined {
  return ctx.cards[slugify(title)];
}

export function isCollection(ctx: FeatureContext): boolean {
  return ctx.path === '/collection' && !ctx.search.has('wiky');
}

export function isGlobalCollection(ctx: FeatureContext): boolean {
  return /^\/global-collection\/?$/.test(ctx.path);
}

/** Feuille de style d'un module, injectée une fois. */
export function ensureStyle(id: string, css: string): void {
  if (document.getElementById(id)) return;
  const style = document.createElement('style');
  style.id = id;
  style.setAttribute('data-wiky', 'style');
  style.textContent = css;
  (document.head ?? document.documentElement).append(style);
}

export function removeStyle(id: string): void {
  document.getElementById(id)?.remove();
}

/** Bascule un attribut de <html> sans mutation inutile. */
export function toggleRootAttr(name: string, on: boolean): void {
  const html = document.documentElement;
  if (html.hasAttribute(name) !== on) html.toggleAttribute(name, on);
}

/** Fiche d'une carte ouverte par le site (fenêtre avec un bouton « Fermer »). */
export function openCardPanels(): { panel: HTMLElement; card: HTMLElement; title: string }[] {
  const out: { panel: HTMLElement; card: HTMLElement; title: string }[] = [];
  for (const close of document.querySelectorAll('button[aria-label="Fermer"]')) {
    if (close.closest('[data-wiky]')) continue;
    const panel = close.closest<HTMLElement>('.card-frame');
    const h3 = panel?.querySelector('div[class*="glow-"] h3');
    const card = h3 ? cardRootOf(h3) : null;
    if (panel && card) out.push({ panel, card, title: cardTitle(card) });
  }
  return out;
}

const TOOLS_CSS = `
.wiky-coll-tools { display: inline-flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-left: auto; }
.wiky-coll-tools ~ .wiky-switch { margin-left: 0; }
.wiky-tool { display: inline-flex; align-items: center; gap: 6px; padding: 6px 12px; border-radius: 10px; cursor: pointer; white-space: nowrap;
  border: 1px solid var(--color-border); background: var(--color-surface-light, var(--color-surface)); font: inherit; font-size: 14px; font-weight: 500;
  color: color-mix(in srgb, var(--color-foreground) 70%, transparent); transition: all .2s ease; }
.wiky-tool:hover { color: var(--color-foreground); border-color: rgba(249,115,22,.4); }
.wiky-tool:focus-visible { outline: 2px solid rgba(251,146,60,.7); outline-offset: 2px; }
.wiky-tool[aria-pressed="true"] { border-color: rgba(249,115,22,.5); background: rgba(249,115,22,.12); color: #fdba74; }
.wiky-tool svg { width: 16px; height: 16px; color: #fb923c; flex: none; }
`;

/**
 * Barre d'outils Wiky-Traders sur la ligne du titre de la collection (ou de la collection globale),
 * juste avant l'interrupteur « Mode enchère » s'il est déjà là, sinon avant « Sélectionner ».
 */
export function collectionTools(): HTMLElement | null {
  const existing = document.querySelector<HTMLElement>('[data-wiky="coll-tools"]');
  if (existing?.isConnected) return existing;
  const h1 = document.querySelector('main h1');
  const row = h1?.parentElement;
  if (!h1 || !row || row.closest('[data-wiky]')) return null;
  ensureStyle('wiky-tools-style', TOOLS_CSS);
  const tools = document.createElement('div');
  tools.className = 'wiky-coll-tools';
  tools.setAttribute('data-wiky', 'coll-tools');
  const sw = row.querySelector(':scope > [data-wiky="auction-switch"]');
  const last = row.lastElementChild;
  const before = sw ?? (last && last !== h1 && !last.matches('[data-wiky]') ? last : null);
  if (before) row.insertBefore(tools, before);
  else row.append(tools);
  return tools;
}

/** Retire un bouton de la barre d'outils (et la barre si elle est vide). */
export function removeTool(key: string): void {
  const tools = document.querySelector('[data-wiky="coll-tools"]');
  tools?.querySelector(`[data-tool="${key}"]`)?.remove();
  if (tools && !tools.children.length) tools.remove();
}

/** Empêche le site (clic sur la carte, fermeture de fenêtre) de voir les clics sur nos éléments. */
export function isolateClicks(node: HTMLElement): void {
  for (const type of ['click', 'mousedown', 'pointerdown', 'mouseup', 'pointerup']) node.addEventListener(type, (e) => e.stopPropagation());
}

export function wikipediaUrl(title: string): string {
  return `https://fr.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`;
}

export const RARITY_ACCENT: Record<Rarity, string> = {
  L: '#ffd45a',
  UR: '#ff9f43',
  SR: '#c98cff',
  R: '#64bfff',
  PC: '#6ee7ad',
  C: '#b7c1ce',
};

export function formatW(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(n);
}
