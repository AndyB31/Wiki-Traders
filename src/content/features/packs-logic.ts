/**
 * Logique des paquets, sans DOM : lecture de la réponse d'ouverture, statistiques de tirage,
 * récapitulatif (prix, déjà possédée ?), ouverture en série (même requête que le site) et délais aléatoires.
 */
import { ext } from '../../lib/browser';
import type { Rarity } from '../../lib/types';
import type { CardPrice } from '../catalog';
import { displayPrice } from '../catalog';

const RARITIES: Rarity[] = ['C', 'PC', 'R', 'SR', 'UR', 'L'];

/** Carte obtenue dans un paquet (réponse de `POST /api/packs/open`). */
export interface PackCard {
  siteId: string;
  title: string;
  rarity: Rarity | null;
  imageUrl: string | null;
  wikipediaUrl: string | null;
}

/**
 * Cartes de la réponse d'ouverture : `{ cards: [{ id, wikipedia_title, rarity, image_url, wikipedia_url }], packs_remaining }`
 * (forme relevée par « Prix moyen collection »). Les lignes incomplètes sont ignorées.
 */
export function mapPackCards(json: unknown): PackCard[] {
  const list = (json as { cards?: unknown } | null)?.cards;
  if (!Array.isArray(list)) return [];
  const out: PackCard[] = [];
  for (const raw of list) {
    const c = raw as Record<string, unknown> | null;
    // Certaines réponses imbriquent la carte (`{ card: {...} }`).
    const card = (c && typeof c.card === 'object' && c.card ? c.card : c) as Record<string, unknown> | null;
    const id = card?.id ?? c?.card_id;
    const title = card?.wikipedia_title ?? card?.title;
    if (typeof id !== 'string' || typeof title !== 'string' || !title) continue;
    const rarity = String(c?.snapshot_rarity ?? card?.rarity ?? '').toUpperCase() as Rarity;
    out.push({
      siteId: id,
      title,
      rarity: RARITIES.includes(rarity) ? rarity : null,
      imageUrl: typeof card?.image_url === 'string' ? card.image_url : null,
      wikipediaUrl: typeof card?.wikipedia_url === 'string' ? card.wikipedia_url : null,
    });
  }
  return out;
}

/** Paquets restants annoncés par le site (null : inconnu). */
export function packsRemaining(json: unknown): number | null {
  const v = (json as { packs_remaining?: unknown } | null)?.packs_remaining;
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 ? n : null;
}

// ---------------------------------------------------------------- statistiques de tirage

export interface PullStats {
  counts: Record<Rarity, number>;
  /** Cartes comptées (somme des raretés connues). */
  total: number;
  packs: number;
  since: number;
  updatedAt: number;
}

export const PULL_STATS_KEY = 'pullStats';

export function emptyPullStats(now = Date.now()): PullStats {
  return { counts: { C: 0, PC: 0, R: 0, SR: 0, UR: 0, L: 0 }, total: 0, packs: 0, since: now, updatedAt: now };
}

/** Ajoute des cartes tirées (et `packs` paquets) aux statistiques ; ne modifie pas l'objet reçu. */
export function addPulls(stats: PullStats, cards: { rarity: Rarity | null }[], packs = 1, now = Date.now()): PullStats {
  const next: PullStats = { ...stats, counts: { ...stats.counts }, updatedAt: now };
  for (const c of cards) {
    if (!c.rarity || !RARITIES.includes(c.rarity)) continue;
    next.counts[c.rarity] += 1;
    next.total += 1;
  }
  next.packs += packs;
  return next;
}

/** Part de chaque rareté (en %, une décimale). */
export function pullShares(stats: PullStats): { rarity: Rarity; count: number; pct: number }[] {
  return RARITIES.map((rarity) => ({
    rarity,
    count: stats.counts[rarity],
    pct: stats.total ? Math.round((stats.counts[rarity] / stats.total) * 1000) / 10 : 0,
  }));
}

function sanitizeStats(raw: unknown): PullStats {
  const base = emptyPullStats();
  const r = (raw ?? {}) as Partial<PullStats>;
  for (const k of RARITIES) base.counts[k] = Math.max(0, Number(r.counts?.[k]) || 0);
  base.total = RARITIES.reduce((s, k) => s + base.counts[k], 0);
  base.packs = Math.max(0, Number(r.packs) || 0);
  base.since = Number(r.since) || base.since;
  base.updatedAt = Number(r.updatedAt) || base.updatedAt;
  return base;
}

export async function loadPullStats(): Promise<PullStats> {
  try {
    return sanitizeStats((await ext.storage.local.get(PULL_STATS_KEY))[PULL_STATS_KEY]);
  } catch {
    return emptyPullStats();
  }
}

/** Enregistre un tirage (lecture + écriture, en série pour ne rien perdre entre deux paquets rapprochés). */
let queue: Promise<unknown> = Promise.resolve();
export function recordPulls(cards: PackCard[], packs = 1): Promise<PullStats> {
  const job = queue.then(async () => {
    const next = addPulls(await loadPullStats(), cards, packs);
    await ext.storage.local.set({ [PULL_STATS_KEY]: next });
    return next;
  });
  queue = job.catch(() => {});
  return job;
}

