import './common.css';
import './popup.css';
import { allocate, makeContext, type FreeSlot } from '../lib/allocation';
import { rarityBase } from '../lib/pricing';
import { catalogPriceOf, diagnoseAutoTags, planAutoTags, type CatalogPriceEntry } from '../lib/autotag';
import { durationFor, durationLabel } from '../lib/duration';
import { ext } from '../lib/browser';
import { CARD_PRICES_KEY, SITE_ORIGIN, STALE_AFTER_MS } from '../lib/defaults';
import type { DiagnosticResult, ToBackground, ToContent } from '../lib/messages';
import { featureFlags } from '../lib/features';
import { loadAll, onStoreChange, save } from '../lib/storage';
import { formatDuration, formatPrice, normalize, RARITIES, slugify } from '../lib/text';
import type { BidStatus, Card, CardAuctionsResult, Family, FamilyCard, MyBid, Rarity, SoldItem, StoreShape } from '../lib/types';
import { downloadJson, fmtDate, h, mount } from './dom';
import { embedded, initEmbed, view } from './embed';

const app = document.getElementById('app')!;
// Affichée dans une fenêtre ou une page du site (iframe) plutôt que dans la popup du navigateur.
initEmbed();

/** Ferme la popup du navigateur ; dans la fenêtre flottante, elle reste ouverte. */
function closeUi(): void {
  if (!embedded) window.close();
}
let store: StoreShape;
let activeTab: chrome.tabs.Tab | undefined;
type PopupTab = 'sell' | 'running' | 'bids' | 'sold' | 'cards' | 'tags' | 'tools';
type GroupBy = 'family' | 'tag' | 'category' | 'rarity';
let groupBy = localStorage.getItem('wiky-group') as GroupBy | null;
let cardFilter = '';
const openGroups = new Set<string>();
let currentTab = ((view as PopupTab | null) ?? (localStorage.getItem('wiky-tab') as PopupTab | null)) ?? 'sell';

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

/**
 * « Proposer d'autres cartes » : chaque slot libre passe à la carte suivante de ses candidates
 * (en boucle), sans proposer deux fois la même carte.
 */
async function rotateProposals(free: FreeSlot[]): Promise<void> {
  // Mode aléatoire : un nouveau tirage plutôt qu'une rotation.
  if (store.settings.sortPrice === 'random') {
    await save({ slotOverrides: {}, settings: { ...store.settings, randomSeed: (store.settings.randomSeed * 48271 + 11) % 2_147_483_647 } });
    return;
  }
  const overrides: Record<string, string> = { ...store.slotOverrides };
  // D'abord des cartes qui ne sont pas déjà proposées ; à défaut, n'importe quelle autre candidate libre.
  const current = new Set(free.map((s) => s.proposal?.card.id).filter((id): id is string => !!id));
  const taken = new Set<string>();
  for (const slot of free) {
    if (slot.ignored || slot.candidates.length < 2 || !slot.proposal) continue;
    const ids = slot.candidates.map((c) => c.card.id);
    const start = ids.indexOf(slot.proposal.card.id);
    const order = ids.map((_, i) => ids[(start + 1 + i) % ids.length]);
    const next = order.find((id) => !taken.has(id) && !current.has(id)) ?? order.find((id) => !taken.has(id) && id !== slot.proposal!.card.id);
    if (next) {
      overrides[slot.key] = next;
      taken.add(next);
    }
  }
  await save({ slotOverrides: overrides });
}

function proposalTools(free: FreeSlot[]) {
  const rotatable = free.some((s) => !s.ignored && s.candidates.length > 1);
  const custom = Object.keys(store.slotOverrides).length > 0;
  if (!rotatable && !custom) return null;
  return h(
    'div',
    { class: 'row proposal-tools' },
    rotatable
      ? h(
          'button',
          { title: store.settings.sortPrice === 'random' ? 'Nouveau tirage aléatoire' : 'Propose d\'autres cartes pour les slots libres', onclick: () => rotateProposals(free) },
          '🔀 Proposer d\'autres cartes',
        )
      : null,
    custom ? h('button', { class: 'small', title: 'Revenir aux meilleures propositions', onclick: () => save({ slotOverrides: {} }) }, '↺ Par défaut') : null,
  );
}

/**
 * Options du menu « changer de carte », groupées : d'abord les cartes qui ont un prix à elles
 * (moyenne du site, ventes de la carte, prix saisi), puis celles estimées par la médiane de leur rareté
 * (même prix pour toute la rareté : c'est normal, la carte n'a jamais été vendue).
 */
