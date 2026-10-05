/**
 * Marché → « Mes ventes » : slots libres affichés après les enchères du site (même empreinte qu'une carte),
 * étiquette de la règle sur les slots occupés, et fenêtre « Vendre » intégrée au clic sur un slot libre.
 *
 * Vente : avec « Vendre depuis le classement » (automatisation) → mise aux enchères directe après confirmation
 * (`createListing`) ; sinon → « Ouvrir et pré-remplir », comme la popup (la vente est finie à la main sur le site).
 */
import { allocate, sellAdvice, type AllocationInput, type Candidate, type FreeSlot } from '../../lib/allocation';
import { ext } from '../../lib/browser';
import { durationFor, durationLabel, DURATIONS } from '../../lib/duration';
import type { FeatureFlags } from '../../lib/features';
import type { ProposedMessage } from '../../lib/messages';
import { save } from '../../lib/storage';
import type { Card, PendingFocus, Settings } from '../../lib/types';
import { cardIdsByTitles } from '../catalog';
import { progressToast } from '../toast';
import { isolateClicks } from './dom';
import { allocationInput, type MarketData } from './market-data';
import { createListing, SellError } from './market-sell';
import { randomCandidate, randomTags, salesCounter, searchPool, sellablePool } from './market-tabs-logic';
import type { FeatureContext } from './runtime';
import { button, confirmDialog, ensureFeatureStyle, node, rarityChip, wiki } from './ui';

const CSS = `
.wiky-slot { box-sizing: border-box; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px; text-align: center;
  min-height: 250px; cursor: pointer; border: 2px dashed rgba(249,115,22,.55) !important; background: rgba(249,115,22,.04);
  color: var(--color-foreground, #e7e5e4); font: inherit; transition: background .15s ease, border-color .15s ease; }
.wiky-slot:hover, .wiky-slot:focus-visible { background: rgba(249,115,22,.1); border-color: #f97316 !important; outline: none; }
.wiky-slot.ignored { opacity: .55; }
.wiky-slot .wiky-slot-plus { width: 40px; height: 40px; border-radius: 999px; display: grid; place-items: center; font-size: 24px; font-weight: 700; color: #fb923c; background: rgba(249,115,22,.14); }
.wiky-slot .wiky-slot-title { font-size: 13px; font-weight: 700; }
.wiky-slot .wiky-slot-tag { font-size: 10px; text-transform: uppercase; letter-spacing: .05em; color: color-mix(in srgb, var(--color-foreground, #e7e5e4) 50%, transparent); }
.wiky-slot .wiky-slot-card { width: 100%; margin-top: 6px; padding-top: 8px; border-top: 1px solid var(--color-border, rgba(255,255,255,.12)); font-size: 12px; }
.wiky-slot .wiky-slot-card b { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wiky-slot .wiky-slot-card span { color: #fdba74; font-weight: 700; font-variant-numeric: tabular-nums; }
[data-wiky-slot-tag] { position: relative; }
.wiky-slot-badge { position: absolute; top: 6px; right: 6px; z-index: 3; pointer-events: none; padding: 1px 7px; border-radius: 999px; font-size: 10px; font-weight: 700;
  background: rgba(249,115,22,.9); color: #fff; box-shadow: 0 2px 6px rgba(0,0,0,.35); }
.wiky-sell { position: fixed; inset: 0; z-index: 2147483646; display: grid; place-items: center; padding: 18px; background: rgba(0,0,0,.6); animation: wiky-f-fade .15s ease; }
.wiky-sell > .wiky-f-panel { width: min(480px, 100%); max-height: calc(100vh - 36px); overflow-y: auto; padding: 16px 18px; }
.wiky-sell h2 { margin: 0; font-size: 16px; font-weight: 700; }
.wiky-sell .wiky-sell-kicker { font-size: 10px; font-weight: 700; letter-spacing: .05em; text-transform: uppercase; color: #fb923c; }
.wiky-sell .wiky-sell-head { display: flex; align-items: flex-start; gap: 8px; margin-bottom: 10px; }
.wiky-sell .wiky-sell-head .wiky-f-x { margin-left: auto; }
.wiky-sell .wiky-sell-card { display: grid; grid-template-columns: auto 1fr auto; gap: 2px 8px; align-items: center; padding: 10px 12px; border-radius: 12px;
  border: 1px solid rgba(249,115,22,.3); background: rgba(249,115,22,.06); }
.wiky-sell .wiky-sell-card strong { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 14px; }
.wiky-sell .wiky-sell-card .wiky-sell-detail { grid-column: 1 / -1; font-size: 11.5px; color: color-mix(in srgb, var(--color-foreground, #e7e5e4) 60%, transparent); }
.wiky-sell section { margin-top: 12px; }
.wiky-sell label, .wiky-sell .wiky-sell-label { display: block; margin-bottom: 4px; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .04em;
  color: color-mix(in srgb, var(--color-foreground, #e7e5e4) 55%, transparent); }
.wiky-sell input, .wiky-sell select { box-sizing: border-box; width: 100%; padding: 7px 10px; border-radius: 10px; font: inherit; font-size: 13px;
  border: 1px solid var(--color-border, rgba(255,255,255,.15)); background: var(--color-surface-light, rgba(255,255,255,.04)); color: var(--color-foreground, #e7e5e4); }
.wiky-sell input:focus, .wiky-sell select:focus { outline: none; border-color: rgba(249,115,22,.6); }
.wiky-sell .wiky-sell-line { display: flex; gap: 8px; align-items: center; }
.wiky-sell .wiky-sell-line > select { flex: 1; }
.wiky-sell .wiky-sell-results { margin-top: 4px; display: flex; flex-direction: column; gap: 2px; }
.wiky-sell .wiky-sell-results button { all: unset; box-sizing: border-box; display: flex; align-items: center; gap: 8px; padding: 5px 8px; border-radius: 8px; cursor: pointer; font-size: 12.5px; }
.wiky-sell .wiky-sell-results button:hover, .wiky-sell .wiky-sell-results button:focus-visible { background: var(--color-surface-light, rgba(255,255,255,.06)); }
.wiky-sell .wiky-sell-results .wiky-f-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wiky-sell .wiky-sell-durations { display: flex; flex-wrap: wrap; gap: 6px; }
.wiky-sell .wiky-sell-durations button { all: unset; cursor: pointer; padding: 5px 10px; border-radius: 8px; font-size: 12px; font-weight: 600;
  border: 1px solid var(--color-border, rgba(255,255,255,.15)); }
.wiky-sell .wiky-sell-durations button[aria-pressed="true"] { border-color: #f97316; background: rgba(249,115,22,.15); color: #fdba74; }
.wiky-sell .wiky-sell-note { margin-top: 10px; font-size: 11.5px; color: color-mix(in srgb, var(--color-foreground, #e7e5e4) 55%, transparent); }
.wiky-sell .wiky-sell-error { margin-top: 8px; font-size: 12px; color: #f87171; white-space: pre-line; }
`;

