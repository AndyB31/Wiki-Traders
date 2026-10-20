/**
 * Calcul du prix de départ et priorité des cartes à vendre.
 *
 * Calcul simple (B1) :
 *   prix de départ = prix moyen × mise de départ × bonus du taux de vente
 *   bonus          = 1 + influence × (tdv − 50 %) × confiance
 *   confiance      = min(1, enchères terminées ÷ enchères pour être sûr)
 * Une carte qui part toute seule monte, une carte qui ne part pas baisse ; sur peu d'enchères, le taux de vente ne
 * compte presque pas (1 vente sur 2 enchères ne fait pas un 50 % fiable).
 *
 * Priorité « équilibrée » : prix de départ × chance de vente, la chance étant le taux de vente pondéré par la même
 * confiance (une carte inconnue compte pour 50 %).
 */
import type { SellRate } from './sellrate';
import type { PriceCalc, PriceTier, Priority, SellRateRule, TagRule } from './types';

export const DEFAULT_CALC: PriceCalc = {
  mode: 'simple',
  pct: 70,
  tdvWeight: 50,
  trustSales: 10,
  formula: '{prix} * 0.7 * (1 + 0.5 * ({tdv} - 50) / 100 * {confiance})',
  minPrice: null,
  maxPrice: null,
};

/** Calcul « par défaut » (option A) d'un palier ou d'une étiquette. */
export function inheritCalc(): PriceCalc {
  return { ...DEFAULT_CALC, mode: 'default' };
}

/** Confiance dans le taux de vente : 0 sans enchère, 1 à partir de `trustSales` enchères terminées. */
export function confidence(rate: SellRate | null | undefined, trustSales: number): number {
  if (!rate?.total) return 0;
  return Math.min(1, rate.total / Math.max(1, trustSales));
}

/** Bonus du taux de vente du calcul simple (1 = prix inchangé). */
export function rateBonus(rate: SellRate | null | undefined, calc: Pick<PriceCalc, 'tdvWeight' | 'trustSales'>): number {
  if (!rate?.total) return 1;
  return Math.max(0, 1 + (calc.tdvWeight / 100) * ((rate.pct - 50) / 100) * confidence(rate, calc.trustSales));
}

/** Prix brut du calcul simple (avant bornes et arrondi). */
export function simplePrice(base: number, rate: SellRate | null | undefined, calc: PriceCalc): number {
  return ((base * calc.pct) / 100) * rateBonus(rate, calc);
}

/** Calcul effectivement appliqué : celui de la règle, sinon le calcul par défaut. */
export function effectiveCalc(calc: PriceCalc | undefined, defaultCalc: PriceCalc): PriceCalc {
  return calc && calc.mode !== 'default' ? calc : defaultCalc;
}

/** Bornes min / max d'un calcul. */
export function clampPrice(value: number, calc: Pick<PriceCalc, 'minPrice' | 'maxPrice'>): number {
  let v = value;
  if (calc.minPrice != null && v < calc.minPrice) v = calc.minPrice;
  if (calc.maxPrice != null && v > calc.maxPrice) v = calc.maxPrice;
  return v;
}

/**
 * Chance de vente (0 à 1) d'après l'historique : borne basse de Wilson (confiance ~80 %) du taux de vente, avec un
 * a priori neutre (une vente et un invendu fictifs). Le nombre d'enchères compte autant que le taux : 900 ventes sur
 * 1 000 (≈ 0,88) passent loin devant 1 sur 1 (≈ 0,33) ; une carte jamais mise en vente vaut ≈ 0,17.
 */
export function sellChance(rate: Pick<SellRate, 'sold' | 'total'> | null | undefined): number {
  const n = (rate?.total ?? 0) + 2;
  const p = ((rate?.sold ?? 0) + 1) / n;
  const z = 1.28;
  const z2 = z * z;
  return (p + z2 / (2 * n) - z * Math.sqrt((p * (1 - p) + z2 / (4 * n)) / n)) / (1 + z2 / n);
}

