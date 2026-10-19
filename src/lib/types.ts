export type Rarity = 'C' | 'PC' | 'R' | 'SR' | 'UR' | 'L';

/** F1 – règle de répartition pour une étiquette. */
/** Conditions d'une règle (étiquetage automatique, appartenance « prix dans la plage ») : toutes celles remplies comptent. */
export interface RuleConditions {
  /** Mots séparés par des virgules : le nom ou la catégorie de la carte en contient au moins un (sans accents ni majuscules). */
  text: string;
  /** Nom d'une de mes familles : la carte doit en faire partie. */
  family: string;
  /** Taux de vente (en %) entre ces bornes, à partir de `sellRateMinSamples` enchères terminées. */
  rateMin: number | null;
  rateMax: number | null;
}

/** Ordre de choix des cartes d'une étiquette. `rate` : meilleur taux de vente d'abord ; `score` : formule ; `custom` : critères. */
export type CandidateSort = 'desc' | 'asc' | 'random' | 'rate' | 'score' | 'custom';

/** Critère de tri des cartes proposées (voir lib/sorting.ts). */
export type SortKey = 'prix' | 'prix_moyen' | 'tdv' | 'ventes' | 'encheres' | 'doublons' | 'rarete' | 'hasard';

export interface SortCriterion {
  key: SortKey;
  dir: 'asc' | 'desc';
}

/** Réglages de vente propres à une étiquette (remplacent les réglages globaux). */
export interface RuleSale {
  minSellRate: number | null;
  sellRateRules: SellRateRule[];
  durationRules: DurationRule[];
  sort: CandidateSort;
  /** Formule de score (ordre `score`) : la plus haute d'abord. */
  score: string;
  /** Critères de tri (ordre `custom`), dans l'ordre. */
  sortCriteria?: SortCriterion[];
}

export interface TagRule {
  id: string;
  /** Nom de l'étiquette tel qu'affiché sur le site (ex. « 20-50 »). */
  tag: string;
  /** Nombre de slots que l'étiquette doit occuper en permanence. */
  quota: number;
  /** Pourcentage du prix moyen (70 = 70 %). */
  pct: number;
  floor: number | null;
  ceiling: number | null;
  /** Nombre d'exemplaires à toujours garder (1 = seuls les doublons sont vendables). */
  keepMin: number;
  active: boolean;
  /**
   * `tag` : la carte doit porter l'étiquette sur le site.
   * `price` : la carte appartient à l'étiquette si son prix moyen est entre plancher et plafond
   * (utile si les étiquettes ne sont pas lisibles dans la page).
   */
  match: 'tag' | 'price';
  /** Conditions en plus de la plage de prix (absentes = aucune). */
  when?: RuleConditions;
  /** Réglages de vente propres (absents = réglages globaux). */
  sale?: RuleSale;
}

export interface Card {
  /** Identifiant stable (slug du nom par défaut). */
  id: string;
  /** Identifiant interne du site, s'il est lisible. */
  siteId?: string;
  name: string;
  rarity: Rarity | null;
  /** Version brillante (« shiny »), cotée à part. */
  shiny?: boolean;
  /** Catégorie Wikipédia affichée sur la carte (ex. « actrice américaine »). */
  category?: string;
  tags: string[];
  quantity: number;
  favorite: boolean;
  /** Prix moyen affiché par le site, s'il existe. */
  sitePrice: number | null;
  sitePriceAt: number | null;
  updatedAt: number;
}

export interface PriceObs {
  cardId: string;
  price: number;
  /** `sold` = vente terminée, `listing` = enchère en cours. */
  type: 'sold' | 'listing';
  at: number;
  auctionId?: string;
  /** Rareté de la carte vendue : sert au prix de référence par rareté. */
  rarity?: Rarity | null;
  shiny?: boolean;
}

