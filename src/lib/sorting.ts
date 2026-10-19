/**
 * Critères de tri des cartes proposées à la vente (« selon mes critères ») : appliqués dans l'ordre, chacun départage
 * les égalités du précédent. Une valeur inconnue (taux de vente pas encore lu ou trop peu d'enchères, prix inconnu)
 * passe toujours en dernier, quel que soit le sens.
 */
import type { SortCriterion, SortKey } from './types';

export const SORT_KEYS: { key: SortKey; label: string; help: string }[] = [
  { key: 'prix', label: 'Prix conseillé', help: 'Mise de départ conseillée' },
  { key: 'prix_moyen', label: 'Prix moyen', help: 'Prix moyen de la carte' },
  { key: 'tdv', label: 'Taux de vente', help: 'À partir de 5 enchères terminées ; sinon en dernier' },
  { key: 'ventes', label: 'Nombre de ventes', help: 'Enchères conclues de la carte' },
  { key: 'encheres', label: 'Enchères terminées', help: 'Vendues, sans acheteur et annulées' },
  { key: 'doublons', label: 'Doublons', help: 'Exemplaires en plus du premier' },
  { key: 'rarete', label: 'Rareté', help: 'Commune (1) à Légendaire (6)' },
  { key: 'hasard', label: 'Hasard', help: 'Tirage stable, renouvelé à chaque nouvelle enchère' },
];

/** Proposé quand on passe à « selon mes critères » : doublons, puis meilleur taux de vente, puis le plus cher. */
export const DEFAULT_CRITERIA: SortCriterion[] = [
  { key: 'doublons', dir: 'desc' },
  { key: 'tdv', dir: 'desc' },
  { key: 'prix', dir: 'desc' },
];

export function criteriaSummary(list: SortCriterion[]): string {
  return list.map((c) => `${SORT_KEYS.find((k) => k.key === c.key)?.label ?? c.key} ${c.dir === 'desc' ? '↓' : '↑'}`).join(' › ');
}
