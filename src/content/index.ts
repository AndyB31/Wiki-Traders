import { ext } from '../lib/browser';
import { planAutoTags, type TagChange } from '../lib/autotag';
import type { DiagnosticResult, ScanMessage, ScannedCard, ToContent } from '../lib/messages';
// Seules les cartes de la collection sont envoyées comme « possédées » : jamais celles du marché.
import { load, onStoreChange, save } from '../lib/storage';
import type { MyAuction, PageKind, PageStatus, PriceObs, StoreShape } from '../lib/types';
import type { BridgeItem } from './bridge';
import { ActionError, findByText, pause, realClick, waitFor } from './actions';
import { fetchCardAuctions, fetchMarketSales, fetchMyBids, fetchMyCollection, fetchMySales } from './api';
import { applyTagsViaApi } from './api-tags';
import { readFamilies } from './families';
import { applyTags, prefillSale, searchCollection } from './automation';
import { domOutline } from './diagnostic';
import { endProgress, lastChipCount, showProgress, updateOverlay } from './overlay';
import { initWindow, toggleWindow } from './window';
import { auctionIdFromHref, hasEmptyState, parseAuctionDetail, parseAuctionList, type ParsedAuction } from './parsers/auctions';
import { collectionTiles, parseCollection } from './parsers/collection';
import { isFavorite } from './parsers/dom';
import { activeTabLabel, detectPage, rootOf, slotsFromTabs } from './parsers/page';
import { auctionFromItem, cardFromItem, refElement, requestBridge, tagColors, tagDictionary } from './parsers/react';
import { re, resolveSelectors, type SelectorConfig } from './parsers/selectors';

type Store = Pick<StoreShape, 'settings' | 'rules' | 'cards' | 'priceObs' | 'myAuctions' | 'manualPrices' | 'slotOverrides' | 'ignoredSlots' | 'pendingFocus' | 'intent' | 'families' | 'meta'>;

let store: Store | null = null;
let lastPayload = '';
let lastSentAt = 0;
let lastParsed: unknown = null;
let lastBridge: BridgeItem[] | null = null;
let lastKind: PageKind = 'other';
let lastTiles: Map<string, Element> | null = null;
let lastUrl = location.href;
let timer: number | undefined;
let scanning = false;
let automating = false;
let stopRequested = false;
const actionLog: string[] = [];
let myTabId: number | null = null;

function log(step: string): void {
  actionLog.push(`${new Date().toLocaleTimeString('fr-FR')} ${step}`);
  if (actionLog.length > 200) actionLog.shift();
}

async function refreshStore(): Promise<void> {
  store = await load('settings', 'rules', 'cards', 'priceObs', 'myAuctions', 'manualPrices', 'slotOverrides', 'ignoredSlots', 'pendingFocus', 'intent', 'families', 'meta');
}

function toObs(a: ParsedAuction, now: number): PriceObs | null {
  if (a.currentPrice == null) return null;
  return { cardId: a.cardId, price: a.currentPrice, type: a.sold ? 'sold' : 'listing', at: now, auctionId: a.id, rarity: a.rarity, shiny: !!a.shiny };
}

function toMyAuction(a: ParsedAuction, now: number): MyAuction {
  return { id: a.id, cardId: a.cardId, cardName: a.cardName, tag: a.tag, startPrice: a.startPrice, currentPrice: a.currentPrice, endsAt: a.endsAt, seenAt: now };
}

interface Extracted {
  auctions: ParsedAuction[];
  cards: ScannedCard[];
  tiles: Map<string, Element>;
  source: 'react' | 'dom';
  filterTag?: string | null;
}

