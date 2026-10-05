// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CardFamily, CatalogCard } from '../src/lib/types';

vi.hoisted(() => {
  const data: Record<string, unknown> = {};
  (globalThis as unknown as { chrome: unknown }).chrome = {
    runtime: { getURL: (p: string) => `chrome-extension://wiky/${p}` },
    storage: {
      local: {
        get: async (keys: string[] | string) => Object.fromEntries([keys].flat().filter((k) => k in data).map((k) => [k, data[k]])),
        set: async (patch: Record<string, unknown>) => void Object.assign(data, patch),
      },
      onChanged: { addListener: () => undefined },
    },
  };
});
const { renderFamilyBadges, clearFamilyBadges } = await import('../src/content/features/family-badges');
const { syncFamilies, resetFamiliesState } = await import('../src/content/features/families-state');

const cc = (siteId: string, title: string): CatalogCard => ({ siteId, title, rarity: 'R', category: null, imageUrl: null, wikipediaUrl: null, atk: null, def: null });
const fam = (id: string, color: string, cards: CatalogCard[], updatedAt = 1): CardFamily => ({ id, name: `Famille ${id}`, color, cards, coverSiteId: null, createdAt: 1, updatedAt });

function tile(title: string, ref?: string): string {
  return `<div class="relative isolate group"><div class="glow-r relative"${ref ? ` data-wiky-ref="card:${ref}"` : ''}><img src="/rare.png"><h3>${title}</h3></div></div>`;
}

beforeEach(() => {
  resetFamiliesState();
  document.body.innerHTML = `<main>${tile('Mont Fuji', 'u1')}${tile('Marie Curie')}${tile('Sans famille', 'u3')}</main>`;
});

describe('pastilles de famille sur les cartes du site', () => {
  it('une pastille par famille (par identifiant ou par nom), en bas à gauche de l\'image, nom au survol', () => {
    syncFamilies([fam('a', '#f97316', [cc('u1', 'Mont Fuji'), cc('zz', 'Marie Curie')]), fam('b', '#3b82f6', [cc('u1', 'Mont Fuji')])]);
    expect(renderFamilyBadges()).toBe(2);
    const [fuji, curie, none] = document.querySelectorAll<HTMLElement>('.glow-r');
    const badge = fuji.querySelector<HTMLElement>(':scope > [data-wiky="fam-badge"]')!;
    expect(badge.title).toBe('Familles : Famille a, Famille b');
    expect(badge.style.left).toBe('7px');
    expect(badge.style.top).toBe('calc(45% - 20px)');
    expect([...badge.querySelectorAll<HTMLElement>('[data-fam]')].map((d) => d.style.background)).toEqual(['rgb(249, 115, 22)', 'rgb(59, 130, 246)']);
    expect(curie.querySelectorAll('[data-wiky="fam-badge"] [data-fam]')).toHaveLength(1);
    expect(none.querySelector('[data-wiky="fam-badge"]')).toBeNull();
  });

  it('idempotent : aucune mutation du DOM quand rien ne change', async () => {
    syncFamilies([fam('a', '#f97316', [cc('u1', 'Mont Fuji')])]);
    renderFamilyBadges();
    const records: MutationRecord[] = [];
    const obs = new MutationObserver((r) => records.push(...r));
    obs.observe(document.body, { childList: true, subtree: true, attributes: true });
    expect(renderFamilyBadges()).toBe(0);
    expect(renderFamilyBadges()).toBe(0);
    await Promise.resolve();
    obs.disconnect();
    expect(records).toHaveLength(0);
  });

  it('ne redessine que les cartes concernées par un changement, retire les pastilles devenues inutiles', () => {
    syncFamilies([fam('a', '#f97316', [cc('u1', 'Mont Fuji')]), fam('b', '#3b82f6', [cc('u3', 'Sans famille')])]);
    renderFamilyBadges();
    const before = document.querySelector('[data-wiky-ref="card:u1"] [data-wiky="fam-badge"]');
    syncFamilies([fam('a', '#f97316', [cc('u1', 'Mont Fuji')]), fam('b', '#22c55e', [], 2)]);
    expect(renderFamilyBadges()).toBe(1);
    expect(document.querySelector('[data-wiky-ref="card:u1"] [data-wiky="fam-badge"]')).toBe(before);
    expect(document.querySelector('[data-wiky-ref="card:u3"] [data-wiky="fam-badge"]')).toBeNull();
    expect(document.querySelector('[data-wiky-ref="card:u3"]')!.hasAttribute('data-wiky-fam')).toBe(false);
  });

  it('nettoyage complet', () => {
    syncFamilies([fam('a', '#f97316', [cc('u1', 'Mont Fuji')])]);
    renderFamilyBadges();
    clearFamilyBadges();
    expect(document.querySelector('[data-wiky="fam-badge"], [data-wiky-fam]')).toBeNull();
  });
});
