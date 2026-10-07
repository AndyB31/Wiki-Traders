/**
 * Page « Familles » (/collection?wiky=families), dessinée directement dans le DOM du site (pas d'iframe) :
 *  - accueil : tuiles (mosaïque, progression, valeur, coût pour compléter), recherche, tri, création, import ;
 *  - détail : renommage sur place, couleur, export, suppression, filtres, tri, grille de cartes au format natif
 *    (rendu par lots de chaînes HTML, `content-visibility`, images paresseuses), ajout rapide (recherche au fil de
 *    la frappe, sélection multiple, Maj+clic), marché des manquantes (une requête par lot de 150 cartes).
 * Aucune requête au rendu : prix chargés une fois à l'ouverture (catalog.ts), tout le reste en mémoire.
 */
import { FAMILY_COLORS, decodeFamilyCode, encodeFamilyCode, familyStats, ownedCount, removeCards, sortCards, sortFamilies, type CardSort, type FamilySort, type FamilyStats } from '../../lib/families';
import { formatDuration, normalize } from '../../lib/text';
import type { CardFamily, CatalogCard, Rarity } from '../../lib/types';
import { activeAuctionsFor, cardPrices, displayPrice, knownPrice, searchCards, type ActiveAuction } from '../catalog';
import { nativeMount } from '../site-ui';
import { noticeToast } from '../toast';
import { FAMILY_UI_KEY, OPEN_EVENT, pickFamilyAndAdd } from './family-actions';
import { addToFamily, catalogFromOwned, commit, ensureImported, familyById, getFamilies, getFamiliesSignature, getOwned, getOwnedSignature, onFamiliesChange, reimportLegacy, syncFamilies, updateFamily } from './families-state';
import { RARITY_LIST, cardHtml, confirmDialog, el, ensureFamilyStyle, esc, icon, importCodeDialog, money, openColorPicker, plural, promptDialog, rarityColor, showCodeDialog } from './family-ui';
import { registerFeature, type FeatureContext } from './runtime';

type Filter = 'all' | 'owned' | 'missing';

interface UiState {
  familyId: string | null;
  homeSort: FamilySort;
  homeQuery: string;
  filter: Filter;
  rarity: Rarity | '';
  sort: CardSort;
  cardQuery: string;
  addOpen: boolean;
}

const DEFAULT_UI: UiState = { familyId: null, homeSort: 'recent', homeQuery: '', filter: 'all', rarity: '', sort: 'owned', cardQuery: '', addOpen: false };

function loadUi(): UiState {
  try {
    return { ...DEFAULT_UI, ...(JSON.parse(sessionStorage.getItem(FAMILY_UI_KEY) ?? '{}') as Partial<UiState>) };
  } catch {
    return { ...DEFAULT_UI };
  }
}

let ui: UiState = loadUi();

function saveUi(): void {
  try {
    sessionStorage.setItem(FAMILY_UI_KEY, JSON.stringify(ui));
  } catch {
    // Stockage de session indisponible : l'état n'est pas mémorisé.
  }
}

/** Grille : nombre de cartes posées d'un coup (le reste suit image par image, sans bloquer la page). */
const CHUNK = 160;

let ctx: FeatureContext | null = null;
let root: HTMLElement | null = null;
let shellKey = '';
const parts = new Map<string, HTMLElement>();
const partKeys = new Map<string, string>();
let pricesVersion = 0;
const pricesAsked = new Set<string>();
let gridToken = 0;
let add: AddPanel | null = null;
let market: { familyId: string; missingKey: string; at: number; data?: Map<string, ActiveAuction[]>; error?: string; loading?: boolean } | null = null;

const priceOf = (siteId: string, rarity?: Rarity | null): number | null => displayPrice(knownPrice(siteId), rarity);

// ---------------------------------------------------------------- point d'entrée

function render(c: FeatureContext): void {
  ctx = c;
  syncFamilies(c.families);
  void ensureImported();
  const mount = nativeMount('families');
  if (!mount) {
    if (root) teardown();
    return;
  }
  ensureFamilyStyle();
  if (!root || root.parentElement !== mount) {
    root = el('div', { class: 'wf' });
    mount.replaceChildren(root);
    root.addEventListener('click', onClick);
    root.addEventListener('input', onInput);
    root.addEventListener('change', onChange);
    shellKey = '';
  }
  draw();
}

function teardown(): void {
  root?.remove();
  root = null;
  shellKey = '';
  parts.clear();
  partKeys.clear();
  add?.destroy();
  add = null;
}

onFamiliesChange(() => {
  if (root) queueMicrotask(draw);
});
document.addEventListener(OPEN_EVENT, (e) => {
  ui.familyId = (e as CustomEvent<string | null>).detail;
  ui.addOpen = false;
  saveUi();
  if (root) draw();
});

function part(name: string, key: string, build: (node: HTMLElement) => void): void {
  const node = parts.get(name);
  if (!node || partKeys.get(name) === key) return;
  partKeys.set(name, key);
  build(node);
}

function shell(key: string, html: string): void {
  if (shellKey === key) return;
  shellKey = key;
  parts.clear();
  partKeys.clear();
  add?.destroy();
  add = null;
  root!.innerHTML = html;
  for (const node of root!.querySelectorAll<HTMLElement>('[data-part]')) parts.set(node.dataset.part!, node);
  for (const input of root!.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-in]')) {
    const v = ui[input.dataset.in as keyof UiState];
    if (typeof v === 'string') input.value = v;
  }
}

