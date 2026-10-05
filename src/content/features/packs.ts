/**
 * Paquets : récapitulatif d'ouverture (cartes, rareté, déjà possédée ?, prix moyen, total), statistiques de tirage,
 * « Ouvrir tous les paquets » et ouverture automatique (automatisations, désactivées par défaut).
 *
 * Les cartes obtenues viennent de la réponse du site lui-même (`POST /api/packs/open`, relayée par bridge.ts) :
 * aucune requête en plus, et les prix arrivent en un seul appel groupé (`cardPrices`).
 */
import { featureFlags, type FeatureKey } from '../../lib/features';
import { load } from '../../lib/storage';
import { formatDuration } from '../../lib/text';
import { cardPrices, knownPrice, type CardPrice } from '../catalog';
import { onSiteResponse } from '../net';
import { endProgress, showProgress } from '../overlay';
import { AUTO_OPEN_KEY, buildRecap, loadAutoOpen, loadPullStats, mapPackCards, normalizeBounds, openPacksSequence, PULL_STATS_KEY, pullShares, randomDelay, recordPulls, resetPullStats, saveAutoOpen, type AutoOpenState, type OpenAllResult, type PackCard, type PullStats, importOtherPullStats, OTHER_PULL_STATS_KEY, readOtherPullStats } from './packs-logic';
import { type FeatureContext, registerFeature } from './runtime';
import { button, confirmDialog, ensureFeatureStyle, floatingPanel, node, rarityChip, RARITY_COLORS, wiki } from './ui';
import { ext } from '../../lib/browser';
import { sharePack } from './pull-image';

const CSS = `
[data-wiky="pulls-tools"][data-opening] .wiky-pt-box { display: none; }
[data-wiky="pulls-tools"] { display: flex; flex-direction: column; gap: 10px; margin: 12px 0; }
.wiky-pt-bar { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.wiky-pt-box { padding: 12px 14px; border-radius: 14px; border: 1px solid var(--color-border, rgba(255,255,255,.12)); background: var(--color-surface, #1c1917); }
.wiky-pt-box h3 { margin: 0; font-size: 13px; font-weight: 700; display: flex; align-items: baseline; gap: 8px; }
.wiky-pt-box h3 small { font-weight: 500; font-size: 11.5px; color: color-mix(in srgb, var(--color-foreground, #e7e5e4) 50%, transparent); }
.wiky-pt-stats { display: grid; grid-template-columns: 28px 1fr 46px 40px; gap: 5px 8px; align-items: center; margin-top: 8px; font-size: 12px; font-variant-numeric: tabular-nums; }
.wiky-pt-track { height: 7px; border-radius: 999px; overflow: hidden; background: color-mix(in srgb, var(--color-foreground, #e7e5e4) 10%, transparent); }
.wiky-pt-track i { display: block; height: 100%; border-radius: inherit; background: var(--wiky-rar, #f97316); }
.wiky-pt-num { text-align: right; color: color-mix(in srgb, var(--color-foreground, #e7e5e4) 65%, transparent); }
.wiky-pt-auto { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; font-size: 12px; }
.wiky-pt-auto input { width: 58px; padding: 4px 6px; border-radius: 8px; border: 1px solid var(--color-border, rgba(255,255,255,.18)); background: var(--color-surface-light, rgba(255,255,255,.04));
  color: inherit; font: inherit; }
.wiky-pt-on { color: #4ade80; font-weight: 700; }
[data-wiky="auto-open-pill"] { position: fixed; left: 16px; bottom: 16px; z-index: 2147483645; display: flex; align-items: center; gap: 8px; padding: 6px 8px 6px 12px;
  border-radius: 999px; border: 1px solid rgba(249,115,22,.45); background: var(--color-surface, #1c1917); color: var(--color-foreground, #e7e5e4); font-size: 12px;
  box-shadow: 0 8px 24px rgba(0,0,0,.35); }
[data-wiky="auto-open-pill"] .wiky-dot { width: 8px; height: 8px; border-radius: 50%; background: #f97316; animation: wiky-f-pulse 1.6s ease infinite; }
@keyframes wiky-f-pulse { 50% { opacity: .35; } }
`;

let ctx: FeatureContext | null = null;
const flag = (k: FeatureKey) => !!ctx?.flags[k];

