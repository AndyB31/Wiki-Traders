/**
 * Socle des fonctionnalités reprises de « Prix moyen collection » : chaque module s'enregistre ici et reçoit,
 * à chaque relecture de la page (déjà regroupée par l'observateur de mutations), le même contexte.
 *
 * Règles de performance, communes à tous les modules :
 *  - `render` est idempotent et bon marché : il compare une clé (data-wiky-key) avant de toucher au DOM ;
 *  - tout nœud ajouté porte `data-wiky` (ignoré par l'observateur : pas de boucle de rendu) ;
 *  - les données réseau passent par `catalog.ts` (lots, cache, requêtes regroupées), jamais une requête par carte ;
 *  - un module désactivé nettoie ce qu'il a ajouté (`cleanup`).
 */
import { featureFlags, type FeatureFlags, type FeatureKey } from '../../lib/features';
import type { Card, CardFamily, Settings } from '../../lib/types';

export interface FeatureContext {
  settings: Settings;
  flags: FeatureFlags;
  /** Ma collection connue (clé : slug du nom). */
  cards: Record<string, Card>;
  families: CardFamily[];
  /** Lecture via l'API autorisée (Réglages → Automatisations). */
  apiRead: boolean;
  /** Chemin de la page (sans origine), ex. `/collection`. */
  path: string;
  search: URLSearchParams;
}

export interface SiteFeature {
  /** Fonctionnalité(s) qui activent ce module (au moins une). */
  keys: FeatureKey[];
  /** Le module a besoin de la lecture via l'API. */
  needsApi?: boolean;
  render(ctx: FeatureContext): void;
  /** Retire ce que le module a ajouté (désactivé, ou page quittée si le module le gère). */
  cleanup?(): void;
}

const modules: SiteFeature[] = [];
const active = new Set<SiteFeature>();

export function registerFeature(f: SiteFeature): void {
  modules.push(f);
}

export function makeContext(settings: Settings, cards: Record<string, Card>, families: CardFamily[]): FeatureContext {
  return {
    settings,
    flags: featureFlags(settings.features),
    cards,
    families,
    apiRead: settings.apiRead,
    path: location.pathname,
    search: new URLSearchParams(location.search),
  };
}

/** Lance (ou nettoie) chaque module selon les réglages ; une erreur dans un module n'arrête pas les autres. */
export function runFeatures(ctx: FeatureContext): void {
  for (const m of modules) {
    const on = m.keys.some((k) => ctx.flags[k]) && (!m.needsApi || ctx.apiRead);
    try {
      if (on) {
        m.render(ctx);
        active.add(m);
      } else if (active.has(m)) {
        active.delete(m);
        m.cleanup?.();
      }
    } catch (e) {
      console.warn('[Wiky-Traders]', m.keys.join(','), e);
    }
  }
}

/** Index nom de carte normalisé → carte de ma collection (pour relier une carte affichée à ses données). */
export function cardsByName(cards: Record<string, Card>): Map<string, Card> {
  const map = new Map<string, Card>();
  for (const c of Object.values(cards)) map.set(c.name.trim().toLowerCase(), c);
  return map;
}
