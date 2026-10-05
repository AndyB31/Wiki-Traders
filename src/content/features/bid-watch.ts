/**
 * Suivi de mes mises en direct (comme « Mes enchères » de « Prix moyen collection ») :
 *  - bloc « Mises en direct » sous le résumé Wiky-Traders de la barre latérale : en tête / surenchéri, temps restant
 *    à la seconde, prix actuel ;
 *  - relecture plus fréquente quand une mise se termine dans les 10 minutes (voir `bidPollDelay`, appelé par index.ts) ;
 *  - bip sous la minute quand je suis surenchéri ;
 *  - « Surenchérir (+min) » (automatisation, désactivée par défaut) : mise minimale calculée comme le site, après
 *    confirmation montrant le montant et mon solde. Seule écriture possible : `POST /api/marketplace/{id}/bid`.
 */
import { featureFlags } from '../../lib/features';
import { load, onStoreChange, save } from '../../lib/storage';
import type { MyBid, MyBidsResult } from '../../lib/types';
import { showProgress } from '../overlay';
import { siteNav } from '../site-ui';
import { enableAudio, urgentBeep } from './audio';
import { type FeatureContext, registerFeature } from './runtime';
import { button, confirmDialog, ensureFeatureStyle, node, wiki } from './ui';

/** Fenêtre « bientôt terminée » : relecture rapprochée. */
export const SOON_MS = 10 * 60_000;
export const ALERT_MS = 60_000;

// ---------------------------------------------------------------- logique (sans DOM)

const isRunning = (b: MyBid, now: number) => (b.status === 'leading' || b.status === 'outbid') && (b.endsAt == null || b.endsAt > now);

/**
 * Délai de relecture de mes mises : 20 s (onglet visible) ou 60 s (caché) si l'une d'elles se termine dans les
 * 10 minutes ; null sinon (le rythme normal, une fois par minute, suffit).
 */
export function bidPollDelay(bids: MyBid[], now: number, visible: boolean): number | null {
  const soon = bids.some((b) => isRunning(b, now) && b.endsAt != null && b.endsAt - now <= SOON_MS);
  if (!soon) return null;
  return visible ? 20_000 : 60_000;
}

/**
 * Mise minimale suivante, comme le site : sans enchère, le prix de départ ; sinon +10 % arrondi au supérieur.
 * `price` : enchère en cours (ou prix de départ).
 */
export function nextMinBid(price: number | null, hasBid: boolean): number | null {
  if (price == null || !Number.isFinite(price) || price <= 0) return null;
  return hasBid ? Math.ceil((price * 11) / 10) : Math.ceil(price);
}

/** Minimum annoncé dans un message d'erreur du site (« … minimum 1 234 wikibidous »). */
export function parseMinimumFromError(message: unknown): number | null {
  const m = /minimum\s+(\d[\d\s  .,]*)\s*wikibidous/i.exec(String(message ?? ''));
  if (!m) return null;
  const n = Number(m[1].replace(/\D/g, ''));
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** « 1 h 05 », « 4 min 07 s », « 38 s », « Terminée ». */
export function formatRemaining(ms: number): string {
  if (!(ms > 0)) return 'Terminée';
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h) return `${h} h ${String(m).padStart(2, '0')}`;
  if (m) return `${m} min ${String(sec).padStart(2, '0')} s`;
  return `${sec} s`;
}

/** Alerte une seule fois par enchère quand je suis surenchéri à moins d'une minute de la fin. */
export class OutbidAlerts {
  private alerted = new Set<string>();

  collect(bids: MyBid[], now: number, threshold = ALERT_MS): string[] {
    const fresh: string[] = [];
    const present = new Set<string>();
    for (const b of bids) {
      present.add(b.auctionId);
      const left = b.endsAt == null ? Infinity : b.endsAt - now;
      if (b.status !== 'outbid' || left > threshold) this.alerted.delete(b.auctionId);
      else if (left > 0 && !this.alerted.has(b.auctionId)) {
        this.alerted.add(b.auctionId);
        fresh.push(b.auctionId);
      }
    }
    for (const id of [...this.alerted]) if (!present.has(id)) this.alerted.delete(id);
    return fresh;
  }
}

