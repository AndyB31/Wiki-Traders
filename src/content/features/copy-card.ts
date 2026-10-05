/**
 * « Copier la carte en image » : bouton dans la fiche d'une carte ouverte par le site. La carte est redessinée
 * sur un canvas (illustration, rareté, titre, catégorie, prix moyen connu), sans bibliothèque externe,
 * puis copiée en PNG. Le ClipboardItem reçoit une promesse créée pendant le clic : le geste de l'utilisateur
 * reste valable même si le chargement de l'image prend un moment. Si la copie est refusée, le PNG est téléchargé.
 */
import type { Rarity } from '../../lib/types';
import { displayPrice, knownCardId, knownPrice } from '../catalog';
import { cardRarity, cardTitle, ensureStyle, formatW, isolateClicks, myCard, nativeCards, RARITY_ACCENT } from './dom';
import { registerFeature, type FeatureContext } from './runtime';

const CSS = `
.wiky-copy { position: absolute; top: calc(45% - 30px); left: 6px; z-index: 46; display: inline-flex; align-items: center; gap: 5px; height: 24px; padding: 0 9px;
  border: 1px solid rgba(255,255,255,.3); border-radius: 999px; background: rgba(8,10,14,.88); color: #fff; font: 700 10px/1 system-ui, sans-serif;
  cursor: pointer; box-shadow: 0 3px 10px rgba(0,0,0,.38); backdrop-filter: blur(5px); transition: border-color .15s ease, background .15s ease; }
.wiky-copy:hover { border-color: #f97316; background: rgba(249,115,22,.25); }
.wiky-copy[data-state="done"] { border-color: #22c55e; }
.wiky-copy[data-state="failed"] { border-color: #f87171; }
.wiky-copy svg { width: 12px; height: 12px; }
`;

const LABELS = { idle: 'Copier', busy: 'Copie…', done: 'Copiée ✓', saved: 'Téléchargée', failed: 'Échec' } as const;
type CopyState = keyof typeof LABELS;
const ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>';

function setState(b: HTMLElement, s: CopyState): void {
  b.dataset.state = s;
  b.innerHTML = `${ICON}<span></span>`;
  b.querySelector('span')!.textContent = LABELS[s];
}

export interface Snapshot {
  title: string;
  category: string;
  rarity: Rarity | null;
  artUrl: string | null;
  price: number | null;
}

/** Données de la carte affichée (sans réseau). */
export function readCard(card: HTMLElement, ctx: FeatureContext | null): Snapshot {
  const title = cardTitle(card);
  const art = card.querySelector<HTMLImageElement>('div[class*="h-[45%]"] img');
  const artUrl = art && !/(?:%2f|\/)logo\.png/i.test(art.getAttribute('src') ?? '') ? art.currentSrc || art.src : null;
  const siteId = (ctx ? myCard(ctx, title)?.siteId : undefined) ?? knownCardId(title) ?? null;
  return {
    title,
    category: (card.querySelector('h3 ~ p, p')?.textContent ?? '').trim(),
    rarity: cardRarity(card),
    artUrl,
    price: siteId ? displayPrice(knownPrice(siteId), cardRarity(card)) : null,
  };
}

async function loadBitmap(url: string): Promise<ImageBitmap | null> {
  try {
    const abs = new URL(url, location.href);
    const res = await fetch(abs.href, { credentials: abs.origin === location.origin ? 'include' : 'omit', cache: 'force-cache' });
    if (!res.ok) return null;
    return await createImageBitmap(await res.blob());
  } catch {
    return null;
  }
}

function roundRect(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

function wrap(c: CanvasRenderingContext2D, text: string, maxW: number, maxLines: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/)) {
    const next = line ? `${line} ${word}` : word;
    if (c.measureText(next).width <= maxW || !line) line = next;
    else {
      lines.push(line);
      line = word;
      if (lines.length === maxLines) break;
    }
  }
  if (lines.length < maxLines && line) lines.push(line);
  if (lines.length === maxLines && c.measureText(lines[maxLines - 1]).width > maxW) lines[maxLines - 1] = `${lines[maxLines - 1].slice(0, -2)}…`;
  return lines;
}

