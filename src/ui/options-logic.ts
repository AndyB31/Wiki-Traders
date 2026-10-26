/**
 * Logique pure de la page Réglages (sans DOM) : résumés, aperçus, validation et détection des modifications.
 * Testée à part (tests/options-logic.test.ts) ; options.ts ne fait que l'afficher.
 */
import { quotaSum } from '../lib/allocation';
import { durationLabel, overlappingDurations } from '../lib/duration';
import { roundTo } from '../lib/pricing';
import { formulaError } from '../lib/formula';
import { overlappingRateRules } from '../lib/sellrate';
import { overlappingTiers, tierLabel } from '../lib/salecalc';
import type { DurationRule, PriceCalc, SellRateRule, Settings, TagRule } from '../lib/types';

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

export type OptionsSection = 'rules' | 'pricing' | 'tiers' | 'priority' | 'families' | 'durations' | 'sellRate' | 'advanced';

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
  (r.or ?? []).forEach((alt, i) => {
    const ap = `${prefix}or:${alt.id}:`;
    const n = `${label}« ou » n° ${i + 2} : `;
    if (alt.floor != null && alt.ceiling != null && alt.floor > alt.ceiling) errors.push({ section: 'rules', keys: [`${ap}floor`, `${ap}ceiling`], message: `${n}le plancher dépasse le plafond.` });
    for (const k of ['rateMin', 'rateMax'] as const) {
      const v = alt.when[k];
      if (v != null && (v < 0 || v > 100)) errors.push({ section: 'rules', keys: [`${ap}${k}`], message: `${n}le taux de vente doit être entre 0 et 100 %.` });
    }
    if (alt.when.rateMin != null && alt.when.rateMax != null && alt.when.rateMin > alt.when.rateMax) {
      errors.push({ section: 'rules', keys: [`${ap}rateMin`, `${ap}rateMax`], message: `${n}taux de vente : « de » dépasse « à ».` });
    }
  });
  if (r.calc) errors.push(...calcErrors(r.calc, 'rules', prefix, label));
  return errors;
}

/** Calcul du prix (par défaut, d'un palier ou d'une étiquette). `prefix` : préfixe des champs, ex. « tier:<id>: ». */
export function calcErrors(c: PriceCalc, section: OptionsSection, prefix: string, label: string): ValidationError[] {
  const errors: ValidationError[] = [];
  if (c.mode === 'default') return errors;
  if (c.mode === 'simple') {
    if (!(c.pct > 0 && c.pct <= 500)) errors.push({ section, keys: [`${prefix}pct`], message: `${label}la mise de départ doit être entre 1 et 500 %.` });
    if (!(c.tdvWeight >= 0 && c.tdvWeight <= 100)) errors.push({ section, keys: [`${prefix}tdvWeight`], message: `${label}l'influence du taux de vente doit être entre 0 et 100 %.` });
    if (!(c.trustSales >= 1)) errors.push({ section, keys: [`${prefix}trustSales`], message: `${label}le nombre d'enchères pour être sûr doit être d'au moins 1.` });
  } else {
    const err = c.formula.trim() ? formulaError(c.formula) : 'formule vide';
    if (err) errors.push({ section, keys: [`${prefix}formula`], message: `${label}formule : ${err}.` });
  }
  if (c.minPrice != null && c.maxPrice != null && c.minPrice > c.maxPrice) {
    errors.push({ section, keys: [`${prefix}minPrice`, `${prefix}maxPrice`], message: `${label}le prix minimum dépasse le maximum.` });
  }
  return errors;
}

