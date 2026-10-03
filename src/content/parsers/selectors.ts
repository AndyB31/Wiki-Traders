/**
 * Tous les sélecteurs et motifs de reconnaissance du site sont ici.
 *
 * WikiMasters est une application Next.js : les classes CSS peuvent changer à chaque mise à jour.
 * Les valeurs par défaut s'appuient donc surtout sur des repères stables (URL, attributs ARIA,
 * images de rareté, textes) et chaque entrée peut être surchargée depuis la page d'options
 * (« Sélecteurs avancés ») sans recompiler l'extension.
 *
 * Les clés finissant par `Re` sont des expressions régulières (insensibles à la casse),
 * les autres des sélecteurs CSS. Une chaîne vide = heuristique automatique.
 */
export interface SelectorConfig {
  /** Zone principale de la page (on ignore menus et en-têtes). */
  root: string;
  collectionPathRe: string;
  marketPathRe: string;
  /** Page d'une enchère : le premier groupe capturé est l'identifiant. */
  auctionDetailPathRe: string;
  /** Chemin + query de la page « mes enchères ». */
  myAuctionsUrlRe: string;
  /** Texte de l'onglet actif qui indique « mes ventes » (« Mes enchères » = mes mises sur les cartes des autres). */
  myAuctionsTabRe: string;
  /** Barre d'onglets (vide = repérée automatiquement : groupe de boutons frères). */
  tabBar: string;
  /** Éléments « actifs » (onglet, filtre sélectionné). */
  activeMarker: string;

  /** Lien vers une enchère. */
  auctionLink: string;
  /** Tuile d'enchère (vide = remonter depuis le lien). */
  auctionTile: string;
  /** Tuile de carte dans la collection (vide = remonter depuis l'image). */
  cardTile: string;
  /** Image de carte. */
  cardImage: string;
  /** Nom de la carte dans une tuile (vide = alt de l'image, puis titre). */
  cardName: string;
  /** Étiquettes affichées sur une tuile de carte. */
  cardTag: string;
  /** Quantité possédée dans une tuile (vide = motif « x3 »). */
  cardQuantity: string;
  /** Marqueur de favori épinglé. */
  cardFavorite: string;
  /** Attribut contenant l'identifiant de la carte (sinon slug du nom). */
  cardIdAttr: string;
  /** Prix dans une tuile d'enchère (vide = heuristique sur les libellés). */
  price: string;
  /** Heure de fin (attribut datetime) dans une tuile d'enchère. */
  endTime: string;

  priceLabelRe: string;
  startPriceLabelRe: string;
  sitePriceLabelRe: string;
  emptyStateRe: string;
  soldRe: string;

  /** Fenêtre de mise en vente (pour l'encart « prix conseillé »). */
  sellDialog: string;
  sellDialogRe: string;

  /** V4 / étiquetage auto : élément cliqué pour ouvrir une carte depuis sa tuile. */
  openCard: string;
  /** Bouton qui ouvre la fenêtre de vente. */
  sellButtonRe: string;
  /** Champ prix de la fenêtre de vente. */
  priceInput: string;
  /** Bouton qui ouvre le choix des étiquettes. */
  tagButtonRe: string;
  /** Options d'étiquette cliquables. */
  tagOption: string;
  /** Champ de saisie d'une nouvelle étiquette. */
  tagInput: string;
}

