/**
 * Page d'une vue de la collection (/collection?wview=<id>), réglage « page Wiki-Traders » (par défaut) :
 * dessinée directement dans le DOM du site, comme la page Familles, depuis toute ma collection connue (relevée
 * par l'API). La collection du site reste en place, masquée, et ses champs ne sont pas touchés : le filtre ne
 * dépend ni de sa pagination ni de ce que d'autres extensions font de ses cartes.
 *  - filtre et tri de la vue (lib/views.ts), affinés sur place : recherche, étiquette, raretés, tri ;
 *  - cartes au format natif, par pages de 120 (« Afficher plus », ou en arrivant en bas) ;
 *  - prix et images chargés par lots (catalog.ts), une fois par jeu de cartes ;
 *  - clic sur une carte : la collection du site, recherche remplie avec son nom (fiche, vente, étiquettes) ;
 *    bouton « Ajouter à une famille ».
 */
import { normalize, RARITIES } from '../../lib/text';
import type { Card, CatalogCard, Rarity } from '../../lib/types';
import { applyView, EMPTY_VIEW_FILTER, matchesView, VIEW_SORTS, viewSummary, type CollectionView, type ViewSortKey } from '../../lib/views';
import { cardPrices, cardsByIds, knownCard, knownPrice } from '../catalog';
import { setSearch, siteControlsReady } from '../collection-controls';
import { nativeMount } from '../site-ui';
import { currentView, goToView, viewContext } from './collection-views';
import { ensureStyle } from './dom';
import { pickFamilyAndAdd } from './family-actions';
import { RARITY_LIST, cardHtml, el, ensureFamilyStyle, esc, icon, money, plural } from './family-ui';
import { registerFeature, type FeatureContext } from './runtime';

/** Cartes posées par « page » (le reste suit avec « Afficher plus »). */
const PAGE = 120;
/** Option « Sans étiquette » du filtre d'étiquette (les autres valent `t:<nom>`). */
const NONE = 'none';
const TAG = 't:';
/** Recherche à remplir dans la collection du site après « Voir dans la collection ». */
const SITE_SEARCH_KEY = 'wiky-view-site-search';
/** Tris possibles sur cette page (la date d'ajout n'est connue que du site). */
const SORTS = VIEW_SORTS.filter((s) => s.key !== 'added');

const CSS = `
.wv-grid .wf-card { cursor: pointer; }
.wv-info { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 14px; }
.wv-info .wv-sum { flex: 1 1 260px; min-width: 0; }
.wv-info b { color: var(--wf-fg); font-variant-numeric: tabular-nums; }
.wv-info a { color: #fdba74; text-decoration: none; font-weight: 600; }
.wv-info a:hover { text-decoration: underline; }
.wv-chip.on { border-color: var(--wv-c); color: var(--wf-fg); background: color-mix(in srgb, var(--wv-c) 22%, transparent); }
`;

/** Ce qui est affiné sur la page, en plus de la vue (remis à zéro en changeant de vue). */
interface Refine {
  q: string;
  /** '' = toutes, NONE = sans étiquette, sinon `t:<nom>`. */
  tag: string;
  rarities: Rarity[];
  /** `clé:sens`, '' = tri de la vue. */
  sort: string;
}

const EMPTY_REFINE: Refine = { q: '', tag: '', rarities: [], sort: '' };

let ctx: FeatureContext | null = null;
let root: HTMLElement | null = null;
let shellFor = '';
let refine: Refine = { ...EMPTY_REFINE };
let shown = PAGE;
let gridKey = '';
let tagsKey = '';
/** Change quand ma collection, des prix ou des images arrivent (clé de rendu). */
let dataVersion = 0;
let cardsRef: Record<string, Card> | null = null;
let pricesAsked = '';
let imagesAsked = '';
/** Cartes affichées, par `data-id` (pour les actions). */
const byDataId = new Map<string, Card>();
let observer: IntersectionObserver | null = null;
let typing = 0;

const dataId = (c: Card) => c.siteId ?? `name:${c.id}`;

// ---------------------------------------------------------------- point d'entrée

function render(c: FeatureContext): void {
  ctx = c;
  if (c.cards !== cardsRef) {
    cardsRef = c.cards;
    dataVersion++;
  }
  fillPendingSiteSearch();
  const mount = nativeMount('view');
  const view = mount ? currentView(c.settings.collectionViews ?? []) : null;
  if (!mount || !view) {
    if (root) teardown();
    return;
  }
  ensureFamilyStyle();
  ensureStyle('wiky-vpage-style', CSS);
  if (!root || root.parentElement !== mount) {
    root = el('div', { class: 'wf', 'data-wiky': 'view-page' });
    mount.replaceChildren(root);
    root.addEventListener('click', onClick);
    root.addEventListener('input', onInput);
    root.addEventListener('change', onChange);
    shellFor = '';
  }
  draw(view);
}

