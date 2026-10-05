/**
 * Partager un tirage : bouton « Partager » sur l'écran d'ouverture du site (« Carte X / N ») qui copie
 * le résultat du paquet en image PNG (voir pull-image.ts). Le même bouton existe dans le récapitulatif.
 */
import { lastPack, pullCounter } from './packs';
import { sharePack } from './pull-image';
import { registerFeature } from './runtime';
import { button } from './ui';

registerFeature({
  keys: ['pullShare'],
  render() {
    const existing = document.querySelector<HTMLElement>('[data-wiky="pull-share"]');
    const counter = pullCounter();
    const pack = lastPack();
    // Le bouton n'a de sens que pour un paquet dont on connaît les cartes (ouvert depuis cet onglet).
    if (!counter || !pack || Date.now() - pack.at > 30 * 60_000) {
      existing?.remove();
      return;
    }
    const key = String(pack.at);
    if (existing?.isConnected && existing.dataset.key === key && counter.stage.contains(existing)) return;
    existing?.remove();
    const b = button('Partager', () => void sharePack(pack, b), 'ghost');
    b.setAttribute('data-wiky', 'pull-share');
    b.dataset.key = key;
    b.title = 'Copier le tirage en image';
    b.style.alignSelf = 'center';
    b.style.margin = '8px auto 0';
    counter.stage.append(b);
  },
  cleanup() {
    document.querySelector('[data-wiky="pull-share"]')?.remove();
  },
});