export const DEFAULT_SELECTORS: SelectorConfig = {
  root: 'main',
  collectionPathRe: '^/(collection|album)',
  marketPathRe: '^/marketplace',
  auctionDetailPathRe: '^/marketplace/([A-Za-z0-9_-]{6,})/?$',
  myAuctionsUrlRe: '(mine|mes[-_]?(ventes|encheres|annonces)|my[-_]?(auctions|sales|listings)|selling|seller|tab=(sales|selling|mine|my))',
  myAuctionsTabRe: '^\\s*(mes|vos)\\s+(ventes|annonces)',
  tabBar: '',
  activeMarker: '[aria-selected="true"], [aria-pressed="true"], [aria-current="page"], [data-state="active"], [data-state="on"], [data-active="true"]',

  auctionLink: 'a[href*="/marketplace/"]',
  auctionTile: '',
  cardTile: '',
  cardImage: 'img',
  cardName: 'h3, [data-wm-title]',
  cardTag: '[data-tag], [class*="tag" i]:not([class*="stage" i]), [class*="etiquette" i], [class*="label-chip" i]',
  cardQuantity: '',
  cardFavorite: '[data-favorite="true"], [aria-label*="favori" i][aria-pressed="true"], [class*="pinned" i], [class*="favorite" i][class*="active" i]',
  cardIdAttr: 'data-card-id',
  price: '',
  endTime: 'time[datetime], [data-end], [data-ends-at]',

  priceLabelRe: '(mise actuelle|ench[eè]re actuelle|offre actuelle|prix actuel|meilleure offre|mise de d[ée]part|prix|ench[eè]re|offre|mise)',
  startPriceLabelRe: '(mise de d[ée]part|mise [àa] prix|prix de d[ée]part|d[ée]part)',
  // « Moy. 12 W » : badge de prix moyen affiché sur les cartes (bouton « Charger les prix »).
  sitePriceLabelRe: '(prix moyen|moyenne|valeur moyenne|cote|moy\\.)',
  emptyStateRe: '(aucune|pas d.)\\s*(ench[eè]re|vente|annonce)',
  // « Vendu par X » = nom du vendeur, pas une vente conclue.
  soldRe: '\\b(vendue?|adjug[ée]e?|remport[ée]e?)(?!\\s+par\\b)',

  // Les fenêtres du site sont des portails « div.fixed.inset-0 » sans role="dialog".
  sellDialog: '[role="dialog"], dialog[open], [data-state="open"][role], div[class*="fixed"][class*="inset-0"]',
  sellDialogRe: '(mise de d[ée]part|mettre aux ench[eè]res|mettre en vente|vendre aux ench[eè]res|cr[ée]er (une )?ench[eè]re|mise [àa] prix|prix de d[ée]part)',

  openCard: 'img',
  sellButtonRe: '(mettre en vente|mettre aux ench[eè]res|vendre aux ench[eè]res|cr[ée]er une ench[eè]re|^\\s*vendre\\s*$)',
  priceInput: 'input[aria-label*="mise" i], input[type="number"], input[inputmode="numeric"], input[inputmode="decimal"], input[name*="price" i], input[name*="prix" i], input[placeholder*="prix" i]',
  tagButtonRe: '^\\s*(g[ée]rer les |modifier les |ajouter une? )?([ée]tiquettes?|tags?|labels?)\\s*$',
  tagOption: '[role="menuitemcheckbox"], [role="option"], [role="checkbox"], [role="menuitem"], label, button, li',
  tagInput: 'input[placeholder*="tiquette" i], input[placeholder*="tag" i], input[placeholder*="label" i]',
};

export function resolveSelectors(overrides: Record<string, string> = {}): SelectorConfig {
  const cfg = { ...DEFAULT_SELECTORS };
  for (const [k, v] of Object.entries(overrides)) {
    if (k in cfg && typeof v === 'string' && v.trim()) (cfg as unknown as Record<string, string>)[k] = v;
  }
  return cfg;
}

export function re(source: string, flags = 'i'): RegExp {
  try {
    return new RegExp(source, flags);
  } catch {
    return /$^/;
  }
}

/** querySelectorAll tolérant aux sélecteurs invalides (saisis à la main). */
export function qsa<T extends Element = Element>(root: ParentNode, selector: string): T[] {
  if (!selector) return [];
  try {
    return [...root.querySelectorAll<T>(selector as never)] as T[];
  } catch {
    return [];
  }
}

export function qs<T extends Element = Element>(root: ParentNode, selector: string): T | null {
  return qsa<T>(root, selector)[0] ?? null;
}
