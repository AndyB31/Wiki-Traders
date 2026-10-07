/**
 * État des familles côté page, partagé par la page Familles, les pastilles et la barre de sélection :
 *  - copie en mémoire (mise à jour immédiate de l'affichage, enregistrement dans chrome.storage ensuite) ;
 *  - index de possession recalculé seulement quand ma collection change ;
 *  - import unique des familles de « Prix moyen collection » au premier passage ;
 *  - résolution d'une carte affichée par le site (titre / identifiant) en carte du catalogue.
 */
import { addCards, familyIndex, mergeFamilies, newFamily, ownedIndex, type FamilyIndex, type OwnedIndex } from '../../lib/families';
import { load, save } from '../../lib/storage';
import { normalize } from '../../lib/text';
import type { Card, CardFamily, CatalogCard, Rarity } from '../../lib/types';
import { cardsByIds, cardsByTitles } from '../catalog';
import { nativeCardSiteId, nativeCardTitle } from '../collection-selection';
import { readLegacyCardFamilies } from '../families';

let families: CardFamily[] = [];
let sig = '';
let famIdx: FamilyIndex | null = null;
const listeners = new Set<() => void>();

/** Signature bon marché d'une liste de familles (pas de JSON de milliers de cartes). */
export function familiesSignature(list: CardFamily[]): string {
  return list.map((f) => `${f.id}:${f.updatedAt}:${f.cards.length}:${f.color}:${f.coverSiteId ?? ''}:${f.name}`).join('|');
}

export function getFamilies(): CardFamily[] {
  return families;
}

export function getFamiliesSignature(): string {
  return sig;
}