function draw(): void {
  if (!root || !ctx) return;
  const fam = familyById(ui.familyId);
  if (ui.familyId && !fam && getFamilies().length) {
    ui.familyId = null;
    saveUi();
  }
  if (fam) drawDetail(fam);
  else drawHome();
}

function askPrices(key: string, ids: string[]): void {
  if (!ctx?.apiRead || pricesAsked.has(key) || !ids.length) return;
  pricesAsked.add(key);
  void cardPrices(ids)
    .then(() => {
      pricesVersion++;
      draw();
    })
    .catch((e) => {
      pricesAsked.delete(key);
      console.warn('[Wiki-Traders] prix des familles', e);
    });
}

// ---------------------------------------------------------------- accueil

function drawHome(): void {
  shell(
    'home',
    `<div class="wf-bar">
      <label class="wf-search wf-grow">${icon('search', 15)}<input class="wf-input" type="search" data-in="homeQuery" placeholder="Rechercher une famille…" aria-label="Rechercher une famille"></label>
      <select class="wf-select" data-in="homeSort" aria-label="Trier les familles">
        <option value="recent">Modifiées récemment</option><option value="name">Nom</option><option value="progress">Progression</option><option value="size">Taille</option>
      </select>
      <button type="button" class="wf-btn" data-act="import-code" title="Importer une famille partagée (code F0. / F1.)">${icon('download', 15)}Importer un code</button>
      <button type="button" class="wf-btn" data-act="reimport" title="Récupère les familles enregistrées par une autre extension sur ce navigateur (fusion par nom, sans doublon)">${icon('refresh', 15)}Importer depuis une autre extension</button>
      <button type="button" class="wf-btn primary" data-act="new-family">${icon('plus', 15)}Nouvelle famille</button>
    </div>
    <div class="wf-muted wf-small" data-part="summary"></div>
    <div data-part="tiles"></div>`,
  );
  const families = getFamilies();
  const idx = getOwned(ctx!.cards);
  askPrices('home', families.flatMap((f) => f.cards.map((c) => c.siteId)));
  const key = [getFamiliesSignature(), getOwnedSignature(), pricesVersion, ui.homeQuery, ui.homeSort].join('§');
  const stats = new Map<string, FamilyStats>();
  const statsOf = (f: CardFamily) => {
    let s = stats.get(f.id);
    if (!s) stats.set(f.id, (s = familyStats(f, idx, priceOf)));
    return s;
  };
  part('summary', key, (node) => {
    const total = families.reduce((n, f) => n + f.cards.length, 0);
    const owned = families.reduce((n, f) => n + statsOf(f).owned, 0);
    node.textContent = families.length ? `${plural(families.length, 'famille')} · ${owned.toLocaleString('fr-FR')}/${total.toLocaleString('fr-FR')} cartes possédées${ctx!.apiRead ? '' : ' · prix moyens : active la lecture via l\'API (Réglages → Automatisations)'}` : '';
  });
  part('tiles', key, (node) => {
    const q = normalize(ui.homeQuery);
    const list = sortFamilies(families.filter((f) => !q || normalize(f.name).includes(q)), ui.homeSort, statsOf);
    if (!families.length) {
      node.innerHTML = `<div class="wf-empty"><p style="margin:0 0 12px">Aucune famille pour l'instant. Regroupe des cartes (une série, un thème, un pays…) et suis ta progression.</p>
        <button type="button" class="wf-btn primary" data-act="new-family">${icon('plus', 15)}Créer une famille</button></div>`;
      return;
    }
    if (!list.length) {
      node.innerHTML = '<div class="wf-empty">Aucune famille ne correspond.</div>';
      return;
    }
    node.innerHTML = `<div class="wf-tiles">${list.map((f) => tileHtml(f, statsOf(f))).join('')}</div>`;
  });
}

function coverImages(f: CardFamily): string[] {
  const cover = f.coverSiteId ? f.cards.find((c) => c.siteId === f.coverSiteId && c.imageUrl) : undefined;
  if (cover) return [cover.imageUrl!];
  const imgs: string[] = [];
  for (const c of f.cards) {
    if (c.imageUrl) imgs.push(c.imageUrl);
    if (imgs.length === 4) break;
  }
  return imgs.length === 4 ? imgs : imgs.slice(0, 1);
}

function tileHtml(f: CardFamily, s: FamilyStats): string {
  const imgs = coverImages(f);
  const cover = imgs.length
    ? imgs.map((src) => `<img src="${esc(src)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">`).join('')
    : `<div class="wf-noimg">${icon('folder', 34)}</div>`;
  const cost = s.missing === 0 ? '<b style="color:#4ade80">complète ✓</b>' : `<b>${s.costToComplete || !s.missingUnpriced ? `≈ ${money(s.costToComplete)}` : '—'}</b>${s.missingUnpriced && s.costToComplete ? ` <span title="${s.missingUnpriced} carte(s) sans prix connu">+${s.missingUnpriced}?</span>` : ''}`;
  return `<button type="button" class="wf-tile" data-act="open" data-fam="${esc(f.id)}" style="--wf-tile-color:${esc(f.color)}">
    <div class="wf-cover${imgs.length === 4 ? '' : ' one'}">${cover}</div>
    <div class="wf-tile-body">
      <div class="wf-tile-name"><span class="wf-dot" style="background:${esc(f.color)}"></span><span>${esc(f.name)}</span></div>
      <div class="wf-row"><span><b>${s.owned}</b>/${s.total} possédées</span><b>${s.pct}%</b></div>
      <div class="wf-progress"><i style="width:${s.pct}%;background:${esc(f.color)}"></i></div>
      <div class="wf-row"><span>Valeur <b>${s.valueOwned ? money(s.valueOwned) : '—'}</b></span><span>Compléter ${cost}</span></div>
    </div></button>`;
}

