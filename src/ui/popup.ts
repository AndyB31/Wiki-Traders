import './common.css';
import './popup.css';
import { allocate, type FreeSlot } from '../lib/allocation';
import { diagnoseAutoTags, planAutoTags } from '../lib/autotag';
import { durationFor, durationLabel } from '../lib/duration';
import { ext } from '../lib/browser';
import { SITE_ORIGIN, STALE_AFTER_MS } from '../lib/defaults';
import type { DiagnosticResult, ToBackground, ToContent } from '../lib/messages';
import { loadAll, onStoreChange, save } from '../lib/storage';
import { formatDuration, formatPrice, RARITIES } from '../lib/text';
import type { Rarity, StoreShape } from '../lib/types';
import { downloadJson, fmtDate, h, mount } from './dom';

const app = document.getElementById('app')!;
/** Affichée dans la fenêtre flottante de la page (iframe) plutôt que dans la popup du navigateur. */
const embedded = new URLSearchParams(location.search).has('embed');
if (embedded) document.documentElement.classList.add('embed');

/** Ferme la popup du navigateur ; dans la fenêtre flottante, elle reste ouverte. */
function closeUi(): void {
  if (!embedded) window.close();
}
let store: StoreShape;
let activeTab: chrome.tabs.Tab | undefined;
type PopupTab = 'sell' | 'running' | 'tags' | 'tools';
let currentTab = (localStorage.getItem('wiky-tab') as PopupTab | null) ?? 'sell';

function rarityDot(r: Rarity | null) {
  return r ? h('span', { class: `rarity ${r}`, title: RARITIES[r].label }) : null;
}

async function sendToTab(msg: ToContent): Promise<unknown> {
  if (activeTab?.id == null) return null;
  try {
    return await ext.tabs.sendMessage(activeTab.id, msg);
  } catch {
    return null;
  }
}

async function openProposal(slot: FreeSlot): Promise<void> {
  const p = slot.proposal!;
  const msg: ToBackground = {
    type: 'proposed',
    cardId: p.card.id,
    cardName: p.card.name,
    tag: slot.rule.tag,
    price: p.pricing.price,
    avgPrice: p.pricing.base.value,
  };
  await ext.runtime.sendMessage(msg).catch(() => {});
  const url = SITE_ORIGIN + store.settings.sellPath;
  const focus = {
    cardId: p.card.id,
    cardName: p.card.name,
    price: p.pricing.price,
    detail: p.pricing.detail,
    at: Date.now(),
    autoOpen: store.settings.prefill,
    durationMin: durationFor(p.pricing.price, store.settings.durationRules),
  };
  // L'onglet cible est mémorisé : seul lui navigue vers la collection et pré-remplit la vente (V4).
  const tab = await siteTab();
  if (tab?.id != null) {
    await save({ pendingFocus: { ...focus, tabId: tab.id } });
  } else {
    const created = await ext.tabs.create({ url });
    await save({ pendingFocus: { ...focus, tabId: created.id } });
  }
  closeUi();
}

/** Onglet WikiMasters courant (relu à chaque fois : la page a pu changer depuis l'ouverture). */
async function siteTab(): Promise<chrome.tabs.Tab | null> {
  if (activeTab?.id == null) return null;
  const tab = await ext.tabs.get(activeTab.id).catch(() => null);
  if (tab) activeTab = tab;
  return tab?.url?.startsWith(SITE_ORIGIN) ? tab : null;
}

/** 🔄 Marché → onglet « Mes ventes » → relevé, exécuté par la page. */
async function refreshSales(): Promise<void> {
  const tab = await siteTab();
  if (tab?.id != null) {
    await save({ intent: { type: 'refreshSales', at: Date.now(), tabId: tab.id } });
  } else {
    const created = await ext.tabs.create({ url: SITE_ORIGIN + '/marketplace' });
    await save({ intent: { type: 'refreshSales', at: Date.now(), tabId: created.id ?? null } });
    closeUi();
  }
}

