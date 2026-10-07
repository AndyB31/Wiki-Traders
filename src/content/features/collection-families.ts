/**
 * Ajout aux familles depuis les pages du site :
 *  - /collection en mode « Sélectionner » : bouton « Ajouter à une famille ▾ » DANS la barre d'actions du site
 *    (même allure que « Étiqueter », avant « Défausser »), qui ajoute d'un coup toutes les cartes cochées ;
 *    repli : barre flottante si la barre du site n'est pas trouvée (détection isolée dans collection-selection.ts) ;
 *  - fiche d'une carte (fenêtre du site) : petit bouton « + Famille » à côté du titre.
 */
import { selectedCollectionCards, siteSelectedCount, siteSelectionBar } from '../collection-selection';
import { noticeToast } from '../toast';
import { pickFamilyAndAdd } from './family-actions';
import { resolveCardRefs, resolveNativeCards, syncFamilies } from './families-state';
import { el, ensureFamilyStyle, icon, plural } from './family-ui';
import { registerFeature, type FeatureContext } from './runtime';

let ctx: FeatureContext | null = null;
let listening = false;
let pending: ReturnType<typeof setTimeout> | undefined;

function onCollection(): boolean {
  return location.pathname === '/collection' && !new URLSearchParams(location.search).has('wiky');
}

function isolate(node: HTMLElement): void {
  for (const type of ['click', 'mousedown', 'pointerdown']) node.addEventListener(type, (e) => e.stopPropagation());
}

// ---------------------------------------------------------------- barre de sélection

/** Classes du bouton « Étiqueter » du site (repli si la barre change). */
const SITE_BUTTON_CLASS =
  'inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[var(--color-surface-light)] border border-[var(--color-border)] text-xs font-semibold text-[var(--color-foreground)] hover:bg-[var(--color-accent)]/10 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed';

/**
 * Cartes cochées → cartes du catalogue, au moment du clic. Contrôle avec le compteur du site : si la détection
 * ne retrouve pas les cartes annoncées, on le dit plutôt que d'ajouter une sélection incomplète en silence.
 */
async function selectedSource() {
  const els = selectedCollectionCards();
  const announced = siteSelectedCount();
  if (announced != null && els.length !== announced) {
    console.warn(`[Wiki-Traders] sélection : ${els.length} carte(s) détectée(s), le site en annonce ${announced}`);
    if (!els.length) throw new Error(`le site annonce ${plural(announced, 'carte sélectionnée', 'cartes sélectionnées')}, mais Wiki-Traders n'en reconnaît aucune`);
  }
  const res = await resolveNativeCards(els, ctx?.cards ?? {}, !!ctx?.apiRead);
  if (announced != null && els.length && els.length < announced) {
    noticeToast(`Seulement ${els.length}/${announced} cartes sélectionnées reconnues.`, { error: true });
  }
  return res;
}

function onPickClick(btn: HTMLElement): void {
  pickFamilyAndAdd(btn, selectedSource);
}

/** Bouton « Ajouter à une famille » dans la barre d'actions du site, avant « Défausser ». */
function injectIntoSiteBar(bar: HTMLElement): void {
  if (bar.querySelector('[data-wiky="fam-sitebtn"]')) return;
  const buttons = [...bar.querySelectorAll<HTMLButtonElement>('button')];
  const tag = buttons.find((b) => /^\s*[ée]tiqueter\s*$/i.test(b.textContent ?? ''));
  const discard = buttons.find((b) => /d[ée]fausser/i.test(b.textContent ?? ''));
  const btn = el('button', { type: 'button', 'data-wiky': 'fam-sitebtn', class: tag?.className || SITE_BUTTON_CLASS, title: 'Ajouter les cartes sélectionnées à une famille' },
    `${icon('folderPlus', 14)}Ajouter à une famille${icon('chevron', 12)}`);
  btn.style.color = '#fdba74';
  isolate(btn);
  btn.addEventListener('click', () => onPickClick(btn));
  const host = discard?.parentElement ?? tag?.parentElement ?? buttons.at(-1)?.parentElement ?? bar;
  host.insertBefore(btn, discard && discard.parentElement === host ? discard : null);
}

