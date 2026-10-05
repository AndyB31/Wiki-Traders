/**
 * Familles de cartes de l'extension « WikiMasters - Prix moyen collection » (kzfamily).
 * Elle les enregistre dans le localStorage du site sous `wm_families_v1` ; on les lit seulement.
 */
import { parseLegacyFamilies } from '../lib/families';
import type { CardFamily, Family, Rarity } from '../lib/types';

export const FAMILIES_KEY = 'wm_families_v1';
const RARITIES = new Set(['C', 'PC', 'R', 'SR', 'UR', 'L']);

export function parseFamilies(raw: string | null): Family[] {
  if (!raw) return [];
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(data)) return [];
  const out: Family[] = [];
  for (const f of data) {
    if (!f || typeof f !== 'object' || typeof f.name !== 'string' || !Array.isArray(f.cards)) continue;
    out.push({
      id: String(f.id ?? f.name),
      name: f.name.trim(),
      cards: f.cards
        .filter((c: Record<string, unknown>) => c && typeof c.id === 'string' && typeof c.title === 'string')
        .map((c: Record<string, unknown>) => ({
          siteId: c.id as string,
          name: (c.title as string).trim(),
          rarity: RARITIES.has(String(c.rarity)) ? (c.rarity as Rarity) : null,
          category: typeof c.category === 'string' ? c.category : null,
          owned: typeof c.owned === 'boolean' ? c.owned : typeof c.ownedCount === 'number' ? c.ownedCount > 0 : null,
        })),
    });
  }
  return out;
}

export function readFamilies(): Family[] {
  try {
    return parseFamilies(localStorage.getItem(FAMILIES_KEY));
  } catch {
    return [];
  }
}

/** Familles complètes de « Prix moyen collection » (toutes les cartes, couverture), prêtes à importer. */
export function readLegacyCardFamilies(existing: CardFamily[] = []): CardFamily[] {
  try {
    return parseLegacyFamilies(localStorage.getItem(FAMILIES_KEY), existing);
  } catch {
    return [];
  }
}
