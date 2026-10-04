/**
 * V4 – pré-remplissage de la mise en vente, et étiquetage automatique.
 * Désactivés par défaut (voir l'avertissement dans les réglages). Le clic final
 * « Mettre en vente » n'est jamais fait par l'extension.
 */
import type { TagChange } from '../lib/autotag';
import { durationLabel } from '../lib/duration';
import { sameTag } from '../lib/text';
import { ActionError, fillInput, filledInputs, findByText, findExact, pause, pressEscape, realClick, topDialog, waitFor } from './actions';
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
  filledInputs.add(open.input);
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

/** Bouton « × » d'une pastille d'étiquette (« Retirer l'étiquette X »). */
function removeButton(scope: ParentNode, tag: string, cfg: SelectorConfig): HTMLElement | null {
  const rx = re(cfg.tagRemoveRe);
  return (
    qsa<HTMLElement>(scope, 'button[aria-label]').find((b) => {
      const m = b.getAttribute('aria-label')?.match(rx);
      return !!m && sameTag(m[1], tag);
    }) ?? null
  );
}

function tagInputIn(cfg: SelectorConfig): HTMLInputElement | null {
  return qsa<HTMLInputElement>(topDialog(cfg.sellDialog), cfg.tagInput)[0] ?? qsa<HTMLInputElement>(document, cfg.tagInput)[0] ?? null;
}

async function addTag(tag: string, cfg: SelectorConfig, log: Log): Promise<void> {
  if (removeButton(document, tag, cfg)) return;
  const input = await waitFor(() => tagInputIn(cfg), 'champ « Ajouter une étiquette… »');
  log(`ajout « ${tag} »`);
  fillInput(input, tag);
  // La liste de suggestions s'ouvre ; on choisit l'option exacte (ou « créer » si l'étiquette n'existe pas encore).
  const option = await waitFor(
    () => findExact(document, tag, cfg.tagOption) ?? findByText(document, /cr[ée]er|nouvelle [ée]tiquette/i, '[role="option"] button, [role="option"]'),
    `option « ${tag} » dans la liste`,
    3000,
  );
  // Sur le site, le clic est géré par le bouton à l'intérieur de l'option.
  realClick(option.matches('button') ? option : option.querySelector('button') ?? option);
  await waitFor(() => removeButton(document, tag, cfg), `étiquette « ${tag} » ajoutée`, 4000);
  await pause();
}

async function removeTag(tag: string, cfg: SelectorConfig, log: Log): Promise<void> {
  const button = removeButton(document, tag, cfg);
  if (!button) return;
  log(`retrait « ${tag} »`);
  realClick(button);
  await waitFor(() => !removeButton(document, tag, cfg), `étiquette « ${tag} » retirée`, 4000);
  await pause();
}

/** Ferme la fiche de la carte (bouton « Fermer », sinon Échap). */
async function closeCard(cfg: SelectorConfig): Promise<void> {
  const close = findByText(topDialog(cfg.sellDialog), /^fermer$/i, 'button[aria-label], button[title]');
  if (close) realClick(close);
  else pressEscape();
  await pause(300, 500);
}

/** Applique les étiquettes d'une carte : fiche de la carte → champ « Ajouter une étiquette… » / « × ». */
export async function applyTags(tile: Element, change: TagChange, cfg: SelectorConfig, log: Log): Promise<void> {
  if (!tagInputIn(cfg)) {
    log('ouverture de la carte');
    realClick(qsa(tile, cfg.openCard)[0] ?? tile);
    await pause();
    await waitFor(() => tagInputIn(cfg), 'champ « Ajouter une étiquette… » dans la fiche');
  }
  try {
    // Dans la fiche aussi, l'étoile « Retirer des favoris » signale un favori : on n'y touche pas.
    if (findByText(topDialog(cfg.sellDialog), /^retirer des favoris$/i, 'button[aria-label]')) {
      throw new ActionError('carte en favori, ignorée');
    }
    for (const tag of change.add) await addTag(tag, cfg, log);
    for (const tag of change.remove) await removeTag(tag, cfg, log);
  } finally {
    await closeCard(cfg);
  }
}

/** Fait apparaître une carte absente de l'écran via le champ de recherche de la collection. */
export async function searchCollection(name: string, cfg: SelectorConfig): Promise<boolean> {
  const search = qsa<HTMLInputElement>(document, cfg.collectionSearch).find((i) => !i.closest('[data-wiky]'));
  if (!search) return false;
  fillInput(search, name);
  await pause(500, 800);
  return true;
}
