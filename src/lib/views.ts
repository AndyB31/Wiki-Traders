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

export type ViewSortKey = 'name' | 'price' | 'total' | 'rarity' | 'quantity' | 'rate' | 'sales' | 'category' | 'tag';

export interface CollectionView {
  id: string;
  name: string;
  /** Affichée dans la barre latérale. */
  active: boolean;
  filter: ViewFilter;
  sort: ViewSortKey;
  dir: 'asc' | 'desc';
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
];

/** Données calculées hors de la carte (prix, taux de vente, familles), fournies par l'appelant. */
export interface ViewContext {
  price(card: Card): number | null | undefined;
  rate?(card: Card): number | null | undefined;
  sales?(card: Card): number | null | undefined;
  families?(card: Card): string[];
}

export function newView(id: string, name = 'Nouvelle vue'): CollectionView {
  return { id, name, active: true, filter: structuredClone(EMPTY_VIEW_FILTER), sort: 'name', dir: 'asc' };
}

/** Vue complétée des valeurs par défaut (réglages anciens ou importés). */
export function normalizeView(v: Partial<CollectionView> & { id: string }): CollectionView {
  const filter = { ...EMPTY_VIEW_FILTER, ...(v.filter ?? {}) };
  return {
    id: v.id,
    name: typeof v.name === 'string' ? v.name : 'Vue',
    active: v.active !== false,
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
  }
}

/**
 * Cartes de la vue, filtrées et triées. Une valeur inconnue (prix pas encore lu, pas de catégorie…) passe en
 * dernier quel que soit le sens ; les égalités se départagent par nom.
 */
export function applyView(cards: Card[], view: CollectionView, ctx: ViewContext): Card[] {
  const sign = view.dir === 'desc' ? -1 : 1;
  const rows = cards.filter((c) => matchesView(c, view.filter, ctx)).map((card) => ({ card, v: sortValue(card, view.sort, ctx), name: normalize(card.name) }));
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
  parts.push(`${sort.label} ${view.dir === 'desc' ? sort.desc : sort.asc}`);
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
