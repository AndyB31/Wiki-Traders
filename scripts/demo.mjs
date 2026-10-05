// Démo de bout en bout : charge l'extension dans Chromium (Playwright), sert une imitation
// des pages WikiMasters, vérifie le parcours relevé → popup → overlay et prend les captures
// du README dans docs/screenshots/.
//
//   npm i -D playwright && npx playwright install chromium
//   npm run build && npm run demo
//
// Les pages servies sont fictives (le vrai site exige d'être connecté) : elles ne servent
// qu'à exercer l'extension, pas à documenter le site.
import { chromium } from 'playwright';
import { mkdtempSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const dist = join(root, 'dist');
const shots = join(root, 'docs/screenshots');
mkdirSync(shots, { recursive: true });

const ORIGIN = 'https://www.wiki-masters.com';
const NOW = Date.now();
const iso = (ms) => new Date(NOW + ms).toISOString();

// [nom, rareté, exemplaires, étiquette sur le site] — aucun prix par carte, comme sur le vrai site.
const CARDS = [
  ['Albert Einstein', 'UR', 3, '50-100'],
  ['Marie Curie', 'SR', 2, '50-100'],
  ['Nikola Tesla', 'SR', 1, '50-100'],
  ['Machu Picchu', 'SR', 2, '20-50'], // médiane SR 60 : relève de « 50-100 »
  ['Mont Fuji', 'R', 4, '20-50'],
  ['Colisée', 'R', 3, '20-50'],
  ['Hibou', 'PC', 3, '20-50'],
  ['Canis lupus', 'PC', 2, ''], // sans étiquette : médiane PC 20 → « 20-50 »
  ['Pieuvre', 'PC', 1, '20-50'],
  ['Chat', 'C', 5, '20-50'],
  ['Origami', 'C', 1, ''],
];
// Ventes conclues récentes (onglet Historique) : médianes C 12, PC 30, R 35, SR 60, UR 150, L 400.
const SOLD = { C: [8, 10, 12, 12, 15, 30], PC: [25, 28, 30, 30, 35, 90], R: [25, 30, 35, 35, 40, 300], SR: [40, 50, 60, 60, 70, 900], UR: [100, 120, 150, 150, 200, 2000], L: [300, 350, 400, 400, 500, 5000] };
// Familles créées avec l'extension « WikiMasters - Prix moyen collection » (stockées dans le localStorage du site).
const FAMILIES = [
  { id: 'family-1', name: 'Merveilles du monde', updatedAt: 1, cards: [
    { id: 'c-machu-picchu', title: 'Machu Picchu', rarity: 'SR', category: 'cité inca', owned: true, ownedCount: 2 },
    { id: 'k-tour', title: 'Tour Eiffel', rarity: 'SR', category: 'tour de Paris', owned: false, ownedCount: 0 },
    { id: 'k-khéops', title: 'Pyramide de Khéops', rarity: 'L', category: 'pyramide', owned: false, ownedCount: 0 },
  ] },
  { id: 'family-2', name: 'Animaux', updatedAt: 1, cards: [
    { id: 'c-hibou', title: 'Hibou', rarity: 'PC', category: 'oiseau', owned: true, ownedCount: 3 },
    { id: 'c-chat', title: 'Chat', rarity: 'C', category: 'félin', owned: true, ownedCount: 5 },
  ] },
];
// Badges « Moy. X W » de l'autre extension (prix moyen propre à la carte) : seuls ces prix servent à l'étiquetage auto.
const SITE_AVG = { 'Machu Picchu': 62, 'Canis lupus': 30 };
const TAG_DEFS = [{ id: 'tag-20-50', name: '20-50', color: '#22c55e' }, { id: 'tag-50-100', name: '50-100', color: '#f59e0b' }];
const RARITY = { C: ['Commun', 'commun'], PC: ['Peu Commun', 'peu_commun'], R: ['Rare', 'rare'], SR: ['Super Rare', 'super_rare'], UR: ['Ultra Rare', 'ultra_rare'], L: ['Légendaire', 'legendaire'] };
const slug = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-');

const CSS = `body{font-family:system-ui;background:#0f172a;color:#e2e8f0;margin:0}header{padding:12px 20px;background:#1e293b}
main{padding:20px}.grid{display:grid;grid-template-columns:repeat(6,150px);gap:14px;list-style:none;padding:0}
.card{background:#1e293b;border-radius:12px;padding:8px;font-size:12px}.card img{width:134px;height:90px;object-fit:cover;border-radius:8px;background:#334155;cursor:pointer}
.tab{background:#334155;color:#e2e8f0;border:0;border-radius:8px;padding:6px 10px;margin-right:6px}.tab.active{background:#f59e0b;color:#111}
.fixed.inset-0{position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:50}.card-frame{position:absolute;top:120px;left:300px;min-width:280px;background:#1e293b;padding:20px;border-radius:12px;box-shadow:0 10px 30px #000}
[data-wiky=market-list]{background:#1e293b;border-radius:12px;padding:12px;color:#e2e8f0}.z-\\[60\\]{display:flex;align-items:center;justify-content:center}[role=menu]{position:fixed;top:200px;left:620px;background:#334155;padding:8px;border-radius:8px;z-index:60}
[role=menuitemcheckbox]{padding:4px 10px;cursor:pointer}[role=menuitemcheckbox][aria-checked=true]::before{content:'✓ '}
.chip{display:inline-block;background:#334155;border-radius:999px;padding:0 6px;margin-top:2px}`;

/**
 * Imitation de React : chaque tuile reçoit une « fibre » dont le composant parent porte les props
 * (comme le ferait React). Le texte affiché est volontairement pauvre (ni quantité ni prix) :
 * l'extension doit lire les props pour tout relever.
 */
const FAKE_REACT = `
function attach(el, props) {
  el.__reactFiber$demo = { tag: 5, memoizedProps: {}, return: { tag: 0, memoizedProps: props, return: { tag: 5, memoizedProps: {}, return: null } } };
}
window.__confirmed = 0;
const TAG_DEFS = JSON.parse(document.body.dataset.tags || '[]');
const tagName = (id) => TAG_DEFS.find((t) => t.id === id)?.name;
function closeAll() { document.querySelectorAll('.fixed.inset-0,[role=menu]').forEach((d) => d.remove()); }
function openCard(li) {
  closeAll();
  const uc = li.__uc;
  // Comme sur le site : fiche carte en portail « div.fixed.inset-0 » sans role, onglets, bouton « Mettre aux enchères ».
  const d = document.createElement('div');
  d.className = 'fixed inset-0 z-50';
  d.innerHTML = '<div class="card-frame relative"><div role="tablist" aria-label="Vue de la carte"><button role="tab">Détails</button><button role="tab">Lab</button></div><h2></h2><button type="button" class="sell">Mettre aux enchères</button></div>';
  d.querySelector('h2').textContent = uc.snapshot_title;
  d.querySelector('.sell').onclick = () => {
    const sell = document.createElement('div');
    sell.className = 'fixed inset-0 z-[60]';
    const RL = { C: 'Commun', PC: 'Peu Commun', R: 'Rare', SR: 'Super Rare', UR: 'Ultra Rare', L: 'Légendaire' };
    sell.innerHTML = '<div class="card-frame relative" style="position:relative;left:auto;top:auto"><h2>Mettre aux enchères</h2><p></p><div class="mt-1.5 space-y-1"><p>Marché · ' + RL[uc.snapshot_rarity] + '</p><div><span>Ventes</span> <span>4</span></div><div><span>Moyenne</span> <span>39</span></div></div><label>Mise de départ</label> <input type="number" inputmode="numeric" aria-label="Mise de départ" value="10"> <label>Durée</label> <button type="button" class="dur">10 min</button> <button type="button" class="dur">1 h</button> <button type="button" class="dur">3 h</button> <button type="button">Annuler</button> <button type="button" class="confirm">Mettre aux enchères</button></div>';
    sell.querySelector('p').textContent = uc.snapshot_title;
    sell.querySelector('.confirm').onclick = () => window.__confirmed++;
    window.__duration = '1 h';
    sell.querySelectorAll('.dur').forEach((b) => (b.onclick = () => (window.__duration = b.textContent)));
    document.body.append(sell);
  };
  // Bloc « Étiquettes » du site : pastilles avec « × », champ combobox « Ajouter une étiquette… », liste de suggestions.
  const block = document.createElement('div');
  block.innerHTML = '<p>Étiquettes</p><div class="chips"></div><div class="relative"><input type="text" role="combobox" placeholder="Ajouter une étiquette…"></div>';
  d.querySelector('.card-frame').append(block);
  const sync = () => {
    attach(li, li.__props);
    li.querySelector('.chip').textContent = li.__props.tagIds.map(tagName).join(', ');
    const chips = block.querySelector('.chips');
    chips.innerHTML = '';
    for (const id of li.__props.tagIds) {
      const chip = document.createElement('span');
      chip.className = 'chip';
      chip.textContent = tagName(id);
      const x = document.createElement('button');
      x.type = 'button';
      x.textContent = '×';
      x.setAttribute('aria-label', "Retirer l'étiquette " + tagName(id));
      x.onclick = () => { li.__props.tagIds = li.__props.tagIds.filter((t) => t !== id); sync(); };
      chip.append(x);
      chips.append(chip);
    }
  };
  sync();
  const input = block.querySelector('input');
  input.addEventListener('input', () => {
    block.querySelector('ul')?.remove();
    const ul = document.createElement('ul');
    ul.setAttribute('role', 'listbox');
    for (const def of TAG_DEFS.filter((t) => !li.__props.tagIds.includes(t.id) && t.name.toLowerCase().includes(input.value.toLowerCase()))) {
      const opt = document.createElement('li');
      opt.setAttribute('role', 'option');
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = def.name;
      b.onclick = () => { li.__props.tagIds = [...li.__props.tagIds, def.id]; input.value = ''; ul.remove(); sync(); };
      opt.append(b);
      ul.append(opt);
    }
    block.querySelector('.relative').append(ul);
  });
  const close = document.createElement('button');
  close.setAttribute('aria-label', 'Fermer');
  close.textContent = '×';
  close.onclick = () => d.remove();
  d.querySelector('.card-frame').prepend(close);
  document.body.append(d);
}
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  const menu = document.querySelector('[role=menu]');
  if (menu) menu.remove(); else closeAll();
});
document.querySelectorAll('li.card').forEach((li) => {
  const uc = JSON.parse(li.dataset.uc);
  li.__uc = uc;
  li.__props = { userCard: uc, tagIds: JSON.parse(li.dataset.tags), onSelect: () => {} };
  attach(li, li.__props);
  li.querySelector('img').addEventListener('click', () => openCard(li));
});
const h1 = document.querySelector('h1');
if (h1) attach(h1, { tags: TAG_DEFS });
document.querySelectorAll('div.card[data-auction]').forEach((el) => attach(el, { auction: JSON.parse(el.dataset.auction) }));
`;

const attr = (o) => JSON.stringify(o).replace(/"/g, '&quot;');

// Barre latérale réelle du site (relevée sur wiki-masters.com, avec l'autre extension) : intégration Wiky-Traders.
const SITE_NAV = readFileSync(join(root, 'tests/fixtures/site-nav.html'), 'utf8');
const shell = (body) => `<!doctype html><html lang="fr" class="h-full"><head><meta charset="utf-8"><title>WikiMasters</title><script src="https://cdn.tailwindcss.com"></script>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Outfit:wght@700&display=swap" rel="stylesheet">
<style>:root{--color-background:#0c0d0c;--color-foreground:#f2f4f3;--color-surface:#131615;--color-surface-light:#1b1f1d;--color-border:#2e3431;--color-accent:#e0b04a;--font-heading:Outfit}
body{background:var(--color-background);color:var(--color-foreground);font-family:Inter,sans-serif;margin:0}
.wm-family-nav{border:1px solid rgba(168,85,247,.24)!important;background:rgba(124,58,237,.07)!important;color:rgb(196,181,253)!important;text-decoration:none!important}
.wm-family-nav-icon{display:inline-flex;align-items:center;justify-content:center;color:rgb(192,132,252)}</style></head>
<body class="h-full"><div class="flex h-screen flex-col md:flex-row">${SITE_NAV}<main class="min-h-0 flex-1 overflow-y-auto">${body}</main></div></body></html>`;
const settingsBody = `<div class="flex-1 p-4 md:p-6 space-y-6"><h1 class="text-2xl md:text-3xl font-bold">Paramètres</h1>
<div role="tablist" class="flex gap-2"><button role="tab" aria-selected="true" class="px-4 py-2 rounded-xl text-sm font-medium bg-[var(--color-surface-light)]">Compte</button><button role="tab" aria-selected="false" class="px-4 py-2 rounded-xl text-sm font-medium opacity-60">Affichage</button></div>
<p class="opacity-50">Réglages du site…</p></div>`;

const page = (title, body) => `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>${title}</title><style>${CSS}</style></head>
<body data-tags="${attr(TAG_DEFS)}"><script src="/_next/static/chunks/app.js"></script><script>localStorage.setItem('wm_families_v1', ${JSON.stringify(JSON.stringify(FAMILIES)).replace(/</g, '\\u003c')});</script><header><a href="/collection">Collection</a> · <a href="/marketplace">Marché</a></header><main>${body}</main><script>${FAKE_REACT}</script></body></html>`;


const collection = () =>
  page(
    'Collection',
    `<h1>Ma collection</h1><ul class="grid">${CARDS.map(([name, r, qty, tag]) => {
      const uc = { id: `uc-${slug(name)}`, card_id: `c-${slug(name)}`, count: qty, starred: false, snapshot_title: name, snapshot_rarity: r, is_shiny: false };
      const tagIds = tag ? [`tag-${tag}`] : [];
      const moy = SITE_AVG[name];
      return `<li class="card" data-uc="${attr(uc)}" data-tags="${attr(tagIds)}"><img alt="${name}" src="/cards/${slug(name)}.jpg"><strong>${name}</strong><div class="chip">${tag}</div>${moy != null ? `<div class="wm-average-badge">Moy. ${moy} W</div>` : ''}</li>`;
    }).join('')}</ul>`,
  );

let myAuctions = [
  ['a1b2c3d4-0001', 'Albert Einstein', 'UR', 110, 72 * 60_000],
  ['a1b2c3d4-0002', 'Mont Fuji', 'R', 40, 5 * 3_600_000],
  ['a1b2c3d4-0003', 'Chat', 'C', 20, 26 * 3_600_000],
];

const TABS = [['browse', 'Parcourir'], ['mine', 'Mes ventes'], ['bids', 'Mes enchères (0)'], ['history', 'Historique']];
const auctionRow = (id, name, r, price, ms, status = 'active') => ({
  id, seller_id: 'moi', card_id: `c-${slug(name)}`, base_amount: price, current_bid: status === 'active' ? price : null, end_at: iso(ms), status,
  final_price: status === 'settled_sold' ? price : null, snapshot_rarity: r, is_shiny: false, card: { wikipedia_title: name, rarity: r },
});

const marketplace = (tab) => {
  let rows;
  if (tab === 'mine') rows = myAuctions.map(([id, name, r, price, ms]) => auctionRow(id, name, r, price, ms));
  else if (tab === 'history')
    rows = Object.entries(SOLD).flatMap(([r, prices]) => prices.map((p, i) => auctionRow(`h-${r}-${i}-0000`, `Vente ${r} ${i}`, r, p, -3_600_000 * (i + 1), 'settled_sold')));
  else rows = [auctionRow('ffff0000-0009', 'Tour Eiffel', 'R', 58, 3_600_000)];
  // Comme sur le vrai site : onglets sans attribut ARIA, l'actif ne se distingue que par ses classes.
  const tabs = TABS.map(([k, label]) => `<button class="tab${k === tab ? ' active' : ''}" onclick="location.search='?tab=${k}'">${k === 'mine' ? `${label} (${myAuctions.length}/5)` : label}</button>`).join('');
  return page(
    'Marché',
    `<div class="tabs">${tabs}</div><div class="grid">${rows
      .map((a) => `<div class="card" data-auction="${attr(a)}"><a href="/marketplace/${a.id}"><img alt="" src="/${a.snapshot_rarity}.png"></a><h3>${a.card.wikipedia_title}</h3><p>Vendu par moi</p></div>`)
      .join('')}</div>`,
  );
};

const png = readFileSync(join(root, 'public/icons/icon-128.png'));

// Faux Supabase pour l'onglet « Mises » (lecture via l'API).
const b64url = (x) => Buffer.from(x).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fakeJwt = (p) => `${b64url('{"alg":"HS256"}')}.${b64url(JSON.stringify(p))}.sig`;
const SB_REF = 'demoprojectref01';
const SB_URL = `https://${SB_REF}.supabase.co`;
const SB_ANON = fakeJwt({ role: 'anon', ref: SB_REF });
const SB_ME = 'user-demo';
// Collection vue par l'API : Origami a été vendue, « Grande Muraille » vient d'être obtenue.
const API_COLLECTION = [...CARDS.filter(([name]) => name !== 'Origami'), ['Grande Muraille', 'L', 1, '']];
const SB_DATA = {
  auction_bids: [
    { auction_id: 'b1', amount: 45, placed_at: iso(-600_000) },
    { auction_id: 'b1', amount: 60, placed_at: iso(-300_000) },
    { auction_id: 'b2', amount: 120, placed_at: iso(-200_000) },
    { auction_id: 'b3', amount: 18, placed_at: iso(-86_400_000) },
    { auction_id: 'b4', amount: 300, placed_at: iso(-90_000_000) },
  ],
  auctions: [
    { id: 'b1', card_id: 'k1', base_amount: 40, current_bid: 75, current_bidder_id: 'autre', final_price: null, status: 'active', end_at: iso(1_500_000), winner_id: null, snapshot_rarity: 'SR', is_shiny: false },
    { id: 'b2', card_id: 'k2', base_amount: 100, current_bid: 120, current_bidder_id: SB_ME, final_price: null, status: 'active', end_at: iso(5_400_000), winner_id: null, snapshot_rarity: 'UR', is_shiny: false },
    { id: 'b3', card_id: 'k3', base_amount: 10, current_bid: 18, current_bidder_id: SB_ME, final_price: 18, status: 'settled_sold', end_at: iso(-80_000_000), winner_id: SB_ME, snapshot_rarity: 'PC', is_shiny: true },
    { id: 'b4', card_id: 'k4', base_amount: 250, current_bid: 340, current_bidder_id: 'autre', final_price: 340, status: 'settled_sold', end_at: iso(-86_000_000), winner_id: 'autre', snapshot_rarity: 'L', is_shiny: false },
  ],
  cards: [
    { id: 'k1', wikipedia_title: 'Tour Eiffel', rarity: 'SR' },
    { id: 'k2', wikipedia_title: 'Léonard de Vinci', rarity: 'UR' },
    { id: 'k3', wikipedia_title: 'Hérisson', rarity: 'PC' },
    { id: 'k4', wikipedia_title: 'Pyramide de Khéops', rarity: 'L' },
  ],
  sales: [{ card_id: 'k1', final_price: 70 }, { card_id: 'k1', final_price: 90 }, { card_id: 'k4', final_price: 320 }],
};
const ok = (cond, msg) => {
  if (!cond) throw new Error(`✗ ${msg}`);
  console.log(`✓ ${msg}`);
};

const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'wiky-')), {
  channel: 'chromium',
  headless: true,
  viewport: { width: 1280, height: 800 },
  args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`],
});
const apiCalls = [];
const apiWrites = [];
// Liens étiquettes ↔ cartes côté « base » : modifiés par les écritures de l'étiquetage par l'API.
const apiLinks = new Set(API_COLLECTION.flatMap(([, , , tag], i) => (tag ? [`uc-${i}|tag-${tag}`] : [])));
await ctx.route(`${SB_URL}/**`, (route) => {
  const req = route.request();
  const u = new URL(req.url());
  apiCalls.push(req.method());
  if (req.method() === 'POST' || req.method() === 'DELETE') {
    const t = u.pathname.split('/').pop();
    const q = decodeURIComponent(u.search);
    apiWrites.push(`${req.method()} ${t}`);
    if (t === 'user_card_tags' && req.method() === 'POST') {
      for (const b of [JSON.parse(req.postData())].flat()) apiLinks.add(`${b.user_card_id}|${b.tag_id}`);
    } else if (t === 'user_card_tags') {
      const ids = [...q.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
      const tag = q.match(/tag_id=eq\.([^&]+)/)[1];
      for (const id of ids) apiLinks.delete(`${id}|${tag}`);
    }
    return route.fulfill({ status: 201, headers: { 'access-control-allow-origin': '*', 'content-type': 'application/json' }, body: '[]' });
  }
  const table = u.pathname.split('/').pop();
  const headers = { 'access-control-allow-origin': '*', 'content-type': 'application/json' };
  if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { ...headers, 'access-control-allow-headers': '*' } });
  const q = decodeURIComponent(u.search);
  const body =
    table === 'user_cards' ? API_COLLECTION.map(([name, r, count, tag], i) => ({ id: `uc-${i}`, card_id: `c-${slug(name)}`, count, starred: false, snapshot_title: name, snapshot_rarity: r, snapshot_category: null, is_shiny: false })) :
    table === 'tags' ? TAG_DEFS.map((t) => ({ id: t.id, name: t.name })) :
    table === 'user_card_tags' ? [...apiLinks].map((l) => ({ user_card_id: l.split('|')[0], tag_id: l.split('|')[1] })) :
    table === 'auction_bids' ? SB_DATA.auction_bids :
    table === 'cards' ? [...SB_DATA.cards, ...myAuctions.map(([, name, r]) => ({ id: `c-${slug(name)}`, wikipedia_title: name, rarity: r }))] :
    q.includes('seller_id=eq.') && q.includes('status=eq.active') ? myAuctions.map(([id, name, r, price, ms]) => auctionRow(id, name, r, price, ms)) :
    q.includes('status=eq.settled_sold') && q.includes('end_at=gte.') ? Object.entries(SOLD).flatMap(([r, prices]) =>
      prices.map((p, i) => ({ id: `m-${r}-${i}`, card_id: `mc-${r}-${i}`, final_price: p + 1, snapshot_rarity: r, is_shiny: false, end_at: iso(-3_600_000 * (i + 1)), status: 'settled_sold', card: { wikipedia_title: `Marché ${r} ${i}` } })),
    ) :
    q.includes('seller_id=eq.') && q.includes('status=in.') ? [
      { id: 'v1', card_id: 'k1', base_amount: 40, final_price: 66, status: 'settled_sold', end_at: iso(-3_600_000), settled_at: iso(-3_590_000), snapshot_rarity: 'SR', is_shiny: false },
      { id: 'v2', card_id: 'k3', base_amount: 10, final_price: 12, status: 'settled_sold', end_at: iso(-7_200_000), settled_at: iso(-7_190_000), snapshot_rarity: 'PC', is_shiny: false },
      { id: 'v3', card_id: 'k2', base_amount: 200, final_price: null, status: 'settled_unsold', end_at: iso(-9_000_000), settled_at: null, snapshot_rarity: 'UR', is_shiny: false },
    ] :
    q.includes('select=id,card_id,final_price') ? [{ id: 'v1', card_id: 'k1', final_price: 66 }, ...SB_DATA.sales.map((x, i) => ({ id: `z${i}`, ...x }))] :
    q.includes('select=card_id,final_price') ? SB_DATA.sales :
    q.includes('select=final_price&card_id=eq.') ? [{ final_price: 30 }, { final_price: 42 }] :
    q.includes('card_id=eq.') ? [
      { id: 'cx2', seller_id: 'v2', base_amount: 25, current_bid: 31, end_at: iso(2_400_000), is_shiny: false, status: 'active' },
      { id: 'cx1', seller_id: 'v1', base_amount: 28, current_bid: null, end_at: iso(600_000), is_shiny: false, status: 'active' },
      { id: 'cx3', seller_id: 'v3', base_amount: 60, current_bid: null, end_at: iso(9_000_000), is_shiny: true, status: 'active' },
    ] :
    SB_DATA.auctions;
  return route.fulfill({ status: 200, headers, body: JSON.stringify(body) });
});
await ctx.addCookies([{ name: `sb-${SB_REF}-auth-token`, value: encodeURIComponent('base64-' + b64url(JSON.stringify({ access_token: fakeJwt({ sub: SB_ME, exp: 9_999_999_999 }) }))), domain: 'www.wiki-masters.com', path: '/' }]);
await ctx.route(`${ORIGIN}/**`, (route) => {
  const url = new URL(route.request().url());
  if (/\.(png|jpe?g)$/.test(url.pathname)) return route.fulfill({ body: png, contentType: 'image/png' });
  if (url.pathname === '/_next/static/chunks/app.js') return route.fulfill({ body: `window.__sb={url:"${SB_URL}",key:"${SB_ANON}"};`, contentType: 'application/javascript' });
  if (url.pathname === '/settings' || url.searchParams.has('wiky')) return route.fulfill({ body: shell(url.pathname === '/settings' ? settingsBody : '<div class="p-6"><h1 class="text-3xl font-bold">Collection</h1></div>'), contentType: 'text/html' });
  if (url.pathname.startsWith('/collection')) return route.fulfill({ body: collection(), contentType: 'text/html' });
  if (url.pathname.startsWith('/marketplace')) return route.fulfill({ body: marketplace(url.searchParams.get('tab') ?? 'browse'), contentType: 'text/html' });
  return route.fulfill({ body: page('WikiMasters', '<h1>Accueil</h1>'), contentType: 'text/html' });
});

let [sw] = ctx.serviceWorkers();
sw ??= await ctx.waitForEvent('serviceworker');
const extId = sw.url().split('/')[2];
const extUrl = (p) => `chrome-extension://${extId}/${p}`;
const storage = () => sw.evaluate(() => chrome.storage.local.get(null));
const waitFor = async (pred, label, timeout = 5000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const s = await storage();
    if (pred(s)) return s;
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`✗ délai dépassé : ${label}`);
};

// 1. Collection
const site = await ctx.newPage();
await site.goto(`${ORIGIN}/collection`);
let s = await waitFor((x) => Object.keys(x.cards ?? {}).length === CARDS.length, 'relevé de la collection');
ok(s.cards['albert-einstein'].quantity === 3 && s.cards['albert-einstein'].rarity === 'UR', 'collection relevée via les données React (quantités, raretés)');
ok(s.cards['colisee'].tags.join() === '20-50' && s.cards['canis-lupus'].tags.length === 0, 'étiquettes relevées (identifiants → noms)');

// 1 bis. Historique et marché : prix observés, sans ajouter ces cartes à la collection
await site.goto(`${ORIGIN}/marketplace?tab=history`);
s = await waitFor((x) => (x.priceObs ?? []).filter((o) => o.type === 'sold').length === 36, 'ventes de l\'historique');
ok(s.priceObs.every((o) => o.rarity), '36 ventes conclues observées, avec leur rareté');
await site.goto(`${ORIGIN}/marketplace`);
s = await waitFor((x) => (x.priceObs ?? []).some((o) => o.type === 'listing'), 'enchères du marché');
ok(Object.keys(s.cards).length === CARDS.length, 'les cartes des autres joueurs ne sont pas ajoutées à la collection');
ok(s.meta.lastPage.recognized && s.meta.lastPage.source === 'react', `statut : ${s.meta.lastPage.message}`);

// 2. Mes enchères (onglet « Mes ventes » actif)
await site.goto(`${ORIGIN}/marketplace?tab=mine`);
s = await waitFor((x) => (x.myAuctions ?? []).length === 3, 'relevé de mes enchères');
ok(s.journal.filter((e) => e.type === 'created').length === 3, '3 enchères relevées et journalisées');
const alarms = await sw.evaluate(() => chrome.alarms.getAll());
ok(alarms.filter((a) => a.name.startsWith('auction:')).length === 3, 'une alarme par fin d\'enchère');
const badge = await sw.evaluate(() => chrome.action.getBadgeText({}));
ok(badge === '2', `badge = ${badge}`);

// 1 ter. Étiquettes visibles sur les cartes (pastilles colorées)
await site.goto(`${ORIGIN}/collection`);
await site.waitForFunction(() => document.querySelectorAll('[data-wiky="tags"]').length >= 5, null, { timeout: 8000 });
const chip = await site.evaluate(() => {
  const li = [...document.querySelectorAll('li.card')].find((l) => l.querySelector('strong').textContent === 'Colisée');
  const box = li.querySelector('[data-wiky="tags"]');
  const span = box?.querySelector('span');
  return span ? { text: span.textContent, bg: getComputedStyle(span).backgroundColor } : null;
});
ok(chip?.text === '20-50' && chip.bg === 'rgb(34, 197, 94)', `étiquettes sur les cartes : Colisée → « ${chip?.text} » (${chip?.bg})`);
const noChip = await site.evaluate(() => !![...document.querySelectorAll('li.card')].find((l) => l.querySelector('strong').textContent === 'Canis lupus').querySelector('[title^="Étiquettes"]'));
ok(!noChip, 'pas de pastille sur une carte sans étiquette');
await site.screenshot({ path: join(shots, 'tag-overlay.png') });

// 1 quater. Style « pastilles de couleur seulement »
await sw.evaluate(async () => {
  const { settings } = await chrome.storage.local.get('settings');
  await chrome.storage.local.set({ settings: { ...settings, tagOverlayStyle: 'dot' } });
});
await site.waitForFunction(() => document.querySelector('[data-wiky="tags"]')?.dataset.style === 'dot', null, { timeout: 5000 });
const dotInfo = await site.evaluate(() => {
  const box = document.querySelector('[data-wiky="tags"]');
  return { texts: [...box.querySelectorAll('span')].map((s) => s.textContent).join(''), titles: [...box.querySelectorAll('span')].map((s) => s.title) };
});
ok(dotInfo.texts === '' && dotInfo.titles.length > 0, `pastilles de couleur seulement (nom au survol : ${dotInfo.titles.join(', ')})`);
await site.screenshot({ path: join(shots, 'tag-overlay-dots.png') });
await sw.evaluate(async () => {
  const { settings } = await chrome.storage.local.get('settings');
  await chrome.storage.local.set({ settings: { ...settings, tagOverlayStyle: 'label' } });
});
await site.waitForFunction(() => document.querySelector('[data-wiky="tags"]')?.dataset.style === 'label', null, { timeout: 5000 });

// 2 bis. Fenêtre flottante dans la page (sans l'intégration au site, qui la remplace)
await sw.evaluate(async () => {
  const { settings } = await chrome.storage.local.get('settings');
  await chrome.storage.local.set({ settings: { ...settings, siteIntegration: false }, floating: { open: true, minimized: false, r: 16, b: 16, w: 390, h: 600 } });
});
await site.goto(`${ORIGIN}/collection`);
const winHost = site.locator('[data-wiky="window"]');
await winHost.waitFor({ state: 'attached', timeout: 5000 });
const winBox = () => winHost.evaluate((el) => { const r = el.shadowRoot.querySelector('.win').getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; });
const frame = await (await winHost.evaluateHandle((el) => el.shadowRoot.querySelector('iframe'))).asElement().contentFrame();
await frame.waitForSelector('.banner', { timeout: 8000 });
ok(/slots occupés/.test(await frame.textContent('.banner')), 'fenêtre ouverte dans la page avec l\'interface de la popup');
await site.waitForTimeout(500);

const b0 = await winBox();
const vp = site.viewportSize();
ok(b0.x + b0.w === vp.width - 16 && b0.y + b0.h === vp.height - 16, `ouverte en bas à droite (${b0.x},${b0.y} ${b0.w}×${b0.h})`);
const barPos = await winHost.evaluate((el) => { const r = el.shadowRoot.querySelector('.bar .t').getBoundingClientRect(); return { x: r.x + 10, y: r.y + 10 }; });
await site.mouse.move(barPos.x, barPos.y);
await site.mouse.down();
await site.mouse.move(barPos.x - 300, barPos.y - 60, { steps: 5 });
await site.mouse.up();
const b1 = await winBox();
ok(b1.x === b0.x - 300 && b1.y === b0.y - 60, `déplacée (${b0.x},${b0.y}) → (${b1.x},${b1.y})`);

// Poignée en haut à gauche : le coin bas-droit ne bouge pas.
const grip = { x: b1.x + 5, y: b1.y + 5 };
await site.mouse.move(grip.x, grip.y);
await site.mouse.down();
await site.mouse.move(grip.x - 80, grip.y + 150, { steps: 5 });
await site.mouse.up();
const b2 = await winBox();
ok(b2.w === b1.w + 80 && b2.h === b1.h - 150 && b2.x + b2.w === b1.x + b1.w && b2.y + b2.h === b1.y + b1.h, `redimensionnée ${b1.w}×${b1.h} → ${b2.w}×${b2.h}, coin bas-droit fixe`);

await winHost.evaluate((el) => el.shadowRoot.querySelector('.minbtn').click());
const bMin = await winBox();
ok(bMin.h === 36 && bMin.y + bMin.h === b2.y + b2.h, 'réduite : la barre reste en bas, au même endroit');
await site.reload();
await winHost.waitFor({ state: 'attached' });
const b3 = await winBox();
ok(b3.h === 36 && b3.x === bMin.x && b3.y === bMin.y, 'position et état conservés après rechargement');
await winHost.evaluate((el) => el.shadowRoot.querySelector('.minbtn').click());
const b4 = await winBox();
ok(b4.h === b2.h && b4.y + b4.h === b2.y + b2.h, 'ré-agrandie vers le haut');
await site.screenshot({ path: join(shots, 'window.png') });

await winHost.evaluate((el) => el.shadowRoot.querySelector('.close').click());
ok((await site.locator('[data-wiky="window"]').count()) === 0, 'fermée');
await site.bringToFront();
await sw.evaluate(async () => {
  const [tab] = await chrome.tabs.query({ url: 'https://www.wiki-masters.com/collection*', active: true });
  await chrome.tabs.sendMessage(tab.id, { type: 'toggleWindow' });
});
await winHost.waitFor({ state: 'attached', timeout: 3000 });
ok(true, 'rouverte par l\'icône de l\'extension');

// 3. Popup
const popup = await ctx.newPage();
await popup.setViewportSize({ width: 380, height: 640 });
await popup.goto(extUrl('popup.html'));
await popup.waitForSelector('.slot.free');
const banner = await popup.textContent('.banner');
ok(/3\/5 slots occupés/.test(banner), `bandeau : ${banner.trim()}`);
const free = await popup.$$eval('.slot.free', (els) => els.map((e) => e.textContent));
ok(free.length === 2 && free.every((t) => t.includes('20-50')), '2 slots « 20-50 » à remplir');
await popup.screenshot({ path: join(shots, 'popup.png'), fullPage: true });
const names = () => popup.$$eval('.slot.free .main strong', (els) => els.map((e) => e.textContent));
const before = await names();
await popup.click('button:has-text("Proposer d\'autres cartes")');
await popup.waitForFunction((b) => JSON.stringify([...document.querySelectorAll('.slot.free .main strong')].map((e) => e.textContent)) !== b, JSON.stringify(before), { timeout: 5000 });
const after = await names();
ok(after.length === before.length && new Set(after).size === after.length && after.some((n) => !before.includes(n)), `🔀 nouvelles propositions (sans doublon) : ${before.join(', ')} → ${after.join(', ')}`);
await popup.click('button:has-text("Par défaut")');
await popup.waitForFunction((b) => JSON.stringify([...document.querySelectorAll('.slot.free .main strong')].map((e) => e.textContent)) === b, JSON.stringify(before), { timeout: 5000 });
ok(true, '↺ retour aux propositions par défaut');


// 4. Options et journal
const opts = await ctx.newPage();
await opts.goto(extUrl('options.html'));
await opts.waitForSelector('table.rules');
await opts.screenshot({ path: join(shots, 'options.png'), fullPage: true });
await opts.goto(extUrl('journal.html'));
await opts.waitForSelector('table');
await opts.screenshot({ path: join(shots, 'journal.png') });

// 5. « Ouvrir » : la collection s'ouvre, la carte est mise en avant avec le prix conseillé
const [opened] = await Promise.all([ctx.waitForEvent('page'), popup.click('.slot.free button.primary')]);
await opened.waitForLoadState();
// Les onglets ouverts par l'extension échappent au routage Playwright : on recharge la page simulée.
ok(opened.url().startsWith(`${ORIGIN}/collection`) || opened.url().startsWith(`${ORIGIN}/login`), `« Ouvrir » ouvre la collection (${new URL(opened.url()).pathname})`);
await opened.goto(`${ORIGIN}/collection`);
const panel = opened.locator('[data-wiky="toast"][data-id="price"]');
await panel.waitFor({ state: 'attached', timeout: 5000 });
const panelText = await panel.evaluate((el) => el.textContent);
ok(/prix conseillé/i.test(panelText), `toast : ${panelText.replace(/\s+/g, ' ').slice(0, 90)}…`);
ok((await opened.locator('[data-wiky="tags"]').count()) > 0 && !(await opened.evaluate(() => document.body.innerText.includes('🪙'))), 'étiquettes sur les cartes, sans pastille de prix');
await opened.waitForTimeout(600);
await opened.screenshot({ path: join(shots, 'overlay.png') });

// 6. Fenêtre de mise en vente : l'encart affiche le prix de la carte affichée
await opened.evaluate(() => {
  const d = document.createElement('div');
  d.className = 'fixed inset-0 z-[60]';
  d.innerHTML = '<div class="card-frame relative"><h2>Mettre aux enchères</h2><p>Colisée</p><label>Mise de départ</label><input type="number" aria-label="Mise de départ"><button>Mettre aux enchères</button></div>';
  document.body.append(d);
});
await opened.waitForFunction(() => /Colisée[\s\S]*= 25/.test(document.querySelector('[data-wiky="toast"][data-id="price"]')?.textContent ?? ''), null, { timeout: 5000 });
const sellText = await panel.evaluate((el) => el.textContent);
ok(/Colisée/.test(sellText) && /médiane Rare 35 \(6 ventes\) × 70 % = 25/.test(sellText), 'fenêtre de vente : prix de la proposition ouverte (médiane Rare 35 × 70 % = 24,5 → 25)');
await opened.screenshot({ path: join(shots, 'sell-dialog.png') });

// 7. Une nouvelle enchère créée par l'utilisateur, une autre terminée
myAuctions = [...myAuctions.slice(1), ['a1b2c3d4-0004', 'Colisée', 'R', 40, 48 * 3_600_000]];
await site.goto(`${ORIGIN}/marketplace?tab=mine`);
s = await waitFor((x) => x.myAuctions?.some((a) => a.cardName === 'Colisée'), 'nouvelle enchère');
ok(s.journal.some((e) => e.type === 'finished' && e.cardName === 'Albert Einstein'), 'enchère disparue journalisée comme terminée');
ok(s.pendingFocus === null, 'carte proposée mise en vente : encart refermé');


// 8. V4 et étiquetage automatique (activés pour la démo)
await sw.evaluate(async () => {
  const { settings } = await chrome.storage.local.get('settings');
  await chrome.storage.local.set({
    settings: { ...settings, prefill: true, autoTag: true, durationRules: [{ from: 0, to: 20, minutes: 10 }, { from: 21, to: 100, minutes: 60 }, { from: 101, to: null, minutes: 180 }] },
  });
});
const popup2 = await ctx.newPage();
await popup2.setViewportSize({ width: 380, height: 640 });
await popup2.goto(extUrl('popup.html'));
await popup2.click('.tabs .tab:has-text("Étiquettes")');
await popup2.waitForSelector('.autotag');
const planText = await popup2.textContent('.autotag');
ok(/2 carte\(s\)/.test(planText), `plan d'étiquetage : ${planText.match(/Étiquetage auto : \d+ carte\(s\)/)?.[0]}`);
await popup2.click('.autotag summary');
await popup2.screenshot({ path: join(shots, 'popup-automations.png'), fullPage: true });

await popup2.click('.tabs .tab:has-text("Vendre")');
const [v4] = await Promise.all([ctx.waitForEvent('page'), popup2.click('.slot.free button.primary')]);
await v4.waitForLoadState();
await v4.goto(`${ORIGIN}/collection`);
await v4.waitForFunction(() => document.querySelector('input[aria-label="Mise de départ"]')?.value === '20' && window.__duration === '10 min', null, { timeout: 8000 });
const filled = await v4.inputValue('input[aria-label="Mise de départ"]');
const v4Card = await v4.textContent('.z-\\[60\\] p');
ok(filled === '20', `V4 : vente de « ${v4Card} » ouverte, mise de départ remplie à ${filled} (au lieu du 10 du site)`);
ok((await v4.evaluate(() => window.__duration)) === '10 min', 'V4 : durée 10 min choisie (palier ≤ 20)');
await v4.waitForTimeout(400);
ok((await v4.evaluate(() => window.__confirmed)) === 0, 'V4 : le bouton de validation n\'a pas été cliqué');
await v4.screenshot({ path: join(shots, 'prefill.png') });
await v4.keyboard.press('Escape');

const tagPage = await ctx.newPage();
await tagPage.goto(`${ORIGIN}/collection`);
await tagPage.waitForTimeout(1200);
const res = await sw.evaluate(async () => {
  const [tab] = await chrome.tabs.query({ url: 'https://www.wiki-masters.com/collection*', active: true });
  return chrome.tabs.sendMessage(tab.id, { type: 'autoTag' });
});
ok(res?.ok, 'étiquetage automatique lancé');
await tagPage.waitForFunction(() => /carte\(s\) étiquetée\(s\)/.test(document.querySelector('[data-wiky="toast"][data-id="progress"]')?.textContent ?? ''), null, { timeout: 30000 });
const chips = await tagPage.$$eval('li.card', (lis) => Object.fromEntries(lis.map((li) => [li.querySelector('strong').textContent, li.querySelector('.chip').textContent])));
ok(chips['Machu Picchu'] === '50-100' && chips['Canis lupus'] === '20-50', `étiquettes appliquées sur le site : Machu Picchu → ${chips['Machu Picchu']}, Canis lupus → ${chips['Canis lupus']}`);
await tagPage.screenshot({ path: join(shots, 'autotag.png') });
s = await waitFor((x) => x.cards?.['machu-picchu']?.tags?.join() === '50-100', 'étiquettes relues après étiquetage', 8000);
ok(true, 'nouvelles étiquettes relues par l\'extension');


// 9. Depuis le Marché, dans la fenêtre intégrée : « Ouvrir et pré-remplir » passe par la collection
const market = await ctx.newPage();
await market.goto(`${ORIGIN}/marketplace?tab=mine`);
await market.waitForTimeout(1000);
const embedFrame = async (pg) => {
  const host = pg.locator('[data-wiky="window"]');
  await host.waitFor({ state: 'attached', timeout: 5000 });
  const f = await (await host.evaluateHandle((el) => el.shadowRoot.querySelector('iframe'))).asElement().contentFrame();
  await f.waitForSelector('.banner', { timeout: 8000 });
  return f;
};
let ef = await embedFrame(market);
ok((await ef.$$('.tabs .tab')).length === 6, 'fenêtre en onglets : Vendre / En cours / Mises / Cartes / Étiquettes / Outils');
await ef.click('.tabs .tab:has-text("Vendre")');
await ef.waitForSelector('.slot.free button.primary');
await ef.click('.slot.free button.primary');
await market.waitForURL(/\/collection/, { timeout: 8000 });
await market.waitForFunction(() => {
  const v = document.querySelector('input[aria-label="Mise de départ"]')?.value;
  return v != null && v !== '10' && window.__duration === '10 min';
}, null, { timeout: 12000 });
const marketCard = await market.textContent('.z-\\[60\\] p');
ok(true, `depuis le Marché (« ${marketCard} ») : passage par la collection puis vente ouverte (mise ${await market.inputValue('input[aria-label="Mise de départ"]')}, durée ${await market.evaluate(() => window.__duration)})`);
await market.keyboard.press('Escape');

// 10. 🔄 Actualiser mes ventes : Marché → onglet « Mes ventes »
await market.goto(`${ORIGIN}/collection`);
ef = await embedFrame(market);
const scanBefore = (await storage()).meta.lastAuctionsScan;
await ef.click('header button[title^="Actualiser"]');
await market.waitForURL(/tab=mine/, { timeout: 10000 });
s = await waitFor((x) => x.intent === null && x.meta.lastAuctionsScan > scanBefore, 'ventes relues', 10000);
ok(true, '🔄 : Marché → onglet « Mes ventes » → liste relue');
ef = await embedFrame(market);
await ef.click('.tabs .tab:has-text("En cours")');
await market.waitForTimeout(400);
await market.screenshot({ path: join(shots, 'window-tabs.png') });


// 11. Onglet « Mises » : lecture via l'API (faux Supabase)
await sw.evaluate(async () => {
  const { settings } = await chrome.storage.local.get('settings');
  await chrome.storage.local.set({ settings: { ...settings, apiRead: true } });
});
await market.goto(`${ORIGIN}/collection`);
ef = await embedFrame(market);
s = await waitFor((x) => x.meta?.lastCollectionApi && x.cards['grande-muraille'], 'collection rechargée via l\'API', 10000);
ok(!s.cards['origami'] && s.cards['grande-muraille']?.rarity === 'L', 'collection rechargée via l\'API à l\'ouverture : carte vendue retirée, nouvelle carte ajoutée');
// Mes ventes en cours relues via l'API : 🔄 ne quitte plus la collection.
myAuctions.push(['a1b2c3d4-0005', 'Hibou', 'PC', 30, 2 * 3_600_000]);
await ef.click('header button[title^="Actualiser"]');
s = await waitFor((x) => x.myAuctions.some((a) => a.id === 'a1b2c3d4-0005'), 'ventes en cours relues via l\'API', 10000);
ok(new URL(market.url()).pathname === '/collection' && s.myAuctions.length === 4 && s.myAuctions.find((a) => a.id === 'a1b2c3d4-0005').cardName === 'Hibou',
  `🔄 avec l'API : ${s.myAuctions.length} ventes en cours relues sans aller sur Marché → « Mes ventes »`);
myAuctions.pop();
await sw.evaluate(async () => {
  const { meta } = await chrome.storage.local.get('meta');
  await chrome.storage.local.set({ meta: { ...meta, lastAuctionsScan: 0 } });
});
await market.reload();
s = await waitFor((x) => x.myAuctions.length === 3 && x.meta.lastAuctionsScan > 0, 'relève automatique au chargement', 10000);
ok(true, 'relève automatique via l\'API au chargement de la page : vente terminée retirée (3 en cours)');
ef = await embedFrame(market);
await ef.click('.tabs .tab:has-text("Mises")');
await ef.click('button[title="Relire mes mises"]');
await ef.waitForSelector('.bid', { timeout: 8000 });
const bidRows = await ef.$$eval('.bid', (els) => els.map((e) => e.textContent.replace(/\s+/g, ' ').trim()));
ok(bidRows.length === 4 && /Surenchéri/.test(bidRows[0]) && /En tête/.test(bidRows[1]), `4 mises lues : ${bidRows.map((r) => r.split(' ')[0]).join(', ')}…`);
ok(/carte 80 \(2 ventes\)/.test(bidRows[0]), 'prix de la carte (médiane de ses ventes) affiché');
ok(apiCalls.length > 0 && apiCalls.every((m) => m === 'GET' || m === 'OPTIONS'), `${apiCalls.length} appels API, uniquement en lecture (tant que l'écriture n'est pas activée)`);
// Rouvrir « Mises » relit les mises sans clic ; « En cours seulement » masque les terminées.
const bidsAt = (await storage()).bidsCache.at;
await ef.click('.tabs .tab:has-text("Vendre")');
await ef.click('.tabs .tab:has-text("Mises")');
await waitFor((x) => x.bidsCache?.at > bidsAt, 'mises relues à l\'ouverture', 8000);
ok(true, '« Mises » actualisée automatiquement à l\'ouverture');
await ef.click('label:has-text("En cours seulement") input');
const currentRows = await ef.$$eval('.bid .pill', (els) => els.map((e) => e.textContent));
ok(currentRows.length > 0 && currentRows.every((t) => /En tête|Surenchéri/.test(t)), `« En cours seulement » : ${currentRows.length} mise(s) en jeu (${currentRows.join(', ')})`);
await ef.click('label:has-text("En cours seulement") input');
await market.waitForTimeout(300);
await market.screenshot({ path: join(shots, 'window-bids.png') });


// 12. Onglet « Cartes » : familles, puis enchères en cours d'une carte (de la moins chère à la plus chère)
await ef.click('.tabs .tab:has-text("Cartes")');
await ef.waitForSelector('.family');
const families = await ef.$$eval('.family summary', (els) => els.map((e) => e.textContent.trim()));
ok(families.join() === 'Merveilles du monde (1/3),Animaux (2/2)', `familles lues depuis l'autre extension : ${families.join(', ')}`);
await ef.click('.family summary');
const firstRow = await ef.textContent('.family .card-row');
ok(/Pyramide de Khéops.*manquante/.test(firstRow.replace(/\s+/g, ' ')), 'cartes manquantes en premier');
await ef.click('.family .card-row:has-text("Tour Eiffel")');
await ef.waitForSelector('.auction-row', { timeout: 8000 });
const prices = await ef.$$eval('.auction-row strong', (els) => els.map((e) => Number(e.textContent)));
ok(prices.join() === '28,31,60', `carte manquante « Tour Eiffel » : enchères du - au + cher ${prices.join(' → ')}`);
await market.waitForTimeout(300);
await market.screenshot({ path: join(shots, 'window-card-auctions.png') });
await ef.click('.auction-row button.primary');
await market.waitForURL(/\/marketplace\/cx1/, { timeout: 8000 });
ok(true, '« Ouvrir » amène sur la page de l\'enchère la moins chère');


// 13. Étiquetage par l'API : mêmes écritures que le site (user_card_tags), sans ouvrir les fiches
await sw.evaluate(async () => {
  const { settings } = await chrome.storage.local.get('settings');
  await chrome.storage.local.set({ settings: { ...settings, apiWrite: true } });
});
const planBefore = await sw.evaluate(async () => (await chrome.storage.local.get('cards')).cards['machu-picchu'].tags);
ok(planBefore.join() === '20-50', 'avant : Machu Picchu porte « 20-50 » dans la base');
await market.bringToFront();
const resApi = await sw.evaluate(async () => {
  const [tab] = await chrome.tabs.query({ url: 'https://www.wiki-masters.com/marketplace/cx1*' });
  return chrome.tabs.sendMessage(tab.id, { type: 'autoTag' });
});
ok(resApi?.ok, 'étiquetage par l\'API lancé (sans être sur la collection)');
s = await waitFor((x) => x.cards?.['machu-picchu']?.tags?.join() === '50-100' && x.cards?.['canis-lupus']?.tags?.join() === '20-50', 'étiquettes écrites puis relues', 12000);
ok(apiWrites.length <= 3 && apiWrites.every((w) => /user_card_tags|tags$/.test(w)), `${apiWrites.length} écriture(s) groupée(s), toutes sur les étiquettes : Machu Picchu → 50-100, Canis lupus → 20-50`);


// 14. Un onglet collection ouvert AVANT l'étiquetage par l'API garde d'anciennes étiquettes en mémoire :
//     sa relecture ne doit pas écraser les étiquettes rechargées via l'API.
const staleTab = await ctx.newPage();
await staleTab.goto(`${ORIGIN}/collection`);
await staleTab.waitForTimeout(1500);
await sw.evaluate(async () => {
  const { meta } = await chrome.storage.local.get('meta');
  await chrome.storage.local.set({ meta: { ...meta, lastCollectionApi: Date.now() + 1000, lastCollectionScan: Date.now() + 1000 } });
  const { cards } = await chrome.storage.local.get('cards');
  cards['machu-picchu'].tags = ['50-100'];
  await chrome.storage.local.set({ cards });
});
await staleTab.waitForTimeout(500);
await sw.evaluate(async () => {
  const [tab] = await chrome.tabs.query({ url: 'https://www.wiki-masters.com/collection*', active: true });
  await chrome.tabs.sendMessage(tab.id, { type: 'rescan' });
});
await staleTab.waitForTimeout(1500);
const afterStale = await sw.evaluate(async () => (await chrome.storage.local.get('cards')).cards['machu-picchu'].tags);
ok(afterStale.join() === '50-100', `page périmée relue : Machu Picchu garde « ${afterStale.join()} » (pas d'écrasement par « 20-50 »)`);


// 15. Onglet « Vendues » et bouton 🧰 Outils
await market.goto(`${ORIGIN}/collection`);
ef = await embedFrame(market);
ok(!(await ef.$('.tabs .tab:has-text("Outils")')) && !!(await ef.$('header button[title^="Outils"]')), 'Outils : bouton 🧰 en haut, plus dans les onglets');
await ef.click('header button[title^="Outils"]');
await ef.waitForSelector('.tools-title');
ok(true, '🧰 ouvre les outils');
s = await waitFor((x) => x.meta?.lastMarketFetch?.count > 0, 'ventes du marché chargées automatiquement', 10000);
ok(s.priceObs.some((o) => o.auctionId === 'm-R-0' && o.cardId === 'marche-r-0'), `ventes du marché chargées automatiquement via l'API (${s.meta.lastMarketFetch.count}), rattachées à leur carte`);
const priceBox = await ef.textContent('.price-status');
ok(/Ventes du marché \(API\) : 36 chargée/.test(priceBox) && /Rare\s*\d+/.test(priceBox), 'bilan des prix visible dans 🧰 Outils');
await (await ef.$('.price-status')).screenshot({ path: join(shots, 'price-status.png') });
await ef.click('.tabs .tab:has-text("Vendues")');
await ef.click('button[title="Relire mes ventes terminées"]');
await ef.waitForSelector('.bid', { timeout: 8000 });
const soldRows = await ef.$$eval('.bid', (els) => els.map((e) => e.textContent.replace(/\s+/g, ' ').trim()));
ok(soldRows.length === 2 && /Tour Eiffel.*66/.test(soldRows[0]) && /départ 40 → \+26 \(\+65 %\)/.test(soldRows[0]), `ventes : ${soldRows[0].slice(0, 70)}…`);
ok(/carte \(2 ventes\) 80 → -14 \(-17 %\)/.test(soldRows[0]), 'écart avec le prix de la carte (médiane de ses autres ventes)');
await market.waitForTimeout(300);
await market.screenshot({ path: join(shots, 'window-sold.png') });


// 16. Interrupteur sans texte (en haut, à côté des réglages) : libellés ⇄ pastilles
await market.goto(`${ORIGIN}/collection`);
ef = await embedFrame(market);
const sw0 = await ef.$eval('.tag-switch', (b) => ({ checked: b.getAttribute('aria-checked'), text: b.textContent.trim(), next: b.nextElementSibling?.title }));
ok(sw0.text === '' && sw0.next === 'Réglages', 'interrupteur sans texte, juste à côté des réglages');
await ef.click('.tag-switch');
await market.waitForFunction(() => document.querySelector('[data-wiky="tags"]')?.dataset.style === 'dot', null, { timeout: 5000 });
ok((await ef.$eval('.tag-switch', (b) => b.getAttribute('aria-checked'))) === 'true', 'clic : cartes en pastilles de couleur');
await (await ef.$('header')).screenshot({ path: join(shots, 'header-switch.png') });
await ef.click('.tag-switch');
await market.waitForFunction(() => document.querySelector('[data-wiky="tags"]')?.dataset.style === 'label', null, { timeout: 5000 });
ok(true, 'second clic : retour aux libellés');


// 17. Fenêtre de vente du site : résumé du marché sous « Marché · … » et liste des enchères de la carte dessous
await market.goto(`${ORIGIN}/collection`);
await market.waitForTimeout(1200);
await market.evaluate(() => {
  const li = [...document.querySelectorAll('li.card')].find((l) => l.querySelector('strong').textContent === 'Mont Fuji');
  li.querySelector('img').click();
});
await market.click('.fixed.inset-0 .sell');
await market.waitForSelector('[data-wiky="market-summary"]', { timeout: 8000 });
await market.waitForFunction(() => /offre/.test(document.querySelector('[data-wiky="market-summary"]')?.textContent ?? ''), null, { timeout: 8000 });
const summaryText = (await market.textContent('[data-wiky="market-summary"]')).replace(/\s+/g, ' ');
ok(/3 offres · min 28 · méd\. 31 · max 60/.test(summaryText), `résumé du marché sous « Marché · Rare » : ${summaryText.trim()}`);
await market.waitForFunction(() => document.querySelectorAll('[data-wiky="market-list"] a').length === 3, null, { timeout: 8000 });
const listPrices = await market.$$eval('[data-wiky="market-list"] a', (as) => as.map((a) => a.querySelector('span').textContent));
ok(listPrices.join() === '28,31,60', `liste des enchères de la carte sous la fenêtre : ${listPrices.join(' → ')}`);
await market.screenshot({ path: join(shots, 'sell-market.png') });

await sw.evaluate(async () => {
  const { settings } = await chrome.storage.local.get('settings');
  await chrome.storage.local.set({ settings: { ...settings, siteIntegration: true } });
});
// Mode enchère : interrupteur sur la ligne du titre, clic sur une carte → « Mettre aux enchères » pré-rempli.
const auc = await ctx.newPage();
await auc.setViewportSize({ width: 1280, height: 860 });
await auc.goto(`${ORIGIN}/collection`);
await auc.waitForSelector('[data-wiky="auction-switch"]', { timeout: 10000 });
await auc.click('[data-wiky="auction-switch"]');
ok((await auc.getAttribute('[data-wiky="auction-switch"]', 'aria-checked')) === 'true', 'mode enchère activé (interrupteur à côté du titre de la collection)');
await auc.waitForTimeout(1200);
await auc.click('li.card:has-text("Colisée") img');
const aucInput = await auc.waitForSelector('input[aria-label="Mise de départ"]', { timeout: 10000 });
await auc.waitForFunction(() => document.querySelector('input[aria-label="Mise de départ"]')?.value !== '10', null, { timeout: 5000 });
s = await storage();
const aucValue = await aucInput.inputValue();
ok(s.pendingFocus?.cardName === 'Colisée' && aucValue === String(s.pendingFocus.price), `clic sur Colisée : fenêtre de vente ouverte, mise ${aucValue} (durée ${s.pendingFocus.durationMin} min), le clic final reste le tien`);
await auc.waitForTimeout(500);
await auc.screenshot({ path: join(shots, 'auction-mode.png') });
await auc.keyboard.press('Escape');
await auc.close();

// Intégration au site : barre latérale compacte, résumé, fenêtres, pages, onglet dans Paramètres.
const integ = await ctx.newPage();
await integ.setViewportSize({ width: 1280, height: 860 });
await integ.goto(`${ORIGIN}/settings`);
await integ.waitForSelector('[data-wiky="nav-recap"] .wiky-status', { timeout: 10000 });
await integ.waitForTimeout(600);
const navText = await integ.$eval('[data-wiky="nav-recap"] .wiky-status', (e) => e.textContent.replace(/\s+/g, ' ').trim());
ok(/Slots ?\d+\/5/.test(navText), `résumé toujours visible : ${navText.slice(0, 90)}…`);
const social = await integ.$$eval('[data-group="social"] .wiky-group-items a', (as) => as.map((a) => a.textContent.trim()));
ok(social.join() === 'Échanges,Guilde,Amis,Messages,Bataille', `menu Social : ${social.join(', ')}`);
ok((await integ.$$eval('[role="tablist"] [role="tab"]', (t) => t.map((x) => x.textContent))).includes('Wiky-Traders'), 'onglet « Wiky-Traders » dans Paramètres');
const navOrder = await integ.$$eval('nav.w-64 > *', (els) => els.filter((e) => e.dataset.group || e.dataset.wiky === 'nav-recap' || (e.matches('a') && !e.hasAttribute('data-wiky-grouped'))).map((e) => e.dataset.group ?? (e.dataset.wiky === 'nav-recap' ? 'récap' : e.textContent.trim())));
ok(navOrder.join() === 'Paquets,collection,market,social,progress,récap,settings', `barre latérale : ${navOrder.join(' › ')}`);
await integ.click('[data-group="social"] .wiky-group-head');
await integ.click('[data-group="market"] .wiky-head-toggle');
await integ.setViewportSize({ width: 1280, height: 1500 });
await integ.waitForTimeout(400);
await integ.screenshot({ path: join(shots, 'site-sidebar.png'), clip: { x: 0, y: 0, width: 560, height: 1500 } });
await integ.setViewportSize({ width: 1280, height: 860 });
await integ.click('.wiky-status');
const modalFrame = await (await integ.waitForSelector('[data-wiky="modal"] iframe')).contentFrame();
await modalFrame.waitForSelector('.panel');
await integ.waitForTimeout(400);
ok(await modalFrame.evaluate(() => document.documentElement.classList.contains('site') && !document.querySelector('nav.tabs')), 'Vendre : fenêtre par-dessus la page, aux couleurs du site, sans les onglets de la popup');
await integ.screenshot({ path: join(shots, 'site-modal.png') });
await integ.keyboard.press('Escape');
await integ.click('[data-wiky="settings-entry"]');
await integ.waitForURL(/wiky=settings/);
const optFrame = await (await integ.waitForSelector('#wiky-page iframe')).contentFrame();
await optFrame.waitForSelector('section.card');
await integ.waitForTimeout(400);
ok(true, 'réglages Wiky-Traders dans la page Paramètres du site');
await integ.screenshot({ path: join(shots, 'site-settings.png') });
await integ.goto(`${ORIGIN}/collection?wiky=cards`);
const cardsFrame = await (await integ.waitForSelector('#wiky-page iframe')).contentFrame();
await cardsFrame.waitForSelector('.panel');
await integ.waitForTimeout(400);
ok(true, '« Cartes & prix » : page du site');
await integ.screenshot({ path: join(shots, 'site-page-cards.png') });

// Familles : import automatique des familles de « Prix moyen collection », page native du site.
await integ.evaluate((f) => localStorage.setItem('wm_families_v1', f), JSON.stringify(FAMILIES));
await integ.goto(`${ORIGIN}/collection?wiky=families`);
await integ.waitForSelector('.wf-tile', { timeout: 10000 });
const famTiles = await integ.$$eval('.wf-tile .wf-tile-name', (els) => els.map((e) => e.textContent.trim()));
ok(famTiles.includes('Merveilles du monde') && famTiles.includes('Animaux'), `familles importées depuis Prix moyen collection : ${famTiles.join(', ')}`);
await integ.waitForTimeout(500);
await integ.screenshot({ path: join(shots, 'families.png') });
await integ.click('.wf-tile[data-act="open"]');
await integ.waitForTimeout(800);
await integ.screenshot({ path: join(shots, 'family-detail.png') });

await ctx.close();
console.log(`\nCaptures enregistrées dans ${shots}`);