function teardown(): void {
  observer?.disconnect();
  observer = null;
  root?.remove();
  root = null;
  shellFor = '';
  gridKey = '';
  tagsKey = '';
  byDataId.clear();
}

/** Après « Voir dans la collection » : la recherche du site est remplie avec le nom de la carte. */
function fillPendingSiteSearch(): void {
  if (location.pathname !== '/collection' || location.search) return;
  let q: string | null = null;
  try {
    q = sessionStorage.getItem(SITE_SEARCH_KEY);
  } catch {
    return;
  }
  if (!q || !siteControlsReady()) return;
  try {
    sessionStorage.removeItem(SITE_SEARCH_KEY);
  } catch {
    // Stockage indisponible : rien à retirer.
  }
  void setSearch(q);
}

function openInSite(card: Card): void {
  try {
    sessionStorage.setItem(SITE_SEARCH_KEY, card.name);
  } catch {
    // Stockage indisponible : la collection s'ouvre sans recherche.
  }
  goToView(null);
}

// ---------------------------------------------------------------- dessin

function current(): CollectionView | null {
  return ctx ? currentView(ctx.settings.collectionViews ?? []) : null;
}

function shell(view: CollectionView): void {
  if (shellFor === view.id) return;
  shellFor = view.id;
  refine = { ...EMPTY_REFINE };
  shown = PAGE;
  gridKey = '';
  tagsKey = '';
  observer?.disconnect();
  const sorts = SORTS.flatMap((s) => (['asc', 'desc'] as const).map((d) => `<option value="${s.key}:${d}">${esc(s.label)} – ${esc(d === 'asc' ? s.asc : s.desc)}</option>`)).join('');
  root!.innerHTML = `
    <div class="wf-bar">
      <label class="wf-search wf-grow">${icon('search', 15)}<input class="wf-input" type="search" data-in="q" placeholder="Rechercher dans la vue (titre ou catégorie)…" aria-label="Rechercher dans la vue"></label>
      <select class="wf-select" data-in="tag" aria-label="Filtrer par étiquette"></select>
      <select class="wf-select" data-in="sort" aria-label="Trier la vue"><option value="" data-default></option>${sorts}</select>
    </div>
    <div class="wf-bar" role="group" aria-label="Raretés">
      ${RARITY_LIST.map((r) => `<button type="button" class="wf-chip wv-chip" data-act="rarity" data-r="${r}" aria-pressed="false" style="--wv-c:var(--color-rarity-${r.toLowerCase()}, #9ca3af)" title="${esc(RARITIES[r].label)}">${r}</button>`).join('')}
      <span class="wf-grow"></span>
      <button type="button" class="wf-btn ghost sm" data-act="reset" hidden>Réinitialiser</button>
    </div>
    <div class="wv-info wf-small wf-muted" data-part="info"></div>
    <div data-part="grid"></div>
    <div class="wf-more" data-part="more"></div>`;
  // Arrivé en bas : la suite se charge seule (sinon, le bouton « Afficher plus »).
  if (typeof IntersectionObserver === 'function') {
    observer = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting) && root?.querySelector('[data-act="more"]')) more();
    }, { rootMargin: '600px 0px' });
    observer.observe(root!.querySelector('[data-part="more"]')!);
  }
}

function part(name: string): HTMLElement {
  return root!.querySelector<HTMLElement>(`[data-part="${name}"]`)!;
}

/** Filtre d'étiquette : mes étiquettes, avec le nombre de cartes de chacune. */
function drawTags(cards: Card[]): void {
  const count = new Map<string, { name: string; n: number }>();
  for (const c of cards) {
    for (const t of c.tags) {
      const k = normalize(t);
      const e = count.get(k) ?? { name: t, n: 0 };
      e.n++;
      count.set(k, e);
    }
  }
  const tags = [...count.values()].sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  const key = JSON.stringify(tags);
  if (key === tagsKey) return;
  tagsKey = key;
  const select = root!.querySelector<HTMLSelectElement>('[data-in="tag"]')!;
  select.innerHTML = `<option value="">Toutes les étiquettes</option><option value="${NONE}">Sans étiquette</option>`
    + tags.map((t) => `<option value="${esc(TAG + t.name)}">#${esc(t.name)} (${t.n})</option>`).join('');
  select.value = refine.tag;
  // Étiquette disparue de ma collection : on revient à « toutes ».
  if (select.value !== refine.tag) refine.tag = '';
}