export const PRIORITIES: { id: Priority; label: string; help: string }[] = [
  { id: 'balanced', label: 'Équilibrée', help: 'Ce qui rapporte le plus en moyenne : prix de départ × chance de vente. La chance tient compte du nombre de ventes : 90 % sur 900 ventes passe devant 100 % sur 1 vente.' },
  { id: 'value', label: 'Rapporter le plus', help: 'Le prix de départ le plus haut d\'abord.' },
  { id: 'fast', label: 'Vendre vite', help: 'La meilleure chance de vente d\'abord (taux de vente et nombre de ventes), puis le prix le plus haut.' },
  { id: 'clear', label: 'Écouler', help: 'Le plus d\'exemplaires en trop d\'abord, puis le prix le plus bas.' },
  { id: 'custom', label: 'Mes critères', help: 'Tes critères, dans l\'ordre (chacun départage les égalités du précédent).' },
  { id: 'formula', label: 'Ma formule', help: 'Ta formule : le score le plus haut d\'abord.' },
];

/** « 21–50 W », « 101 W et + », « jusqu'à 20 W », « Toutes les cartes ». */
export function tierLabel(t: Pick<PriceTier, 'from' | 'to'>): string {
  if (t.from == null && t.to == null) return 'Toutes les cartes';
  if (t.from == null) return `jusqu'à ${t.to} W`;
  if (t.to == null) return `${t.from} W et +`;
  return `${t.from}–${t.to} W`;
}

/** Paliers qui se chevauchent (le premier l'emporte, mais c'est sans doute une erreur de saisie). */
export function overlappingTiers(tiers: Pick<PriceTier, 'from' | 'to' | 'active'>[]): [number, number] | null {
  for (let i = 0; i < tiers.length; i++) {
    for (let j = i + 1; j < tiers.length; j++) {
      const a = tiers[i];
      const b = tiers[j];
      if (!a.active || !b.active) continue;
      if ((a.from ?? -Infinity) <= (b.to ?? Infinity) && (b.from ?? -Infinity) <= (a.to ?? Infinity)) return [i, j];
    }
  }
  return null;
}

let tierSeq = 0;
export function newTier(from: number | null, to: number | null): PriceTier {
  return { id: `t-${Date.now()}-${++tierSeq}`, active: true, from, to, slots: 1, calc: inheritCalc(), durationMin: null };
}

/** Proposition de paliers : petites, moyennes et grosses cartes, toutes au calcul par défaut. */
export function defaultTiers(): PriceTier[] {
  return [newTier(null, 20), newTier(21, 100), newTier(101, null)];
}

/**
 * Règle de vente interne d'un palier (mode « meilleures cartes ») : le reste du moteur (répartition, popup, pastilles)
 * traite un palier comme une étiquette dont les cartes sont celles du filtre d'étiquettes dans la plage de prix.
 */
export function tierRule(t: PriceTier, keepMin: number): TagRule {
  return {
    id: t.id,
    tag: tierLabel(t),
    quota: t.slots,
    floor: t.from,
    ceiling: t.to,
    keepMin,
    active: t.active,
    match: 'price',
    calc: t.calc,
    durationMin: t.durationMin,
    tier: true,
  };
}

// ---------------------------------------------------------------------------
// Réglages d'avant les paliers de prix
// ---------------------------------------------------------------------------

/** Paliers de taux de vente (ancien format) traduits en formule, pour garder exactement les mêmes prix. */
export function legacyFormula(pct: number, tiers: SellRateRule[]): string {
  const base = `{prix} * ${pct / 100}`;
  if (!tiers.length) return base;
  const cond = (r: SellRateRule) => [r.from != null ? `{tdv} >= ${r.from}` : '', r.to != null ? `{tdv} <= ${r.to}` : ''].filter(Boolean).join(' && ') || '1';
  const nested = tiers.reduceRight((acc, r) => `si(${cond(r)}, ${r.pricePct / 100}, ${acc})`, '1');
  return `${base} * si({tdv_fiable}, ${nested}, 1)`;
}

/** Calcul d'une étiquette d'avant la 1.0 : mise de départ en %, éventuels paliers de taux de vente. */
export function legacyCalc(pct: number, tiers: SellRateRule[], defaultCalc: PriceCalc): PriceCalc {
  if (tiers.length) return { ...defaultCalc, mode: 'formula', pct, formula: legacyFormula(pct, tiers) };
  // Même prix qu'avant : mise de départ seule, sans influence du taux de vente.
  return { ...defaultCalc, mode: 'simple', pct, tdvWeight: 0 };
}
