/**
 * Contrôles de la page /collection du site, remplis pour une vue (voir features/collection-views.ts) : la collection
 * est paginée (≈ 50 cartes par page), filtrer avec ses propres champs met les bonnes cartes sur les pages.
 *
 * Relevé sur le site réel (2026-10-26) :
 *  - recherche : `input[placeholder^="Rechercher"]` (« Rechercher par titre ou catégorie... »), champ React ;
 *  - étiquette : bouton `[aria-label="Filtrer par étiquette"]` → liste `#<aria-controls>` de `[role=option]` :
 *    « Toutes les étiquettes », « Sans étiquette », « #20-100 (142) »…, « Gérer les étiquettes… » ; une seule à la fois ;
 *  - tri : bouton `[aria-label="Trier la collection"]` → « Rareté » (défaut, Légendaire d'abord), « Nom » (A → Z),
 *    « Favoris », « Date d'ajout » ; pas de choix du sens ;
 *  - rareté : pastilles L, UR, SR, R, PC, C (style `--color-rarity-*`), plusieurs à la fois ; inactive = `opacity-50` ;
 *  - aucun de ces réglages n'est gardé dans l'adresse.
 * Ce ne sont que des réglages d'affichage de ma collection (aucune action de jeu).
 */
import { normalize, sameTag } from '../lib/text';
import type { Rarity } from '../lib/types';
import { pickSiteSort, siteTagName, type CollectionView, type SiteFilters, type ViewSortKey } from '../lib/views';
import { fillInput, sleep } from './actions';

const RARITY_CODES: Rarity[] = ['L', 'UR', 'SR', 'R', 'PC', 'C'];
const TAG_BUTTON = '[aria-label="Filtrer par étiquette"]';
const SORT_BUTTON = '[aria-label="Trier la collection"]';
/** Tri du site au chargement de la page. */
export const SITE_DEFAULT_SORT = 'Rareté';

/** Ce qui a pu être réglé sur le site (affiché dans le bandeau de la vue). */
export interface SiteApplied {
  q: string;
  tag: string | null;
  untagged: boolean;
  rarities: Rarity[];
  /** Libellé du tri choisi sur le site, et s'il range exactement comme la vue (sinon chaque page est rangée en plus). */
  sort: string | null;
  sortExact: boolean;
}

function main(): ParentNode {
  return document.querySelector('main') ?? document;
}

export function searchInput(): HTMLInputElement | null {
  return [...main().querySelectorAll<HTMLInputElement>('input[placeholder^="Rechercher" i]')].find((i) => !i.closest('[data-wiky]')) ?? null;
}

/** Les contrôles du site sont-ils affichés (page chargée) ? */
export function siteControlsReady(): boolean {
  return !!searchInput() && !!document.querySelector(SORT_BUTTON);
}

/** Clic complet sans faire défiler la page (les listes du site réagissent à pointerdown). */
function press(el: Element): void {
  const opts = { bubbles: true, cancelable: true, composed: true, button: 0, pointerId: 1, pointerType: 'mouse', isPrimary: true };
  const P = typeof PointerEvent === 'function' ? PointerEvent : MouseEvent;
  el.dispatchEvent(new P('pointerdown', opts));
  el.dispatchEvent(new MouseEvent('mousedown', opts));
  el.dispatchEvent(new P('pointerup', opts));
  el.dispatchEvent(new MouseEvent('mouseup', opts));
  (el as HTMLElement).click();
}

const label = (el: Element | null | undefined) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();

/** Ouvre une liste du site, choisit l'option voulue (ou la referme), et rend le libellé affiché ensuite. */
async function chooseOption(buttonSel: string, pick: (labels: string[]) => number | null): Promise<string | null> {
  const button = document.querySelector<HTMLElement>(buttonSel);
  if (!button) return null;
  press(button);
  let options: HTMLElement[] = [];
  for (let i = 0; i < 15 && !options.length; i++) {
    await sleep(80);
    const id = button.getAttribute('aria-controls');
    const list = (id && document.getElementById(id)) || document.querySelector('[role="listbox"]');
    options = list ? [...list.querySelectorAll<HTMLElement>('[role="option"]')] : [];
  }
  const i = options.length ? pick(options.map(label)) : null;
  if (i == null || !options[i]) {
    if (button.getAttribute('aria-expanded') === 'true') press(button);
    return label(button) || null;
  }
  press(options[i]);
  await sleep(150);
  return label(button) || null;
}

