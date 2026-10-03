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
// Ventes conclues récentes (onglet Historique) : médianes C 12, PC 20, R 35, SR 60, UR 150, L 400.
const SOLD = { C: [8, 10, 12, 12, 15, 30], PC: [15, 18, 20, 20, 25, 90], R: [25, 30, 35, 35, 40, 300], SR: [40, 50, 60, 60, 70, 900], UR: [100, 120, 150, 150, 200, 2000], L: [300, 350, 400, 400, 500, 5000] };
const TAG_DEFS = [{ id: 'tag-20-50', name: '20-50', color: '#22c55e' }, { id: 'tag-50-100', name: '50-100', color: '#f59e0b' }];
const RARITY = { C: ['Commun', 'commun'], PC: ['Peu Commun', 'peu_commun'], R: ['Rare', 'rare'], SR: ['Super Rare', 'super_rare'], UR: ['Ultra Rare', 'ultra_rare'], L: ['Légendaire', 'legendaire'] };
const slug = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-');

const CSS = `body{font-family:system-ui;background:#0f172a;color:#e2e8f0;margin:0}header{padding:12px 20px;background:#1e293b}
main{padding:20px}.grid{display:grid;grid-template-columns:repeat(6,150px);gap:14px;list-style:none;padding:0}
.card{background:#1e293b;border-radius:12px;padding:8px;font-size:12px}.card img{width:134px;height:90px;object-fit:cover;border-radius:8px;background:#334155;cursor:pointer}
.tab{background:#334155;color:#e2e8f0;border:0;border-radius:8px;padding:6px 10px;margin-right:6px}.tab.active{background:#f59e0b;color:#111}
.fixed.inset-0{position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:50}.card-frame{position:absolute;top:120px;left:300px;min-width:280px;background:#1e293b;padding:20px;border-radius:12px;box-shadow:0 10px 30px #000}
[role=menu]{position:fixed;top:200px;left:620px;background:#334155;padding:8px;border-radius:8px;z-index:60}
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
  d.innerHTML = '<div class="card-frame relative"><div role="tablist" aria-label="Vue de la carte"><button role="tab">Détails</button><button role="tab" aria-label="Étiquettes">Étiquettes</button></div><h2></h2><button type="button" class="sell">Mettre aux enchères</button></div>';
  d.querySelector('h2').textContent = uc.snapshot_title;
  d.querySelector('.sell').onclick = () => {
    const sell = document.createElement('div');
    sell.className = 'fixed inset-0 z-[60]';
    sell.innerHTML = '<div class="card-frame relative" style="left:340px;top:160px"><h2>Mettre aux enchères</h2><p></p><label>Mise de départ</label> <input type="number" inputmode="numeric" aria-label="Mise de départ" value="10"> <label>Durée</label> <button type="button" class="dur">10 min</button> <button type="button" class="dur">1 h</button> <button type="button" class="dur">3 h</button> <button type="button">Annuler</button> <button type="button" class="confirm">Mettre aux enchères</button></div>';
    sell.querySelector('p').textContent = uc.snapshot_title;
    sell.querySelector('.confirm').onclick = () => window.__confirmed++;
    window.__duration = '1 h';
    sell.querySelectorAll('.dur').forEach((b) => (b.onclick = () => (window.__duration = b.textContent)));
    document.body.append(sell);
  };
  d.querySelector('[aria-label="Étiquettes"]').addEventListener('pointerdown', () => {
    const m = document.createElement('div');
    m.setAttribute('role', 'menu');
    for (const def of TAG_DEFS) {
      const it = document.createElement('div');
      it.setAttribute('role', 'menuitemcheckbox');
      it.textContent = def.name;
      it.setAttribute('aria-checked', String(li.__props.tagIds.includes(def.id)));
      it.onclick = () => {
        const on = it.getAttribute('aria-checked') !== 'true';
        it.setAttribute('aria-checked', String(on));
        li.__props.tagIds = on ? [...li.__props.tagIds, def.id] : li.__props.tagIds.filter((x) => x !== def.id);
        attach(li, li.__props);
        li.querySelector('.chip').textContent = li.__props.tagIds.map(tagName).join(', ');
      };
      m.append(it);
    }
    document.body.append(m);
  });
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

const page = (title, body) => `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>${title}</title><style>${CSS}</style></head>
<body data-tags="${attr(TAG_DEFS)}"><header><a href="/collection">Collection</a> · <a href="/marketplace">Marché</a></header><main>${body}</main><script>${FAKE_REACT}</script></body></html>`;


const collection = () =>
  page(
    'Collection',
    `<h1>Ma collection</h1><ul class="grid">${CARDS.map(([name, r, qty, tag]) => {
      const uc = { id: `uc-${slug(name)}`, card_id: `c-${slug(name)}`, count: qty, starred: false, snapshot_title: name, snapshot_rarity: r, is_shiny: false };
      const tagIds = tag ? [`tag-${tag}`] : [];
      return `<li class="card" data-uc="${attr(uc)}" data-tags="${attr(tagIds)}"><img alt="${name}" src="/cards/${slug(name)}.jpg"><strong>${name}</strong><div class="chip">${tag}</div></li>`;
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
await ctx.route(`${ORIGIN}/**`, (route) => {
  const url = new URL(route.request().url());
  if (/\.(png|jpe?g)$/.test(url.pathname)) return route.fulfill({ body: png, contentType: 'image/png' });
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

// 2 bis. Fenêtre flottante dans la page
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
const panel = opened.locator('[data-wiky="panel"]');
await panel.waitFor({ state: 'attached', timeout: 5000 });
const panelText = await panel.evaluate((el) => el.shadowRoot.querySelector('.panel').textContent);
ok(/Prix conseillé/.test(panelText), `encart : ${panelText.replace(/\s+/g, ' ').slice(0, 90)}…`);
ok((await opened.locator('[data-wiky="badge"]').count()) > 0, 'pastilles sur les cartes vendables');
await opened.waitForTimeout(600);
await opened.screenshot({ path: join(shots, 'overlay.png') });

// 6. Fenêtre de mise en vente : l'encart affiche le prix de la carte affichée
await opened.evaluate(() => {
  const d = document.createElement('div');
  d.className = 'fixed inset-0 z-[60]';
  d.innerHTML = '<div class="card-frame relative"><h2>Mettre aux enchères</h2><p>Colisée</p><label>Mise de départ</label><input type="number" aria-label="Mise de départ"><button>Mettre aux enchères</button></div>';
  document.body.append(d);
});
await opened.waitForFunction(() => /étiquette 20-50/.test(document.querySelector('[data-wiky="panel"]')?.shadowRoot?.querySelector('.panel')?.textContent ?? ''), null, { timeout: 5000 });
const sellText = await panel.evaluate((el) => el.shadowRoot.querySelector('.panel').textContent);
ok(/Colisée/.test(sellText) && /médiane Rare 35 \(6 ventes\) × 70 % = 20/.test(sellText), 'prix conseillé dans la fenêtre de vente (médiane Rare 35 × 70 % = 20)');
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
await popup2.click('.tabs .tab:nth-child(3)');
await popup2.waitForSelector('.autotag');
const planText = await popup2.textContent('.autotag');
ok(/2 carte\(s\)/.test(planText), `plan d'étiquetage : ${planText.match(/Étiquetage auto : \d+ carte\(s\)/)?.[0]}`);
await popup2.click('.autotag summary');
await popup2.screenshot({ path: join(shots, 'popup-automations.png'), fullPage: true });

await popup2.click('.tabs .tab:nth-child(1)');
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
await tagPage.waitForFunction(() => /carte\(s\) étiquetée\(s\)/.test(document.querySelector('[data-wiky="panel"]')?.shadowRoot?.textContent ?? ''), null, { timeout: 30000 });
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
ok((await ef.$$('.tabs .tab')).length === 4, 'fenêtre en onglets : À vendre / En cours / Étiquettes / Outils');
await ef.click('.tabs .tab:nth-child(1)');
await ef.waitForSelector('.slot.free button.primary');
await ef.click('.slot.free button.primary');
await market.waitForURL(/\/collection/, { timeout: 8000 });
await market.waitForFunction(() => document.querySelector('input[aria-label="Mise de départ"]')?.value !== '10' && window.__duration !== '1 h', null, { timeout: 12000 });
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
await ef.click('.tabs .tab:nth-child(2)');
await market.waitForTimeout(400);
await market.screenshot({ path: join(shots, 'window-tabs.png') });

await ctx.close();
console.log(`\nCaptures enregistrées dans ${shots}`);
