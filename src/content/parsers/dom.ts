import { detectRarity, normalize, parseCountdown, parseNumber, RARITIES, sameTag } from '../../lib/text';
import { qsa, re, type SelectorConfig } from './selectors';

const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'SVG']);

/** Textes visibles d'un élément, dans l'ordre (fonctionne aussi sans innerText, ex. jsdom). */
export function leafTexts(el: Element): string[] {
  const out: string[] = [];
  const walk = (node: Node) => {
    if (node.nodeType === 3) {
      const t = node.textContent?.replace(/\s+/g, ' ').trim();
      if (t) out.push(t);
      return;
    }
    if (node.nodeType !== 1) return;
    const e = node as Element;
    if (SKIP.has(e.tagName.toUpperCase()) || e.hasAttribute('data-wiky')) return;
    if (e.getAttribute('aria-hidden') === 'true' && !e.querySelector('img')) return;
    for (const c of e.childNodes) walk(c);
  };
  walk(el);
  return out;
}

export function joinedText(el: Element): string {
  return leafTexts(el).join(' | ');
}

/** Extrait le chemin d'une image (gère next/image `/_next/image?url=…` et les URL signées). */
export function imagePath(src: string | null | undefined): string | null {
  if (!src) return null;
  try {
    const u = new URL(src, 'https://www.wiki-masters.com');
    const inner = u.searchParams.get('url');
    const path = inner ? new URL(decodeURIComponent(inner), u.origin).pathname : u.pathname;
    return path;
  } catch {
    return src.split('?')[0];
  }
}

export function imageBasename(src: string | null | undefined): string | null {
  const p = imagePath(src);
  if (!p) return null;
  const base = p.split('/').pop() ?? '';
  return base.replace(/\.[a-z0-9]+$/i, '') || null;
}

const RARITY_IMAGES = new RegExp(`/(${Object.values(RARITIES).map((r) => r.image).join('|')})\\.(png|webp|jpg)`, 'i');

/** Image représentant une carte (pas une icône, un avatar ou un cadre de rareté). */
export function isCardImage(img: HTMLImageElement): boolean {
  const src = img.getAttribute('src') ?? '';
  const path = imagePath(src) ?? '';
  if (RARITY_IMAGES.test(path) || /\.svg$/i.test(path) || /avatar|icon|logo|emoji|flag/i.test(path)) return false;
  const w = Number(img.getAttribute('width') ?? 0);
  if (w && w < 40) return false;
  return /\/cards?\//i.test(path) || !!img.getAttribute('alt')?.trim();
}

/**
 * Regroupe des « ancres » (liens, images) en tuiles : on remonte depuis chaque ancre tant que
 * le parent ne contient qu'une seule clé distincte. La tuile est le plus grand conteneur propre à l'ancre.
 */
export function tilesFromAnchors<T extends Element>(root: Element, anchors: T[], key: (a: T) => string): Map<string, Element> {
  const tiles = new Map<string, Element>();
  const keyed = anchors.map((a) => ({ a, k: key(a) })).filter((x) => x.k);
  const distinctIn = (el: Element) => {
    const keys = new Set<string>();
    for (const x of keyed) if (el.contains(x.a)) keys.add(x.k);
    return keys.size;
  };
  for (const { a, k } of keyed) {
    if (tiles.has(k)) continue;
    let tile: Element = a;
    while (tile.parentElement && tile.parentElement !== root && distinctIn(tile.parentElement) <= 1) {
      tile = tile.parentElement;
    }
    tiles.set(k, tile);
  }
  return tiles;
}

const NOT_A_NAME = /^(atk|def|pv|hp|x\s?\d+|\d+\s?x|[\d\s.,:]+|voir|vendre|ench[eè]rir|favori|nouveau|new)$/i;

const NOT_A_CARD_ALT = /^(wikimasters|logo|avatar|ic[oô]ne?|image)$/i;