export interface MyAuction {
  id: string;
  cardId: string;
  cardName: string;
  tag: string | null;
  startPrice: number | null;
  currentPrice: number | null;
  /** Au moins une enchère reçue (lu via l'API ; absent : déduit du prix). */
  hasBid?: boolean;
  /** Timestamp (ms) de fin, null si inconnu. */
  endsAt: number | null;
  seenAt: number;
  /** Étiquettes de la carte au moment de la mise en vente (remises si l'enchère se termine sans acheteur). */
  cardTags?: string[];
}

/** Enchère terminée sans mise, dont les étiquettes sont à remettre sur la carte revenue en collection. */
export interface PendingRetag {
  auctionId: string;
  cardId: string;
  cardName: string;
  tags: string[];
  /** Mise en file (ms). */
  at: number;
}

/** Palier de durée : prix de départ entre `from` et `to` (inclus) → durée en minutes. */
export interface DurationRule {
  from: number | null;
  to: number | null;
  minutes: number;
}

/** Palier de taux de vente : tdv entre `from` et `to` % (inclus) → prix conseillé × `pricePct` % (100 = inchangé, 50 = moitié prix). */
export interface SellRateRule {
  from: number | null;
  to: number | null;
  pricePct: number;
}

export interface Settings {
  slots: number;
  windowDays: number;
  stat: 'mean' | 'median';
  /** Pas d'arrondi du prix conseillé ; 0 = automatique selon le montant. */
  rounding: number;
  /** Classement à doublons égaux : prix le plus haut d'abord, ou le plus bas (pour écouler). */
  sortPrice: 'desc' | 'asc' | 'random' | 'custom';
  /** Critères de tri des cartes proposées (ordre `custom`), dans l'ordre. */
  sortCriteria: SortCriterion[];
  /**
   * `quota` : chaque étiquette réserve ses slots ; `pool` : les meilleures cartes de toutes les étiquettes remplissent
   * les slots libres, page par page (« Suivant »).
   */
  allocationMode: 'quota' | 'pool';
  /** Graine du tirage « aléatoire » (stable entre deux rafraîchissements, change à la demande). */
  randomSeed: number;
  /** Autoriser à proposer une carte déjà en vente. */
  allowDuplicateListing: boolean;
  /** Prendre aussi en compte les enchères en cours dans le prix moyen. */
  includeListings: boolean;
  fallbackTag: string | null;
  blacklist: string[];
  notifications: boolean;
  quietStart: string | null;
  quietEnd: string | null;
  /** URL (sans origine) de la page « mes enchères », enregistrée depuis la popup. */
  myAuctionsPath: string | null;
  /** Page ouverte par le bouton « Ouvrir » (la collection, où se trouve « Mettre en vente »). */
  sellPath: string;
  /** Durée de l'enchère selon le prix de départ (vide = durée par défaut du site). */
  durationRules: DurationRule[];
  /** Ne pas proposer une carte dont le taux de vente est sous ce % (null = pas de minimum). */
  minSellRate: number | null;
  /** Prix conseillé selon le taux de vente (vide = aucun). */
  sellRateRules: SellRateRule[];
  /** Paliers de taux de vente appliqués (faux : gardés mais sans effet). */
  sellRateTiersOn: boolean;
  /** Nombre d'enchères terminées à partir duquel le taux de vente compte (minimum, paliers, conditions, tri). */
  sellRateMinSamples: number;
  /** Ne jamais proposer à la vente une carte d'une de mes familles (sauf étiquette qui vise cette famille). */
  protectFamilies: boolean;
  /** Pastilles d'étiquettes sur les cartes de la collection. */
  showTagOverlay: boolean;
  /** `label` : nom de l'étiquette ; `dot` : simple pastille de couleur (nom au survol). */
  tagOverlayStyle: 'label' | 'dot';
  /** Lecture des données via l'API du site (GET uniquement). */
  apiRead: boolean;
  /** Fenêtre de vente : résumé des offres en cours (min, médiane, max, nombre) sous « Marché · … ». */
  sellMarketSummary: boolean;
  /** Fenêtre de vente : liste des enchères en cours de la carte, sous la fenêtre. */
  sellMarketList: boolean;
  /** Fenêtre de vente : « Historique des prix » de la carte (comme sur la page d'une enchère), sous la fenêtre. */
  sellMarketHistory: boolean;
  /** Étiquetage automatique par l'API (écritures limitées aux étiquettes) plutôt que par l'interface. */
  apiWrite: boolean;
  /** V4 : ouvre la fenêtre de vente et remplit le prix (le clic final reste humain). */
  prefill: boolean;
  /** Étiquetage automatique des cartes sur le site selon leur prix moyen. */
  autoTag: boolean;
  /** Retirer les autres étiquettes gérées lors de l'étiquetage automatique. */
  autoTagRemoveOthers: boolean;
  /** Retirer les étiquettes de plage des cartes sans prix propre connu. */
  autoTagClearUnpriced: boolean;
  /** Remettre ses étiquettes à une carte dont l'enchère se termine sans acheteur (par l'API, nécessite apiWrite). */
  retagUnsold: boolean;
  /** « Tout défausser » après ouverture : confirmation si une carte vaut plus que ce prix moyen (W). */
  discardConfirmAbove: number;
  /** Surcharges des sélecteurs CSS (voir content/parsers/selectors.ts). */
  selectorOverrides: Record<string, string>;
  /** Intégration au site : résumé et menu Wiki-Traders dans la barre latérale, fenêtres et pages, onglet dans Paramètres. */
  siteIntegration: boolean;
  /** Barre latérale du site plus compacte, avec les menus regroupés (Social, Progression). */
  compactNav: boolean;
  /** Fonctionnalités reprises de « Prix moyen collection » (voir lib/features.ts) ; absentes = valeur par défaut. */
  features: Partial<import('./features').FeatureFlags>;
}

