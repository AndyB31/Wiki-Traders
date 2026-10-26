/**
 * Vues de la collection : filtres et tri enregistrés (Réglages → Interface), affichés comme sous-menus de
 * « Collection » dans la barre latérale. Un clic ouvre /collection?wview=<id> : seules les cartes qui passent
 * le filtre restent visibles, dans l'ordre du tri (voir content/features/collection-views.ts).
 *
 * Ce module ne touche pas au DOM : filtre, tri et résumé sont testés seuls.
 */
import { normalize, RARITIES, sameTag } from './text';
import type { Card, Rarity } from './types';

/** Oui / non / indifférent (favori, brillante). */
export type TriState = 'any' | 'yes' | 'no';

export interface ViewFilter {
  /** Le nom ou la catégorie contient ce texte (sans accents ni majuscules) ; plusieurs mots séparés par des virgules = l'un d'eux. */
  q: string;
  /** Étiquettes demandées (vide = toutes les cartes). */
  tags: string[];
  /** `any` : au moins une des étiquettes ; `all` : toutes. */
  tagMode: 'any' | 'all';
  /** Étiquettes exclues. */
  excludeTags: string[];
  /** Seulement les cartes sans aucune étiquette. */
  untagged: boolean;
  /** Raretés acceptées (vide = toutes). */
  rarities: Rarity[];
  favorite: TriState;
  shiny: TriState;
  /** Nom d'une de mes familles (vide = toutes les cartes). */
  family: string;
  minQty: number | null;
  maxQty: number | null;
  /** Prix moyen (W), bornes incluses ; une carte sans prix connu est écartée dès qu'une borne est posée. */
  minPrice: number | null;
  maxPrice: number | null;
}

export type ViewSortKey = 'name' | 'price' | 'total' | 'rarity' | 'quantity' | 'rate' | 'sales' | 'category' | 'tag' | 'favorite' | 'added';

export interface CollectionView {
  id: string;
  name: string;
  /** Affichée dans la barre latérale. */
  active: boolean;
  /** Icône du menu (clé de VIEW_ICONS) ; absente = entonnoir. */
  icon?: string;
  filter: ViewFilter;
  sort: ViewSortKey;
  dir: 'asc' | 'desc';
}