// ---------------------------------------------------------------- slots

/** Grille des enchères de l'onglet (créée par nous si le site n'en affiche pas, ex. 0 vente en cours). */
function salesGrid(bar: HTMLElement): HTMLElement | null {
  const content = nextSiteSibling(bar);
  const auction = content?.querySelector('[id^="marketplace-auction-"]');
  if (auction?.parentElement) return auction.parentElement;
  const ours = document.querySelector<HTMLElement>('[data-wiky="mt-slot-grid"]');
  if (ours?.isConnected && ours.previousElementSibling === bar) return ours;
  ours?.remove();
  const grid = node('div', 'mt-slot-grid', 'flex flex-wrap justify-center gap-4');
  grid.style.cssText = 'display:flex;flex-wrap:wrap;justify-content:center;gap:16px;margin-top:24px';
  bar.after(grid);
  return grid;
}

export function nextSiteSibling(el: Element): HTMLElement | null {
  let n = el.nextElementSibling;
  while (n && n.hasAttribute('data-wiky')) n = n.nextElementSibling;
  return n as HTMLElement | null;
}

export function clearSlots(): void {
  document.querySelectorAll('[data-wiky="mt-slot"], [data-wiky="mt-slot-grid"], [data-wiky="mt-slot-badge"]').forEach((n) => n.remove());
  document.querySelectorAll('[data-wiky-slot-tag]').forEach((n) => n.removeAttribute('data-wiky-slot-tag'));
}

/** Slots à afficher : libres d'après le compteur du site « (2/5) », complétés par l'allocation. */
export function slotsToShow(bar: Element | null, alloc: ReturnType<typeof allocate>): (FreeSlot | null)[] {
  const counter = salesCounter(bar);
  const count = counter ? Math.max(0, counter.slots - counter.active) : Math.max(0, alloc.slots - alloc.busy.length);
  const ordered = [...alloc.free.filter((f) => !f.ignored), ...alloc.free.filter((f) => f.ignored)];
  return Array.from({ length: count }, (_, i) => ordered[i] ?? null);
}