/** Données React de la page (prioritaires), avec leurs éléments. */
function fromBridge(items: BridgeItem[], knownTags: string[], now: number, cfg: SelectorConfig): Extracted {
  const tagNames = tagDictionary(items);
  const auctions: ParsedAuction[] = [];
  const cards: ScannedCard[] = [];
  const tiles = new Map<string, Element>();
  for (const item of items) {
    const el = refElement(item.ref);
    if (item.kind === 'auction') {
      const a = auctionFromItem(item, knownTags, now, tagNames);
      if (!a || auctions.some((x) => x.id === a.id)) continue;
      auctions.push(a);
      if (el) tiles.set(a.id, el);
    } else if (item.kind === 'card') {
      const c = cardFromItem(item, now, tagNames);
      if (!c?.id || cards.some((x) => x.id === c.id)) continue;
      // Le favori n'est pas dans les données de la carte : on lit l'étoile affichée sur sa tuile.
      if (c.favorite == null && el) c.favorite = isFavorite(el, cfg);
      cards.push({ ...c, tagsExact: c.tags != null });
      if (el && !tiles.has(c.id)) tiles.set(c.id, el);
    }
  }
  return { auctions, cards, tiles, source: 'react' };
}

function fromDom(kind: PageKind, root: Element, cfg: SelectorConfig, knownTags: string[], now: number): Extracted {
  if (kind === 'collection') {
    const parsed = parseCollection(root, cfg, knownTags, now);
    return { auctions: [], cards: parsed.cards, tiles: parsed.tiles, source: 'dom', filterTag: parsed.filterTag };
  }
  if (kind === 'auctionDetail') {
    const id = auctionIdFromHref(location.pathname, cfg);
    const a = id ? parseAuctionDetail(root, id, cfg, knownTags, now) : null;
    return { auctions: a ? [a] : [], cards: [], tiles: new Map(), source: 'dom' };
  }
  return { auctions: parseAuctionList(root, cfg, knownTags, now), cards: [], tiles: new Map(), source: 'dom' };
}

/** Lit la page affichée et envoie le relevé au service worker. */
async function scan(force = false): Promise<void> {
  if (!store || scanning) return;
  scanning = true;
  try {
    const now = Date.now();
    const cfg = resolveSelectors(store.settings.selectorOverrides);
    const kind = detectPage(document, location, cfg, store.settings);
    const root = rootOf(document, cfg);
    const knownTags = store.rules.map((r) => r.tag);
    const status: PageStatus = { kind, url: location.pathname + location.search, recognized: true, message: '', at: now };
    const msg: ScanMessage = { type: 'scan', status };

    let data: Extracted | null = null;
    if (kind !== 'other') {
      lastBridge = await requestBridge();
      if (lastBridge) for (const [name, color] of tagColors(lastBridge)) colors.set(name, color);
      const react = lastBridge ? fromBridge(lastBridge, knownTags, now, cfg) : null;
      const wanted = kind === 'collection' ? react?.cards.length : react?.auctions.length;
      data = react && wanted ? react : fromDom(kind, root, cfg, knownTags, now);
      // Sur la collection, ce que les données React ne donnent pas est complété par la lecture du texte.
      if (kind === 'collection' && data.source === 'react') {
        const dom = parseCollection(root, cfg, knownTags, now);
        const byId = new Map(dom.cards.map((c) => [c.id, c]));
        for (const c of data.cards) {
          const d = byId.get(c.id!);
          if (!d) continue;
          c.quantity ??= d.quantity;
          c.sitePrice ??= d.sitePrice;
          c.sitePriceAt ??= d.sitePriceAt;
          c.favorite ??= d.favorite;
          if (!c.tags) c.tags = d.tags;
        }
        for (const [id, el] of dom.tiles) if (!data.tiles.has(id)) data.tiles.set(id, el);
      }
      status.source = data.source;
    }

    if (kind === 'myAuctions' && data) {
      const live = data.auctions.filter((a) => !a.ended);
      const siteSlots = slotsFromTabs(root, cfg);
      if (siteSlots) msg.siteSlots = siteSlots;
      if (siteSlots && siteSlots.active !== live.length) {
        status.recognized = false;
        status.message = `Le site indique ${siteSlots.active} vente(s) en cours, ${live.length} relevée(s) : exporte un diagnostic.`;
      } else if (data.auctions.length || hasEmptyState(root, cfg) || siteSlots?.active === 0) {
        msg.myAuctions = live.map((a) => toMyAuction(a, now));
        msg.prices = data.auctions.filter((a) => a.sold).map((a) => toObs(a, now)).filter((o): o is PriceObs => !!o);
        status.message = `${live.length} enchère(s) en cours relevée(s)`;
      } else {
        status.recognized = false;
        status.message = 'Page non reconnue : aucune enchère trouvée. Exporte un diagnostic depuis la popup.';
      }
      lastParsed = data.auctions;
    } else if ((kind === 'market' || kind === 'auctionDetail') && data) {
      msg.prices = data.auctions.map((a) => toObs(a, now)).filter((o): o is PriceObs => !!o);
      status.recognized = data.auctions.length > 0;
      status.message = data.auctions.length ? `${data.auctions.length} enchère(s) observée(s)` : 'Aucune enchère reconnue sur cette page.';
      lastParsed = data.auctions;
    } else if (kind === 'collection' && data) {
      dropStaleTags(data.cards);
      msg.cards = data.cards;
      status.recognized = data.cards.length > 0;
      status.message = data.cards.length
        ? `${data.cards.length} carte(s) relevée(s)${data.filterTag ? ` · filtre « ${data.filterTag} »` : ''}`
        : 'Page non reconnue : aucune carte trouvée. Exporte un diagnostic depuis la popup.';
      lastParsed = data.cards;
    }
    if (data) status.message += data.source === 'react' ? ' (données de la page)' : ' (lecture du texte)';
    lastKind = kind;
    lastTiles = kind === 'collection' && data ? data.tiles : null;

    if (kind !== 'other') {
      const strip = (k: string, v: unknown) => (['at', 'seenAt', 'updatedAt', 'sitePriceAt', 'endsAt'].includes(k) ? undefined : v);
      const payload = JSON.stringify(msg, strip);
      if (force || payload !== lastPayload || now - lastSentAt > 60_000) {
        lastPayload = payload;
        lastSentAt = now;
        ext.runtime.sendMessage(msg).catch(() => {});
      }
    }

    lastStatus = status;
    syncFamilies();
    maybeReloadCollection(kind);
    updateOverlay({ store, cfg, kind, root, tiles: lastTiles, tagColors: colors });
    void maybePrefill(cfg);
    maybeRefreshSales(cfg);
  } finally {
    scanning = false;
  }
}

