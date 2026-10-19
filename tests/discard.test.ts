// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  (globalThis as unknown as { chrome: unknown }).chrome = { runtime: { getURL: (p: string) => p }, storage: { local: { get: async () => ({}), set: async () => {} } } };
});
const { discardPackCards, pickDiscardRow } = await import('../src/content/features/discard');

const b64url = (s: string) => Buffer.from(s).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const jwt = (payload: object) => `${b64url('{"alg":"HS256"}')}.${b64url(JSON.stringify(payload))}.sig`;
const REF = 'abcdefghijklmnop';

afterEach(() => vi.unstubAllGlobals());

describe('défausse des cartes d\'un paquet', () => {
  it('choix de l\'exemplaire : même rareté, jamais un favori, non brillante d\'abord', () => {
    const rows = [
      { id: 'fav', starred: true, rarity: 'R' as const, shiny: false, count: 1 },
      { id: 'shiny', starred: false, rarity: 'R' as const, shiny: true, count: 1 },
      { id: 'sr', starred: false, rarity: 'SR' as const, shiny: false, count: 2 },
      { id: 'plain', starred: false, rarity: 'R' as const, shiny: false, count: 1 },
    ];
    expect(pickDiscardRow(rows, 'R')?.id).toBe('plain');
    expect(pickDiscardRow(rows.filter((r) => r.id !== 'plain'), 'R')?.id).toBe('shiny');
    expect(pickDiscardRow([rows[0]], 'R')).toBeNull();
    expect(pickDiscardRow(rows, 'L')).toBeNull();
  });

  it('un POST /api/user-cards/<exemplaire>/discard par carte obtenue ; favori seul : refusé sans requête', async () => {
    document.cookie = `sb-${REF}-auth-token=${encodeURIComponent(JSON.stringify({ access_token: jwt({ sub: 'me', exp: 9_999_999_999 }) }))}`;
    document.head.innerHTML = '<script src="https://www.wiki-masters.com/_next/static/chunks/app.js"></script>';
    const posts: string[] = [];
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      if (url.includes('/_next/')) return new Response(`u="https://${REF}.supabase.co";k="${jwt({ role: 'anon', ref: REF })}"`);
      if (init?.method === 'POST') {
        posts.push(url);
        return new Response(JSON.stringify({ ok: true }));
      }
      if (url.includes('card_id=eq.c1')) return new Response(JSON.stringify([{ id: 'uc-1', starred: false, snapshot_rarity: 'SR', is_shiny: false, count: 2 }]));
      if (url.includes('card_id=eq.c2')) return new Response(JSON.stringify([{ id: 'uc-2', starred: true, snapshot_rarity: 'C', is_shiny: false, count: 1 }]));
      return new Response('[]');
    });
    const progress: number[] = [];
    const res = await discardPackCards(
      [
        { siteId: 'c1', title: 'Victor Hugo', rarity: 'SR', imageUrl: null, wikipediaUrl: null },
        { siteId: 'c2', title: 'Paris', rarity: 'C', imageUrl: null, wikipediaUrl: null },
        { siteId: 'c1', title: 'Victor Hugo', rarity: 'SR', imageUrl: null, wikipediaUrl: null },
      ],
      (d) => progress.push(d),
    );
    expect(posts).toEqual(['/api/user-cards/uc-1/discard', '/api/user-cards/uc-1/discard']);
    expect(res.done).toEqual(['Victor Hugo', 'Victor Hugo']);
    expect(res.failed).toEqual([{ title: 'Paris', error: expect.stringContaining('favori') }]);
    expect(progress).toEqual([1, 2, 3]);
  });
});
