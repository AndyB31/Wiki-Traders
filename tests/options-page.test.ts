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
    expect(ids).toEqual(['demarrage', 'ventes', 'prix', 'durees', 'tdv', 'notifications', 'affichage', 'fonctionnalites', 'automatisations', 'maj', 'avance']);
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

  it('conditions et réglages de vente propres à une étiquette, formule vérifiée en direct, enregistrés', async () => {
    const details = document.querySelector<HTMLDetailsElement>('#ventes details.rule-extra')!;
    expect(details.querySelector('summary')!.textContent).toContain('aucune condition');
    const text = details.querySelector<HTMLInputElement>('input[placeholder="ex. pays, ville"]')!;
    text.value = 'pays';
    text.dispatchEvent(new Event('input'));
    expect(details.querySelector('summary')!.textContent).toContain('nom contient « pays »');
    details.querySelector<HTMLInputElement>('.rule-sale .toggle input')!.click();
    const sort = [...details.querySelectorAll('select')].find((s) => [...s.options].some((o) => o.value === 'score'))!;
    sort.value = 'score';
    sort.dispatchEvent(new Event('change'));
    const formula = details.querySelector<HTMLTextAreaElement>('textarea.formula')!;
    expect(details.querySelector('.formula-state')!.className).toContain('ok');
    formula.value = '{prix} *';
    formula.dispatchEvent(new Event('input'));
    expect(details.querySelector('.formula-state')!.textContent).toContain('formule incomplète');
    details.querySelector<HTMLButtonElement>('.formula-vars button')!.click();
    expect(formula.value).toBe('{prix} *{prix}');
    document.querySelector<HTMLButtonElement>('.savebar button.primary')!.click();
    await flush();
    const rule = saved.at(-1)!.rules![0];
    expect(rule.when).toMatchObject({ text: 'pays' });
    expect(rule.sale).toMatchObject({ sort: 'score', score: '{prix} *{prix}' });
  });

  it('ordre « selon mes critères » et mode « meilleures cartes »', async () => {
    const selects = [...document.querySelectorAll<HTMLSelectElement>('#prix select')];
    const sort = selects.find((s) => [...s.options].some((o) => o.value === 'custom'))!;
    sort.value = 'custom';
    sort.dispatchEvent(new Event('change'));
    const rows = () => [...document.querySelectorAll('#prix .criteria li')];
    expect(rows()).toHaveLength(3);
    document.querySelector<HTMLButtonElement>('#prix .criteria li:nth-child(3) button[title="Monter"]')!.click();
    const mode = selects.find((s) => [...s.options].some((o) => o.value === 'pool'))!;
    mode.value = 'pool';
    mode.dispatchEvent(new Event('change'));
    expect(document.querySelector('#ventes .quota-summary')!.textContent).toContain('meilleures cartes');
    document.querySelector<HTMLButtonElement>('.savebar button.primary')!.click();
    await flush();
    const s2 = saved.at(-1)!.settings!;
    expect(s2).toMatchObject({ sortPrice: 'custom', allocationMode: 'pool' });
    expect(s2.sortCriteria.map((c) => c.key)).toEqual(['doublons', 'prix', 'tdv']);
  });
});
