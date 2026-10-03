// Génère les icônes PNG (pièce stylisée sur fond ambre) sans dépendance externe.
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};

function png(size, pixel) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixel(x, y);
      raw.set([r, g, b, a], y * (size * 4 + 1) + 1 + x * 4);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
const clamp = (v) => Math.max(0, Math.min(1, v));
function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const t = clamp(((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy));
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
}

function shade(u, v) {
  // u, v dans [0, 1]
  const radius = 0.22;
  const qx = Math.max(Math.abs(u - 0.5) - (0.5 - radius), 0);
  const qy = Math.max(Math.abs(v - 0.5) - (0.5 - radius), 0);
  const sq = Math.hypot(qx, qy) - radius; // carré arrondi
  if (sq > 0) return null;
  let col = mix([251, 191, 36], [180, 83, 9], clamp((u + v) / 2));
  const d = Math.hypot(u - 0.5, v - 0.5);
  if (d < 0.34) col = [255, 251, 235];
  if (d < 0.27) col = [245, 158, 11];
  // « W » blanc dans la pièce
  const pts = [[0.36, 0.41], [0.42, 0.6], [0.5, 0.45], [0.58, 0.6], [0.64, 0.41]];
  let w = Infinity;
  for (let i = 0; i < pts.length - 1; i++) w = Math.min(w, segDist(u, v, ...pts[i], ...pts[i + 1]));
  if (d < 0.27 && w < 0.04) col = [255, 255, 255];
  return col;
}

mkdirSync('public/icons', { recursive: true });
for (const size of [16, 32, 48, 128]) {
  const ss = 4;
  const buf = png(size, (x, y) => {
    let acc = [0, 0, 0], n = 0;
    for (let i = 0; i < ss; i++) for (let j = 0; j < ss; j++) {
      const c = shade((x + (i + 0.5) / ss) / size, (y + (j + 0.5) / ss) / size);
      if (c) { acc = acc.map((v, k) => v + c[k]); n++; }
    }
    if (!n) return [0, 0, 0, 0];
    return [...acc.map((v) => Math.round(v / n)), Math.round((255 * n) / (ss * ss))];
  });
  writeFileSync(`public/icons/icon-${size}.png`, buf);
}
console.log('✔ Icônes générées dans public/icons/');
