/**
 * Conditions d'une règle d'étiquette en plus de la plage de prix : texte dans le nom ou la catégorie, famille,
 * taux de vente. Chaque condition répond oui, non, ou « inconnu » (taux de vente pas encore lu ou trop peu
 * d'enchères, prix inconnu) : l'étiquetage n'ajoute que sur un oui et ne retire que sur un non.
 */
import { familiesOf, type FamilyIndex } from './families';
import { reliableRate, type SellRate } from './sellrate';
import { normalize } from './text';
import type { Card, RuleConditions, Settings, TagRule } from './types';

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

export function hasRange(rule: Pick<TagRule, 'floor' | 'ceiling'>): boolean {
  return rule.floor != null || rule.ceiling != null;
}

/** La règle sert-elle à l'étiquetage automatique (plage de prix ou condition) ? */
export function isAutoTagRule(rule: TagRule): boolean {
  return rule.active && (hasRange(rule) || hasConditions(rule));
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

/** Plage de prix et conditions réunies. */
export function ruleStatus(card: Card, rule: TagRule, price: number | null, ctx: ConditionContext): Tri {
  return all([rangeStatus(rule, price), conditionStatus(card, rule, ctx)]);
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
