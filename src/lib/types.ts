export type Rarity = 'C' | 'PC' | 'R' | 'SR' | 'UR' | 'L';

/** F1 – règle de répartition pour une étiquette. */
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
  /** Timestamp (ms) de fin, null si inconnu. */
  endsAt: number | null;
  seenAt: number;
}

/** Palier de durée : prix de départ entre `from` et `to` (inclus) → durée en minutes. */
export interface DurationRule {
  from: number | null;
  to: number | null;
  minutes: number;
}

export interface Settings {
  slots: number;
  windowDays: number;
  stat: 'mean' | 'median';
  /** Pas d'arrondi du prix conseillé ; 0 = automatique selon le montant. */
  rounding: number;
  /** Classement à doublons égaux : prix le plus haut d'abord, ou le plus bas (pour écouler). */
  sortPrice: 'desc' | 'asc' | 'random';
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
}