/** Dessine la carte en PNG (320 × 448, ×2). */
export async function renderCardPng(s: Snapshot): Promise<Blob> {
  const W = 320;
  const H = 448;
  const PAD = 18;
  const SCALE = 2;
  const canvas = document.createElement('canvas');
  canvas.width = (W + PAD * 2) * SCALE;
  canvas.height = (H + PAD * 2) * SCALE;
  const c = canvas.getContext('2d');
  if (!c) throw new Error('Canvas indisponible');
  const accent = s.rarity ? RARITY_ACCENT[s.rarity] : '#b7c1ce';
  const font = getComputedStyle(document.body).fontFamily || 'system-ui, sans-serif';
  c.scale(SCALE, SCALE);
  c.fillStyle = '#050505';
  c.fillRect(0, 0, W + PAD * 2, H + PAD * 2);
  c.translate(PAD, PAD);

  // Halo de rareté.
  c.save();
  roundRect(c, 0, 0, W, H, 18);
  c.shadowColor = `${accent}aa`;
  c.shadowBlur = 22;
  c.fillStyle = '#0b0d12';
  c.fill();
  c.restore();

  c.save();
  roundRect(c, 0, 0, W, H, 18);
  c.clip();
  const img = s.artUrl ? await loadBitmap(s.artUrl) : null;
  if (img) {
    // Illustration en « cover », cadrée vers le haut (visages).
    const r = Math.max(W / img.width, H / img.height);
    const w = img.width * r;
    const h = img.height * r;
    c.drawImage(img, (W - w) / 2, Math.min(0, (H - h) * 0.25), w, h);
  } else {
    const g = c.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, '#242a34');
    g.addColorStop(1, '#080a0e');
    c.fillStyle = g;
    c.fillRect(0, 0, W, H);
  }
  const shade = c.createLinearGradient(0, H * 0.4, 0, H);
  shade.addColorStop(0, 'rgba(8,10,14,0)');
  shade.addColorStop(0.45, 'rgba(8,10,14,.82)');
  shade.addColorStop(1, 'rgba(8,10,14,.97)');
  c.fillStyle = shade;
  c.fillRect(0, H * 0.4, W, H * 0.6);

  // Reflet de rareté.
  const sheen = c.createLinearGradient(0, 0, W, H);
  sheen.addColorStop(0.3, 'rgba(255,255,255,0)');
  sheen.addColorStop(0.48, `${accent}33`);
  sheen.addColorStop(0.52, 'rgba(255,255,255,.12)');
  sheen.addColorStop(0.7, 'rgba(255,255,255,0)');
  c.fillStyle = sheen;
  c.fillRect(0, 0, W, H);

  // Rareté.
  if (s.rarity) {
    c.font = `800 13px ${font}`;
    const label = s.rarity;
    const tw = c.measureText(label).width + 16;
    roundRect(c, 12, 12, tw, 24, 7);
    c.fillStyle = accent;
    c.fill();
    c.fillStyle = '#0d1117';
    c.textBaseline = 'middle';
    c.fillText(label, 20, 24.5);
  }

  // Titre, catégorie, prix.
  c.textBaseline = 'alphabetic';
  let y = H - 18;
  if (s.price != null) {
    c.font = `800 13px ${font}`;
    const t = `Moy. ${formatW(s.price)} W`;
    const tw = c.measureText(t).width + 16;
    roundRect(c, 16, y - 18, tw, 24, 7);
    c.fillStyle = 'rgba(12,10,9,.9)';
    c.fill();
    c.strokeStyle = 'rgba(249,115,22,.6)';
    c.lineWidth = 1;
    c.stroke();
    c.fillStyle = '#fdba74';
    c.fillText(t, 24, y - 1.5);
    y -= 32;
  }
  if (s.category) {
    c.font = `500 12px ${font}`;
    c.fillStyle = 'rgba(255,255,255,.75)';
    const lines = wrap(c, s.category, W - 32, 2);
    for (let i = lines.length - 1; i >= 0; i--) {
      c.fillText(lines[i], 16, y);
      y -= 16;
    }
    y -= 4;
  }
  c.font = `800 21px ${font}`;
  c.fillStyle = '#fff';
  c.shadowColor = 'rgba(0,0,0,.8)';
  c.shadowBlur = 4;
  const tl = wrap(c, s.title, W - 32, 3);
  for (let i = tl.length - 1; i >= 0; i--) {
    c.fillText(tl[i], 16, y);
    y -= 25;
  }
  c.restore();

  // Bordure.
  roundRect(c, 0.75, 0.75, W - 1.5, H - 1.5, 18);
  c.strokeStyle = `${accent}cc`;
  c.lineWidth = 1.5;
  c.stroke();

  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Image impossible'))), 'image/png'));
}

function download(blob: Blob, title: string): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${title.replace(/[\\/:*?"<>|]+/g, '_') || 'carte'}.png`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

let lastCtx: FeatureContext | null = null;

function install(card: HTMLElement): void {
  if (card.querySelector(':scope > [data-wiky="copy-card"]')) return;
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'wiky-copy';
  b.setAttribute('data-wiky', 'copy-card');
  b.title = 'Copier la carte en image (PNG)';
  setState(b, 'idle');
  isolateClicks(b);
  b.addEventListener('click', (e) => {
    e.preventDefault();
    if (b.dataset.state === 'busy') return;
    setState(b, 'busy');
    const snap = readCard(card, lastCtx);
    const png = renderCardPng(snap);
    const done = (s: CopyState) => {
      setState(b, s);
      setTimeout(() => b.isConnected && setState(b, 'idle'), 1800);
    };
    let copy: Promise<void>;
    try {
      // La promesse est passée tout de suite : le geste de l'utilisateur couvre la copie.
      copy = navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
    } catch (err) {
      copy = Promise.reject(err);
    }
    copy.then(
      () => done('done'),
      async () => {
        try {
          download(await png, snap.title);
          done('saved');
        } catch {
          done('failed');
        }
      },
    );
  });
  card.append(b);
}

/** Cartes affichées dans une fenêtre du site (fiche d'une carte). */
function modalCards(): HTMLElement[] {
  const out: HTMLElement[] = [];
  for (const modal of document.querySelectorAll('div[class*="fixed"][class*="inset-0"]')) {
    if (modal.closest('[data-wiky]')) continue;
    out.push(...nativeCards(modal));
  }
  return out;
}

registerFeature({
  keys: ['copyCardImage'],
  render(ctx) {
    lastCtx = ctx;
    const cards = modalCards();
    if (!cards.length) return;
    ensureStyle('wiky-copy-style', CSS);
    for (const card of cards) install(card);
  },
  cleanup() {
    lastCtx = null;
    document.querySelectorAll('[data-wiky="copy-card"]').forEach((n) => n.remove());
  },
});

