// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { parseAuctionDetail, parseAuctionList, hasEmptyState } from '../src/content/parsers/auctions';
import { parseCollection } from '../src/content/parsers/collection';
import { imageBasename } from '../src/content/parsers/dom';
import { detectPage, rootOf } from '../src/content/parsers/page';
import { DEFAULT_SELECTORS, resolveSelectors } from '../src/content/parsers/selectors';
import { domOutline } from '../src/content/diagnostic';
import { NOW } from './helpers';

const fixture = (name: string) => readFileSync(resolve(process.cwd(), 'tests/fixtures', name), 'utf8');
const cfg = DEFAULT_SELECTORS;
const tags = ['50-100', '20-50'];
const loc = (pathname: string, search = '') => ({ pathname, search });

describe('détection de page', () => {
  beforeEach(() => (document.body.innerHTML = fixture('marketplace-mine.html')));
  it('onglet « Mes ventes » actif → mes enchères', () => {
    expect(detectPage(document, loc('/marketplace'), cfg, { myAuctionsPath: null })).toBe('myAuctions');
  });
  it('autres pages', () => {
    document.body.innerHTML = '<main></main>';
    expect(detectPage(document, loc('/marketplace'), cfg, { myAuctionsPath: null })).toBe('market');
    expect(detectPage(document, loc('/marketplace/0f8c2a1e-aaaa'), cfg, { myAuctionsPath: null })).toBe('auctionDetail');
    expect(detectPage(document, loc('/collection'), cfg, { myAuctionsPath: null })).toBe('collection');
    expect(detectPage(document, loc('/battle'), cfg, { myAuctionsPath: null })).toBe('other');
  });
  it('page « mes enchères » enregistrée par l\'utilisateur', () => {
    document.body.innerHTML = '<main></main>';
    const s = { myAuctionsPath: '/marketplace?tab=x' };
    expect(detectPage(document, loc('/marketplace', '?tab=x'), cfg, s)).toBe('myAuctions');
    expect(detectPage(document, loc('/marketplace'), cfg, s)).toBe('market');
  });
});

describe('parseAuctionList', () => {
  beforeEach(() => (document.body.innerHTML = fixture('marketplace-mine.html')));

  it('relève carte, rareté, prix, fin', () => {
    const list = parseAuctionList(rootOf(document, cfg), cfg, tags, NOW);
    expect(list.map((a) => a.cardName)).toEqual(['Nikola Tesla', 'Chat', 'Hibou']);
    const [tesla, chat, hibou] = list;
    expect(tesla).toMatchObject({ id: '0f8c2a1e-aaaa-4bbb-8ccc-111111111111', cardId: 'nikola-tesla', rarity: 'SR', currentPrice: 1250, startPrice: 900, ended: false });
    expect(tesla.endsAt).toBe(NOW + 72 * 60_000);
    expect(chat).toMatchObject({ rarity: 'C', tag: '20-50', currentPrice: 30, endsAt: Date.parse('2026-10-03T14:00:00Z') });
    expect(hibou).toMatchObject({ rarity: 'PC', currentPrice: 48, sold: true, ended: true });
  });

  it('page vide reconnue', () => {
    document.body.innerHTML = '<main><p>Vous n\'avez aucune enchère en cours.</p></main>';
    const root = rootOf(document, cfg);
    expect(parseAuctionList(root, cfg, tags, NOW)).toEqual([]);
    expect(hasEmptyState(root, cfg)).toBe(true);
  });

  it('détail d\'une enchère', () => {
    document.body.innerHTML = '<main><h1>Mont Fuji</h1><span>Rare</span><p>Offre actuelle : 75</p><p>Se termine dans 3 h</p></main>';
    const a = parseAuctionDetail(rootOf(document, cfg), 'abc123', cfg, tags, NOW);
    expect(a).toMatchObject({ cardId: 'mont-fuji', rarity: 'R', currentPrice: 75, endsAt: NOW + 3 * 3_600_000 });
  });

  it('sélecteur de tuile surchargé', () => {
    const custom = resolveSelectors({ auctionTile: '.rounded-xl' });
    expect(parseAuctionList(rootOf(document, custom), custom, tags, NOW)).toHaveLength(3);
  });
});

describe('parseCollection', () => {
  beforeEach(() => (document.body.innerHTML = fixture('collection.html')));

  it('relève les cartes, quantités, étiquettes, favoris et prix moyen', () => {
    const { cards, filterTag } = parseCollection(rootOf(document, cfg), cfg, tags, NOW);
    expect(filterTag).toBe('50-100');
    const byId = Object.fromEntries(cards.map((c) => [c.id, c]));
    expect(Object.keys(byId).sort()).toEqual(['albert-einstein', 'colisee', 'origami']);
    expect(byId['albert-einstein']).toMatchObject({ name: 'Albert Einstein', rarity: 'UR', quantity: 3, sitePrice: 95, favorite: false });
    expect(byId['albert-einstein'].tags).toContain('50-100');
    expect(byId['colisee']).toMatchObject({ rarity: 'R', quantity: 2, favorite: true });
    expect(byId['origami'].quantity).toBeUndefined();
    // Le filtre actif s'applique à toutes les cartes visibles.
    expect(byId['origami'].tags).toEqual(['50-100']);
  });

  it('ignore logo et avatar', () => {
    const { cards } = parseCollection(document.body, cfg, tags, NOW);
    expect(cards.map((c) => c.name)).not.toContain('Mon avatar');
  });
});