/** Toutes les erreurs (l'enregistrement est bloqué tant qu'il en reste). */
export function validateOptions(rules: TagRule[], settings: Settings, extra: { selectorsInvalid?: boolean } = {}): ValidationError[] {
  const errors: ValidationError[] = [];
  const sum = quotaSum(rules);
  const pool = settings.allocationMode === 'pool';
  // Mode « meilleures cartes » : les quotas des étiquettes ne servent pas.
  if (sum > settings.slots && !pool) {
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
    errors.push(...ruleExtraErrors(r));
  }
  errors.push(...durationErrors(settings.durationRules, 'durations', '', ''));
  errors.push(...rateErrors(settings.minSellRate, [], 'sellRate', '', ''));
  errors.push(...calcErrors(settings.defaultCalc, 'pricing', 'calc:', 'Calcul par défaut : '));
  if (pool) errors.push(...tierErrors(settings));
  for (const ft of settings.familyTags) {
    if (!ft.family.trim()) errors.push({ section: 'families', keys: [`famtag:${ft.id}:family`], message: 'Choisis la famille à étiqueter.' });
    if (!ft.tag.trim()) errors.push({ section: 'families', keys: [`famtag:${ft.id}:tag`], message: `Famille ${ft.family || '?'} : indique l'étiquette à poser.` });
  }
  if (settings.priority === 'formula') {
    const err = settings.priorityFormula.trim() ? formulaError(settings.priorityFormula) : 'formule vide';
    if (err) errors.push({ section: 'priority', keys: ['priorityFormula'], message: `Formule de priorité : ${err}.` });
  }
  if (!(Number.isInteger(settings.sellRateMinSamples) && settings.sellRateMinSamples >= 1 && settings.sellRateMinSamples <= 1000)) {
    errors.push({ section: 'sellRate', keys: ['sellRateMinSamples'], message: 'Le nombre d\'enchères terminées doit être un entier entre 1 et 1 000.' });
  }
  if (extra.selectorsInvalid) errors.push({ section: 'advanced', keys: ['selectors'], message: 'JSON des sélecteurs invalide.' });
  return errors;
}

/** Paliers de prix du mode « meilleures cartes ». */
export function tierErrors(settings: Settings): ValidationError[] {
  const errors: ValidationError[] = [];
  for (const t of settings.priceTiers) {
    const label = `Palier ${tierLabel(t)} : `;
    if (t.from != null && t.to != null && t.from > t.to) errors.push({ section: 'tiers', keys: [`tier:${t.id}:from`, `tier:${t.id}:to`], message: `${label}« de » dépasse « à ».` });
    errors.push(...calcErrors(t.calc, 'tiers', `tier:${t.id}:`, label));
  }
  const overlap = overlappingTiers(settings.priceTiers);
  if (overlap) {
    const [a, b] = overlap.map((i) => settings.priceTiers[i]);
    errors.push({ section: 'tiers', keys: [a, b].flatMap((t) => [`tier:${t.id}:from`, `tier:${t.id}:to`]), message: `Les paliers ${tierLabel(a)} et ${tierLabel(b)} se chevauchent.` });
  }
  if (settings.reserveTierSlots) {
    const sum = settings.priceTiers.filter((t) => t.active).reduce((n, t) => n + t.slots, 0);
    if (sum > settings.slots) {
      errors.push({ section: 'tiers', keys: ['slots', ...settings.priceTiers.map((t) => `tier:${t.id}:slots`)], message: `Les slots réservés par palier (${sum}) dépassent ton nombre de slots (${settings.slots}).` });
    }
  }
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
  const pool = settings.allocationMode === 'pool';
  const filter = settings.saleTags;
  const sales: QuickCheck = pool
    ? {
        id: 'rules',
        ok: filter.mode === 'exclude' || filter.tags.length > 0,
        label: 'Cartes à vendre',
        detail: filter.mode === 'exclude' ? (filter.tags.length ? `Toutes sauf ${filter.tags.join(', ')}.` : 'Toutes tes cartes (sauf favoris et exemplaires gardés).') : filter.tags.length ? `Celles avec ${filter.tags.join(', ')}.` : 'Aucune étiquette choisie : rien ne sera proposé.',
      }
    : {
        id: 'rules',
        ok: active.length > 0,
        label: 'Étiquettes à vendre',
        detail: active.length ? `${plural(active.length, 'étiquette')} active${active.length > 1 ? 's' : ''}.` : 'Aucune étiquette active : rien ne sera proposé à la vente.',
      };
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
    sales,
    ...(pool ? [] : [{ id: 'quotas' as const, ok: q.status === 'ok', label: 'Quotas = slots', detail: q.message }]),
  ];
}