/** V4 : à l'arrivée depuis « Ouvrir », ouvre la vente de la carte et remplit le prix. */
/**
 * Va sur une page du site : clic sur le lien du menu (navigation Next.js, sans recharger),
 * sinon navigation classique. Une seule tentative par clé toutes les 4 s pour éviter les boucles.
 */
const navTried = new Map<string, number>();
function navigateTo(path: string, key: string): void {
  if (Date.now() - (navTried.get(key) ?? 0) < 4000) return;
  navTried.set(key, Date.now());
  const link = [...document.querySelectorAll<HTMLAnchorElement>('a[href]')].find((a) => {
    try {
      const u = new URL(a.href, location.origin);
      return u.origin === location.origin && u.pathname === path && !a.closest('[data-wiky]');
    } catch {
      return false;
    }
  });
  log(`navigation vers ${path}${link ? ' (lien du menu)' : ''}`);
  if (link) realClick(link);
  else location.assign(path);
}

let lastStatus: PageStatus | null = null;
let lastFamilies = '';
/** Chargement de la page : ses données React datent de ce moment (ou d'une action faite depuis). */
const pageStart = Date.now();
/** Étiquettes vues sur la page pour chaque carte (pour repérer les vrais changements). */
const pageTags = new Map<string, string>();

/**
 * Après un rechargement par l'API plus récent que la page, les étiquettes de la page sont périmées :
 * on ne les envoie que pour les cartes dont l'étiquetage a changé sur la page (action faite à la main).
 */
function dropStaleTags(cards: ScannedCard[]): void {
  const apiNewer = (store?.meta?.lastCollectionApi ?? 0) > pageStart;
  for (const c of cards) {
    if (!c.id || !c.tags) continue;
    const key = JSON.stringify([...c.tags].sort());
    const prev = pageTags.get(c.id);
    pageTags.set(c.id, key);
    if (apiNewer && (prev === undefined || prev === key)) {
      delete c.tags;
      delete c.tagsExact;
    }
  }
}
let lastApiCollection = 0;