// ---------------------------------------------------------------- détail

function drawDetail(f: CardFamily): void {
  shell(
    `detail:${f.id}`,
    `<div class="wf-head">
      <button type="button" class="wf-btn ghost sm" data-act="home">${icon('back', 15)}Familles</button>
      <button type="button" class="wf-color" data-act="color" title="Couleur de la famille" aria-label="Couleur de la famille"></button>
      <input class="wf-name" data-name maxlength="120" aria-label="Nom de la famille (cliquer pour renommer)" title="Cliquer pour renommer">
      <span class="wf-grow"></span>
      <button type="button" class="wf-btn primary" data-act="toggle-add">${icon('plus', 15)}Ajouter des cartes</button>
      <button type="button" class="wf-btn" data-act="export" title="Code de partage (format F0. / F1., compatible avec une autre extension)">${icon('share', 15)}Exporter</button>
      <button type="button" class="wf-btn danger" data-act="delete">${icon('trash', 15)}Supprimer</button>
    </div>
    <div class="wf-stats" data-part="stats"></div>
    <div data-part="add"></div>
    <details class="wf-panel" data-part="market"><summary>${icon('cart', 16)}<span>Marché des manquantes</span><span class="wf-muted wf-small" data-part="marketHint"></span></summary><div data-part="marketBody"></div></details>
    <div class="wf-bar">
      <div class="wf-bar" data-part="chips" role="tablist" aria-label="Filtrer les cartes"></div>
      <span class="wf-grow"></span>
      <label class="wf-search">${icon('search', 15)}<input class="wf-input" type="search" data-in="cardQuery" placeholder="Filtrer les cartes…" aria-label="Filtrer les cartes de la famille"></label>
      <select class="wf-select" data-in="rarity" aria-label="Rareté"><option value="">Toutes raretés</option>${RARITY_LIST.map((r) => `<option value="${r}">${r}</option>`).join('')}</select>
      <select class="wf-select" data-in="sort" aria-label="Trier les cartes"><option value="owned">Possédées d'abord</option><option value="name">Nom</option><option value="rarity">Rareté</option><option value="price">Prix</option></select>
    </div>
    <div data-part="grid"></div>`,
  );
  const idx = getOwned(ctx!.cards);
  askPrices(`fam:${f.id}:${f.cards.length}`, f.cards.map((c) => c.siteId));

  const name = root!.querySelector<HTMLInputElement>('[data-name]')!;
  if (document.activeElement !== name && name.value !== f.name) name.value = f.name;
  const color = root!.querySelector<HTMLElement>('.wf-color')!;
  color.style.background = f.color;
  root!.querySelector('[data-act="toggle-add"]')!.classList.toggle('primary', !ui.addOpen);

  const s = familyStats(f, idx, priceOf);
  const famKey = [f.id, f.updatedAt, f.cards.length, f.coverSiteId, getOwnedSignature(), pricesVersion].join('§');
  part('stats', famKey, (node) => {
    const unpriced = s.missingUnpriced ? `<em>${plural(s.missingUnpriced, 'manquante')} sans prix connu</em>` : '<em>prix moyens des ventes conclues</em>';
    node.innerHTML = `<div class="wf-stat"><small>Progression</small><b>${s.owned}/${s.total} <span class="wf-muted" style="font-size:13px">· ${s.pct}%</span></b><div class="wf-progress" style="margin-top:6px"><i style="width:${s.pct}%;background:${esc(f.color)}"></i></div></div>
      <div class="wf-stat"><small>Valeur possédée</small><b>${ctx!.apiRead ? money(s.valueOwned) : '—'}</b><em>${plural(s.owned, 'carte')}</em></div>
      <div class="wf-stat"><small>Coût pour compléter</small><b>${s.missing ? (ctx!.apiRead ? `≈ ${money(s.costToComplete)}` : '—') : '<span style="color:#4ade80">complète ✓</span>'}</b>${s.missing ? unpriced : ''}</div>
      <div class="wf-stat"><small>Manquantes</small><b>${s.missing}</b><em>${ctx!.apiRead ? 'voir « Marché des manquantes »' : 'lecture via l\'API désactivée'}</em></div>`;
  });

  // Panneau d'ajout : construit une fois par famille ouverte, jamais redessiné pendant la frappe.
  const addHost = parts.get('add')!;
  if (ui.addOpen && !add) {
    add = new AddPanel(f.id);
    addHost.append(add.node);
    add.focus();
  } else if (!ui.addOpen && add) {
    add.destroy();
    add = null;
  }
  add?.refresh();

  const missing = f.cards.filter((c) => ownedCount(c, idx) === 0);
  part('marketHint', `${missing.length}`, (node) => (node.textContent = missing.length ? `· ${plural(missing.length, 'carte manquante', 'cartes manquantes')}` : '· rien ne manque'));
  const marketBox = parts.get('market') as HTMLDetailsElement;
  if (!marketBox.dataset.bound) {
    marketBox.dataset.bound = '1';
    marketBox.addEventListener('toggle', () => {
      if (marketBox.open) draw();
    });
  }
  if (marketBox.open) drawMarket(f, missing);

  const counts = { all: f.cards.length, owned: s.owned, missing: s.missing };
  part('chips', `${counts.all}:${counts.owned}:${ui.filter}`, (node) => {
    const chip = (k: Filter, label: string) => `<button type="button" role="tab" aria-selected="${ui.filter === k}" class="wf-chip${ui.filter === k ? ' on' : ''}" data-act="filter" data-filter="${k}">${label}<b>${counts[k]}</b></button>`;
    node.innerHTML = chip('all', 'Toutes') + chip('owned', 'Possédées') + chip('missing', 'Manquantes');
  });

  part('grid', [famKey, ui.filter, ui.rarity, ui.sort, ui.cardQuery].join('§'), (node) => drawGrid(node, f));
}

