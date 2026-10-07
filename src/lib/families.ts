/**
 * Familles de cartes (Wiki-Traders) : logique pure, sans DOM ni réseau.
 *  - possession exacte (identifiant du site présent dans ma collection, sinon nom identique) : pas d'heuristique
 *    par mots-clés, rien « à vérifier » ;
 *  - statistiques (possédées, valeur, coût pour compléter) calculées en mémoire à partir des prix moyens ;
 *  - import de « Prix moyen collection » (`wm_families_v1`) et codes de partage compatibles `F0.` / `F1.`.
 */
import { normalize } from './text';
import type { Card, CardFamily, CatalogCard, Rarity } from './types';

/** Couleurs des pastilles, attribuées dans l'ordre (puis en boucle). */
export const FAMILY_COLORS = ['#f97316', '#3b82f6', '#22c55e', '#a855f7', '#ef4444', '#eab308', '#14b8a6', '#ec4899', '#6366f1', '#84cc16', '#06b6d4', '#f43f5e'];

const RARITY_SET = new Set<Rarity>(['C', 'PC', 'R', 'SR', 'UR', 'L']);
export const RARITY_ORDER: Record<Rarity, number> = { C: 0, PC: 1, R: 2, SR: 3, UR: 4, L: 5 };

export function familyId(): string {
  return `fam-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Première couleur de la palette pas encore prise (sinon la suivante dans l'ordre). */
export function nextColor(existing: CardFamily[]): string {
  const used = new Set(existing.map((f) => f.color));
  return FAMILY_COLORS.find((c) => !used.has(c)) ?? FAMILY_COLORS[existing.length % FAMILY_COLORS.length];
}

export function newFamily(name: string, existing: CardFamily[], cards: CatalogCard[] = [], now = Date.now()): CardFamily {
  return { id: familyId(), name: name.trim() || 'Nouvelle famille', color: nextColor(existing), cards: dedupe(cards), coverSiteId: null, createdAt: now, updatedAt: now };
}

function dedupe(cards: CatalogCard[]): CatalogCard[] {
  const seen = new Set<string>();
  return cards.filter((c) => c.siteId && !seen.has(c.siteId) && seen.add(c.siteId));
}

/** Ajoute des cartes (sans doublon) ; renvoie la famille modifiée et le nombre de cartes réellement ajoutées. */
export function addCards(family: CardFamily, cards: CatalogCard[], now = Date.now()): { family: CardFamily; added: number } {
  const have = new Set(family.cards.map((c) => c.siteId));
  const fresh = dedupe(cards).filter((c) => !have.has(c.siteId));
  if (!fresh.length) return { family, added: 0 };
  return { family: { ...family, cards: [...family.cards, ...fresh], updatedAt: now }, added: fresh.length };
}

export function removeCards(family: CardFamily, siteIds: Iterable<string>, now = Date.now()): CardFamily {
  const drop = new Set(siteIds);
  const cards = family.cards.filter((c) => !drop.has(c.siteId));
  if (cards.length === family.cards.length) return family;
  return { ...family, cards, coverSiteId: family.coverSiteId && drop.has(family.coverSiteId) ? null : family.coverSiteId, updatedAt: now };
}

// ---------------------------------------------------------------- possession

export interface OwnedIndex {
  bySiteId: Map<string, Card>;
  byName: Map<string, Card>;
}

/** Index de ma collection, construit une fois par changement de collection. */
export function ownedIndex(cards: Record<string, Card>): OwnedIndex {
  const bySiteId = new Map<string, Card>();
  const byName = new Map<string, Card>();
  for (const c of Object.values(cards)) {
    if (c.quantity <= 0) continue;
    // Une version brillante et la normale ont le même identifiant de carte : on additionne les exemplaires.
    if (c.siteId) {
      const prev = bySiteId.get(c.siteId);
      bySiteId.set(c.siteId, prev ? { ...prev, quantity: prev.quantity + c.quantity } : c);
    }
    const k = normalize(c.name);
    const prevName = byName.get(k);
    byName.set(k, prevName ? { ...prevName, quantity: prevName.quantity + c.quantity } : c);
  }
  return { bySiteId, byName };
}

/** Exemplaires possédés d'une carte du catalogue (0 = manquante). */
export function ownedCount(card: Pick<CatalogCard, 'siteId' | 'title'>, idx: OwnedIndex): number {
  return (idx.bySiteId.get(card.siteId) ?? idx.byName.get(normalize(card.title)))?.quantity ?? 0;
}

export interface FamilyStats {
  total: number;
  owned: number;
  missing: number;
  /** 0–100. */
  pct: number;
  /** Somme des prix moyens des cartes possédées (une fois chacune). */
  valueOwned: number;
  /** Somme des prix moyens des cartes manquantes. */
  costToComplete: number;
  /** Cartes manquantes sans prix connu (jamais vendues ou prix pas encore chargés). */
  missingUnpriced: number;
}

export function familyStats(family: CardFamily, idx: OwnedIndex, price: (siteId: string) => number | null = () => null): FamilyStats {
  let owned = 0;
  let valueOwned = 0;
  let costToComplete = 0;
  let missingUnpriced = 0;
  for (const c of family.cards) {
    const p = price(c.siteId);
    if (ownedCount(c, idx) > 0) {
      owned++;
      valueOwned += p ?? 0;
    } else if (p == null) missingUnpriced++;
    else costToComplete += p;
  }
  const total = family.cards.length;
  return { total, owned, missing: total - owned, pct: total ? Math.round((owned / total) * 1000) / 10 : 0, valueOwned, costToComplete, missingUnpriced };
}

// ---------------------------------------------------------------- tris

export type FamilySort = 'name' | 'progress' | 'size' | 'recent';
export type CardSort = 'name' | 'rarity' | 'price' | 'owned';

export function sortFamilies(list: CardFamily[], by: FamilySort, stats: (f: CardFamily) => FamilyStats): CardFamily[] {
  const byName = (a: CardFamily, b: CardFamily) => a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' });
  const out = [...list];
  if (by === 'name') return out.sort(byName);
  if (by === 'recent') return out.sort((a, b) => b.updatedAt - a.updatedAt || byName(a, b));
  if (by === 'size') return out.sort((a, b) => b.cards.length - a.cards.length || byName(a, b));
  const pct = new Map(out.map((f) => [f.id, stats(f).pct]));
  return out.sort((a, b) => pct.get(b.id)! - pct.get(a.id)! || byName(a, b));
}

export function sortCards(cards: CatalogCard[], by: CardSort, owned: (c: CatalogCard) => number, price: (siteId: string) => number | null): CatalogCard[] {
  const byName = (a: CatalogCard, b: CatalogCard) => a.title.localeCompare(b.title, 'fr', { sensitivity: 'base' });
  const rarity = (c: CatalogCard) => (c.rarity ? RARITY_ORDER[c.rarity] : -1);
  const out = [...cards];
  if (by === 'name') return out.sort(byName);
  if (by === 'rarity') return out.sort((a, b) => rarity(b) - rarity(a) || byName(a, b));
  if (by === 'price') return out.sort((a, b) => (price(b.siteId) ?? -1) - (price(a.siteId) ?? -1) || byName(a, b));
  const own = new Map(out.map((c) => [c.siteId, owned(c) > 0 ? 1 : 0]));
  return out.sort((a, b) => own.get(b.siteId)! - own.get(a.siteId)! || rarity(b) - rarity(a) || byName(a, b));
}

// ---------------------------------------------------------------- import « Prix moyen collection »

export const LEGACY_KEY = 'wm_families_v1';

function asRarity(v: unknown): Rarity | null {
  return RARITY_SET.has(v as Rarity) ? (v as Rarity) : null;
}

function asNumber(v: unknown): number | null {
  if (v === '' || v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function asText(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

export function wikipediaUrlForTitle(title: string): string | null {
  const slug = encodeURIComponent(title.trim().replace(/ /g, '_'));
  return slug ? `https://fr.wikipedia.org/wiki/${slug}` : null;
}

