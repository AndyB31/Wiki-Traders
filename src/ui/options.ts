import './common.css';
import './options.css';
import { quotaSum } from '../lib/allocation';
import { ext } from '../lib/browser';
import { DEFAULT_SETTINGS } from '../lib/defaults';
import { DURATIONS, overlappingDurations } from '../lib/duration';
import { clearAll, loadAll, save } from '../lib/storage';
import { formatPrice, RARITIES } from '../lib/text';
import type { Settings, StoreShape, TagRule } from '../lib/types';
import { DEFAULT_SELECTORS } from '../content/parsers/selectors';
import { downloadJson, fmtDate, h, mount } from './dom';

const app = document.getElementById('app')!;
let store: StoreShape;
let rules: TagRule[] = [];
let settings: Settings;
let manualPrices: Record<string, number> = {};
let status: HTMLElement;
let quotaInfo: HTMLElement;

function num(v: string, fallback: number | null = null): number | null {
  if (v.trim() === '') return fallback;
  const n = Number(v.replace(',', '.'));
  return Number.isFinite(n) ? n : fallback;
}

function validate(): string | null {
  const sum = quotaSum(rules);
  quotaInfo.textContent = `Somme des quotas : ${sum} / ${settings.slots} slots`;
  quotaInfo.className = sum > settings.slots ? 'error' : 'muted';
  if (sum > settings.slots) return `La somme des quotas (${sum}) dépasse le nombre de slots (${settings.slots}).`;
  const tags = rules.map((r) => r.tag.trim().toLowerCase());
  if (tags.some((t) => !t)) return 'Chaque règle doit avoir une étiquette.';
  if (new Set(tags).size !== tags.length) return 'Deux règles ont la même étiquette.';
  for (const [i, d] of settings.durationRules.entries()) {
    if (d.from != null && d.to != null && d.from > d.to) return `Palier de durée ${i + 1} : « de » dépasse « à ».`;
  }
  const overlap = overlappingDurations(settings.durationRules);
  if (overlap) return `Les paliers de durée ${overlap[0] + 1} et ${overlap[1] + 1} se chevauchent.`;
  for (const r of rules) {
    if (r.floor != null && r.ceiling != null && r.floor > r.ceiling) return `« ${r.tag} » : le plancher dépasse le plafond.`;
    if (r.pct <= 0) return `« ${r.tag} » : le % doit être positif.`;
  }
  return null;
}

function setStatus(text: string, kind: 'ok' | 'error' | 'muted' = 'muted'): void {
  status.textContent = text;
  status.className = kind;
}

function onEdit(): void {
  const err = validate();
  setStatus(err ?? 'Modifications non enregistrées', err ? 'error' : 'muted');
}

function ruleRow(rule: TagRule) {
  const bind = <K extends keyof TagRule>(key: K, parse: (v: string) => TagRule[K]) => (e: Event) => {
    const t = e.target as HTMLInputElement;
    rule[key] = parse(t.type === 'checkbox' ? String(t.checked) : t.value);
    onEdit();
  };
  return h(
    'tr',
    null,
    h('td', null, h('input', { value: rule.tag, placeholder: '20-50', oninput: bind('tag', (v) => v) })),
    h('td', null, h('input', { type: 'number', min: '0', value: rule.quota, oninput: bind('quota', (v) => num(v, 0)!) })),
    h('td', null, h('input', { type: 'number', min: '1', max: '500', value: rule.pct, oninput: bind('pct', (v) => num(v, 0)!) }), ' %'),
    h('td', null, h('input', { type: 'number', min: '0', value: rule.floor ?? '', oninput: bind('floor', (v) => num(v)) })),
    h('td', null, h('input', { type: 'number', min: '0', value: rule.ceiling ?? '', oninput: bind('ceiling', (v) => num(v)) })),
    h('td', null, h('input', { type: 'number', min: '0', value: rule.keepMin, oninput: bind('keepMin', (v) => num(v, 1)!) })),
    h(
      'td',
      null,
      h(
        'select',
        { onchange: bind('match', (v) => v as TagRule['match']) },
        h('option', { value: 'tag', selected: rule.match === 'tag' }, 'étiquette du site'),
        h('option', { value: 'price', selected: rule.match === 'price' }, 'plage de prix moyen'),
      ),
    ),
    h('td', null, h('input', { type: 'checkbox', checked: rule.active, onchange: bind('active', (v) => v === 'true') })),
    h(
      'td',
      null,
      h(
        'button',
        {
          class: 'danger',
          title: 'Supprimer',
          onclick: () => {
            rules = rules.filter((r) => r !== rule);
            render();
            onEdit();
          },
        },
        '✕',
      ),
    ),
  );
}

