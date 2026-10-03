function toMinutes(hhmm: string): number | null {
  const m = hhmm.match(/^(\d{1,2})[:hH](\d{2})?$/);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2] ?? 0);
}

/** Vrai si `date` tombe dans les heures silencieuses (gère le passage de minuit, ex. 23:00 – 08:00). */
export function inQuietHours(date: Date, start: string | null, end: string | null): boolean {
  if (!start || !end) return false;
  const s = toMinutes(start);
  const e = toMinutes(end);
  if (s == null || e == null || s === e) return false;
  const now = date.getHours() * 60 + date.getMinutes();
  return s < e ? now >= s && now < e : now >= s || now < e;
}