/** Statistiques de tirage d'une autre extension, gardées dans le localStorage du site. */
export const OTHER_PULL_STATS_KEY = 'wm_pull_stats_v1';

/** Compteurs par rareté lus dans l'autre extension (null : absents ou vides). */
export function readOtherPullStats(raw: string | null): Record<Rarity, number> | null {
  if (!raw) return null;
  try {
    const data = JSON.parse(raw) as { counts?: Partial<Record<Rarity, unknown>> };
    const counts = { C: 0, PC: 0, R: 0, SR: 0, UR: 0, L: 0 } as Record<Rarity, number>;
    for (const k of RARITIES) counts[k] = Math.max(0, Math.floor(Number(data?.counts?.[k]) || 0));
    return RARITIES.some((k) => counts[k] > 0) ? counts : null;
  } catch {
    return null;
  }
}

/**
 * Fusion avec des compteurs importés : le plus grand compteur par rareté. Les deux extensions ont pu compter les
 * mêmes paquets en même temps ; additionner les compterait deux fois. Le nombre de paquets (inconnu de l'autre
 * extension) est gardé.
 */
export function mergePullStats(stats: PullStats, other: Record<Rarity, number>, now = Date.now()): PullStats {
  const next: PullStats = { ...stats, counts: { ...stats.counts }, updatedAt: now };
  for (const k of RARITIES) next.counts[k] = Math.max(next.counts[k], other[k] ?? 0);
  next.total = RARITIES.reduce((s, k) => s + next.counts[k], 0);
  return next;
}

/** Importe les statistiques de l'autre extension (si elle en a) dans les nôtres. */
export function importOtherPullStats(): Promise<PullStats | null> {
  const job = queue.then(async () => {
    let raw: string | null = null;
    try {
      raw = localStorage.getItem(OTHER_PULL_STATS_KEY);
    } catch {
      raw = null;
    }
    const other = readOtherPullStats(raw);
    if (!other) return null;
    const next = mergePullStats(await loadPullStats(), other);
    await ext.storage.local.set({ [PULL_STATS_KEY]: next });
    return next;
  });
  queue = job.catch(() => {});
  return job;
}

export async function resetPullStats(): Promise<void> {
  await ext.storage.local.set({ [PULL_STATS_KEY]: emptyPullStats() });
}

// ---------------------------------------------------------------- récapitulatif

export interface RecapRow extends PackCard {
  price: number | null;
  /** Exemplaires possédés avant l'ouverture (0 : nouvelle carte). */
  ownedBefore: number;
  /** Déjà obtenue plus haut dans ce même récapitulatif. */
  repeat: boolean;
}

export interface Recap {
  rows: RecapRow[];
  total: number;
  priced: number;
  /** Cartes jamais possédées avant (sans compter les répétitions). */
  fresh: number;
}

/** Lignes du récapitulatif, triées par prix décroissant (les cartes sans prix à la fin). */
export function buildRecap(cards: PackCard[], prices: Map<string, CardPrice>, owned: (c: PackCard) => number): Recap {
  const seen = new Set<string>();
  const rows: RecapRow[] = cards.map((c) => {
    const repeat = seen.has(c.siteId);
    seen.add(c.siteId);
    return { ...c, price: displayPrice(prices.get(c.siteId), c.rarity), ownedBefore: owned(c), repeat };
  });
  const order = (r: RecapRow) => (r.price == null ? -1 : r.price);
  rows.sort((a, b) => order(b) - order(a));
  const priced = rows.filter((r) => r.price != null);
  return {
    rows,
    total: priced.reduce((s, r) => s + r.price!, 0),
    priced: priced.length,
    fresh: rows.filter((r) => !r.ownedBefore && !r.repeat).length,
  };
}

// ---------------------------------------------------------------- ouverture en série

export interface OpenAllResult {
  opened: number;
  cards: PackCard[];
  remaining: number | null;
  cancelled: boolean;
  error: string | null;
}

export interface OpenAllOptions {
  signal: AbortSignal;
  /** Après chaque paquet ouvert. */
  onPack?: (cards: PackCard[], opened: number, remaining: number | null) => void;
  /** Pause (limite du serveur ou délai entre deux paquets). */
  onWait?: (ms: number, reason: 'rate' | 'pause') => void;
  max?: number;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  /** Délai entre deux paquets (ms). */
  pause?: () => number;
}

export const MAX_PACKS = 100;

export function sleep(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(t);
      signal.removeEventListener('abort', done);
      resolve();
    };
    const t = setTimeout(done, ms);
    signal.addEventListener('abort', done, { once: true });
  });
}

/** La requête exacte du site pour ouvrir un paquet. */
export function openPackRequest(): [string, RequestInit] {
  return ['/api/packs/open', { method: 'POST', credentials: 'include', headers: { accept: '*/*' } }];
}