// ---------------------------------------------------------------- surenchère (automatisation)

/** Minimum appris d'un refus du site, pour un prix donné. */
const minHints = new Map<string, { price: number | null; amount: number }>();

export interface OutbidResult {
  ok: boolean;
  amount?: number;
  error?: string;
}

interface LiveAuction {
  price: number | null;
  hasBid: boolean;
  leading: boolean | null;
  endsAt: number | null;
}

/** Enchère relue sur le site (`GET /api/marketplace/{id}` → `{ auction }`) ; null si indisponible. */
async function liveAuction(id: string, doFetch: typeof fetch): Promise<LiveAuction | null> {
  try {
    const res = await doFetch(`/api/marketplace/${encodeURIComponent(id)}`, { method: 'GET', credentials: 'include', headers: { accept: '*/*' } });
    if (!res.ok) return null;
    const json = (await res.json()) as { auction?: Record<string, unknown> } | null;
    const a = json?.auction;
    if (!a) return null;
    const num = (v: unknown) => (v == null || v === '' || !Number.isFinite(Number(v)) || Number(v) <= 0 ? null : Number(v));
    const bid = num(a.effective_bid) ?? num(a.current_bid);
    return {
      price: bid ?? num(a.listing_base_amount) ?? num(a.base_amount),
      hasBid: num(a.current_bid) != null,
      leading: null,
      endsAt: Date.parse(String(a.end_at ?? '')) || null,
    };
  } catch {
    return null;
  }
}

/** Mon solde de WikiBidous (`GET /api/wikibidous` → `{ balance }`) ; null si indisponible. */
export async function fetchBalance(doFetch: typeof fetch = fetch.bind(globalThis)): Promise<number | null> {
  try {
    const res = await doFetch('/api/wikibidous', { method: 'GET', credentials: 'include', headers: { accept: '*/*' } });
    if (!res.ok) return null;
    const n = Number(((await res.json()) as { balance?: unknown } | null)?.balance);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

async function quickOutbidAllowed(): Promise<boolean> {
  try {
    const { settings } = await load('settings');
    return featureFlags(settings.features).quickOutbid && settings.apiRead;
  } catch {
    return false;
  }
}

/**
 * Surenchérit au minimum sur une enchère où je suis dépassé, après confirmation (montant et solde).
 * Rien n'est envoyé si l'option est coupée (vérifié au clic, puis à nouveau juste avant l'envoi).
 */
export async function quickOutbid(
  auctionId: string,
  opts: { fetchImpl?: typeof fetch; confirm?: typeof confirmDialog; now?: number } = {},
): Promise<OutbidResult> {
  if (!(await quickOutbidAllowed())) return { ok: false, error: 'Surenchère en un clic désactivée.' };
  const doFetch = opts.fetchImpl ?? fetch.bind(globalThis);
  const ask = opts.confirm ?? confirmDialog;
  const now = opts.now ?? Date.now();
  const { bidsCache } = await load('bidsCache');
  const cached = bidsCache?.bids.find((b) => b.auctionId === auctionId);
  if (!cached) return { ok: false, error: 'Enchère inconnue : actualise mes mises.' };
  if (cached.status === 'leading') return { ok: false, error: 'Tu es déjà en tête.' };
  const [live, balance] = await Promise.all([liveAuction(auctionId, doFetch), fetchBalance(doFetch)]);
  const endsAt = live?.endsAt ?? cached.endsAt;
  if (endsAt != null && endsAt <= now) return { ok: false, error: 'Enchère terminée.' };
  const price = live?.price ?? cached.current;
  // Si j'ai misé, l'enchère a forcément une mise en cours.
  const computed = nextMinBid(price, live?.hasBid ?? true);
  const hint = minHints.get(auctionId);
  const amount = computed != null && hint && hint.price === price ? Math.max(computed, hint.amount) : computed ?? hint?.amount ?? null;
  if (amount == null) return { ok: false, error: 'Prix actuel inconnu.' };
  const low = balance != null && balance < amount;
  const ok = await ask({
    title: `Surenchérir sur ${cached.cardName} ?`,
    text: [
      `Mise : ${wiki(amount)} (minimum, prix actuel ${wiki(price)})`,
      `Solde : ${balance != null ? wiki(balance) : 'inconnu'}${low ? ' — insuffisant' : ''}`,
      cached.cardMedian != null ? `Prix moyen de la carte : ${wiki(cached.cardMedian)}` : '',
      '',
      'Mise faite à ta place : contraire aux règles du site.',
    ].filter((l, i, a) => l || a[i - 1]).join('\n'),
    confirm: `Miser ${wiki(amount)}`,
  });
  if (!ok) return { ok: false, error: 'Annulé.' };
  // L'option a pu être coupée pendant la confirmation.
  if (!(await quickOutbidAllowed())) return { ok: false, error: 'Surenchère en un clic désactivée.' };
  let res: Response;
  let json: Record<string, unknown> | null = null;
  try {
    res = await doFetch(`/api/marketplace/${encodeURIComponent(auctionId)}/bid`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount }),
    });
    json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  } catch {
    return { ok: false, amount, error: 'Erreur réseau : vérifie l\'enchère avant de réessayer.' };
  }
  if (!res.ok) {
    const error = String(json?.error ?? json?.message ?? `Mise refusée (erreur ${res.status}).`);
    const min = parseMinimumFromError(error);
    if (min) minHints.set(auctionId, { price, amount: min });
    return { ok: false, amount, error };
  }
  minHints.delete(auctionId);
  // Mise à jour immédiate (la prochaine relecture confirmera).
  const confirmed = Number(json?.current_bid);
  const current = Number.isFinite(confirmed) && confirmed > 0 ? confirmed : amount;
  const fresh = await load('bidsCache');
  if (fresh.bidsCache) {
    const bids = fresh.bidsCache.bids.map((b) =>
      b.auctionId === auctionId ? { ...b, status: 'leading' as const, current, myMax: Math.max(b.myMax, amount), myBids: b.myBids + 1, lastBidAt: Date.now() } : b,
    );
    await save({ bidsCache: { ...fresh.bidsCache, bids } });
  }
  return { ok: true, amount };
}

