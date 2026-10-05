import { freeSlotCount, isActive, makeContext, ruleForAuction } from '../lib/allocation';
import { ext } from '../lib/browser';
import { JOURNAL_MAX, PRICE_OBS_MAX, PRICE_OBS_MAX_AGE_MS, SITE_ORIGIN } from '../lib/defaults';
import { expireAuctions, journalEntry, reconcileAuctions } from '../lib/journal';
import type { ScanMessage, ScannedCard, ToBackground } from '../lib/messages';
import { reliableBase } from '../lib/pricing';
import { load, loadAll, onStoreChange, save } from '../lib/storage';
import { inQuietHours } from '../lib/time';
import type { Card, JournalEntry, MyAuction, PriceObs, StoreShape } from '../lib/types';

const ALARM_PREFIX = 'auction:';
const NOTIF_ID = 'wiky-slot';

/** Les messages sont traités l'un après l'autre pour éviter les écritures concurrentes. */
let queue: Promise<unknown> = Promise.resolve();
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const next = queue.then(fn, fn);
  queue = next.catch(() => {});
  return next;
}

function mergeCards(cards: Record<string, Card>, incoming: ScannedCard[], now: number): Record<string, Card> {
  const out = { ...cards };
  for (const c of incoming) {
    if (!c.id) continue;
    const prev = out[c.id];
    out[c.id] = {
      id: c.id,
      siteId: c.siteId ?? prev?.siteId,
      name: c.name ?? prev?.name ?? c.id,
      rarity: c.rarity ?? prev?.rarity ?? null,
      shiny: c.shiny ?? prev?.shiny,
      category: c.category ?? prev?.category,
      // Des étiquettes lues dans les données du site font foi ; celles du texte s'ajoutent.
      tags: c.tags ? (c.tagsExact ? c.tags : [...new Set([...c.tags, ...(prev?.tags ?? [])])]) : prev?.tags ?? [],
      quantity: c.quantity ?? prev?.quantity ?? 1,
      favorite: c.favorite ?? prev?.favorite ?? false,
      sitePrice: c.sitePrice ?? prev?.sitePrice ?? null,
      sitePriceAt: c.sitePriceAt ?? prev?.sitePriceAt ?? null,
      updatedAt: c.updatedAt ?? prev?.updatedAt ?? now,
    };
  }
  return out;
}

/** Ajoute des observations de prix ; une enchère en cours ne garde que son dernier prix. */
function mergeObs(obs: PriceObs[], incoming: PriceObs[], now: number): PriceObs[] {
  let list = obs.filter((o) => now - o.at < PRICE_OBS_MAX_AGE_MS);
  for (const o of incoming) {
    if (o.auctionId) {
      const soldAlready = list.some((x) => x.auctionId === o.auctionId && x.type === 'sold');
      if (soldAlready) continue;
      list = list.filter((x) => !(x.auctionId === o.auctionId && x.type === 'listing'));
    }
    list.push(o);
  }
  return list.slice(-PRICE_OBS_MAX);
}

function finishedEntries(store: StoreShape, finished: MyAuction[], now: number): JournalEntry[] {
  const ctx = makeContext(store, now);
  return finished.map((a) => {
    const card = store.cards[a.cardId];
    return journalEntry('finished', {
      at: now,
      cardId: a.cardId,
      cardName: a.cardName,
      tag: ruleForAuction(a, store.rules, ctx)?.tag ?? a.tag,
      startPrice: a.startPrice,
      finalPrice: a.currentPrice,
      avgPrice: card ? reliableBase(card, ctx).value : null,
      auctionId: a.id,
    });
  });
}

async function handleScan(msg: ScanMessage): Promise<void> {
  const now = Date.now();
  const store = await loadAll();
  const patch: Partial<StoreShape> = { meta: msg.source === 'api' ? { ...store.meta } : { ...store.meta, lastPage: msg.status } };

  if (msg.cards?.length) {
    patch.cards = mergeCards(store.cards, msg.cards, now);
    if (msg.status.kind === 'collection' && msg.status.recognized) patch.meta!.lastCollectionScan = now;
  }
  if (msg.prices?.length) patch.priceObs = mergeObs(store.priceObs, msg.prices, now);
  // Le nombre de slots affiché par le site (« Mes ventes (2/5) ») fait foi.
  if (msg.siteSlots && msg.siteSlots.slots > 0 && msg.siteSlots.slots !== store.settings.slots) {
    patch.settings = { ...store.settings, slots: msg.siteSlots.slots };
  }

  if (msg.myAuctions) {
    const merged = { ...store, ...patch } as StoreShape;
    const { auctions, created, finished } = reconcileAuctions(store.myAuctions, msg.myAuctions, now);
    const ctx = makeContext(merged, now);
    const entries: JournalEntry[] = [
      ...created.map((a) =>
        journalEntry('created', {
          at: now,
          cardId: a.cardId,
          cardName: a.cardName,
          tag: ruleForAuction(a, merged.rules, ctx)?.tag ?? a.tag,
          startPrice: a.startPrice ?? a.currentPrice,
          finalPrice: null,
          avgPrice: merged.cards[a.cardId] ? reliableBase(merged.cards[a.cardId], ctx).value : null,
          auctionId: a.id,
        }),
      ),
      ...finishedEntries(merged, finished, now),
    ];
    // Les prix finaux de mes propres ventes alimentent aussi l'historique.
    const soldObs: PriceObs[] = finished
      .filter((a) => a.currentPrice != null && a.startPrice != null && a.currentPrice > a.startPrice)
      .map((a) => ({ cardId: a.cardId, price: a.currentPrice!, type: 'sold', at: now, auctionId: a.id }));
    if (soldObs.length) patch.priceObs = mergeObs(patch.priceObs ?? store.priceObs, soldObs, now);

    patch.myAuctions = auctions;
    patch.journal = [...store.journal, ...entries].slice(-JOURNAL_MAX);
    patch.meta!.lastAuctionsScan = now;
    if (created.length) {
      // Une nouvelle enchère : les choix manuels et slots ignorés repartent de zéro (et nouveau tirage aléatoire).
      patch.slotOverrides = {};
      patch.ignoredSlots = [];
      if (store.settings.sortPrice === 'random') patch.settings = { ...(patch.settings ?? store.settings), randomSeed: (now % 2_147_483_647) || 1 };
      if (store.pendingFocus && created.some((a) => a.cardId === store.pendingFocus!.cardId)) patch.pendingFocus = null;
    }
  }
  await save(patch);
}