export type JournalType = 'proposed' | 'created' | 'finished';

export interface JournalEntry {
  id: string;
  type: JournalType;
  at: number;
  cardId: string;
  cardName: string;
  tag: string | null;
  startPrice: number | null;
  finalPrice: number | null;
  /** Prix moyen de référence au moment de l'événement. */
  avgPrice: number | null;
  auctionId?: string;
}

export type PageKind = 'myAuctions' | 'market' | 'auctionDetail' | 'collection' | 'other';

export interface PageStatus {
  kind: PageKind;
  url: string;
  recognized: boolean;
  message: string;
  /** Source des données : props React de la page ou lecture du texte. */
  source?: 'react' | 'dom';
  at: number;
}

export interface Meta {
  lastAuctionsScan: number | null;
  lastCollectionScan: number | null;
  /** Dernier relevé complet de la collection via l'API. */
  lastCollectionApi?: number | null;
  /** Dernier chargement des ventes du marché via l'API : date, nombre, erreur éventuelle. */
  lastMarketFetch?: { at: number; count: number; error?: string } | null;
  lastPage: PageStatus | null;
}

/** Carte que l'utilisateur vient d'ouvrir depuis la popup. */
export interface PendingFocus {
  cardId: string;
  cardName: string;
  price: number | null;
  detail: string;
  at: number;
  /** Durée conseillée (minutes), selon les paliers. */
  durationMin?: number | null;
  /** V4 : ouvrir la vente et remplir le prix à l'arrivée sur la page. */
  autoOpen?: boolean;
  prefilledAt?: number;
  /** Arrivée sur la collection (la navigation n'a lieu qu'une fois). */
  arrivedAt?: number;
  /** Onglet ouvert par « Ouvrir » (le seul à pré-remplir). */
  tabId?: number;
}

export type BidStatus = 'leading' | 'outbid' | 'won' | 'lost' | 'cancelled';

/** Enchère d'un autre joueur sur laquelle j'ai misé (lue via l'API). */
export interface MyBid {
  auctionId: string;
  cardId: string;
  cardName: string;
  rarity: Rarity | null;
  shiny: boolean;
  myMax: number;
  myBids: number;
  lastBidAt: number;
  current: number | null;
  status: BidStatus;
  endsAt: number | null;
  /** Ventes conclues de cette carte (toutes enchères confondues). */
  cardSales: number;
  cardMedian: number | null;
}