/** Icônes proposées pour le menu d'une vue (tracés Lucide, 24 × 24). */
export const VIEW_ICONS: Record<string, { label: string; svg: string }> = {
  filter: { label: 'Filtre', svg: '<polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>' },
  star: { label: 'Étoile', svg: '<path d="M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z"/>' },
  heart: { label: 'Cœur', svg: '<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/>' },
  tag: { label: 'Étiquette', svg: '<path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z"/><circle cx="7.5" cy="7.5" r=".5" fill="currentColor"/>' },
  coins: { label: 'Pièces', svg: '<circle cx="8" cy="8" r="6"/><path d="M18.09 10.37A6 6 0 1 1 10.34 18"/><path d="M7 6h1v4"/><path d="m16.71 13.88.7.71-2.82 2.82"/>' },
  gem: { label: 'Gemme', svg: '<path d="M6 3h12l4 6-10 13L2 9Z"/><path d="M11 3 8 9l4 13 4-13-3-6"/><path d="M2 9h20"/>' },
  crown: { label: 'Couronne', svg: '<path d="M11.562 3.266a.5.5 0 0 1 .876 0L15.39 8.87a1 1 0 0 0 1.516.294L21.183 5.5a.5.5 0 0 1 .798.519l-2.834 10.246a1 1 0 0 1-.956.734H5.81a1 1 0 0 1-.957-.734L2.02 6.02a.5.5 0 0 1 .798-.519l4.276 3.664a1 1 0 0 0 1.516-.294z"/><path d="M5 21h14"/>' },
  trophy: { label: 'Trophée', svg: '<path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/>' },
  flame: { label: 'Flamme', svg: '<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>' },
  zap: { label: 'Éclair', svg: '<path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z"/>' },
  bookmark: { label: 'Signet', svg: '<path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"/>' },
  folder: { label: 'Dossier', svg: '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>' },
  layers: { label: 'Piles', svg: '<path d="m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z"/><path d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65"/><path d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65"/>' },
  clock: { label: 'Horloge', svg: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>' },
  user: { label: 'Personne', svg: '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>' },
  globe: { label: 'Globe', svg: '<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/>' },
  map: { label: 'Lieu', svg: '<path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="3"/>' },
  book: { label: 'Livre', svg: '<path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"/>' },
  music: { label: 'Musique', svg: '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>' },
  shield: { label: 'Bouclier', svg: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/>' },
  flag: { label: 'Drapeau', svg: '<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" x2="4" y1="22" y2="15"/>' },
};

export const DEFAULT_VIEW_ICON = 'filter';

/** Icône d'une vue en SVG (entonnoir si absente ou inconnue). */
export function viewIconSvg(key: string | undefined, size = 18): string {
  const def = VIEW_ICONS[key ?? ''] ?? VIEW_ICONS[DEFAULT_VIEW_ICON];
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${def.svg}</svg>`;
}

export const EMPTY_VIEW_FILTER: ViewFilter = {
  q: '',
  tags: [],
  tagMode: 'any',
  excludeTags: [],
  untagged: false,
  rarities: [],
  favorite: 'any',
  shiny: 'any',
  family: '',
  minQty: null,
  maxQty: null,
  minPrice: null,
  maxPrice: null,
};

export const VIEW_SORTS: { key: ViewSortKey; label: string; asc: string; desc: string }[] = [
  { key: 'name', label: 'Nom', asc: 'A → Z', desc: 'Z → A' },
  { key: 'price', label: 'Prix moyen', asc: 'moins chère d\'abord', desc: 'plus chère d\'abord' },
  { key: 'total', label: 'Valeur (prix × exemplaires)', asc: 'plus faible d\'abord', desc: 'plus forte d\'abord' },
  { key: 'rarity', label: 'Rareté', asc: 'Commune d\'abord', desc: 'Légendaire d\'abord' },
  { key: 'quantity', label: 'Exemplaires', asc: 'moins d\'abord', desc: 'plus d\'abord' },
  { key: 'rate', label: 'Taux de vente', asc: 'plus faible d\'abord', desc: 'meilleur d\'abord' },
  { key: 'sales', label: 'Nombre de ventes', asc: 'moins d\'abord', desc: 'plus d\'abord' },
  { key: 'category', label: 'Catégorie', asc: 'A → Z', desc: 'Z → A' },
  { key: 'tag', label: 'Étiquette', asc: 'A → Z', desc: 'Z → A' },
  { key: 'favorite', label: 'Favoris', asc: 'favoris à la fin', desc: 'favoris d\'abord' },
  // Ordre du site seulement (la date d'ajout n'est pas connue de l'extension) : un seul sens.
  { key: 'added', label: 'Date d\'ajout', asc: 'comme le site', desc: 'comme le site' },
];

/** Tris qui n'ont qu'un sens (celui du site). */
export const SITE_ONLY_SORTS: ViewSortKey[] = ['added'];

/** Données calculées hors de la carte (prix, taux de vente, familles), fournies par l'appelant. */
export interface ViewContext {
  price(card: Card): number | null | undefined;
  rate?(card: Card): number | null | undefined;
  sales?(card: Card): number | null | undefined;
  families?(card: Card): string[];
}

export function newView(id: string, name = 'Nouvelle vue'): CollectionView {
  return { id, name, active: true, icon: DEFAULT_VIEW_ICON, filter: structuredClone(EMPTY_VIEW_FILTER), sort: 'name', dir: 'asc' };
}

/** Vue complétée des valeurs par défaut (réglages anciens ou importés). */
export function normalizeView(v: Partial<CollectionView> & { id: string }): CollectionView {
  const filter = { ...EMPTY_VIEW_FILTER, ...(v.filter ?? {}) };
  return {
    id: v.id,
    name: typeof v.name === 'string' ? v.name : 'Vue',
    active: v.active !== false,
    icon: typeof v.icon === 'string' && v.icon in VIEW_ICONS ? v.icon : DEFAULT_VIEW_ICON,
    filter: { ...filter, tags: [...(filter.tags ?? [])], excludeTags: [...(filter.excludeTags ?? [])], rarities: [...(filter.rarities ?? [])] },
    sort: VIEW_SORTS.some((s) => s.key === v.sort) ? v.sort! : 'name',
    dir: v.dir === 'desc' ? 'desc' : 'asc',
  };
}

const hasTag = (card: Card, tag: string) => card.tags.some((t) => sameTag(t, tag));

/** La carte passe-t-elle le filtre de la vue ? */
export function matchesView(card: Card, f: ViewFilter, ctx: ViewContext): boolean {
  const words = f.q.split(',').map(normalize).filter(Boolean);
  if (words.length) {
    const text = normalize(`${card.name} ${card.category ?? ''}`);
    if (!words.some((w) => text.includes(w))) return false;
  }
  const tags = f.tags.filter((t) => t.trim());
  if (tags.length && !(f.tagMode === 'all' ? tags.every((t) => hasTag(card, t)) : tags.some((t) => hasTag(card, t)))) return false;
  if (f.excludeTags.some((t) => t.trim() && hasTag(card, t))) return false;
  if (f.untagged && card.tags.length) return false;
  if (f.rarities.length && (!card.rarity || !f.rarities.includes(card.rarity))) return false;
  if (f.favorite !== 'any' && card.favorite !== (f.favorite === 'yes')) return false;
  if (f.shiny !== 'any' && !!card.shiny !== (f.shiny === 'yes')) return false;
  if (f.family.trim() && !(ctx.families?.(card) ?? []).some((n) => normalize(n) === normalize(f.family))) return false;
  const qty = Math.max(1, card.quantity || 1);
  if (f.minQty != null && qty < f.minQty) return false;
  if (f.maxQty != null && qty > f.maxQty) return false;
  if (f.minPrice != null || f.maxPrice != null) {
    const p = ctx.price(card);
    if (p == null) return false;
    if (f.minPrice != null && p < f.minPrice) return false;
    if (f.maxPrice != null && p > f.maxPrice) return false;
  }
  return true;
}

function sortValue(card: Card, key: ViewSortKey, ctx: ViewContext): number | string | null {
  switch (key) {
    case 'name':
      return normalize(card.name);
    case 'category':
      return card.category ? normalize(card.category) : null;
    case 'tag':
      return card.tags.length ? normalize([...card.tags].sort((a, b) => a.localeCompare(b, 'fr'))[0]) : null;
    case 'rarity':
      return card.rarity ? RARITIES[card.rarity].order : null;
    case 'quantity':
      return Math.max(1, card.quantity || 1);
    case 'price':
      return ctx.price(card) ?? null;
    case 'total': {
      const p = ctx.price(card);
      return p == null ? null : p * Math.max(1, card.quantity || 1);
    }
    case 'rate':
      return ctx.rate?.(card) ?? null;
    case 'sales':
      return ctx.sales?.(card) ?? null;
    case 'favorite':
      return card.favorite ? 1 : 0;
    case 'added':
      return null;
  }
}

/**
 * Cartes de la vue, filtrées et triées. Une valeur inconnue (prix pas encore lu, pas de catégorie…) passe en
 * dernier quel que soit le sens ; les égalités se départagent par nom.
 */
export function applyView(cards: Card[], view: CollectionView, ctx: ViewContext): Card[] {
  const sign = view.dir === 'desc' ? -1 : 1;
  const kept = cards.filter((c) => matchesView(c, view.filter, ctx));
  // Date d'ajout : l'ordre reçu (celui du site) est gardé.
  if (view.sort === 'added') return kept;
  const rows = kept.map((card) => ({ card, v: sortValue(card, view.sort, ctx), name: normalize(card.name) }));
  return rows
    .sort((a, b) => {
      if (a.v == null || b.v == null) {
        if (a.v != null) return -1;
        if (b.v != null) return 1;
      } else if (a.v !== b.v) {
        const d = typeof a.v === 'number' && typeof b.v === 'number' ? a.v - b.v : String(a.v).localeCompare(String(b.v), 'fr');
        if (d) return d * sign;
      }
      return a.name.localeCompare(b.name, 'fr');
    })
    .map((r) => r.card);
}

const TRI_LABEL: Record<Exclude<TriState, 'any'>, string> = { yes: '', no: 'non ' };

/** Résumé court : « Étiquette 10-100 · Nom A → Z ». */
export function viewSummary(view: CollectionView): string {
  const f = view.filter;
  const parts: string[] = [];
  if (f.q.trim()) parts.push(`« ${f.q.trim()} »`);
  const tags = f.tags.filter((t) => t.trim());
  if (tags.length) parts.push(`${tags.length > 1 ? 'Étiquettes' : 'Étiquette'} ${tags.join(f.tagMode === 'all' ? ' + ' : ' ou ')}`);
  const ex = f.excludeTags.filter((t) => t.trim());
  if (ex.length) parts.push(`sauf ${ex.join(', ')}`);
  if (f.untagged) parts.push('sans étiquette');
  if (f.rarities.length) parts.push(f.rarities.map((r) => RARITIES[r].label).join(', '));
  if (f.favorite !== 'any') parts.push(`${TRI_LABEL[f.favorite]}favoris`);
  if (f.shiny !== 'any') parts.push(`${TRI_LABEL[f.shiny]}brillantes`);
  if (f.family.trim()) parts.push(`famille ${f.family.trim()}`);
  if (f.minQty != null || f.maxQty != null) parts.push(range(f.minQty, f.maxQty, 'ex.'));
  if (f.minPrice != null || f.maxPrice != null) parts.push(range(f.minPrice, f.maxPrice, 'W'));
  const sort = VIEW_SORTS.find((s) => s.key === view.sort) ?? VIEW_SORTS[0];
  parts.push(SITE_ONLY_SORTS.includes(sort.key) ? sort.label : `${sort.label} ${view.dir === 'desc' ? sort.desc : sort.asc}`);
  return parts.join(' · ');
}

function range(min: number | null, max: number | null, unit: string): string {
  if (min != null && max != null) return `${min}–${max} ${unit}`;
  return min != null ? `≥ ${min} ${unit}` : `≤ ${max} ${unit}`;
}

/** Adresse d'une vue sur le site. */
export function viewHref(id: string): string {
  return `/collection?wview=${encodeURIComponent(id)}`;
}

// ---------------------------------------------------------------- filtres du site

/**
 * Ce que les contrôles de la collection du site savent faire d'une vue : sa recherche (un seul texte, titre ou
 * catégorie), son filtre d'étiquette (une seule), ses pastilles de rareté et son tri. Le site pagine sa
 * collection : remplir ses champs met les bonnes cartes sur la page ; le filtre de la vue s'applique ensuite
 * en complément (ce que le site ne sait pas faire : prix, favoris, plusieurs étiquettes…).
 */
export interface SiteFilters {
  /** Texte de la recherche du site ('' = vide). */
  q: string;
  /** Étiquette du filtre du site (null = toutes les étiquettes). */
  tag: string | null;
  /** Option « Sans étiquette » du filtre du site. */
  untagged: boolean;
  rarities: Rarity[];
}

export function siteFilters(view: CollectionView): SiteFilters {
  const f = view.filter;
  const words = f.q.split(',').map((w) => w.trim()).filter(Boolean);
  const tags = f.tags.map((t) => t.trim()).filter(Boolean);
  return {
    // Plusieurs mots « l'un ou l'autre » : la recherche du site ne sait pas, le filtre de la vue s'en charge.
    q: words.length === 1 ? words[0] : '',
    // Une étiquette demandée, ou plusieurs qui doivent toutes y être (la première suffit à réduire la liste).
    tag: !f.untagged && (tags.length === 1 || (tags.length > 1 && f.tagMode === 'all')) ? tags[0] : null,
    untagged: f.untagged,
    rarities: [...f.rarities],
  };
}

/** Libellés possibles d'une option de tri du site, par critère (les critères absents du site n'en ont pas). */
const SITE_SORT_RE: Partial<Record<ViewSortKey, RegExp>> = {
  name: /\b(nom|titre|alphab)|a\s*[-–→>]\s*z|z\s*[-–→>]\s*a/i,
  rarity: /raret/i,
  quantity: /quantit|exemplaire|doublon/i,
  price: /prix|valeur|cote/i,
  total: /valeur/i,
  category: /cat[ée]gor/i,
  tag: /[ée]tiquette/i,
  favorite: /favori/i,
  added: /date|ajout|r[ée]cent/i,
};
const DESC_RE = /z\s*[-–→>]\s*a|d[ée]croissant|↓|desc|plus (haut|grand|cher|rare|r[ée]cent)|\bmax/i;
const ASC_RE = /a\s*[-–→>]\s*z|croissant|↑|asc|moins|\bmin/i;
/** Sens d'une option sans indication : celui que le site utilise d'habitude pour ce critère. */
const DEFAULT_DIR: Partial<Record<ViewSortKey, 'asc' | 'desc'>> = { name: 'asc', category: 'asc', tag: 'asc', rarity: 'desc', quantity: 'desc', price: 'desc', total: 'desc', favorite: 'desc' };

function labelDir(label: string): 'asc' | 'desc' | null {
  if (DESC_RE.test(label)) return 'desc';
  return ASC_RE.test(label) ? 'asc' : null;
}

/**
 * Option du menu de tri du site à choisir pour la vue : index dans `labels`, et `exact` si le sens est
 * sûr (sinon la vue range encore la page elle-même). null : le site n'a pas ce tri.
 */
export function pickSiteSort(labels: string[], sort: ViewSortKey, dir: 'asc' | 'desc'): { index: number; exact: boolean } | null {
  const rx = SITE_SORT_RE[sort];
  if (!rx) return null;
  const found = labels.map((label, index) => ({ index, label: label.trim() })).filter((o) => rx.test(o.label));
  if (!found.length) return null;
  const withDir = found.map((o) => ({ ...o, dir: labelDir(o.label) ?? DEFAULT_DIR[sort] ?? null }));
  const best = withDir.find((o) => o.dir === dir) ?? withDir[0];
  return { index: best.index, exact: SITE_ONLY_SORTS.includes(sort) || best.dir === dir };
}

/** Nom d'étiquette d'une option du filtre du site : « #20-100 (142) » → « 20-100 ». */
export function siteTagName(label: string): string {
  return label.replace(/\s*\(\d+\)\s*$/, '').replace(/^\s*#/, '').trim();
}

/** Ce que le site a effectivement filtré et trié (voir content/collection-controls.ts). */
export interface SiteDone {
  q: string;
  tag: string | null;
  untagged: boolean;
  rarities: Rarity[];
  sortExact: boolean;
}

/**
 * Vue à appliquer en plus sur la page affichée, une fois les champs du site remplis : ce que le site a déjà
 * filtré n'est pas refait (il connaît mieux ses cartes que le dernier relevé de l'extension), et son ordre est
 * gardé quand son tri est celui de la vue.
 */
export function remainingView(view: CollectionView, done: SiteDone | null): CollectionView {
  if (!done) return view;
  const f = { ...view.filter };
  if (done.q && normalize(done.q) === normalize(f.q)) f.q = '';
  if (done.tag) {
    const rest = f.tags.filter((t) => !sameTag(t, done.tag));
    // « Au moins une » : le site a pris la seule demandée ; « toutes » : il reste les autres à vérifier.
    f.tags = f.tagMode === 'all' ? rest : rest.length ? f.tags : [];
  }
  if (done.untagged) f.untagged = false;
  if (f.rarities.length && f.rarities.length === done.rarities.length && f.rarities.every((r) => done.rarities.includes(r))) f.rarities = [];
  return { ...view, filter: f, sort: done.sortExact ? 'added' : view.sort };
}