/** Familles complètes (toutes les cartes, couverture) lues dans `wm_families_v1`. */
export function parseLegacyFamilies(raw: string | null, existing: CardFamily[] = [], now = Date.now()): CardFamily[] {
  if (!raw) return [];
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(data)) return [];
  const out: CardFamily[] = [];
  for (const f of data as Record<string, unknown>[]) {
    if (!f || typeof f !== 'object' || typeof f.name !== 'string' || !f.name.trim() || !Array.isArray(f.cards)) continue;
    const cards = dedupe(
      (f.cards as Record<string, unknown>[])
        .filter((c) => c && typeof c.id === 'string' && typeof c.title === 'string')
        .map((c) => ({
          siteId: c.id as string,
          title: (c.title as string).trim(),
          rarity: asRarity(c.rarity),
          category: asText(c.category),
          imageUrl: asText(c.imageUrl),
          wikipediaUrl: asText(c.wikipediaUrl),
          atk: asNumber(c.atk),
          def: asNumber(c.def),
        })),
    );
    const cover = typeof f.coverCardId === 'string' && cards.some((c) => c.siteId === f.coverCardId) ? f.coverCardId : null;
    out.push({
      id: familyId(),
      name: f.name.trim(),
      color: nextColor([...existing, ...out]),
      cards,
      coverSiteId: cover,
      createdAt: asNumber(f.createdAt) ?? now,
      updatedAt: asNumber(f.updatedAt) ?? now,
    });
  }
  return out;
}