/** Sur la collection, avec l'API activée : rechargement complet au plus toutes les 2 minutes. */
function maybeReloadCollection(kind: PageKind): void {
  if (kind !== 'collection' || !store?.settings.apiRead || Date.now() - lastApiCollection < 120_000) return;
  lastApiCollection = Date.now();
  void runApi('collection').catch((e) => log(`[api] collection : ${(e as Error).message}`));
}
let colors = new Map<string, string>();

/** Recopie les familles de l'autre extension (si elles ont changé). */
function syncFamilies(): void {
  const list = readFamilies();
  const key = JSON.stringify(list);
  if (key === lastFamilies) return;
  lastFamilies = key;
  if (list.length || store?.families) void save({ families: { at: Date.now(), list } });
}

/** 🔄 Actualiser mes ventes : Marché → onglet « Mes ventes » → relevé. */
function maybeRefreshSales(cfg: SelectorConfig): void {
  const it = store?.intent;
  if (!it || it.type !== 'refreshSales' || automating) return;
  if (it.tabId != null && myTabId != null && it.tabId !== myTabId) return;
  if (Date.now() - it.at > 30_000) {
    log('[ventes] abandon : délai dépassé');
    void save({ intent: null });
    return;
  }
  if (!re(cfg.marketPathRe).test(location.pathname)) return navigateTo('/marketplace', `sales:${it.at}`);
  if (lastKind === 'myAuctions' && lastStatus?.recognized) {
    log('[ventes] liste relue');
    void save({ intent: null });
    return;
  }
  const active = activeTabLabel(document, cfg);
  if (active && re(cfg.myAuctionsTabRe).test(active)) return;
  const tab = findByText(rootOf(document, cfg), cfg.myAuctionsTabRe, 'button, [role="tab"], a');
  if (tab && Date.now() - (navTried.get(`tab:${it.at}`) ?? 0) > 2000) {
    navTried.set(`tab:${it.at}`, Date.now());
    log('[ventes] clic sur l\'onglet « Mes ventes »');
    realClick(tab);
    schedule(800);
  }
}

let lastSkip = '';
function skip(reason: string): void {
  if (reason !== lastSkip) log(`[V4] en attente : ${reason}`);
  lastSkip = reason;
}

async function maybePrefill(cfg: SelectorConfig): Promise<void> {
  const p = store?.pendingFocus;
  if (!p || p.prefilledAt || automating) return;
  if (Date.now() - p.at > 5 * 60_000) return skip('demande trop ancienne');
  if (p.tabId != null && myTabId != null && p.tabId !== myTabId) return skip(`autre onglet (${p.tabId} ≠ ${myTabId})`);
  // « Ouvrir » passe d'abord par la collection (une seule fois : ensuite tu navigues librement).
  if (!p.arrivedAt) {
    if (lastKind !== 'collection') {
      skip(`page ${lastKind} : passage par la collection`);
      return navigateTo(store!.settings.sellPath, `sale:${p.at}`);
    }
    await save({ pendingFocus: { ...p, arrivedAt: Date.now() } });
    return;
  }
  if (!store?.settings.prefill || !p.autoOpen) return skip('pré-remplissage (V4) désactivé dans les réglages');
  if (lastKind !== 'collection') return skip(`page ${lastKind}, pas la collection`);
  let tile = lastTiles?.get(p.cardId) ?? null;
  if (!tile && (lastTiles?.size ?? 0) === 0) {
    // Les cartes arrivent après le chargement de la page : on relit dans un instant.
    schedule(1000);
    return skip(`cartes pas encore affichées`);
  }
  automating = true;
  if (!tile) {
    tile = await findTile(p.cardId, p.cardName, cfg);
    if (!tile) {
      automating = false;
      log(`[V4] « ${p.cardName} » introuvable dans la collection`);
      showProgress(p.cardName, 'Carte introuvable dans ta collection (déjà en vente ?).', { error: true });
      await save({ pendingFocus: { ...p, prefilledAt: Date.now() } });
      return;
    }
  }
  log(`[V4] ${p.cardName} : début`);
  showProgress(p.cardName, 'Ouverture de la vente…');
  try {
    await prefillSale(
      tile,
      p.price,
      cfg,
      (s) => {
        log(`[V4] ${p.cardName} : ${s}`);
        showProgress(p.cardName, `${s}…`);
      },
      p.durationMin ?? null,
    );
    endProgress();
    await save({ pendingFocus: { ...p, prefilledAt: Date.now() } });
  } catch (e) {
    log(`[V4] échec : ${(e as Error).message}`);
    const hint = p.price != null ? `prix conseillé ${p.price}` : 'aucun prix conseillé';
    showProgress(p.cardName, `Ouverture de la vente impossible (${(e as Error).message}).\nOuvre-la à la main : ${hint}.\nPuis exporte un diagnostic avec la fenêtre de vente ouverte.`, { error: true });
    await save({ pendingFocus: { ...p, prefilledAt: Date.now() } });
  } finally {
    automating = false;
  }
}