/** Étiquettes vues dans la collection et pas encore couvertes par une règle. */
function detectedTagsBlock() {
  const counts = new Map<string, number>();
  for (const c of Object.values(store.cards)) for (const t of c.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
  const missing = [...counts.entries()].filter(([t]) => !rules.some((r) => r.tag.trim().toLowerCase() === t.toLowerCase()));
  if (!missing.length) return null;
  return h(
    'div',
    { class: 'row detected' },
    h('span', { class: 'muted small' }, 'Étiquettes de ta collection :'),
    missing.map(([tag, n]) =>
      h(
        'button',
        {
          class: 'small',
          title: 'Ajouter une règle pour cette étiquette (garder 0 : l\'étiquette désigne les cartes à vendre)',
          onclick: () => {
            rules.push({ id: `r-${Date.now()}`, tag, quota: 1, pct: 100, floor: null, ceiling: null, keepMin: 0, active: true, match: 'tag' });
            render();
            onEdit();
          },
        },
        `+ ${tag} (${n})`,
      ),
    ),
  );
}

function field(label: string, input: HTMLElement, help?: string) {
  return h('label', { class: 'field' }, h('span', null, label), input, help ? h('span', { class: 'muted small' }, help) : null);
}

function settingsForm() {
  const s = settings;
  const set = <K extends keyof Settings>(key: K, parse: (v: string) => Settings[K]) => (e: Event) => {
    const t = e.target as HTMLInputElement;
    s[key] = parse(t.type === 'checkbox' ? String(t.checked) : t.value);
    onEdit();
  };
  return h(
    'div',
    { class: 'grid' },
    field('Nombre de slots', h('input', { type: 'number', min: '1', max: '50', value: s.slots, oninput: set('slots', (v) => num(v, 5)!) })),
    field('Fenêtre du prix moyen (jours)', h('input', { type: 'number', min: '1', max: '90', value: s.windowDays, oninput: set('windowDays', (v) => num(v, 7)!) })),
    field(
      'Statistique',
      h(
        'select',
        { onchange: set('stat', (v) => v as Settings['stat']) },
        h('option', { value: 'mean', selected: s.stat === 'mean' }, 'moyenne'),
        h('option', { value: 'median', selected: s.stat === 'median' }, 'médiane (résiste aux ventes aberrantes)'),
      ),
    ),
    field(
      'Arrondi',
      h('input', { type: 'number', min: '0', value: s.rounding, oninput: set('rounding', (v) => num(v, 0)!) }),
      '0 = automatique (unité sous 20, 5 sous 100, 10 sous 1 000) ; ex. 10 → 63 devient 60',
    ),
    field(
      'À doublons égaux, proposer',
      h(
        'select',
        {
          onchange: (e: Event) => {
            s.sortPrice = (e.target as HTMLSelectElement).value as Settings['sortPrice'];
            if (s.sortPrice === 'random') s.randomSeed = Date.now() % 2_147_483_647;
            onEdit();
          },
        },
        h('option', { value: 'desc', selected: s.sortPrice === 'desc' }, 'le prix le plus haut'),
        h('option', { value: 'asc', selected: s.sortPrice === 'asc' }, 'le prix le plus bas (écouler)'),
        h('option', { value: 'random', selected: s.sortPrice === 'random' }, 'aléatoire'),
      ),
    ),
    field(
      'Étiquette de secours',
      h(
        'select',
        { onchange: set('fallbackTag', (v) => v || null) },
        h('option', { value: '' }, '— aucune —'),
        rules.map((r) => h('option', { value: r.tag, selected: r.tag === s.fallbackTag }, r.tag)),
      ),
      'utilisée quand une étiquette n\'a plus de carte vendable',
    ),
    field('Proposer une carte déjà en vente', h('input', { type: 'checkbox', checked: s.allowDuplicateListing, onchange: set('allowDuplicateListing', (v) => v === 'true') })),
    field('Compter les enchères en cours dans le prix moyen', h('input', { type: 'checkbox', checked: s.includeListings, onchange: set('includeListings', (v) => v === 'true') }), 'par défaut, seules les ventes terminées comptent'),
    field('Notifications', h('input', { type: 'checkbox', checked: s.notifications, onchange: set('notifications', (v) => v === 'true') })),
    field('Étiquettes visibles sur les cartes', h('input', { type: 'checkbox', checked: s.showTagOverlay, onchange: set('showTagOverlay', (v) => v === 'true') }), 'sur chaque carte de la collection, aux couleurs du site'),
    field(
      'Style des étiquettes sur les cartes',
      h(
        'select',
        { onchange: set('tagOverlayStyle', (v) => v as Settings['tagOverlayStyle']) },
        h('option', { value: 'label', selected: s.tagOverlayStyle === 'label' }, 'libellés détaillés'),
        h('option', { value: 'dot', selected: s.tagOverlayStyle === 'dot' }, 'pastilles de couleur seulement'),
      ),
      'pastilles : nom de l\'étiquette au survol',
    ),
    field(
      'Heures silencieuses',
      h(
        'span',
        { class: 'row' },
        h('input', { type: 'time', value: s.quietStart ?? '', oninput: set('quietStart', (v) => v || null) }),
        '→',
        h('input', { type: 'time', value: s.quietEnd ?? '', oninput: set('quietEnd', (v) => v || null) }),
      ),
    ),
    field('Page « mes enchères »', h('input', { value: s.myAuctionsPath ?? '', placeholder: 'auto (onglet « Mes ventes » de /marketplace)', oninput: set('myAuctionsPath', (v) => v.trim() || null) }), 'chemin, ex. /marketplace?tab=mine'),
    field('Page ouverte par « Ouvrir »', h('input', { value: s.sellPath, oninput: set('sellPath', (v) => v.trim() || DEFAULT_SETTINGS.sellPath) })),
  );
}

/** Bascule avec confirmation pour les automatisations interdites par les règles du site. */
function riskyToggle(key: 'prefill' | 'autoTag' | 'apiRead' | 'apiWrite', label: string, help: string) {
  return field(
    label,
    h('input', {
      type: 'checkbox',
      checked: settings[key],
      onchange: (e: Event) => {
        const box = e.target as HTMLInputElement;
        if (box.checked && !confirm(`${label}\n\nLes règles de WikiMasters (section 3) interdisent les outils qui interagissent à ta place : ton compte peut être banni sans préavis.\n\nActiver quand même ?`)) {
          box.checked = false;
          return;
        }
        settings[key] = box.checked;
        onEdit();
      },
    }),
    help,
  );
}

function automationBlock() {
  return h(
    'div',
    null,
    h(
      'p',
      { class: 'warn small' },
      '⚠️ Ces options simulent des clics sur le site. Les règles de WikiMasters (section 3) et ses conditions (section 6) les interdisent : risque de bannissement définitif avec perte des cartes. Désactivées par défaut, à tes risques.',
    ),
    h(
      'div',
      { class: 'grid' },
      riskyToggle('prefill', 'V4 – Ouvrir la vente et pré-remplir le prix', '« Ouvrir » ouvre la carte, sa fenêtre de vente et remplit le prix. Le clic « Mettre en vente » reste toujours à toi.'),
      riskyToggle('apiRead', 'Lecture via l\'API du site', 'Onglet « Mises » (enchères où tu as misé, prix des cartes) et chargement des ventes du marché. Lectures seules, avec ta session.'),
      riskyToggle('apiWrite', 'Étiquetage par l\'API (plus fiable)', 'L\'étiquetage automatique écrit directement les étiquettes, comme le fait le site (table user_card_tags), au lieu de cliquer dans la fiche de chaque carte. Écritures limitées aux étiquettes ; favoris revérifiés avant chaque écriture.'),
      field(
        'Fenêtre de vente : résumé du marché',
        h('input', { type: 'checkbox', checked: settings.sellMarketSummary, onchange: (e: Event) => ((settings.sellMarketSummary = (e.target as HTMLInputElement).checked), onEdit()) }),
        'sous « Marché · … » : nombre d\'offres en cours, min, médiane, max (nécessite la lecture via l\'API)',
      ),
      field(
        'Fenêtre de vente : liste des enchères de la carte',
        h('input', { type: 'checkbox', checked: settings.sellMarketList, onchange: (e: Event) => ((settings.sellMarketList = (e.target as HTMLInputElement).checked), onEdit()) }),
        'sous la fenêtre : enchères en cours de cette carte, prix et durée restante (nécessite la lecture via l\'API)',
      ),
      riskyToggle('autoTag', 'Étiquetage automatique sur le site', 'Range chaque carte dans l\'étiquette dont la plage plancher–plafond contient son prix moyen. Lancé depuis la popup, sur la collection, avec bouton Arrêter.'),
      field(
        'Retirer les autres étiquettes gérées',
        h('input', {
          type: 'checkbox',
          checked: settings.autoTagRemoveOthers,
          onchange: (e: Event) => ((settings.autoTagRemoveOthers = (e.target as HTMLInputElement).checked), onEdit()),
        }),
        'ex. une carte passée à 60 perd « 20-50 » et reçoit « 50-100 »',
      ),
    ),
  );
}

/** Paliers de durée : prix de départ entre « de » et « à » → durée de l'enchère. */
function durationBlock() {
  const rows = settings.durationRules;
  const set = (i: number, key: 'from' | 'to' | 'minutes', v: number | null) => {
    rows[i] = { ...rows[i], [key]: v };
    onEdit();
  };
  return h(
    'div',
    null,
    h('p', { class: 'muted small' }, 'Durée de l\'enchère selon la mise de départ conseillée. Le premier palier qui correspond l\'emporte ; sans palier, la durée par défaut du site (1 h) est gardée. Affichée avec chaque proposition, et choisie automatiquement avec la V4.'),
    rows.length
      ? h(
          'table',
          { class: 'durations' },
          h('tr', null, ['Mise de', 'à', 'Durée', ''].map((t) => h('th', null, t))),
          rows.map((r, i) =>
            h(
              'tr',
              null,
              h('td', null, h('input', { type: 'number', min: '0', value: r.from ?? '', placeholder: '0', oninput: (e: Event) => set(i, 'from', num((e.target as HTMLInputElement).value)) })),
              h('td', null, h('input', { type: 'number', min: '0', value: r.to ?? '', placeholder: '∞', oninput: (e: Event) => set(i, 'to', num((e.target as HTMLInputElement).value)) })),
              h(
                'td',
                null,
                h(
                  'select',
                  { onchange: (e: Event) => set(i, 'minutes', Number((e.target as HTMLSelectElement).value)) },
                  DURATIONS.map((d) => h('option', { value: d.minutes, selected: d.minutes === r.minutes }, d.label)),
                ),
              ),
              h('td', null, h('button', { class: 'danger', title: 'Supprimer', onclick: () => (rows.splice(i, 1), render(), onEdit()) }, '✕')),
            ),
          ),
        )
      : null,
    h(
      'div',
      { class: 'row', style: 'margin-top:8px' },
      h(
        'button',
        {
          onclick: () => {
            const last = rows[rows.length - 1];
            const from = last?.to != null ? last.to + 1 : last ? null : 0;
            rows.push({ from, to: null, minutes: 60 });
            render();
            onEdit();
          },
        },
        '+ Ajouter un palier',
      ),
      rows.length
        ? null
        : h(
            'button',
            {
              title: 'Exemple : petites mises en 10 min, moyennes en 1 h, grosses en 3 h',
              onclick: () => {
                settings.durationRules = [
                  { from: 0, to: 20, minutes: 10 },
                  { from: 21, to: 100, minutes: 60 },
                  { from: 101, to: null, minutes: 180 },
                ];
                render();
                onEdit();
              },
            },
            'Exemple (≤ 20 : 10 min, 21–100 : 1 h, > 100 : 3 h)',
          ),
    ),
  );
}

function blacklistBlock() {
  return h(
    'div',
    null,
    h('textarea', {
      rows: 4,
      placeholder: 'Une carte par ligne (nom ou identifiant)',
      value: settings.blacklist.join('\n'),
      oninput: (e: Event) => {
        settings.blacklist = (e.target as HTMLTextAreaElement).value.split('\n').map((l) => l.trim()).filter(Boolean);
        onEdit();
      },
    }),
    h('div', { class: 'muted small' }, 'Les cartes épinglées en favori ne sont jamais proposées non plus.'),
  );
}

function manualPricesBlock() {
  const entries = Object.entries(manualPrices);
  if (!entries.length) return h('p', { class: 'muted' }, 'Aucun prix saisi. La popup te demande un prix quand une carte n\'a aucune donnée.');
  return h(
    'table',
    null,
    h('tr', null, h('th', null, 'Carte'), h('th', null, 'Prix moyen saisi'), h('th', null, '')),
    entries.map(([id, price]) =>
      h(
        'tr',
        null,
        h('td', null, store.cards[id]?.name ?? id),
        h('td', null, h('input', { type: 'number', value: price, oninput: (e: Event) => ((manualPrices[id] = num((e.target as HTMLInputElement).value, price)!), onEdit()) })),
        h('td', null, h('button', { class: 'danger', onclick: () => (delete manualPrices[id], render(), onEdit()) }, '✕')),
      ),
    ),
  );
}

function cardsBlock() {
  const cards = Object.values(store.cards).sort((a, b) => a.name.localeCompare(b.name));
  return h(
    'details',
    null,
    h('summary', null, `${cards.length} carte(s) connue(s) · dernier relevé de la collection : ${fmtDate(store.meta.lastCollectionScan)}`),
    h(
      'table',
      { class: 'small' },
      h('tr', null, ['Carte', 'Rareté', 'Qté', 'Étiquettes', 'Prix site', 'Favori'].map((t) => h('th', null, t))),
      cards.map((c) =>
        h(
          'tr',
          null,
          h('td', null, c.name),
          h('td', null, c.rarity ? RARITIES[c.rarity].label : '—'),
          h('td', null, c.quantity),
          h('td', null, c.tags.join(', ') || '—'),
          h('td', null, formatPrice(c.sitePrice)),
          h('td', null, c.favorite ? '★' : ''),
        ),
      ),
    ),
  );
}

function selectorsBlock() {
  const area = h('textarea', {
    rows: 8,
    class: 'mono',
    value: Object.keys(settings.selectorOverrides).length ? JSON.stringify(settings.selectorOverrides, null, 2) : '',
    placeholder: '{\n  "cardTile": "[data-card]"\n}',
    oninput: (e: Event) => {
      const v = (e.target as HTMLTextAreaElement).value.trim();
      try {
        settings.selectorOverrides = v ? JSON.parse(v) : {};
        area.classList.remove('invalid');
        onEdit();
      } catch {
        area.classList.add('invalid');
        setStatus('JSON des sélecteurs invalide', 'error');
      }
    },
  });
  return h(
    'details',
    null,
    h('summary', null, 'Sélecteurs avancés (si le site change)'),
    h('p', { class: 'muted small' }, 'Surcharge les sélecteurs CSS / motifs utilisés pour lire le site. Valeurs par défaut :'),
    h('pre', { class: 'mono small defaults' }, JSON.stringify(DEFAULT_SELECTORS, null, 2)),
    area,
  );
}

async function saveAll(): Promise<void> {
  const err = validate();
  if (err) return setStatus(err, 'error');
  rules = rules.map((r) => ({ ...r, tag: r.tag.trim() }));
  await save({ rules, settings, manualPrices });
  await ext.runtime.sendMessage({ type: 'refreshBadge' }).catch(() => {});
  setStatus(`Enregistré à ${new Date().toLocaleTimeString('fr-FR')}`, 'ok');
}

function exportSettings(): void {
  downloadJson(`wiky-traders-reglages-${new Date().toISOString().slice(0, 10)}.json`, { version: 1, rules, settings, manualPrices });
}

async function importSettings(file: File): Promise<void> {
  try {
    const data = JSON.parse(await file.text());
    if (!Array.isArray(data.rules) || typeof data.settings !== 'object') throw new Error('format');
    rules = data.rules;
    settings = { ...DEFAULT_SETTINGS, ...data.settings };
    manualPrices = data.manualPrices ?? {};
    render();
    await saveAll();
  } catch {
    setStatus('Fichier de réglages invalide.', 'error');
  }
}

async function wipe(): Promise<void> {
  if (!confirm('Effacer toutes les données de Wiky-Traders (règles, cartes, historique, journal) ?')) return;
  await clearAll();
  await load();
  setStatus('Toutes les données ont été effacées.', 'ok');
}

function render(): void {
  status = h('span', { class: 'muted' });
  quotaInfo = h('span', { class: 'muted' });
  const fileInput = h('input', {
    type: 'file',
    accept: 'application/json',
    style: 'display:none',
    onchange: (e: Event) => {
      const f = (e.target as HTMLInputElement).files?.[0];
      if (f) void importSettings(f);
    },
  });
  mount(
    app,
    h('header', { class: 'row' }, h('img', { src: 'icons/icon-48.png', width: 32, height: 32, alt: '' }), h('h1', { class: 'grow' }, 'Wiky-Traders – Réglages'), h('a', { href: 'journal.html' }, 'Journal →')),
    h(
      'section',
      { class: 'card' },
      h('h2', null, 'Règles par étiquette'),
      h('p', { class: 'muted small' }, 'Chaque étiquette occupe en permanence son quota de slots ; le prix conseillé est le prix de référence × le %. Le plancher et le plafond définissent la plage de prix de l\'étiquette : ils servent uniquement à l\'étiquetage automatique (et aux règles « plage de prix »), pas au prix conseillé. « Garder » = exemplaires jamais proposés à la vente.'),
      h(
        'table',
        { class: 'rules' },
        h('tr', null, ['Étiquette', 'Quota', '% du prix moyen', 'Plancher', 'Plafond', 'Garder', 'Appartenance', 'Active', ''].map((t) => h('th', null, t))),
        rules.map(ruleRow),
      ),
      h(
        'div',
        { class: 'row', style: 'margin-top:8px' },
        h(
          'button',
          {
            onclick: () => {
              rules.push({ id: `r-${Date.now()}`, tag: '', quota: 1, pct: 70, floor: null, ceiling: null, keepMin: 1, active: true, match: 'tag' });
              render();
              onEdit();
            },
          },
          '+ Ajouter une étiquette',
        ),
        h('span', { class: 'grow' }),
        quotaInfo,
      ),
      detectedTagsBlock(),
    ),
    h('section', { class: 'card' }, h('h2', null, 'Prix et notifications'), settingsForm()),
    h('section', { class: 'card' }, h('h2', null, 'Durée des enchères'), durationBlock()),
    h('section', { class: 'card' }, h('h2', null, 'Liste noire'), blacklistBlock()),
    h('section', { class: 'card' }, h('h2', null, 'Automatisations'), automationBlock()),
    h('section', { class: 'card' }, h('h2', null, 'Prix saisis à la main'), manualPricesBlock()),
    h('section', { class: 'card' }, h('h2', null, 'Données'), cardsBlock(), selectorsBlock()),
    h(
      'footer',
      { class: 'row sticky' },
      h('button', { class: 'primary', onclick: saveAll }, 'Enregistrer'),
      status,
      h('span', { class: 'grow' }),
      h('button', { onclick: exportSettings }, 'Exporter (JSON)'),
      h('button', { onclick: () => fileInput.click() }, 'Importer'),
      fileInput,
      h('button', { class: 'danger', onclick: wipe }, 'Effacer toutes les données'),
    ),
  );
  validate();
}

async function load(): Promise<void> {
  store = await loadAll();
  rules = structuredClone(store.rules);
  settings = structuredClone(store.settings);
  manualPrices = { ...store.manualPrices };
  render();
}

void load();
