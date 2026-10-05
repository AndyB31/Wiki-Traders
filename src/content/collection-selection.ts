/**
 * Mode « Sélectionner » de la page /collection du site : détection du mode et des cartes cochées.
 *
 * Relevé sur le site réel :
 *  - mode actif ⇔ le bouton de la ligne de titre (à côté du h1 « Collection ») indique « Quitter la sélection »
 *    (« Sélectionner » sinon) ;
 *  - le site affiche alors sa propre barre d'actions fixe (`div.fixed.card-frame` : « N cartes sélectionnées »,
 *    « Tout sélectionner (page) », « Étiqueter », « Retirer l'étiquette », « Défausser (+N) ») → `siteSelectionBar()`,
 *    `siteSelectedCount()` ;
 *  - identifiant exact d'une carte : `data-wiky-ref="card:<uuid>"` posé par notre bridge.
 *
 * ⚠️ Heuristique : le marqueur « carte cochée » n'est pas encore connu. Tout ce qui en dépend est isolé ici
 * (`isCardSelected()` / `selectedCollectionCards()`). Indices reconnus, du plus sûr au moins sûr :
 *  - case à cocher dans la carte (`input[type=checkbox]:checked`, `[role=checkbox][aria-checked=true]`) ;
 *  - attribut d'état sur la carte ou son conteneur (`aria-selected`, `aria-pressed`, `aria-checked`,
 *    `data-selected`, `data-state="checked|on|selected"`) ;
 *  - classe de sélection (`selected`, `is-selected`, `ring-2`/`ring-4`, `outline`) — seulement en mode sélection.
 * Mode sélection : bouton « Sélectionner » enfoncé (aria-pressed / data-state), ou remplacé par « Annuler » /
 * « Terminer », ou compteur « N sélectionnée(s) », ou au moins une carte cochée.
 */

/** Cartes natives du site (collection, toutes les cartes, marché) : cadre de rareté `glow-*` avec un titre. */
export const NATIVE_CARD_SELECTOR = '[class*="glow-"]:has(h3), [data-wm-card-id]';

export function nativeCards(root: ParentNode = document): HTMLElement[] {
  let list: HTMLElement[];
  try {
    list = [...root.querySelectorAll<HTMLElement>(NATIVE_CARD_SELECTOR)];
  } catch {
    // :has() non pris en charge : repli plus large.
    list = [...root.querySelectorAll<HTMLElement>('[class*="glow-"], [data-wm-card-id]')].filter((e) => e.querySelector('h3'));
  }
  // Pas nos propres cartes, et pas une carte imbriquée dans une autre (ex. data-wm-card-id posé sur l'enfant).
  return list.filter((e) => !e.closest('[data-wiky]') && !e.parentElement?.closest(NATIVE_CARD_FALLBACK));
}
const NATIVE_CARD_FALLBACK = '[class*="glow-"], [data-wm-card-id]';

/** Titre affiché d'une carte native. */
export function nativeCardTitle(card: Element): string | null {
  return card.querySelector('h3')?.textContent?.trim() || null;
}

/**
 * Identifiant du site d'une carte native : `data-wiky-ref="card:<uuid>"` (notre bridge, sur la carte ou son
 * conteneur), sinon `data-wm-card-id` (« Prix moyen collection »).
 */
export function nativeCardSiteId(card: Element): string | null {
  const ref = (card.closest('[data-wiky-ref^="card:"]') ?? card.querySelector('[data-wiky-ref^="card:"]'))?.getAttribute('data-wiky-ref');
  if (ref) return ref.slice(5);
  return card.getAttribute('data-wm-card-id') ?? card.querySelector('[data-wm-card-id]')?.getAttribute('data-wm-card-id') ?? null;
}

