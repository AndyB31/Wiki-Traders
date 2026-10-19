/**
 * Logique pure de la page Réglages (sans DOM) : résumés, aperçus, validation et détection des modifications.
 * Testée à part (tests/options-logic.test.ts) ; options.ts ne fait que l'afficher.
 */
import { quotaSum } from '../lib/allocation';
import { durationLabel, overlappingDurations } from '../lib/duration';
import { roundTo } from '../lib/pricing';
import { formulaError } from '../lib/formula';
import { overlappingRateRules } from '../lib/sellrate';
import type { DurationRule, SellRateRule, Settings, TagRule } from '../lib/types';

/** Prix moyen pris pour illustrer le % d'une étiquette. */
export const EXAMPLE_PRICE = 40;

/** Durée gardée par le site quand aucun palier ne correspond (minutes). */
export const SITE_DEFAULT_MINUTES = 60;

/** « Proposition par défaut » des paliers : petites mises en 10 min, moyennes en 1 h, grosses en 3 h. */
export const DEFAULT_DURATION_TIERS: DurationRule[] = [
  { from: 0, to: 20, minutes: 10 },
  { from: 21, to: 100, minutes: 60 },
  { from: 101, to: null, minutes: 180 },
];

const plural = (n: number, word: string) => `${n} ${word}${n > 1 ? 's' : ''}`;

// ---------------------------------------------------------------------------
// Quotas
// ---------------------------------------------------------------------------

export interface QuotaSummary {
  /** Somme des quotas des règles actives. */
  sum: number;
  slots: number;
  /** ok = quotas égaux aux slots ; under = slots libres ; over = trop de quotas. */
  status: 'ok' | 'under' | 'over';
  /** Ex. « 5 slots : 1 × 50-100, 4 × 20-50 ». */
  text: string;
  /** Explication du statut en une phrase. */
  message: string;
}

export function quotaSummary(rules: TagRule[], slots: number): QuotaSummary {
  const active = rules.filter((r) => r.active && r.quota > 0);
  const sum = quotaSum(rules);
  const parts = active.map((r) => `${r.quota} × ${r.tag.trim() || '(sans nom)'}`);
  const text = parts.length ? `${plural(sum, 'slot')} : ${parts.join(', ')}` : 'Aucun slot réservé';
  const status: QuotaSummary['status'] = sum === slots ? 'ok' : sum < slots ? 'under' : 'over';
  const message =
    status === 'ok'
      ? `Tes ${plural(slots, 'slot')} sont tous attribués.`
      : status === 'under'
        ? `${plural(slots - sum, 'slot')} sur ${slots} sans étiquette : rien ne lui sera proposé (sauf étiquette de secours).`
        : `Les quotas (${sum}) dépassent tes ${plural(slots, 'slot')} : baisse un quota ou augmente le nombre de slots.`;
  return { sum, slots, status, text, message };
}

// ---------------------------------------------------------------------------
// Prix : % du prix moyen et arrondi
// ---------------------------------------------------------------------------

/** Mise de départ conseillée pour une carte au prix moyen donné (même calcul que computePrice). */
export function startPrice(base: number, pct: number, rounding: number): number | null {
  if (!Number.isFinite(pct) || pct <= 0) return null;
  return roundTo((base * pct) / 100, rounding);
}

/** « ex. carte à 40 W → départ 28 W ». */
export function pctExample(pct: number, rounding: number, base = EXAMPLE_PRICE): string {
  const p = startPrice(base, pct, rounding);
  return p == null ? 'le % doit être positif' : `ex. carte à ${base} W → départ ${p} W`;
}

/** Effet d'un palier de taux de vente : « ex. départ 28 W → 23 W » (100 % = inchangé). */
export function rateTierExample(pricePct: number, rounding: number, start = 28): string {
  if (!Number.isFinite(pricePct) || pricePct <= 0) return 'le % doit être positif';
  return pricePct === 100 ? `ex. départ ${start} W, inchangé` : `ex. départ ${start} W → ${roundTo((start * pricePct) / 100, rounding)} W`;
}

/** Exemples d'arrondi : « 17 → 17 W · 63 → 65 W · 238 → 240 W ». */
export function roundingExamples(step: number, values = [17, 63, 238]): string {
  return values.map((v) => `${v} → ${roundTo(v, step)} W`).join(' · ');
}

// ---------------------------------------------------------------------------
// Paliers de durée
// ---------------------------------------------------------------------------

function tierRange(r: DurationRule): string {
  if (r.from == null && r.to == null) return 'tous les prix';
  if (r.to == null) return `${r.from} W et +`;
  if (r.from == null) return `jusqu'à ${r.to} W`;
  return r.from === r.to ? `${r.from} W` : `${r.from}–${r.to} W`;
}

/** Vrai si tous les prix entiers ≥ 0 tombent dans un palier. */
export function tiersCoverAll(rules: DurationRule[]): boolean {
  const sorted = [...rules].sort((a, b) => (a.from ?? -Infinity) - (b.from ?? -Infinity));
  let next = 0; // plus petit prix pas encore couvert
  for (const r of sorted) {
    if ((r.from ?? -Infinity) > next) return false;
    if (r.to == null) return true;
    next = Math.max(next, Math.floor(r.to) + 1);
  }
  return false;
}