/** Surenchère depuis l'interface : toast de résultat. */
export async function quickOutbidWithToast(auctionId: string): Promise<OutbidResult> {
  const r = await quickOutbid(auctionId);
  if (r.ok) showProgress('Surenchère', `Mise de ${wiki(r.amount)} envoyée : tu es en tête.`, { done: true });
  else if (r.error !== 'Annulé.') showProgress('Surenchère', r.error ?? 'Mise refusée.', { error: true });
  return r;
}

// ---------------------------------------------------------------- affichage

const CSS = `
[data-wiky="bid-watch"] { margin: 6px 0 4px; padding: 8px 10px; border-radius: 12px; border: 1px solid rgba(249,115,22,.22); background: rgba(249,115,22,.05);
  font-size: 11.5px; color: var(--color-foreground, #e7e5e4); }
[data-wiky="bid-watch"].floating { position: fixed; left: 16px; bottom: 64px; z-index: 2147483645; width: 260px; background: var(--color-surface, #1c1917);
  box-shadow: 0 10px 30px rgba(0,0,0,.4); }
[data-wiky="bid-watch"] .wiky-bw-head { display: flex; align-items: center; gap: 6px; font-weight: 700; font-size: 11px; letter-spacing: .04em; text-transform: uppercase; color: #fb923c; margin-bottom: 4px; }
[data-wiky="bid-watch"] .wiky-bw-row { display: grid; grid-template-columns: 8px 1fr auto; gap: 2px 6px; align-items: center; padding: 4px 0; border-top: 1px solid color-mix(in srgb, var(--color-foreground, #e7e5e4) 8%, transparent); }
[data-wiky="bid-watch"] .wiky-bw-row:first-of-type { border-top: 0; }
[data-wiky="bid-watch"] .wiky-bw-dot { width: 7px; height: 7px; border-radius: 50%; background: #22c55e; }
[data-wiky="bid-watch"] .outbid .wiky-bw-dot { background: #ef4444; }
[data-wiky="bid-watch"] .wiky-bw-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; color: inherit; text-decoration: none; }
[data-wiky="bid-watch"] .wiky-bw-name:hover { text-decoration: underline; }
[data-wiky="bid-watch"] .wiky-bw-time { font-variant-numeric: tabular-nums; font-weight: 700; }
[data-wiky="bid-watch"] .soon .wiky-bw-time { color: #fdba74; }
[data-wiky="bid-watch"] .urgent .wiky-bw-time { color: #f87171; }
[data-wiky="bid-watch"] .urgent.outbid { animation: wiky-bw-blink 1s ease infinite; }
[data-wiky="bid-watch"] .wiky-bw-sub { grid-column: 2 / -1; display: flex; align-items: center; gap: 6px; color: color-mix(in srgb, var(--color-foreground, #e7e5e4) 55%, transparent); }
[data-wiky="bid-watch"] .wiky-bw-sub .wiky-f-btn { margin-left: auto; }
@keyframes wiky-bw-blink { 50% { background: rgba(239,68,68,.12); } }
`;

