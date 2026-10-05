/**
 * Pastilles de famille sur les cartes natives du site (/collection, /global-collection, marché) :
 * une pastille de couleur par famille, en bas à gauche de l'image (les étiquettes de overlay.ts sont en haut,
 * la rareté du site en haut à gauche), nom de la famille au survol, clic → page de la famille.
 * Bon marché : index carte → familles reconstruit seulement quand les familles changent, chaque carte garde
 * sa clé (data-wiky-fam) et n'est jamais redessinée si rien n'a changé pour elle.
 */
import { familiesOf } from '../../lib/families';
import type { CardFamily } from '../../lib/types';
import { nativeCardSiteId, nativeCardTitle, nativeCards } from '../collection-selection';
import { openFamilyPage } from './family-actions';
import { getFamilyIndex, syncFamilies } from './families-state';
import { registerFeature, type FeatureContext } from './runtime';

const PAGES = /^\/(collection|global-collection|marketplace)(\/|$)/;
const MAX_DOTS = 4;
const KEY_ATTR = 'data-wiky-fam';

function badgeKey(fams: CardFamily[]): string {
  return fams.map((f) => `${f.id}:${f.color}:${f.name}`).join('|');
}

function buildBadge(fams: CardFamily[]): HTMLElement {
  const box = document.createElement('div');
  box.setAttribute('data-wiky', 'fam-badge');
  box.title = `Famille${fams.length > 1 ? 's' : ''} : ${fams.map((f) => f.name).join(', ')}`;
  Object.assign(box.style, {
    position: 'absolute', left: '7px', top: 'calc(45% - 20px)', zIndex: '35', display: 'flex', alignItems: 'center', gap: '3px',
    padding: '3px 4px', borderRadius: '999px', background: 'rgba(0,0,0,.55)', pointerEvents: 'auto', lineHeight: '0',
  } satisfies Partial<CSSStyleDeclaration>);
  for (const f of fams.slice(0, MAX_DOTS)) {
    const dot = document.createElement('span');
    dot.title = `Famille : ${f.name}`;
    dot.dataset.fam = f.id;
    Object.assign(dot.style, { width: '9px', height: '9px', borderRadius: '50%', background: f.color, cursor: 'pointer', boxShadow: '0 0 0 1px rgba(255,255,255,.35)' });
    box.append(dot);
  }
  if (fams.length > MAX_DOTS) {
    const more = document.createElement('span');
    more.textContent = `+${fams.length - MAX_DOTS}`;
    Object.assign(more.style, { fontSize: '9px', fontWeight: '700', color: '#fff', lineHeight: '9px', padding: '0 2px' });
    box.append(more);
  }
  // Clic sur une pastille : la page de la famille (sans ouvrir la fiche de la carte).
  box.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const id = (e.target as HTMLElement).closest<HTMLElement>('[data-fam]')?.dataset.fam ?? fams[0].id;
    openFamilyPage(id);
  });
  for (const type of ['mousedown', 'pointerdown']) box.addEventListener(type, (e) => e.stopPropagation());
  return box;
}

/** Pose, met à jour ou retire les pastilles ; ne touche pas aux cartes dont la clé n'a pas changé. */
export function renderFamilyBadges(root: ParentNode = document): number {
  const idx = getFamilyIndex();
  let changed = 0;
  for (const card of nativeCards(root)) {
    const fams = familiesOf(idx, nativeCardSiteId(card), nativeCardTitle(card));
    const key = badgeKey(fams);
    if ((card.getAttribute(KEY_ATTR) ?? '') === key && (!key || card.querySelector(':scope > [data-wiky="fam-badge"]'))) continue;
    changed++;
    card.querySelector(':scope > [data-wiky="fam-badge"]')?.remove();
    if (!key) {
      card.removeAttribute(KEY_ATTR);
      continue;
    }
    card.setAttribute(KEY_ATTR, key);
    if (getComputedStyle(card).position === 'static') card.style.position = 'relative';
    card.append(buildBadge(fams));
  }
  return changed;
}

export function clearFamilyBadges(): void {
  for (const b of document.querySelectorAll('[data-wiky="fam-badge"]')) b.remove();
  for (const c of document.querySelectorAll(`[${KEY_ATTR}]`)) c.removeAttribute(KEY_ATTR);
}

registerFeature({
  keys: ['familyBadges'],
  render(ctx: FeatureContext) {
    syncFamilies(ctx.families);
    if (!PAGES.test(ctx.path) || ctx.search.has('wiky')) {
      if (document.querySelector('[data-wiky="fam-badge"]')) clearFamilyBadges();
      return;
    }
    renderFamilyBadges(document);
  },
  cleanup: clearFamilyBadges,
});
