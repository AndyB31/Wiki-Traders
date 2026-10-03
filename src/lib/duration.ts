import type { DurationRule } from './types';

/** Durées proposées par la fenêtre « Mettre aux enchères » du site (libellés exacts des boutons). */
export const DURATIONS: { minutes: number; label: string }[] = [
  { minutes: 10, label: '10 min' },
  { minutes: 30, label: '30 min' },
  { minutes: 60, label: '1 h' },
  { minutes: 180, label: '3 h' },
  { minutes: 360, label: '6 h' },
  { minutes: 720, label: '12 h' },
];

export function durationLabel(minutes: number): string {
  return DURATIONS.find((d) => d.minutes === minutes)?.label ?? `${minutes} min`;
}

/** Durée du premier palier dont l'intervalle [de, à] contient le prix ; null = durée par défaut du site. */
export function durationFor(price: number | null, rules: DurationRule[]): number | null {
  if (price == null) return null;
  const rule = rules.find((r) => (r.from == null || price >= r.from) && (r.to == null || price <= r.to));
  return rule?.minutes ?? null;
}

/** Paliers qui se chevauchent (le premier l'emporte, mais c'est sans doute une erreur de saisie). */
export function overlappingDurations(rules: DurationRule[]): [number, number] | null {
  for (let i = 0; i < rules.length; i++) {
    for (let j = i + 1; j < rules.length; j++) {
      const a = rules[i];
      const b = rules[j];
      if ((a.from ?? -Infinity) <= (b.to ?? Infinity) && (b.from ?? -Infinity) <= (a.to ?? Infinity)) return [i, j];
    }
  }
  return null;
}