let searched = false;

/** Tuile d'une carte ; si elle n'est pas à l'écran, on la cherche avec le champ de recherche du site. */
async function findTile(cardId: string, cardName: string, cfg: SelectorConfig): Promise<Element | null> {
  const visible = () => lastTiles?.get(cardId) ?? collectionTiles(rootOf(document, cfg), cfg).get(cardId) ?? null;
  const now = visible();
  if (now) return now;
  if (!(await searchCollection(cardName, cfg))) return null;
  searched = true;
  log(`recherche « ${cardName} »`);
  try {
    return await waitFor(visible, `carte « ${cardName} »`, 4000);
  } catch {
    return null;
  }
}

async function runCardAuctions(siteCardId: string): Promise<{ ok: boolean; error?: string; result?: Awaited<ReturnType<typeof fetchCardAuctions>> }> {
  if (!store?.settings.apiRead) return { ok: false, error: 'Lecture via l\'API désactivée (Réglages → Automatisations).' };
  return { ok: true, result: await fetchCardAuctions(siteCardId) };
}

/** Lectures via l'API (option « apiRead ») : mes mises, ventes récentes du marché. */
async function runApi(op: 'myBids' | 'marketSales' | 'collection' | 'mySales'): Promise<{ ok: boolean; error?: string; count?: number }> {
  if (!store?.settings.apiRead && !store?.settings.apiWrite) return { ok: false, error: 'Lecture via l\'API désactivée (Réglages → Automatisations).' };
  if (op === 'collection') {
    const cards = await fetchMyCollection();
    await ext.runtime.sendMessage({ type: 'collection', cards });
    lastApiCollection = Date.now();
    log(`[api] collection rechargée : ${cards.length} carte(s)`);
    return { ok: true, count: cards.length };
  }
  if (op === 'mySales') {
    const result = await fetchMySales();
    await save({ salesCache: result });
    log(`[api] ${result.items.length} vente(s) terminée(s)`);
    return { ok: true, count: result.items.length };
  }
  if (op === 'myBids') {
    const result = await fetchMyBids();
    await save({ bidsCache: result });
    log(`[api] ${result.bids.length} enchère(s) où j'ai misé`);
    return { ok: true, count: result.bids.length };
  }
  const prices = await fetchMarketSales();
  await ext.runtime.sendMessage({ type: 'prices', prices });
  log(`[api] ${prices.length} vente(s) récente(s) du marché`);
  return { ok: true, count: prices.length };
}

