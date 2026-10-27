// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_STORE } from '../src/lib/defaults';
import type { Card, StoreShape } from '../src/lib/types';

const saved: Partial<StoreShape>[] = [];
/** Données en plus du magasin par défaut (cartes de la collection pour l'aperçu). */
let extra: Partial<StoreShape> = {};

vi.mock('../src/lib/storage', async (orig) => ({
  ...(await orig<typeof import('../src/lib/storage')>()),
  loadAll: async () => ({ ...structuredClone(DEFAULT_STORE), ...structuredClone(extra) }),
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

const card = (id: string, sitePrice: number, over: Partial<Card> = {}): Card => ({ id, name: id, rarity: 'R', tags: [], quantity: 2, favorite: false, sitePrice, sitePriceAt: null, updatedAt: 0, ...over });

/** Passe l'onglet Ventes en mode « par étiquette » (la page se redessine). */
function quotaMode() {
  const mode = [...panel('ventes').querySelectorAll<HTMLSelectElement>('#ventes select')].find((x) => [...x.options].some((o) => o.value === 'quota'))!;
  mode.value = 'quota';
  mode.dispatchEvent(new Event('change'));
}

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

  it('huit onglets, un seul panneau visible, interrupteurs partout', () => {
    const tabs = [...document.querySelectorAll('[role=tab]')].map((t) => t.textContent);
    expect(tabs).toEqual(['Accueil', 'Ventes', 'Étiquettes', 'Familles', 'Interface', 'Sur le site', 'Accès au site', 'Avancé']);
    expect([...document.querySelectorAll<HTMLElement>('[role=tabpanel]')].filter((p) => !p.hidden).map((p) => p.dataset.tab)).toEqual(['accueil']);
    expect(document.querySelectorAll('input[type=checkbox]:not([role=switch])')).toHaveLength(0);
    document.querySelector<HTMLButtonElement>('#tab-ventes')!.click();
    expect(panel('ventes').hidden).toBe(false);
    expect(panel('accueil').hidden).toBe(true);
  });

  it('meilleures cartes par défaut : filtre d\'étiquettes, calcul, paliers, priorité, aperçu ; pas d\'étiquette à régler', () => {
    const ids = [...panel('ventes').querySelectorAll('section')].map((x) => x.id);
    expect(ids.slice(0, 6)).toEqual(['ventes', 'cartes-a-vendre', 'prix', 'paliers', 'priorite', 'apercu']);
    expect(panel('ventes').querySelector('.tag-input')).toBeNull();
    expect(panel('etiquettes').querySelectorAll('.rule-card')).toHaveLength(2);
    quotaMode();
    expect(panel('ventes').querySelectorAll('.rule-card')).toHaveLength(2);
    expect(document.querySelector('.quota-summary')!.textContent).toContain('5 slots : 1 × 50-100, 4 × 20-50');
    expect(document.getElementById('paliers')).toBeNull();
    // Le nom suit d'un onglet à l'autre.
    type(panel('ventes').querySelector<HTMLInputElement>('.tag-input')!, '40-80');
    expect(panel('etiquettes').querySelector<HTMLInputElement>('.tag-input')!.value).toBe('40-80');
  });

  it('enregistre tout seul après une saisie, et seulement l\'exemple change', async () => {
    const pct = document.querySelector<HTMLInputElement>('#prix input[min="1"][max="500"]')!;
    const example = document.querySelector('#prix .calc-example')!;
    expect(example.textContent).toContain('Carte à 40 W : 30 W si elle se vend 16 fois sur 20 · 25 W si 4 sur 20');
    type(pct, '50');
    expect(pct.isConnected).toBe(true);
    expect(example.textContent).toContain('Carte à 40 W : 25 W si elle se vend 16 fois sur 20 · 17 W si 4 sur 20');
    expect(document.querySelector('.savebar .status')!.textContent).toContain('Enregistrement');
    await new Promise((r) => setTimeout(r, 600));
    expect(saved).toHaveLength(1);
    expect(saved[0].settings!.defaultCalc.pct).toBe(50);
    expect(document.querySelector('.savebar .status')!.textContent).toContain('Enregistré');
    expect(document.querySelector<HTMLButtonElement>('.savebar button')!.hidden).toBe(false);
  });

  it('« Annuler » revient à l\'état d\'avant et l\'enregistre', async () => {
    type(document.querySelector<HTMLInputElement>('#prix input[min="1"][max="500"]')!, '50');
    await ctrlS();
    document.querySelector<HTMLButtonElement>('.savebar button')!.click();
    await flush();
    expect(saved.at(-1)!.settings!.defaultCalc.pct).toBe(70);
    expect(document.querySelector<HTMLInputElement>('#prix input[min="1"][max="500"]')!.value).toBe('70');
  });

  it('n\'enregistre pas une saisie invalide et montre l\'erreur à côté du champ', async () => {
    const pct = document.querySelector<HTMLInputElement>('#prix input[min="1"][max="500"]')!;
    type(pct, '0');
    expect(pct.classList.contains('invalid')).toBe(true);
    expect((document.querySelector('#prix .section-errors') as HTMLElement).hidden).toBe(false);
    await ctrlS();
    expect(saved).toHaveLength(0);
    expect(document.querySelector('.savebar .status')!.textContent).toContain('1 erreur');
  });

  it('calcul : simple ↔ avancé sans perdre les valeurs, minimum, formule vérifiée en direct', async () => {
    const calc = document.querySelector('#prix .calc')!;
    type(calc.querySelector<HTMLInputElement>('input[aria-label="Prix minimum (W)"]')!, '25');
    [...calc.querySelectorAll<HTMLButtonElement>('.segmented button')].find((b) => b.textContent === 'Avancé')!.click();
    const formula = calc.querySelector<HTMLTextAreaElement>('textarea.formula')!;
    expect(calc.querySelector('.formula-state')!.className).toContain('ok');
    type(formula, '{prix} *');
    expect(calc.querySelector('.formula-state')!.textContent).toContain('formule incomplète');
    calc.querySelector<HTMLButtonElement>('.formula-vars button')!.click();
    expect(formula.value).toBe('{prix} *{prix}');
    await ctrlS();
    expect(saved.at(-1)!.settings!.defaultCalc).toMatchObject({ mode: 'formula', formula: '{prix} *{prix}', pct: 70, minPrice: 25 });
  });

  it('paliers : proposition, option A par défaut, calcul propre, slots réservés sur option', async () => {
    [...document.querySelectorAll<HTMLButtonElement>('#paliers button')].find((b) => b.textContent!.startsWith('Proposition'))!.click();
    const cards = () => [...document.querySelectorAll('#paliers .rule-card')];
    expect(cards().map((c) => c.querySelector('.tier-title')!.textContent)).toEqual(['jusqu\'à 20 W', '21–100 W', '101 W et +']);
    expect(cards()[0].querySelector('.segmented .is-on')!.textContent).toBe('Par défaut');
    expect(document.querySelector('#paliers input[aria-label="Slots réservés"]')).toBeNull();
    [...cards()[0].querySelectorAll<HTMLButtonElement>('.segmented button')].find((b) => b.textContent === 'Simple')!.click();
    type(cards()[0].querySelector<HTMLInputElement>('input[min="1"][max="500"]')!, '100');
    document.querySelector<HTMLInputElement>('#paliers .toggles input')!.click();
    expect(document.querySelectorAll('#paliers input[aria-label="Slots réservés"]')).toHaveLength(3);
    type(document.querySelector<HTMLInputElement>('#paliers input[aria-label="Palier : à"]')!, '15');
    expect(cards()[0].querySelector('.tier-title')!.textContent).toBe('jusqu\'à 15 W');
    await ctrlS();
    const s = saved.at(-1)!.settings!;
    expect(s.reserveTierSlots).toBe(true);
    expect(s.priceTiers.map((t) => [t.to, t.calc.mode, t.calc.pct])).toEqual([[15, 'simple', 100], [100, 'default', 70], [null, 'default', 70]]);
  });

  it('cartes à vendre : mode et étiquettes cochées', async () => {
    const chips = () => [...document.querySelectorAll<HTMLButtonElement>('#cartes-a-vendre .tag-chip')];
    expect(chips().map((c) => c.textContent)).toEqual(['20-50', '50-100']);
    chips()[1].click();
    const mode = document.querySelector<HTMLSelectElement>('#cartes-a-vendre select')!;
    mode.value = 'include';
    mode.dispatchEvent(new Event('change'));
    expect(document.querySelector('#cartes-a-vendre')!.textContent).toContain('Seules les cartes avec cette étiquette');
    await ctrlS();
    expect(saved.at(-1)!.settings!.saleTags).toEqual({ mode: 'include', tags: ['50-100'] });
  });

  it('priorité : équilibrée par défaut, critères, formule', async () => {
    expect(document.querySelector('#priorite .level.is-on')!.textContent).toContain('Équilibrée');
    document.querySelector<HTMLInputElement>('#priorite input[value="custom"]')!.click();
    expect(document.querySelectorAll('#priorite .criteria li')).toHaveLength(3);
    document.querySelector<HTMLButtonElement>('#priorite .criteria li:nth-child(3) button[title="Monter"]')!.click();
    await ctrlS();
    expect(saved.at(-1)!.settings!.sortCriteria.map((c) => c.key)).toEqual(['doublons', 'prix', 'tdv']);
    document.querySelector<HTMLInputElement>('#priorite input[value="formula"]')!.click();
    type(document.querySelector<HTMLTextAreaElement>('#priorite textarea')!, '{prix} +');
    expect(document.querySelector('#priorite .section-errors')!.textContent).toContain('Formule de priorité');
  });

  it('la proposition par défaut remplit les paliers de durée et l\'aperçu', () => {
    const btn = [...document.querySelectorAll<HTMLButtonElement>('#durees button')].find((b) => b.textContent === 'Proposition par défaut')!;
    btn.click();
    expect(document.querySelectorAll('#durees .tier')).toHaveLength(3);
    expect([...document.querySelectorAll('.tiers-preview .chip')].map((c) => c.textContent)).toEqual(['0–20 W → 10 min', '21–100 W → 1 h', '101 W et + → 3 h']);
  });

  it('conditions de l\'étiquetage dans Étiquettes', async () => {
    const when = panel('etiquettes').querySelector<HTMLDetailsElement>('details.rule-extra')!;
    expect(when.querySelector('summary')!.textContent).toContain('aucune');
    type(when.querySelector<HTMLInputElement>('input[placeholder="ex. pays, ville"]')!, 'pays');
    expect(when.querySelector('summary')!.textContent).toContain('nom contient « pays »');
    await ctrlS();
    expect(saved.at(-1)!.rules![0].when).toMatchObject({ text: 'pays' });
  });

  it('par étiquette : calcul propre à une étiquette', async () => {
    quotaMode();
    const card = panel('ventes').querySelector('.rule-card')!;
    [...card.querySelectorAll<HTMLButtonElement>('.segmented button')].find((b) => b.textContent === 'Simple')!.click();
    type(card.querySelector<HTMLInputElement>('input[min="1"][max="500"]')!, '90');
    await ctrlS();
    const s = saved.at(-1)!;
    expect(s.settings!.allocationMode).toBe('quota');
    expect(s.rules![0].calc).toMatchObject({ mode: 'simple', pct: 90 });
    expect(s.rules![1].calc).toBeUndefined();
  });

  it('taux de vente : seuil d\'enchères et minimum', async () => {
    type(document.querySelector<HTMLInputElement>('#tdv input[max="1000"]')!, '10');
    type(document.querySelector<HTMLInputElement>('#tdv input[placeholder="aucun"]')!, '15');
    await ctrlS();
    expect(saved.at(-1)!.settings).toMatchObject({ sellRateMinSamples: 10, minSellRate: 15 });
  });

  it('familles protégées par défaut, réglables dans Familles', async () => {
    expect(document.querySelector('#protection')!.textContent).toContain('Cartes de tes familles : jamais vendues');
    const toggle = document.querySelector<HTMLElement>('#familles-vente .toggle')!;
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

describe('page Réglages : familles et étiquetage', () => {
  it('une étiquette par famille ; plus de famille ni de « pour les ventes » dans Étiquettes', async () => {
    extra = { myFamilies: [{ id: 'f1', name: 'Films', color: '#f00', cards: [], createdAt: 0, updatedAt: 0 }] as never };
    await open();
    expect(panel('etiquettes').textContent).not.toContain('Dans la famille');
    expect(panel('etiquettes').textContent).not.toContain('Pour les ventes');
    [...document.querySelectorAll<HTMLButtonElement>('#familles-etiquettes button')].find((b) => b.textContent === '+ Étiqueter une famille')!.click();
    type(document.querySelector<HTMLInputElement>('#familles-etiquettes input.tag-input')!, 'Cinéma');
    await ctrlS();
    expect(saved.at(-1)!.settings!.familyTags).toMatchObject([{ active: true, family: 'Films', tag: 'Cinéma' }]);
    extra = {};
  });

  it('lancement de l\'étiquetage : à la demande ou en continu', async () => {
    await open();
    const continuous = document.querySelector<HTMLInputElement>('#etiquetage-auto input[name="autoTagLaunch"]:not(:checked)')!;
    continuous.click();
    expect(continuous.closest('.level')!.textContent).toContain('Nécessite l\'étiquetage par l\'API');
    await ctrlS();
    expect(saved.at(-1)!.settings!.autoTagContinuous).toBe(true);
  });
});

describe('page Réglages : aperçu', () => {
  it('montre les prochaines ventes avec les réglages en cours', async () => {
    extra = { cards: { a: card('a', 100), b: card('b', 20, { tags: ['Perso'] }), c: card('c', 50, { quantity: 1 }) } };
    await open();
    await new Promise((r) => setTimeout(r, 200));
    const rows = () => [...document.querySelectorAll('#apercu li')].map((li) => li.querySelector('strong')!.textContent);
    // c n'a qu'un exemplaire (gardé).
    expect(rows()).toEqual(['a', 'b']);
    [...document.querySelectorAll<HTMLButtonElement>('#cartes-a-vendre .tag-chip')].find((x) => x.textContent === 'Perso')!.click();
    await new Promise((r) => setTimeout(r, 200));
    expect(rows()).toEqual(['a']);
    expect(document.querySelector('#apercu li')!.textContent).toContain('70 W');
    extra = {};
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

describe('page Réglages : vues de la collection', () => {
  it('#interface : créer une vue « 10-100 A→Z », compter ses cartes, l\'enregistrer', async () => {
    extra = { cards: { a: card('a', 50, { name: 'Zola', tags: ['10-100'] }), b: card('b', 20, { name: 'Balzac', tags: ['10-100'] }), c: card('c', 500, { name: 'Hugo', tags: ['100+'] }) } };
    await open('#interface');
    expect(panel('interface').hidden).toBe(false);
    // L'intégration au site est rangée ici, avec les vues.
    expect([...panel('interface').querySelectorAll('section')].map((x) => x.id)).toEqual(['affichage', 'vues']);
    [...panel('interface').querySelectorAll('button')].find((b) => b.textContent === '+ Nouvelle vue')!.click();
    const view = panel('interface').querySelector('.view-card')!;
    type(view.querySelector<HTMLInputElement>('.view-name')!, '10-100 A→Z');
    [...view.querySelectorAll<HTMLButtonElement>('.tag-chip')].find((x) => x.textContent === '10-100')!.click();
    expect(view.querySelector('.view-count')!.textContent).toBe('2 cartes de ta collection : Balzac, Zola');
    // Icône : l'entonnoir par défaut ; un clic sur l'icône à côté du nom ouvre le choix, choisir le referme.
    const iconButton = view.querySelector<HTMLButtonElement>('button.view-icon')!;
    const picker = view.querySelector<HTMLElement>('.icon-picks')!;
    expect(picker.hidden).toBe(true);
    iconButton.click();
    expect(picker.hidden).toBe(false);
    expect(iconButton.getAttribute('aria-expanded')).toBe('true');
    expect(view.querySelector('.icon-pick.is-on')!.getAttribute('aria-label')).toBe('Filtre');
    view.querySelector<HTMLButtonElement>('.icon-pick[aria-label="Étoile"]')!.click();
    expect(picker.hidden).toBe(true);
    expect(view.querySelector('.icon-pick.is-on')!.getAttribute('aria-label')).toBe('Étoile');
    expect(iconButton.getAttribute('aria-label')).toBe('Icône du menu : Étoile (changer)');
    // Échap referme le choix sans rien changer.
    iconButton.click();
    picker.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(picker.hidden).toBe(true);
    await ctrlS();
    const v = saved.at(-1)!.settings!.collectionViews[0];
    expect(v).toMatchObject({ name: '10-100 A→Z', active: true, icon: 'star', sort: 'name', dir: 'asc' });
    expect(v.filter.tags).toEqual(['10-100']);
    extra = {};
  });
});

describe('page Réglages : étiquettes avec « ou »', () => {
  it('ajoute un groupe « ou » (plage + taux de vente), résumé et enregistrement', async () => {
    await open('#etiquettes');
    const ruleCard = panel('etiquettes').querySelector<HTMLElement>('.rule-card[data-rule="r-50-100"]')!;
    // Sans « ou », pas de résumé « Posée si ».
    expect(ruleCard.querySelector<HTMLElement>('.rule-or-summary')!.hidden).toBe(true);
    [...ruleCard.querySelectorAll('button')].find((b) => b.textContent === '+ Ajouter un « ou »')!.click();
    const card2 = panel('etiquettes').querySelector<HTMLElement>('.rule-card[data-rule="r-50-100"]')!;
    const alt = card2.querySelector<HTMLElement>('.rule-or')!;
    type(alt.querySelector<HTMLInputElement>('input[aria-label="Plancher"]')!, '200');
    type(alt.querySelector<HTMLInputElement>('input[aria-label="Plafond"]')!, '500');
    type(alt.querySelector<HTMLInputElement>('input[aria-label="Taux de vente minimum"]')!, '70');
    const summary = card2.querySelector<HTMLElement>('.rule-or-summary')!;
    expect(summary.hidden).toBe(false);
    expect(summary.textContent).toBe('Posée si : (50–100 W) ou (200–500 W · tdv ≥ 70 %)');
    await ctrlS();
    expect(saved.at(-1)!.rules!.find((r) => r.id === 'r-50-100')!.or).toMatchObject([{ floor: 200, ceiling: 500, when: { rateMin: 70 } }]);
    // Retirer le groupe.
    card2.querySelector<HTMLButtonElement>('.rule-or button[aria-label^="Retirer le groupe"]')!.click();
    expect(panel('etiquettes').querySelector('.rule-card[data-rule="r-50-100"] .rule-or')).toBeNull();
  });
});