describe('divers', () => {
  it('imageBasename gère next/image', () => {
    expect(imageBasename('/_next/image?url=%2Fcards%2Ffrida-kahlo.jpg&w=256')).toBe('frida-kahlo');
    expect(imageBasename('https://x.supabase.co/storage/v1/object/sign/cards/titanic.jpg?token=abc')).toBe('titanic');
  });
  it('domOutline ne contient pas les valeurs des champs', () => {
    document.body.innerHTML = '<main><input type="password" value="secret"><a href="/marketplace/x" class="a b">Lien</a></main>';
    const out = domOutline(document.querySelector('main')!);
    expect(out).not.toContain('secret');
    expect(out).toContain('a.a.b [href=/marketplace/x]  "Lien"');
  });
});

describe('vrai DOM : onglet « Mes ventes »', () => {
  beforeEach(() => (document.body.innerHTML = fixture('real-mes-ventes.html')));
  const cfgReal = DEFAULT_SELECTORS;

  it('reconnaît l\'onglet actif sans attribut ARIA, et le compteur de slots', async () => {
    const { activeTabLabel, slotsFromTabs } = await import('../src/content/parsers/page');
    expect(activeTabLabel(document, cfgReal)).toBe('Mes ventes (2/5)');
    expect(slotsFromTabs(document, cfgReal)).toEqual({ active: 2, slots: 5 });
    expect(detectPage(document, loc('/marketplace'), cfgReal, { myAuctionsPath: null })).toBe('myAuctions');
    // Même avec l'adresse enregistrée, l'onglet « Parcourir » n'est pas « mes ventes ».
    const tabs = document.querySelectorAll('main button');
    tabs[0].className = tabs[1].className;
    tabs[1].className = tabs[2].className;
    expect(detectPage(document, loc('/marketplace'), cfgReal, { myAuctionsPath: '/marketplace' })).toBe('market');
  });

  it('« Mes enchères » n\'est pas « mes ventes »', () => {
    const tabs = document.querySelectorAll('main button');
    const active = tabs[1].className;
    tabs[1].className = tabs[0].className;
    tabs[2].className = active;
    expect(detectPage(document, loc('/marketplace'), cfgReal, { myAuctionsPath: null })).toBe('market');
  });

  it('relève les 2 ventes en cours (« Vendu par » n\'est pas une vente conclue)', () => {
    const list = parseAuctionList(rootOf(document, cfgReal), cfgReal, tags, NOW);
    expect(list).toHaveLength(2);
    expect(list[0]).toMatchObject({ id: '09ee8b59-edef-40e4-bdb4-14fe11ff82df', cardName: 'Marie Palot', cardId: 'marie-palot', rarity: 'SR', currentPrice: 24, startPrice: 24, sold: false, ended: false });
    expect(list[0].endsAt).toBe(NOW + 3 * 60_000 + 18_000);
    expect(list[1]).toMatchObject({ cardName: 'Teen Wolf (série télévisée)', rarity: 'UR', currentPrice: 100, sold: false, ended: false });
    expect(list[1].endsAt).toBe(NOW + 57 * 60_000 + 14_000);
  });
});

describe('vrai DOM : collection', () => {
  it('lit le badge « Moy. 12 W » comme prix moyen, ignore « Moy. — »', () => {
    document.body.innerHTML = `<main><div class="flex flex-wrap">
      <div class="relative isolate group"><div class="glow-ur relative"><img alt="" src="/ultra_rare.png"><img alt="Holly Hunter" src="https://upload.wikimedia.org/x/Holly.jpg">
        <div style="background-color: var(--color-rarity-ur)">UR</div><h3>Holly Hunter</h3><span class="rounded-full">Mettre au Enchère</span><span class="wm-card-price">Moy. 12 W</span></div></div>
      <div class="relative isolate group"><div class="glow-sr relative"><img alt="" src="/super_rare.png"><img alt="Zico" src="https://upload.wikimedia.org/x/Zico.jpg">
        <div style="background-color: var(--color-rarity-sr)">SR</div><h3>Zico</h3><span class="wm-card-price is-empty">Moy. —</span></div></div>
    </div></main>`;
    const { cards } = parseCollection(rootOf(document, cfg), cfg, ['Mettre au Enchère'], NOW);
    const byId = Object.fromEntries(cards.map((c) => [c.id, c]));
    expect(byId['holly-hunter']).toMatchObject({ rarity: 'UR', sitePrice: 12, tags: ['Mettre au Enchère'] });
    expect(byId['zico'].sitePrice).toBeUndefined();
  });
});

describe('vrai DOM : favoris', () => {
  it('étoile « Retirer des favoris » = favori, « Ajouter aux favoris » = non', () => {
    document.body.innerHTML = `<main><div class="flex flex-wrap">
      <div class="relative isolate group"><div class="glow-c relative"><img alt="" src="/commun.png"><img alt="NGC 1033" src="https://upload.wikimedia.org/x/ngc.jpg">
        <div style="background-color: var(--color-rarity-c)">C</div><div class="absolute top-2 right-2"><button type="button" aria-label="Retirer des favoris"></button></div><h3>NGC 1033</h3></div></div>
      <div class="relative isolate group"><div class="glow-sr relative"><img alt="" src="/super_rare.png"><img alt="Zico" src="https://upload.wikimedia.org/x/Zico.jpg">
        <div style="background-color: var(--color-rarity-sr)">SR</div><div class="absolute top-2 right-2"><button type="button" aria-label="Ajouter aux favoris"></button></div><h3>Zico</h3></div></div>
    </div></main>`;
    const { cards } = parseCollection(rootOf(document, cfg), cfg, [], NOW);
    const byId = Object.fromEntries(cards.map((c) => [c.id, c]));
    expect(byId['ngc-1033'].favorite).toBe(true);
    expect(byId['zico'].favorite).toBe(false);
  });
});
