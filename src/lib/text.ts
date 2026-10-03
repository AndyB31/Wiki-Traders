import type { Rarity } from './types';

/** Libellés et images de rareté utilisés par WikiMasters (RARITY_CONFIG du site). */
export const RARITIES: Record<Rarity, { label: string; image: string; order: number }> = {
  C: { label: 'Commun', image: 'commun', order: 0 },
  PC: { label: 'Peu Commun', image: 'peu_commun', order: 1 },
  R: { label: 'Rare', image: 'rare', order: 2 },
  SR: { label: 'Super Rare', image: 'super_rare', order: 3 },
  UR: { label: 'Ultra Rare', image: 'ultra_rare', order: 4 },
  L: { label: 'Légendaire', image: 'legendaire', order: 5 },
};

export function normalize(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[  ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export function slugify(s: string): string {
  return normalize(s)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function sameTag(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  return normalize(a).replace(/\s/g, '') === normalize(b).replace(/\s/g, '');
}

/** « 1 250 », « 1.250 », « 1,5k », « 86 💰 » → nombre. */
export function parseNumber(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const s = raw.replace(/[  ]/g, ' ');
  const m = s.match(/(\d{1,3}(?:[ .]\d{3})+|\d+)(?:[,.](\d+))?\s*([kKmM])?(?![\d])/);
  if (!m) return null;
  let n = Number(m[1].replace(/[ .]/g, ''));
  if (m[2]) n += Number(`0.${m[2]}`);
  if (m[3]) n *= m[3].toLowerCase() === 'k' ? 1_000 : 1_000_000;
  return Number.isFinite(n) ? n : null;
}

/**
 * Durée restante en ms à partir d'un texte affiché : « 2 j 3 h », « 1 h 12 min »,
 * « 12min 30s », « 05:12:33 », « Terminée ». null si rien n'est reconnu.
 */
export function parseCountdown(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const s = normalize(raw)
    .replace(/(\d)([a-z])/g, '$1 $2')
    .replace(/([a-z])(\d)/g, '$1 $2');
  const future = /\b(dans|restant|reste|in)\b/.test(s);
  if (!future && /\b(terminee?|expiree?|finie?|ended|vendue?|adjugee?)\b/.test(s)) return 0;

  const clock = s.match(/\b(?:(\d+):)?(\d{1,2}):(\d{2}):(\d{2})\b|\b(\d{1,2}):(\d{2})\b/);
  const units: Array<[RegExp, number]> = [
    [/(\d+)\s*(?:j|jours?|d|days?)\b/, 86_400_000],
    [/(\d+)\s*(?:h|heures?|hrs?|hours?)\b/, 3_600_000],
    [/(\d+)\s*(?:min|mn|minutes?|m)\b/, 60_000],
    [/(\d+)\s*(?:s|sec|secondes?|seconds?)\b/, 1_000],
  ];
  let total = 0;
  let found = false;
  for (const [re, mult] of units) {
    const m = s.match(re);
    if (m) {
      total += Number(m[1]) * mult;
      found = true;
    }
  }
  // « 1 h 12 » : minutes sans unité après les heures.
  const hm = s.match(/(\d+)\s*h\s+(\d{1,2})(?!\s*(?:[a-z]|\d|:))/);
  if (hm && !/(\d+)\s*(?:min|mn|minutes?|m)\b/.test(s)) total += Number(hm[2]) * 60_000;
  if (found) return total;

  if (clock) {
    if (clock[3] !== undefined) {
      const d = Number(clock[1] ?? 0);
      return ((d * 24 + Number(clock[2])) * 60 + Number(clock[3])) * 60_000 + Number(clock[4]) * 1_000;
    }
    // « mm:ss » ambigu avec une heure : on ne l'accepte que précédé de « dans ».
    if (/dans|restant|reste/.test(s)) return (Number(clock[5]) * 60 + Number(clock[6])) * 1_000;
  }
  return null;
}

/** Repère une rareté dans un texte ou du HTML (libellé, image de fond, variable CSS, classe). */
export function detectRarity(text: string, html = ''): Rarity | null {
  const h = html.toLowerCase();
  const byImage = h.match(/\/(peu_commun|commun|super_rare|ultra_rare|rare|legendaire)\.(?:png|webp|jpg)/);
  if (byImage) return (Object.keys(RARITIES) as Rarity[]).find((k) => RARITIES[k].image === byImage[1]) ?? null;
  const byVar = h.match(/rarity-(pc|sr|ur|c|r|l)\b/);
  if (byVar) return byVar[1].toUpperCase() as Rarity;
  const t = normalize(text);
  const order: Rarity[] = ['PC', 'SR', 'UR', 'L', 'C', 'R'];
  for (const r of order) {
    const label = normalize(RARITIES[r].label);
    if (new RegExp(`(^|[^a-z])${label}([^a-z]|$)`).test(t)) return r;
  }
  return null;
}

export function formatDuration(ms: number): string {
  if (ms <= 0) return 'maintenant';
  const min = Math.round(ms / 60_000);
  if (min < 1) return '< 1 min';
  const d = Math.floor(min / 1440);
  const h = Math.floor((min % 1440) / 60);
  const m = min % 60;
  if (d) return `${d} j ${h} h`;
  if (h) return `${h} h ${String(m).padStart(2, '0')}`;
  return `${m} min`;
}

export function formatPrice(n: number | null | undefined): string {
  if (n == null) return '—';
  return Math.round(n).toLocaleString('fr-FR');
}
