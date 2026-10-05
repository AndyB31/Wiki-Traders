/**
 * Affichage des cartes du site :
 *  - « Cartes illustrées » : l'image de l'article en pleine carte, reflet aux couleurs de la rareté.
 *    CSS seulement (un attribut sur <html>) : aucun traitement par carte, aucun échantillonnage d'image ;
 *  - « Masquer ATK / DEF » : CSS seulement ;
 *  - « Bouton Wikipédia » : un « W » sur chaque carte vers son article (le clic ne déclenche pas la carte).
 */
import { cardTitle, ensureStyle, isolateClicks, nativeCards, toggleRootAttr, wikipediaUrl } from './dom';
import { registerFeature } from './runtime';

// ---------------------------------------------------------------- cartes illustrées

const PREMIUM = 'data-wiky-premium';
const P = `html[${PREMIUM}] div[class*="glow-"]:has(> div[class*="h-[45%]"])`;
const ART = `${P} > div[class*="h-[45%]"]`;
const TEXT = `${P} > div[class*="top-[45%]"]`;

const PREMIUM_CSS = `
${P} { --wk: #b7c1ce; --wk-sheen: 0; background: #0b0d12 !important; border-radius: 16px;
  outline: 1.5px solid color-mix(in srgb, var(--wk) 75%, transparent); outline-offset: -1.5px;
  box-shadow: 0 10px 24px rgba(0,0,0,.42), 0 0 14px color-mix(in srgb, var(--wk) 32%, transparent); }
${P}.glow-l { --wk: #ffd45a; --wk-sheen: .55; }
${P}.glow-ur { --wk: #ff9f43; --wk-sheen: .4; }
${P}.glow-sr { --wk: #c98cff; --wk-sheen: .25; }
${P}.glow-r { --wk: #64bfff; }
${P}.glow-pc { --wk: #6ee7ad; }
${P}.glow-c { --wk: #b7c1ce; }
${P} > img:first-child, ${P} > div[class*="inset-0"][class*="bg-gradient-to-b"] { opacity: 0 !important; }
${ART} { height: 100% !important; bottom: 0 !important; background: #0b0d12 !important; }
${ART} img:not([src*="logo.png"]) { object-fit: cover !important; object-position: center 22% !important; }
${ART} div[class*="bottom-0"][class*="bg-gradient-to-t"] { display: none !important; }
${TEXT} { top: auto !important; height: 50% !important; justify-content: flex-end; padding-top: 26px !important;
  background: linear-gradient(to top, rgba(8,10,14,.97) 0%, rgba(8,10,14,.88) 52%, rgba(8,10,14,.45) 78%, transparent 100%) !important; }
${TEXT} h3 { color: #fff !important; text-shadow: 0 1px 3px rgba(0,0,0,.85); }
${TEXT} p { color: rgba(255,255,255,.78) !important; }
${TEXT} [class*="text-black"], ${TEXT} [class*="text-neutral-900"] { color: rgba(255,255,255,.9) !important; }
${TEXT} [class*="border-black"] { border-color: rgba(255,255,255,.18) !important; }
${P}::after { content: ''; position: absolute; inset: 0; z-index: 35; pointer-events: none; border-radius: inherit;
  background: linear-gradient(115deg, transparent 32%, color-mix(in srgb, var(--wk) 50%, transparent) 45%, rgba(255,255,255,.4) 50%,
    color-mix(in srgb, var(--wk) 50%, transparent) 55%, transparent 68%) 120% 0 / 250% 100% no-repeat;
  mix-blend-mode: screen; opacity: var(--wk-sheen); transition: background-position .8s ease, opacity .3s ease; }
${P}:hover::after { background-position: -20% 0; opacity: .9; }
@media (prefers-reduced-motion: reduce) { ${P}::after { transition: none; } }
`;

registerFeature({
  keys: ['premiumCards'],
  render() {
    ensureStyle('wiky-premium-style', PREMIUM_CSS);
    toggleRootAttr(PREMIUM, true);
  },
  cleanup() {
    toggleRootAttr(PREMIUM, false);
  },
});

// ---------------------------------------------------------------- ATK / DEF masqués

const HIDE = 'data-wiky-hide-stats';
const HIDE_CSS = `
html[${HIDE}] div[class*="glow-"] div:has(> svg.lucide-swords), html[${HIDE}] div[class*="glow-"] div:has(> svg.lucide-shield) { visibility: hidden !important; }
html[${HIDE}] div[class*="glow-"] div:has(> div > svg.lucide-swords), html[${HIDE}] div[class*="glow-"] div:has(> div > svg.lucide-shield) { border-top-color: transparent !important; }
html[${HIDE}] div[class*="fixed"][class*="inset-0"] div.grid:has(> .card-frame > div > svg.lucide-swords),
html[${HIDE}] div[class*="fixed"][class*="inset-0"] div.grid:has(> .card-frame > div > svg.lucide-shield) { display: none !important; }
`;

registerFeature({
  keys: ['hideCardStats'],
  render() {
    ensureStyle('wiky-hide-stats-style', HIDE_CSS);
    toggleRootAttr(HIDE, true);
  },
  cleanup() {
    toggleRootAttr(HIDE, false);
  },
});

// ---------------------------------------------------------------- bouton Wikipédia

// En bas à droite de l'illustration : loin des étiquettes (en haut) et des boutons du site (favori, en haut à droite).
const WIKI_CSS = `
.wiky-wiki { position: absolute; top: calc(45% - 26px); right: 5px; z-index: 36; display: inline-grid; place-items: center; width: 21px; height: 21px;
  border: 1px solid rgba(255,255,255,.28); border-radius: 6px; background: rgba(8,10,14,.8); color: #fff; text-decoration: none;
  font: 800 12px/1 Georgia, 'Times New Roman', serif; box-shadow: 0 2px 6px rgba(0,0,0,.3); backdrop-filter: blur(4px); opacity: .85; transition: all .15s ease; }
.wiky-wiki:hover { opacity: 1; border-color: #f97316; background: rgba(249,115,22,.25); }
`;

registerFeature({
  keys: ['wikipediaButtons'],
  render() {
    ensureStyle('wiky-wiki-style', WIKI_CSS);
    for (const card of nativeCards()) {
      const title = cardTitle(card);
      if (!title) continue;
      const existing = card.querySelector<HTMLAnchorElement>(':scope > [data-wiky="wiki"]');
      if (existing?.dataset.title === title) continue;
      const a = existing ?? document.createElement('a');
      a.setAttribute('data-wiky', 'wiki');
      a.className = 'wiky-wiki';
      a.dataset.title = title;
      a.href = wikipediaUrl(title);
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.referrerPolicy = 'no-referrer';
      a.textContent = 'W';
      a.title = `Ouvrir l'article Wikipédia : ${title}`;
      a.setAttribute('aria-label', a.title);
      if (!existing) {
        isolateClicks(a);
        card.append(a);
      }
    }
  },
  cleanup() {
    document.querySelectorAll('[data-wiky="wiki"]').forEach((n) => n.remove());
  },
});
