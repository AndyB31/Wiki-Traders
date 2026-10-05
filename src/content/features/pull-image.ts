/**
 * Image d'un tirage (cartes, rareté, prix moyen, total) dessinée sur un canevas, copiée dans le presse-papiers.
 */
import { formatPrice } from '../../lib/text';
import { displayPrice, knownPrice } from '../catalog';
import type { PackCard } from './packs-logic';
import { RARITY_COLORS } from './ui';

const MAX_CARDS = 30;

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

/** Image chargée avec CORS (sinon le canevas serait « teinté » et non copiable) ; null si indisponible. */
function loadImage(src: string | null, timeout = 4000): Promise<HTMLImageElement | null> {
  if (!src) return Promise.resolve(null);
  return new Promise((resolve) => {
    const img = new Image();
    const t = setTimeout(() => resolve(null), timeout);
    img.crossOrigin = 'anonymous';
    img.referrerPolicy = 'no-referrer';
    img.onload = () => {
      clearTimeout(t);
      resolve(img);
    };
    img.onerror = () => {
      clearTimeout(t);
      resolve(null);
    };
    img.src = src;
  });
}

function ellipsize(g: CanvasRenderingContext2D, text: string, max: number): string {
  if (g.measureText(text).width <= max) return text;
  let t = text;
  while (t.length > 1 && g.measureText(`${t}…`).width > max) t = t.slice(0, -1);
  return `${t}…`;
}

/** Nom sur deux lignes au plus. */
function twoLines(g: CanvasRenderingContext2D, text: string, max: number): string[] {
  const words = text.split(/\s+/);
  let first = '';
  let i = 0;
  for (; i < words.length; i++) {
    const next = first ? `${first} ${words[i]}` : words[i];
    if (g.measureText(next).width > max && first) break;
    first = next;
  }
  const rest = words.slice(i).join(' ');
  return rest ? [ellipsize(g, first, max), ellipsize(g, rest, max)] : [ellipsize(g, first, max)];
}

export interface ShareInput {
  cards: PackCard[];
  packs: number;
}

