import { describe, expect, it } from 'vitest';
import { checkForUpdate } from '../src/lib/update';

const commit = (sha: string, message: string) => ({ sha, commit: { message, committer: { date: '2026-10-06T10:00:00Z' } } });

function github(routes: Record<string, { status?: number; body?: unknown }>) {
  const calls: string[] = [];
  const fetch = (async (url: string) => {
    calls.push(url);
    const key = Object.keys(routes).find((k) => url.includes(k));
    const r = key ? routes[key] : { status: 404 };
    return new Response(JSON.stringify(r.body ?? {}), { status: r.status ?? 200 });
  }) as typeof globalThis.fetch;
  return { fetch, calls };
}

const build = (sha: string | null) => ({ sha, dirty: false, date: null, builtAt: null });

describe('vérification des mises à jour', () => {
  it('à jour : même commit que main (une seule requête)', async () => {
    const g = github({ '/commits/main': { body: commit('aaa', 'Dernier') } });
    const r = await checkForUpdate(build('aaa'), g.fetch);
    expect(r.status).toBe('up-to-date');
    expect(g.calls).toHaveLength(1);
  });

  it('mise à jour disponible : nombre de nouveautés et messages, plus récent d\'abord', async () => {
    const g = github({
      '/commits/main': { body: commit('ccc', 'Deuxième\n\ndétail') },
      '/compare/aaa...main': { body: { status: 'ahead', ahead_by: 2, commits: [commit('bbb', 'Premier'), commit('ccc', 'Deuxième\n\ndétail')] } },
    });
    const r = await checkForUpdate(build('aaa'), g.fetch);
    expect(r.status).toBe('available');
    expect(r.behind).toBe(2);
    expect(r.commits.map((c) => c.message)).toEqual(['Deuxième', 'Premier']);
  });

  it('version construite depuis des commits non poussés : comparaison impossible (pas d\'erreur)', async () => {
    const g = github({ '/commits/main': { body: commit('ccc', 'x') }, '/compare/': { status: 404 } });
    expect((await checkForUpdate(build('zzz'), g.fetch)).status).toBe('unknown');
  });

  it('version locale plus récente que main : à jour', async () => {
    const g = github({ '/commits/main': { body: commit('ccc', 'x') }, '/compare/': { body: { status: 'behind', ahead_by: 0 } } });
    expect((await checkForUpdate(build('ddd'), g.fetch)).status).toBe('up-to-date');
  });

  it('dépôt privé ou limite atteinte : erreur lisible', async () => {
    expect((await checkForUpdate(build('a'), github({ '/commits/main': { status: 404 } }).fetch)).error).toContain('privé');
    expect((await checkForUpdate(build('a'), github({ '/commits/main': { status: 403 } }).fetch)).error).toContain('limite');
  });
});