function rarityChips(): Map<Rarity, HTMLElement> {
  const out = new Map<Rarity, HTMLElement>();
  for (const b of main().querySelectorAll<HTMLElement>('button')) {
    const t = label(b) as Rarity;
    if (RARITY_CODES.includes(t) && /color-rarity/.test(b.getAttribute('style') ?? '') && !b.closest('[data-wiky]') && !out.has(t)) out.set(t, b);
  }
  return out;
}

const chipOn = (b: HTMLElement) => b.getAttribute('aria-pressed') === 'true' || !b.classList.contains('opacity-50');

async function setRarities(wanted: Rarity[]): Promise<Rarity[]> {
  for (const [r, chip] of rarityChips()) {
    if (chipOn(chip) !== wanted.includes(r)) {
      press(chip);
      await sleep(60);
    }
  }
  return [...rarityChips()].filter(([, c]) => chipOn(c)).map(([r]) => r);
}

/** Remplit la recherche du site (ex. « Voir dans la collection » depuis la page d'une vue). */
export async function setSearch(q: string): Promise<string> {
  const input = searchInput();
  if (!input) return '';
  if (input.value !== q) fillInput(input, q);
  input.blur();
  return input.value;
}

async function setTag(tag: string | null, untagged: boolean): Promise<string | null> {
  const current = label(document.querySelector(TAG_BUTTON));
  const want = (l: string) => (untagged ? /^sans [ée]tiquette$/i.test(l) : tag ? sameTag(siteTagName(l), tag) : /^toutes les/i.test(l));
  if (current && want(current)) return current;
  return chooseOption(TAG_BUTTON, (labels) => {
    const i = labels.findIndex(want);
    return i < 0 ? null : i;
  });
}

async function setSort(sort: ViewSortKey | 'default', dir: 'asc' | 'desc'): Promise<{ label: string | null; exact: boolean }> {
  let exact = false;
  const pick = (labels: string[]) => {
    if (sort === 'default') {
      const i = labels.findIndex((l) => normalize(l) === normalize(SITE_DEFAULT_SORT));
      return i < 0 ? null : i;
    }
    const found = pickSiteSort(labels, sort, dir);
    exact = !!found?.exact;
    // Tri inconnu du site : on revient à son tri par défaut (chaque page est ensuite rangée par la vue).
    if (!found) {
      const i = labels.findIndex((l) => normalize(l) === normalize(SITE_DEFAULT_SORT));
      return i < 0 ? null : i;
    }
    return found.index;
  };
  const current = label(document.querySelector(SORT_BUTTON));
  // Déjà sur la bonne option : pas besoin d'ouvrir la liste (un tri inconnu du site l'ouvre : on ne sait pas encore s'il y est).
  const isDefault = normalize(current) === normalize(SITE_DEFAULT_SORT);
  const already = sort === 'default' ? isDefault : current ? pickSiteSort([current], sort, dir) : null;
  if (current && already) return { label: current, exact: typeof already === 'object' && already.exact };
  const shown = await chooseOption(SORT_BUTTON, pick);
  return { label: shown, exact };
}

/** Remplit les contrôles du site pour la vue. */
export async function applySiteFilters(view: CollectionView, f: SiteFilters): Promise<SiteApplied> {
  const q = await setSearch(f.q);
  const tagLabel = await setTag(f.tag, f.untagged);
  const rarities = await setRarities(f.rarities);
  const sort = await setSort(view.sort, view.dir);
  return {
    q,
    tag: tagLabel && !/^(toutes les|sans [ée]tiquette)/i.test(tagLabel) ? siteTagName(tagLabel) : null,
    untagged: !!tagLabel && /^sans [ée]tiquette$/i.test(tagLabel),
    rarities,
    sort: sort.label,
    sortExact: sort.exact,
  };
}

/** Remet les contrôles du site comme au chargement (en quittant une vue). */
export async function resetSiteFilters(): Promise<void> {
  await setSearch('');
  await setTag(null, false);
  await setRarities([]);
  await setSort('default', 'asc');
}
