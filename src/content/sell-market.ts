/**
 * Fenêtre « Mettre aux enchères » du site : on y ajoute, comme si c'était le site,
 *  - sous « Marché · <rareté> » : un résumé compact des offres en cours de cette carte (nombre, min, médiane, max) ;
 *  - sous la fenêtre : la liste des enchères en cours de cette carte (prix, durée restante) ;
 *  - à droite (dessous sur un écran étroit) : l'« Historique des prix » de la carte, comme sur la page d'une enchère,
 *    en version compacte.
 * Données lues via l'API (option « apiRead »), mises en cache une minute. Chaque partie est désactivable.
 */
import { formatDuration, formatPrice, normalize, RARITIES } from '../lib/text';
import type { Card, CardAuction, Rarity, Settings } from '../lib/types';
import { fetchCardAuctions, fetchCardIdByTitle, fetchMyUnsoldAttempts, offerStats, type OfferStats } from './api';
import { openSellDialog } from './automation';
import { cardSalesHistory } from './catalog';
import { PriceHistoryPanel } from './features/price-history';
import { qsa, type SelectorConfig } from './parsers/selectors';

const TTL = 60_000;
const cache = new Map<string, { at: number; value: Promise<unknown> }>();

function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.value as Promise<T>;
  const value = load();
  cache.set(key, { at: Date.now(), value });
  value.catch(() => cache.delete(key));
  return value;
}

export interface SellMarketState {
  settings: Settings;
  cards: Record<string, Card>;
  cfg: SelectorConfig;
}

const LABEL_CLASS = 'text-[10px] font-semibold uppercase tracking-wide text-[var(--color-foreground)]/45 pb-0.5';

/** Zone « Marché · Rare » du site (ou « Aucune vente enregistrée ») et rareté affichée. */
function marketZone(frame: Element): { anchor: Element; rarity: Rarity | null } | null {
  const label = qsa(frame, 'p').find((p) => /^\s*march[ée]\s*·/i.test(p.textContent ?? ''));
  const empty = qsa(frame, 'p').find((p) => /aucune vente enregistr/i.test(p.textContent ?? ''));
  const text = (label ?? empty)?.textContent ?? '';
  const rarity = (Object.keys(RARITIES) as Rarity[]).find((r) => new RegExp(`(·|\\()\\s*${RARITIES[r].label}\\s*(\\)|$)`, 'i').test(text.trim())) ?? null;
  if (label?.parentElement) return { anchor: label.parentElement, rarity };
  if (empty) return { anchor: empty, rarity };
  return null;
}

/** Carte de la fenêtre : la plus longue carte connue dont le nom apparaît dans la fenêtre. */
function cardIn(frame: Element, cards: Record<string, Card>): Card | null {
  const text = normalize(frame.textContent ?? '');
  return (
    Object.values(cards)
      .filter((c) => c.name.length > 1 && text.includes(normalize(c.name)))
      .sort((a, b) => b.name.length - a.name.length)[0] ?? null
  );
}

function statsLine(s: OfferStats): string {
  if (!s.count) return 'aucune offre';
  return `${s.count} offre${s.count > 1 ? 's' : ''} · min ${formatPrice(s.min)} · méd. ${formatPrice(s.median)} · max ${formatPrice(s.max)}`;
}

/** `attempts` : mes mises en vente de la carte restées sans acheteur (undefined : en cours de lecture ou illisible). */
function summaryNode(own: OfferStats | null, error?: string, attempts?: number | null): HTMLElement {
  const box = document.createElement('div');
  box.setAttribute('data-wiky', 'market-summary');
  box.className = 'mt-2 space-y-0.5';
  Object.assign(box.style, { marginTop: '8px' });
  const label = document.createElement('p');
  label.className = LABEL_CLASS;
  label.textContent = 'En vente maintenant';
  const line = (title: string, value: string) => {
    const row = document.createElement('div');
    row.className = 'flex items-center justify-between gap-3 min-w-0';
    Object.assign(row.style, { display: 'flex', justifyContent: 'space-between', gap: '12px', fontSize: '12px' });
    const t = document.createElement('span');
    t.className = 'text-[10px] uppercase tracking-wide text-[var(--color-foreground)]/40 shrink-0';
    t.textContent = title;
    const v = document.createElement('span');
    v.className = 'min-w-0 truncate text-right text-xs font-semibold tabular-nums text-[var(--color-foreground)]/85';
    v.textContent = value;
    row.append(t, v);
    return row;
  };
  box.append(label);
  if (error) box.append(line('Erreur', error));
  else if (!own) box.append(line('Cette carte', 'chargement…'));
  else box.append(line('Cette carte', statsLine(own)));
  if (attempts != null) box.append(line('Tentatives', attempts ? `${attempts} sans acheteur` : 'aucune sans acheteur'));
  return box;
}

