/**
 * « Moy. 12 W · 85 % » sous le titre de chaque carte de la collection (et de la collection globale) : prix moyen et
 * taux de vente (rouge à 15 % ou moins, vert à 70 % ou plus), et en bas de la carte, à la place des étiquettes du site,
 * « 17 / 20 vendues » : le nombre d'enchères sur lequel porte ce taux (90 % sur 4 enchères ou sur 1 000, ce n'est pas pareil).
 * Contrairement à « Prix moyen collection » (une requête par carte), les prix de toutes les cartes affichées
 * sont demandés en une fois à `cardPrices` (lots de 150, cache 6 h) ; les prix déjà connus s'affichent
 * immédiatement à chaque nouveau rendu du site.
 */
import { cardIdsByTitles, cardPrices, displayCount, displayPrice, knownCardId, knownPrice, sellRateOf } from '../catalog';
import { cardRarity, cardTitle, ensureStyle, formatW, isCollection, isGlobalCollection, myCard, nativeCards } from './dom';
import { registerFeature, type FeatureContext } from './runtime';
import type { Rarity } from '../../lib/types';

const CSS = `
.wiky-avg { position: relative; z-index: 25; align-self: flex-start; display: inline-flex; align-items: center; gap: 3px; max-width: 100%; flex: 0 0 auto;
  pointer-events: none; margin-top: 2px; padding: 2px 5px; border-radius: 6px; background: rgba(12,10,9,.86); color: #fdba74;
  border: 1px solid rgba(249,115,22,.55); box-shadow: 0 1px 4px rgba(0,0,0,.22); font-size: 9px; line-height: 1.1; font-weight: 800; white-space: nowrap; }
.wiky-avg.is-empty { color: #d6d3d1; border-color: rgba(214,211,209,.35); }
.wiky-avg.is-error { color: #fca5a5; border-color: rgba(248,113,113,.45); }
.wiky-avg.is-loading { color: #e7e5e4; border-color: rgba(231,229,228,.35); }
.wiky-avg.is-loading::before { content: ''; width: 7px; height: 7px; border-radius: 50%; border: 1.5px solid currentColor; border-right-color: transparent; animation: wiky-avg-spin .8s linear infinite; }
@keyframes wiky-avg-spin { to { transform: rotate(360deg); } }
.wiky-avg-legend { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 12px; margin: 4px 0 0; font-size: 11px;
  color: color-mix(in srgb, var(--color-foreground) 55%, transparent); }
.wiky-avg-legend > span { display: inline-flex; align-items: center; gap: 5px; }
.wiky-avg-refresh { margin-left: auto; padding: 3px 10px; border-radius: 8px; cursor: pointer; font: inherit; font-size: 11px; font-weight: 600;
  border: 1px solid var(--color-border); background: var(--color-surface-light, var(--color-surface)); color: color-mix(in srgb, var(--color-foreground) 75%, transparent); }
.wiky-avg-refresh:hover { color: var(--color-foreground); border-color: rgba(249,115,22,.4); }
.wiky-avg-refresh:disabled { opacity: .6; cursor: default; }
.wiky-avg-legend .wiky-avg { position: static; margin: 0; }
.wiky-avg .wiky-rate { color: #e7e5e4; font-weight: 800; }
.wiky-avg .wiky-rate::before { content: '·'; margin-right: 3px; color: #a8a29e; }
.wiky-avg .wiky-rate.is-low { color: #f87171; }
.wiky-avg .wiky-rate.is-high { color: #4ade80; }
.wiky-avg-count { position: relative; z-index: 25; align-self: flex-start; display: inline-flex; gap: 2px; padding: 1px 5px; border-radius: 999px; pointer-events: none;
  background: rgba(12,10,9,.78); border: 1px solid rgba(214,211,209,.3); color: #a8a29e; font-size: 8px; line-height: 1.2; font-weight: 600; white-space: nowrap; }
.wiky-avg-count b { color: #e7e5e4; font-weight: 800; }
.wiky-avg-legend .wiky-avg-count { position: static; }
`;

/** Taux de vente « difficile à vendre » / « part toute seule ». */
export const RATE_LOW = 15;
export const RATE_HIGH = 70;

type State = 'loading' | 'value' | 'empty' | 'error';

/** Échecs récents : pas de nouvel essai avant une minute (sinon chaque relecture relancerait la requête). */
const failedAt = new Map<string, number>();
const RETRY_MS = 60_000;
let titlesFailedAt = 0;
let lastCtx: FeatureContext | null = null;
let pending = false;

function eligible(ctx: FeatureContext): boolean {
  return isCollection(ctx) || isGlobalCollection(ctx);
}

/** Identifiant du site d'une carte affichée (ma collection, sinon le catalogue déjà interrogé). */
function siteIdOf(ctx: FeatureContext, title: string): string | null | undefined {
  return myCard(ctx, title)?.siteId ?? knownCardId(title);
}