function visibleCards(f: CardFamily): CatalogCard[] {
  const idx = getOwned(ctx!.cards);
  const q = normalize(ui.cardQuery);
  const list = f.cards.filter((c) => {
    if (ui.rarity && c.rarity !== ui.rarity) return false;
    if (ui.filter !== 'all' && (ownedCount(c, idx) > 0) !== (ui.filter === 'owned')) return false;
    return !q || normalize(`${c.title} ${c.category ?? ''}`).includes(q);
  });
  return sortCards(list, ui.sort, (c) => ownedCount(c, idx), priceOf);
}

/** Grille : premières cartes tout de suite, la suite par lots à chaque image (pas de gel avec 500+ cartes). */
function drawGrid(node: HTMLElement, f: CardFamily): void {
  const token = ++gridToken;
  const idx = getOwned(ctx!.cards);
  const list = visibleCards(f);
  if (!f.cards.length) {
    node.innerHTML = `<div class="wf-empty"><p style="margin:0 0 12px">Cette famille est vide.</p><button type="button" class="wf-btn primary" data-act="toggle-add">${icon('plus', 15)}Ajouter des cartes</button></div>`;
    return;
  }
  if (!list.length) {
    node.innerHTML = '<div class="wf-empty">Aucune carte ne correspond aux filtres.</div>';
    return;
  }
  const actions = [
    { act: 'cover', title: 'Mettre en couverture', icon: 'star' },
    { act: 'copy-to', title: 'Ajouter à une autre famille', icon: 'folderPlus' },
    { act: 'remove', title: 'Retirer de la famille', icon: 'x', danger: true },
  ];
  const html = (from: number, to: number) => list.slice(from, to).map((c) => cardHtml({ card: c, owned: ownedCount(c, idx), price: priceOf(c.siteId, c.rarity), cover: c.siteId === f.coverSiteId, actions })).join('');
  const grid = el('div', { class: 'wf-grid' });
  grid.innerHTML = html(0, CHUNK);
  node.replaceChildren(grid);
  let at = CHUNK;
  const step = () => {
    if (token !== gridToken || at >= list.length) return;
    grid.insertAdjacentHTML('beforeend', html(at, at + CHUNK));
    at += CHUNK;
    requestAnimationFrame(step);
  };
  if (at < list.length) requestAnimationFrame(step);
}

// ---------------------------------------------------------------- marché des manquantes

