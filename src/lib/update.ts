/**
 * Mises à jour : version construite (commit de la branche main) comparée à la branche main du dépôt GitHub public.
 * L'installation elle-même passe par le programme d'aide (scripts/updater, « native messaging »).
 */

export interface BuildInfo {
  /** Commit dont vient cette construction (null : inconnu). */
  sha: string | null;
  /** Construite avec des modifications locales non commitées. */
  dirty: boolean;
  /** Date du commit. */
  date: string | null;
  builtAt: string | null;
}

declare const __WIKY_BUILD__: BuildInfo | undefined;

export const BUILD: BuildInfo = typeof __WIKY_BUILD__ !== 'undefined' ? __WIKY_BUILD__ : { sha: null, dirty: false, date: null, builtAt: null };

export const REPO = 'AndyB31/Wiki-Traders';
export const REPO_URL = `https://github.com/${REPO}`;
export const UPDATER_HOST = 'com.wikytraders.updater';
/** Clé de stockage du dernier résultat de vérification. */
export const UPDATE_KEY = 'updateInfo';

export interface UpdateCommit {
  sha: string;
  message: string;
  date: string | null;
}

export interface UpdateInfo {
  checkedAt: number;
  current: string | null;
  /** Dernier commit de main. */
  latest: UpdateCommit | null;
  /** Nombre de commits de main absents de cette version. */
  behind: number;
  /** Nouveautés (plus récentes d'abord, 20 au plus). */
  commits: UpdateCommit[];
  status: 'up-to-date' | 'available' | 'unknown' | 'error';
  error?: string;
}

const API = `https://api.github.com/repos/${REPO}`;

function commitOf(raw: { sha: string; commit?: { message?: string; committer?: { date?: string }; author?: { date?: string } } }): UpdateCommit {
  return { sha: raw.sha, message: (raw.commit?.message ?? '').split('\n')[0], date: raw.commit?.committer?.date ?? raw.commit?.author?.date ?? null };
}

/** Compare cette version à la branche main (API publique de GitHub, sans authentification). */
export async function checkForUpdate(build: BuildInfo = BUILD, doFetch: typeof fetch = fetch.bind(globalThis)): Promise<UpdateInfo> {
  const base = { checkedAt: Date.now(), current: build.sha, latest: null, behind: 0, commits: [] as UpdateCommit[] };
  const headers = { Accept: 'application/vnd.github+json' };
  try {
    const res = await doFetch(`${API}/commits/main`, { headers });
    if (res.status === 404) return { ...base, status: 'error', error: 'dépôt introuvable (privé ?)' };
    if (res.status === 403) return { ...base, status: 'error', error: 'limite de requêtes GitHub atteinte, réessaie plus tard' };
    if (!res.ok) return { ...base, status: 'error', error: `GitHub ${res.status}` };
    const latest = commitOf(await res.json());
    if (!build.sha) return { ...base, latest, status: 'unknown' };
    if (latest.sha === build.sha) return { ...base, latest, status: 'up-to-date' };
    const cmp = await doFetch(`${API}/compare/${build.sha}...main`, { headers });
    // Commit absent de GitHub (version construite depuis des commits non poussés) : on ne peut pas comparer.
    if (cmp.status === 404) return { ...base, latest, status: 'unknown' };
    if (!cmp.ok) return { ...base, latest, status: 'error', error: `GitHub ${cmp.status}` };
    const data = (await cmp.json()) as { status: string; ahead_by: number; commits?: Parameters<typeof commitOf>[0][] };
    if (data.status === 'identical' || data.status === 'behind') return { ...base, latest, status: 'up-to-date' };
    const commits = (data.commits ?? []).map(commitOf).reverse().slice(0, 20);
    return { ...base, latest, behind: data.ahead_by, commits, status: data.ahead_by > 0 ? 'available' : 'up-to-date' };
  } catch (e) {
    return { ...base, status: 'error', error: (e as Error).message };
  }
}

export const shortSha = (sha: string | null | undefined) => (sha ? sha.slice(0, 7) : '—');