export function renderSlots(ctx: FeatureContext, bar: HTMLElement, d: MarketData): void {
  const input = allocationInput(ctx, d);
  const alloc = allocate(input);
  const slots = slotsToShow(bar, alloc);
  const grid = slots.length ? salesGrid(bar) : null;
  // Étiquette de la règle sur les enchères du site (slots occupés).
  const ruleOf = new Map(alloc.busy.map((b) => [b.auction.id, b.rule?.tag ?? null]));
  for (const el of document.querySelectorAll<HTMLElement>('[id^="marketplace-auction-"]')) {
    const tag = ruleOf.get(el.id.slice('marketplace-auction-'.length)) ?? null;
    const badge = el.querySelector<HTMLElement>(':scope > [data-wiky="mt-slot-badge"]');
    if (!tag) {
      badge?.remove();
      if (el.hasAttribute('data-wiky-slot-tag')) el.removeAttribute('data-wiky-slot-tag');
      continue;
    }
    if (el.getAttribute('data-wiky-slot-tag') !== tag) el.setAttribute('data-wiky-slot-tag', tag);
    if (badge?.textContent === tag) continue;
    const b = badge ?? node('span', 'mt-slot-badge', 'wiky-slot-badge');
    b.textContent = tag;
    b.title = `Slot de l'étiquette ${tag}`;
    if (!badge) el.append(b);
  }
  const key = JSON.stringify([slots.map((s) => (s ? [s.key, s.ignored, s.proposal?.card.id, s.proposal?.pricing.price] : null))]);
  const existing = [...document.querySelectorAll<HTMLElement>('[data-wiky="mt-slot"]')];
  const placed = existing.length === slots.length && existing.every((e) => e.parentElement === grid && e.dataset.key === key) && (!grid || grid.lastElementChild === existing[existing.length - 1]);
  if (placed) return;
  existing.forEach((e) => e.remove());
  if (!grid) {
    document.querySelector('[data-wiky="mt-slot-grid"]')?.remove();
    return;
  }
  ensureFeatureStyle();
  ensureFeatureStyle(CSS, 'market-slots');
  const frag = document.createDocumentFragment();
  slots.forEach((slot, i) => frag.append(slotCard(ctx, slot, i, key)));
  grid.append(frag);
}

function slotCard(ctx: FeatureContext, slot: FreeSlot | null, index: number, key: string): HTMLElement {
  const el = node('div', 'mt-slot', `card-frame block p-3 w-[172px] wiky-slot${slot?.ignored ? ' ignored' : ''}`);
  el.style.width = '172px';
  el.dataset.key = key;
  el.dataset.index = String(index);
  el.tabIndex = 0;
  el.setAttribute('role', 'button');
  const tag = slot?.rule.tag ?? null;
  el.setAttribute('aria-label', `Slot libre${tag ? `, étiquette ${tag}` : ''} : vendre une carte`);
  el.append(node('span', 'part', 'wiky-slot-plus', '+'), node('span', 'part', 'wiky-slot-title', 'Slot libre'));
  el.append(node('span', 'part', 'wiky-slot-tag', tag ? `étiquette ${tag}${slot?.fromRule ? ` (pour ${slot.fromRule.tag})` : ''}` : 'sans étiquette'));
  const box = node('div', 'part', 'wiky-slot-card');
  const p = slot?.proposal;
  if (p) {
    box.append(node('b', 'part', '', p.card.name), node('span', 'part', '', wiki(p.pricing.price)));
    box.title = p.pricing.detail;
  } else box.append(node('em', 'part', 'wiky-f-muted', slot?.ignored ? 'Slot ignoré' : 'Aucune carte proposée'));
  el.append(box);
  isolateClicks(el);
  const open = () => openSellModal(ctx, slot);
  el.addEventListener('click', (e) => {
    e.preventDefault();
    open();
  });
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      open();
    }
  });
  return el;
}

// ---------------------------------------------------------------- fenêtre « Vendre »

export interface SaleChoice {
  card: Card;
  price: number | null;
  detail: string;
  durationMin: number;
  tag: string | null;
  avgPrice: number | null;
}

let currentData: MarketData | null = null;
export function setSlotsData(d: MarketData | null): void {
  currentData = d;
}