function drawMarket(f: CardFamily, missing: CatalogCard[]): void {
  const missingKey = missing.map((c) => c.siteId).join(',');
  if (!ctx!.apiRead) {
    part('marketBody', 'noapi', (n) => (n.innerHTML = '<p class="wf-muted" style="margin:0">Le marché utilise la lecture via l\'API (Réglages → Automatisations).</p>'));
    return;
  }
  if (!missing.length) {
    part('marketBody', 'none', (n) => (n.innerHTML = '<p class="wf-muted" style="margin:0">Il ne manque aucune carte 🎉</p>'));
    return;
  }
  const stale = !market || market.familyId !== f.id || market.missingKey !== missingKey || (!market.loading && Date.now() - market.at > 120_000);
  if (stale) {
    const job = { familyId: f.id, missingKey, at: Date.now(), loading: true } as NonNullable<typeof market>;
    market = job;
    void activeAuctionsFor(missing.map((c) => c.siteId))
      .then((data) => (job.data = data))
      .catch((e) => (job.error = (e as Error).message))
      .finally(() => {
        job.loading = false;
        job.at = Date.now();
        if (market === job) draw();
      });
  }
  const m = market!;
  part('marketBody', `${m.familyId}:${m.missingKey}:${m.at}:${m.loading}:${pricesVersion}`, (n) => {
    if (m.loading) {
      n.innerHTML = `<p class="wf-muted" style="margin:0">Recherche des enchères en cours pour ${plural(missing.length, 'carte manquante', 'cartes manquantes')}…</p>`;
      return;
    }
    if (m.error) {
      n.innerHTML = `<p style="margin:0;color:#f87171">Marché indisponible : ${esc(m.error)}</p>`;
      return;
    }
    const now = Date.now();
    const rows = missing
      .map((c) => ({ c, offers: m.data?.get(c.siteId) ?? [] }))
      .filter((r) => r.offers.length)
      .sort((a, b) => a.offers[0].price - b.offers[0].price);
    const cheapest = rows.reduce((t, r) => t + r.offers[0].price, 0);
    const head = `<div class="wf-bar wf-small" style="margin-bottom:4px"><span><b>${rows.length}</b>/${missing.length} manquantes en vente${rows.length ? ` · toutes au moins cher <b>≈ ${money(cheapest)}</b>` : ''}</span><span class="wf-grow"></span><button type="button" class="wf-btn sm ghost" data-act="market-refresh">${icon('refresh', 13)}Actualiser</button></div>`;
    if (!rows.length) {
      n.innerHTML = `${head}<p class="wf-muted" style="margin:0">Aucune des cartes manquantes n'est en vente en ce moment.</p>`;
      return;
    }
    n.innerHTML = head + `<div class="wf-market">${rows
      .map(({ c, offers }) => {
        const p = priceOf(c.siteId, c.rarity);
        const thumb = c.imageUrl ? `<img src="${esc(c.imageUrl)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">` : '<span class="wf-thumb"></span>';
        const links = offers
          .slice(0, 4)
          .map((o) => `<a class="wf-offer" href="/marketplace/${encodeURIComponent(o.id)}" title="${o.hasBid ? 'Mise en cours' : 'Prix de départ'}${o.shiny ? ' · brillante' : ''}">${money(o.price)}${o.shiny ? ' ✨' : ''}<small>${o.endsAt ? formatDuration(o.endsAt - now) : ''}</small></a>`)
          .join('');
        return `<div class="wf-mrow">${thumb}<div style="min-width:0"><div style="display:flex;align-items:center;gap:6px;min-width:0"><span class="wf-tag" style="background:${rarityColor(c.rarity)}">${c.rarity ?? '?'}</span><b style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(c.title)}</b></div><span class="wf-muted wf-small">${plural(offers.length, 'enchère')}${p != null ? ` · moyenne ≈ ${money(p)}` : ''}</span></div><div class="wf-offers">${links}${offers.length > 4 ? `<span class="wf-muted wf-small">+${offers.length - 4}</span>` : ''}</div></div>`;
      })
      .join('')}</div>`;
  });
}

// ---------------------------------------------------------------- panneau « Ajouter des cartes »

class AddPanel {
  readonly node: HTMLElement;
  private input: HTMLInputElement;
  private rarity: HTMLSelectElement;
  private hideIn: HTMLInputElement;
  private list: HTMLElement;
  private status: HTMLElement;
  private addBtn: HTMLButtonElement;
  private results: CatalogCard[] = [];
  private hasMore = false;
  private loading = false;
  private token = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private observer: IntersectionObserver | null = null;
  private lastIndex: number | null = null;
  readonly selected = new Map<string, CatalogCard>();