function listNode(card: Card, auctions: CardAuction[] | null, error?: string): HTMLElement {
  const box = document.createElement('div');
  box.setAttribute('data-wiky', 'market-list');
  box.className = 'card-frame max-w-lg w-full p-4 animate-fade-in-up';
  // Position forcée : notre bloc reprend la classe « card-frame » du site pour le style, pas pour la mise en page.
  Object.assign(box.style, { position: 'relative', inset: 'auto', maxHeight: '32vh', overflowY: 'auto', width: '100%', maxWidth: '32rem', boxSizing: 'border-box' });
  // La fenêtre du site se ferme au clic à l'extérieur : notre bloc ne doit pas déclencher cette fermeture.
  for (const type of ['click', 'mousedown', 'pointerdown']) box.addEventListener(type, (e) => e.stopPropagation());
  const head = document.createElement('p');
  head.className = LABEL_CLASS;
  head.textContent = `Enchères en cours · ${card.name}`;
  box.append(head);
  const note = (text: string) => {
    const p = document.createElement('p');
    p.className = 'text-[11px] text-[var(--color-foreground)]/40 mt-1.5';
    p.textContent = text;
    box.append(p);
  };
  if (error) note(`Impossible de charger les enchères (${error}).`);
  else if (!auctions) note('Chargement du marché…');
  else if (!auctions.length) note('Aucune autre enchère en cours pour cette carte.');
  else {
    const now = Date.now();
    for (const a of auctions) {
      const row = document.createElement('a');
      row.href = `/marketplace/${a.id}`;
      row.target = '_blank';
      row.rel = 'noopener';
      row.className = 'flex items-center justify-between gap-3 py-1.5 border-b border-[var(--color-border)] text-xs';
      Object.assign(row.style, { display: 'flex', justifyContent: 'space-between', gap: '12px', padding: '6px 0', textDecoration: 'none', color: 'inherit' });
      const price = document.createElement('span');
      price.className = 'font-semibold text-[var(--color-accent)] tabular-nums';
      price.textContent = formatPrice(a.price);
      const kind = document.createElement('span');
      kind.className = 'flex-1 min-w-0 truncate text-[var(--color-foreground)]/50';
      kind.textContent = `${a.hasBid ? 'mise en cours' : 'mise de départ'}${a.shiny ? ' · ✨' : ''}${a.mine ? ' · à toi' : ''}`;
      const left = document.createElement('span');
      left.className = 'tabular-nums text-[var(--color-foreground)]/60';
      left.textContent = a.endsAt ? formatDuration(a.endsAt - now) : '';
      row.append(price, kind, left);
      box.append(row);
    }
  }
  return box;
}

let current = '';
let history: PriceHistoryPanel | null = null;

/** Attribut posé sur la fenêtre du site : historique des prix à droite (en dessous sur un écran étroit). */
const LAYOUT_ATTR = 'data-wiky-sell-layout';
const LAYOUT_CSS = `
[${LAYOUT_ATTR}] { display: grid !important; grid-template-columns: minmax(0, 32rem) minmax(0, 38rem); justify-content: center; align-content: safe center;
  align-items: start; gap: 12px; overflow-y: auto; }
[${LAYOUT_ATTR}] > [data-wiky="market-list"] { grid-column: 1; grid-row: 2; }
[${LAYOUT_ATTR}] > [data-wiky="sell-history"] { grid-column: 2; grid-row: 1 / span 2; max-height: calc(100dvh - 2rem); overflow-y: auto; }
@media (max-width: 1100px) {
  [${LAYOUT_ATTR}] { grid-template-columns: minmax(0, 32rem); }
  [${LAYOUT_ATTR}] > [data-wiky="sell-history"] { grid-column: 1; grid-row: 3; max-height: none; overflow: visible; }
}`;

function ensureLayoutStyle(): void {
  if (document.getElementById('wiky-sell-layout-style')) return;
  const s = document.createElement('style');
  s.id = 'wiky-sell-layout-style';
  s.setAttribute('data-wiky', 'style');
  s.textContent = LAYOUT_CSS;
  (document.head ?? document.documentElement).append(s);
}

const WIKY_NODES = '[data-wiky="market-summary"], [data-wiky="market-list"], [data-wiky="sell-history"]';

function clearNodes(): void {
  history?.destroy();
  history = null;
  for (const n of qsa(document, WIKY_NODES)) n.remove();
  for (const n of qsa(document, `[${LAYOUT_ATTR}]`)) n.removeAttribute(LAYOUT_ATTR);
}