/** Vue affinée par la page : filtre en plus, tri choisi sur la page. */
function refined(view: CollectionView): { extra: typeof EMPTY_VIEW_FILTER; view: CollectionView } {
  const extra = {
    ...EMPTY_VIEW_FILTER,
    q: refine.q.trim(),
    tags: refine.tag.startsWith(TAG) ? [refine.tag.slice(TAG.length)] : [],
    untagged: refine.tag === NONE,
    rarities: [...refine.rarities],
  };
  const [sort, dir] = refine.sort ? (refine.sort.split(':') as [ViewSortKey, 'asc' | 'desc']) : [view.sort, view.dir];
  return { extra, view: { ...view, sort, dir } };
}

function draw(view: CollectionView): void {
  if (!root || !ctx) return;
  shell(view);
  const all = Object.values(ctx.cards);
  drawTags(all);
  const vctx = viewContext();
  const r = refined(view);
  // La recherche de la page accepte aussi plusieurs mots séparés par des virgules (l'un d'eux).
  const list = applyView(all.filter((c) => matchesView(c, r.extra, vctx)), r.view, vctx);

  const defaultOpt = root.querySelector<HTMLOptionElement>('[data-in="sort"] option[data-default]')!;
  const vs = VIEW_SORTS.find((s) => s.key === view.sort) ?? VIEW_SORTS[0];
  const defaultLabel = `Tri de la vue : ${vs.label}${view.sort === 'added' ? '' : ` – ${view.dir === 'desc' ? vs.desc : vs.asc}`}`;
  if (defaultOpt.textContent !== defaultLabel) defaultOpt.textContent = defaultLabel;
  for (const chip of root.querySelectorAll<HTMLElement>('[data-act="rarity"]')) {
    const on = refine.rarities.includes(chip.dataset.r as Rarity);
    chip.classList.toggle('on', on);
    chip.setAttribute('aria-pressed', String(on));
  }
  const refinedNow = JSON.stringify(refine) !== JSON.stringify(EMPTY_REFINE);
  root.querySelector<HTMLElement>('[data-act="reset"]')!.hidden = !refinedNow;

  const key = JSON.stringify([view, refine, shown, dataVersion]);
  if (key === gridKey) return;
  gridKey = key;

  // Informations : résumé de la vue, nombre de cartes et d'exemplaires, valeur connue.
  let copies = 0;
  let value = 0;
  let priced = 0;
  for (const c of list) {
    const qty = Math.max(1, c.quantity || 1);
    copies += qty;
    const p = vctx.price(c);
    if (p != null) {
      value += p * qty;
      priced++;
    }
  }
  const info = part('info');
  info.innerHTML = `<span class="wv-sum"></span>
    <span><b>${plural(list.length, 'carte')}</b>${copies !== list.length ? ` · ${plural(copies, 'exemplaire')}` : ''}${priced ? ` · valeur ≈ <b>${money(Math.round(value))}</b>${priced < list.length ? ' (prix connus)' : ''}` : ''}</span>
    <a href="/settings?wiky=settings#interface">Modifier la vue</a>
    <a href="/collection" data-act="quit">Collection complète</a>`;
  info.querySelector('.wv-sum')!.textContent = viewSummary(view);

  const grid = part('grid');
  byDataId.clear();
  if (!all.length) {
    grid.className = '';
    grid.innerHTML = `<div class="wf-empty">Ta collection n'est pas encore relevée. Ouvre « Ma collection » une fois${ctx.apiRead ? '' : ', ou active la lecture via l\'API (Réglages → Accès au site),'} puis reviens sur cette vue.</div>`;
  } else if (!list.length) {
    grid.className = '';
    grid.innerHTML = `<div class="wf-empty">Aucune carte de ta collection ne correspond à cette vue${refinedNow ? ' (avec ce que tu as affiné ici)' : ''}.</div>`;
  } else {
    grid.className = 'wf-grid wv-grid';
    const slice = list.slice(0, shown);
    grid.innerHTML = slice
      .map((c) => {
        byDataId.set(dataId(c), c);
        return cardHtml({
          card: catalogCard(c),
          owned: Math.max(1, c.quantity || 1),
          price: vctx.price(c) ?? null,
          favorite: c.favorite,
          note: c.tags.length ? c.tags.map((t) => `#${t}`).join(' ') : undefined,
          actions: [
            { act: 'family', title: 'Ajouter à une famille', icon: 'folderPlus' },
            { act: 'site', title: 'Voir dans la collection du site (fiche, vente, étiquettes)', icon: 'search' },
          ],
        });
      })
      .join('');
  }
  const rest = list.length - Math.min(shown, list.length);
  part('more').innerHTML = rest > 0 ? `<button type="button" class="wf-btn" data-act="more">Afficher plus (${plural(rest, 'carte restante', 'cartes restantes')})</button>` : '';

  loadMissing(view, list, all, r.view);
}