/** 950 → « 950 », 1 234 → « 1,2k », 12 000 → « 12k » (le badge est étroit). */
export function shortCount(n: number): string {
  if (n < 1000) return String(n);
  const k = n / 1000;
  return `${k < 10 ? k.toFixed(1).replace(/\.0$/, '').replace('.', ',') : Math.round(k)}k`;
}

interface BadgeState {
  state: State;
  text: string;
  title: string;
  /** Taux de vente en %, ventes conclues et enchères terminées, s'il est connu. */
  rate?: { pct: number; sold: number; total: number };
}

function stateOf(siteId: string, rarity: Rarity | null, now: number): BadgeState {
  const p = knownPrice(siteId);
  if (p) {
    const r = sellRateOf(p);
    const rateTitle = r ? `\nTaux de vente ${r.pct} % : ${r.sold} vendue${r.sold > 1 ? 's' : ''} sur ${r.total} enchère${r.total > 1 ? 's' : ''} terminée${r.total > 1 ? 's' : ''}` : '';
    // Même calcul que le « Prix moyen » du site : moyenne des ventes de la carte dans sa rareté.
    const v = displayPrice(p, rarity);
    if (v == null) return { state: 'empty', text: 'Moy. —', title: `Aucune vente conclue pour cette carte${rateTitle}`, rate: r ?? undefined };
    const n = displayCount(p, rarity);
    const sameRarity = !!rarity && !!p.byRarity?.[rarity];
    const median = p.median != null ? ` · médiane ${formatW(p.median)} W` : '';
    return {
      state: 'value',
      text: `Moy. ${formatW(v)} W`,
      title: `Moyenne de ${n} vente${n > 1 ? 's' : ''} conclue${n > 1 ? 's' : ''}${sameRarity ? ` en ${rarity}` : ''}${median} (Wiki-Traders)${rateTitle}`,
      rate: r ?? undefined,
    };
  }
  if (now - (failedAt.get(siteId) ?? 0) < RETRY_MS) return { state: 'error', text: 'Prix indispo.', title: 'Erreur temporaire, nouvel essai dans une minute' };
  return { state: 'loading', text: 'Prix…', title: 'Chargement du prix moyen…' };
}

/** Pose ou met à jour le badge d'une carte ; ne touche au DOM que si quelque chose a changé. */
function paintBadge(card: HTMLElement, siteId: string, now: number): State {
  const h3 = card.querySelector('h3');
  if (!h3) return 'loading';
  const s = stateOf(siteId, cardRarity(card), now);
  const key = `${siteId}|${s.text}|${s.rate?.pct ?? ''}`;
  let badge = card.querySelector<HTMLElement>('[data-wiky="avg"]');
  if (badge?.dataset.key !== key || badge.previousElementSibling !== h3) {
    if (!badge) {
      badge = document.createElement('span');
      badge.setAttribute('data-wiky', 'avg');
    }
    badge.dataset.key = key;
    badge.className = `wiky-avg${s.state === 'value' ? '' : ` is-${s.state}`}`;
    badge.textContent = s.text;
    if (s.rate != null) {
      const rate = document.createElement('i');
      rate.className = `wiky-rate${s.rate.pct <= RATE_LOW ? ' is-low' : s.rate.pct >= RATE_HIGH ? ' is-high' : ''}`;
      rate.textContent = `${s.rate.pct} %`;
      badge.append(rate);
    }
    badge.title = s.title;
    if (badge.previousElementSibling !== h3) h3.after(badge);
  }
  paintCount(card, badge, s);
  return s.state;
}

/**
 * « 324 / 625 vendues » en bas de la carte, à la place des étiquettes du site (au-dessus si elles sont affichées) ;
 * sous le badge si la carte n'a pas cette zone.
 */
function paintCount(card: HTMLElement, badge: HTMLElement, s: BadgeState): void {
  let el = card.querySelector<HTMLElement>('[data-wiky="avg-count"]');
  if (!s.rate) {
    el?.remove();
    return;
  }
  const key = `${s.rate.sold}/${s.rate.total}`;
  if (!el) {
    el = document.createElement('span');
    el.setAttribute('data-wiky', 'avg-count');
    el.className = 'wiky-avg-count';
  }
  if (el.dataset.key !== key) {
    el.dataset.key = key;
    const sold = document.createElement('b');
    sold.textContent = shortCount(s.rate.sold);
    el.replaceChildren(sold, ` / ${shortCount(s.rate.total)} vendue${s.rate.sold > 1 ? 's' : ''}`);
    el.title = `${s.rate.sold} enchère${s.rate.sold > 1 ? 's' : ''} conclue${s.rate.sold > 1 ? 's' : ''} sur ${s.rate.total} terminée${s.rate.total > 1 ? 's' : ''} (Wiki-Traders)`;
  }
  const bottom = card.querySelector<HTMLElement>('div[class*="top-[45%]"] > div.mt-auto');
  if (bottom) {
    if (bottom.firstElementChild !== el) bottom.prepend(el);
  } else if (badge.nextElementSibling !== el) badge.after(el);
}

