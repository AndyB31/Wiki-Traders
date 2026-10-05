/**
 * Bouton « Étiquettes » sur la ligne du titre de la collection, juste après « Plus chères » : c'est depuis la
 * collection qu'on lance l'étiquetage. Il ouvre la fenêtre « Étiquetage » de Wiky-Traders par-dessus la page.
 */
import { openModal } from '../site-ui';
import { collectionTools, isCollection, removeTool } from './dom';
import { registerFeature, type FeatureContext } from './runtime';

const ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 5 6.3 6.3a2.4 2.4 0 0 1 0 3.4L17 19"/><path d="M9.586 5.586A2 2 0 0 0 8.172 5H3a1 1 0 0 0-1 1v5.172a2 2 0 0 0 .586 1.414L8.29 18.29a2.426 2.426 0 0 0 3.42 0l3.58-3.58a2.426 2.426 0 0 0 0-3.42z"/><circle cx="6.5" cy="9.5" r=".5" fill="currentColor"/></svg>';

function render(ctx: FeatureContext): void {
  if (!isCollection(ctx)) {
    removeTool('tags');
    return;
  }
  const tools = collectionTools();
  if (!tools) return;
  let b = tools.querySelector<HTMLButtonElement>('[data-tool="tags"]');
  if (!b) {
    b = document.createElement('button');
    b.type = 'button';
    b.className = 'wiky-tool';
    b.dataset.tool = 'tags';
    b.title = 'Étiquetage automatique : ranger tes cartes par plage de prix';
    b.innerHTML = `${ICON}<span>Étiquettes</span>`;
    b.addEventListener('click', () => openModal('tags'));
  }
  // Juste après « Plus chères » (sinon en premier).
  const ranking = tools.querySelector('[data-tool="ranking"]');
  if (ranking) {
    if (ranking.nextElementSibling !== b) ranking.after(b);
  } else if (tools.firstElementChild !== b) tools.prepend(b);
}

registerFeature({
  keys: [],
  when: (ctx) => ctx.settings.siteIntegration,
  render,
  cleanup: () => removeTool('tags'),
});
