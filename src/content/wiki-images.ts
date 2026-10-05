/**
 * Images de remplacement pour les cartes sans illustration : vignette de l'article Wikipédia (fr), sinon
 * image (P18) ou logo (P154) Wikidata de l'article. Rapide :
 *  - 50 titres par requête (maximum de l'API MediaWiki), pour Wikipédia comme pour Wikidata ;
 *  - résultats (trouvés ou non) gardés en mémoire et dans le stockage de l'extension ;
 *  - une seule requête en vol par titre.
 */
import { ext } from '../lib/browser';

export interface WikiImage {
  url: string | null;
  source: 'wikipedia' | 'wikidata' | null;
  at: number;
}

const KEY = 'wikiImages';
const FOUND_TTL = 30 * 86_400_000;
const MISS_TTL = 3 * 86_400_000;
const CHUNK = 50;
const THUMB = 330;

const cache = new Map<string, WikiImage>();
const inflight = new Map<string, Promise<void>>();
let loaded: Promise<void> | null = null;
let persistTimer: ReturnType<typeof setTimeout> | undefined;

const valid = (e: WikiImage | undefined, now = Date.now()): e is WikiImage => !!e && now - e.at < (e.url ? FOUND_TTL : MISS_TTL);

function loadCache(): Promise<void> {
  loaded ??= (async () => {
    try {
      const raw = (await ext.storage.local.get(KEY))[KEY] as Record<string, WikiImage> | undefined;
      const now = Date.now();
      for (const [t, e] of Object.entries(raw ?? {})) if (valid(e, now)) cache.set(t, e);
    } catch {
      // Stockage indisponible (tests) : cache en mémoire seulement.
    }
  })();
  return loaded;
}

function persist(): void {
  clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    try {
      void ext.storage.local.set({ [KEY]: Object.fromEntries(cache) });
    } catch {
      // idem
    }
  }, 1500);
}

/** Image déjà connue pour ce titre (synchrone ; undefined : pas encore cherchée). */
export function knownImage(title: string): WikiImage | undefined {
  const e = cache.get(title);
  return valid(e) ? e : undefined;
}

async function json<T>(url: string): Promise<T> {
  const res = await fetch(url, { credentials: 'omit', referrerPolicy: 'no-referrer' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

interface PagesResponse {
  query?: {
    normalized?: { from: string; to: string }[];
    redirects?: { from: string; to: string }[];
    pages?: Record<string, { title: string; missing?: string; thumbnail?: { source: string } }>;
  };
}

/** Vignettes Wikipédia de 50 titres au plus, en une requête. Renvoie titre demandé → [titre final, image]. */
export async function wikipediaThumbs(titles: string[]): Promise<Map<string, { final: string; url: string | null }>> {
  const params = new URLSearchParams({
    action: 'query',
    prop: 'pageimages',
    piprop: 'thumbnail',
    pithumbsize: String(THUMB),
    redirects: '1',
    titles: titles.join('|'),
    format: 'json',
    origin: '*',
  });
  const data = await json<PagesResponse>(`https://fr.wikipedia.org/w/api.php?${params}`);
  const norm = new Map((data.query?.normalized ?? []).map((n) => [n.from, n.to]));
  const redir = new Map((data.query?.redirects ?? []).map((n) => [n.from, n.to]));
  const pages = new Map(Object.values(data.query?.pages ?? {}).map((p) => [p.title, p]));
  const out = new Map<string, { final: string; url: string | null }>();
  for (const t of titles) {
    const n = norm.get(t) ?? t;
    const final = redir.get(n) ?? n;
    out.set(t, { final, url: pages.get(final)?.thumbnail?.source ?? null });
  }
  return out;
}

interface EntitiesResponse {
  entities?: Record<string, { missing?: string; sitelinks?: { frwiki?: { title: string } }; claims?: Record<string, { mainsnak?: { datavalue?: { value?: unknown } } }[]> }>;
}

/** Image Wikidata (P18, sinon logo P154) de 50 articles au plus, en une requête. Renvoie titre d'article → image. */
export async function wikidataImages(titles: string[]): Promise<Map<string, string | null>> {
  const params = new URLSearchParams({
    action: 'wbgetentities',
    sites: 'frwiki',
    titles: titles.join('|'),
    props: 'claims|sitelinks',
    sitefilter: 'frwiki',
    format: 'json',
    origin: '*',
  });
  const data = await json<EntitiesResponse>(`https://www.wikidata.org/w/api.php?${params}`);
  const byTitle = new Map<string, string | null>();
  for (const e of Object.values(data.entities ?? {})) {
    const title = e.sitelinks?.frwiki?.title;
    if (!title) continue;
    const file = ['P18', 'P154'].map((p) => e.claims?.[p]?.[0]?.mainsnak?.datavalue?.value).find((v): v is string => typeof v === 'string' && !!v.trim());
    byTitle.set(title, file ? `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(file.replace(/ /g, '_'))}?width=${THUMB}` : null);
  }
  return new Map(titles.map((t) => [t, byTitle.get(t) ?? null]));
}

async function resolveChunk(titles: string[]): Promise<void> {
  const now = Date.now();
  const wiki = await wikipediaThumbs(titles);
  const missing = titles.filter((t) => !wiki.get(t)?.url);
  let wd = new Map<string, string | null>();
  if (missing.length) {
    try {
      wd = await wikidataImages([...new Set(missing.map((t) => wiki.get(t)?.final ?? t))]);
    } catch {
      // Wikidata indisponible : on garde le résultat Wikipédia.
    }
  }
  for (const t of titles) {
    const w = wiki.get(t);
    if (w?.url) cache.set(t, { url: w.url, source: 'wikipedia', at: now });
    else {
      const url = wd.get(w?.final ?? t) ?? null;
      cache.set(t, { url, source: url ? 'wikidata' : null, at: now });
    }
  }
}

/** Images de plusieurs titres (cache, puis lots de 50). Les erreurs réseau laissent les titres non résolus. */
export async function resolveImages(titles: string[]): Promise<Map<string, string | null>> {
  await loadCache();
  const wanted = [...new Set(titles.map((t) => t.trim()).filter(Boolean))];
  const waits: Promise<void>[] = [];
  const todo = wanted.filter((t) => {
    if (knownImage(t)) return false;
    const p = inflight.get(t);
    if (p) waits.push(p);
    return !p;
  });
  for (let i = 0; i < todo.length; i += CHUNK) {
    const chunk = todo.slice(i, i + CHUNK);
    const job = resolveChunk(chunk).finally(() => chunk.forEach((t) => inflight.delete(t)));
    chunk.forEach((t) => inflight.set(t, job));
    waits.push(job);
  }
  if (waits.length) {
    await Promise.allSettled(waits);
    persist();
  }
  const out = new Map<string, string | null>();
  for (const t of wanted) {
    const e = knownImage(t);
    if (e) out.set(t, e.url);
  }
  return out;
}

/** Pour les tests. */
export function resetWikiImages(): void {
  cache.clear();
  inflight.clear();
  loaded = null;
}
