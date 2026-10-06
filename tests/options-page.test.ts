// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_STORE } from '../src/lib/defaults';
import type { StoreShape } from '../src/lib/types';

const saved: Partial<StoreShape>[] = [];

vi.mock('../src/lib/storage', () => ({
  loadAll: async () => structuredClone(DEFAULT_STORE),
  save: async (patch: Partial<StoreShape>) => void saved.push(structuredClone(patch)),
  clearAll: async () => {},
}));
vi.mock('../src/lib/browser', () => ({ ext: { runtime: { sendMessage: async () => {} } } }));

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('page Réglages', () => {
  beforeEach(async () => {
    vi.resetModules();
    saved.length = 0;
    document.body.innerHTML = '<div id="app"></div>';
    Element.prototype.scrollIntoView = () => {};
    window.scrollTo = () => {};
    await import('../src/ui/options');
    await flush();
  });

  it('affiche les sections dans l\'ordre, avec sommaire et interrupteurs', () => {
    const ids = [...document.querySelectorAll('.sections > [id]')].map((s) => s.id);
    expect(ids).toEqual(['demarrage', 'ventes', 'prix', 'durees', 'notifications', 'affichage', 'fonctionnalites', 'automatisations', 'maj', 'avance']);
    expect(document.querySelectorAll('.toc a')).toHaveLength(ids.length);
    expect(document.querySelectorAll('input[type=checkbox]:not([role=switch])')).toHaveLength(0);
    expect((document.getElementById('avance') as HTMLDetailsElement).open).toBe(false);
    expect(document.querySelector('.quota-summary')!.textContent).toContain('5 slots : 1 × 50-100, 4 × 20-50');
  });

  it('Enregistrer est désactivé tant que rien ne change, puis met à jour seulement les aperçus', async () => {
    const saveBtn = document.querySelector<HTMLButtonElement>('.savebar button.primary')!;
    expect(saveBtn.disabled).toBe(true);
    const pct = document.querySelector<HTMLInputElement>('input[aria-label="% du prix moyen"]')!;
    const row = pct.closest('tr')!;
    pct.value = '50';
    pct.dispatchEvent(new Event('input'));
    expect(pct.isConnected && pct.closest('tr')).toBe(row);
    expect(row.querySelector('.example')!.textContent).toBe('ex. carte à 40 W → départ 20 W');
    expect(saveBtn.disabled).toBe(false);
    expect(document.querySelector('.savebar .status')!.textContent).toContain('Modifications non enregistrées');

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true }));
    await flush();
    expect(saved).toHaveLength(1);
    expect(saved[0].rules![0].pct).toBe(50);
    expect(saveBtn.disabled).toBe(true);
  });

  it('bloque l\'enregistrement et montre l\'erreur à côté du champ', async () => {
    const slots = document.querySelector<HTMLInputElement>('#prix input[type=number]')!;
    slots.value = '2';
    slots.dispatchEvent(new Event('input'));
    expect(slots.classList.contains('invalid')).toBe(true);
    expect((document.querySelector('#ventes .section-errors') as HTMLElement).hidden).toBe(false);
    expect(document.querySelector('.savebar .status')!.textContent).toContain('1 erreur');
    document.querySelector<HTMLButtonElement>('.savebar button.primary')!.click();
    await flush();
    expect(saved).toHaveLength(0);
  });

  it('la proposition par défaut remplit les paliers et l\'aperçu', () => {
    const btn = [...document.querySelectorAll<HTMLButtonElement>('#durees button')].find((b) => b.textContent === 'Proposition par défaut')!;
    btn.click();
    expect(document.querySelectorAll('#durees .tier')).toHaveLength(3);
    expect([...document.querySelectorAll('.tiers-preview .chip')].map((c) => c.textContent)).toEqual(['0–20 W → 10 min', '21–100 W → 1 h', '101 W et + → 3 h']);
  });
});
