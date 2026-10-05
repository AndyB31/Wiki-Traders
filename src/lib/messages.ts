import type { TagChange } from './autotag';
import type { Card, MyAuction, PageStatus, PriceObs } from './types';

/** `tagsExact` : étiquettes lues dans les données du site (remplacent les anciennes). */
export type ScannedCard = Partial<Card> & { tagsExact?: boolean };

/** Relevé envoyé par le content script au service worker. */
export interface ScanMessage {
  type: 'scan';
  status: PageStatus;
  /** Liste complète de mes enchères (uniquement sur la page « mes enchères » reconnue). */
  myAuctions?: MyAuction[];
  /** Cartes visibles (fusionnées, jamais supprimées). */
  cards?: ScannedCard[];
  prices?: PriceObs[];
  /** Compteur affiché par le site (« Mes ventes (2/5) »). */
  siteSlots?: { active: number; slots: number };
  /** `api` : mes enchères lues via l'API, pas un relevé de la page (la page affichée n'est pas mémorisée). */
  source?: 'api';
}

export interface ProposedMessage {
  type: 'proposed';
  cardId: string;
  cardName: string;
  tag: string;
  price: number | null;
  avgPrice: number | null;
}

export type ToBackground = ScanMessage | ProposedMessage | { type: 'refreshBadge' } | { type: 'tabId' } | { type: 'prices'; prices: PriceObs[]; market?: { count: number; error?: string } } | { type: 'collection'; cards: ScannedCard[] };

/** Messages envoyés par la popup au content script de l'onglet actif. */
export type ToContent = { type: 'diagnostic' } | { type: 'rescan' } | { type: 'autoTag'; plan?: TagChange[] } | { type: 'stopAutoTag' } | { type: 'toggleWindow' } | { type: 'api'; op: 'myBids' | 'marketSales' | 'collection' | 'mySales' | 'myAuctions' } | { type: 'api'; op: 'cardAuctions'; siteCardId: string } | { type: 'outbid'; auctionId: string };

export interface DiagnosticResult {
  url: string;
  title: string;
  at: string;
  kind: string;
  parsed: unknown;
  /** Données React lues dans la page (échantillon). */
  react: unknown;
  /** Dernières étapes des automatisations. */
  actionLog: string[];
  /** Surcouche : cartes repérées, pastilles d'étiquettes posées, couleurs connues. */
  overlay: { tiles: number; tagChips: number; colors: Record<string, string> };
  /** Prix connus : observations par rareté, cartes avec prix du site, dernier chargement du marché. */
  prices: unknown;
  /** Scripts Next.js chargés (pour retrouver les libellés des boutons du site). */
  scripts: string[];
  outline: string;
}