/** Morceaux de l'aperçu : [« 0–20 W → 10 min », « 21–100 W → 1 h », …] (+ « autres prix → … » s'il reste des trous). */
export function tiersPreviewParts(rules: DurationRule[]): string[] {
  const def = `durée du site (${durationLabel(SITE_DEFAULT_MINUTES)})`;
  if (!rules.length) return [`Aucun palier : toujours la ${def}`];
  const parts = rules.map((r) => `${tierRange(r)} → ${durationLabel(r.minutes)}`);
  if (!tiersCoverAll(rules)) parts.push(`autres prix → ${def}`);
  return parts;
}

/** « 0–20 W → 10 min · 21–100 W → 1 h · 101 W et + → 3 h ». */
export function tiersPreview(rules: DurationRule[]): string {
  return tiersPreviewParts(rules).join(' · ');
}

/** Palier suivant à ajouter : commence juste après le dernier. */
export function nextTier(rules: DurationRule[]): DurationRule {
  const last = rules[rules.length - 1];
  const from = last?.to != null ? last.to + 1 : last ? null : 0;
  return { from, to: null, minutes: SITE_DEFAULT_MINUTES };
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export type OptionsSection = 'rules' | 'pricing' | 'durations' | 'sellRate' | 'advanced';

export interface ValidationError {
  section: OptionsSection;
  /** Champs concernés : « slots », « rule:<id>:tag », « dur:<i>:from »… */
  keys: string[];
  message: string;
}

/** Paliers de durée : « de » > « à », chevauchements. `prefix` : préfixe des champs (« » global, « rule:<id>: » par étiquette). */
function durationErrors(rows: DurationRule[], section: OptionsSection, prefix: string, label: string): ValidationError[] {
  const errors: ValidationError[] = [];
  for (const [i, d] of rows.entries()) {
    if (d.from != null && d.to != null && d.from > d.to) {
      errors.push({ section, keys: [`${prefix}dur:${i}:from`, `${prefix}dur:${i}:to`], message: `${label}Palier de durée ${i + 1} : « de » dépasse « à ».` });
    }
  }
  const overlap = overlappingDurations(rows);
  if (overlap) {
    errors.push({ section, keys: overlap.flatMap((i) => [`${prefix}dur:${i}:from`, `${prefix}dur:${i}:to`]), message: `${label}Les paliers de durée ${overlap[0] + 1} et ${overlap[1] + 1} se chevauchent.` });
  }
  return errors;
}

/** Paliers de taux de vente et tdv minimum. */
function rateErrors(min: number | null, rows: SellRateRule[], section: OptionsSection, prefix: string, label: string): ValidationError[] {
  const errors: ValidationError[] = [];
  if (min != null && (min < 0 || min > 100)) errors.push({ section, keys: [`${prefix}minSellRate`], message: `${label}Le taux de vente minimum doit être entre 0 et 100 %.` });
  for (const [i, r] of rows.entries()) {
    if (r.from != null && r.to != null && r.from > r.to) {
      errors.push({ section, keys: [`${prefix}tdv:${i}:from`, `${prefix}tdv:${i}:to`], message: `${label}Palier de taux de vente ${i + 1} : « de » dépasse « à ».` });
    }
    if (!(r.pricePct > 0 && r.pricePct <= 500)) errors.push({ section, keys: [`${prefix}tdv:${i}:pricePct`], message: `${label}Palier de taux de vente ${i + 1} : le % du prix doit être entre 1 et 500 (100 = prix inchangé).` });
  }
  const overlap = overlappingRateRules(rows);
  if (overlap) {
    errors.push({ section, keys: overlap.flatMap((i) => [`${prefix}tdv:${i}:from`, `${prefix}tdv:${i}:to`]), message: `${label}Les paliers de taux de vente ${overlap[0] + 1} et ${overlap[1] + 1} se chevauchent.` });
  }
  return errors;
}

/** Conditions et réglages de vente propres à une étiquette. */
function ruleExtraErrors(r: TagRule): ValidationError[] {
  const label = `« ${r.tag.trim() || 'sans nom'} » : `;
  const prefix = `rule:${r.id}:`;
  const errors: ValidationError[] = [];
  const w = r.when;
  if (w) {
    for (const k of ['rateMin', 'rateMax'] as const) {
      const v = w[k];
      if (v != null && (v < 0 || v > 100)) errors.push({ section: 'rules', keys: [`${prefix}${k}`], message: `${label}le taux de vente des conditions doit être entre 0 et 100 %.` });
    }
    if (w.rateMin != null && w.rateMax != null && w.rateMin > w.rateMax) {
      errors.push({ section: 'rules', keys: [`${prefix}rateMin`, `${prefix}rateMax`], message: `${label}taux de vente : « de » dépasse « à ».` });
    }
  }
  const s = r.sale;
  if (s) {
    errors.push(...rateErrors(s.minSellRate, s.sellRateRules, 'rules', prefix, label), ...durationErrors(s.durationRules, 'rules', prefix, label));
    if (s.sort === 'score') {
      const err = s.score.trim() ? formulaError(s.score) : 'formule vide';
      if (err) errors.push({ section: 'rules', keys: [`${prefix}score`], message: `${label}formule de score : ${err}.` });
    }
  }
  return errors;
}

/** Toutes les erreurs (l'enregistrement est bloqué tant qu'il en reste). */
export function validateOptions(rules: TagRule[], settings: Settings, extra: { selectorsInvalid?: boolean } = {}): ValidationError[] {
  const errors: ValidationError[] = [];
  const sum = quotaSum(rules);
  // Mode « meilleures cartes » : les quotas ne servent pas.
  if (sum > settings.slots && settings.allocationMode !== 'pool') {
    errors.push({
      section: 'rules',
      keys: ['slots', ...rules.filter((r) => r.active).map((r) => `rule:${r.id}:quota`)],
      message: `La somme des quotas (${sum}) dépasse le nombre de slots (${settings.slots}).`,
    });
  }
  const seen = new Map<string, string>();
  for (const r of rules) {
    const tag = r.tag.trim().toLowerCase();
    if (!tag) {
      errors.push({ section: 'rules', keys: [`rule:${r.id}:tag`], message: 'Chaque règle doit avoir une étiquette.' });
      continue;
    }
    const other = seen.get(tag);
    if (other) errors.push({ section: 'rules', keys: [`rule:${other}:tag`, `rule:${r.id}:tag`], message: `Deux règles ont la même étiquette « ${r.tag.trim()} ».` });
    else seen.set(tag, r.id);
  }
  for (const r of rules) {
    if (r.floor != null && r.ceiling != null && r.floor > r.ceiling) {
      errors.push({ section: 'rules', keys: [`rule:${r.id}:floor`, `rule:${r.id}:ceiling`], message: `« ${r.tag} » : le plancher dépasse le plafond.` });
    }
    if (!(r.pct > 0)) errors.push({ section: 'rules', keys: [`rule:${r.id}:pct`], message: `« ${r.tag} » : le % doit être positif.` });
    errors.push(...ruleExtraErrors(r));
  }
  errors.push(...durationErrors(settings.durationRules, 'durations', '', ''));
  errors.push(...rateErrors(settings.minSellRate, settings.sellRateRules, 'sellRate', '', ''));
  if (!(Number.isInteger(settings.sellRateMinSamples) && settings.sellRateMinSamples >= 1 && settings.sellRateMinSamples <= 1000)) {
    errors.push({ section: 'sellRate', keys: ['sellRateMinSamples'], message: 'Le nombre d\'enchères terminées doit être un entier entre 1 et 1 000.' });
  }
  if (extra.selectorsInvalid) errors.push({ section: 'advanced', keys: ['selectors'], message: 'JSON des sélecteurs invalide.' });
  return errors;
}

// ---------------------------------------------------------------------------
// Modifications non enregistrées
// ---------------------------------------------------------------------------

/** JSON à clés triées : deux états identiques donnent la même chaîne, quel que soit l'ordre des clés. */
export function stableStringify(value: unknown): string {
  return JSON.stringify(value, (_k, v: unknown) =>
    v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : v,
  );
}

export interface EditableState {
  rules: TagRule[];
  settings: Settings;
  manualPrices: Record<string, number>;
}

export function snapshot(state: EditableState): string {
  return stableStringify(state);
}

export function isDirty(baseline: string, state: EditableState): boolean {
  return snapshot(state) !== baseline;
}

// ---------------------------------------------------------------------------
// Démarrage rapide
// ---------------------------------------------------------------------------

export type QuickCheckId = 'collection' | 'api' | 'rules' | 'quotas';

export interface QuickCheck {
  id: QuickCheckId;
  ok: boolean;
  label: string;
  detail: string;
}

export function quickStartChecks(input: { cardCount: number; rules: TagRule[]; settings: Settings }): QuickCheck[] {
  const { cardCount, rules, settings } = input;
  const active = rules.filter((r) => r.active && r.tag.trim());
  const q = quotaSummary(rules, settings.slots);
  return [
    {
      id: 'collection',
      ok: cardCount > 0,
      label: 'Collection connue',
      detail: cardCount > 0 ? `${plural(cardCount, 'carte')} relevée${cardCount > 1 ? 's' : ''}.` : 'Ouvre ta collection sur le site pour que Wiki-Traders la relève.',
    },
    {
      id: 'api',
      ok: settings.apiRead,
      label: 'Lecture via l\'API',
      detail: settings.apiRead ? 'Prix et ventes lus directement, plus rapide et plus complet.' : 'Désactivée : plusieurs fonctionnalités (prix moyens, mises) en ont besoin.',
    },
    {
      id: 'rules',
      ok: active.length > 0,
      label: 'Étiquettes à vendre',
      detail: active.length ? `${plural(active.length, 'étiquette')} active${active.length > 1 ? 's' : ''}.` : 'Aucune étiquette active : rien ne sera proposé à la vente.',
    },
    { id: 'quotas', ok: q.status === 'ok', label: 'Quotas = slots', detail: q.message },
  ];
}
