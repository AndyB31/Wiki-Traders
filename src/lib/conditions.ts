/**
 * Conditions d'une règle d'étiquette en plus de la plage de prix : texte dans le nom ou la catégorie, famille,
 * taux de vente. Chaque condition répond oui, non, ou « inconnu » (taux de vente pas encore lu ou trop peu
 * d'enchères, prix inconnu) : l'étiquetage n'ajoute que sur un oui et ne retire que sur un non.
 *
 * Une règle peut avoir des alternatives (« ou ») : plage + conditions principales, OU plage + conditions de l'une
 * d'elles. Oui dès qu'un groupe répond oui ; non seulement si tous répondent non ; sinon inconnu.
 */
import { familiesOf, type FamilyIndex } from './families';
import { reliableRate, type SellRate } from './sellrate';
import { normalize } from './text';
import type { Card, RuleAlternative, RuleConditions, Settings, TagRule } from './types';

export type Tri = 'yes' | 'no' | 'unknown';

export interface ConditionContext {
  families?: FamilyIndex;
  sellRate?: (card: Card) => SellRate | null | undefined;
  /** Seuil d'enchères terminées du taux de vente (absent = SELL_RATE_MIN_SAMPLES). */
  settings?: Pick<Settings, 'sellRateMinSamples'>;
}

export const EMPTY_CONDITIONS: RuleConditions = { text: '', family: '', rateMin: null, rateMax: null };

/** Mots d'une condition texte (séparés par des virgules), sans accents ni majuscules. */
export function textWords(text: string): string[] {
  return text.split(',').map(normalize).filter(Boolean);
}

export function hasConditions(rule: Pick<TagRule, 'when'>): boolean {
  const w = rule.when;
  return !!w && (textWords(w.text).length > 0 || !!w.family.trim() || w.rateMin != null || w.rateMax != null);
}

/** Alternatives « ou » qui disent quelque chose (plage ou condition) ; les vides sont ignorées. */
export function alternativesOf(rule: Pick<TagRule, 'or'>): RuleAlternative[] {
  return (rule.or ?? []).filter((a) => hasRange(a) || hasConditions(a));
}

/**
 * Règle « à conditions » : conditions, ou alternatives « ou ». Elle pose son étiquette indépendamment des autres
 * (au contraire d'une plage de prix seule, où la carte ne reçoit que l'étiquette de la plage la plus étroite).
 */
export function isConditional(rule: Pick<TagRule, 'when' | 'or'>): boolean {
  return hasConditions(rule) || alternativesOf(rule).length > 0;
}

/** Le prix de la carte compte-t-il pour cette règle (une plage, principale ou dans une alternative) ? */
export function needsPrice(rule: Pick<TagRule, 'floor' | 'ceiling' | 'or'>): boolean {
  return hasRange(rule) || alternativesOf(rule).some(hasRange);
}

export function hasRange(rule: Pick<TagRule, 'floor' | 'ceiling'>): boolean {
  return rule.floor != null || rule.ceiling != null;
}

/** La règle sert-elle à l'étiquetage automatique (plage de prix ou condition) ? */
export function isAutoTagRule(rule: TagRule): boolean {
  return rule.active && (hasRange(rule) || isConditional(rule));
}

export function rangeStatus(rule: Pick<TagRule, 'floor' | 'ceiling'>, price: number | null): Tri {
  if (!hasRange(rule)) return 'yes';
  if (price == null) return 'unknown';
  return (rule.floor == null || price >= rule.floor) && (rule.ceiling == null || price <= rule.ceiling) ? 'yes' : 'no';
}

function all(list: Tri[]): Tri {
  if (list.includes('no')) return 'no';
  return list.includes('unknown') ? 'unknown' : 'yes';
}

function any(list: Tri[]): Tri {
  if (list.includes('yes')) return 'yes';
  return list.includes('unknown') ? 'unknown' : 'no';
}

/** Conditions de la règle hors plage de prix. */
export function conditionStatus(card: Card, rule: Pick<TagRule, 'when'>, ctx: ConditionContext): Tri {
  const w = rule.when;
  if (!w) return 'yes';
  const out: Tri[] = [];
  const words = textWords(w.text);
  if (words.length) {
    const hay = normalize(`${card.name} ${card.category ?? ''}`);
    out.push(words.some((word) => hay.includes(word)) ? 'yes' : 'no');
  }
  const family = normalize(w.family);
  if (family) {
    const mine = ctx.families ? familiesOf(ctx.families, card.siteId ?? null, card.name) : [];
    out.push(mine.some((f) => normalize(f.name) === family) ? 'yes' : 'no');
  }
  if (w.rateMin != null || w.rateMax != null) {
    const rate = reliableRate(ctx.sellRate?.(card), ctx.settings?.sellRateMinSamples);
    out.push(!rate ? 'unknown' : (w.rateMin == null || rate.pct >= w.rateMin) && (w.rateMax == null || rate.pct <= w.rateMax) ? 'yes' : 'no');
  }
  return all(out);
}

/** Plage de prix et conditions réunies, OU celles d'une des alternatives. */
export function ruleStatus(card: Card, rule: Pick<TagRule, 'floor' | 'ceiling' | 'when' | 'or'>, price: number | null, ctx: ConditionContext): Tri {
  const group = (g: Pick<TagRule, 'floor' | 'ceiling' | 'when'>) => all([rangeStatus(g, price), conditionStatus(card, g, ctx)]);
  return any([group(rule), ...alternativesOf(rule).map(group)]);
}

/** « 10–20 W », « ≥ 20 W », « ≤ 50 W » ; '' sans plage. */
export function rangeSummary(r: Pick<TagRule, 'floor' | 'ceiling'>): string {
  if (r.floor != null && r.ceiling != null) return `${r.floor}–${r.ceiling} W`;
  if (r.floor != null) return `≥ ${r.floor} W`;
  return r.ceiling != null ? `≤ ${r.ceiling} W` : '';
}

/**
 * Quand l'étiquette est posée, alternatives comprises : « (10–20 W · tdv ≥ 90 %) ou (20–100 W · tdv ≥ 70 %) ».
 * '' : ni plage ni condition.
 */
export function ruleSummary(rule: Pick<TagRule, 'floor' | 'ceiling' | 'when' | 'or'>): string {
  const group = (g: Pick<TagRule, 'floor' | 'ceiling' | 'when'>) => [rangeSummary(g), conditionsSummary(g)].filter(Boolean).join(' · ');
  const groups = [group(rule), ...alternativesOf(rule).map(group)];
  if (groups.length === 1) return groups[0];
  return groups.map((g) => `(${g || 'toutes les cartes'})`).join(' ou ');
}

/** Résumé lisible des conditions (« nom contient pays · famille Films · tdv ≥ 50 % »). */
export function conditionsSummary(rule: Pick<TagRule, 'when'>): string {
  const w = rule.when;
  if (!w) return '';
  const parts: string[] = [];
  const words = w.text.split(',').map((s) => s.trim()).filter(Boolean);
  if (words.length) parts.push(`nom contient ${words.map((x) => `« ${x} »`).join(' ou ')}`);
  if (w.family.trim()) parts.push(`famille ${w.family.trim()}`);
  if (w.rateMin != null && w.rateMax != null) parts.push(`tdv ${w.rateMin}–${w.rateMax} %`);
  else if (w.rateMin != null) parts.push(`tdv ≥ ${w.rateMin} %`);
  else if (w.rateMax != null) parts.push(`tdv ≤ ${w.rateMax} %`);
  return parts.join(' · ');
}
