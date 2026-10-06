/**
 * Marché (`/marketplace`, tous les onglets) : sur chaque enchère, sous son prix, le prix moyen de la carte (moyenne de
 * ses ventes dans sa rareté, comme le site) et l'écart du prix actuel à cette moyenne — vert sous la moyenne (bonne
 * affaire), rouge au-dessus. Rapide : une requête pour 150 enchères (quelle carte ?), puis les prix en lot (cache).
 */
import { cardPrices, cardsForAuctions, displayCount, displayPrice, knownAuctionCard, knownPrice } from '../catalog';
import { registerFeature, type FeatureContext } from './runtime';

const AUCTION_ID = /^marketplace-auction-([0-9a-f-]{36})$/i;
/** Écart sous lequel l'enchère est « au prix » (ni bonne ni mauvaise affaire), en %. */
const FAIR = 10;
const RETRY_MS = 60_000;

const CSS = `
[data-wiky="deal"] { display: flex; align-items: center; justify-content: space-between; gap: 6px; width: 100%; box-sizing: border-box; margin-top: 6px;
  padding: 4px 8px; border-radius: 8px; font-size: 11px; line-height: 1.3; font-variant-numeric: tabular-nums;
  background: color-mix(in srgb, var(--color-foreground) 6%, transparent); color: color-mix(in srgb, var(--color-foreground) 70%, transparent); }
[data-wiky="deal"] b { color: var(--color-foreground); font-weight: 700; }
[data-wiky="deal"] .gap { font-weight: 700; padding: 1px 6px; border-radius: 999px; }
[data-wiky="deal"].good .gap { color: #4ade80; background: rgba(34,197,94,.14); }
[data-wiky="deal"].bad .gap { color: #f87171; background: rgba(239,68,68,.14); }
[data-wiky="deal"].fair .gap { color: color-mix(in srgb, var(--color-foreground) 75%, transparent); background: color-mix(in srgb, var(--color-foreground) 10%, transparent); }
[data-wiky="deal"].none { justify-content: center; }
`;

let lastCtx: FeatureContext | null = null;
let loading = false;
let failedAt = 0;

function ensureStyle(): void {
  if (document.getElementById('wiky-deals-style')) return;
  const s = document.createElement('style');
  s.id = 'wiky-deals-style';
  s.setAttribute('data-wiky', 'style');
  s.textContent = CSS;
  (document.head ?? document.documentElement).append(s);
}

const w = (n: number) => `${Math.round(n).toLocaleString('fr-FR')} W`;

/** Prix affiché sur la carte d'enchère (« Mise de départ » ou « Mise actuelle »). */
export function auctionPrice(card: Element): number | null {
  for (const label of card.querySelectorAll('span, p, div')) {
    if (label.closest('[data-wiky]') || label.children.length) continue;
    if (!/^\s*mise\s+(de\s+d[ée]part|actuelle)\s*$/i.test(label.textContent ?? '')) continue;
    const value = label.nextElementSibling?.textContent?.replace(/[^\d]/g, '');
    if (value) return Number(value);
  }
  return null;
}

/** Écart du prix à la moyenne, en % (négatif : moins cher que la moyenne). */
export function dealGap(price: number, mean: number): number {
  return Math.round(((price - mean) / mean) * 100);
}

function badge(price: number | null, mean: number | null, count: number): { cls: string; html: string; title: string } {
  if (mean == null) return { cls: 'none', html: 'Jamais vendue', title: 'Aucune vente conclue pour cette carte' };
  const sales = `${count} vente${count > 1 ? 's' : ''}`;
  if (price == null) return { cls: 'fair', html: `Moy. <b>${w(mean)}</b>`, title: `Moyenne de ${sales}` };
  const gap = dealGap(price, mean);
  const cls = gap <= -FAIR ? 'good' : gap >= FAIR ? 'bad' : 'fair';
  const word = cls === 'good' ? 'sous la moyenne' : cls === 'bad' ? 'au-dessus de la moyenne' : 'proche de la moyenne';
  return {
    cls,
    html: `<span>Moy. <b>${w(mean)}</b></span><span class="gap">${gap > 0 ? '+' : gap < 0 ? '−' : ''}${Math.abs(gap)} %</span>`,
    title: `Prix actuel ${w(price)} : ${Math.abs(gap)} % ${word} (moyenne de ${sales} de la carte dans sa rareté)`,
  };
}

function paint(): void {
  const cards = [...document.querySelectorAll<HTMLElement>('main [id^="marketplace-auction-"]')];
  const missing: string[] = [];
  const cardIds = new Set<string>();
  for (const el of cards) {
    const id = AUCTION_ID.exec(el.id)?.[1];
    if (!id) continue;
    const ac = knownAuctionCard(id);
    if (ac === undefined) {
      missing.push(id);
      continue;
    }
    if (!ac) continue;
    const p = knownPrice(ac.cardId);
    if (!p) {
      cardIds.add(ac.cardId);
      continue;
    }
    const price = auctionPrice(el);
    const mean = displayPrice(p, ac.rarity);
    const b = badge(price, mean, displayCount(p, ac.rarity));
    const key = `${id}|${price}|${mean}|${b.cls}`;
    const host = el.querySelector('a.card-frame > div') ?? el.querySelector('a') ?? el;
    let tag = host.querySelector<HTMLElement>(':scope > [data-wiky="deal"]');
    if (tag?.dataset.key === key) continue;
    if (!tag) {
      tag = document.createElement('div');
      tag.setAttribute('data-wiky', 'deal');
      // Juste sous la ligne du prix (avant « Vendu par … »).
      const priceRow = [...host.children].find((c) => /mise/i.test(c.textContent ?? '') && /dur[ée]e/i.test(c.textContent ?? ''));
      if (priceRow) priceRow.after(tag);
      else host.append(tag);
    }
    tag.dataset.key = key;
    tag.className = b.cls;
    tag.title = b.title;
    tag.innerHTML = b.html;
  }
  if ((missing.length || cardIds.size) && !loading && Date.now() - failedAt > RETRY_MS) void load(missing, [...cardIds]);
}

async function load(auctionIds: string[], cardIds: string[]): Promise<void> {
  loading = true;
  try {
    const found = auctionIds.length ? await cardsForAuctions(auctionIds) : new Map();
    const ids = new Set(cardIds);
    for (const ac of found.values()) ids.add(ac.cardId);
    if (ids.size) await cardPrices([...ids]);
  } catch {
    failedAt = Date.now();
  } finally {
    loading = false;
  }
  if (lastCtx && lastCtx.path === '/marketplace') paint();
}

function cleanup(): void {
  for (const n of document.querySelectorAll('[data-wiky="deal"]')) n.remove();
}

registerFeature({
  keys: ['marketplacePrice'],
  needsApi: true,
  render(ctx) {
    lastCtx = ctx;
    if (ctx.path !== '/marketplace') return;
    ensureStyle();
    paint();
  },
  cleanup,
});
