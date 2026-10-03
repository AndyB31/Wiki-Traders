// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { fillInput, findByText, findExact, isChecked, realClick } from '../src/content/actions';
import { fillSellPrice, openSellDialog, prefillSale } from '../src/content/automation';
import { DEFAULT_SELECTORS } from '../src/content/parsers/selectors';

describe('actions', () => {
  it('findByText préfère l\'élément le plus précis', () => {
    document.body.innerHTML = '<div role="button">Carte <button>Mettre en vente</button></div><button aria-label="Étiquettes">🏷</button>';
    expect(findByText(document, /mettre en vente/i)?.tagName).toBe('BUTTON');
    expect(findByText(document, DEFAULT_SELECTORS.tagButtonRe)?.getAttribute('aria-label')).toBe('Étiquettes');
  });

  it('findExact et isChecked', () => {
    document.body.innerHTML = '<div role="menu"><div role="menuitemcheckbox" aria-checked="true">20-50</div><div role="menuitemcheckbox" aria-checked="false">50 - 100</div></div>';
    expect(isChecked(findExact(document, '20-50')!)).toBe(true);
    expect(isChecked(findExact(document, '50-100')!)).toBe(false);
  });

  it('realClick déclenche pointerdown et click', () => {
    document.body.innerHTML = '<button>ok</button>';
    const seen: string[] = [];
    const b = document.querySelector('button')!;
    for (const t of ['pointerdown', 'mousedown', 'click']) b.addEventListener(t, () => seen.push(t));
    realClick(b);
    expect(seen).toEqual(['pointerdown', 'mousedown', 'click']);
  });

  it('fillInput déclenche input et change', () => {
    document.body.innerHTML = '<input type="number">';
    const i = document.querySelector('input')!;
    const seen: string[] = [];
    i.addEventListener('input', () => seen.push('input'));
    i.addEventListener('change', () => seen.push('change'));
    fillInput(i, '40');
    expect(i.value).toBe('40');
    expect(seen).toEqual(['input', 'change']);
  });

  it('remplit le prix de la fenêtre de vente sans cliquer sur valider', () => {
    document.body.innerHTML = '<div role="dialog"><h2>Mettre en vente</h2><input type="number"><button>Mettre en vente</button></div>';
    let submitted = false;
    document.querySelector('button')!.addEventListener('click', () => (submitted = true));
    expect(openSellDialog(DEFAULT_SELECTORS)).not.toBeNull();
    expect(fillSellPrice(DEFAULT_SELECTORS, 40)).toBe(true);
    expect(document.querySelector('input')!.value).toBe('40');
    expect(submitted).toBe(false);
  });
});

describe('parcours de vente réel (structure du site)', () => {
  /** Fiche carte puis fenêtre de vente, comme sur WikiMasters : portails « div.fixed.inset-0 » sans role. */
  function mountSite(disabled = false) {
    document.body.innerHTML = `<main><div class="relative isolate group"><div class="glow-sr relative" id="tile"><img alt="" src="/super_rare.png"><img alt="Zico" src="/z.jpg"><h3>Zico</h3></div></div></main>`;
    let submitted = 0;
    let duration: string | null = '1 h';
    document.getElementById('tile')!.addEventListener('click', () => {
      const detail = document.createElement('div');
      detail.className = 'fixed inset-0 z-50 flex items-center justify-center';
      detail.innerHTML = `<div class="card-frame relative"><div role="tablist" aria-label="Vue de la carte"><button role="tab">Détails</button><button role="tab">Lab</button><button role="tab">Étiquettes</button></div>
        <h2>Zico</h2><button type="button" ${disabled ? 'disabled title="Maximum 5 enchères actives"' : ''}>Mettre aux enchères</button><button type="button">Défausser</button></div>`;
      detail.querySelector('button:not([role])')!.addEventListener('click', () => {
        const sell = document.createElement('div');
        sell.className = 'fixed inset-0 z-[60] flex items-center justify-center p-4';
        sell.innerHTML = `<div class="card-frame relative max-w-lg"><h2>Mettre aux enchères</h2><p>Zico</p><p>Un exemplaire sera mis en réserve pour la durée de l'enchère.</p>
          <label>Mise de départ</label><button aria-label="Diminuer">-</button><input type="number" inputmode="numeric" min="1" aria-label="Mise de départ"><button aria-label="Augmenter">+</button>
          <label>Durée</label><button type="button" class="dur">10 min</button><button type="button" class="dur">1 h</button><button type="button" class="dur">3 h</button>
          <button type="button">Annuler</button><button type="button" class="submit">Mettre aux enchères</button></div>`;
        sell.querySelector('.submit')!.addEventListener('click', () => submitted++);
        sell.querySelectorAll('.dur').forEach((b) => b.addEventListener('click', () => (duration = b.textContent)));
        document.body.append(sell);
      });
      document.body.append(detail);
    });
    return { submitted: () => submitted, duration: () => duration };
  }

  it('ouvre la fiche, puis la vente, remplit la mise de départ, choisit la durée et ne valide pas', async () => {
    const site = mountSite();
    const steps: string[] = [];
    await prefillSale(document.getElementById('tile')!, 20, DEFAULT_SELECTORS, (s) => steps.push(s), 10);
    expect(steps).toEqual(['ouverture de la carte', 'ouverture de la vente', 'prix rempli', 'durée 10 min']);
    expect(site.duration()).toBe('10 min');
    expect(document.querySelector<HTMLInputElement>('input[aria-label="Mise de départ"]')!.value).toBe('20');
    expect(site.submitted()).toBe(0);
  });

  it('signale le bouton désactivé (maximum d\'enchères atteint)', async () => {
    mountSite(true);
    await expect(prefillSale(document.getElementById('tile')!, 20, DEFAULT_SELECTORS, () => {})).rejects.toThrow('Maximum 5 enchères actives');
  });
});
