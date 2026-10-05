// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { endProgress, showProgress, updateOverlay } from '../src/content/overlay';
import { DEFAULT_SELECTORS } from '../src/content/parsers/selectors';
import { card, cardsById, input } from './helpers';

const toast = (id: string) => document.querySelector<HTMLElement>(`[data-wiky="toast"][data-id="${id}"]`);

describe('toasts dans le style du site', () => {
  it('prix conseillé : toast dans le DOM de la page, surface et couleurs du site', () => {
    document.body.innerHTML = '<main></main>';
    const store = {
      ...input({ cards: cardsById(card('zico', { name: 'Zico' })) }),
      pendingFocus: { cardId: 'zico', cardName: 'Zico', price: 21, detail: 'moyenne site 25 × 84 % = 21', at: Date.now(), durationMin: null },
    };
    const state = { store, cfg: DEFAULT_SELECTORS, kind: 'collection', root: document.querySelector('main')!, tiles: new Map() };
    updateOverlay(state);
    const t = toast('price')!;
    expect(t.parentElement!.parentElement).toBe(document.body);
    expect(t.classList.contains('card-frame')).toBe(true);
    expect(t.textContent).toContain('Zico');
    expect(t.textContent).toContain('21');
    expect(t.closest('[data-wiky]')).not.toBeNull();
    // Mise à jour sans changement : même nœud, pas de nouvelle animation.
    updateOverlay(state);
    expect(toast('price')).toBe(t);
  });

  it('progression : barre, bouton Arrêter, résumé qui disparaît seul', () => {
    vi.useFakeTimers();
    document.body.innerHTML = '';
    const stop = vi.fn();
    showProgress('Étiquetage (API)', '2/4 · Zico\n✓ Pelé', { onStop: stop, step: 2, total: 4 });
    const bar = toast('progress')!.querySelector<HTMLElement>('[role="progressbar"]')!;
    expect(bar.getAttribute('aria-valuenow')).toBe('2');
    expect((bar.firstElementChild as HTMLElement).style.width).toBe('50%');
    [...toast('progress')!.querySelectorAll('button')].find((b) => b.textContent === 'Arrêter')!.click();
    expect(stop).toHaveBeenCalled();
    showProgress('Étiquetage (API)', '4 carte(s) étiquetée(s)', { done: true });
    expect(toast('progress')!.textContent).not.toContain('Arrêter');
    vi.advanceTimersByTime(11_000);
    expect(toast('progress')).toBeNull();
    expect(document.querySelector('[data-wiky="toasts"]')).toBeNull();
    vi.useRealTimers();
  });

  it('une erreur reste affichée', () => {
    vi.useFakeTimers();
    document.body.innerHTML = '';
    showProgress('Zico', 'Ouverture impossible', { error: true });
    vi.advanceTimersByTime(60_000);
    expect(toast('progress')!.getAttribute('role')).toBe('alert');
    endProgress();
    expect(toast('progress')).toBeNull();
    vi.useRealTimers();
  });
});
