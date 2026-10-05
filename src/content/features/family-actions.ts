/**
 * Actions communes : « Ajouter à une famille » (depuis la page Familles, la sélection de la collection, la fiche
 * d'une carte) et ouverture de la page d'une famille.
 */
import type { CardFamily, CatalogCard } from '../../lib/types';
import { noticeToast } from '../toast';
import { addToFamily, getFamilies } from './families-state';
import { openFamilyPicker, plural, promptDialog } from './family-ui';

export const FAMILY_ROUTE = '/collection?wiky=families';
const UI_KEY = 'wiky-families-ui';
export const OPEN_EVENT = 'wiky:family-open';

/** Ouvre la page d'une famille (sur place si la page Familles est affichée, sinon par navigation). */
export function openFamilyPage(id: string | null): void {
  try {
    const ui = JSON.parse(sessionStorage.getItem(UI_KEY) ?? '{}') as Record<string, unknown>;
    sessionStorage.setItem(UI_KEY, JSON.stringify({ ...ui, familyId: id }));
  } catch {
    // Stockage de session indisponible : la page s'ouvre sur l'accueil.
  }
  if (new URLSearchParams(location.search).get('wiky') === 'families') document.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: id }));
  else location.assign(FAMILY_ROUTE);
}

export { UI_KEY as FAMILY_UI_KEY };

type Source = CatalogCard[] | (() => Promise<{ cards: CatalogCard[]; unresolved?: string[] }>);

/**
 * Ajoute des cartes à `target` (null : demande le nom d'une nouvelle famille), puis l'annonce dans un toast
 * avec « Ouvrir ». `source` peut être une fonction (résolution des cartes seulement après le choix).
 */
export async function addCardsFlow(target: CardFamily | null, source: Source): Promise<void> {
  let name: string | null = null;
  if (!target) {
    name = await promptDialog('Nouvelle famille', { placeholder: 'Nom de la famille', ok: 'Créer' });
    if (!name) return;
  }
  let cards: CatalogCard[];
  let unresolved: string[] = [];
  try {
    if (typeof source === 'function') ({ cards, unresolved = [] } = await source());
    else cards = source;
  } catch (e) {
    noticeToast(`Cartes introuvables : ${(e as Error).message}`, { error: true });
    return;
  }
  if (!cards.length && target) {
    noticeToast(unresolved.length ? `Aucune carte reconnue (${unresolved.slice(0, 3).join(', ')}…). Active la lecture via l'API (Réglages → Automatisations).` : 'Aucune carte à ajouter.', { error: true });
    return;
  }
  const { family, added } = await addToFamily(target ?? name!, cards);
  const skipped = cards.length - added;
  const lines = [
    target ? `${plural(added, 'carte ajoutée', 'cartes ajoutées')} à « ${family.name} »` : `Famille « ${family.name} » créée avec ${plural(added, 'carte')}`,
    skipped > 0 ? `${plural(skipped, 'carte déjà présente', 'cartes déjà présentes')}` : '',
    unresolved.length ? `${plural(unresolved.length, 'carte non reconnue', 'cartes non reconnues')} : ${unresolved.slice(0, 3).join(', ')}${unresolved.length > 3 ? '…' : ''}` : '',
  ].filter(Boolean);
  noticeToast(lines.join('\n'), { action: { label: 'Ouvrir', onClick: () => openFamilyPage(family.id) } });
}

/** Bouton « Ajouter à une famille ▾ » : menu des familles puis ajout. */
export function pickFamilyAndAdd(anchor: HTMLElement, source: Source, opts: { exclude?: string } = {}): void {
  openFamilyPicker(anchor, getFamilies(), (f) => void addCardsFlow(f, source), opts);
}