  constructor(private familyId: string) {
    this.node = el('div', { class: 'wf-panel wf-add' });
    this.node.innerHTML = `<div class="wf-bar">
        <label class="wf-search wf-grow">${icon('search', 15)}<input class="wf-input" type="search" placeholder="Rechercher une carte (titre ou catégorie)…" aria-label="Rechercher une carte dans le catalogue" autocomplete="off"></label>
        <select class="wf-select" aria-label="Rareté"><option value="">Toutes raretés</option>${RARITY_LIST.map((r) => `<option value="${r}">${r}</option>`).join('')}</select>
        <label class="wf-small wf-muted" style="display:inline-flex;align-items:center;gap:6px;cursor:pointer"><input type="checkbox" checked style="accent-color:#f97316">Masquer celles déjà dans la famille</label>
      </div>
      <div class="wf-bar">
        <span class="wf-muted wf-small" data-status></span><span class="wf-grow"></span>
        <button type="button" class="wf-btn sm" data-add="mine" title="Ajoute toutes les cartes de ma collection dont la catégorie contient le texte recherché">Mes cartes de cette catégorie</button>
        <button type="button" class="wf-btn sm" data-add="all">Tout sélectionner</button>
        <button type="button" class="wf-btn sm ghost" data-add="none">Vider la sélection</button>
        <button type="button" class="wf-btn sm primary" data-add="go" disabled>Ajouter</button>
      </div>
      <div class="wf-results" role="listbox" aria-multiselectable="true"></div>`;
    this.input = this.node.querySelector('input[type="search"]')!;
    this.rarity = this.node.querySelector('select')!;
    this.hideIn = this.node.querySelector('input[type="checkbox"]')!;
    this.list = this.node.querySelector('.wf-results')!;
    this.status = this.node.querySelector('[data-status]')!;
    this.addBtn = this.node.querySelector('[data-add="go"]')!;
    // Événements gérés ici (pas par la page) : arrêtés au panneau.
    for (const type of ['click', 'input', 'change']) this.node.addEventListener(type, (e) => e.stopPropagation());
    this.input.addEventListener('input', () => this.schedule());
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.search();
    });
    this.rarity.addEventListener('change', () => this.search());
    this.hideIn.addEventListener('change', () => this.drawResults());
    this.node.addEventListener('click', (e) => this.onClick(e as MouseEvent));
    this.updateStatus();
  }

  focus(): void {
    setTimeout(() => this.input.focus());
  }

  destroy(): void {
    clearTimeout(this.timer);
    this.token++;
    this.observer?.disconnect();
    this.node.remove();
  }

  private family(): CardFamily | undefined {
    return familyById(this.familyId);
  }

  /** La famille a changé (ajout, retrait) : met à jour l'état « déjà dans la famille ». */
  refresh(): void {
    const key = `${this.family()?.updatedAt}`;
    if (this.node.dataset.key === key) return;
    this.node.dataset.key = key;
    if (this.results.length) this.drawResults();
  }

  private schedule(): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.search(), 200);
  }

  private async search(more = false): Promise<void> {
    clearTimeout(this.timer);
    const q = this.input.value.trim();
    const rarity = (this.rarity.value || null) as Rarity | null;
    if (!more) {
      this.token++;
      this.results = [];
      this.hasMore = false;
      this.lastIndex = null;
    }
    if (q.length < 2 && !rarity) {
      this.loading = false;
      this.drawResults();
      return;
    }
    if (!ctx?.apiRead) {
      this.status.textContent = 'La recherche dans le catalogue utilise la lecture via l\'API (Réglages → Automatisations).';
      return;
    }
    const token = this.token;
    this.loading = true;
    this.updateStatus();
    try {
      const res = await searchCards(q, { offset: this.results.length, limit: 60, rarity });
      // Réponse d'une recherche dépassée (on a tapé entre-temps) : ignorée.
      if (token !== this.token) return;
      const seen = new Set(this.results.map((c) => c.siteId));
      this.results.push(...res.cards.filter((c) => !seen.has(c.siteId)));
      this.hasMore = res.hasMore;
      this.loading = false;
      if (more) this.appendResults(seen.size);
      else this.drawResults();
    } catch (e) {
      if (token !== this.token) return;
      this.loading = false;
      this.status.textContent = `Recherche impossible : ${(e as Error).message}`;
    }
  }

  private inFamily(): Set<string> {
    return new Set(this.family()?.cards.map((c) => c.siteId) ?? []);
  }

  private shown(): CatalogCard[] {
    if (!this.hideIn.checked) return this.results;
    const have = this.inFamily();
    return this.results.filter((c) => !have.has(c.siteId));
  }

  private rowHtml(c: CatalogCard, i: number, have: Set<string>): string {
    const owned = ownedCount(c, getOwned(ctx!.cards));
    const isIn = have.has(c.siteId);
    const sel = this.selected.has(c.siteId);
    const thumb = c.imageUrl ? `<img src="${esc(c.imageUrl)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">` : '<span class="wf-thumb"></span>';
    return `<div class="wf-res${sel ? ' sel' : ''}${isIn ? ' in' : ''}" role="option" aria-selected="${sel}" data-i="${i}" data-id="${esc(c.siteId)}" title="${isIn ? 'Déjà dans la famille' : 'Clic : sélectionner · Maj+clic : sélectionner une plage'}">
      <input type="checkbox" tabindex="-1"${sel || isIn ? ' checked' : ''}${isIn ? ' disabled' : ''}>${thumb}
      <span class="wf-res-main"><b>${esc(c.title)}</b><span>${esc(c.category ?? '')}</span></span>
      ${owned ? `<span class="wf-owned-tag" title="Dans ma collection">✓${owned > 1 ? `×${owned}` : ''}</span>` : ''}
      <span class="wf-tag" style="background:${rarityColor(c.rarity)}">${c.rarity ?? '?'}</span></div>`;
  }

  private drawResults(): void {
    const have = this.inFamily();
    const list = this.shown();
    this.list.innerHTML = list.map((c, i) => this.rowHtml(c, i, have)).join('') + '<div class="wf-sentinel"></div>';
    this.watchSentinel();
    this.updateStatus();
  }

  private appendResults(from: number): void {
    const have = this.inFamily();
    const list = this.shown();
    this.list.querySelector('.wf-sentinel')?.remove();
    const start = this.hideIn.checked ? list.findIndex((c) => !this.results.slice(0, from).includes(c)) : from;
    const begin = start < 0 ? list.length : start;
    this.list.insertAdjacentHTML('beforeend', list.slice(begin).map((c, i) => this.rowHtml(c, begin + i, have)).join('') + '<div class="wf-sentinel"></div>');
    this.watchSentinel();
    this.updateStatus();
  }

  /** Défilement infini : la suite des résultats se charge quand le bas de la liste apparaît. */
  private watchSentinel(): void {
    this.observer?.disconnect();
    const sentinel = this.list.querySelector('.wf-sentinel');
    if (!sentinel || !this.hasMore || typeof IntersectionObserver !== 'function') return;
    this.observer = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting) && this.hasMore && !this.loading) void this.search(true);
    }, { root: this.list, rootMargin: '200px' });
    this.observer.observe(sentinel);
  }

  private updateStatus(): void {
    const n = this.selected.size;
    this.addBtn.disabled = !n;
    this.addBtn.textContent = n ? `Ajouter ${plural(n, 'carte')}` : 'Ajouter';
    const q = this.input.value.trim();
    let text: string;
    if (!ctx?.apiRead) text = 'Recherche dans le catalogue : active la lecture via l\'API (Réglages → Automatisations). « Mes cartes de cette catégorie » fonctionne sans.';
    else if (this.loading && !this.results.length) text = 'Recherche…';
    else if (q.length < 2 && !this.rarity.value) text = 'Tape au moins 2 lettres : titre ou catégorie (ex. « roi de France »).';
    else if (!this.results.length) text = 'Aucune carte trouvée.';
    else text = `${plural(this.results.length, 'résultat')}${this.hasMore ? '+' : ''}${this.loading ? ' · chargement…' : ''}`;
    this.status.textContent = n ? `${text} · ${plural(n, 'sélectionnée', 'sélectionnées')}` : text;
  }

  private toggleRow(row: HTMLElement, on: boolean): void {
    const c = this.shown()[Number(row.dataset.i)];
    if (!c || row.classList.contains('in')) return;
    if (on) this.selected.set(c.siteId, c);
    else this.selected.delete(c.siteId);
    row.classList.toggle('sel', on);
    row.setAttribute('aria-selected', String(on));
    row.querySelector('input')!.checked = on;
  }

  private onClick(e: MouseEvent): void {
    const target = e.target as Element;
    const action = target.closest<HTMLElement>('[data-add]')?.dataset.add;
    if (action === 'go') return void this.addSelected();
    if (action === 'mine') return void this.addMineOfCategory();
    if (action === 'all' || action === 'none') {
      for (const row of this.list.querySelectorAll<HTMLElement>('.wf-res')) this.toggleRow(row, action === 'all');
      if (action === 'none') this.selected.clear();
      return this.updateStatus();
    }
    const row = target.closest<HTMLElement>('.wf-res');
    if (!row || row.classList.contains('in')) return;
    const i = Number(row.dataset.i);
    const on = !row.classList.contains('sel');
    if (e.shiftKey && this.lastIndex != null) {
      // Maj+clic : toute la plage prend l'état de la carte cliquée.
      const [a, b] = [Math.min(this.lastIndex, i), Math.max(this.lastIndex, i)];
      for (const r of this.list.querySelectorAll<HTMLElement>('.wf-res')) {
        const k = Number(r.dataset.i);
        if (k >= a && k <= b) this.toggleRow(r, on);
      }
      getSelection()?.removeAllRanges();
    } else this.toggleRow(row, on);
    this.lastIndex = i;
    this.updateStatus();
  }

  private async addSelected(): Promise<void> {
    const f = this.family();
    if (!f || !this.selected.size) return;
    const cards = [...this.selected.values()];
    const { added } = await addToFamily(f, cards);
    this.selected.clear();
    this.lastIndex = null;
    noticeToast(`${plural(added, 'carte ajoutée', 'cartes ajoutées')} à « ${f.name} »`);
    pricesAsked.delete(`fam:${f.id}:${f.cards.length}`);
    this.drawResults();
  }

  /** Toutes mes cartes dont la catégorie contient le texte recherché (et de la rareté choisie). */
  private async addMineOfCategory(): Promise<void> {
    const f = this.family();
    const q = normalize(this.input.value);
    if (!f || !ctx) return;
    if (q.length < 2) {
      this.status.textContent = 'Tape d\'abord une catégorie (ex. « footballeur »), puis « Mes cartes de cette catégorie ».';
      this.input.focus();
      return;
    }
    const rarity = this.rarity.value;
    const mine = Object.values(ctx.cards).filter((c) => c.quantity > 0 && normalize(c.category ?? '').includes(q) && (!rarity || c.rarity === rarity));
    if (!mine.length) {
      this.status.textContent = `Aucune carte de ma collection dans la catégorie « ${this.input.value.trim()} ».`;
      return;
    }
    const have = this.inFamily();
    const todo = mine.filter((c) => !c.siteId || !have.has(c.siteId));
    if (!todo.length) {
      this.status.textContent = 'Toutes ces cartes sont déjà dans la famille.';
      return;
    }
    if (todo.length > 30 && !(await confirmDialog('Ajouter mes cartes', `Ajouter ${plural(todo.length, 'carte')} de ta collection (catégorie « ${this.input.value.trim()} ») à « ${f.name} » ?`, { ok: 'Ajouter' }))) return;
    const { cards, unresolved } = await catalogFromOwned(todo, ctx.apiRead);
    const { added } = await addToFamily(f, cards);
    noticeToast(`${plural(added, 'carte ajoutée', 'cartes ajoutées')} à « ${f.name} »${unresolved.length ? `\n${plural(unresolved.length, 'carte non reconnue', 'cartes non reconnues')} (identifiant inconnu)` : ''}`);
    this.drawResults();
  }
}