function renderLegend(ctx: FeatureContext): void {
  const existing = document.querySelector('[data-wiky="avg-legend"]');
  if (!isCollection(ctx)) {
    existing?.remove();
    return;
  }
  if (existing?.isConnected) return;
  const row = document.querySelector('main h1')?.parentElement;
  if (!row || row.closest('[data-wiky]')) return;
  const legend = document.createElement('div');
  legend.setAttribute('data-wiky', 'avg-legend');
  legend.className = 'wiky-avg-legend';
  legend.innerHTML =
    '<span><b class="wiky-avg">Moy. 12 W</b>moyenne des ventes (rareté de la carte)</span>' +
    `<span><b class="wiky-avg">Moy. 12 W<i class="wiky-rate is-high">85 %</i></b>taux de vente (rouge ≤ ${RATE_LOW} %, vert ≥ ${RATE_HIGH} %)</span>` +
    '<span><b class="wiky-avg-count"><b>17</b> / 20 vendues</b>en bas de la carte : ventes conclues sur enchères terminées</span>' +
    '<span><b class="wiky-avg is-empty">Moy. —</b>jamais vendue</span>' +
    '<span><b class="wiky-avg is-loading">Prix…</b>chargement</span>';
  const refresh = document.createElement('button');
  refresh.type = 'button';
  refresh.className = 'wiky-avg-refresh';
  refresh.textContent = '↻ Rafraîchir les prix';
  refresh.title = 'Relit les ventes de toutes tes cartes (sinon les prix sont gardés 6 h)';
  refresh.addEventListener('click', async () => {
    refresh.disabled = true;
    refresh.textContent = 'Rafraîchissement…';
    await refreshAllPrices();
    refresh.disabled = false;
    refresh.textContent = '↻ Rafraîchir les prix';
  });
  legend.append(refresh);
  row.after(legend);
}

function paint(ctx: FeatureContext): void {
  const now = Date.now();
  const toLoad = new Set<string>();
  const unknownTitles: string[] = [];
  for (const card of nativeCards()) {
    const title = cardTitle(card);
    if (!title) continue;
    const siteId = siteIdOf(ctx, title);
    if (siteId === undefined) {
      unknownTitles.push(title);
      continue;
    }
    if (siteId === null) continue;
    if (paintBadge(card, siteId, now) === 'loading') toLoad.add(siteId);
  }
  // Collection globale : titres hors de ma collection → identifiants, en une requête par lot.
  if (unknownTitles.length && now - titlesFailedAt > RETRY_MS) load(() => cardIdsByTitles(unknownTitles).then(() => undefined), () => (titlesFailedAt = Date.now()));
  if (toLoad.size) {
    const ids = [...toLoad];
    load(
      () =>
        cardPrices(ids).then((got) => {
          const t = Date.now();
          for (const id of ids) if (!got.has(id)) failedAt.set(id, t);
        }),
      () => ids.forEach((id) => failedAt.set(id, Date.now())),
    );
  }
}

/** Une seule série de requêtes à la fois ; à la fin, les badges sont repeints avec les données reçues. */
function load(job: () => Promise<void>, onError: () => void): void {
  if (pending) return;
  pending = true;
  void job()
    .catch(onError)
    .finally(() => {
      pending = false;
      if (lastCtx && eligible(lastCtx)) paint(lastCtx);
    });
}

function cleanup(): void {
  lastCtx = null;
  document.querySelectorAll('[data-wiky="avg"], [data-wiky="avg-count"], [data-wiky="avg-legend"]').forEach((n) => n.remove());
}

/** Relit les prix de toute ma collection (et des cartes affichées), sans cache, puis redessine les badges. */
export async function refreshAllPrices(): Promise<void> {
  const ctx = lastCtx;
  if (!ctx) return;
  const ids = new Set(Object.values(ctx.cards).flatMap((c) => (c.siteId ? [c.siteId] : [])));
  for (const card of nativeCards()) {
    const id = siteIdOf(ctx, cardTitle(card));
    if (id) ids.add(id);
  }
  try {
    await cardPrices([...ids], true);
  } catch {
    // Les badges indiquent « Prix indispo. » ; nouvel essai plus tard.
  }
  if (lastCtx) paint(lastCtx);
}

registerFeature({
  keys: ['priceBadges'],
  needsApi: true,
  render(ctx) {
    if (!eligible(ctx)) {
      if (lastCtx) cleanup();
      return;
    }
    lastCtx = ctx;
    ensureStyle('wiky-avg-style', CSS);
    renderLegend(ctx);
    paint(ctx);
  },
  cleanup,
});

/** Pour les tests. */
export function resetPriceBadges(): void {
  failedAt.clear();
  titlesFailedAt = 0;
  pending = false;
  lastCtx = null;
}