/** Étiquetage automatique, carte par carte, avec progression et arrêt possible. */
/** Étiquetage par l'API (option « apiWrite ») : mêmes écritures que le site, sans passer par l'interface. */
async function runAutoTagApi(plan: TagChange[]): Promise<void> {
  if (!store || automating) return;
  automating = true;
  stopRequested = false;
  const lines: string[] = [];
  const stop = () => (stopRequested = true);
  let ok = 0;
  let failed = 0;
  showProgress('Étiquetage (API)', `${plan.length} carte(s) à traiter…`, { onStop: stop });
  try {
    const results = await applyTagsViaApi(
      plan,
      (done, total, step) => {
        log(`[étiquettes API] ${step.cardName}`);
        showProgress('Étiquetage (API)', `${done}/${total} · ${step.cardName}`, { onStop: stop });
      },
      () => stopRequested,
    );
    for (const r of results) {
      if (r.ok) ok++;
      else if (!r.skipped) failed++;
      if (!r.ok) lines.push(r.skipped ? `★ ${r.cardName} : ${r.skipped}` : `✗ ${r.cardName} : ${r.error}`);
    }
  } catch (e) {
    failed++;
    lines.push(`✗ ${(e as Error).message}`);
    log(`[étiquettes API] échec : ${(e as Error).message}`);
  } finally {
    automating = false;
  }
  const summary = `${ok} carte(s) étiquetée(s)${failed ? `, ${failed} échec(s)` : ''}${stopRequested ? ' · arrêté' : ''}`;
  showProgress('Étiquetage (API)', [summary, ...lines.slice(-6), ok ? 'Recharge la page pour voir les étiquettes dans le site.' : ''].filter(Boolean).join('\n'), {
    done: true,
    error: failed > 0 && ok === 0,
  });
  // La collection est relue pour mettre à jour les étiquettes connues de l'extension.
  if (ok) {
    lastApiCollection = 0;
    await runApi('collection').catch(() => {});
  }
}

async function runAutoTag(plan: TagChange[]): Promise<{ ok: number; failed: number }> {
  if (!store || automating) return { ok: 0, failed: 0 };
  automating = true;
  stopRequested = false;
  searched = false;
  const cfg = resolveSelectors(store.settings.selectorOverrides);
  let ok = 0;
  let failed = 0;
  const lines: string[] = [];
  const stop = () => (stopRequested = true);
  try {
    for (const [i, change] of plan.entries()) {
      if (stopRequested) break;
      const head = `${i + 1}/${plan.length} · ${change.cardName} → ${change.target}`;
      showProgress('Étiquetage automatique', [head, ...lines.slice(-4)].join('\n'), { onStop: stop });
      try {
        const tile = await findTile(change.cardId, change.cardName, cfg);
        if (!tile) throw new ActionError('carte introuvable dans la collection, même en la recherchant');
        // Sécurité : une carte en favori n'est jamais modifiée, même si le relevé était ancien.
        if (isFavorite(tile, cfg)) {
          lines.push(`★ ${change.cardName} : favori, ignorée`);
          log(`[étiquettes] ${change.cardName} : favori, ignorée`);
          continue;
        }
        await applyTags(tile, change, cfg, (s) => log(`[étiquettes] ${change.cardName} : ${s}`));
        ok++;
        lines.push(`✓ ${change.cardName} : ${change.target}`);
      } catch (e) {
        failed++;
        log(`[étiquettes] ${change.cardName} : échec ${(e as Error).message}`);
        lines.push(`✗ ${change.cardName} : ${(e as Error).message}`);
        if (failed >= 3 && ok === 0) {
          lines.push('Arrêt : l\'interface d\'étiquetage n\'est pas reconnue. Exporte un diagnostic.');
          break;
        }
      }
      await pause(700, 1500);
    }
  } finally {
    automating = false;
  }
  if (searched) await searchCollection('', cfg);
  const summary = `${ok} carte(s) étiquetée(s)${failed ? `, ${failed} échec(s)` : ''}${stopRequested ? ' · arrêté' : ''}`;
  showProgress('Étiquetage automatique', [summary, ...lines.slice(-6)].join('\n'), { done: true, error: failed > 0 && ok === 0 });
  lastPayload = '';
  setTimeout(() => void scan(true), 800);
  return { ok, failed };
}

function schedule(delay = 700): void {
  clearTimeout(timer);
  timer = window.setTimeout(() => void scan(), delay);
}