// ---------------------------------------------------------------- événements de la page

function onInput(e: Event): void {
  const t = e.target as HTMLInputElement;
  const k = t.dataset.in as keyof UiState | undefined;
  if (!k) return;
  (ui as unknown as Record<string, string>)[k] = t.value;
  saveUi();
  draw();
}

function onChange(e: Event): void {
  const t = e.target as HTMLInputElement;
  if (t.matches('[data-name]')) void rename(t);
  else onInput(e);
}

async function rename(input: HTMLInputElement): Promise<void> {
  const f = familyById(ui.familyId);
  const name = input.value.trim();
  if (!f) return;
  if (!name) {
    input.value = f.name;
    return;
  }
  if (name !== f.name) await updateFamily(f.id, (x) => ({ ...x, name, updatedAt: Date.now() }));
}

function onKeydown(e: KeyboardEvent): void {
  const t = e.target as HTMLInputElement;
  if (!t.matches?.('[data-name]')) return;
  if (e.key === 'Enter') t.blur();
  if (e.key === 'Escape') {
    t.value = familyById(ui.familyId)?.name ?? t.value;
    t.blur();
  }
}
document.addEventListener('keydown', (e) => {
  if (root?.contains(e.target as Node)) onKeydown(e);
});

function openFamily(id: string | null, addOpen = false): void {
  ui.familyId = id;
  ui.addOpen = addOpen;
  ui.cardQuery = '';
  saveUi();
  draw();
  root?.closest('#wiky-page')?.scrollIntoView?.({ block: 'start' });
}