/** Carte du catalogue (image) si elle est déjà chargée, sinon reconstituée depuis ma collection. */
function catalogCard(c: Card): CatalogCard {
  const known = c.siteId ? knownCard(c.siteId) : undefined;
  if (known) return { ...known, title: c.name, rarity: c.rarity ?? known.rarity };
  return { siteId: dataId(c), title: c.name, rarity: c.rarity, category: c.category ?? null, imageUrl: null, wikipediaUrl: null, atk: null, def: null };
}

/** Prix (pour filtrer et trier par prix : toutes les cartes concernées) et images des cartes affichées, par lots. */
function loadMissing(view: CollectionView, list: Card[], all: Card[], sorted: CollectionView): void {
  if (!ctx?.apiRead) return;
  const f = view.filter;
  const byPrice = f.minPrice != null || f.maxPrice != null || ['price', 'total', 'rate', 'sales'].includes(sorted.sort);
  // Filtre par prix : une carte sans prix connu est écartée, il faut donc les prix de toutes celles qui passent le reste.
  const candidates = byPrice ? all.filter((c) => matchesView(c, { ...f, minPrice: null, maxPrice: null }, viewContext())) : list.slice(0, shown);
  const priceIds = candidates.map((c) => c.siteId).filter((id): id is string => !!id && !knownPrice(id));
  const askP = priceIds.join(',');
  if (priceIds.length && askP !== pricesAsked) {
    pricesAsked = askP;
    void cardPrices(priceIds)
      .then(() => redraw())
      .catch(() => {});
  }
  const imageIds = list
    .slice(0, shown)
    .map((c) => c.siteId)
    .filter((id): id is string => !!id && !knownCard(id));
  const askI = imageIds.join(',');
  if (imageIds.length && askI !== imagesAsked) {
    imagesAsked = askI;
    void cardsByIds(imageIds)
      .then(() => redraw())
      .catch((e) => console.warn('[Wiki-Traders] vue : images', e));
  }
}

function redraw(): void {
  dataVersion++;
  const view = current();
  if (root && view) draw(view);
}

function more(): void {
  shown += PAGE;
  const view = current();
  if (view) draw(view);
}

// ---------------------------------------------------------------- événements

function onClick(e: Event): void {
  const target = e.target as Element;
  const btn = target.closest<HTMLElement>('[data-act]');
  const view = current();
  if (!view) return;
  const cardEl = target.closest<HTMLElement>('.wf-card');
  const card = cardEl ? byDataId.get(cardEl.dataset.id ?? '') : undefined;
  switch (btn?.dataset.act) {
    case 'rarity': {
      const r = btn.dataset.r as Rarity;
      refine.rarities = refine.rarities.includes(r) ? refine.rarities.filter((x) => x !== r) : [...refine.rarities, r];
      shown = PAGE;
      return draw(view);
    }
    case 'reset':
      refine = { ...EMPTY_REFINE };
      shown = PAGE;
      for (const input of root!.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-in]')) input.value = '';
      return draw(view);
    case 'more':
      return more();
    case 'quit':
      e.preventDefault();
      return goToView(null);
    case 'family':
      if (card) pickFamilyAndAdd(btn, [catalogCard(card)]);
      return;
    case 'site':
      if (card) openInSite(card);
      return;
  }
  // Clic sur la carte elle-même : sa fiche dans la collection du site.
  if (card && !btn) openInSite(card);
}

function onInput(e: Event): void {
  const t = e.target as HTMLInputElement;
  if (t.dataset.in !== 'q') return;
  refine.q = t.value;
  shown = PAGE;
  // Rendu après une courte pause de frappe (milliers de cartes filtrées en mémoire).
  clearTimeout(typing);
  typing = window.setTimeout(() => {
    const view = current();
    if (view) draw(view);
  }, 120);
}

function onChange(e: Event): void {
  const t = e.target as HTMLSelectElement;
  if (t.dataset.in === 'tag') refine.tag = t.value;
  else if (t.dataset.in === 'sort') refine.sort = t.value;
  else return;
  shown = PAGE;
  const view = current();
  if (view) draw(view);
}

registerFeature({
  keys: [],
  when: (c) => (c.settings.collectionViews?.length ?? 0) > 0 && c.settings.viewsMode !== 'native',
  render,
  cleanup: teardown,
});

/** Pour les tests. */
export function resetViewsPage(): void {
  teardown();
  refine = { ...EMPTY_REFINE };
  shown = PAGE;
  pricesAsked = '';
  imagesAsked = '';
  ctx = null;
  cardsRef = null;
}