function isOwnMutation(m: MutationRecord): boolean {
  const t = m.target instanceof Element ? m.target : m.target.parentElement;
  if (t?.closest('[data-wiky]')) return true;
  if (m.type === 'attributes' && m.attributeName?.startsWith('data-wiky')) return true;
  return m.type === 'childList' && [...m.addedNodes, ...m.removedNodes].every((n) => n instanceof Element && n.hasAttribute('data-wiky'));
}

async function main(): Promise<void> {
  myTabId = ((await ext.runtime.sendMessage({ type: 'tabId' }).catch(() => null)) as { tabId: number | null } | null)?.tabId ?? null;
  await refreshStore();
  await initWindow();
  await scan(true);

  new MutationObserver((muts) => {
    if (muts.every(isOwnMutation)) return;
    schedule(automating ? 1500 : 700);
  }).observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['aria-selected', 'aria-pressed', 'data-state', 'open'] });

  // Next.js change d'URL sans recharger : on surveille location.href.
  setInterval(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      lastPayload = '';
      schedule(900);
    }
  }, 500);

  onStoreChange(['settings', 'rules', 'cards', 'priceObs', 'myAuctions', 'manualPrices', 'pendingFocus', 'intent'], async () => {
    await refreshStore();
    schedule(200);
  });

  ext.runtime.onMessage.addListener((raw: unknown, _sender, sendResponse) => {
    const message = raw as ToContent;
    if (message.type === 'rescan') {
      lastPayload = '';
      void scan(true).then(() => sendResponse({ ok: true, kind: lastKind }));
      return true;
    }
    if (message.type === 'autoTag') {
      // Réglages relus juste avant : le mode (API ou interface) vient peut-être d'être changé.
      void refreshStore().then(() => {
        if (!store?.settings.apiWrite && lastKind !== 'collection') {
          sendResponse({ ok: false, error: 'Ouvre ta collection pour lancer l\'étiquetage.' });
          return;
        }
        const plan = message.plan ?? planAutoTags(store!, store!.settings.autoTagRemoveOthers);
        void (store!.settings.apiWrite ? runAutoTagApi(plan) : runAutoTag(plan));
        sendResponse({ ok: true });
      });
      return true;
    }
    if (message.type === 'api') {
      const job = message.op === 'cardAuctions' ? runCardAuctions(message.siteCardId) : runApi(message.op);
      void job.then(sendResponse, (e) => sendResponse({ ok: false, error: (e as Error).message }));
      return true;
    }
    if (message.type === 'toggleWindow') {
      void toggleWindow().then(() => sendResponse({ ok: true }));
      return true;
    }
    if (message.type === 'stopAutoTag') {
      stopRequested = true;
      sendResponse({ ok: true });
      return false;
    }
    if (message.type === 'diagnostic') {
      const cfg = resolveSelectors(store?.settings.selectorOverrides);
      void requestBridge().then((items) => {
        const byKind = (k: string) => (items ?? []).filter((i) => i.kind === k);
        const result: DiagnosticResult = {
          url: location.pathname + location.search,
          title: document.title,
          at: new Date().toISOString(),
          kind: lastKind,
          parsed: lastParsed,
          react: items
            ? { cards: byKind('card').length, auctions: byKind('auction').length, samples: [...byKind('card').slice(0, 3), ...byKind('auction').slice(0, 3)] }
            : 'script de page indisponible',
          actionLog: actionLog.slice(-60),
          overlay: { tiles: lastTiles?.size ?? 0, tagChips: lastChipCount, colors: Object.fromEntries(colors) },
          scripts: [...document.scripts].map((sc) => sc.src).filter((src) => src.includes('/_next/')).map((src) => new URL(src).pathname),
          outline: domOutline(rootOf(document, cfg) ?? document.body),
        };
        sendResponse(result);
      });
      return true;
    }
    return false;
  });
}

// Évite une double injection (rechargement de l'extension).
const w = window as unknown as { __wikyTraders?: boolean };
if (!w.__wikyTraders && re('wiki-masters\\.com$').test(location.hostname)) {
  w.__wikyTraders = true;
  void main();
}