const MAX_ROWS = 4;
let ctx: FeatureContext | null = null;
let cache: MyBidsResult | null = null;
let watching = false;
let ticker: ReturnType<typeof setInterval> | undefined;
const alerts = new OutbidAlerts();

async function loadCache(): Promise<void> {
  try {
    cache = (await load('bidsCache')).bidsCache;
  } catch {
    cache = null;
  }
}

function running(now: number): MyBid[] {
  return (cache?.bids ?? []).filter((b) => isRunning(b, now)).sort((a, b) => (a.endsAt ?? Infinity) - (b.endsAt ?? Infinity));
}

function rowClass(b: MyBid, now: number): string {
  const left = b.endsAt == null ? Infinity : b.endsAt - now;
  return `wiky-bw-row ${b.status}${left <= ALERT_MS ? ' urgent' : left <= SOON_MS ? ' soon' : ''}`;
}

function draw(): void {
  const c = ctx;
  const existing = document.querySelector<HTMLElement>('[data-wiky="bid-watch"]');
  const now = Date.now();
  const list = c ? running(now) : [];
  if (!c || !list.length) {
    existing?.remove();
    return;
  }
  const quick = c.flags.quickOutbid && c.apiRead;
  const nav = siteNav();
  const anchor = nav?.querySelector(':scope > [data-wiky="nav-wiky"]') ?? null;
  // Sans barre latérale (intégration coupée, mobile) : petit bloc flottant, seulement quand une fin approche.
  const floating = !anchor;
  if (floating && !list.some((b) => b.endsAt != null && b.endsAt - now <= SOON_MS)) {
    existing?.remove();
    return;
  }
  const shown = list.slice(0, MAX_ROWS);
  const key = JSON.stringify([floating, quick, shown.map((b) => [b.auctionId, b.status, b.current, b.endsAt]), list.length]);
  const placed = floating ? existing?.parentElement === document.body : existing?.previousElementSibling === anchor;
  if (existing && placed && existing.dataset.key === key) {
    tick(existing, now);
    return;
  }
  ensureFeatureStyle();
  ensureFeatureStyle(CSS, 'bids');
  const box = existing ?? node('div', 'bid-watch');
  box.dataset.key = key;
  box.className = floating ? 'floating' : '';
  const head = node('div', 'part', 'wiky-bw-head', `Mises en direct · ${list.length}`);
  const rows = shown.map((b) => {
    const row = node('div', 'part', rowClass(b, now));
    row.dataset.ends = String(b.endsAt ?? '');
    row.dataset.status = b.status;
    const link = node('a', 'part', 'wiky-bw-name', `${b.cardName}${b.shiny ? ' ✨' : ''}`);
    link.href = `/marketplace/${encodeURIComponent(b.auctionId)}`;
    link.title = `${b.cardName} — ${b.status === 'leading' ? 'en tête' : 'surenchéri'}`;
    const time = node('span', 'part', 'wiky-bw-time', b.endsAt ? formatRemaining(b.endsAt - now) : '—');
    time.dataset.role = 'time';
    const sub = node('div', 'part', 'wiky-bw-sub');
    sub.append(node('span', 'part', b.status === 'leading' ? 'wiky-win' : 'wiky-lose', b.status === 'leading' ? 'En tête' : 'Surenchéri'), node('span', 'part', '', `· ${wiki(b.current)}`));
    if (quick && b.status === 'outbid') {
      const next = nextMinBid(b.current, true);
      const btn = button(`Surenchérir${next ? ` ${next}` : ''}`, async () => {
        btn.disabled = true;
        await quickOutbidWithToast(b.auctionId);
        btn.disabled = false;
      }, '', true);
      btn.title = 'Surenchérir au minimum (+10 %), après confirmation';
      sub.append(btn);
    }
    row.append(node('span', 'part', 'wiky-bw-dot'), link, time, sub);
    return row;
  });
  box.replaceChildren(head, ...rows);
  if (list.length > MAX_ROWS) box.append(node('div', 'part', 'wiky-f-muted', `+ ${list.length - MAX_ROWS} autre(s) dans « Mes mises »`));
  if (floating) {
    if (!placed) document.body.append(box);
  } else if (!placed) anchor!.after(box);
}

