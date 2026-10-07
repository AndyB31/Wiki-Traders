/**
 * Pages de l'extension affichées dans le site (fenêtre ou page Wiki-Traders) :
 *  - `?embed=1` : dans une iframe de la page WikiMasters ;
 *  - `&view=<onglet>` : un seul onglet de la popup, sans en-tête ni barre d'onglets ;
 *  - `&theme=<json>` : couleurs du site (lues par le content script) appliquées à la page.
 */
export const params = new URLSearchParams(location.search);
export const embedded = params.has('embed');
export const view = params.get('view');

/** Couleurs du site transmises par le content script (voir content/site-ui.ts). */
export interface SiteTheme {
  background?: string;
  surface?: string;
  surfaceLight?: string;
  border?: string;
  foreground?: string;
}

/** Orange Wiki-Traders, pendant du violet de « Familles ». */
const ORANGE = '#f97316';

function applyTheme(t: SiteTheme): void {
  const root = document.documentElement;
  root.classList.add('site');
  const fg = t.foreground || '#f2f4f3';
  const vars: Record<string, string> = {
    '--bg': t.surface || '#131615',
    '--card': t.surfaceLight || '#1b1f1d',
    '--text': fg,
    '--muted': `color-mix(in srgb, ${fg} 55%, transparent)`,
    '--border': t.border || '#2e3431',
    '--accent': ORANGE,
    '--accent-dark': '#fb923c',
    '--accent-soft': 'rgba(249, 115, 22, .12)',
  };
  for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
}

/** À appeler au chargement d'une page de l'extension. */
export function initEmbed(): void {
  if (!embedded) return;
  document.documentElement.classList.add('embed');
  if (view) document.documentElement.classList.add('view');
  const raw = params.get('theme');
  if (raw) {
    try {
      applyTheme(JSON.parse(raw) as SiteTheme);
    } catch {
      // Thème illisible : on garde les couleurs de l'extension.
    }
  }
  // Échap dans l'iframe ferme la fenêtre du site qui la contient.
  addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !document.querySelector('.modal')) parent.postMessage({ wiky: 'close' }, '*');
  });
}
