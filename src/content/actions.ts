/**
 * Actions sur la page (V4 pré-remplissage et étiquetage automatique).
 *
 * ⚠️ Ces actions simulent des clics : elles sont désactivées par défaut car les règles de
 * WikiMasters (section 3) interdisent les outils qui interagissent à ta place.
 */
import { normalize } from '../lib/text';
import { qsa, re } from './parsers/selectors';

export class ActionError extends Error {}

const CLICKABLE = 'button, [role="button"], [role="menuitem"], [role="menuitemcheckbox"], [role="option"], [role="checkbox"], [role="tab"], a, label, li, summary';

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Champs « Mise de départ » déjà remplis par l'extension : un seul remplissage par fenêtre de vente. */
export const filledInputs = new WeakSet<HTMLInputElement>();

/** Pause « humaine » entre deux actions. */
export const pause = (min = 250, max = 600) => sleep(min + Math.random() * (max - min));

function isVisible(el: Element): boolean {
  const r = (el as HTMLElement).getBoundingClientRect?.();
  if (!r) return true;
  const style = getComputedStyle(el);
  return style.visibility !== 'hidden' && style.display !== 'none' && (r.width > 0 || r.height > 0 || !document.body.getBoundingClientRect().width);
}

/** Clic complet (pointer + mouse + click) : les menus Radix réagissent à pointerdown, pas à click. */
export function realClick(el: Element): void {
  (el as HTMLElement).scrollIntoView?.({ block: 'center' });
  const r = (el as HTMLElement).getBoundingClientRect?.() ?? { left: 0, top: 0, width: 0, height: 0 };
  const opts = { bubbles: true, cancelable: true, composed: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, button: 0, pointerId: 1, pointerType: 'mouse', isPrimary: true };
  const P = typeof PointerEvent === 'function' ? PointerEvent : MouseEvent;
  el.dispatchEvent(new P('pointerdown', opts));
  el.dispatchEvent(new MouseEvent('mousedown', opts));
  el.dispatchEvent(new P('pointerup', opts));
  el.dispatchEvent(new MouseEvent('mouseup', opts));
  (el as HTMLElement).click();
}

/** Remplit un champ contrôlé par React (setter natif + événements input/change). */
export function fillInput(input: HTMLInputElement, value: string): void {
  input.focus();
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  if (setter) setter.call(input, value);
  else input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

export function pressEscape(): void {
  const target = document.activeElement ?? document.body;
  for (const type of ['keydown', 'keyup'] as const) target.dispatchEvent(new KeyboardEvent(type, { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }));
}

/** Élément cliquable dont le texte (ou aria-label) correspond, le plus profond d'abord. */
export function findByText(root: ParentNode, pattern: string | RegExp, selector = CLICKABLE): HTMLElement | null {
  const rx = typeof pattern === 'string' ? re(pattern) : pattern;
  const matches = qsa<HTMLElement>(root, selector).filter((el) => {
    if (el.closest('[data-wiky]') || !isVisible(el)) return false;
    const labels = [el.getAttribute('aria-label') ?? '', el.getAttribute('title') ?? '', el.textContent ?? ''];
    return labels.some((l) => l && rx.test(l.replace(/\s+/g, ' ').trim()));
  });
  // Le plus court texte = l'élément le plus précis (évite de cliquer un conteneur).
  return matches.sort((a, b) => (a.textContent?.length ?? 0) - (b.textContent?.length ?? 0))[0] ?? null;
}

/** Élément dont le texte vaut exactement `text` (insensible à la casse/accents). */
export function findExact(root: ParentNode, text: string, selector = CLICKABLE): HTMLElement | null {
  const target = normalize(text).replace(/\s/g, '');
  return (
    qsa<HTMLElement>(root, selector).find(
      (el) => !el.closest('[data-wiky]') && isVisible(el) && normalize(el.textContent ?? '').replace(/\s/g, '') === target,
    ) ?? null
  );
}

export async function waitFor<T>(fn: () => T | null | undefined | false, label: string, timeout = 4000): Promise<T> {
  const t0 = Date.now();
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() - t0 > timeout) throw new ActionError(`introuvable : ${label}`);
    await sleep(120);
  }
}

/** Fenêtre modale ouverte la plus récente (ou le document). */
export function topDialog(selector: string): ParentNode {
  const dialogs = qsa(document, selector).filter((d) => !d.closest('[data-wiky]') && !d.hasAttribute('data-wiky') && isVisible(d) && d.tagName !== 'FORM');
  return dialogs[dialogs.length - 1] ?? document;
}

/** Vrai si une case / option est cochée. */
export function isChecked(el: Element): boolean {
  const target = el.matches('input') ? el : el.querySelector('input[type="checkbox"]') ?? el;
  if ((target as HTMLInputElement).checked) return true;
  const state = el.getAttribute('aria-checked') ?? el.getAttribute('aria-selected') ?? el.getAttribute('aria-pressed') ?? el.getAttribute('data-state');
  return state === 'true' || state === 'checked' || state === 'on';
}