/** À appeler à chaque relecture de la page : ajoute / met à jour / retire les compléments de la fenêtre de vente. */
export function enhanceSellDialog(state: SellMarketState): void {
  const { settings } = state;
  const wantSummary = settings.apiRead && settings.sellMarketSummary;
  const wantList = settings.apiRead && settings.sellMarketList;
  const wantHistory = settings.apiRead && settings.sellMarketHistory;
  const open = openSellDialog(state.cfg);
  if (!open || (!wantSummary && !wantList && !wantHistory)) {
    clearNodes();
    current = '';
    return;
  }
  const overlay = open.dialog;
  const frame = qsa(overlay, '.card-frame').find((f) => !f.closest('[data-wiky]') && f.contains(open.input)) ?? open.input.closest('div') ?? overlay;
  const zone = marketZone(frame);
  const card = cardIn(frame, state.cards);
  if (!card) return;
  const rarity = zone?.rarity ?? card.rarity;
  // La zone « Marché » du site se charge après la fenêtre : la clé change quand elle apparaît.
  const key = `${card.id}|${rarity}|${wantSummary}|${wantList}|${wantHistory}|${!!zone}`;
  const hasSummary = !wantSummary || !zone || !!frame.querySelector('[data-wiky="market-summary"]');
  const hasList = !wantList || !!overlay.querySelector(':scope > [data-wiky="market-list"]');
  const hasHistory = !wantHistory || !!history?.el.isConnected;
  // Déjà en place pour cette carte : on ne touche plus au DOM du site.
  if (key === current && hasSummary && hasList && hasHistory) return;
  current = key;
  clearNodes();
  const ov = overlay as HTMLElement;
  // La fenêtre du site est centrée en ligne : on empile la liste dessous.
  const stack = () => {
    if (getComputedStyle(ov).flexDirection !== 'column') Object.assign(ov.style, { flexDirection: 'column', gap: '12px' });
  };
  if (wantHistory) {
    const panel = (history = new PriceHistoryPanel('sell-history', 'wiky-sell-price-history-open', 'ph-sell', true));
    // La fenêtre du site se ferme au clic à l'extérieur : notre section ne doit pas déclencher cette fermeture.
    for (const type of ['click', 'mousedown', 'pointerdown']) panel.el.addEventListener(type, (e) => e.stopPropagation());
    ensureLayoutStyle();
    ov.setAttribute(LAYOUT_ATTR, '');
    (overlay.querySelector(':scope > [data-wiky="market-list"]') ?? frame).after(panel.el);
    panel.update();
  }

  const place = (summary: HTMLElement | null, list: HTMLElement | null) => {
    if (summary && zone?.anchor.isConnected) {
      frame.querySelector('[data-wiky="market-summary"]')?.remove();
      zone.anchor.after(summary);
    }
    if (list && overlay.isConnected) {
      overlay.querySelector(':scope > [data-wiky="market-list"]')?.remove();
      stack();
      frame.after(list);
    }
  };
  place(wantSummary && zone ? summaryNode(null) : null, wantList ? listNode(card, null) : null);

  void (async () => {
    try {
      const siteId = card.siteId ?? (await cached(`id:${card.name}`, () => fetchCardIdByTitle(card.name)));
      if (!siteId) throw new Error('carte introuvable');
      const panel = history;
      if (panel) cardSalesHistory(siteId).then((list) => panel.setSales(list), (e: Error) => panel.setError(e.message));
      // Mes tentatives sans acheteur : facultatif, une erreur ne bloque pas le reste.
      const attemptsJob = wantSummary ? cached(`attempts:${siteId}`, () => fetchMyUnsoldAttempts(siteId)).catch(() => null) : Promise.resolve(null);
      const result = await cached(`card:${siteId}`, () => fetchCardAuctions(siteId));
      const attempts = await attemptsJob;
      // Les enchères « à moi » ne sont pas de la concurrence : exclues des statistiques.
      const own = offerStats(result.auctions.filter((a) => !a.mine).map((a) => a.price));
      if (current !== key) return;
      place(wantSummary && zone ? summaryNode(own, undefined, attempts) : null, wantList ? listNode(card, result.auctions) : null);
    } catch (e) {
      if (current !== key) return;
      const msg = (e as Error).message;
      if (history && !history.sales) history.setError(msg);
      place(wantSummary && zone ? summaryNode(null, msg) : null, wantList ? listNode(card, null, msg) : null);
    }
  })();
}

/** Pour les tests : oublie le cache et l'état. */
export function resetSellMarket(): void {
  cache.clear();
  current = '';
  history?.destroy();
  history = null;
}