const SELECT_LABEL = /^s[ée]lectionner$/i;
const QUIT_LABEL = /^quitter la s[ée]lection$/i;
const EXIT_LABEL = /^(annuler|terminer|quitter|fermer)( la)?( s[ée]lection)?$|^tout d[ée]s[ée]lectionner$/i;
const COUNTER = /\b\d+\s+(carte?s?\s+)?s[ée]lectionn[ée]e?s?\b/i;
const ON_STATE = /^(true|on|checked|selected|active)$/i;

function label(e: Element): string {
  return (e.textContent ?? '').replace(/\s+/g, ' ').trim();
}

function buttons(root: ParentNode): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>('button, [role="button"]')].filter((b) => !b.closest('[data-wiky]'));
}

/** Bouton « Sélectionner » du site (ou son remplaçant pendant la sélection). */
export function selectionToggle(root: ParentNode = document): HTMLElement | null {
  return buttons(root).find((b) => SELECT_LABEL.test(label(b))) ?? null;
}

/** La carte (ou son conteneur immédiat) est-elle marquée comme sélectionnée ? */
export function isCardSelected(card: Element, selectionMode = true): boolean {
  const scope = [card, card.parentElement].filter((e): e is HTMLElement => !!e);
  for (const e of scope) {
    if (e.querySelector(':scope input[type="checkbox"]:checked, :scope [role="checkbox"][aria-checked="true"]')) return true;
    for (const attr of ['aria-selected', 'aria-pressed', 'aria-checked', 'data-selected', 'data-state']) {
      const v = e.getAttribute(attr);
      if (v && ON_STATE.test(v)) return true;
    }
  }
  if (!selectionMode) return false;
  return scope.some((e) => /(^|\s)(selected|is-selected|ring-2|ring-4|outline-2)(\s|$)/.test(typeof e.className === 'string' ? e.className : ''));
}

/** Barre d'actions du site pendant la sélection (« N cartes sélectionnées », « Étiqueter », « Défausser »…). */
export function siteSelectionBar(root: ParentNode = document): HTMLElement | null {
  for (const bar of root.querySelectorAll<HTMLElement>('div.fixed')) {
    if (bar.closest('[data-wiky]')) continue;
    if (/s[ée]lectionn[ée]e?s?/i.test(bar.textContent ?? '') && bar.querySelector('button')) return bar;
  }
  return null;
}

/** Nombre de cartes sélectionnées annoncé par le site (premier `span.font-semibold` de sa barre). */
export function siteSelectedCount(root: ParentNode = document): number | null {
  const text = siteSelectionBar(root)?.querySelector('span.font-semibold')?.textContent ?? '';
  const n = Number.parseInt(text.replace(/\s/g, ''), 10);
  return Number.isFinite(n) ? n : null;
}

/** Le mode sélection du site est-il actif ? */
export function selectionModeActive(root: ParentNode = document): boolean {
  const btns = buttons(root);
  if (btns.some((b) => QUIT_LABEL.test(label(b)))) return true;
  if (siteSelectionBar(root)) return true;
  const toggle = btns.find((b) => SELECT_LABEL.test(label(b)));
  if (toggle) {
    for (const attr of ['aria-pressed', 'data-state', 'aria-checked']) {
      const v = toggle.getAttribute(attr);
      if (v && ON_STATE.test(v)) return true;
    }
  }
  if (btns.some((b) => EXIT_LABEL.test(label(b))) && !toggle) return true;
  const main = (root instanceof Document ? root.querySelector('main') : null) ?? root;
  if (COUNTER.test(main.textContent ?? '')) return true;
  return nativeCards(root).some((c) => isCardSelected(c, false));
}

/**
 * Cartes natives cochées en mode sélection (vide hors mode sélection). Point unique à adapter quand le DOM
 * exact du mode sélection sera connu.
 */
export function selectedCollectionCards(root: ParentNode = document): HTMLElement[] {
  if (!selectionModeActive(root)) return [];
  return nativeCards(root).filter((c) => isCardSelected(c, true));
}