async function onClick(e: Event): Promise<void> {
  const btn = (e.target as Element).closest<HTMLElement>('[data-act]');
  if (!btn || !root?.contains(btn)) return;
  const act = btn.dataset.act;
  const f = familyById(ui.familyId);
  const cardId = btn.closest<HTMLElement>('.wf-card')?.dataset.id;
  switch (act) {
    case 'open':
      return openFamily(btn.dataset.fam ?? null);
    case 'home':
      return openFamily(null);
    case 'new-family': {
      const name = await promptDialog('Nouvelle famille', { placeholder: 'Nom de la famille (ex. Rois de France)', ok: 'Créer' });
      if (!name) return;
      const { family } = await addToFamily(name, []);
      // Une famille neuve s'ouvre directement sur l'ajout de cartes.
      return openFamily(family.id, true);
    }
    case 'import-code':
      return importCodeDialog(async (code) => {
        const fam = await decodeFamilyCode(code, getFamilies());
        const same = getFamilies().find((x) => normalize(x.name) === normalize(fam.name));
        if (same) {
          const { added } = await addToFamily(same, fam.cards);
          noticeToast(`« ${same.name} » existait déjà : ${plural(added, 'carte ajoutée', 'cartes ajoutées')}.`);
          openFamily(same.id);
        } else {
          await commit([...getFamilies(), fam]);
          noticeToast(`Famille « ${fam.name} » importée (${plural(fam.cards.length, 'carte')}).`);
          openFamily(fam.id);
        }
        return fam.name;
      });
    case 'reimport': {
      const r = await reimportLegacy();
      noticeToast(r.found
        ? `${plural(r.found, 'famille trouvée', 'familles trouvées')} : ${plural(r.created, 'nouvelle', 'nouvelles')}, ${plural(r.cardsAdded, 'carte ajoutée', 'cartes ajoutées')}.`
        : 'Aucune famille d\'une autre extension sur ce navigateur.', { error: !r.found });
      return;
    }
    case 'toggle-add':
      ui.addOpen = !ui.addOpen;
      saveUi();
      return draw();
    case 'filter':
      ui.filter = (btn.dataset.filter as Filter) ?? 'all';
      saveUi();
      return draw();
    case 'market-refresh':
      if (market) market.at = 0;
      return draw();
  }
  if (!f) return;
  switch (act) {
    case 'color':
      return openColorPicker(btn, FAMILY_COLORS, f.color, (color) => void updateFamily(f.id, (x) => ({ ...x, color, updatedAt: Date.now() })));
    case 'export': {
      const code = await encodeFamilyCode(f);
      return showCodeDialog(`Exporter « ${f.name} »`, code, `${plural(f.cards.length, 'carte')}. Ce code s'importe dans Wiki-Traders (ou une autre extension qui lit les codes F0. / F1.).`);
    }
    case 'delete':
      if (await confirmDialog('Supprimer la famille', `Supprimer « ${f.name} » (${plural(f.cards.length, 'carte')}) ? Tes cartes ne sont pas touchées.`, { ok: 'Supprimer', danger: true })) {
        await commit(getFamilies().filter((x) => x.id !== f.id));
        noticeToast(`Famille « ${f.name} » supprimée.`, { action: { label: 'Annuler', onClick: () => void commit([...getFamilies(), f]) } });
        openFamily(null);
      }
      return;
    case 'cover':
      if (cardId) await updateFamily(f.id, (x) => ({ ...x, coverSiteId: x.coverSiteId === cardId ? null : cardId, updatedAt: Date.now() }));
      return;
    case 'remove':
      if (!cardId) return;
      await updateFamily(f.id, (x) => removeCards(x, [cardId]));
      noticeToast(`« ${f.cards.find((c) => c.siteId === cardId)?.title ?? 'Carte'} » retirée de « ${f.name} ».`, {
        action: { label: 'Annuler', onClick: () => void updateFamily(f.id, (x) => ({ ...f, name: x.name, color: x.color, updatedAt: Date.now() })) },
      });
      return;
    case 'copy-to': {
      const card = f.cards.find((c) => c.siteId === cardId);
      if (card) pickFamilyAndAdd(btn, [card], { exclude: f.id });
      return;
    }
  }
}

registerFeature({
  keys: ['families'],
  render,
  cleanup: teardown,
});

/** Pour les tests. */
export function resetFamiliesPage(): void {
  teardown();
  ui = loadUi();
  pricesAsked.clear();
  market = null;
  ctx = null;
}