export function onFamiliesChange(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function set(list: CardFamily[]): void {
  families = list;
  sig = familiesSignature(list);
  famIdx = null;
  for (const cb of listeners) cb();
}

/** Changement local pas encore revenu du stockage (jusqu'à cette date) : le contexte relu est encore l'ancien. */
let pendingUntil = 0;

/** Familles relues du stockage (contexte des modules) : prises seulement si elles ont changé. */
export function syncFamilies(list: CardFamily[]): void {
  const s = familiesSignature(list);
  if (s === sig) {
    pendingUntil = 0;
    return;
  }
  // Une relecture de la page entre notre enregistrement et son retour ne doit pas réafficher l'ancienne liste.
  if (Date.now() < pendingUntil) return;
  set(list);
}

/** Change les familles : affichage immédiat, enregistrement ensuite. */
export async function commit(list: CardFamily[]): Promise<void> {
  set(list);
  pendingUntil = Date.now() + 5000;
  await save({ myFamilies: list });
}

export async function updateFamily(id: string, fn: (f: CardFamily) => CardFamily): Promise<void> {
  await commit(families.map((f) => (f.id === id ? fn(f) : f)));
}

export function familyById(id: string | null | undefined): CardFamily | undefined {
  return id ? families.find((f) => f.id === id) : undefined;
}

export function getFamilyIndex(): FamilyIndex {
  famIdx ??= familyIndex(families);
  return famIdx;
}

/** Ajoute des cartes à une famille existante, ou en crée une (`target` = nom de la nouvelle famille). */
export async function addToFamily(target: CardFamily | string, cards: CatalogCard[]): Promise<{ family: CardFamily; added: number }> {
  if (typeof target === 'string') {
    const family = newFamily(target, families, cards);
    await commit([...families, family]);
    return { family, added: family.cards.length };
  }
  const current = familyById(target.id) ?? target;
  const res = addCards(current, cards);
  if (res.added) await commit(families.map((f) => (f.id === current.id ? res.family : f)));
  return res;
}

// ---------------------------------------------------------------- possession

let ownedRef: Record<string, Card> | null = null;
let owned: OwnedIndex = { bySiteId: new Map(), byName: new Map() };
let ownedSig = '';

/** Index de possession, recalculé seulement quand l'objet « ma collection » change. */
export function getOwned(cards: Record<string, Card>): OwnedIndex {
  if (cards !== ownedRef) {
    ownedRef = cards;
    owned = ownedIndex(cards);
    let n = 0;
    let q = 0;
    for (const c of owned.bySiteId.values()) {
      n++;
      q += c.quantity;
    }
    ownedSig = `${n}:${q}:${owned.byName.size}`;
  }
  return owned;
}

/** Change quand la possession change (pour les clés de rendu). */
export function getOwnedSignature(): string {
  return ownedSig;
}

// ---------------------------------------------------------------- import

let importing: Promise<void> | null = null;

/** Premier passage : importe les familles de « Prix moyen collection » (une seule fois). */
export function ensureImported(): Promise<void> {
  importing ??= (async () => {
    try {
      const { familiesImportedAt, myFamilies } = await load('familiesImportedAt', 'myFamilies');
      if (familiesImportedAt != null) return;
      const legacy = readLegacyCardFamilies(myFamilies);
      const merged = mergeFamilies(myFamilies, legacy);
      if (merged.created || merged.cardsAdded) {
        set(merged.families);
        pendingUntil = Date.now() + 5000;
      }
      await save({ myFamilies: merged.families, familiesImportedAt: Date.now() });
    } catch (e) {
      console.warn('[Wiki-Traders] import des familles', e);
    }
  })();
  return importing;
}

/** « Réimporter depuis Prix moyen collection » : fusion par nom, sans doublon. */
export async function reimportLegacy(): Promise<{ created: number; cardsAdded: number; found: number }> {
  const legacy = readLegacyCardFamilies(families);
  const merged = mergeFamilies(families, legacy);
  if (merged.created || merged.cardsAdded) await commit(merged.families);
  await save({ familiesImportedAt: Date.now() });
  return { created: merged.created, cardsAdded: merged.cardsAdded, found: legacy.length };
}

// ---------------------------------------------------------------- cartes affichées par le site → catalogue

const RARITY_IMAGES: Record<string, Rarity> = { commun: 'C', peu_commun: 'PC', rare: 'R', super_rare: 'SR', ultra_rare: 'UR', legendaire: 'L' };

/** Carte du catalogue reconstituée depuis le DOM d'une carte native (quand son identifiant est connu). */
export function catalogCardFromDom(el: Element, siteId: string): CatalogCard | null {
  const title = nativeCardTitle(el);
  if (!title) return null;
  const glow = /(?:^|\s)glow-(c|pc|r|sr|ur|l)(?:\s|$)/i.exec(typeof el.className === 'string' ? el.className : '')?.[1]?.toUpperCase() as Rarity | undefined;
  let rarity: Rarity | null = glow ?? null;
  let imageUrl: string | null = null;
  for (const img of el.querySelectorAll('img')) {
    const src = img.getAttribute('src') ?? '';
    const r = /\/(commun|peu_commun|rare|super_rare|ultra_rare|legendaire)\.png/.exec(src)?.[1];
    if (r) rarity ??= RARITY_IMAGES[r];
    else if (!/\/logo\.png/.test(src) && src && !imageUrl) imageUrl = img.currentSrc || img.src || src;
  }
  const category = el.querySelector('h3 ~ p, p')?.textContent?.trim() || null;
  return { siteId, title, rarity, category, imageUrl, wikipediaUrl: null, atk: null, def: null };
}

/**
 * Cartes natives → cartes du catalogue : identifiant posé dans le DOM, sinon nom → ma collection, sinon
 * recherche par titre (une requête par lot de 150). Sans API, seules les cartes d'identifiant connu passent.
 */
export async function resolveNativeCards(els: Element[], cards: Record<string, Card>, apiRead: boolean): Promise<{ cards: CatalogCard[]; unresolved: string[] }> {
  getOwned(cards);
  return resolveCardRefs(els.map((el) => ({ title: nativeCardTitle(el), siteId: nativeCardSiteId(el), el })), cards, apiRead);
}

/** Carte repérée dans la page : titre, identifiant s'il est connu, élément (pour en relire l'image et la rareté). */
export interface CardRef {
  title: string | null;
  siteId: string | null;
  el?: Element;
}

export async function resolveCardRefs(refs: CardRef[], cards: Record<string, Card>, apiRead: boolean): Promise<{ cards: CatalogCard[]; unresolved: string[] }> {
  // Index en cache seulement pour « ma collection » (pas pour une sous-liste).
  const idx = cards === ownedRef ? owned : ownedIndex(cards);
  const byId = new Map<string, CardRef>();
  const noId = new Map<string, CardRef>();
  for (const ref of refs) {
    const id = ref.siteId ?? (ref.title ? idx.byName.get(normalize(ref.title))?.siteId : undefined);
    if (id) byId.set(id, ref);
    else if (ref.title) noId.set(ref.title, ref);
  }
  const out = new Map<string, CatalogCard>();
  if (apiRead) {
    try {
      const [found, byTitle] = await Promise.all([cardsByIds([...byId.keys()]), noId.size ? cardsByTitles([...noId.keys()]) : Promise.resolve(new Map<string, CatalogCard>())]);
      for (const [id, c] of found) out.set(id, c);
      for (const [title, c] of byTitle) {
        out.set(c.siteId, c);
        noId.delete(title);
      }
    } catch (e) {
      console.warn('[Wiki-Traders] cartes du catalogue', e);
    }
  }
  for (const [id, ref] of byId) {
    if (out.has(id)) continue;
    const mine = idx.bySiteId.get(id);
    const c = (ref.el && catalogCardFromDom(ref.el, id)) || (mine ? catalogCardFromOwned(mine) : null);
    if (c) out.set(id, c);
    else if (ref.title) noId.set(ref.title, ref);
  }
  return { cards: [...out.values()], unresolved: [...noId.keys()] };
}

/** Carte du catalogue reconstituée depuis ma collection (sans image : complétée par l'API si possible). */
export function catalogCardFromOwned(c: Card): CatalogCard | null {
  if (!c.siteId) return null;
  return { siteId: c.siteId, title: c.name, rarity: c.rarity, category: c.category ?? null, imageUrl: null, wikipediaUrl: null, atk: null, def: null };
}

/** Mes cartes (ma collection) → cartes du catalogue : par identifiant (API, avec images) sinon depuis la collection. */
export async function catalogFromOwned(list: Card[], apiRead: boolean): Promise<{ cards: CatalogCard[]; unresolved: string[] }> {
  return resolveCardRefs(list.map((c) => ({ title: c.name, siteId: c.siteId ?? null })), Object.fromEntries(list.map((c) => [c.id, c])), apiRead);
}

/** Pour les tests. */
export function resetFamiliesState(): void {
  families = [];
  sig = '';
  famIdx = null;
  importing = null;
  pendingUntil = 0;
  ownedRef = null;
  listeners.clear();
}
