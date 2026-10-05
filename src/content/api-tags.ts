/**
 * Étiquetage via l'API : les mêmes écritures que la sélection multiple du site (« Sélectionner » →
 * « Appliquer / Retirer une étiquette ») : un upsert groupé par étiquette dans `user_card_tags`
 * (doublons ignorés), et des suppressions par lots de 100.
 *
 * ⚠️ Écritures : option « apiWrite » désactivée par défaut. Ce module n'écrit QUE dans les tables
 * d'étiquettes (`user_card_tags`, et `tags` pour créer une étiquette manquante).
 */
import type { TagChange } from '../lib/autotag';
import { sameTag, slugify } from '../lib/text';
import { ApiError, discoverConfig, get, getAll, inList, readSession, type ApiConfig, type Session } from './api';

const WRITABLE = new Set(['user_card_tags', 'tags']);
const TAG_COLORS = ['#f59e0b', '#22c55e', '#3b82f6', '#a855f7', '#ef4444', '#14b8a6', '#ec4899'];

const BATCH = 100;

async function write(cfg: ApiConfig, session: Session, method: 'POST' | 'DELETE', path: string, body?: unknown, prefer = 'return=minimal'): Promise<Response> {
  const table = path.split('?')[0];
  if (!WRITABLE.has(table)) throw new ApiError(`écriture refusée sur ${table}`);
  const res = await fetch(`${cfg.url}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: cfg.anonKey,
      Authorization: `Bearer ${session.accessToken}`,
      'Content-Type': 'application/json',
      Prefer: prefer,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  // 409 : le lien existe déjà (ajout en double) — sans conséquence.
  if (!res.ok && res.status !== 409) throw new ApiError(`API ${res.status} (${method} ${table})`);
  return res;
}

export interface ApiTagResult {
  cardName: string;
  ok: boolean;
  skipped?: string;
  error?: string;
}

/** Applique un plan d'étiquetage par l'API, carte par carte. */
export async function applyTagsViaApi(
  plan: TagChange[],
  onProgress: (done: number, total: number, last: ApiTagResult) => void,
  shouldStop: () => boolean,
): Promise<ApiTagResult[]> {
  const cfg = await discoverConfig();
  const session = readSession(cfg);
  const me = session.userId;

  // Mes lignes de collection (une carte peut en avoir plusieurs) et mes étiquettes.
  const rows = await getAll<{ id: string; snapshot_title: string | null; starred: boolean | null }>(
    cfg,
    session,
    `user_cards?select=id,snapshot_title,starred&user_id=eq.${me}`,
  );
  const rowsByCard = new Map<string, { id: string; starred: boolean }[]>();
  for (const r of rows) {
    if (!r.snapshot_title) continue;
    const key = slugify(r.snapshot_title);
    rowsByCard.set(key, [...(rowsByCard.get(key) ?? []), { id: r.id, starred: !!r.starred }]);
  }
  const tags = await get<{ id: string; name: string }[]>(cfg, session, `tags?select=id,name&user_id=eq.${me}`);
  const tagId = async (name: string): Promise<string> => {
    const found = tags.find((t) => sameTag(t.name, name));
    if (found) return found.id;
    // Étiquette absente : on la crée, comme le fait le champ « Ajouter une étiquette… ».
    const res = await write(cfg, session, 'POST', 'tags?select=id,name', { user_id: me, name, color: TAG_COLORS[tags.length % TAG_COLORS.length] }, 'return=representation');
    const created = ((await res.json().catch(() => [])) as { id: string; name: string }[])[0];
    if (!created?.id) throw new ApiError(`création de l'étiquette « ${name} » impossible`);
    tags.push(created);
    return created.id;
  };

  // 1. Cartes à traiter (favoris et cartes absentes écartés) → lignes de collection par étiquette.
  const results = new Map<string, ApiTagResult>();
  const adds = new Map<string, Set<string>>();
  const removes = new Map<string, Set<string>>();
  const cardsOfRow = new Map<string, string>();
  for (const change of plan) {
    const mine = rowsByCard.get(change.cardId) ?? [];
    if (!mine.length) results.set(change.cardId, { cardName: change.cardName, ok: false, skipped: 'carte absente de la collection' });
    else if (mine.some((r) => r.starred)) results.set(change.cardId, { cardName: change.cardName, ok: false, skipped: 'favori, ignorée' });
    else {
      results.set(change.cardId, { cardName: change.cardName, ok: true });
      for (const r of mine) cardsOfRow.set(r.id, change.cardId);
      for (const name of change.add) for (const r of mine) adds.set(name, (adds.get(name) ?? new Set()).add(r.id));
      for (const name of change.remove) for (const r of mine) removes.set(name, (removes.get(name) ?? new Set()).add(r.id));
    }
  }
  const fail = (rowIds: string[], error: string) => {
    for (const id of rowIds) {
      const cardId = cardsOfRow.get(id)!;
      results.set(cardId, { ...results.get(cardId)!, ok: false, error });
    }
  };

  // 2. Écritures groupées, comme la sélection multiple du site.
  const steps: { kind: 'add' | 'remove'; tag: string; rows: string[] }[] = [];
  for (const [tag, rows] of adds) for (let i = 0; i < rows.size; i += BATCH) steps.push({ kind: 'add', tag, rows: [...rows].slice(i, i + BATCH) });
  for (const [tag, rows] of removes) for (let i = 0; i < rows.size; i += BATCH) steps.push({ kind: 'remove', tag, rows: [...rows].slice(i, i + BATCH) });
  for (const [i, step] of steps.entries()) {
    if (shouldStop()) {
      fail(step.rows, 'arrêté');
      continue;
    }
    try {
      if (step.kind === 'add') {
        const tid = await tagId(step.tag);
        await write(
          cfg,
          session,
          'POST',
          'user_card_tags?on_conflict=user_card_id,tag_id',
          step.rows.map((id) => ({ user_card_id: id, tag_id: tid })),
          'resolution=ignore-duplicates,return=minimal',
        );
      } else {
        const t = tags.find((x) => sameTag(x.name, step.tag));
        if (t) await write(cfg, session, 'DELETE', `user_card_tags?tag_id=eq.${t.id}&user_card_id=${inList(step.rows)}`);
      }
    } catch (e) {
      fail(step.rows, (e as Error).message);
    }
    const label = `${step.kind === 'add' ? 'ajout' : 'retrait'} « ${step.tag} » (${step.rows.length} carte${step.rows.length > 1 ? 's' : ''})`;
    onProgress(i + 1, steps.length, { cardName: label, ok: true });
  }
  return [...results.values()];
}