/**
 * Fusionne des familles importées : une famille du même nom (sans tenir compte de la casse ni des accents)
 * reçoit seulement les cartes qui lui manquent ; les autres sont ajoutées. Renvoie aussi ce qui a changé.
 */
export function mergeFamilies(existing: CardFamily[], incoming: CardFamily[], now = Date.now()): { families: CardFamily[]; created: number; cardsAdded: number } {
  const families = [...existing];
  let created = 0;
  let cardsAdded = 0;
  for (const inc of incoming) {
    const i = families.findIndex((f) => normalize(f.name) === normalize(inc.name));
    if (i < 0) {
      families.push({ ...inc, color: families.some((f) => f.color === inc.color) ? nextColor(families) : inc.color });
      created++;
      cardsAdded += inc.cards.length;
      continue;
    }
    const { family, added } = addCards(families[i], inc.cards, now);
    families[i] = family.coverSiteId || !inc.coverSiteId ? family : { ...family, coverSiteId: inc.coverSiteId };
    cardsAdded += added;
  }
  return { families, created, cardsAdded };
}

// ---------------------------------------------------------------- codes de partage (compatibles « Prix moyen collection »)

type CodeRow = [string, string, string, string, string, number | '', number | ''];
type CodePayload = [string, number, CodeRow[]];

export function familyPayload(family: CardFamily): CodePayload {
  const cover = family.coverSiteId ? family.cards.findIndex((c) => c.siteId === family.coverSiteId) : -1;
  return [
    family.name.trim(),
    cover,
    family.cards.map((c) => [c.siteId, c.title, c.rarity ?? '', c.category ?? '', c.imageUrl ?? '', c.atk ?? '', c.def ?? '']),
  ];
}