function choiceFrom(c: Candidate, tag: string | null, settings: Settings): SaleChoice {
  return {
    card: c.card,
    price: c.pricing.price,
    detail: c.pricing.detail,
    durationMin: durationFor(c.pricing.price, settings.durationRules) ?? 60,
    tag,
    avgPrice: c.pricing.base.value,
  };
}

function choiceForCard(input: AllocationInput, card: Card, tag: string | null): SaleChoice {
  const { price, detail } = sellAdvice(input, card.id);
  return { card, price, detail, durationMin: durationFor(price, input.settings.durationRules) ?? 60, tag, avgPrice: null };
}

export interface SaleDeps {
  confirm?: typeof confirmDialog;
  list?: typeof createListing;
  resolveSiteId?: (card: Card) => Promise<string | null>;
  sendMessage?: (msg: unknown) => Promise<unknown>;
}

async function defaultSiteId(card: Card): Promise<string | null> {
  if (card.siteId) return card.siteId;
  try {
    return (await cardIdsByTitles([card.name])).get(card.name) ?? null;
  } catch {
    return null;
  }
}

/**
 * Vend la carte choisie : mise aux enchères directe (option `rankingSell`, après confirmation), sinon
 * « Ouvrir et pré-remplir » (message `proposed` puis `pendingFocus` : la page part vers la collection et ouvre la vente).
 */
export async function performSale(
  flags: Pick<FeatureFlags, 'rankingSell'>,
  choice: SaleChoice,
  deps: SaleDeps = {},
): Promise<{ ok: boolean; mode: 'listed' | 'prefill'; error?: string }> {
  const send = deps.sendMessage ?? ((m: unknown) => ext.runtime.sendMessage(m));
  if (!flags.rankingSell) {
    const msg: ProposedMessage = { type: 'proposed', cardId: choice.card.id, cardName: choice.card.name, tag: choice.tag ?? '', price: choice.price, avgPrice: choice.avgPrice };
    await send(msg).catch(() => {});
    const tab = (await send({ type: 'tabId' }).catch(() => null)) as { tabId: number | null } | null;
    const focus: PendingFocus = {
      cardId: choice.card.id,
      cardName: choice.card.name,
      price: choice.price,
      detail: choice.detail,
      at: Date.now(),
      autoOpen: true,
      durationMin: choice.durationMin,
      ...(tab?.tabId != null ? { tabId: tab.tabId } : {}),
    };
    // index.ts (maybePrefill) navigue vers `settings.sellPath` puis ouvre la vente et remplit prix et durée.
    await save({ pendingFocus: focus });
    return { ok: true, mode: 'prefill' };
  }
  const amount = Math.round(Number(choice.price));
  if (!Number.isFinite(amount) || amount <= 0) return { ok: false, mode: 'listed', error: 'Prix invalide.' };
  const ask = deps.confirm ?? confirmDialog;
  const ok = await ask({
    title: `Mettre « ${choice.card.name} » aux enchères ?`,
    text: `Prix de départ : ${wiki(amount)}\nDurée : ${durationLabel(choice.durationMin)}\n\nMise en vente faite à ta place : contraire aux règles du site.`,
    confirm: 'Mettre aux enchères',
  });
  if (!ok) return { ok: false, mode: 'listed', error: 'Annulé.' };
  const siteId = await (deps.resolveSiteId ?? defaultSiteId)(choice.card);
  if (!siteId) return { ok: false, mode: 'listed', error: 'Identifiant de la carte sur le site inconnu : utilise « Ouvrir et pré-remplir ».' };
  const list = deps.list ?? createListing;
  const req = (allowStarred: boolean) => list(flags, { siteCardId: siteId, amount, durationMinutes: choice.durationMin, allowStarred });
  try {
    try {
      await req(false);
    } catch (e) {
      if (!(e instanceof SellError && e.code === 'STARRED')) throw e;
      const again = await ask({ title: 'Exemplaire favori', text: `Le seul exemplaire libre de « ${choice.card.name} » est en favori. Le vendre quand même ?`, confirm: 'Vendre le favori' });
      if (!again) return { ok: false, mode: 'listed', error: 'Annulé.' };
      await req(true);
    }
  } catch (e) {
    return { ok: false, mode: 'listed', error: (e as Error).message };
  }
  window.dispatchEvent(new CustomEvent('wiky-refresh-sales'));
  return { ok: true, mode: 'listed' };
}

export function closeSellModal(): void {
  document.querySelector('[data-wiky="mt-sell"]')?.remove();
}

