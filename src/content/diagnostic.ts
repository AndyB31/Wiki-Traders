import { imagePath } from './parsers/dom';

const SKIP = new Set(['script', 'style', 'noscript', 'template', 'link', 'meta']);
const MAX_NODES = 4000;

/**
 * Plan compact du DOM (balises, classes, attributs utiles, textes courts) pour ajuster les sélecteurs.
 * Les valeurs des champs de saisie ne sont jamais incluses.
 */
export function domOutline(root: Element): string {
  const lines: string[] = [];
  let count = 0;
  const walk = (el: Element, depth: number) => {
    if (count++ > MAX_NODES) return;
    const tag = el.tagName.toLowerCase();
    if (SKIP.has(tag) || el.hasAttribute('data-wiky')) return;
    let line = '  '.repeat(depth) + tag;
    if (el.id) line += `#${el.id}`;
    const cls = (el.getAttribute('class') ?? '').split(/\s+/).filter(Boolean).slice(0, 4);
    if (cls.length) line += '.' + cls.join('.');
    for (const a of el.attributes) {
      const n = a.name;
      if (n === 'class' || n === 'id' || n === 'value') continue;
      if (n.startsWith('data-') || n.startsWith('aria-') || ['role', 'href', 'alt', 'type', 'name', 'datetime', 'title', 'placeholder', 'width'].includes(n)) {
        line += ` [${n}=${a.value.slice(0, 80)}]`;
      } else if (n === 'src') {
        line += ` [src=${(imagePath(a.value) ?? '').slice(-80)}]`;
      } else if (n === 'style' && /rarity|url\(/i.test(a.value)) {
        line += ` [style=${a.value.slice(0, 120)}]`;
      }
    }
    if (tag === 'svg') {
      lines.push(line);
      return;
    }
    const own = [...el.childNodes]
      .filter((n) => n.nodeType === 3)
      .map((n) => n.textContent?.replace(/\s+/g, ' ').trim())
      .filter(Boolean)
      .join(' ');
    if (own && tag !== 'input' && tag !== 'textarea') line += `  "${own.slice(0, 60)}"`;
    lines.push(line);
    for (const c of el.children) walk(c, depth + 1);
  };
  walk(root, 0);
  if (count > MAX_NODES) lines.push(`… tronqué après ${MAX_NODES} nœuds`);
  return lines.join('\n');
}