async function handleProposed(msg: Extract<ToBackground, { type: 'proposed' }>): Promise<void> {
  const { journal } = await load('journal');
  const entry = journalEntry('proposed', {
    cardId: msg.cardId,
    cardName: msg.cardName,
    tag: msg.tag,
    startPrice: msg.price,
    finalPrice: null,
    avgPrice: msg.avgPrice,
  });
  await save({ journal: [...journal, entry].slice(-JOURNAL_MAX) });
}

/** Une alarme par fin d'enchère (F2). */
async function syncAlarms(): Promise<void> {
  const { myAuctions } = await load('myAuctions');
  const now = Date.now();
  const wanted = new Map(myAuctions.filter((a) => a.endsAt != null && isActive(a, now)).map((a) => [ALARM_PREFIX + a.id, a.endsAt! + 5_000]));
  for (const alarm of await ext.alarms.getAll()) {
    if (!alarm.name.startsWith(ALARM_PREFIX)) continue;
    const when = wanted.get(alarm.name);
    if (when == null) await ext.alarms.clear(alarm.name);
    else if (Math.abs(alarm.scheduledTime - when) < 30_000) wanted.delete(alarm.name);
  }
  for (const [name, when] of wanted) ext.alarms.create(name, { when: Math.max(when, now + 1_000) });
}

async function updateBadge(): Promise<void> {
  const store = await load('settings', 'myAuctions', 'meta');
  const free = freeSlotCount(store);
  const unknown = store.meta.lastAuctionsScan == null;
  await ext.action.setBadgeBackgroundColor({ color: '#f59e0b' });
  await ext.action.setBadgeText({ text: unknown ? '?' : free > 0 ? String(free) : '' });
  await ext.action.setTitle({
    title: unknown ? 'Wiky-Traders – ouvre la page de tes enchères' : `Wiky-Traders – ${free} slot(s) libre(s) sur ${store.settings.slots}`,
  });
}

async function onAuctionEnd(auctionId: string): Promise<void> {
  const store = await loadAll();
  const now = Date.now();
  const ended = store.myAuctions.find((a) => a.id === auctionId);
  // On retire de la liste les enchères dont l'heure est passée : le slot est considéré libre.
  const { kept, expired } = expireAuctions(store.myAuctions, now);
  await save({
    myAuctions: kept,
    journal: [...store.journal, ...finishedEntries(store, expired, now)].slice(-JOURNAL_MAX),
  });
  await updateBadge();

  const { settings } = store;
  if (!settings.notifications || inQuietHours(new Date(), settings.quietStart, settings.quietEnd)) return;
  const ctx = makeContext(store, now);
  const rule = ended ? ruleForAuction(ended, store.rules, ctx) : null;
  const free = Math.max(0, settings.slots - kept.length);
  await ext.notifications.create(NOTIF_ID, {
    type: 'basic',
    iconUrl: ext.runtime.getURL('icons/icon-128.png'),
    title: `Slot libéré${ended ? ` : ${ended.cardName}` : ''}`,
    message: `${rule ? `Remets une carte « ${rule.tag} ». ` : ''}${free} slot(s) libre(s). Clique pour ouvrir tes enchères.`,
    priority: 1,
  });
}

async function openAuctionsPage(): Promise<void> {
  const { settings } = await load('settings');
  const url = SITE_ORIGIN + (settings.myAuctionsPath ?? '/marketplace');
  const [tab] = await ext.tabs.query({ url: `${SITE_ORIGIN}/*` });
  let tabId: number | undefined;
  if (tab?.id != null) {
    tabId = tab.id;
    await ext.tabs.update(tab.id, { url, active: true });
    if (tab.windowId != null) await ext.windows.update(tab.windowId, { focused: true });
  } else {
    tabId = (await ext.tabs.create({ url })).id;
  }
  // La page sélectionnera l'onglet « Mes ventes » et relira la liste.
  await save({ intent: { type: 'refreshSales', at: Date.now(), tabId: tabId ?? null } });
}