/** Mise à jour à la seconde : temps restant, couleur, bip sous la minute si je suis surenchéri. */
function tick(box: HTMLElement | null, now: number): void {
  for (const row of box?.querySelectorAll<HTMLElement>('.wiky-bw-row') ?? []) {
    const ends = Number(row.dataset.ends) || null;
    const t = row.querySelector<HTMLElement>('[data-role="time"]');
    const text = ends ? formatRemaining(ends - now) : '—';
    if (t && t.textContent !== text) t.textContent = text;
    const cls = rowClass({ endsAt: ends, status: row.dataset.status } as MyBid, now);
    if (row.className !== cls) row.className = cls;
  }
}

function onTick(): void {
  const now = Date.now();
  if (!ctx || !running(now).length) {
    stopTicker();
    draw();
    return;
  }
  const box = document.querySelector<HTMLElement>('[data-wiky="bid-watch"]');
  // Le résumé de la barre latérale a été redessiné (ou une enchère s'est terminée) : on replace le bloc.
  if (!box?.isConnected || running(now).length !== Number(box.querySelector('.wiky-bw-head')?.textContent?.match(/\d+$/)?.[0] ?? -1)) draw();
  else tick(box, now);
  if (alerts.collect(cache?.bids ?? [], now).length) urgentBeep();
}

function stopTicker(): void {
  clearInterval(ticker);
  ticker = undefined;
}

function syncTicker(): void {
  if (ctx && running(Date.now()).length) ticker ??= setInterval(onTick, 1000);
  else stopTicker();
}

registerFeature({
  keys: ['bidWatch'],
  needsApi: true,
  render(c) {
    const first = !ctx;
    ctx = c;
    enableAudio();
    if (!watching) {
      watching = true;
      try {
        onStoreChange(['bidsCache'], () => void loadCache().then(() => {
          if (!ctx) return;
          draw();
          syncTicker();
        }));
      } catch {
        // Hors extension (tests).
      }
    }
    if (first) {
      void loadCache().then(() => {
        draw();
        syncTicker();
      });
      return;
    }
    draw();
    syncTicker();
  },
  cleanup() {
    ctx = null;
    stopTicker();
    document.querySelector('[data-wiky="bid-watch"]')?.remove();
  },
});

/** Pour les tests. */
export function setBidsForTest(result: MyBidsResult | null, c: FeatureContext | null): void {
  cache = result;
  ctx = c;
  draw();
}
