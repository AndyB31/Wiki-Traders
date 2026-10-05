// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { auctionModeEnabled, renderAuctionSwitch } from '../src/content/auction-mode';

/** Ligne du titre de la vraie page (« Collection » + « Sélectionner ») et une carte. */
function mount() {
  document.body.innerHTML = `<main><div class="flex-1 p-4 md:p-6 space-y-6">
    <div class="flex items-center justify-between gap-3"><h1 class="text-2xl md:text-3xl font-bold">Collection</h1><button type="button" class="inline-flex items-center gap-1.5 px-3">Sélectionner</button></div>
    <div class="relative isolate group"><div class="glow-r relative" id="tile"><h3>Zico</h3><button aria-label="Ajouter aux favoris"></button></div></div>
  </div></main>`;
  return document.getElementById('tile')!;
}

function hooks(prefill = true) {
  return {
    findTile: (t: Element) => (t.closest('#tile') ? { cardId: 'zico', tile: document.getElementById('tile')! } : null),
    sell: vi.fn(),
    prefillAllowed: () => prefill,
    allowPrefill: vi.fn(async () => {}),
  };
}

beforeEach(() => {
  localStorage.clear();
  history.replaceState(null, '', '/collection');
  if (auctionModeEnabled()) {
    // Repart du mode désactivé.
    mount();
    renderAuctionSwitch(hooks());
    document.querySelector<HTMLButtonElement>('[data-wiky="auction-switch"]')!.click();
  }
});

describe('mode enchère de la collection', () => {
  it('interrupteur sur la ligne du titre, juste avant « Sélectionner »', () => {
    mount();
    renderAuctionSwitch(hooks());
    const sw = document.querySelector<HTMLButtonElement>('[data-wiky="auction-switch"]')!;
    expect(sw.parentElement!.querySelector('h1')!.textContent).toBe('Collection');
    expect(sw.nextElementSibling!.textContent).toBe('Sélectionner');
    expect(sw.getAttribute('role')).toBe('switch');
    expect(sw.getAttribute('aria-checked')).toBe('false');
    // Rien ne bouge aux relectures suivantes.
    renderAuctionSwitch(hooks());
    expect(document.querySelectorAll('[data-wiky="auction-switch"]')).toHaveLength(1);
  });

  it('activation : avertissement si le pré-remplissage n\'est pas autorisé, refus = reste désactivé', async () => {
    mount();
    const h = hooks(false);
    renderAuctionSwitch(h);
    const sw = document.querySelector<HTMLButtonElement>('[data-wiky="auction-switch"]')!;
    vi.stubGlobal('confirm', () => false);
    sw.click();
    await Promise.resolve();
    expect(auctionModeEnabled()).toBe(false);
    vi.stubGlobal('confirm', () => true);
    sw.click();
    await new Promise((r) => setTimeout(r));
    expect(h.allowPrefill).toHaveBeenCalled();
    expect(auctionModeEnabled()).toBe(true);
    expect(sw.getAttribute('aria-checked')).toBe('true');
    expect(document.documentElement.hasAttribute('data-wiky-auction')).toBe(true);
    vi.unstubAllGlobals();
  });

  it('les clics de l\'extension (non « trusted ») sur une carte ne sont pas interceptés', async () => {
    const tile = mount();
    const h = hooks();
    renderAuctionSwitch(h);
    document.querySelector<HTMLButtonElement>('[data-wiky="auction-switch"]')!.click();
    await new Promise((r) => setTimeout(r));
    expect(auctionModeEnabled()).toBe(true);
    const opened = vi.fn();
    tile.addEventListener('click', opened);
    tile.querySelector('h3')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(opened).toHaveBeenCalled();
    expect(h.sell).not.toHaveBeenCalled();
  });

  it('absent hors de la collection', () => {
    mount();
    history.replaceState(null, '', '/marketplace');
    renderAuctionSwitch(hooks());
    expect(document.querySelector('[data-wiky="auction-switch"]')).toBeNull();
    expect(document.documentElement.hasAttribute('data-wiky-auction')).toBe(false);
  });
});