/** Barre du site si elle est là, sinon notre barre flottante (seulement s'il y a des cartes cochées). */
export function updateSelectionBar(): void {
  let bar = document.querySelector<HTMLElement>('[data-wiky="fam-selbar"]');
  const siteBar = onCollection() ? siteSelectionBar() : null;
  if (siteBar) {
    bar?.remove();
    injectIntoSiteBar(siteBar);
    return;
  }
  const selected = onCollection() ? selectedCollectionCards() : [];
  if (!selected.length) {
    bar?.remove();
    return;
  }
  ensureFamilyStyle();
  if (!bar) {
    bar = el('div', { 'data-wiky': 'fam-selbar', class: 'wf-selbar', role: 'region', 'aria-label': 'Ajouter la sélection à une famille' });
    bar.innerHTML = `<span data-count></span><button type="button" class="wf-btn primary sm">${icon('folderPlus', 15)}Ajouter à une famille ${icon('chevron', 14)}</button>`;
    isolate(bar);
    const btn = bar.querySelector('button')!;
    btn.addEventListener('click', () => onPickClick(btn));
    document.body.append(bar);
  }
  const text = `${plural(selected.length, 'carte sélectionnée', 'cartes sélectionnées')}`;
  const count = bar.querySelector<HTMLElement>('[data-count]')!;
  if (count.textContent !== text) count.textContent = text;
}

/** La sélection change au clic, sans forcément de mutation observée : mise à jour juste après chaque clic. */
function listen(): void {
  if (listening) return;
  listening = true;
  const later = () => {
    clearTimeout(pending);
    pending = setTimeout(updateSelectionBar, 80);
  };
  document.addEventListener('click', later, true);
  document.addEventListener('keyup', (e) => {
    if (e.key === ' ' || e.key === 'Enter' || e.key === 'Escape') later();
  }, true);
}

// ---------------------------------------------------------------- fiche d'une carte

const RARITY_BG = /\/(commun|peu_commun|rare|super_rare|ultra_rare|legendaire)\.png/;

/** Fenêtre de fiche de carte du site : un dialogue avec un titre et un fond de rareté. */
function cardDialogs(): { dialog: HTMLElement; title: HTMLElement }[] {
  const out: { dialog: HTMLElement; title: HTMLElement }[] = [];
  for (const dialog of document.querySelectorAll<HTMLElement>('[role="dialog"]')) {
    if (dialog.closest('[data-wiky]')) continue;
    const title = dialog.querySelector<HTMLElement>('.card-frame h2, h2, .card-frame h3');
    if (!title?.textContent?.trim()) continue;
    if (![...dialog.querySelectorAll('img')].some((i) => RARITY_BG.test(i.getAttribute('src') ?? ''))) continue;
    out.push({ dialog, title });
  }
  return out;
}

function renderModalButtons(): void {
  for (const { dialog, title } of cardDialogs()) {
    const name = title.textContent!.trim();
    const existing = dialog.querySelector<HTMLElement>('[data-wiky="fam-modal-add"]');
    if (existing?.dataset.title === name) continue;
    existing?.remove();
    ensureFamilyStyle();
    const btn = el('button', { type: 'button', 'data-wiky': 'fam-modal-add', class: 'wf-btn sm wf-modal-add', title: 'Ajouter cette carte à une famille' }, `${icon('folderPlus', 14)}Famille`);
    btn.dataset.title = name;
    isolate(btn);
    btn.addEventListener('click', () => {
      const siteId = dialog.querySelector('[data-wm-card-id]')?.getAttribute('data-wm-card-id') ?? null;
      pickFamilyAndAdd(btn, () => resolveCardRefs([{ title: name, siteId }], ctx?.cards ?? {}, !!ctx?.apiRead));
    });
    title.insertAdjacentElement('afterend', btn);
  }
}

registerFeature({
  keys: ['families'],
  render(c) {
    ctx = c;
    syncFamilies(c.families);
    if (c.path === '/collection') listen();
    updateSelectionBar();
    renderModalButtons();
  },
  cleanup() {
    document.querySelector('[data-wiky="fam-selbar"]')?.remove();
    for (const b of document.querySelectorAll('[data-wiky="fam-sitebtn"]')) b.remove();
    for (const b of document.querySelectorAll('[data-wiky="fam-modal-add"]')) b.remove();
  },
});