/** Famille de cartes créée avec l'extension « WikiMasters - Prix moyen collection » (lue dans la page). */
export interface FamilyCard {
  /** Identifiant de la carte sur le site. */
  siteId: string;
  name: string;
  rarity: Rarity | null;
  category: string | null;
  owned: boolean | null;
}

export interface Family {
  id: string;
  name: string;
  cards: FamilyCard[];
}

/** Carte du catalogue du site (table `cards`), possédée ou non. */
export interface CatalogCard {
  siteId: string;
  title: string;
  rarity: Rarity | null;
  category: string | null;
  imageUrl: string | null;
  wikipediaUrl: string | null;
  atk: number | null;
  def: number | null;
}

/** Famille de cartes (gérée par Wiki-Traders). */
export interface CardFamily {
  id: string;
  name: string;
  /** Couleur de la pastille (hex). */
  color: string;
  cards: CatalogCard[];
  /** Carte affichée en couverture (sinon les premières cartes illustrées). */
  coverSiteId: string | null;
  createdAt: number;
  updatedAt: number;
}

/** Enchère en cours sur une carte donnée (lue via l'API). */
export interface CardAuction {
  id: string;
  price: number;
  hasBid: boolean;
  endsAt: number | null;
  shiny: boolean;
  mine: boolean;
}

export interface CardAuctionsResult {
  auctions: CardAuction[];
  /** Ventes conclues de la carte. */
  sales: number;
  median: number | null;
}

/** Une de mes ventes terminées (lue via l'API). */
export interface SoldItem {
  auctionId: string;
  cardId: string;
  cardName: string;
  rarity: Rarity | null;
  shiny: boolean;
  sold: boolean;
  start: number | null;
  final: number | null;
  endedAt: number | null;
  /** Médiane des AUTRES ventes de cette carte (hors celle-ci). */
  cardMedian: number | null;
  cardSales: number;
}

export interface MySalesResult {
  at: number;
  items: SoldItem[];
}

export interface MyBidsResult {
  at: number;
  bids: MyBid[];
}

/** Action de navigation demandée depuis la fenêtre, exécutée par le content script de l'onglet. */
export interface Intent {
  type: 'refreshSales';
  at: number;
  tabId: number | null;
}

export interface StoreShape {
  rules: TagRule[];
  settings: Settings;
  cards: Record<string, Card>;
  priceObs: PriceObs[];
  myAuctions: MyAuction[];
  journal: JournalEntry[];
  manualPrices: Record<string, number>;
  /** Carte choisie à la main pour un slot : clé `${ruleId}:${index}`. */
  slotOverrides: Record<string, string>;
  /** Slots ignorés : clé `${ruleId}:${index}`. */
  ignoredSlots: string[];
  meta: Meta;
  pendingFocus: PendingFocus | null;
  intent: Intent | null;
  /** Dernier relevé de mes mises via l'API. */
  bidsCache: MyBidsResult | null;
  /** Dernier relevé de mes ventes terminées via l'API. */
  salesCache: MySalesResult | null;
  /** Familles lues dans la page (autre extension), avec la date du relevé. */
  families: { at: number; list: Family[] } | null;
  /** Mes familles (Wiki-Traders). */
  myFamilies: CardFamily[];
  /** Import des familles de « Prix moyen collection » : date (null = jamais). */
  familiesImportedAt: number | null;
  /** Invendues dont les étiquettes restent à remettre (traitées par un onglet du site ouvert). */
  pendingRetags: PendingRetag[];
  /** Mode « meilleures cartes » : rang de la première carte proposée (bouton « Suivant »). */
  poolOffset: number;
  /** Dernières nouveautés vues (identifiant de lib/changelog.ts) ; null : jamais vues. */
  changelogSeen: string | null;
}
