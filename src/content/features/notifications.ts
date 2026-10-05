/**
 * Son des notifications : petit carillon quand le compteur de la cloche du site augmente
 * (`button[aria-label="Notifications"]`, pastille `:scope > span`). Respecte les heures silencieuses.
 */
import { inQuietHours } from '../../lib/time';
import type { Settings } from '../../lib/types';
import { chime, enableAudio } from './audio';
import { registerFeature } from './runtime';

/** Nombre de notifications non lues affiché par la cloche (null : cloche absente). */
export function readNotificationCount(root: ParentNode = document): number | null {
  const bell = root.querySelector('button[aria-label="Notifications"]');
  if (!bell) return null;
  const badge = bell.querySelector(':scope > span');
  if (!badge) return 0;
  const m = (badge.textContent ?? '').match(/\d+/);
  // Pastille sans nombre (simple point) : au moins une notification.
  return m ? Number(m[0]) : 1;
}

/** Suit le compteur et dit quand il augmente (la première lecture sert de référence, sans son). */
export class NotificationCounter {
  private last: number | null = null;

  /** Vrai si `count` est plus grand que la lecture précédente. */
  update(count: number | null): boolean {
    if (count == null) return false;
    const prev = this.last;
    this.last = count;
    return prev != null && count > prev;
  }

  reset(): void {
    this.last = null;
  }
}

const counter = new NotificationCounter();
let settings: Settings | null = null;
let observed: Element | null = null;
let observer: MutationObserver | null = null;

function check(): void {
  if (!counter.update(readNotificationCount())) return;
  if (settings && inQuietHours(new Date(), settings.quietStart, settings.quietEnd)) return;
  chime();
}

registerFeature({
  keys: ['notificationSound'],
  render(ctx) {
    settings = ctx.settings;
    enableAudio();
    const bell = document.querySelector('button[aria-label="Notifications"]');
    // Observateur dédié sur la cloche : le son part tout de suite, sans attendre la relecture de la page.
    if (bell !== observed) {
      observer?.disconnect();
      observer = null;
      observed = bell;
      if (bell) {
        observer = new MutationObserver(check);
        observer.observe(bell, { childList: true, subtree: true, characterData: true });
      }
    }
    check();
  },
  cleanup() {
    observer?.disconnect();
    observer = null;
    observed = null;
    counter.reset();
  },
});