ext.runtime.onMessage.addListener((raw: unknown, sender, sendResponse) => {
  const msg = raw as ToBackground;
  if (msg.type === 'tabId') {
    sendResponse({ tabId: sender.tab?.id ?? null });
    return false;
  }
  const run =
    msg.type === 'scan' ? () => handleScan(msg) :
    msg.type === 'proposed' ? () => handleProposed(msg) :
    msg.type === 'refreshBadge' ? updateBadge :
    msg.type === 'collection' ? async () => {
      // Relevé complet : il remplace la collection (les cartes vendues ou défaussées disparaissent).
      const { cards, meta } = await load('cards', 'meta');
      const now = Date.now();
      const kept: Record<string, Card> = {};
      for (const c of msg.cards) if (c.id && cards[c.id]) kept[c.id] = cards[c.id];
      await save({ cards: mergeCards(kept, msg.cards, now), meta: { ...meta, lastCollectionScan: now, lastCollectionApi: now } });
    } :
    msg.type === 'prices' ? async () => {
      const { priceObs, meta } = await load('priceObs', 'meta');
      const now = Date.now();
      await save({
        priceObs: mergeObs(priceObs, msg.prices, now),
        ...(msg.market ? { meta: { ...meta, lastMarketFetch: { at: now, ...msg.market } } } : {}),
      });
    } :
    null;
  if (!run) return false;
  serial(run).then(
    () => sendResponse({ ok: true }),
    (e) => sendResponse({ ok: false, error: String(e) }),
  );
  return true;
});

ext.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name.startsWith(ALARM_PREFIX)) void serial(() => onAuctionEnd(alarm.name.slice(ALARM_PREFIX.length)));
});

/** Icône de l'extension : ouvre/ferme la fenêtre sur WikiMasters, sinon ouvre le site. */
ext.action.onClicked.addListener(async (tab) => {
  if (tab.id != null && tab.url?.startsWith(SITE_ORIGIN)) {
    const res = await ext.tabs.sendMessage(tab.id, { type: 'toggleWindow' }).catch(() => null);
    // Onglet ouvert avant l'installation : le script n'y est pas encore, on recharge (la fenêtre s'ouvrira).
    if (!res) {
      await ext.storage.local.set({ floating: { ...((await ext.storage.local.get('floating')).floating ?? {}), open: true, minimized: false } });
      await ext.tabs.reload(tab.id);
    }
    return;
  }
  await ext.storage.local.set({ floating: { ...((await ext.storage.local.get('floating')).floating ?? {}), open: true, minimized: false } });
  const [existing] = await ext.tabs.query({ url: `${SITE_ORIGIN}/*` });
  if (existing?.id != null) {
    await ext.tabs.update(existing.id, { active: true });
    if (existing.windowId != null) await ext.windows.update(existing.windowId, { focused: true });
  } else {
    await ext.tabs.create({ url: `${SITE_ORIGIN}/collection` });
  }
});

ext.notifications.onClicked.addListener((id) => {
  if (id !== NOTIF_ID) return;
  void ext.notifications.clear(id);
  void openAuctionsPage();
});

onStoreChange(['myAuctions', 'settings', 'meta'], () => {
  void syncAlarms();
  void updateBadge();
});

async function init(): Promise<void> {
  // Au démarrage, des enchères ont pu se terminer navigateur fermé.
  await serial(async () => {
    const store = await loadAll();
    const now = Date.now();
    const { kept, expired } = expireAuctions(store.myAuctions, now);
    if (expired.length) {
      await save({ myAuctions: kept, journal: [...store.journal, ...finishedEntries(store, expired, now)].slice(-JOURNAL_MAX) });
    }
  });
  await syncAlarms();
  await updateBadge();
}

/** Compare deux versions « x.y.z ». */
function olderThan(v: string | undefined, ref: string): boolean {
  if (!v) return false;
  const a = v.split('.').map(Number);
  const b = ref.split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) < (b[i] ?? 0);
  return false;
}

ext.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === 'install') void ext.runtime.openOptionsPage();
  // Avant 0.3.0, les cartes du marché étaient enregistrées comme possédées et les prix n'avaient pas
  // de rareté : on repart de zéro (relu à la prochaine visite de la collection).
  if (details.reason === 'update' && olderThan(details.previousVersion, '0.3.0')) {
    await save({ cards: {}, priceObs: [], slotOverrides: {}, ignoredSlots: [] });
  }
  // 0.6.0 : l'arrondi à la dizaine ramenait presque tous les petits prix à 10 → arrondi automatique.
  if (details.reason === 'update' && olderThan(details.previousVersion, '0.6.0')) {
    const { settings } = await load('settings');
    if (settings.rounding === 10) await save({ settings: { ...settings, rounding: 0 } });
  }
  void init();
});
ext.runtime.onStartup.addListener(() => void init());
