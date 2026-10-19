// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_STORE } from '../src/lib/defaults';
import type { StoreShape } from '../src/lib/types';

const saved: Partial<StoreShape>[] = [];

vi.mock('../src/lib/storage', async (orig) => ({
  ...(await orig<typeof import('../src/lib/storage')>()),
  loadAll: async () => structuredClone(DEFAULT_STORE),
  save: async (patch: Partial<StoreShape>) => void saved.push(structuredClone(patch)),
  clearAll: async () => {},
}));
vi.mock('../src/lib/browser', () => ({ ext: { runtime: { sendMessage: async () => {} } } }));

const flush = () => new Promise((r) => setTimeout(r, 0));
const ctrlS = async () => {
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true }));
  await flush();
};
const type = (el: HTMLInputElement | HTMLTextAreaElement, value: string) => {
  el.value = value;
  el.dispatchEvent(new Event('input'));
};
const panel = (id: string) => document.getElementById(`panel-${id}`)!;

async function open(hash = '') {
  vi.resetModules();
  saved.length = 0;
  localStorage.clear();
  history.replaceState(null, '', `/options.html${hash}`);
  document.body.innerHTML = '<div id="app"></div>';
  Element.prototype.scrollIntoView = () => {};
  window.scrollTo = () => {};
  await import('../src/ui/options');
  await flush();
}

