/**
 * Fonctionnalités reprises (et accélérées) de l'extension « WikiMasters - Prix moyen collection ».
 * Chacune s'active dans Réglages → Fonctionnalités. Les automatisations (qui agissent sur le site à ta place)
 * sont désactivées par défaut et demandent une confirmation : risque de bannissement.
 */
export type FeatureKey =
  | 'families'
  | 'familyBadges'
  | 'priceBadges'
  | 'marketplacePrice'
  | 'ranking'
  | 'compactMode'
  | 'premiumCards'
  | 'wikipediaButtons'
  | 'missingImages'
  | 'hideCardStats'
  | 'copyCardImage'
  | 'pullShare'
  | 'packRecap'
  | 'pullStats'
  | 'tradeValues'
  | 'tradePreviews'
  | 'notificationSound'
  | 'bidWatch'
  | 'quickOutbid'
  | 'rankingSell'
  | 'openAllPacks'
  | 'autoOpenPacks';

export type FeatureGroup = 'collection' | 'cards' | 'market' | 'packs' | 'social' | 'automation';

export interface FeatureDef {
  key: FeatureKey;
  group: FeatureGroup;
  label: string;
  help: string;
  default: boolean;
  /** Agit sur le site à ta place : confirmation à l'activation. */
  risky?: boolean;
  /** Nécessite la lecture via l'API (Réglages → Automatisations). */
  api?: boolean;
}

export const FEATURE_GROUPS: Record<FeatureGroup, string> = {
  collection: 'Collection et familles',
  cards: 'Affichage des cartes',
  market: 'Marché et enchères',
  packs: 'Paquets',
  social: 'Échanges et notifications',
  automation: 'Automatisations (risque de bannissement)',
};

export const FEATURES: FeatureDef[] = [
  { key: 'families', group: 'collection', label: 'Familles', help: 'Regroupe des cartes en familles, suis ta progression, ajoute des cartes par sélection multiple ou recherche, trouve les manquantes au marché.', default: true, api: true },
  { key: 'familyBadges', group: 'collection', label: 'Familles sur les cartes', help: 'Pastille de famille sur les cartes de la collection, du marché et de toutes les cartes.', default: true },
  { key: 'priceBadges', group: 'collection', label: 'Prix moyen sur les cartes', help: '« Moy. 12 W » sous le titre de chaque carte de la collection (prix de toutes les cartes en une requête).', default: true, api: true },
  { key: 'ranking', group: 'collection', label: 'Classement « Plus chères »', help: 'Ta collection triée par prix moyen, avec filtres par étiquette, rareté et favoris.', default: true, api: true },
  { key: 'compactMode', group: 'collection', label: 'Mode compact', help: 'Bouton pour réduire la taille des cartes et en afficher davantage.', default: true },
  { key: 'premiumCards', group: 'cards', label: 'Cartes illustrées', help: 'Image de l\'article en grand sur la carte, reflets selon la rareté.', default: false },
  { key: 'wikipediaButtons', group: 'cards', label: 'Bouton Wikipédia', help: 'Bouton « W » sur chaque carte vers son article.', default: true },
  { key: 'missingImages', group: 'cards', label: 'Images manquantes', help: 'Cherche une image (Wikidata, Wikipédia) pour les cartes qui n\'en ont pas.', default: true },
  { key: 'hideCardStats', group: 'cards', label: 'Masquer ATK / DEF', help: 'Cache les statistiques d\'attaque et de défense des cartes.', default: false },
  { key: 'copyCardImage', group: 'cards', label: 'Copier la carte en image', help: 'Bouton dans la fiche d\'une carte pour la copier en PNG.', default: true },
  { key: 'marketplacePrice', group: 'market', label: 'Prix moyen au marché', help: 'Prix moyen et nombre de ventes sur la page d\'une enchère et dans la fiche d\'une carte.', default: true, api: true },
  { key: 'bidWatch', group: 'market', label: 'Suivi de mes mises', help: 'Mes mises en direct (en tête, surenchéri), temps restant, bip sous la minute.', default: true, api: true },
  { key: 'packRecap', group: 'packs', label: 'Récapitulatif d\'ouverture', help: 'Après l\'ouverture d\'un paquet : les cartes obtenues, leur prix moyen et le total.', default: true },
  { key: 'pullStats', group: 'packs', label: 'Statistiques de tirage', help: 'Répartition des raretés obtenues dans tes paquets.', default: true },
  { key: 'pullShare', group: 'packs', label: 'Partager un tirage', help: 'Copie l\'écran d\'ouverture en image.', default: true },
  { key: 'tradeValues', group: 'social', label: 'Valeur des échanges', help: 'Prix moyen de chaque carte et total de chaque côté d\'un échange.', default: true, api: true },
  { key: 'tradePreviews', group: 'social', label: 'Aperçu des échanges', help: 'Mini-cartes au lieu des noms tronqués dans les échanges.', default: true },
  { key: 'notificationSound', group: 'social', label: 'Son des notifications', help: 'Petit son quand une nouvelle notification arrive.', default: false },
  { key: 'quickOutbid', group: 'automation', label: 'Surenchère en un clic', help: 'Bouton pour remiser au minimum dans le suivi de mes mises. Mise à ta place : contraire aux règles du site.', default: false, risky: true, api: true },
  { key: 'rankingSell', group: 'automation', label: 'Vendre depuis le classement', help: 'Met une carte aux enchères directement depuis le classement, sans passer par sa fiche. Contraire aux règles du site.', default: false, risky: true, api: true },
  { key: 'openAllPacks', group: 'automation', label: 'Ouvrir tous les paquets', help: 'Ouvre tous tes paquets d\'un coup, sans animation. Contraire aux règles du site.', default: false, risky: true },
  { key: 'autoOpenPacks', group: 'automation', label: 'Ouverture automatique', help: 'Ouvre tes paquets à intervalle aléatoire pendant que l\'onglet est ouvert. Contraire aux règles du site.', default: false, risky: true },
];

export type FeatureFlags = Record<FeatureKey, boolean>;

export const DEFAULT_FEATURES = Object.fromEntries(FEATURES.map((f) => [f.key, f.default])) as FeatureFlags;

/** Drapeaux complets (les nouvelles fonctionnalités prennent leur valeur par défaut). */
export function featureFlags(stored: Partial<FeatureFlags> | undefined): FeatureFlags {
  return { ...DEFAULT_FEATURES, ...(stored ?? {}) };
}