function candidateOptions(candidates: FreeSlot['candidates'], selected: string) {
  const own = candidates.filter((c) => ['site', 'history', 'manual'].includes(c.pricing.base.source));
  const option = (c: FreeSlot['candidates'][number]) =>
    h(
      'option',
      { value: c.card.id, selected: c.card.id === selected },
      `${c.card.name}${c.card.quantity > 1 ? ` ×${c.card.quantity}` : ''} · ${formatPrice(c.pricing.price)}`,
    );
  const groups: Node[] = [];
  if (own.length) groups.push(h('optgroup', { label: 'Prix propre à la carte' }, own.slice(0, 200).map(option)));
  const byRarity = new Map<string, FreeSlot['candidates']>();
  for (const c of candidates) {
    if (own.includes(c)) continue;
    const r = c.card.rarity ? RARITIES[c.card.rarity].label : 'Rareté inconnue';
    const label = c.pricing.base.source === 'rarity' || c.pricing.base.source === 'estimate' ? `${r} · prix de la rareté` : `${r} · sans prix`;
    byRarity.set(label, [...(byRarity.get(label) ?? []), c]);
  }
  for (const [label, list] of byRarity) groups.push(h('optgroup', { label: `${label} (${formatPrice(list[0].pricing.price)})` }, list.slice(0, 200).map(option)));
  return groups;
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
    candidateOptions(slot.candidates, p.card.id),
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
    p.pricing.base.source === 'rarity' || p.pricing.base.source === 'estimate'
      ? h('div', { class: 'small muted' }, `Prix déduit de la rareté : cette carte n'a pas de vente connue (toutes les cartes ${p.card.rarity ? RARITIES[p.card.rarity].label : ''} sans historique ont ce prix).`)
      : null,
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

const BID_STATUS: Record<BidStatus, string> = { leading: 'En tête', outbid: 'Surenchéri', won: 'Gagnée', lost: 'Perdue', cancelled: 'Annulée' };

/** Temps restant d'une mise : à la seconde sous 10 minutes. */
function endText(endsAt: number, now: number): string {
  const left = endsAt - now;
  if (left <= 0) return 'terminée';
  if (left > 10 * 60_000) return `fin ${formatDuration(left)}`;
  const s = Math.floor(left / 1000);
  return `fin ${Math.floor(s / 60) ? `${Math.floor(s / 60)} min ` : ''}${String(s % 60).padStart(2, '0')} s`;
}

/** Onglet « Mises » : enchères des autres où j'ai misé, lues via l'API (lecture seule). */
/** « Mes mises » : actualisation en cours (lancée à l'ouverture de l'onglet) et filtre « en cours seulement ». */
let bidsRefreshing = false;
let bidsError: string | null = null;
let bidsCurrentOnly = localStorage.getItem('wiky-bids-current') === '1';

/** Mise toujours en jeu : en tête ou surenchérie, et pas encore terminée. */
function isCurrentBid(b: MyBid, now: number): boolean {
  return (b.status === 'leading' || b.status === 'outbid') && (b.endsAt == null || b.endsAt > now);
}

/** Relit mes mises via l'onglet du site chaque fois que « Mes mises » s'ouvre (la liste affichée est toujours fraîche). */
async function refreshBidsOnOpen(): Promise<void> {
  if (currentTab !== 'bids' || bidsRefreshing || !store?.settings.apiRead) return;
  if (!(await siteTab())) return;
  bidsRefreshing = true;
  bidsError = null;
  render();
  const res = (await sendToTab({ type: 'api', op: 'myBids' })) as { ok: boolean; error?: string } | null;
  bidsRefreshing = false;
  bidsError = !res ? 'Page non joignable : recharge l\'onglet.' : res.ok ? null : res.error ?? 'Erreur';
  // Le nouveau relevé arrive aussi par le stockage (onStoreChange) ; on redessine pour retirer « Actualisation… ».
  render();
}

function bidsBlock() {
  if (!store.settings.apiRead) {
    const enable = async () => {
      const ok = confirm(
        'Lecture via l\'API\n\nL\'extension lira tes mises et les ventes du marché directement dans la base du site, avec ta session (lectures seules, aucune écriture). Les appels directs aux API internes sortent du cadre « copilote » ; le risque vis-à-vis des règles reste le tien.\n\nActiver ?',
      );
      if (ok) await save({ settings: { ...store.settings, apiRead: true } });
    };
    return [
      h('p', { class: 'muted small' }, 'Liste des enchères où tu as misé, avec ta mise, le prix actuel et le prix de référence de chaque carte. Nécessite la lecture via l\'API du site.'),
      h('button', { onclick: enable }, 'Activer la lecture via l\'API…'),
    ];
  }
  const status = h(
    'span',
    { class: 'small muted grow' },
    bidsRefreshing ? 'Actualisation…' : bidsError ?? (store.bidsCache ? `Relevé ${fmtDate(store.bidsCache.at)}` : 'Pas encore de relevé.'),
  );
  const run = async (op: 'myBids' | 'marketSales', btn: HTMLButtonElement) => {
    if (!(await siteTab())) {
      status.textContent = 'Ouvre un onglet WikiMasters pour interroger l\'API.';
      return;
    }
    btn.disabled = true;
    status.textContent = 'Chargement…';
    const res = (await sendToTab({ type: 'api', op })) as { ok: boolean; error?: string; count?: number } | null;
    btn.disabled = false;
    status.textContent = !res ? 'Page non joignable : recharge l\'onglet.' : res.ok ? `${res.count} ${op === 'myBids' ? 'enchère(s)' : 'vente(s) chargée(s)'}` : res.error ?? 'Erreur';
  };
  const ctx = makeContext(pricingInput(), Date.now());
  // Surenchère en un clic (automatisation) : faite par l'onglet du site, après confirmation dans la page.
  const quick = featureFlags(store.settings.features).quickOutbid;
  const outbid = async (auctionId: string, btn: HTMLButtonElement) => {
    if (!(await siteTab())) {
      status.textContent = 'Ouvre un onglet WikiMasters pour miser.';
      return;
    }
    btn.disabled = true;
    status.textContent = 'Confirme la mise dans la page…';
    const res = (await sendToTab({ type: 'outbid', auctionId })) as { ok: boolean; error?: string; amount?: number } | null;
    btn.disabled = false;
    status.textContent = !res ? 'Page non joignable : recharge l\'onglet.' : res.ok ? `Mise de ${formatPrice(res.amount)} envoyée.` : res.error ?? 'Mise refusée.';
  };
  const order: Record<BidStatus, number> = { leading: 0, outbid: 0, won: 1, lost: 1, cancelled: 2 };
  const all = store.bidsCache?.bids ?? [];
  const current = all.filter((b) => isCurrentBid(b, Date.now()));
  const rows = [...(bidsCurrentOnly ? current : all)].sort((a, b) => order[a.status] - order[b.status] || (order[a.status] === 0 ? (a.endsAt ?? 0) - (b.endsAt ?? 0) : b.lastBidAt - a.lastBidAt));
  const now = Date.now();
  const row = (b: MyBid) => {
    const ref = rarityBase(b.rarity, b.shiny, ctx);
    const refText = [
      b.cardMedian != null ? `carte ${formatPrice(b.cardMedian)} (${b.cardSales} vente${b.cardSales > 1 ? 's' : ''})` : 'carte jamais vendue',
      ref?.value != null ? `${ref.group} ${formatPrice(ref.value)}` : null,
    ].filter(Boolean).join(' · ');
    return h(
      'div',
      { class: `bid ${b.status}` },
      h(
        'div',
        { class: 'row' },
        rarityDot(b.rarity),
        h('a', { class: 'grow ellipsis', href: '#', title: 'Ouvrir l\'enchère', onclick: (e: Event) => (e.preventDefault(), openAuction(b.auctionId)) }, `${b.cardName}${b.shiny ? ' ✨' : ''}`),
        h('span', { class: `pill st-${b.status}` }, BID_STATUS[b.status]),
      ),
      h(
        'div',
        { class: 'row small muted' },
        h('span', null, `ma mise ${formatPrice(b.myMax)}${b.myBids > 1 ? ` (${b.myBids}×)` : ''}`),
        h('span', null, `· ${b.status === 'won' || b.status === 'lost' ? 'final' : 'actuel'} ${formatPrice(b.current)}`),
        h('span', { class: 'grow' }),
        b.endsAt && b.endsAt > now ? h('span', { 'data-ends': String(b.endsAt) }, endText(b.endsAt, now)) : h('span', null, fmtDate(b.endsAt)),
      ),
      h('div', { class: 'small muted' }, `réf. ${refText}`),
      quick && b.status === 'outbid' && b.endsAt != null && b.endsAt > now
        ? h(
            'div',
            { class: 'row' },
            h('span', { class: 'grow' }),
            h('button', { title: 'Surenchérir au minimum (+10 %) ; confirmation dans la page avec le montant et ton solde', onclick: (e: Event) => outbid(b.auctionId, e.currentTarget as HTMLButtonElement) }, 'Surenchérir (+min)'),
          )
        : null,
    );
  };
  return [
    h(
      'div',
      { class: 'row' },
      status,
      h('button', { title: 'Relire mes mises', onclick: (e: Event) => run('myBids', e.currentTarget as HTMLButtonElement) }, 'Actualiser'),
      h('button', { title: 'Charge les ventes conclues des 7 derniers jours (prix de référence par rareté)', onclick: (e: Event) => run('marketSales', e.currentTarget as HTMLButtonElement) }, 'Prix du marché'),
    ),
    h(
      'label',
      { class: 'row small', title: 'Masque les mises gagnées, perdues ou annulées' },
      h('input', {
        type: 'checkbox',
        checked: bidsCurrentOnly,
        onchange: (e: Event) => {
          bidsCurrentOnly = (e.target as HTMLInputElement).checked;
          localStorage.setItem('wiky-bids-current', bidsCurrentOnly ? '1' : '0');
          render();
        },
      }),
      h('span', { class: 'grow' }, `En cours seulement (${current.length})`),
    ),
    rows.length
      ? h('div', { class: 'bids' }, rows.map(row))
      : h(
          'p',
          { class: 'muted empty' },
          bidsRefreshing ? 'Actualisation…' : bidsCurrentOnly && all.length ? 'Aucune mise en cours.' : store.bidsCache ? 'Aucune mise trouvée.' : 'Clique sur « Actualiser ».',
        ),
  ];
}

/** Groupes (familles) d'une carte selon le regroupement choisi. */
function groupsOf(card: Card): string[] {
  if (groupBy === 'rarity') return [card.rarity ? RARITIES[card.rarity].label : 'Rareté inconnue'];
  if (groupBy === 'category') return [card.category || 'Sans catégorie'];
  return card.tags.length ? card.tags : ['Sans étiquette'];
}

/** Ordre des familles : alphabétique (ou par rareté), les groupes « Sans … » à la fin. */
function compareGroups(a: string, b: string): number {
  const other = (n: string) => (/^(sans |rareté inconnue)/i.test(n) ? 1 : 0);
  if (other(a) !== other(b)) return other(a) - other(b);
  if (groupBy === 'rarity') {
    const order = (n: string) => (Object.values(RARITIES).find((r) => r.label === n)?.order ?? 99);
    return order(b) - order(a);
  }
  return normalize(a).localeCompare(normalize(b));
}

/** Identifiants du site des cartes possédées (pour la possession dans les familles). */
function ownedIds(): Set<string> {
  return new Set(Object.values(store.cards).flatMap((c) => (c.siteId && c.quantity > 0 ? [c.siteId] : [])));
}

/** Carte d'une famille, complétée par ce que l'extension sait de ma collection. */
function familyCardToCard(f: FamilyCard): Card {
  const mine = Object.values(store.cards).find((c) => c.siteId === f.siteId) ?? store.cards[slugify(f.name)];
  return (
    mine ?? {
      id: slugify(f.name),
      siteId: f.siteId,
      name: f.name,
      rarity: f.rarity,
      category: f.category ?? undefined,
      tags: [],
      quantity: 0,
      favorite: false,
      sitePrice: null,
      sitePriceAt: null,
      updatedAt: 0,
    }
  );
}

/**
 * Familles à afficher : celles de Wiki-Traders (page Familles du site), sinon celles lues dans l'extension
 * « Prix moyen collection ». La possession est recalculée d'après ma collection.
 */
function shownFamilies(): Family[] {
  if (store.myFamilies?.length) {
    return store.myFamilies.map((f) => ({
      id: f.id,
      name: f.name,
      cards: f.cards.map((c) => ({ siteId: c.siteId, name: c.title, rarity: c.rarity, category: c.category, owned: null })),
    }));
  }
  return store.families?.list ?? [];
}

/** Familles (Wiki-Traders, ou « Prix moyen collection ») : toutes leurs cartes, possédées ou non. */
function familyList() {
  const families = shownFamilies();
  if (!families.length) {
    return [
      h(
        'p',
        { class: 'muted small' },
        'Aucune famille. Crée-les sur WikiMasters : menu Wiki-Traders → Familles (celles d\'une autre extension y sont importées).',
      ),
    ];
  }
  const q = normalize(cardFilter);
  const mine = ownedIds();
  return families.map((fam) => {
    const cards = fam.cards.filter((c) => !q || normalize(`${c.name} ${c.category ?? ''} ${fam.name}`).includes(q));
    const ownedOf = (c: FamilyCard) => c.owned ?? mine.has(c.siteId);
    const owned = fam.cards.filter(ownedOf).length;
    const details = h(
      'details',
      { class: 'family', open: !!q || openGroups.has(fam.id) || families.length === 1 },
      h('summary', null, h('strong', null, fam.name), h('span', { class: 'muted' }, ` (${owned}/${fam.cards.length})`)),
      cards
        .sort((a, b) => Number(ownedOf(a)) - Number(ownedOf(b)) || a.name.localeCompare(b.name))
        .map((c) => {
          const card = familyCardToCard(c);
          const has = ownedOf(c);
          return h(
            'button',
            { class: `card-row row${has ? '' : ' missing'}`, title: 'Voir les enchères en cours pour cette carte', onclick: () => openCardAuctions(card) },
            rarityDot(c.rarity),
            h('span', { class: 'grow ellipsis' }, c.name),
            h('span', { class: has ? 'owned small' : 'muted small' }, has ? '✓' : 'manquante'),
            card.sitePrice != null ? h('span', { class: 'muted small' }, `moy. ${formatPrice(card.sitePrice)}`) : null,
            h('span', { class: 'muted' }, '›'),
          );
        }),
    );
    details.addEventListener('toggle', () => (details.open ? openGroups.add(fam.id) : openGroups.delete(fam.id)));
    return details;
  });
}

function cardList() {
  if (groupBy === 'family') return familyList();
  const q = normalize(cardFilter);
  const cards = Object.values(store.cards).filter((c) => !q || normalize(`${c.name} ${c.category ?? ''} ${c.tags.join(' ')}`).includes(q));
  const groups = new Map<string, Card[]>();
  for (const c of cards) for (const g of groupsOf(c)) groups.set(g, [...(groups.get(g) ?? []), c]);
  const sorted = [...groups.entries()].sort((a, b) => compareGroups(a[0], b[0]));
  if (!sorted.length) return [h('p', { class: 'muted empty' }, Object.keys(store.cards).length ? 'Aucune carte ne correspond.' : 'Aucune carte connue : ouvre ta collection.')];
  return sorted.map(([name, list]) => {
    const details = h(
      'details',
      { class: 'family', open: !!q || openGroups.has(name) || sorted.length === 1 },
      h('summary', null, h('strong', null, name), h('span', { class: 'muted' }, ` (${list.length})`)),
      list
        .sort((a, b) => (RARITIES[b.rarity ?? 'C'].order - RARITIES[a.rarity ?? 'C'].order) || a.name.localeCompare(b.name))
        .map((c) =>
          h(
            'button',
            { class: 'card-row row', title: 'Voir les enchères en cours pour cette carte', onclick: () => openCardAuctions(c) },
            rarityDot(c.rarity),
            h('span', { class: 'grow ellipsis' }, `${c.name}${c.shiny ? ' ✨' : ''}`),
            c.favorite ? h('span', { title: 'Favori' }, '★') : null,
            c.sitePrice != null ? h('span', { class: 'muted small' }, `moy. ${formatPrice(c.sitePrice)}`) : null,
            h('span', { class: 'muted' }, '›'),
          ),
        ),
    );
    details.addEventListener('toggle', () => (details.open ? openGroups.add(name) : openGroups.delete(name)));
    return details;
  });
}

/** Onglet « Cartes » : familles (autre extension), ou mes cartes par étiquette, catégorie ou rareté. */
function cardsBlock() {
  groupBy ??= shownFamilies().length ? 'family' : 'tag';
  const list = h('div', { class: 'families' }, cardList());
  const redraw = () => mount(list, cardList());
  const search = h('input', {
    type: 'search',
    class: 'grow',
    placeholder: 'Rechercher une carte…',
    value: cardFilter,
    oninput: (e: Event) => {
      cardFilter = (e.target as HTMLInputElement).value;
      redraw();
    },
  });
  const select = h(
    'select',
    {
      title: 'Regrouper par',
      onchange: (e: Event) => {
        groupBy = (e.target as HTMLSelectElement).value as GroupBy;
        localStorage.setItem('wiky-group', groupBy);
        openGroups.clear();
        redraw();
      },
    },
    h('option', { value: 'family', selected: groupBy === 'family' }, 'par famille'),
    h('option', { value: 'tag', selected: groupBy === 'tag' }, 'par étiquette'),
    h('option', { value: 'category', selected: groupBy === 'category' }, 'par catégorie'),
    h('option', { value: 'rarity', selected: groupBy === 'rarity' }, 'par rareté'),
  );
  return [collectionStatus(), h('div', { class: 'row' }, search, select), list];
}

/** État de la collection connue + bouton Recharger (complet via l'API, sinon relecture de la page). */
function collectionStatus(label = '↻ Recharger') {
  const n = Object.keys(store.cards).length;
  const { lastCollectionScan, lastCollectionApi } = store.meta;
  const fromApi = !!lastCollectionApi && lastCollectionApi === lastCollectionScan;
  const status = h(
    'span',
    { class: 'small muted grow' },
    `${n} carte(s) · relue ${fmtDate(lastCollectionScan)}${lastCollectionScan ? (fromApi ? ' (complète, API)' : ' (page)') : ''}`,
  );
  const reload = async (e: Event) => {
    const btn = e.currentTarget as HTMLButtonElement;
    const tab = await siteTab();
    if (!tab) {
      status.textContent = 'Ouvre un onglet WikiMasters pour recharger la collection.';
      return;
    }
    btn.disabled = true;
    status.textContent = 'Rechargement…';
    if (store.settings.apiRead || store.settings.apiWrite) {
      const res = (await sendToTab({ type: 'api', op: 'collection' })) as { ok: boolean; error?: string; count?: number } | null;
      status.textContent = !res ? 'Page non joignable : recharge l\'onglet.' : res.ok ? `${res.count} carte(s) rechargée(s)` : res.error ?? 'Erreur';
    } else {
      // Sans API : on relit la page de collection (seules les cartes affichées sont vues).
      if (!tab.url?.startsWith(SITE_ORIGIN + '/collection')) await ext.tabs.update(tab.id!, { url: SITE_ORIGIN + '/collection' });
      else await sendToTab({ type: 'rescan' });
      status.textContent = 'Page relue. Active la lecture via l\'API (onglet Mises) pour recharger toute la collection.';
    }
    btn.disabled = false;
  };
  const viaApi = store.settings.apiRead || store.settings.apiWrite;
  return h('div', { class: 'row' }, status, h('button', { title: viaApi ? 'Recharge toute la collection via l\'API' : 'Relit la page de collection', onclick: reload }, label));
}

/** Fenêtre « enchères en cours pour cette carte », de la moins chère à la plus chère. */
async function openCardAuctions(card: Card): Promise<void> {
  document.querySelector('.modal')?.remove();
  const body = h('div', { class: 'modal-body' }, h('p', { class: 'muted' }, 'Chargement…'));
  const close = () => modal.remove();
  const modal = h(
    'div',
    { class: 'modal', onclick: (e: Event) => e.target === modal && close() },
    h(
      'div',
      { class: 'modal-box', role: 'dialog', 'aria-label': `Enchères pour ${card.name}` },
      h('div', { class: 'row modal-head' }, rarityDot(card.rarity), h('strong', { class: 'grow ellipsis' }, `${card.name}${card.shiny ? ' ✨' : ''}`), h('button', { title: 'Fermer', onclick: close }, '×')),
      card.category ? h('div', { class: 'small muted' }, card.category) : null,
      body,
    ),
  );
  document.body.append(modal);

  if (!store.settings.apiRead) {
    mount(
      body,
      h('p', { class: 'muted small' }, 'La liste des enchères en cours vient de l\'API du site.'),
      h('button', { onclick: async () => (await save({ settings: { ...store.settings, apiRead: true } }), close(), openCardAuctions(card)) }, 'Activer la lecture via l\'API'),
    );
    return;
  }
  if (!card.siteId) return mount(body, h('p', { class: 'muted small' }, 'Identifiant de la carte inconnu : ouvre ta collection pour le relever.'));
  if (!(await siteTab())) return mount(body, h('p', { class: 'muted small' }, 'Ouvre un onglet WikiMasters pour interroger l\'API.'));
  const res = (await sendToTab({ type: 'api', op: 'cardAuctions', siteCardId: card.siteId })) as { ok: boolean; error?: string; result?: CardAuctionsResult } | null;
  if (!res?.ok || !res.result) return mount(body, h('p', { class: 'error small' }, res?.error ?? 'Page non joignable : recharge l\'onglet.'));
  const { auctions, sales, median: med } = res.result;
  const now = Date.now();
  mount(
    body,
    h(
      'div',
      { class: 'small muted' },
      `${auctions.length} enchère(s) en cours`,
      sales ? ` · médiane des ventes ${formatPrice(med)} (${sales} vente${sales > 1 ? 's' : ''})` : ' · jamais vendue',
    ),
    auctions.length
      ? h(
          'div',
          { class: 'auction-list' },
          auctions.map((a, i) =>
            h(
              'div',
              { class: 'row auction-row' },
              h('span', { class: 'rank muted small' }, `${i + 1}.`),
              h('strong', { class: 'num' }, formatPrice(a.price)),
              h('span', { class: 'small muted grow' }, `${a.hasBid ? 'mise en cours' : 'mise de départ'}${a.shiny ? ' · ✨' : ''}${a.mine ? ' · à toi' : ''}`),
              h('span', { class: 'small muted' }, a.endsAt ? formatDuration(a.endsAt - now) : ''),
              h('button', { class: 'primary', onclick: () => (close(), openAuction(a.id)) }, 'Ouvrir'),
            ),
          ),
        )
      : h('p', { class: 'muted empty' }, 'Aucune enchère en cours pour cette carte.'),
  );
}

/** « +6 (+25 %) » coloré : écart entre un prix obtenu et une référence. */
function diffView(value: number | null, ref: number | null | undefined, label: string) {
  if (value == null || ref == null || ref <= 0) return null;
  const d = value - ref;
  const pct = Math.round((d / ref) * 100);
  return h('span', { class: d >= 0 ? 'up' : 'down', title: `${label} : ${formatPrice(ref)}` }, `${label} ${formatPrice(ref)} → ${d >= 0 ? '+' : ''}${formatPrice(d)} (${pct >= 0 ? '+' : ''}${pct} %)`);
}

let showUnsold = false;

/** Onglet « Vendues » : mes ventes terminées, prix final et écart avec le prix de référence de la carte. */
function soldBlock() {
  const ctx = makeContext(pricingInput(), Date.now());
  if (!store.settings.apiRead) {
    // Sans API : ventes vues par l'extension (journal local).
    const done = store.journal.filter((e) => e.type === 'finished').reverse();
    return [
      h(
        'div',
        { class: 'row' },
        h('span', { class: 'small muted grow' }, 'Journal local (ventes vues par l\'extension).'),
        h('button', { onclick: async () => save({ settings: { ...store.settings, apiRead: true } }) }, 'Historique complet (API)…'),
      ),
      done.length
        ? h(
            'div',
            { class: 'bids' },
            done.slice(0, 100).map((e) =>
              h(
                'div',
                { class: 'bid' },
                h('div', { class: 'row' }, h('strong', { class: 'grow ellipsis' }, e.cardName), h('span', { class: 'num' }, formatPrice(e.finalPrice))),
                h('div', { class: 'row small muted' }, diffView(e.finalPrice, e.startPrice, 'départ'), h('span', { class: 'grow' }), h('span', null, fmtDate(e.at))),
                h('div', { class: 'small muted' }, diffView(e.finalPrice, e.avgPrice, 'réf.')),
              ),
            ),
          )
        : h('p', { class: 'muted empty' }, 'Aucune vente terminée dans le journal.'),
    ];
  }
  const status = h('span', { class: 'small muted grow' }, store.salesCache ? `Relevé ${fmtDate(store.salesCache.at)}` : 'Pas encore de relevé.');
  const run = async (btn: HTMLButtonElement) => {
    if (!(await siteTab())) {
      status.textContent = 'Ouvre un onglet WikiMasters pour interroger l\'API.';
      return;
    }
    btn.disabled = true;
    status.textContent = 'Chargement…';
    const res = (await sendToTab({ type: 'api', op: 'mySales' })) as { ok: boolean; error?: string; count?: number } | null;
    btn.disabled = false;
    status.textContent = !res ? 'Page non joignable : recharge l\'onglet.' : res.ok ? `${res.count} vente(s) terminée(s)` : res.error ?? 'Erreur';
  };
  const all = store.salesCache?.items ?? [];
  const sold = all.filter((i) => i.sold);
  const items = showUnsold ? all : sold;
  const refOf = (i: SoldItem) => (i.cardSales ? i.cardMedian : rarityBase(i.rarity, i.shiny, ctx)?.value ?? null);
  const total = sold.reduce((t, i) => t + (i.final ?? 0), 0);
  const gaps = sold.map((i) => (i.final != null && refOf(i) ? (i.final - refOf(i)!) / refOf(i)! : null)).filter((g): g is number => g != null);
  const avgGap = gaps.length ? Math.round((gaps.reduce((a, b) => a + b, 0) / gaps.length) * 100) : null;
  const row = (i: SoldItem) => {
    const ref = refOf(i);
    return h(
      'div',
      { class: `bid ${i.sold ? '' : 'unsold'}` },
      h(
        'div',
        { class: 'row' },
        rarityDot(i.rarity),
        h('a', { class: 'grow ellipsis', href: '#', title: 'Ouvrir l\'enchère', onclick: (e: Event) => (e.preventDefault(), openAuction(i.auctionId)) }, `${i.cardName}${i.shiny ? ' ✨' : ''}`),
        i.sold ? h('strong', { class: 'num' }, formatPrice(i.final)) : h('span', { class: 'pill st-lost' }, 'Invendue'),
      ),
      h('div', { class: 'row small muted' }, i.sold ? diffView(i.final, i.start, 'départ') : h('span', null, `départ ${formatPrice(i.start)}`), h('span', { class: 'grow' }), h('span', null, fmtDate(i.endedAt))),
      i.sold
        ? h(
            'div',
            { class: 'small muted' },
            diffView(i.final, ref, i.cardSales ? `carte (${i.cardSales} vente${i.cardSales > 1 ? 's' : ''})` : 'médiane rareté') ?? 'pas de prix de référence',
          )
        : null,
    );
  };
  return [
    h(
      'div',
      { class: 'row' },
      status,
      h('button', { title: 'Relire mes ventes terminées', onclick: (e: Event) => run(e.currentTarget as HTMLButtonElement) }, 'Actualiser'),
    ),
    all.length
      ? h(
          'div',
          { class: 'row small' },
          h('strong', { class: 'grow' }, `${sold.length} vendue(s) · ${formatPrice(total)} au total${avgGap != null ? ` · ${avgGap >= 0 ? '+' : ''}${avgGap} % vs réf.` : ''}`),
          h(
            'label',
            { class: 'muted' },
            h('input', {
              type: 'checkbox',
              checked: showUnsold,
              onchange: (e: Event) => {
                showUnsold = (e.target as HTMLInputElement).checked;
                render();
              },
            }),
            ` invendues (${all.length - sold.length})`,
          ),
        )
      : null,
    items.length ? h('div', { class: 'bids' }, items.map(row)) : h('p', { class: 'muted empty' }, store.salesCache ? 'Aucune vente terminée.' : 'Clique sur « Actualiser ».'),
  ];
}

async function openAuction(id: string): Promise<void> {
  const url = `${SITE_ORIGIN}/marketplace/${id}`;
  const tab = await siteTab();
  if (tab?.id != null) await ext.tabs.update(tab.id, { url });
  else await ext.tabs.create({ url });
}

/** Étiquetage automatique : activation, aperçu du plan et lancement sur l'onglet de la collection. */
/** Prix moyens par carte (cache du content script) : servent à l'étiquetage et au prix conseillé. */
let catalogPrices: Record<string, CatalogPriceEntry> | null = null;

/** Entrée du calcul des prix : le stockage, plus le vrai prix moyen des cartes lu via l'API. */
function pricingInput() {
  return { ...store, catalogPrice: catalogPriceOf(catalogPrices) };
}
let pricesState: 'idle' | 'loading' | 'done' | 'error' = 'idle';
let pricesError = '';

async function readCatalogPrices(): Promise<void> {
  try {
    catalogPrices = ((await ext.storage.local.get(CARD_PRICES_KEY))[CARD_PRICES_KEY] as Record<string, CatalogPriceEntry> | undefined) ?? null;
  } catch {
    catalogPrices = null;
  }
}

/** Charge (ou recharge avec `force`) les prix moyens de toute la collection, via l'onglet du site. */
async function loadCollectionPrices(force = false): Promise<void> {
  if (pricesState === 'loading' || !store.settings.apiRead || !(await siteTab())) return;
  pricesState = 'loading';
  render();
  const res = (await sendToTab({ type: 'api', op: 'collectionPrices', force })) as { ok: boolean; error?: string } | null;
  pricesState = res?.ok ? 'done' : 'error';
  pricesError = !res ? 'page non joignable : recharge l\'onglet' : res.error ?? '';
  await readCatalogPrices();
  render();
}

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
      h('div', { class: 'small muted' }, 'Range tes cartes dans l\'étiquette dont la plage de prix (plancher–plafond) contient leur prix propre (moyenne du site, ventes de la carte ou prix saisi).'),
    );
  }
  // Prix de toutes les cartes de la collection : chargés une fois à l'ouverture (puis bouton « Rafraîchir les prix »).
  if (pricesState === 'idle') void loadCollectionPrices();
  const extraPrice = catalogPriceOf(catalogPrices);
  const plan = planAutoTags(store, { removeOthers: store.settings.autoTagRemoveOthers, clearUnpriced: store.settings.autoTagClearUnpriced, extraPrice });
  const diag = diagnoseAutoTags(store, Date.now(), extraPrice);
  const pricesLine = h(
    'div',
    { class: 'small muted row' },
    h(
      'span',
      { class: 'grow' },
      pricesState === 'loading'
        ? 'Chargement des prix de ta collection…'
        : pricesState === 'error'
          ? `Prix non chargés (${pricesError}).`
          : !store.settings.apiRead
            ? 'Active la lecture via l\'API pour utiliser le prix moyen de chaque carte.'
            : `${diag.pricedCards} carte(s) avec un prix · ${diag.unpricedCards} sans prix (jamais vendues)`,
    ),
    store.settings.apiRead
      ? h('button', { class: 'small', disabled: pricesState === 'loading', title: 'Relit les ventes de toutes tes cartes', onclick: () => void loadCollectionPrices(true) }, '↻ Rafraîchir les prix')
      : null,
  );
  const status = h('div', { class: 'small muted' });
  const owned = collectionStatus('↻ Recharger mes cartes');
  const viaApi = store.settings.apiWrite;
  const start = async () => {
    if (!onCollection && !viaApi) {
      const url = SITE_ORIGIN + '/collection';
      if (activeTab?.id != null && activeTab.url?.startsWith(SITE_ORIGIN)) await ext.tabs.update(activeTab.id, { url });
      else await ext.tabs.create({ url });
      return closeUi();
    }
    // Le plan affiché (avec les prix moyens de chaque carte) est celui qui est appliqué.
    const res = (await sendToTab({ type: 'autoTag', plan })) as { ok: boolean; error?: string } | null;
    status.textContent = res?.ok ? 'Étiquetage lancé : suis la progression sur la page.' : res?.error ?? 'Page non joignable : recharge l\'onglet.';
    if (res?.ok) closeUi();
  };
  const why = () => {
    const d = diag;
    if (!d.cards) return 'Aucune carte connue : ouvre ta collection.';
    if (!d.rulesWithRange) return 'Aucune règle n\'a de plage de prix : renseigne un plancher et/ou un plafond dans les réglages (ex. « Mettre au Enchère » : 20 à 1000).';
    if (!d.pricedCards) return store.settings.apiRead ? 'Aucune carte n\'a encore de prix : patiente pendant le chargement, ou clique « Rafraîchir les prix ».' : 'Aucune carte n\'a de prix : active la lecture via l\'API (Réglages → Automatisations).';
    return `Les ${d.pricedCards} carte(s) au prix connu sont déjà dans la bonne étiquette.`;
  };
  return h(
    'div',
    { class: 'card autotag' },
    owned,
    pricesLine,
    h(
      'div',
      { class: 'row' },
      h('strong', { class: 'grow' }, `Étiquetage auto : ${plan.length} carte(s)`),
      plan.length ? h('button', { class: 'primary', onclick: start }, onCollection || viaApi ? 'Lancer' : 'Aller à la collection') : null,
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
              h(
                'li',
                null,
                c.target
                  ? `${c.cardName} (${formatPrice(c.base)}) → ${c.target}`
                  : `${c.cardName} (${c.base == null ? 'sans prix connu' : `${formatPrice(c.base)}, hors plages`})`,
                c.remove.length ? h('span', { class: 'muted' }, ` · retire ${c.remove.join(', ')}`) : null,
              ),
            ),
          ),
        )
      : h('div', { class: 'small muted' }, why()),
    h(
      'label',
      { class: 'small muted row', title: 'Défait les classements faits sans prix propre (par ex. à partir de la médiane de la rareté)' },
      h('input', {
        type: 'checkbox',
        checked: store.settings.autoTagClearUnpriced,
        onchange: (e: Event) => save({ settings: { ...store.settings, autoTagClearUnpriced: (e.target as HTMLInputElement).checked } }),
      }),
      'Retirer aussi les étiquettes de plage des cartes sans prix connu',
    ),
    h(
      'div',
      { class: 'small muted row' },
      h('span', { class: 'grow' }, viaApi ? 'Mode : API (écriture directe des étiquettes).' : 'Mode : interface (clics dans la fiche de chaque carte).'),
      viaApi
        ? null
        : h(
            'button',
            {
              class: 'small',
              title: 'Plus fiable : écrit les étiquettes comme le site, sans ouvrir les fiches',
              onclick: async () => {
                const ok = confirm(
                  'Étiquetage par l\'API\n\nL\'extension écrira directement les étiquettes dans la base du site (comme le site le fait quand tu en ajoutes une), avec ta session. Écritures limitées aux étiquettes ; les favoris sont revérifiés avant chaque écriture. Le risque vis-à-vis des règles reste le tien.\n\nActiver ?',
                );
                if (ok) await save({ settings: { ...store.settings, apiWrite: true, apiRead: true } });
              },
            },
            'Passer par l\'API…',
          ),
    ),
    status,
  );
}