/** Explique pourquoi un slot n'a pas de carte, avec la correction possible. */
function whyEmpty(slot: FreeSlot) {
  const e = slot.excluded;
  if (!e) return null;
  if (!e.total) {
    const how = slot.rule.match === 'tag' ? `Aucune carte connue ne porte l'étiquette « ${slot.rule.tag} » : ouvre ta collection, ou vérifie le nom exact dans les réglages.` : 'Aucune carte connue dans cette plage de prix.';
    return h('div', { class: 'small muted' }, how);
  }
  const parts = [
    e.keep ? `${e.keep} bloquée(s) par « garder ${slot.rule.keepMin} exemplaire(s) »` : '',
    e.onSale ? `${e.onSale} déjà en vente` : '',
    e.favorite ? `${e.favorite} en favori` : '',
    e.blacklist ? `${e.blacklist} en liste noire` : '',
  ].filter(Boolean);
  return h(
    'div',
    { class: 'small muted' },
    `${e.total} carte(s) dans l'étiquette : ${parts.join(', ')}.`,
    e.keep ? h('div', null, 'Pour vendre ton seul exemplaire, mets « Garder » à 0 pour cette étiquette dans les réglages.') : null,
  );
}

function freeSlotView(slot: FreeSlot) {
  const p = slot.proposal;
  const ignore = async () => {
    const set = new Set(store.ignoredSlots);
    if (slot.ignored) set.delete(slot.key);
    else set.add(slot.key);
    await save({ ignoredSlots: [...set] });
  };
  const header = h(
    'div',
    { class: 'row' },
    h('span', { class: 'pill' }, slot.rule.tag),
    slot.fromRule ? h('span', { class: 'muted small' }, `secours pour « ${slot.fromRule.tag} »`) : null,
    h('span', { class: 'grow' }),
    h('button', { class: 'small', onclick: ignore }, slot.ignored ? 'Rétablir' : 'Ignorer'),
  );
  if (slot.ignored) return h('div', { class: 'slot free ignored card' }, header, h('div', { class: 'muted small' }, 'Slot ignoré jusqu\'à la prochaine enchère.'));
  if (!p) {
    return h('div', { class: 'slot free card' }, header, h('div', { class: 'muted' }, `Aucune carte vendable pour « ${slot.rule.tag} ».`), whyEmpty(slot));
  }

  const select = h(
    'select',
    {
      class: 'grow',
      title: 'Changer de carte',
      onchange: async (e: Event) => {
        const id = (e.target as HTMLSelectElement).value;
        await save({ slotOverrides: { ...store.slotOverrides, [slot.key]: id } });
      },
    },
    slot.candidates.slice(0, 50).map((c) =>
      h('option', { value: c.card.id, selected: c.card.id === p.card.id }, `${c.card.name} ×${c.card.quantity} · ${formatPrice(c.pricing.price)}`),
    ),
  );

  const priceBlock =
    p.pricing.price != null
      ? h('div', { class: 'price' }, formatPrice(p.pricing.price), p.pricing.estimate ? h('span', { class: 'pill est' }, 'estimation') : null)
      : h(
          'div',
          { class: 'row' },
          h('input', {
            type: 'number',
            min: '1',
            placeholder: 'prix moyen',
            title: 'Aucune donnée : saisis un prix moyen de référence',
            onchange: async (e: Event) => {
              const v = Number((e.target as HTMLInputElement).value);
              if (v > 0) await save({ manualPrices: { ...store.manualPrices, [p.card.id]: v } });
            },
          }),
          h('span', { class: 'muted small' }, 'prix moyen à saisir'),
        );

  return h(
    'div',
    { class: 'slot free card' },
    header,
    h(
      'div',
      { class: 'row main' },
      rarityDot(p.card.rarity),
      h('strong', { class: 'grow ellipsis', title: p.card.name }, p.card.name),
      h('span', { class: 'muted small' }, `×${p.card.quantity}`),
      priceBlock,
    ),
    h(
      'div',
      { class: 'muted small detail' },
      p.pricing.detail,
      durationFor(p.pricing.price, store.settings.durationRules) != null
        ? h('span', { class: 'duration' }, ` · durée ${durationLabel(durationFor(p.pricing.price, store.settings.durationRules)!)}`)
        : null,
    ),
    !store.settings.prefill
      ? h('div', { class: 'small muted' }, '« Ouvrir » met la carte en évidence. Pour ouvrir aussi la fenêtre de vente : Réglages → Automatisations → V4.')
      : null,
    h(
      'div',
      { class: 'row actions' },
      h('button', { class: 'primary', onclick: () => openProposal(slot) }, store.settings.prefill ? (p.pricing.price != null ? 'Ouvrir et pré-remplir' : 'Ouvrir la vente') : 'Ouvrir'),
      p.pricing.price != null
        ? h('button', { onclick: (e: Event) => copy(e.target as HTMLButtonElement, String(p.pricing.price)) }, 'Copier le prix')
        : null,
      slot.candidates.length > 1 ? select : null,
    ),
  );
}