/** Dessine le tirage : grille de cartes (image, rareté, nom, prix) et total. */
export async function drawPackImage(input: ShareInput, priceOf: (c: PackCard) => number | null = (c) => displayPrice(knownPrice(c.siteId), c.rarity)): Promise<HTMLCanvasElement> {
  const priced = input.cards.map((c) => ({ c, price: priceOf(c) }));
  const total = priced.reduce((s, p) => s + (p.price ?? 0), 0);
  // Les plus chères d'abord quand il y en a beaucoup.
  const shown = input.cards.length > MAX_CARDS ? [...priced].sort((a, b) => (b.price ?? -1) - (a.price ?? -1)).slice(0, MAX_CARDS) : priced;
  const cols = Math.min(5, Math.max(1, shown.length));
  const rows = Math.ceil(shown.length / cols);
  const cw = 150;
  const ch = 228;
  const gap = 14;
  const pad = 24;
  const head = 64;
  const foot = 56;
  const width = pad * 2 + cols * cw + (cols - 1) * gap;
  const height = head + rows * ch + (rows - 1) * gap + foot + pad;
  const scale = 2;
  const canvas = document.createElement('canvas');
  canvas.width = width * scale;
  canvas.height = height * scale;
  const g = canvas.getContext('2d');
  if (!g) throw new Error('Canevas indisponible');
  g.scale(scale, scale);
  g.fillStyle = '#0c0a09';
  g.fillRect(0, 0, width, height);

  g.textBaseline = 'middle';
  g.fillStyle = '#fafaf9';
  g.font = '800 20px system-ui, sans-serif';
  g.fillText(input.packs > 1 ? `Mes ${input.packs} paquets WikiMasters` : 'Mon paquet WikiMasters', pad, 30);
  g.font = '600 12px system-ui, sans-serif';
  g.fillStyle = 'rgba(250,250,249,.5)';
  g.fillText(`${input.cards.length} carte${input.cards.length > 1 ? 's' : ''} · ${new Date().toLocaleDateString('fr-FR')}`, pad, 50);

  const images = await Promise.all(shown.map((p) => loadImage(p.c.imageUrl)));
  shown.forEach(({ c, price }, i) => {
    const x = pad + (i % cols) * (cw + gap);
    const y = head + Math.floor(i / cols) * (ch + gap);
    const accent = c.rarity ? RARITY_COLORS[c.rarity] : '#94a3b8';
    g.save();
    roundRect(g, x, y, cw, ch, 12);
    g.fillStyle = '#1c1917';
    g.fill();
    g.lineWidth = 2;
    g.strokeStyle = accent;
    g.stroke();
    g.clip();
    const img = images[i];
    const ih = 132;
    if (img) {
      // Recadrage « cover ».
      const r = Math.max(cw / img.naturalWidth, ih / img.naturalHeight);
      const sw = cw / r;
      const sh = ih / r;
      g.drawImage(img, (img.naturalWidth - sw) / 2, Math.max(0, (img.naturalHeight - sh) / 4), sw, sh, x, y, cw, ih);
    } else {
      const grad = g.createLinearGradient(x, y, x + cw, y + ih);
      grad.addColorStop(0, `${accent}55`);
      grad.addColorStop(1, '#0c0a09');
      g.fillStyle = grad;
      g.fillRect(x, y, cw, ih);
      g.fillStyle = 'rgba(250,250,249,.75)';
      g.font = '800 34px system-ui, sans-serif';
      g.textAlign = 'center';
      g.fillText(c.title.split(/\s+/).slice(0, 2).map((w) => w[0] ?? '').join('').toUpperCase(), x + cw / 2, y + ih / 2);
      g.textAlign = 'left';
    }
    g.restore();
    // Rareté.
    g.font = '800 11px system-ui, sans-serif';
    const label = c.rarity ?? '?';
    const lw = g.measureText(label).width + 12;
    roundRect(g, x + 8, y + 8, lw, 18, 6);
    g.fillStyle = accent;
    g.fill();
    g.fillStyle = '#111';
    g.fillText(label, x + 14, y + 17.5);
    // Nom et prix.
    g.fillStyle = '#fafaf9';
    g.font = '700 13px system-ui, sans-serif';
    twoLines(g, c.title, cw - 16).forEach((line, k) => g.fillText(line, x + 8, y + ih + 18 + k * 17));
    g.font = '800 14px system-ui, sans-serif';
    g.fillStyle = price != null ? '#fdba74' : 'rgba(250,250,249,.4)';
    g.fillText(price != null ? `${formatPrice(price)} W` : '—', x + 8, y + ch - 16);
  });

  const fy = height - pad - foot / 2 + 8;
  g.font = '700 15px system-ui, sans-serif';
  g.fillStyle = 'rgba(250,250,249,.7)';
  g.fillText(`Valeur totale (prix moyens) : `, pad, fy);
  const w = g.measureText('Valeur totale (prix moyens) : ').width;
  g.fillStyle = '#f97316';
  g.font = '800 17px system-ui, sans-serif';
  g.fillText(`${formatPrice(total)} W`, pad + w, fy);
  if (input.cards.length > shown.length) {
    g.font = '600 12px system-ui, sans-serif';
    g.fillStyle = 'rgba(250,250,249,.45)';
    g.textAlign = 'right';
    g.fillText(`+ ${input.cards.length - shown.length} autres cartes`, width - pad, fy);
    g.textAlign = 'left';
  }
  return canvas;
}

function toBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG impossible'))), 'image/png'));
}

/** Copie le tirage en image dans le presse-papiers (ou le télécharge si la copie est refusée). */
export async function sharePack(input: ShareInput, btn?: HTMLButtonElement): Promise<void> {
  const label = btn?.textContent ?? '';
  const set = (t: string) => {
    if (btn) btn.textContent = t;
  };
  set('Image…');
  if (btn) btn.disabled = true;
  try {
    const blob = await toBlob(await drawPackImage(input));
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      set('Copiée ✓');
    } catch {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `wikimasters-tirage-${Date.now()}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      set('Téléchargée ✓');
    }
  } catch (e) {
    set('Échec');
    if (btn) btn.title = `Échec : ${(e as Error).message}`;
  } finally {
    setTimeout(() => {
      if (btn) {
        btn.disabled = false;
        btn.textContent = label;
      }
    }, 1800);
  }
}

