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

  const setup = (rows: Record<string, unknown>[], opts: { bulkFails?: boolean; refused?: unknown[] } = {}) => {
    document.cookie = `sb-${REF}-auth-token=${encodeURIComponent(JSON.stringify({ access_token: jwt({ sub: 'me', exp: 9_999_999_999 }) }))}`;
    document.head.innerHTML = '<script src="https://www.wiki-masters.com/_next/static/chunks/app.js"></script>';
    const calls: { url: string; body?: unknown }[] = [];
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      if (url.includes('/_next/')) return new Response(`u="https://${REF}.supabase.co";k="${jwt({ role: 'anon', ref: REF })}"`);
      calls.push({ url, body: init?.body ? JSON.parse(init.body as string) : undefined });
      if (url === '/api/user-cards/bulk-discard') {
        return opts.bulkFails ? new Response('{"error":"non"}', { status: 500 }) : new Response(JSON.stringify({ discarded_count: 1, failed: opts.refused ?? [] }));
      }
      if (init?.method === 'POST') return new Response('{}');
      return new Response(JSON.stringify(rows));
    });
    return calls;
  };
  const card = (siteId: string, title: string, rarity: 'SR' | 'C' | 'R') => ({ siteId, title, rarity, imageUrl: null, wikipediaUrl: null });
  const ROWS = [
    { id: 'uc-1', card_id: 'c1', starred: false, snapshot_rarity: 'SR', is_shiny: false, count: 2 },
    { id: 'uc-2', card_id: 'c2', starred: true, snapshot_rarity: 'C', is_shiny: false, count: 1 },
    { id: 'uc-3', card_id: 'c3', starred: false, snapshot_rarity: 'R', is_shiny: false, count: 3 },
    { id: 'uc-4', card_id: 'c4', starred: false, snapshot_rarity: 'C', is_shiny: false, count: 1 },
  ];
  const PACK = [card('c1', 'Victor Hugo', 'SR'), card('c2', 'Paris', 'C'), card('c1', 'Victor Hugo', 'SR'), card('c3', 'Lune', 'R'), card('c4', 'Mars', 'C')];

  it('une lecture, une défausse groupée des lignes entièrement prises, l\'unité pour celles qui gardent d\'anciens exemplaires', async () => {
    const calls = setup(ROWS);
    const progress: number[] = [];
    const res = await discardPackCards(PACK, (d) => progress.push(d));
    const reads = calls.filter((c) => c.url.includes('/rest/v1/user_cards'));
    expect(reads).toHaveLength(1);
    expect(decodeURIComponent(reads[0].url)).toContain('card_id=in.("c1","c2","c3","c4")');
    // uc-1 (2 exemplaires, 2 obtenus) et uc-4 : groupée ; uc-3 (3 exemplaires, 1 obtenu) : à l'unité ; uc-2 : favori.
    expect(calls.filter((c) => c.url.startsWith('/api/'))).toEqual([
      { url: '/api/user-cards/bulk-discard', body: { card_ids: ['uc-1', 'uc-4'] } },
      { url: '/api/user-cards/uc-3/discard', body: undefined },
    ]);
    expect(res.done.sort()).toEqual(['Lune', 'Mars', 'Victor Hugo', 'Victor Hugo']);
    // Paris n'existe plus qu'en favori : ignorée, pas une erreur.
    expect(res.skipped).toEqual(['Paris']);
    expect(res.failed).toEqual([]);
    expect(progress.at(-1)).toBe(5);
  });

  it('défausse groupée refusée : repli à l\'unité ; lignes refusées une à une : signalées', async () => {
    const calls = setup(ROWS, { bulkFails: true });
    const res = await discardPackCards(PACK);
    expect(calls.filter((c) => c.url.endsWith('/discard')).map((c) => c.url).sort()).toEqual([
      '/api/user-cards/uc-1/discard', '/api/user-cards/uc-1/discard', '/api/user-cards/uc-3/discard', '/api/user-cards/uc-4/discard',
    ]);
    expect(res.done).toHaveLength(4);
    setup(ROWS, { refused: [{ card_id: 'uc-4', error: 'verrouillée' }] });
    const res2 = await discardPackCards(PACK);
    expect(res2.failed).toContainEqual({ title: 'Mars', error: 'verrouillée' });
    expect(res2.done.sort()).toEqual(['Lune', 'Victor Hugo', 'Victor Hugo']);
  });
});