/** Réglages relus au moment d'agir : une automatisation ne part jamais si l'option vient d'être coupée. */
async function flagNow(k: FeatureKey): Promise<boolean> {
  try {
    const { settings } = await load('settings');
    return featureFlags(settings.features)[k];
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------- dernier paquet et écran d'ouverture

interface PackResult {
  cards: PackCard[];
  packs: number;
  at: number;
  title: string;
  /** Exemplaires possédés avant l'ouverture (instantané). */
  owned: Map<string, number>;
  error?: string | null;
}

let last: PackResult | null = null;
let pending: PackResult | null = null;
let dismissedAt = 0;

/** Dernier paquet ouvert (pour le partage en image). */
export function lastPack(): PackResult | null {
  return last;
}

/** Compteur « Carte X / N » de l'écran d'ouverture du site (null : pas d'ouverture affichée). */
export function pullCounter(root: ParentNode = document): { current: number; total: number; stage: HTMLElement } | null {
  if (!location.pathname.startsWith('/pull')) return null;
  const main = root.querySelector('main');
  if (!main) return null;
  for (const el of main.querySelectorAll<HTMLElement>('div, p, span')) {
    if (el.closest('[data-wiky]')) continue;
    const m = (el.textContent ?? '').replace(/\s+/g, ' ').trim().match(/^Carte\s*(\d+)\s*\/\s*(\d+)$/i);
    if (!m) continue;
    // Le conteneur de l'écran : premier parent qui contient aussi des boutons.
    let stage: HTMLElement = el;
    while (stage.parentElement && stage.parentElement !== main && !stage.querySelector('button')) stage = stage.parentElement;
    return { current: Number(m[1]), total: Number(m[2]), stage };
  }
  return null;
}

function ownedSnapshot(c: FeatureContext | null): Map<string, number> {
  const map = new Map<string, number>();
  for (const card of Object.values(c?.cards ?? {})) {
    const q = Math.max(1, card.quantity || 1);
    if (card.siteId) map.set(`id:${card.siteId}`, q);
    map.set(`n:${card.name.trim().toLowerCase()}`, q);
  }
  return map;
}

const ownedOf = (owned: Map<string, number>) => (c: PackCard) => owned.get(`id:${c.siteId}`) ?? owned.get(`n:${c.title.trim().toLowerCase()}`) ?? 0;

// ---------------------------------------------------------------- récapitulatif

let recapSeq = 0;

/** Affiche le récapitulatif d'un ou plusieurs paquets ; les prix sont chargés en une requête groupée. */
export async function showRecap(result: PackResult, fetchPrices = !!ctx?.apiRead): Promise<void> {
  const seq = ++recapSeq;
  const draw = (prices: Map<string, CardPrice>, loading: boolean) => {
    if (seq !== recapSeq) return;
    const recap = buildRecap(result.cards, prices, ownedOf(result.owned));
    const { body, foot } = floatingPanel('pack-recap', result.packs > 1 ? `Wiky-Traders · ${result.packs} paquets` : 'Wiky-Traders · paquet', result.title, () => {
      dismissedAt = result.at;
    });
    for (const r of recap.rows) {
      const row = node('div', 'part', 'wiky-f-row');
      const name = node('span', 'part', 'wiky-f-name', r.title);
      name.title = r.title;
      const tag = r.ownedBefore || r.repeat
        ? node('span', 'part', 'wiky-f-tag dup', r.ownedBefore ? `×${r.ownedBefore + (r.repeat ? 1 : 0)}` : 'doublon')
        : node('span', 'part', 'wiky-f-tag new', 'Nouvelle');
      tag.title = r.ownedBefore ? `Déjà possédée (${r.ownedBefore} exemplaire${r.ownedBefore > 1 ? 's' : ''} avant)` : r.repeat ? 'Obtenue plus haut dans ce récapitulatif' : 'Jamais possédée';
      const price = node('span', 'part', `wiky-f-price${r.price == null ? ' wiky-f-muted' : ''}`, loading && r.price == null ? '…' : wiki(r.price));
      row.append(rarityChip(r.rarity), name, tag, price);
      body.append(row);
    }
    const total = node('span', 'part');
    total.append('Total ', node('b', 'part', '', wiki(recap.total)));
    const meta = node('span', 'part', 'wiky-f-muted', loading ? 'chargement des prix…' : `${recap.priced}/${recap.rows.length} cotées · ${recap.fresh} nouvelle${recap.fresh > 1 ? 's' : ''}`);
    foot.append(total, meta);
    if (!fetchPrices) foot.append(node('span', 'part', 'wiky-f-muted', 'Prix : active la lecture via l\'API dans les réglages.'));
    if (result.error) foot.append(node('span', 'part', '', `⚠ ${result.error}`));
    if (flag('pullShare')) {
      const share = button('Copier en image', () => void sharePack(result, share), 'ghost', true);
      share.style.marginLeft = 'auto';
      foot.append(share);
    }
  };
  const ids = result.cards.map((c) => c.siteId);
  const known = new Map(ids.flatMap((id) => (knownPrice(id) ? [[id, knownPrice(id)!] as const] : [])));
  draw(known, fetchPrices && known.size < new Set(ids).size);
  if (!fetchPrices) return;
  try {
    draw(await cardPrices(ids), false);
  } catch {
    draw(known, false);
  }
}

function hideRecap(): void {
  recapSeq++;
  document.querySelector('[data-wiky="pack-recap"]')?.remove();
}

/** Récapitulatif en attente : affiché quand la dernière carte du paquet est révélée (ou hors de l'écran d'ouverture). */
function maybeShowPending(): void {
  if (!pending) return;
  const counter = pullCounter();
  if (counter && counter.current < counter.total) return;
  const p = pending;
  pending = null;
  if (dismissedAt !== p.at) void showRecap(p);
}

// ---------------------------------------------------------------- statistiques de tirage

let stats: PullStats | null = null;

async function refreshStats(): Promise<void> {
  stats = await loadPullStats();
}

function statsBox(s: PullStats): HTMLElement {
  const box = node('div', 'part', 'wiky-pt-box');
  const h = node('h3', 'part', '', 'Mes statistiques de tirage');
  h.append(node('small', 'part', '', `${s.total} carte${s.total > 1 ? 's' : ''} · ${s.packs} paquet${s.packs > 1 ? 's' : ''} depuis le ${new Date(s.since).toLocaleDateString('fr-FR')}`));
  box.append(h);
  if (!s.total) {
    box.append(node('p', 'part', 'wiky-f-muted', 'Aucune carte comptée pour le moment : ouvre un paquet pour commencer.'));
    importButton(box);
    return box;
  }
  const grid = node('div', 'part', 'wiky-pt-stats');
  for (const r of pullShares(s)) {
    const track = node('span', 'part', 'wiky-pt-track');
    const fill = node('i', 'part');
    fill.style.width = `${r.pct}%`;
    fill.style.setProperty('--wiky-rar', RARITY_COLORS[r.rarity]);
    track.append(fill);
    grid.append(rarityChip(r.rarity), track, node('span', 'part', 'wiky-pt-num', `${r.pct.toLocaleString('fr-FR')} %`), node('span', 'part', 'wiky-pt-num', String(r.count)));
  }
  const reset = button('Réinitialiser', async () => {
    const ok = await confirmDialog({ title: 'Réinitialiser les statistiques ?', text: 'Les compteurs de tirage repartent de zéro.', confirm: 'Réinitialiser' });
    if (!ok) return;
    await resetPullStats();
    await refreshStats();
    redrawTools();
  }, 'ghost', true);
  reset.style.marginTop = '8px';
  box.append(grid, reset);
  importButton(box);
  return box;
}

/** Statistiques d'une autre extension disponibles à l'import (lecture du localStorage du site). */
function otherStatsAvailable(): boolean {
  try {
    return !!readOtherPullStats(localStorage.getItem(OTHER_PULL_STATS_KEY));
  } catch {
    return false;
  }
}

/** Bouton « Importer depuis une autre extension », à côté de « Réinitialiser ». */
function importButton(box: HTMLElement): void {
  if (!otherStatsAvailable()) return;
  const b = button('Importer depuis une autre extension', async () => {
    const ok = await confirmDialog({
      title: 'Importer les statistiques ?',
      text: 'Les compteurs de tirage enregistrés par une autre extension sont repris : pour chaque rareté, le plus grand des deux compteurs est gardé (les paquets comptés par les deux ne sont pas comptés deux fois).',
      confirm: 'Importer',
    });
    if (!ok) return;
    const next = await importOtherPullStats();
    if (next) stats = next;
    redrawTools();
  }, 'ghost', true);
  b.style.marginTop = '8px';
  b.style.marginLeft = '8px';
  box.append(b);
}

// ---------------------------------------------------------------- ouvrir tous les paquets

let busy = false;
let stopper: AbortController | null = null;
const LOCK = 'wm-pack-opening';

/** Verrou partagé entre onglets (et avec « Prix moyen collection ») : une seule ouverture à la fois. */
async function withLock<T>(job: () => Promise<T>): Promise<T | null> {
  const locks = (navigator as Navigator & { locks?: LockManager }).locks;
  if (!locks?.request) return job();
  return locks.request(LOCK, { ifAvailable: true }, (lock) => (lock ? job() : null)) as Promise<T | null>;
}

/**
 * Ouvre tous les paquets disponibles (même requête que le site), avec progression et bouton Arrêter,
 * puis affiche le récapitulatif de tout ce qui a été obtenu. Ne fait rien si l'option est coupée.
 */
export async function openAllPacks(opts: { key?: FeatureKey; title?: string; fetchImpl?: typeof fetch; pause?: () => number } = {}): Promise<OpenAllResult | null> {
  const key = opts.key ?? 'openAllPacks';
  if (busy || !(await flagNow(key))) return null;
  busy = true;
  const controller = new AbortController();
  stopper = controller;
  const title = opts.title ?? 'Ouverture des paquets';
  const owned = ownedSnapshot(ctx);
  redrawTools();
  try {
    const result = await withLock(async () => {
      showProgress(title, 'Ouverture du premier paquet…', { onStop: () => controller.abort() });
      return openPacksSequence({
        signal: controller.signal,
        fetchImpl: opts.fetchImpl,
        pause: opts.pause,
        onPack: (cards, opened, remaining) => {
          void recordPulls(cards).then((s) => {
            stats = s;
            redrawTools();
          });
          const total = remaining != null ? opened + remaining : undefined;
          showProgress(title, `${opened}${total ? `/${total}` : ''} paquet${opened > 1 ? 's' : ''} ouvert${opened > 1 ? 's' : ''}\n${cards.map((c) => `${c.rarity ?? '?'} · ${c.title}`).join('\n')}`, {
            onStop: () => controller.abort(),
            step: opened,
            total,
          });
        },
        onWait: (ms, reason) => {
          if (reason === 'rate') showProgress(title, `Limite du site : reprise dans ${Math.ceil(ms / 1000)} s`, { onStop: () => controller.abort() });
        },
      });
    });
    if (!result) {
      showProgress(title, 'Une ouverture est déjà en cours dans un autre onglet.', { error: true });
      return null;
    }
    const summary = result.opened
      ? `${result.opened} paquet${result.opened > 1 ? 's' : ''} ouvert${result.opened > 1 ? 's' : ''}, ${result.cards.length} cartes${result.cancelled ? ' (arrêté)' : ''}`
      : result.error ?? 'Aucun paquet à ouvrir.';
    if (result.error && !result.opened) showProgress(title, summary, { error: true });
    else {
      showProgress(title, summary, { done: true });
      setTimeout(endProgress, 2500);
    }
    if (result.cards.length) {
      const pack: PackResult = { cards: result.cards, packs: result.opened, at: Date.now(), title: `${result.cards.length} cartes obtenues`, owned, error: result.error };
      last = pack;
      void showRecap(pack);
    }
    return result;
  } finally {
    busy = false;
    stopper = null;
    redrawTools();
  }
}

// ---------------------------------------------------------------- ouverture automatique

let auto: AutoOpenState | null = null;
let autoTimer: ReturnType<typeof setInterval> | undefined;

async function refreshAuto(): Promise<void> {
  auto = await loadAutoOpen();
}

/** Lance un cycle si l'heure est venue (onglet visible, option active, rien en cours). */
export async function autoTick(now = Date.now(), fetchImpl?: typeof fetch): Promise<void> {
  auto ??= await loadAutoOpen();
  if (!auto.on || busy || document.visibilityState !== 'visible') return;
  if (auto.nextAt && auto.nextAt > now) return;
  if (!(await flagNow('autoOpenPacks'))) return;
  // Relu juste avant : un autre onglet a peut-être déjà ouvert (et repoussé la prochaine heure).
  const fresh = await loadAutoOpen();
  if (!fresh.on || (fresh.nextAt && fresh.nextAt > now)) {
    auto = fresh;
    return;
  }
  auto = await saveAutoOpen({ nextAt: now + randomDelay(fresh.min, fresh.max) });
  const result = await openAllPacks({ key: 'autoOpenPacks', title: 'Ouverture automatique', fetchImpl });
  auto = await saveAutoOpen({ lastRun: { at: Date.now(), opened: result?.opened ?? 0, error: result?.error ?? null } });
  redrawTools();
}

function syncAutoTimer(): void {
  const want = flag('autoOpenPacks') && !!auto?.on;
  if (want && !autoTimer) autoTimer = setInterval(() => {
    void autoTick();
    drawAutoPill();
  }, 15_000);
  if (!want && autoTimer) {
    clearInterval(autoTimer);
    autoTimer = undefined;
  }
}

async function setAuto(on: boolean): Promise<void> {
  if (on && !(await flagNow('autoOpenPacks'))) return;
  if (on) {
    const ok = await confirmDialog({
      title: 'Ouverture automatique',
      text: `Tant qu'un onglet WikiMasters est ouvert et visible, tes paquets seront ouverts toutes les ${auto?.min ?? 30} à ${auto?.max ?? 90} minutes (au hasard).\n\nAutomatisation contraire aux règles du site : risque de bannissement.`,
      confirm: 'Démarrer',
    });
    if (!ok) return;
  }
  const cur = auto ?? (await loadAutoOpen());
  auto = await saveAutoOpen({ on, nextAt: on ? Date.now() + randomDelay(cur.min, cur.max) : null });
  if (!on) stopper?.abort();
  syncAutoTimer();
  redrawTools();
  drawAutoPill();
}

function drawAutoPill(): void {
  const show = flag('autoOpenPacks') && !!auto?.on;
  let pill = document.querySelector<HTMLElement>('[data-wiky="auto-open-pill"]');
  if (!show) {
    pill?.remove();
    return;
  }
  const text = busy ? 'Ouverture en cours…' : auto?.nextAt ? `prochaine dans ${formatDuration(auto.nextAt - Date.now())}` : 'en attente';
  if (pill?.dataset.key === text) return;
  ensureFeatureStyle(CSS, 'packs');
  if (!pill) {
    pill = node('div', 'auto-open-pill');
    pill.setAttribute('role', 'status');
    document.body.append(pill);
  }
  pill.dataset.key = text;
  pill.replaceChildren(node('span', 'part', 'wiky-dot'), node('span', 'part', '', `Ouverture auto · ${text}`), button('Arrêter', () => void setAuto(false), 'ghost', true));
  pill.title = 'Ouverture automatique des paquets (Wiky-Traders)';
}

function autoBox(a: AutoOpenState): HTMLElement {
  const box = node('div', 'part', 'wiky-pt-box');
  const h = node('h3', 'part', '', 'Ouverture automatique');
  h.append(node('small', 'part', a.on ? 'wiky-pt-on' : '', a.on ? (a.nextAt ? `active · prochaine dans ${formatDuration(a.nextAt - Date.now())}` : 'active') : 'arrêtée'));
  const row = node('div', 'part', 'wiky-pt-auto');
  const input = (v: number, label: string) => {
    const i = node('input', 'part');
    i.type = 'number';
    i.min = '1';
    i.value = String(v);
    i.setAttribute('aria-label', label);
    i.addEventListener('change', async () => {
      const b = normalizeBounds(minI.value, maxI.value);
      auto = await saveAutoOpen({ ...b, ...(auto?.on ? { nextAt: Date.now() + randomDelay(b.min, b.max) } : {}) });
      redrawTools();
    });
    return i;
  };
  const minI = input(a.min, 'Intervalle minimum (minutes)');
  const maxI = input(a.max, 'Intervalle maximum (minutes)');
  row.append(node('span', 'part', '', 'Toutes les'), minI, node('span', 'part', '', 'à'), maxI, node('span', 'part', '', 'min'));
  row.append(a.on ? button('Arrêter', () => void setAuto(false), 'ghost', true) : button('Démarrer', () => void setAuto(true), '', true));
  box.append(h, row);
  if (a.lastRun) {
    box.append(node('p', 'part', 'wiky-f-muted', `Dernier cycle ${new Date(a.lastRun.at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })} : ${a.lastRun.opened} paquet(s)${a.lastRun.error ? ` · ${a.lastRun.error}` : ''}`));
  }
  return box;
}

// ---------------------------------------------------------------- barre d'outils de la page des paquets

function redrawTools(): void {
  if (ctx) drawTools(ctx);
  drawAutoPill();
}

function drawTools(c: FeatureContext): void {
  const existing = document.querySelector<HTMLElement>('[data-wiky="pulls-tools"]');
  const onPage = c.path === '/pulls' || c.path.startsWith('/pulls/');
  const wantStats = c.flags.pullStats && !!stats;
  const wantOpen = c.flags.openAllPacks;
  const wantAuto = c.flags.autoOpenPacks && !!auto;
  if (!onPage || (!wantStats && !wantOpen && !wantAuto)) {
    existing?.remove();
    return;
  }
  const main = document.querySelector('main');
  const h1 = main?.querySelector('h1');
  if (!main || !h1) return;
  // Pendant l'ouverture des cartes (compteur « Carte X / N » du site), les statistiques sont masquées.
  const opening = !!pullCounter();
  if (existing && existing.hasAttribute('data-opening') !== opening) existing.toggleAttribute('data-opening', opening);
  const key = JSON.stringify([wantStats && stats, wantOpen, busy, wantAuto && auto, wantAuto && auto?.nextAt ? Math.floor((auto.nextAt - Date.now()) / 60_000) : 0, otherStatsAvailable()]);
  if (existing?.isConnected && existing.dataset.key === key) return;
  ensureFeatureStyle();
  ensureFeatureStyle(CSS, 'packs');
  const tools = existing ?? node('div', 'pulls-tools');
  tools.dataset.key = key;
  tools.toggleAttribute('data-opening', opening);
  const parts: HTMLElement[] = [];
  if (wantOpen) {
    const bar = node('div', 'part', 'wiky-pt-bar');
    const open = button(busy ? 'Ouverture…' : 'Ouvrir tous les paquets', async () => {
      const ok = await confirmDialog({
        title: 'Ouvrir tous les paquets ?',
        text: 'Tous les paquets disponibles vont être ouverts à la suite, sans animation (tu peux arrêter à tout moment).\n\nAutomatisation contraire aux règles du site : risque de bannissement.',
        confirm: 'Tout ouvrir',
      });
      if (ok) await openAllPacks();
    });
    open.disabled = busy;
    bar.append(open);
    if (busy && stopper) bar.append(button('Arrêter', () => stopper?.abort(), 'ghost'));
    parts.push(bar);
  }
  if (wantAuto) parts.push(autoBox(auto!));
  if (wantStats) parts.push(statsBox(stats!));
  tools.replaceChildren(...parts);
  if (!existing?.isConnected) {
    // Sous l'en-tête de la page (titre et sous-titre du site).
    const header = h1.parentElement && h1.parentElement !== main ? h1.parentElement : h1;
    header.after(tools);
  }
}

// ---------------------------------------------------------------- réponses du site

/** Paquet ouvert par le site : statistiques, récapitulatif (affiché à la dernière carte). */
export function handlePackResponse(body: unknown, c: FeatureContext | null = ctx): void {
  if (!c) return;
  const cards = mapPackCards(body);
  if (!cards.length) return;
  const pack: PackResult = { cards, packs: 1, at: Date.now(), title: `${cards.length} carte${cards.length > 1 ? 's' : ''} obtenue${cards.length > 1 ? 's' : ''}`, owned: ownedSnapshot(c) };
  last = pack;
  if (c.flags.pullStats) {
    void recordPulls(cards).then((s) => {
      stats = s;
      redrawTools();
    });
  }
  if (c.flags.packRecap) {
    hideRecap();
    pending = pack;
    maybeShowPending();
  }
}

onSiteResponse(/\/api\/packs\/open/, (r) => {
  if (r.method === 'POST' && r.status < 400) handlePackResponse(r.body);
});

let storageWatch = false;

registerFeature({
  keys: ['packRecap', 'pullStats', 'pullShare', 'openAllPacks', 'autoOpenPacks'],
  render(c) {
    const first = !ctx;
    ctx = c;
    if (first) {
      void Promise.all([refreshStats(), refreshAuto()]).then(() => {
        syncAutoTimer();
        redrawTools();
      });
    }
    if (!storageWatch) {
      storageWatch = true;
      // Autre onglet : statistiques et ouverture automatique suivent.
      try {
        ext.storage.onChanged.addListener((changes, area) => {
          if (area !== 'local') return;
          if (PULL_STATS_KEY in changes) void refreshStats().then(redrawTools);
          if (AUTO_OPEN_KEY in changes) void refreshAuto().then(() => {
            syncAutoTimer();
            redrawTools();
          });
        });
      } catch {
        // Hors extension (tests).
      }
    }
    if (!c.flags.packRecap) pending = null;
    else maybeShowPending();
    syncAutoTimer();
    drawTools(c);
    drawAutoPill();
  },
  cleanup() {
    ctx = null;
    pending = null;
    stopper?.abort();
    hideRecap();
    syncAutoTimer();
    document.querySelector('[data-wiky="pulls-tools"]')?.remove();
    document.querySelector('[data-wiky="auto-open-pill"]')?.remove();
  },
});
