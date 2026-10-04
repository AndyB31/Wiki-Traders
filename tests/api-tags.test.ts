// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyTagsViaApi } from '../src/content/api-tags';

const b64url = (s: string) => Buffer.from(s).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const jwt = (payload: object) => `${b64url('{"alg":"HS256"}')}.${b64url(JSON.stringify(payload))}.sig`;
const REF = 'abcdefghijklmnop';
const ME = 'user-me';

describe('étiquetage par l\'API', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('ajoute, retire, crée l\'étiquette manquante, ignore les favoris ; n\'écrit que dans les tables d\'étiquettes', async () => {
    document.cookie = `sb-${REF}-auth-token=${encodeURIComponent(JSON.stringify({ access_token: jwt({ sub: ME, exp: 9_999_999_999 }) }))}`;
    document.head.innerHTML = `<script src="https://www.wiki-masters.com/_next/static/chunks/app.js"></script>`;
    const writes: { method: string; path: string; body: unknown }[] = [];
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      if (url.includes('/_next/')) return new Response(`u="https://${REF}.supabase.co";k="${jwt({ role: 'anon', ref: REF })}"`);
      const u = new URL(url);
      const table = u.pathname.split('/').pop()!;
      const method = init?.method ?? 'GET';
      if (method !== 'GET') {
        writes.push({ method, path: `${table}${decodeURIComponent(u.search)}`, body: init?.body ? JSON.parse(String(init.body)) : undefined });
        if (table === 'tags') return new Response(JSON.stringify([{ id: 't-new', name: '50-100' }]), { status: 201 });
        return new Response(null, { status: 201 });
      }
      if (table === 'user_cards')
        return new Response(JSON.stringify([
          { id: 'u1', snapshot_title: "Col d'Ornon", starred: false },
          { id: 'u2', snapshot_title: "Col d'Ornon", starred: false },
          { id: 'u3', snapshot_title: 'NGC 1033', starred: true },
        ]));
      if (table === 'tags') return new Response(JSON.stringify([{ id: 't-2050', name: '20-50' }]));
      return new Response('[]');
    });

    const progress: string[] = [];
    const results = await applyTagsViaApi(
      [
        { cardId: 'col-d-ornon', cardName: "Col d'Ornon", base: 60, target: '50-100', add: ['50-100'], remove: ['20-50'] },
        { cardId: 'ngc-1033', cardName: 'NGC 1033', base: 30, target: '20-50', add: ['20-50'], remove: [] },
        { cardId: 'absente', cardName: 'Absente', base: 30, target: '20-50', add: ['20-50'], remove: [] },
      ],
      (done, total) => progress.push(`${done}/${total}`),
      () => false,
    );

    expect(results).toEqual([
      { cardName: "Col d'Ornon", ok: true },
      { cardName: 'NGC 1033', ok: false, skipped: 'favori, ignorée' },
      { cardName: 'Absente', ok: false, skipped: 'carte absente de la collection' },
    ]);
    expect(progress).toEqual(['1/2', '2/2']);
    // Comme la sélection multiple du site : un upsert groupé par étiquette, puis une suppression groupée.
    expect(writes).toEqual([
      { method: 'POST', path: 'tags?select=id,name', body: { user_id: ME, name: '50-100', color: expect.any(String) } },
      { method: 'POST', path: 'user_card_tags?on_conflict=user_card_id,tag_id', body: [{ user_card_id: 'u1', tag_id: 't-new' }, { user_card_id: 'u2', tag_id: 't-new' }] },
      { method: 'DELETE', path: 'user_card_tags?tag_id=eq.t-2050&user_card_id=in.("u1","u2")', body: undefined },
    ]);
    expect(writes.every((w) => /^(tags|user_card_tags)\?/.test(w.path))).toBe(true);
  });

  it('regroupe toutes les cartes d\'une même étiquette en une seule écriture (par lots de 100)', async () => {
    const rows = Array.from({ length: 150 }, (_, i) => ({ id: `u${i}`, snapshot_title: `Carte ${i}`, starred: false }));
    const posts: number[] = [];
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      if (url.includes('/_next/')) return new Response(`u="https://${REF}.supabase.co";k="${jwt({ role: 'anon', ref: REF })}"`);
      const table = new URL(url).pathname.split('/').pop()!;
      if (init?.method === 'POST') {
        posts.push(JSON.parse(String(init.body)).length);
        return new Response(null, { status: 201 });
      }
      if (table === 'user_cards') return new Response(JSON.stringify(rows));
      if (table === 'tags') return new Response(JSON.stringify([{ id: 't1', name: '20-50' }]));
      return new Response('[]');
    });
    const plan = rows.map((r, i) => ({ cardId: `carte-${i}`, cardName: r.snapshot_title, base: 30, target: '20-50', add: ['20-50'], remove: [] }));
    const results = await applyTagsViaApi(plan, () => {}, () => false);
    expect(results.every((r) => r.ok)).toBe(true);
    expect(posts).toEqual([100, 50]);
  });
});