async function copy(btn: HTMLButtonElement, text: string): Promise<void> {
  await navigator.clipboard.writeText(text);
  const old = btn.textContent;
  btn.textContent = 'Copié ✓';
  setTimeout(() => (btn.textContent = old), 1200);
}

/** Étiquetage automatique : activation, aperçu du plan et lancement sur l'onglet de la collection. */
function autoTagBlock(onCollection: boolean) {
  if (!store.settings.autoTag) {
    const enable = async () => {
      const ok = confirm(
        'Étiquetage automatique\n\nL\'extension cliquera elle-même dans le menu des étiquettes du site. Les règles de WikiMasters (section 3) interdisent les outils qui interagissent à ta place : ton compte peut être banni sans préavis.\n\nActiver quand même ?',
      );
      if (ok) await save({ settings: { ...store.settings, autoTag: true } });
    };
    return h(
      'div',
      { class: 'card autotag' },
      h('div', { class: 'row' }, h('strong', { class: 'grow' }, 'Étiquetage auto : désactivé'), h('button', { onclick: enable }, 'Activer…')),
      h('div', { class: 'small muted' }, 'Range tes cartes dans l\'étiquette dont la plage de prix (plancher–plafond) contient leur prix de référence.'),
    );
  }
  const plan = planAutoTags(store, store.settings.autoTagRemoveOthers);
  const status = h('div', { class: 'small muted' });
  const start = async () => {
    if (!onCollection) {
      const url = SITE_ORIGIN + '/collection';
      if (activeTab?.id != null && activeTab.url?.startsWith(SITE_ORIGIN)) await ext.tabs.update(activeTab.id, { url });
      else await ext.tabs.create({ url });
      return closeUi();
    }
    const res = (await sendToTab({ type: 'autoTag' })) as { ok: boolean; error?: string } | null;
    status.textContent = res?.ok ? 'Étiquetage lancé : suis la progression sur la page.' : res?.error ?? 'Page non joignable : recharge l\'onglet.';
    if (res?.ok) closeUi();
  };
  const why = () => {
    const d = diagnoseAutoTags(store);
    if (!d.cards) return 'Aucune carte connue : ouvre ta collection.';
    if (!d.rulesWithRange) return 'Aucune règle n\'a de plage de prix : renseigne un plancher et/ou un plafond dans les réglages (ex. « Mettre au Enchère » : 20 à 1000).';
    if (!d.pricedCards) return 'Aucun prix de référence : ouvre Marché → Historique pour observer des ventes (5 par rareté suffisent).';
    return `Les ${d.pricedCards} carte(s) au prix connu sont déjà dans la bonne étiquette.`;
  };
  return h(
    'div',
    { class: 'card autotag' },
    h(
      'div',
      { class: 'row' },
      h('strong', { class: 'grow' }, `Étiquetage auto : ${plan.length} carte(s)`),
      plan.length ? h('button', { class: 'primary', onclick: start }, onCollection ? 'Lancer' : 'Aller à la collection') : null,
      h('button', { title: 'Désactiver', onclick: () => save({ settings: { ...store.settings, autoTag: false } }) }, 'Off'),
    ),
    plan.length
      ? h(
          'details',
          null,
          h('summary', { class: 'small' }, 'Voir les changements'),
          h(
            'ul',
            { class: 'small plan' },
            plan.map((c) =>
              h('li', null, `${c.cardName} (${formatPrice(c.base)}) → ${c.target}`, c.remove.length ? h('span', { class: 'muted' }, ` · retire ${c.remove.join(', ')}`) : null),
            ),
          ),
        )
      : h('div', { class: 'small muted' }, why()),
    status,
  );
}