/**
 * Ouvre les paquets un par un avec la requête du site, jusqu'à épuisement, arrêt ou erreur.
 * Jamais de nouvel essai après une erreur réseau (le paquet a pu être consommé côté serveur) ;
 * la limite de débit du site est respectée (attente de `retry_after`, 5 essais au plus).
 */
export async function openPacksSequence(opts: OpenAllOptions): Promise<OpenAllResult> {
  const doFetch = opts.fetchImpl ?? fetch.bind(globalThis);
  const wait = opts.sleep ?? sleep;
  const pause = opts.pause ?? (() => Math.round(500 + Math.random() * 1500));
  const max = opts.max ?? MAX_PACKS;
  const { signal } = opts;
  const result: OpenAllResult = { opened: 0, cards: [], remaining: null, cancelled: false, error: null };
  try {
    for (let i = 0; i < max && !signal.aborted; i++) {
      let retries = 0;
      for (;;) {
        let res: Response;
        let json: Record<string, unknown> | null = null;
        const [url, init] = openPackRequest();
        try {
          res = await doFetch(url, init);
          json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
        } catch {
          throw new Error('Réponse d\'ouverture perdue : vérifie ta collection avant de relancer (le paquet a pu être consommé).');
        }
        result.remaining = packsRemaining(json);
        const cards = mapPackCards(json);
        const retryAt = Date.parse(String(json?.retry_after ?? ''));
        if (!cards.length && json?.rate_limited && !json?.rate_limit_daily && Number.isFinite(retryAt)) {
          const ms = Math.max(250, retryAt - Date.now() + 200);
          if (++retries > 5 || ms > 5 * 60_000) throw new Error('Ouverture suspendue : le site demande d\'attendre trop longtemps.');
          opts.onWait?.(ms, 'rate');
          await wait(ms, signal);
          if (signal.aborted) break;
          continue;
        }
        if (!res.ok || json?.rate_limit_daily) {
          // Plus aucun paquet : fin normale.
          if (res.status === 400 && result.remaining === 0 && !json?.rate_limit_daily) return result;
          throw new Error(String(json?.error ?? json?.message ?? (json?.rate_limit_daily ? 'Limite quotidienne atteinte.' : `Erreur ${res.status}`)));
        }
        if (!cards.length) throw new Error('Paquet ouvert sans carte reconnue : vérifie ta collection.');
        result.opened += 1;
        result.cards.push(...cards);
        opts.onPack?.(cards, result.opened, result.remaining);
        break;
      }
      if (signal.aborted || result.remaining === 0) break;
      const ms = pause();
      opts.onWait?.(ms, 'pause');
      await wait(ms, signal);
    }
  } catch (e) {
    result.error = (e as Error).message;
  }
  result.cancelled = signal.aborted;
  return result;
}

// ---------------------------------------------------------------- ouverture automatique

export interface AutoOpenState {
  on: boolean;
  /** Intervalle aléatoire, en minutes. */
  min: number;
  max: number;
  /** Prochaine ouverture (ms), partagée entre les onglets. */
  nextAt: number | null;
  lastRun: { at: number; opened: number; error: string | null } | null;
}

export const AUTO_OPEN_KEY = 'autoOpenPacks';
export const DEFAULT_AUTO_OPEN: AutoOpenState = { on: false, min: 30, max: 90, nextAt: null, lastRun: null };

/** Bornes en minutes, entières, entre 1 et 7 jours, min ≤ max. */
export function normalizeBounds(min: unknown, max: unknown): { min: number; max: number } {
  const fix = (v: unknown, fallback: number) => {
    const n = Math.round(Number(v));
    return Number.isFinite(n) && v !== '' && v != null ? Math.max(1, Math.min(10_080, n)) : fallback;
  };
  const a = fix(min, DEFAULT_AUTO_OPEN.min);
  const b = fix(max, DEFAULT_AUTO_OPEN.max);
  return { min: Math.min(a, b), max: Math.max(a, b) };
}

/** Délai aléatoire (ms) entre `min` et `max` minutes. */
export function randomDelay(min: number, max: number, rand = Math.random): number {
  const b = normalizeBounds(min, max);
  return Math.round((b.min + rand() * (b.max - b.min)) * 60_000);
}

export async function loadAutoOpen(): Promise<AutoOpenState> {
  try {
    const raw = (await ext.storage.local.get(AUTO_OPEN_KEY))[AUTO_OPEN_KEY] as Partial<AutoOpenState> | undefined;
    return { ...DEFAULT_AUTO_OPEN, ...(raw ?? {}), ...normalizeBounds(raw?.min, raw?.max) };
  } catch {
    return { ...DEFAULT_AUTO_OPEN };
  }
}

export async function saveAutoOpen(patch: Partial<AutoOpenState>): Promise<AutoOpenState> {
  const next = { ...(await loadAutoOpen()), ...patch };
  await ext.storage.local.set({ [AUTO_OPEN_KEY]: next });
  return next;
}