export function cardNameIn(tile: Element, cfg: SelectorConfig): string | null {
  if (cfg.cardName) {
    for (const el of qsa(tile, cfg.cardName)) {
      const t = (el.getAttribute('data-wm-title') ?? el.textContent)?.trim();
      if (t) return t;
    }
  }
  const alt = qsa<HTMLImageElement>(tile, cfg.cardImage)
    .filter(isCardImage)
    .map((img) => img.getAttribute('alt')?.replace(/^(carte|card)\s*[:-]?\s*/i, '').trim() ?? '')
    .find((a) => a && !NOT_A_CARD_ALT.test(a));
  if (alt) return alt;
  const heading = qsa(tile, 'h1, h2, h3, h4, h5, [class*="title" i], [class*="name" i]')[0]?.textContent?.trim();
  if (heading) return heading;
  const img = qsa<HTMLImageElement>(tile, cfg.cardImage).find(isCardImage);
  const rarityLabels = new Set(Object.values(RARITIES).map((r) => normalize(r.label)));
  return (
    leafTexts(tile).find((t) => t.length > 2 && !NOT_A_NAME.test(t) && !rarityLabels.has(normalize(t)) && parseCountdown(t) == null) ??
    (img ? imageBasename(img.getAttribute('src')) : null)
  );
}

export function rarityIn(tile: Element): ReturnType<typeof detectRarity> {
  return detectRarity(joinedText(tile), tile.outerHTML);
}

/** Nombre qui suit un libellé (« Enchère actuelle : 86 »), dans le texte d'une tuile. */
export function labeledNumber(texts: string[], labelRe: string): number | null {
  const label = re(labelRe);
  for (let i = 0; i < texts.length; i++) {
    const t = texts[i];
    const m = t.match(label);
    if (!m) continue;
    const after = t.slice((m.index ?? 0) + m[0].length);
    const n = parseNumber(after) ?? (/\d/.test(after) ? null : parseNumber(texts[i + 1]));
    if (n != null) return n;
  }
  return null;
}

export function quantityIn(tile: Element, cfg: SelectorConfig): number | null {
  if (cfg.cardQuantity) {
    const n = parseNumber(qsa(tile, cfg.cardQuantity)[0]?.textContent);
    if (n != null) return n;
  }
  for (const t of leafTexts(tile)) {
    const m = t.match(/^[x×]\s?(\d+)$/i) ?? t.match(/^(\d+)\s?[x×]$/i) ?? t.match(/(\d+)\s*(?:exemplaires?|copies?|poss[ée]d[ée]e?s?)/i);
    if (m) return Number(m[1]);
  }
  return null;
}

/** Étiquettes affichées dans la tuile, plus celles de la liste connue trouvées en texte exact. */
export function tagsIn(tile: Element, cfg: SelectorConfig, knownTags: string[]): string[] {
  const tags = new Set<string>();
  for (const el of qsa(tile, cfg.cardTag)) {
    const t = el.getAttribute('data-tag') ?? el.textContent?.trim();
    if (t && t.length <= 40) tags.add(t);
  }
  for (const t of leafTexts(tile)) {
    const known = knownTags.find((k) => sameTag(k, t));
    if (known) tags.add(known);
  }
  return [...tags];
}

/** Étiquette sélectionnée dans un filtre de la page (chip active ou <select>). */
export function activeTag(root: ParentNode, cfg: SelectorConfig, knownTags: string[]): string | null {
  if (!knownTags.length) return null;
  for (const el of qsa(root, cfg.activeMarker)) {
    const t = el.textContent?.trim();
    const known = knownTags.find((k) => sameTag(k, t));
    if (known) return known;
  }
  for (const sel of qsa<HTMLSelectElement>(root, 'select')) {
    const opt = sel.selectedOptions?.[0] ?? sel.options?.[sel.selectedIndex];
    const known = knownTags.find((k) => sameTag(k, opt?.textContent?.trim()) || sameTag(k, sel.value));
    if (known) return known;
  }
  return null;
}

export function isFavorite(tile: Element, cfg: SelectorConfig): boolean {
  return qsa(tile, cfg.cardFavorite).length > 0;
}