describe('page Réglages', () => {
  beforeEach(() => open());
  // Enregistre ce qui attend, pour qu'aucun enregistrement automatique ne déborde sur le test suivant.
  afterEach(ctrlS);

  it('six onglets, un seul panneau visible, interrupteurs partout', () => {
    const tabs = [...document.querySelectorAll('[role=tab]')].map((t) => t.textContent);
    expect(tabs).toEqual(['Accueil', 'Ventes', 'Étiquettes', 'Sur le site', 'Accès au site', 'Avancé']);
    expect([...document.querySelectorAll<HTMLElement>('[role=tabpanel]')].filter((p) => !p.hidden).map((p) => p.dataset.tab)).toEqual(['accueil']);
    expect(document.querySelectorAll('input[type=checkbox]:not([role=switch])')).toHaveLength(0);
    expect(document.querySelector('.quota-summary')!.textContent).toContain('5 slots : 1 × 50-100, 4 × 20-50');
    document.querySelector<HTMLButtonElement>('#tab-ventes')!.click();
    expect(panel('ventes').hidden).toBe(false);
    expect(panel('accueil').hidden).toBe(true);
  });

  it('vente et étiquetage séparés : chaque étiquette a sa carte dans Ventes et dans Étiquettes', () => {
    expect(panel('ventes').querySelectorAll('.rule-card')).toHaveLength(2);
    expect(panel('etiquettes').querySelectorAll('.rule-card')).toHaveLength(2);
    expect(panel('ventes').querySelector('input[aria-label="Plancher"]')).toBeNull();
    expect(panel('etiquettes').querySelector('input[aria-label="Slots réservés"]')).toBeNull();
    expect(panel('ventes').textContent).not.toContain('Dans la famille');
    // Le nom suit d'un onglet à l'autre.
    const name = panel('ventes').querySelector<HTMLInputElement>('.tag-input')!;
    type(name, '40-80');
    expect(panel('etiquettes').querySelector<HTMLInputElement>('.tag-input')!.value).toBe('40-80');
  });

  it('enregistre tout seul après une saisie, et seulement les aperçus changent', async () => {
    const pct = panel('ventes').querySelector<HTMLInputElement>('input[aria-label="% du prix moyen"]')!;
    const card = pct.closest('.rule-card')!;
    type(pct, '50');
    expect(pct.isConnected && pct.closest('.rule-card')).toBe(card);
    expect(card.querySelector('.example')!.textContent).toBe('ex. carte à 40 W → départ 20 W');
    expect(document.querySelector('.savebar .status')!.textContent).toContain('Enregistrement');
    await new Promise((r) => setTimeout(r, 600));
    expect(saved).toHaveLength(1);
    expect(saved[0].rules![0].pct).toBe(50);
    expect(document.querySelector('.savebar .status')!.textContent).toContain('Enregistré');
    expect(document.querySelector<HTMLButtonElement>('.savebar button')!.hidden).toBe(false);
  });

  it('« Annuler » revient à l\'état d\'avant et l\'enregistre', async () => {
    type(panel('ventes').querySelector<HTMLInputElement>('input[aria-label="% du prix moyen"]')!, '50');
    await ctrlS();
    document.querySelector<HTMLButtonElement>('.savebar button')!.click();
    await flush();
    expect(saved.at(-1)!.rules![0].pct).toBe(70);
    expect(panel('ventes').querySelector<HTMLInputElement>('input[aria-label="% du prix moyen"]')!.value).toBe('70');
  });

  it('n\'enregistre pas une saisie invalide et montre l\'erreur à côté du champ', async () => {
    const slots = panel('ventes').querySelector<HTMLInputElement>('#ventes input[type=number]')!;
    type(slots, '2');
    expect(slots.classList.contains('invalid')).toBe(true);
    expect((document.querySelector('#ventes .section-errors') as HTMLElement).hidden).toBe(false);
    await ctrlS();
    expect(saved).toHaveLength(0);
    expect(document.querySelector('.savebar .status')!.textContent).toContain('1 erreur');
  });

  it('taux de vente : paliers en « % du prix », interrupteur et seuil d\'enchères', async () => {
    const tdv = document.getElementById('tdv')!;
    [...tdv.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === '+ Ajouter un palier')!.click();
    type(tdv.querySelector<HTMLInputElement>('input[aria-label="Palier 1 : à"]')!, '42');
    const pct = tdv.querySelector<HTMLInputElement>('input[aria-label="Palier 1 : % du prix"]')!;
    type(pct, '81');
    expect(pct.closest('li')!.textContent).toContain('ex. départ 28 W → 25 W');
    type(tdv.querySelector<HTMLInputElement>('input[max="1000"]')!, '10');
    tdv.querySelector<HTMLInputElement>('.toggle input')!.click();
    await ctrlS();
    expect(saved.at(-1)!.settings).toMatchObject({ sellRateRules: [{ from: null, to: 42, pricePct: 81 }], sellRateMinSamples: 10, sellRateTiersOn: false });
  });

  it('la proposition par défaut remplit les paliers de durée et l\'aperçu', () => {
    const btn = [...document.querySelectorAll<HTMLButtonElement>('#durees button')].find((b) => b.textContent === 'Proposition par défaut')!;
    btn.click();
    expect(document.querySelectorAll('#durees .tier')).toHaveLength(3);
    expect([...document.querySelectorAll('.tiers-preview .chip')].map((c) => c.textContent)).toEqual(['0–20 W → 10 min', '21–100 W → 1 h', '101 W et + → 3 h']);
  });

  it('conditions (Étiquettes) et réglages de vente propres (Ventes), formule vérifiée en direct', async () => {
    const when = panel('etiquettes').querySelector<HTMLDetailsElement>('details.rule-extra')!;
    expect(when.querySelector('summary')!.textContent).toContain('aucune');
    type(when.querySelector<HTMLInputElement>('input[placeholder="ex. pays, ville"]')!, 'pays');
    expect(when.querySelector('summary')!.textContent).toContain('nom contient « pays »');
    const sale = panel('ventes').querySelector<HTMLDetailsElement>('details.rule-extra')!;
    sale.querySelector<HTMLInputElement>('.rule-sale .toggle input')!.click();
    const sort = [...sale.querySelectorAll('select')].find((s) => [...s.options].some((o) => o.value === 'score'))!;
    sort.value = 'score';
    sort.dispatchEvent(new Event('change'));
    const formula = sale.querySelector<HTMLTextAreaElement>('textarea.formula')!;
    expect(sale.querySelector('.formula-state')!.className).toContain('ok');
    type(formula, '{prix} *');
    expect(sale.querySelector('.formula-state')!.textContent).toContain('formule incomplète');
    sale.querySelector<HTMLButtonElement>('.formula-vars button')!.click();
    expect(formula.value).toBe('{prix} *{prix}');
    await ctrlS();
    const rule = saved.at(-1)!.rules![0];
    expect(rule.when).toMatchObject({ text: 'pays' });
    expect(rule.sale).toMatchObject({ sort: 'score', score: '{prix} *{prix}' });
  });

  it('ordre « selon mes critères » et mode « meilleures cartes »', async () => {
    const sort = [...document.querySelectorAll<HTMLSelectElement>('#prix select')].find((s) => [...s.options].some((o) => o.value === 'custom'))!;
    sort.value = 'custom';
    sort.dispatchEvent(new Event('change'));
    expect(document.querySelectorAll('#prix .criteria li')).toHaveLength(3);
    document.querySelector<HTMLButtonElement>('#prix .criteria li:nth-child(3) button[title="Monter"]')!.click();
    const mode = [...document.querySelectorAll<HTMLSelectElement>('#ventes select')].find((s) => [...s.options].some((o) => o.value === 'pool'))!;
    mode.value = 'pool';
    mode.dispatchEvent(new Event('change'));
    expect(document.querySelector('#ventes .quota-summary')!.textContent).toContain('meilleures cartes');
    await ctrlS();
    const s2 = saved.at(-1)!.settings!;
    expect(s2).toMatchObject({ sortPrice: 'custom', allocationMode: 'pool' });
    expect(s2.sortCriteria.map((c) => c.key)).toEqual(['doublons', 'prix', 'tdv']);
  });

  it('familles protégées par défaut, réglables dans « Jamais vendu »', async () => {
    const toggle = [...document.querySelectorAll<HTMLElement>('#protection .toggle')].find((t) => t.textContent!.includes('Cartes de mes familles'))!;
    const box = toggle.querySelector<HTMLInputElement>('input')!;
    expect(box.checked).toBe(true);
    box.click();
    await ctrlS();
    expect(saved.at(-1)!.settings!.protectFamilies).toBe(false);
  });

  it('seuil de confirmation de « Tout défausser », avec les fonctionnalités Paquets', async () => {
    const input = document.querySelector<HTMLInputElement>('#fonctionnalites .feature-extra input[type="number"]')!;
    expect(input.value).toBe('10');
    type(input, '50');
    await ctrlS();
    expect(saved.at(-1)!.settings!.discardConfirmAbove).toBe(50);
  });

  it('accès au site : un niveau à la fois, confirmation pour monter, enregistré aussitôt', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const read = document.querySelector<HTMLInputElement>('#acces input[value="read"]')!;
    read.click();
    await flush();
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(saved.at(-1)!.settings).toMatchObject({ apiRead: true, apiWrite: false });
    // Les mentions « nécessite la lecture via l'API » disparaissent.
    expect([...document.querySelectorAll<HTMLElement>('.need')].filter((n) => !n.hidden).every((n) => n.textContent!.includes('étiquetage'))).toBe(true);
    confirm.mockRestore();
  });

  it('profil : refusé sans confirmation, appliqué avec', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const complet = [...document.querySelectorAll<HTMLButtonElement>('.profile')].find((b) => b.textContent!.startsWith('Complet'))!;
    expect(document.querySelector('.profile.is-on')!.textContent).toContain('Prudent');
    complet.click();
    await flush();
    expect(saved).toHaveLength(0);
    confirm.mockReturnValue(true);
    complet.click();
    await flush();
    expect(saved.at(-1)!.settings).toMatchObject({ apiRead: true, apiWrite: true, autoTag: true, prefill: false });
    expect(document.querySelector('.profile.is-on')!.textContent).toContain('Complet');
    confirm.mockRestore();
  });
});

describe('page Réglages : anciennes ancres', () => {
  it('#maj ouvre l\'onglet Avancé, #automatisations l\'onglet Accès au site', async () => {
    await open('#maj');
    expect(panel('avance').hidden).toBe(false);
    await open('#automatisations');
    expect(panel('acces').hidden).toBe(false);
  });
});