function render(): void {
  const now = Date.now();
  const alloc = allocate(store, now);
  const occupied = alloc.busy.length;
  const { lastAuctionsScan, lastPage } = store.meta;
  const stale = lastAuctionsScan == null || now - lastAuctionsScan > STALE_AFTER_MS;
  const onSite = !!activeTab?.url?.startsWith(SITE_ORIGIN);

  const banner = h(
    'div',
    { class: 'banner' },
    h('strong', null, `${occupied}/${alloc.slots} slots occupés`),
    alloc.nextEnd ? h('span', { class: 'muted' }, ` · prochain libéré dans ${formatDuration(alloc.nextEnd - now)}`) : null,
  );

  const warnings = [
    stale
      ? h(
          'div',
          { class: 'warn row' },
          h('span', { class: 'grow' }, lastAuctionsScan ? `Données de ${fmtDate(lastAuctionsScan)} : ouvre la page des enchères pour mettre à jour.` : 'Ouvre la page de tes enchères pour que l\'extension les relève.'),
          h('button', { onclick: () => ext.tabs.create({ url: SITE_ORIGIN + (store.settings.myAuctionsPath ?? '/marketplace') }) }, 'Ouvrir'),
        )
      : null,
    lastPage && !lastPage.recognized && onSite ? h('div', { class: 'warn error small' }, lastPage.message) : null,
    !Object.keys(store.cards).length ? h('div', { class: 'warn small' }, 'Aucune carte connue : ouvre ta collection (filtre par étiquette si besoin).') : null,
  ];

  const free = alloc.free.filter((s) => !s.ignored).concat(alloc.free.filter((s) => s.ignored));
  const busy = alloc.busy.map(({ auction, rule }) =>
    h(
      'div',
      { class: 'slot busy row' },
      rarityDot(store.cards[auction.cardId]?.rarity ?? null),
      h('span', { class: 'grow ellipsis', title: auction.cardName }, auction.cardName),
      h('span', { class: 'pill' }, rule?.tag ?? 'hors répartition'),
      h('span', { class: 'num' }, formatPrice(auction.currentPrice ?? auction.startPrice)),
      h('span', { class: 'muted num' }, auction.endsAt ? formatDuration(auction.endsAt - now) : '?'),
    ),
  );

  const tools = onSite
    ? h(
        'div',
        { class: 'tools row small' },
        h('button', { onclick: () => sendToTab({ type: 'rescan' }) }, 'Relire la page'),
        h(
          'button',
          {
            title: 'Enregistre l\'adresse de cet onglet comme la page qui liste tes enchères',
            onclick: async () => {
              const u = new URL(activeTab!.url!);
              await save({ settings: { ...store.settings, myAuctionsPath: u.pathname + u.search } });
              await sendToTab({ type: 'rescan' });
            },
          },
          store.settings.myAuctionsPath && activeTab?.url === SITE_ORIGIN + store.settings.myAuctionsPath ? '✓ Page de mes enchères' : 'C\'est la page de mes enchères',
        ),
        h(
          'button',
          {
            title: 'Exporte la structure de la page pour ajuster les sélecteurs',
            onclick: async () => {
              const res = (await sendToTab({ type: 'diagnostic' })) as DiagnosticResult | null;
              if (res) downloadJson(`wiky-diagnostic-${res.kind}-${Date.now()}.json`, res);
            },
          },
          'Diagnostic',
        ),
      )
    : null;

  const refreshing = !!store.intent && now - store.intent.at < 30_000;
  const sellCount = alloc.free.filter((s) => !s.ignored).length;
  const tabs: { id: PopupTab; label: string; body: () => (Node | string | null)[] }[] = [
    {
      id: 'sell',
      label: `À vendre${sellCount ? ` (${sellCount})` : ''}`,
      body: () => [
        ...free.map(freeSlotView),
        alloc.unassigned > 0 ? h('div', { class: 'muted small' }, `${alloc.unassigned} slot(s) libre(s) sans règle : ajoute un quota dans les réglages.`) : null,
        free.length || alloc.unassigned ? null : h('p', { class: 'muted empty' }, 'Tous les slots sont occupés.'),
      ],
    },
    {
      id: 'running',
      label: `En cours (${busy.length})`,
      body: () => (busy.length ? busy : [h('p', { class: 'muted empty' }, 'Aucune enchère en cours relevée. Utilise 🔄 pour relire tes ventes.')]),
    },
    { id: 'tags', label: 'Étiquettes', body: () => [autoTagBlock(!!activeTab?.url?.startsWith(SITE_ORIGIN + '/collection'))] },
    {
      id: 'tools',
      label: 'Outils',
      body: () => [
        tools ?? h('p', { class: 'muted small' }, 'Ouvre WikiMasters pour relire la page ou exporter un diagnostic.'),
        h(
          'div',
          { class: 'tools row small' },
          h('button', { onclick: () => ext.tabs.create({ url: ext.runtime.getURL('journal.html') }) }, '📒 Journal'),
          h('button', { onclick: () => ext.runtime.openOptionsPage() }, '⚙️ Réglages'),
        ),
        h('p', { class: 'muted small' }, `Ventes relues : ${fmtDate(store.meta.lastAuctionsScan)} · collection : ${fmtDate(store.meta.lastCollectionScan)}`),
      ],
    },
  ];
  const current = tabs.find((t) => t.id === currentTab) ?? tabs[0];

  mount(
    app,
    h(
      'header',
      { class: 'row' },
      h('img', { src: 'icons/icon-32.png', width: 20, height: 20, alt: '' }),
      h('h1', { class: 'grow' }, 'Wiky-Traders'),
      h(
        'button',
        { class: refreshing ? 'spin' : '', title: 'Actualiser mes ventes : Marché → onglet « Mes ventes »', disabled: refreshing, onclick: refreshSales },
        '🔄',
      ),
      h('button', { title: 'Journal', onclick: () => ext.tabs.create({ url: ext.runtime.getURL('journal.html') }) }, '📒'),
      h('button', { title: 'Réglages', onclick: () => ext.runtime.openOptionsPage() }, '⚙️'),
    ),
    banner,
    refreshing ? h('div', { class: 'warn small' }, 'Actualisation : Marché → « Mes ventes »…') : null,
    warnings,
    h(
      'nav',
      { class: 'tabs', role: 'tablist' },
      tabs.map((t) =>
        h(
          'button',
          {
            role: 'tab',
            class: t.id === current.id ? 'tab active' : 'tab',
            'aria-selected': String(t.id === current.id),
            onclick: () => {
              currentTab = t.id;
              localStorage.setItem('wiky-tab', t.id);
              render();
            },
          },
          t.label,
        ),
      ),
    ),
    h('section', { class: 'panel', role: 'tabpanel' }, current.body()),
    h(
      'footer',
      { class: 'muted small' },
      store.settings.prefill || store.settings.autoTag
        ? '⚠️ Automatisations actives : interdites par les règles de WikiMasters, risque de ban.'
        : 'Conseils uniquement : c\'est toi qui cliques sur « Mettre aux enchères ».',
    ),
  );
}

async function refresh(): Promise<void> {
  store = await loadAll();
  render();
}

async function main(): Promise<void> {
  // Dans la fenêtre flottante, l'onglet est celui qui contient l'iframe.
  activeTab = (embedded ? await ext.tabs.getCurrent() : undefined) ?? (await ext.tabs.query({ active: true, currentWindow: true }))[0];
  await refresh();
  onStoreChange(['cards', 'myAuctions', 'priceObs', 'rules', 'settings', 'manualPrices', 'slotOverrides', 'ignoredSlots', 'meta', 'intent'], refresh);
  setInterval(render, 15_000);
}

void main();