function render(): void {
  const now = Date.now();
  const alloc = allocate(pricingInput(), now);
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
  const tabs: { id: PopupTab; label: string; hidden?: boolean; body: () => (Node | string | null)[] }[] = [
    {
      id: 'sell',
      label: `Vendre${sellCount ? ` (${sellCount})` : ''}`,
      body: () => [
        proposalTools(alloc.free),
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
    { id: 'bids', label: 'Mises', body: bidsBlock },
    { id: 'sold', label: 'Vendues', body: soldBlock },
    { id: 'cards', label: 'Cartes', body: cardsBlock },
    { id: 'tags', label: 'Étiquettes', body: () => [autoTagBlock(!!activeTab?.url?.startsWith(SITE_ORIGIN + '/collection'))] },
    {
      id: 'tools',
      label: 'Outils',
      hidden: true,
      body: () => [
        tools ?? h('p', { class: 'muted small' }, 'Ouvre WikiMasters pour relire la page ou exporter un diagnostic.'),
        h(
          'div',
          { class: 'tools row small' },
          h('button', { onclick: () => ext.tabs.create({ url: ext.runtime.getURL('journal.html') }) }, '📒 Journal'),
          h('button', { onclick: () => ext.runtime.openOptionsPage() }, '⚙️ Réglages'),
        ),
        h('p', { class: 'muted small' }, `Ventes relues : ${fmtDate(store.meta.lastAuctionsScan)} · collection : ${fmtDate(store.meta.lastCollectionScan)}`),
        priceStatus(),
      ],
    },
  ];
  const current = tabs.find((t) => t.id === currentTab) ?? tabs[0];

  // Un seul onglet, dans une fenêtre ou une page du site : le résumé est déjà dans la barre latérale.
  if (view) {
    mount(app, current.id === 'sell' ? warnings : null, h('section', { class: 'panel', role: 'tabpanel' }, current.body()));
    return;
  }

  mount(
    app,
    h(
      'header',
      { class: 'row' },
      h('img', { src: 'icons/icon-32.png', width: 20, height: 20, alt: '' }),
      h('h1', { class: 'grow' }, 'Wiki-Traders'),
      h(
        'button',
        { class: refreshing ? 'spin' : '', title: 'Actualiser mes ventes : Marché → onglet « Mes ventes »', disabled: refreshing, onclick: refreshSales },
        '🔄',
      ),
      h('button', { title: 'Journal', onclick: () => ext.tabs.create({ url: ext.runtime.getURL('journal.html') }) }, '📒'),
      h(
        'button',
        {
          title: 'Outils : relire la page, diagnostic…',
          class: current.id === 'tools' ? 'on' : '',
          onclick: () => {
            currentTab = current.id === 'tools' ? 'sell' : 'tools';
            localStorage.setItem('wiky-tab', currentTab);
            render();
          },
        },
        '🧰',
      ),
      tagStyleSwitch(),
      h('button', { title: 'Réglages', onclick: () => ext.runtime.openOptionsPage() }, '⚙️'),
    ),
    banner,
    refreshing ? h('div', { class: 'warn small' }, 'Actualisation : Marché → « Mes ventes »…') : null,
    warnings,
    h(
      'nav',
      { class: 'tabs', role: 'tablist' },
      tabs.filter((t) => !t.hidden).map((t) =>
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
              void refreshBidsOnOpen();
            },
          },
          t.label,
        ),
      ),
    ),
    current.id === 'tools' ? h('h2', { class: 'tools-title' }, '🧰 Outils') : null,
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

/** Bilan des prix : d'où viennent-ils, combien de ventes par rareté, dernier chargement. */
function priceStatus() {
  const now = Date.now();
  const ctx = makeContext(pricingInput(), now);
  const since = now - store.settings.windowDays * 86_400_000;
  const recent = store.priceObs.filter((o) => o.at >= since);
  const cards = Object.values(store.cards);
  const withSite = cards.filter((c) => c.sitePrice != null).length;
  const market = store.meta.lastMarketFetch;
  const status = h('span', { class: 'small muted grow' });
  const load = async (e: Event) => {
    const btn = e.currentTarget as HTMLButtonElement;
    if (!store.settings.apiRead) {
      status.textContent = 'Active la lecture via l\'API (onglet Mises) pour charger les ventes du marché.';
      return;
    }
    if (!(await siteTab())) {
      status.textContent = 'Ouvre un onglet WikiMasters.';
      return;
    }
    btn.disabled = true;
    status.textContent = 'Chargement…';
    const res = (await sendToTab({ type: 'api', op: 'marketSales' })) as { ok: boolean; error?: string; count?: number } | null;
    btn.disabled = false;
    status.textContent = !res ? 'Page non joignable : recharge l\'onglet.' : res.ok ? `${res.count} vente(s) chargée(s)` : res.error ?? 'Erreur';
  };
  const rows = (Object.keys(RARITIES) as Rarity[]).map((r) => {
    const sold = recent.filter((o) => o.type === 'sold' && o.rarity === r && !o.shiny).length;
    const listing = recent.filter((o) => o.type === 'listing' && o.rarity === r && !o.shiny).length;
    const ref = rarityBase(r, false, ctx);
    return h(
      'tr',
      null,
      h('td', null, rarityDot(r), ` ${RARITIES[r].label}`),
      h('td', { class: 'num' }, sold),
      h('td', { class: 'num' }, listing),
      h('td', { class: 'num' }, ref?.value != null ? `${formatPrice(ref.value)}${ref.source === 'estimate' ? '*' : ''}` : '—'),
    );
  });
  return h(
    'div',
    { class: 'card price-status' },
    h('strong', null, `Prix (${store.settings.windowDays} derniers jours)`),
    h('div', { class: 'small muted' }, `Cartes avec un prix moyen du site (« Moy. ») : ${withSite}/${cards.length}`),
    h(
      'div',
      { class: `small ${market?.error ? 'error' : 'muted'}` },
      market ? `Ventes du marché (API) : ${market.error ? `échec — ${market.error}` : `${market.count} chargée(s)`} · ${fmtDate(market.at)}` : 'Ventes du marché (API) : jamais chargées',
    ),
    h('table', { class: 'small' }, h('tr', null, ['Rareté', 'Ventes', 'En vente', 'Médiane'].map((t) => h('th', null, t))), rows),
    h('div', { class: 'small muted' }, '* estimation à partir des enchères en cours (moins de 5 ventes).'),
    h('div', { class: 'row' }, status, h('button', { onclick: load }, 'Charger les prix du marché')),
  );
}

/** Interrupteur sans texte : libellés ⇄ pastilles de couleur pour les étiquettes sur les cartes. */
function tagStyleSwitch() {
  const dots = store.settings.tagOverlayStyle === 'dot';
  return h(
    'button',
    {
      class: `tag-switch${dots ? ' on' : ''}`,
      role: 'switch',
      'aria-checked': String(dots),
      'aria-label': 'Style des étiquettes sur les cartes',
      title: dots
        ? 'Étiquettes sur les cartes : pastilles de couleur (cliquer pour afficher les libellés)'
        : 'Étiquettes sur les cartes : libellés (cliquer pour de simples pastilles de couleur)',
      disabled: !store.settings.showTagOverlay,
      onclick: () => save({ settings: { ...store.settings, tagOverlayStyle: dots ? 'label' : 'dot' } }),
    },
    h('span', { class: 'knob' }),
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
  void refreshBidsOnOpen();
  await readCatalogPrices();
  render();
  // Vrais prix moyens de la collection (prix conseillé de « Vendre ») : depuis le cache, complétés via l'onglet du site.
  if (store.settings.apiRead) void loadCollectionPrices();
  ext.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && CARD_PRICES_KEY in changes) void readCatalogPrices().then(render);
  });
  onStoreChange(['cards', 'myAuctions', 'priceObs', 'rules', 'settings', 'manualPrices', 'slotOverrides', 'ignoredSlots', 'meta', 'intent', 'bidsCache', 'salesCache', 'families', 'myFamilies', 'journal'], refresh);
  setInterval(render, 15_000);
  // Compte à rebours des mises (sans tout redessiner).
  setInterval(() => {
    const now = Date.now();
    for (const el of document.querySelectorAll<HTMLElement>('[data-ends]')) el.textContent = endText(Number(el.dataset.ends), now);
  }, 1000);
}

void main();
