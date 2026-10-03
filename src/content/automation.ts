/**
 * V4 – pré-remplissage de la mise en vente, et étiquetage automatique.
 * Désactivés par défaut (voir l'avertissement dans les réglages). Le clic final
 * « Mettre en vente » n'est jamais fait par l'extension.
 */
import type { TagChange } from '../lib/autotag';
import { durationLabel } from '../lib/duration';
import { ActionError, fillInput, findByText, findExact, isChecked, pause, pressEscape, realClick, topDialog, waitFor } from './actions';
import { qsa, re, type SelectorConfig } from './parsers/selectors';

export type Log = (step: string) => void;

function priceInputIn(root: ParentNode, cfg: SelectorConfig): HTMLInputElement | null {
  return qsa<HTMLInputElement>(root, cfg.priceInput).find((i) => !i.disabled && !i.readOnly) ?? null;
}

/** Fenêtre de vente ouverte : conteneur qui contient le texte de vente et un champ prix. */
export function openSellDialog(cfg: SelectorConfig): { dialog: Element; input: HTMLInputElement } | null {
  const textRe = re(cfg.sellDialogRe);
  const dialogs = qsa(document, cfg.sellDialog).filter((d) => !d.closest('[data-wiky]') && textRe.test(d.textContent ?? ''));
  for (const dialog of dialogs.reverse()) {
    const input = priceInputIn(dialog, cfg);
    if (input) return { dialog, input };
  }
  return null;
}

/** Remplit le prix si le champ est vide (ne touche jamais au bouton de validation). */
export function fillSellPrice(cfg: SelectorConfig, price: number): boolean {
  const open = openSellDialog(cfg);
  if (!open) return false;
  fillInput(open.input, String(price));
  return true;
}

/** Clique le bouton de durée (« 10 min », « 1 h »…) de la fenêtre de vente. */
export function selectSellDuration(cfg: SelectorConfig, minutes: number): boolean {
  const open = openSellDialog(cfg);
  if (!open) return false;
  const button = findExact(open.dialog, durationLabel(minutes), 'button');
  if (!button) return false;
  realClick(button);
  return true;
}

/** Ouvre la carte, puis la fenêtre de vente, puis remplit le prix et choisit la durée. */
export async function prefillSale(tile: Element, price: number | null, cfg: SelectorConfig, log: Log, durationMin: number | null = null): Promise<void> {
  const sellRe = re(cfg.sellButtonRe);
  if (!openSellDialog(cfg)) {
    let button = findByText(tile, sellRe);
    if (!button) {
      log('ouverture de la carte');
      realClick(qsa(tile, cfg.openCard)[0] ?? tile);
      await pause();
      button = await waitFor(() => findByText(topDialog(cfg.sellDialog), sellRe) ?? findByText(document, sellRe), 'bouton « Mettre en vente »');
    }
    if ((button as HTMLButtonElement).disabled || button.getAttribute('aria-disabled') === 'true') {
      throw new ActionError(button.getAttribute('title') || 'bouton « Mettre aux enchères » désactivé (maximum d\'enchères actives atteint ?)');
    }
    log('ouverture de la vente');
    realClick(button);
    await waitFor(() => openSellDialog(cfg), 'champ prix de la fenêtre de vente');
  }
  if (price == null) log('fenêtre de vente ouverte (pas de prix conseillé)');
  else {
    await pause(150, 300);
    log('prix rempli');
    fillSellPrice(cfg, price);
  }
  if (durationMin != null) {
    await pause(150, 300);
    if (selectSellDuration(cfg, durationMin)) log(`durée ${durationLabel(durationMin)}`);
    else log(`durée « ${durationLabel(durationMin)} » introuvable`);
  }
}

async function setTag(tag: string, wanted: boolean, cfg: SelectorConfig, log: Log): Promise<void> {
  const scope = () => topDialog(`${cfg.sellDialog}, [role="menu"], [role="listbox"], [data-radix-popper-content-wrapper]`);
  const option = findExact(document, tag, cfg.tagOption);
  if (option) {
    if (isChecked(option) !== wanted) {
      log(`${wanted ? 'ajout' : 'retrait'} « ${tag} »`);
      realClick(option);
      await pause();
    }
    return;
  }
  if (!wanted) return;
  // Pas d'option existante : champ de saisie d'étiquette.
  const input = qsa<HTMLInputElement>(scope(), cfg.tagInput)[0] ?? qsa<HTMLInputElement>(document, cfg.tagInput)[0];
  if (!input) throw new ActionError(`introuvable : option ou champ pour l'étiquette « ${tag} »`);
  log(`saisie « ${tag} »`);
  fillInput(input, tag);
  await pause(150, 300);
  const created = findExact(document, tag, cfg.tagOption);
  if (created && created !== input) realClick(created);
  else for (const type of ['keydown', 'keypress', 'keyup'] as const) input.dispatchEvent(new KeyboardEvent(type, { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
  await pause();
}

/** Applique les étiquettes d'une carte via l'interface du site. */
export async function applyTags(tile: Element, change: TagChange, cfg: SelectorConfig, log: Log): Promise<void> {
  const tagRe = re(cfg.tagButtonRe);
  let button = findByText(tile, tagRe);
  if (!button) {
    log('ouverture de la carte');
    realClick(qsa(tile, cfg.openCard)[0] ?? tile);
    await pause();
    button = await waitFor(() => findByText(topDialog(cfg.sellDialog), tagRe) ?? findByText(document, tagRe), 'bouton « Étiquettes »');
  }
  realClick(button);
  await pause();
  for (const tag of change.add) await setTag(tag, true, cfg, log);
  for (const tag of change.remove) await setTag(tag, false, cfg, log);
  pressEscape();
  await pause(200, 400);
  pressEscape();
}
