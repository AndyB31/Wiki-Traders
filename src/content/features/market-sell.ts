/**
 * Mise aux enchères d'une carte par l'API du site (fonctionnalité « Vendre depuis le classement », risquée,
 * désactivée par défaut). Même requête que la fenêtre « Mettre aux enchères » du site et que « Prix moyen collection » :
 *   POST /api/marketplace { card_id: <exemplaire possédé>, base_amount, duration_minutes }
 * `card_id` est l'identifiant de MON exemplaire (user_cards.id), pas celui de la carte du catalogue :
 * on prend un exemplaire qui n'est pas déjà en vente, en gardant les favoris pour la fin.
 */
import type { FeatureFlags } from '../../lib/features';
import { discoverConfig, get, readSession } from '../api';

export class SellError extends Error {
  constructor(
    message: string,
    readonly code: 'DISABLED' | 'INVALID' | 'NOT_OWNED' | 'ALREADY_LISTED' | 'STARRED' | 'HTTP',
  ) {
    super(message);
  }
}

export interface OwnedCopy {
  id: string;
  starred: boolean;
}

/** Mes exemplaires d'une carte du catalogue. */
export async function ownedCopies(siteCardId: string): Promise<OwnedCopy[]> {
  const cfg = await discoverConfig();
  const session = readSession(cfg);
  const rows = await get<{ id: string; starred: boolean | null }[]>(
    cfg,
    session,
    `user_cards?select=id,starred&user_id=eq.${session.userId}&card_id=eq.${encodeURIComponent(siteCardId)}&limit=200`,
  );
  return rows.map((r) => ({ id: r.id, starred: !!r.starred }));
}

/** Mes ventes en cours, en texte (on y cherche les identifiants d'exemplaires déjà en vente). */
async function myListingsText(): Promise<string> {
  try {
    const res = await fetch('/api/marketplace/mine', { method: 'GET', credentials: 'include', headers: { accept: '*/*' } });
    return res.ok ? await res.text() : '';
  } catch {
    return '';
  }
}

/** Exemplaire à vendre : pas déjà en vente, non favori de préférence. */
export function pickCopy(copies: OwnedCopy[], listedText: string, allowStarred: boolean): OwnedCopy {
  if (!copies.length) throw new SellError('Tu ne possèdes plus cette carte.', 'NOT_OWNED');
  const free = copies.filter((c) => !listedText.includes(c.id)).sort((a, b) => Number(a.starred) - Number(b.starred));
  if (!free.length) throw new SellError('Toutes tes copies de cette carte sont déjà en vente.', 'ALREADY_LISTED');
  if (free[0].starred && !allowStarred) throw new SellError('Le seul exemplaire disponible est en favori.', 'STARRED');
  return free[0];
}

export interface ListingRequest {
  siteCardId: string;
  amount: number;
  durationMinutes: number;
  /** Vendre un favori si c'est le seul exemplaire libre (après confirmation). */
  allowStarred?: boolean;
}

/** Envoie la mise en vente. Refuse tout si la fonctionnalité n'est pas activée. */
export async function createListing(flags: Pick<FeatureFlags, 'rankingSell'>, req: ListingRequest): Promise<unknown> {
  if (!flags.rankingSell) throw new SellError('La vente depuis le classement est désactivée (Réglages → Fonctionnalités).', 'DISABLED');
  const amount = Math.round(Number(req.amount));
  const duration = Math.round(Number(req.durationMinutes));
  if (!Number.isFinite(amount) || amount <= 0 || !Number.isFinite(duration) || duration <= 0) throw new SellError('Prix ou durée invalide.', 'INVALID');
  const [copies, listed] = await Promise.all([ownedCopies(req.siteCardId), myListingsText()]);
  const copy = pickCopy(copies, listed, !!req.allowStarred);
  const res = await fetch('/api/marketplace', {
    method: 'POST',
    credentials: 'include',
    headers: { accept: '*/*', 'content-type': 'application/json' },
    body: JSON.stringify({ card_id: copy.id, base_amount: amount, duration_minutes: duration }),
  });
  let json: { error?: string; message?: string } | null = null;
  try {
    json = await res.json();
  } catch {
    // Réponse vide.
  }
  if (!res.ok) throw new SellError(json?.error || json?.message || `HTTP ${res.status}`, 'HTTP');
  return json;
}