export function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export function base64UrlToBytes(value: string): Uint8Array {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(normalized + '='.repeat((4 - (normalized.length % 4 || 4)) % 4));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function pipe(bytes: Uint8Array, stream: GenericTransformStream): Promise<Uint8Array> {
  const out = new Blob([bytes as BlobPart]).stream().pipeThrough(stream as unknown as ReadableWritablePair<Uint8Array, Uint8Array>);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

/** Code `F1.` (gzip) s'il est plus court, sinon `F0.` (JSON brut) : lisible par les deux extensions. */
export async function encodeFamilyCode(family: CardFamily): Promise<string> {
  const raw = new TextEncoder().encode(JSON.stringify(familyPayload(family)));
  const plain = `F0.${bytesToBase64Url(raw)}`;
  try {
    if (typeof CompressionStream === 'function') {
      const packed = `F1.${bytesToBase64Url(await pipe(raw, new CompressionStream('gzip')))}`;
      if (packed.length < plain.length) return packed;
    }
  } catch {
    // Compression indisponible : code brut.
  }
  return plain;
}

/** Famille décrite par un code `F0.` / `F1.` (lève une erreur lisible si le code est invalide). */
export async function decodeFamilyCode(input: string, existing: CardFamily[] = [], now = Date.now()): Promise<CardFamily> {
  const code = input.replace(/\s+/g, '');
  if (!code) throw new Error('Colle un code de famille.');
  const dot = code.indexOf('.');
  if (dot <= 0 || dot === code.length - 1) throw new Error('Code de famille invalide.');
  const version = code.slice(0, dot);
  let bytes: Uint8Array;
  try {
    bytes = base64UrlToBytes(code.slice(dot + 1));
  } catch {
    throw new Error('Code de famille invalide.');
  }
  if (version === 'F1') {
    if (typeof DecompressionStream !== 'function') throw new Error('La décompression n\'est pas disponible dans ce navigateur.');
    try {
      bytes = await pipe(bytes, new DecompressionStream('gzip'));
    } catch {
      throw new Error('Le code de famille est corrompu.');
    }
  } else if (version !== 'F0') throw new Error('Version de code non prise en charge.');
  let payload: unknown;
  try {
    payload = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new Error('Le code de famille est corrompu.');
  }
  if (!Array.isArray(payload) || payload.length < 3) throw new Error('Format de famille invalide.');
  const name = String(payload[0] ?? '').trim();
  if (!name || name.length > 120) throw new Error('Nom de famille invalide.');
  const rows = Array.isArray(payload[2]) ? (payload[2] as unknown[]) : [];
  if (rows.length > 5000) throw new Error('Cette famille contient trop de cartes.');
  const cards: CatalogCard[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    if (!Array.isArray(row) || row.length < 2) continue;
    const siteId = String(row[0] ?? '').trim();
    const title = String(row[1] ?? '').trim();
    if (!siteId || !title || seen.has(siteId)) continue;
    seen.add(siteId);
    cards.push({
      siteId,
      title,
      rarity: asRarity(row[2]),
      category: asText(row[3]),
      imageUrl: asText(row[4]),
      wikipediaUrl: wikipediaUrlForTitle(title),
      atk: asNumber(row[5]),
      def: asNumber(row[6]),
    });
  }
  const coverIndex = Number(payload[1]);
  const coverId = Number.isInteger(coverIndex) && coverIndex >= 0 && coverIndex < rows.length ? String((rows[coverIndex] as unknown[])?.[0] ?? '') : '';
  return { id: familyId(), name, color: nextColor(existing), cards, coverSiteId: seen.has(coverId) ? coverId : null, createdAt: now, updatedAt: now };
}

// ---------------------------------------------------------------- pastilles

/** Index carte → familles (par identifiant du site et par nom), reconstruit à chaque changement de familles. */
export interface FamilyIndex {
  bySiteId: Map<string, CardFamily[]>;
  byTitle: Map<string, CardFamily[]>;
}

export function familyIndex(families: CardFamily[]): FamilyIndex {
  const bySiteId = new Map<string, CardFamily[]>();
  const byTitle = new Map<string, CardFamily[]>();
  const push = (m: Map<string, CardFamily[]>, k: string, f: CardFamily) => {
    const list = m.get(k);
    if (!list) m.set(k, [f]);
    else if (!list.includes(f)) list.push(f);
  };
  for (const f of families) {
    for (const c of f.cards) {
      push(bySiteId, c.siteId, f);
      push(byTitle, normalize(c.title), f);
    }
  }
  return { bySiteId, byTitle };
}

export function familiesOf(idx: FamilyIndex, siteId: string | null, title: string | null): CardFamily[] {
  return (siteId && idx.bySiteId.get(siteId)) || (title && idx.byTitle.get(normalize(title))) || [];
}
