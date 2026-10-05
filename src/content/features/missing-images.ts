/**
 * Images manquantes : les cartes sans illustration (logo WikiMasters à la place) reçoivent la vignette de
 * l'article Wikipédia ou l'image Wikidata. Les titres de toutes les cartes concernées sont résolus par lots
 * de 50 (wiki-images.ts), en arrière-plan : l'affichage du site n'attend jamais.
 */
import { knownImage, resolveImages } from '../wiki-images';
import { cardTitle, ensureStyle, nativeCards } from './dom';
import { registerFeature } from './runtime';

const CSS = `
[data-wiky-img-frame] { position: absolute !important; inset: 0 !important; width: 100% !important; height: 100% !important; max-width: none !important;
  min-width: 0 !important; aspect-ratio: auto !important; }
[data-wiky-img-host] { padding: 0 !important; }
img[data-wiky-img] { object-fit: cover !important; object-position: center 25% !important; opacity: 1 !important; }
`;

/** Logo affiché par le site à la place de l'illustration. */
export function placeholderOf(card: Element): HTMLImageElement | null {
  for (const img of card.querySelectorAll<HTMLImageElement>('img')) {
    if (img.hasAttribute('data-wiky-img')) continue;
    const src = img.getAttribute('src') ?? '';
    if ((img.getAttribute('alt') ?? '').trim().toLowerCase() === 'wikimasters' || /(?:%2f|\/)logo\.png/i.test(src)) return img;
  }
  return null;
}

function apply(img: HTMLImageElement, title: string, url: string): void {
  img.setAttribute('data-wiky-img', title);
  img.dataset.wikyOriginalSrc = img.getAttribute('src') ?? '';
  img.removeAttribute('srcset');
  img.referrerPolicy = 'no-referrer';
  img.src = url;
  img.alt = title;
  const frame = img.parentElement;
  frame?.setAttribute('data-wiky-img-frame', '');
  frame?.parentElement?.setAttribute('data-wiky-img-host', '');
}

let pending = false;
let failedAt = 0;

function paint(): void {
  const todo: string[] = [];
  for (const card of nativeCards()) {
    const img = placeholderOf(card);
    if (!img) continue;
    const title = cardTitle(card);
    if (!title) continue;
    const known = knownImage(title);
    if (known === undefined) todo.push(title);
    else if (known.url) apply(img, title, known.url);
  }
  if (!todo.length || pending || Date.now() - failedAt < 60_000) return;
  pending = true;
  void resolveImages(todo)
    .then((got) => {
      if (got.size < new Set(todo).size) failedAt = Date.now();
    })
    .catch(() => (failedAt = Date.now()))
    .finally(() => {
      pending = false;
      if (active) paint();
    });
}

let active = false;

registerFeature({
  keys: ['missingImages'],
  render() {
    active = true;
    ensureStyle('wiky-img-style', CSS);
    paint();
  },
  cleanup() {
    active = false;
    for (const img of document.querySelectorAll<HTMLImageElement>('img[data-wiky-img]')) {
      img.src = img.dataset.wikyOriginalSrc ?? img.src;
      img.removeAttribute('data-wiky-img');
    }
    document.querySelectorAll('[data-wiky-img-frame]').forEach((n) => n.removeAttribute('data-wiky-img-frame'));
    document.querySelectorAll('[data-wiky-img-host]').forEach((n) => n.removeAttribute('data-wiky-img-host'));
  },
});

/** Pour les tests. */
export function resetMissingImages(): void {
  pending = false;
  failedAt = 0;
}