/** Fenêtre « Vendre » d'un slot libre (null : slot sans étiquette). */
export function openSellModal(ctx: FeatureContext, slot: FreeSlot | null, deps: SaleDeps = {}): HTMLElement | null {
  const d = currentData;
  if (!d) return null;
  closeSellModal();
  ensureFeatureStyle();
  ensureFeatureStyle(CSS, 'market-slots');
  const input = allocationInput(ctx, d);
  const settings = ctx.settings;
  const direct = ctx.flags.rankingSell;
  let choice: SaleChoice | null = slot?.proposal ? choiceFrom(slot.proposal, slot.rule.tag, settings) : null;

  const overlay = node('div', 'mt-sell', 'wiky-sell');
  const box = node('div', 'part', 'wiky-f-panel');
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-modal', 'true');
  box.setAttribute('aria-label', 'Vendre une carte');
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') close();
  };
  const close = () => {
    document.removeEventListener('keydown', onKey);
    overlay.remove();
  };
  document.addEventListener('keydown', onKey);

  const head = node('div', 'part', 'wiky-sell-head');
  const titles = node('div', 'part');
  titles.append(node('div', 'part', 'wiky-sell-kicker', `Slot libre${slot ? ` · étiquette ${slot.rule.tag}` : ''}`), node('h2', 'part', '', 'Vendre une carte'));
  const x = node('button', 'part', 'wiky-f-x', '×');
  x.type = 'button';
  x.setAttribute('aria-label', 'Fermer');
  x.addEventListener('click', close);
  head.append(titles, x);

  const cardBox = node('div', 'part', 'wiky-sell-card');
  const priceInput = node('input', 'part');
  priceInput.type = 'number';
  priceInput.min = '1';
  priceInput.step = '1';
  priceInput.id = 'wiky-sell-price';
  const durations = node('div', 'part', 'wiky-sell-durations');
  const error = node('div', 'part', 'wiky-sell-error');
  const go = button(direct ? 'Mettre aux enchères' : 'Ouvrir et pré-remplir', () => void submit());
  go.dataset.act = 'sell';

  const drawCard = () => {
    cardBox.replaceChildren();
    if (!choice) {
      cardBox.append(node('span', 'part', 'wiky-sell-detail', 'Aucune carte choisie : cherche une carte ou tire-en une au hasard.'));
      go.disabled = true;
      priceInput.value = '';
    } else {
      const c = choice.card;
      cardBox.append(rarityChip(c.rarity), node('strong', 'part', '', `${c.name}${c.shiny ? ' ✨' : ''}`), node('span', 'part', 'wiky-f-muted', `×${c.quantity}`));
      const dur = durationLabel(choice.durationMin);
      cardBox.append(node('span', 'part', 'wiky-sell-detail', `Prix conseillé ${wiki(choice.price)} — ${choice.detail}`), node('span', 'part', 'wiky-sell-detail', `Durée conseillée : ${dur}${choice.tag ? ` · étiquette ${choice.tag}` : ''}`));
      priceInput.value = choice.price != null ? String(choice.price) : '';
      go.disabled = false;
    }
    drawDurations();
  };
  const drawDurations = () => {
    durations.replaceChildren(
      ...DURATIONS.map((opt) => {
        const b = node('button', 'part', '', opt.label);
        b.type = 'button';
        b.dataset.minutes = String(opt.minutes);
        b.setAttribute('aria-pressed', String(choice?.durationMin === opt.minutes));
        b.addEventListener('click', () => {
          if (!choice) return;
          choice.durationMin = opt.minutes;
          drawDurations();
        });
        return b;
      }),
    );
  };
  const pick = (c: SaleChoice) => {
    choice = c;
    error.textContent = '';
    drawCard();
  };

  const sections: HTMLElement[] = [];
  // Autres cartes proposées pour ce slot.
  if (slot && slot.candidates.length > 1) {
    const sec = node('section', 'part');
    const label = node('label', 'part', '', 'Autres cartes du slot');
    const select = node('select', 'part');
    select.id = 'wiky-sell-candidates';
    label.htmlFor = select.id;
    for (const c of slot.candidates.slice(0, 60)) {
      const o = node('option', 'part', '', `${c.card.name} · ${wiki(c.pricing.price)} · ×${c.card.quantity}`);
      o.value = c.card.id;
      o.selected = c.card.id === choice?.card.id;
      select.append(o);
    }
    select.addEventListener('change', () => {
      const c = slot.candidates.find((x) => x.card.id === select.value);
      if (c) pick(choiceFrom(c, slot.rule.tag, settings));
    });
    sec.append(label, select);
    sections.push(sec);
  }
  // Recherche parmi mes cartes vendables.
  const pool = sellablePool(input);
  {
    const sec = node('section', 'part');
    const label = node('label', 'part', '', 'Chercher une de mes cartes vendables');
    const search = node('input', 'part');
    search.type = 'search';
    search.id = 'wiky-sell-search';
    search.placeholder = `${pool.length} carte(s) vendable(s)…`;
    label.htmlFor = search.id;
    const results = node('div', 'part', 'wiky-sell-results');
    search.addEventListener('input', () => {
      results.replaceChildren(
        ...searchPool(pool, search.value).map((c) => {
          const b = node('button', 'part');
          b.type = 'button';
          b.append(rarityChip(c.card.rarity), node('span', 'part', 'wiky-f-name', c.card.name), node('span', 'part', 'wiky-f-muted', `${wiki(c.pricing.price)} · ×${c.card.quantity}`));
          b.addEventListener('click', () => {
            pick({ ...choiceForCard(input, c.card, null), avgPrice: c.pricing.base.value });
            results.replaceChildren();
            search.value = '';
          });
          return b;
        }),
      );
    });
    sec.append(label, search, results);
    sections.push(sec);
  }
  // Carte au hasard dans une étiquette.
  const tags = randomTags(input);
  if (tags.length) {
    const sec = node('section', 'part');
    sec.append(node('span', 'part', 'wiky-sell-label', 'Carte au hasard'));
    const line = node('div', 'part', 'wiky-sell-line');
    const select = node('select', 'part');
    select.id = 'wiky-sell-random-tag';
    select.setAttribute('aria-label', 'Étiquette de la carte au hasard');
    for (const t of tags) {
      const o = node('option', 'part', '', t);
      o.value = t;
      o.selected = t === slot?.rule.tag;
      select.append(o);
    }
    const roll = button('Carte au hasard', () => {
      const c = randomCandidate(input, select.value, Math.random, Date.now(), choice ? [choice.card.id] : []);
      if (c) pick(choiceFrom(c, select.value, settings));
      else error.textContent = `Aucune carte vendable dans l'étiquette ${select.value} (favorites, déjà en vente ou à garder).`;
    }, 'ghost');
    roll.dataset.act = 'random';
    line.append(select, roll);
    sec.append(line);
    sections.push(sec);
  }
  // Prix et durée.
  const priceSec = node('section', 'part');
  const priceLabel = node('label', 'part', '', 'Prix de départ (W)');
  priceLabel.htmlFor = priceInput.id;
  priceInput.addEventListener('input', () => {
    if (choice) choice.price = priceInput.value === '' ? null : Number(priceInput.value);
  });
  priceSec.append(priceLabel, priceInput);
  const durSec = node('section', 'part');
  durSec.append(node('span', 'part', 'wiky-sell-label', 'Durée'), durations);

  const actions = node('div', 'part', 'wiky-f-actions');
  const cancel = button('Annuler', close, 'ghost');
  actions.append(cancel, go);
  const note = node(
    'p',
    'part',
    'wiky-sell-note',
    direct
      ? 'Mise aux enchères directe (option « Vendre depuis le classement ») : une confirmation suit.'
      : `La collection s'ouvre et la fenêtre de vente du site est pré-remplie${settings.prefill ? '' : ' (si le pré-remplissage est activé dans les réglages)'} : le dernier clic reste le tien.`,
  );

  async function submit(): Promise<void> {
    if (!choice) return;
    go.disabled = true;
    error.textContent = '';
    const res = await performSale(ctx.flags, { ...choice }, deps);
    go.disabled = false;
    if (res.ok) {
      close();
      if (res.mode === 'listed') progressToast({ title: 'Vente', text: `« ${choice.card.name} » mise aux enchères : ${wiki(choice.price)}, ${durationLabel(choice.durationMin)}.`, finished: true });
    } else if (res.error !== 'Annulé.') error.textContent = res.error ?? 'Mise en vente impossible.';
  }

  box.append(head, cardBox, ...sections, priceSec, durSec, error, note, actions);
  overlay.append(box);
  for (const type of ['click', 'mousedown', 'pointerdown']) overlay.addEventListener(type, (e) => e.stopPropagation());
  overlay.addEventListener('mousedown', (e) => {
    if (e.target === overlay) close();
  });
  drawCard();
  document.body.append(overlay);
  (choice ? priceInput : box.querySelector<HTMLElement>('#wiky-sell-search'))?.focus();
  return overlay;
}
