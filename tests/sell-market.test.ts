// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../src/lib/defaults';
import { DEFAULT_SELECTORS } from '../src/content/parsers/selectors';
import { enhanceSellDialog, resetSellMarket } from '../src/content/sell-market';
import { card, cardsById } from './helpers';

const b64url = (s: string) => Buffer.from(s).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const jwt = (payload: object) => `${b64url('{"alg":"HS256"}')}.${b64url(JSON.stringify(payload))}.sig`;
const REF = 'abcdefghijklmnop';
const ME = 'user-me';
const later = (ms: number) => new Date(Date.now() + ms).toISOString();

/** Fenêtre « Mettre aux enchères » telle que le site la construit (portail fixed inset-0 > card-frame). */
function mountSellModal(withMarket = true) {
  document.body.innerHTML = `<div class="fixed inset-0 z-[60] flex items-center justify-center p-4" id="overlay">
    <div class="card-frame relative max-w-lg w-full p-6" id="frame">
      <h2>Mettre aux enchères</h2><p>Un exemplaire sera mis en réserve pour la durée de l'enchère.</p>
      <div><span>Zico</span>${withMarket ? `<div class="mt-1.5 space-y-1" id="zone"><p>Marché · Super Rare</p><div><span>Ventes</span><span>4</span></div><div><span>Moyenne</span><span>39</span></div></div>` : ''}</div>
      <label>Mise de départ</label><input type="number" aria-label="Mise de départ" value="10">
      <label>Durée</label><button type="button">1 h</button><button type="button">Annuler</button><button type="button">Mettre aux enchères</button>
    </div></div>`;
  let closed = 0;
  document.getElementById('overlay')!.addEventListener('click', () => closed++);
  return { closed: () => closed };
}

function stubApi(cardAuctions: unknown[], rarityRows: unknown[] = []) {
  document.cookie = `sb-${REF}-auth-token=${encodeURIComponent(JSON.stringify({ access_token: jwt({ sub: ME, exp: 9_999_999_999 }) }))}`;
  document.head.innerHTML = `<script src="https://www.wiki-masters.com/_next/static/chunks/app.js"></script>`;
  vi.stubGlobal('fetch', async (url: string) => {
    if (url.includes('/_next/')) return new Response(`u="https://${REF}.supabase.co";k="${jwt({ role: 'anon', ref: REF })}"`);
    const q = decodeURIComponent(url);
    if (q.includes('snapshot_rarity=eq.')) return new Response(JSON.stringify(rarityRows));
    if (q.includes('status=eq.active') && q.includes('card_id=eq.')) return new Response(JSON.stringify(cardAuctions));
    return new Response('[]');
  });
}

const settings = (over = {}) => ({ ...DEFAULT_SETTINGS, apiRead: true, ...over });
const cards = cardsById(card('zico', { name: 'Zico', rarity: 'SR', siteId: 'c-zico' }));
const flush = () => new Promise((r) => setTimeout(r, 20));

describe('fenêtre de vente : marché de la carte', () => {
  beforeEach(() => resetSellMarket());
  afterEach(() => vi.unstubAllGlobals());

  it('résumé sous « Marché · … » et liste des enchères sous la fenêtre, triée, sans fermer la fenêtre au clic', async () => {
    const modal = mountSellModal();
    stubApi([
      { id: 'a2', seller_id: 'x', base_amount: 30, current_bid: 31, end_at: later(3_600_000), is_shiny: false, status: 'active' },
      { id: 'a1', seller_id: 'y', base_amount: 25, current_bid: null, end_at: later(600_000), is_shiny: false, status: 'active' },
      { id: 'a3', seller_id: 'z', base_amount: 60, current_bid: null, end_at: later(7_200_000), is_shiny: true, status: 'active' },
      { id: 'mine', seller_id: ME, base_amount: 5, current_bid: null, end_at: later(60_000), is_shiny: false, status: 'active' },
    ]);
    enhanceSellDialog({ settings: settings(), cards, cfg: DEFAULT_SELECTORS });
    await flush();

    const summary = document.querySelector('[data-wiky="market-summary"]')!;
    expect(summary.previousElementSibling!.id).toBe('zone');
    expect(summary.textContent).toContain('3 offres · min 25 · méd. 31 · max 60');

    const list = document.querySelector('[data-wiky="market-list"]')!;
    expect(list.previousElementSibling!.id).toBe('frame');
    expect([...list.querySelectorAll('a')].map((a) => a.getAttribute('href'))).toEqual(['/marketplace/mine', '/marketplace/a1', '/marketplace/a2', '/marketplace/a3']);
    expect(list.textContent).toContain('à toi');
    (list.querySelector('a') as HTMLElement).addEventListener('click', (e) => e.preventDefault());
    (list.querySelector('a') as HTMLElement).click();
    expect(modal.closed()).toBe(0);
    expect((document.getElementById('overlay') as HTMLElement).style.flexDirection).toBe('column');

    // Relecture sans changement : aucune modification du DOM.
    const records: MutationRecord[] = [];
    const obs = new MutationObserver((r) => records.push(...r));
    obs.observe(document.body, { childList: true, subtree: true, attributes: true });
    enhanceSellDialog({ settings: settings(), cards, cfg: DEFAULT_SELECTORS });
    await flush();
    obs.disconnect();
    expect(records).toHaveLength(0);
  });

  it('aucune offre pour la carte : « aucune offre », sans statistiques de la rareté', async () => {
    mountSellModal();
    stubApi([], [{ current_bid: 12, base_amount: 10 }]);
    enhanceSellDialog({ settings: settings(), cards, cfg: DEFAULT_SELECTORS });
    await flush();
    const text = document.querySelector('[data-wiky="market-summary"]')!.textContent!;
    expect(text).toContain('aucune offre');
    expect(text).not.toContain('Super Rare');
    expect(text).not.toContain('min');
    expect(document.querySelector('[data-wiky="market-list"]')!.textContent).toContain('Aucune autre enchère en cours');
  });

  it('options indépendantes : liste seule, résumé seul, rien sans l\'API', async () => {
    mountSellModal();
    stubApi([]);
    enhanceSellDialog({ settings: settings({ sellMarketSummary: false }), cards, cfg: DEFAULT_SELECTORS });
    await flush();
    expect(document.querySelector('[data-wiky="market-summary"]')).toBeNull();
    expect(document.querySelector('[data-wiky="market-list"]')).not.toBeNull();

    resetSellMarket();
    enhanceSellDialog({ settings: settings({ sellMarketList: false }), cards, cfg: DEFAULT_SELECTORS });
    await flush();
    expect(document.querySelector('[data-wiky="market-list"]')).toBeNull();
    expect(document.querySelector('[data-wiky="market-summary"]')).not.toBeNull();

    enhanceSellDialog({ settings: settings({ apiRead: false }), cards, cfg: DEFAULT_SELECTORS });
    expect(document.querySelector('[data-wiky^="market"]')).toBeNull();
  });
});
