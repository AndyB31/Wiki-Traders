import './common.css';
import './options.css';
import { ext } from '../lib/browser';
import { DEFAULT_RULES, DEFAULT_SETTINGS, SITE_ORIGIN } from '../lib/defaults';
import { DURATIONS } from '../lib/duration';
import { clearAll, loadAll, migrateRules, migrateSettings, save } from '../lib/storage';
import { formatPrice, RARITIES } from '../lib/text';
import { conditionsSummary, EMPTY_CONDITIONS } from '../lib/conditions';
import { FORMULA_VARS, formulaError } from '../lib/formula';
import { DEFAULT_RATE_TIERS, pricePctLabel } from '../lib/sellrate';
import { DEFAULT_CRITERIA, SORT_KEYS } from '../lib/sorting';
import type { CandidateSort, DurationRule, SellRateRule, Settings, SortCriterion, SortKey, StoreShape, TagRule } from '../lib/types';
import { DEFAULT_SELECTORS } from '../content/parsers/selectors';
import { downloadJson, fmtDate, h, mount } from './dom';
import { updatePanel } from './update-panel';
import { embedded, initEmbed } from './embed';
import { FEATURE_GROUPS, FEATURES, featureFlags, type FeatureDef, type FeatureGroup, type FeatureKey } from '../lib/features';
import {
  DEFAULT_DURATION_TIERS,
  isDirty,
  nextTier,
  pctExample,
  quickStartChecks,
  quotaSummary,
  rateTierExample,
  roundingExamples,
  snapshot,
  tiersPreviewParts,
  validateOptions,
  type OptionsSection,
  type QuickCheck,
  type ValidationError,
} from './options-logic';

// Onglet Wiki-Traders de la page Paramètres du site (iframe).
initEmbed();

const app = document.getElementById('app')!;
let store: StoreShape;
let rules: TagRule[] = [];
let settings: Settings;
let manualPrices: Record<string, number> = {};
/** État enregistré (pour savoir s'il reste des modifications). */
let baseline = '';
/** État d'avant la dernière série de modifications : « Annuler » y revient. */
let undoPoint: string | null = null;
let saveTimer: ReturnType<typeof setTimeout> | undefined;
let selectorsInvalid = false;
let errors: ValidationError[] = [];
/** Message ponctuel (enregistré, importé…) affiché tant qu'aucune modification ne suit. */
let notice: { text: string; kind: 'ok' | 'error' } | null = null;
let idSeq = 0;

/** Délai d'enregistrement automatique après la dernière saisie. */
const AUTOSAVE_MS = 500;

const RISK_TEXT = 'Les règles de WikiMasters (section 3) interdisent les outils qui interagissent à ta place : ton compte peut être banni sans préavis.';

// ---------------------------------------------------------------------------
// Onglets
// ---------------------------------------------------------------------------

type TabId = 'accueil' | 'ventes' | 'etiquettes' | 'site' | 'acces' | 'avance';

const TABS: [id: TabId, label: string][] = [
  ['accueil', 'Accueil'],
  ['ventes', 'Ventes'],
  ['etiquettes', 'Étiquettes'],
  ['site', 'Sur le site'],
  ['acces', 'Accès au site'],
  ['avance', 'Avancé'],
];

const TAB_KEY = 'wiky-options-tab';

function readTab(): TabId {
  try {
    const t = localStorage.getItem(TAB_KEY);
    if (TABS.some(([id]) => id === t)) return t as TabId;
  } catch {
    // Stockage indisponible : premier onglet.
  }
  return 'accueil';
}

let activeTab: TabId = readTab();

// Nœuds mis à jour sans tout redessiner (pas de re-rendu complet à chaque frappe).
const ui = {
  status: null as unknown as HTMLElement,
  undoBtn: null as unknown as HTMLButtonElement,
  quick: null as unknown as HTMLElement,
  profiles: null as unknown as HTMLElement,
  access: null as unknown as HTMLElement,
  quota: null as unknown as HTMLElement,
  rules: null as unknown as HTMLElement,
  tagRules: null as unknown as HTMLElement,
  durations: null as unknown as HTMLElement,
  rateTiers: null as unknown as HTMLElement,
  criteria: null as unknown as HTMLElement,
  tiers: null as unknown as HTMLElement,
  manual: null as unknown as HTMLElement,
  rounding: null as unknown as HTMLElement,
  autoTagMode: null as unknown as HTMLElement,
  fallback: null as unknown as HTMLSelectElement,
  fallbackKey: '',
  tabs: new Map<TabId, { button: HTMLButtonElement; panel: HTMLElement }>(),
  /** Encadrés d'erreurs : une section peut en avoir un (les erreurs « rules » vont dans Ventes et dans Étiquettes). */
  errorBoxes: [] as { key: OptionsSection; box: HTMLElement }[],
  /** Champs repérés par clé (« slots », « rule:<id>:tag »…) pour y afficher les erreurs. */
  fields: new Map<string, HTMLElement>(),
  pctExamples: new Map<TagRule, HTMLElement>(),
  rateExamples: [] as { el: HTMLElement; row: () => SellRateRule | undefined }[],
  /** Champs « nom de l'étiquette » (onglets Ventes et Étiquettes), tenus synchronisés. */
  tagInputs: new Map<string, HTMLInputElement[]>(),
  /** Mentions « nécessite … », visibles seulement quand l'accès manque. */
  needs: [] as { el: HTMLElement; key: AccessKey }[],
  /** Interrupteurs des réglages à risque (un profil ou l'accueil peut les changer). */
  risky: {} as Partial<Record<RiskyKey, HTMLInputElement>>,
  /** Champs grisés selon un autre réglage. */
  dependents: [] as { el: HTMLInputElement | HTMLSelectElement; enabled: () => boolean }[],
};

type RiskyKey = 'prefill' | 'autoTag' | 'apiRead' | 'apiWrite';
type AccessKey = 'apiRead' | 'apiWrite';

function num(v: string, fallback: number | null = null): number | null {
  if (v.trim() === '') return fallback;
  const n = Number(v.replace(',', '.'));
  return Number.isFinite(n) ? n : fallback;
}

function newId(): string {
  return `r-${Date.now()}-${++idSeq}`;
}

function reg<T extends HTMLElement>(key: string, el: T): T {
  ui.fields.set(key, el);
  return el;
}

// ---------------------------------------------------------------------------
// Petits composants : aide « ? », interrupteur, champ
// ---------------------------------------------------------------------------

/** Petit « ? » : infobulle au survol, texte dépliable au clic (utile au clavier et sur mobile). */
function hint(text: string) {
  const pop = h('span', { class: 'hint-pop', hidden: true, role: 'note' }, text);
  const btn = h(
    'button',
    {
      type: 'button',
      class: 'hint',
      title: text,
      'aria-label': `Aide : ${text}`,
      'aria-expanded': 'false',
      onclick: (e: Event) => {
        e.preventDefault();
        pop.hidden = !pop.hidden;
        btn.setAttribute('aria-expanded', String(!pop.hidden));
      },
    },
    '?',
  );
  return h('span', { class: 'hint-wrap' }, btn, pop);
}

/** Case à cocher présentée en interrupteur (reste une vraie case : clavier, lecteurs d'écran). */
function switchInput(checked: boolean, onchange: (box: HTMLInputElement) => void, label?: string) {
  return h('input', {
    type: 'checkbox',
    role: 'switch',
    class: 'switch',
    checked,
    'aria-label': label,
    onchange: (e: Event) => onchange(e.target as HTMLInputElement),
  });
}

type Child = Node | string | null | false | undefined;

function toggleField(label: string, checked: boolean, onchange: (box: HTMLInputElement) => void, help?: string, extra: Child[] = [], cls = '') {
  return h(
    'label',
    { class: `toggle ${cls}`.trim() },
    switchInput(checked, onchange),
    h('span', { class: 'toggle-text' }, h('span', { class: 'toggle-label' }, label, ...extra), help ? h('span', { class: 'muted small' }, help) : null),
  );
}

/** Interrupteur lié à un réglage booléen. */
function settingToggle(key: { [K in keyof Settings]: Settings[K] extends boolean ? K : never }[keyof Settings], label: string, help?: string, extra: Child[] = []) {
  return toggleField(label, settings[key], (box) => ((settings[key] = box.checked), onEdit()), help, extra);
}

function field(label: string, input: HTMLElement, help?: string | HTMLElement, hintText?: string) {
  return h(
    'label',
    { class: 'field' },
    h('span', { class: 'field-label' }, label, hintText ? hint(hintText) : null),
    input,
    help ? (typeof help === 'string' ? h('span', { class: 'muted small' }, help) : help) : null,
  );
}


const ACCESS_LABEL: Record<AccessKey, string> = {
  apiRead: 'la lecture via l\'API',
  apiWrite: 'l\'étiquetage par l\'API',
};

/** « Nécessite la lecture via l'API — Activer… » : visible tant que l'accès manque, activable sur place. */
function needs(key: AccessKey) {
  const el = h(
    'span',
    { class: 'need small', hidden: settings[key] },
    `⚠ Nécessite ${ACCESS_LABEL[key]}. `,
    h('button', { type: 'button', class: 'link', onclick: (e: Event) => (e.preventDefault(), void setAccess(key === 'apiWrite' ? 'write' : 'read')) }, 'Activer…'),
  );
  ui.needs.push({ el, key });
  return el;
}

/** Ajoute une mention « nécessite … » sous le texte d'un interrupteur. */
function withNeed(el: HTMLElement, key: AccessKey | undefined): HTMLElement {
  if (key) el.querySelector('.toggle-text')?.append(needs(key));
  return el;
}

function dependent<T extends HTMLInputElement | HTMLSelectElement>(el: T, enabled: () => boolean): T {
  ui.dependents.push({ el, enabled });
  el.disabled = !enabled();
  return el;
}


function section(id: string, title: string, intro: Child | Child[], body: (Child | Child[])[], opts: { errKey?: OptionsSection; cls?: string } = {}) {
  return h(
    'section',
    { class: `card opt-section ${opts.cls ?? ''}`.trim(), id },
    h('h2', null, title),
    intro ? h('p', { class: 'intro' }, ...[intro].flat()) : null,
    opts.errKey ? errorBox(opts.errKey) : null,
    ...body,
  );
}

/** Bloc replié « Réglages fins » : ce que la plupart des joueurs n'ont jamais besoin de toucher. */
function fine(summary: string, ...body: (Child | Child[])[]) {
  return h('details', { class: 'fine' }, h('summary', null, summary), h('div', { class: 'fine-body' }, ...body));
}

function errorBox(key: OptionsSection) {
  const box = h('div', { class: 'section-errors', role: 'alert', hidden: true });
  ui.errorBoxes.push({ key, box });
  return box;
}

function showTab(id: TabId, focus = false): void {
  activeTab = id;
  try {
    localStorage.setItem(TAB_KEY, id);
  } catch {
    // Préférence d'affichage seulement.
  }
  for (const [tab, { button, panel }] of ui.tabs) {
    const on = tab === id;
    button.setAttribute('aria-selected', String(on));
    button.tabIndex = on ? 0 : -1;
    panel.hidden = !on;
  }
  if (focus) ui.tabs.get(id)?.button.focus();
}

/** Ouvre l'onglet qui contient l'élément `id` (section ou ancienne ancre) et y fait défiler la page. */
function scrollToSection(id: string): void {
  const el = document.getElementById(id);
  if (!el) return;
  const panel = el.closest<HTMLElement>('[role=tabpanel]');
  const tab = panel?.dataset.tab as TabId | undefined;
  if (tab && tab !== activeTab) showTab(tab);
  if (el instanceof HTMLDetailsElement) el.open = true;
  el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/** Ancres d'avant la 1.0 (liens du site, du journal, des nouveautés). */
const LEGACY_ANCHORS: Record<string, string> = {
  demarrage: 'accueil',
  prix: 'prix',
  durees: 'durees',
  tdv: 'tdv',
  affichage: 'affichage',
  fonctionnalites: 'fonctionnalites',
  automatisations: 'acces',
  notifications: 'notifications',
  maj: 'maj',
  avance: 'avance',
};

function tabBar() {
  const bar = h('div', { class: 'tabs', role: 'tablist', 'aria-label': 'Réglages' });
  for (const [id, label] of TABS) {
    const button = h(
      'button',
      {
        type: 'button',
        role: 'tab',
        id: `tab-${id}`,
        'aria-controls': `panel-${id}`,
        class: id === 'acces' ? 'tab risk' : 'tab',
        onclick: () => showTab(id),
        onkeydown: (e: KeyboardEvent) => {
          const i = TABS.findIndex(([t]) => t === id);
          const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
          if (!step) return;
          e.preventDefault();
          showTab(TABS[(i + step + TABS.length) % TABS.length][0], true);
        },
      },
      label,
    ) as HTMLButtonElement;
    bar.append(button);
    ui.tabs.set(id, { button, panel: null as unknown as HTMLElement });
  }
  return bar;
}

function panel(id: TabId, ...body: (Child | Child[])[]) {
  const el = h('div', { class: 'panel', role: 'tabpanel', id: `panel-${id}`, 'data-tab': id, 'aria-labelledby': `tab-${id}` }, ...body);
  ui.tabs.get(id)!.panel = el;
  return el;
}

// ---------------------------------------------------------------------------
// Accès au site et réglages à risque
// ---------------------------------------------------------------------------

type AccessLevel = 'none' | 'read' | 'write';

function accessLevel(): AccessLevel {
  return settings.apiWrite ? 'write' : settings.apiRead ? 'read' : 'none';
}

const ACCESS_LEVELS: { id: AccessLevel; title: string; text: string }[] = [
  { id: 'none', title: 'Aucun accès', text: 'Wiki-Traders lit seulement les pages que tu ouvres et te conseille. Aucun risque.' },
  { id: 'read', title: 'Lecture', text: 'Lit les prix, tes mises et les ventes du marché via l\'API, avec ta session. Rien n\'est modifié sur ton compte.' },
  { id: 'write', title: 'Lecture et étiquettes', text: 'En plus, écrit tes étiquettes directement (étiquetage automatique plus fiable). Aucune autre écriture.' },
];

function confirmRisk(label: string, help = ''): boolean {
  return confirm(`${label}\n\n${help ? `${help}\n\n` : ''}${RISK_TEXT}\n\nActiver quand même ?`);
}

/** Change le niveau d'accès (confirmation pour monter) et enregistre aussitôt. */
async function setAccess(level: AccessLevel): Promise<void> {
  const order: AccessLevel[] = ['none', 'read', 'write'];
  if (order.indexOf(level) > order.indexOf(accessLevel())) {
    const def = ACCESS_LEVELS.find((l) => l.id === level)!;
    if (!confirmRisk(`Accès au site : ${def.title}`, def.text)) return refreshLive();
  }
  settings.apiRead = level !== 'none';
  settings.apiWrite = level === 'write';
  syncRiskyBoxes();
  onEdit();
  await saveAll();
}

function syncRiskyBoxes(): void {
  for (const [key, box] of Object.entries(ui.risky) as [RiskyKey, HTMLInputElement][]) box.checked = settings[key];
}

function riskyToggle(key: RiskyKey, label: string, help: string, extra: Child[] = []) {
  const el = toggleField(
    label,
    settings[key],
    (box) => {
      if (box.checked && !confirmRisk(label, help)) {
        box.checked = false;
        return;
      }
      settings[key] = box.checked;
      onEdit();
    },
    help,
    [h('span', { class: 'badge risk' }, '⚠ risque'), ...extra],
  );
  ui.risky[key] = el.querySelector('input')!;
  return el;
}

/** Actions à ta place, listées dans « Accès au site » avec l'endroit où les régler. */
function riskyActions(): { label: string; on: boolean; where: string; anchor: string }[] {
  const flags = featureFlags(settings.features);
  return [
    { label: 'Ouvrir la vente et pré-remplir le prix', on: settings.prefill, where: 'Ventes → Aide à la vente', anchor: 'aide-vente' },
    { label: 'Étiquetage automatique', on: settings.autoTag, where: 'Étiquettes → Étiquetage automatique', anchor: 'etiquetage-auto' },
    ...FEATURES.filter((f) => f.risky).map((f) => ({ label: f.label, on: flags[f.key], where: FEATURE_PLACE[f.key]?.where ?? 'Sur le site', anchor: FEATURE_PLACE[f.key]?.anchor ?? 'fonctionnalites' })),
  ];
}

function refreshAccess(): void {
  const level = accessLevel();
  const actions = riskyActions();
  const on = actions.filter((a) => a.on);
  mount(
    ui.access,
    h(
      'div',
      { class: 'levels', role: 'radiogroup', 'aria-label': 'Niveau d\'accès au site' },
      ACCESS_LEVELS.map((l) =>
        h(
          'label',
          { class: `level${l.id === level ? ' is-on' : ''}${l.id === 'none' ? '' : ' risky'}` },
          h('input', { type: 'radio', name: 'access', value: l.id, checked: l.id === level, onchange: () => void setAccess(l.id) }),
          h('span', { class: 'level-text' }, h('strong', null, l.title, l.id === 'none' ? null : h('span', { class: 'badge risk' }, '⚠ risque')), h('span', { class: 'muted small' }, l.text)),
        ),
      ),
    ),
    h('h3', null, 'Actions à ta place'),
    h('p', { class: 'muted small' }, on.length ? `${on.length} activée${on.length > 1 ? 's' : ''}. Chacune se règle avec ce qu'elle concerne :` : 'Aucune activée. Chacune se règle avec ce qu\'elle concerne :'),
    h(
      'ul',
      { class: 'actions-list' },
      actions.map((a) =>
        h(
          'li',
          { class: a.on ? 'is-on' : undefined },
          h('span', { class: `state ${a.on ? 'on' : 'off'}` }, a.on ? 'activée' : 'désactivée'),
          h('span', { class: 'grow' }, a.label),
          h('button', { type: 'button', class: 'link', onclick: () => scrollToSection(a.anchor) }, `${a.where} →`),
        ),
      ),
    ),
  );
}

function accessSection() {
  ui.access = h('div');
  return section(
    'acces',
    'Accès au site',
    [
      h('strong', { class: 'error' }, '⚠ À tes risques. '),
      'Lire le site avec ta session ou cliquer à ta place est interdit par les règles de WikiMasters (section 3) et ses conditions (section 6) : ton compte peut être banni définitivement, avec perte des cartes. Tout est désactivé par défaut, chaque activation demande une confirmation, et la mise en vente finale reste toujours à toi.',
    ],
    [ui.access],
    { cls: 'danger-zone' },
  );
}

// ---------------------------------------------------------------------------
// Accueil : démarrage rapide et profils
// ---------------------------------------------------------------------------

type ProfileId = 'prudent' | 'confort' | 'complet';

const PROFILES: { id: ProfileId; title: string; text: string; set: Pick<Settings, 'apiRead' | 'apiWrite' | 'autoTag' | 'prefill'> }[] = [
  { id: 'prudent', title: 'Prudent', text: 'Aucun accès au site : conseils de vente à partir des pages que tu ouvres. Aucun risque.', set: { apiRead: false, apiWrite: false, autoTag: false, prefill: false } },
  { id: 'confort', title: 'Confort', text: 'Lecture via l\'API : prix, mises et ventes à jour sans ouvrir chaque page. Rien n\'est fait à ta place.', set: { apiRead: true, apiWrite: false, autoTag: false, prefill: false } },
  { id: 'complet', title: 'Complet', text: 'Lecture et étiquetage par l\'API : l\'étiquetage automatique range tes cartes. La mise en vente reste à toi.', set: { apiRead: true, apiWrite: true, autoTag: true, prefill: false } },
];

const RISKY_FEATURES = FEATURES.filter((f) => f.risky).map((f) => f.key);

function currentProfile(): ProfileId | null {
  const flags = featureFlags(settings.features);
  if (RISKY_FEATURES.some((k) => flags[k])) return null;
  return PROFILES.find((p) => (Object.keys(p.set) as (keyof typeof p.set)[]).every((k) => settings[k] === p.set[k]))?.id ?? null;
}

async function applyProfile(id: ProfileId): Promise<void> {
  const p = PROFILES.find((x) => x.id === id)!;
  const enables = (Object.keys(p.set) as (keyof typeof p.set)[]).some((k) => p.set[k] && !settings[k]);
  if (enables && !confirmRisk(`Profil ${p.title}`, p.text)) return;
  Object.assign(settings, p.set);
  settings.features = { ...settings.features, ...Object.fromEntries(RISKY_FEATURES.map((k) => [k, false])) };
  render();
  await saveAll();
}

function refreshProfiles(): void {
  const current = currentProfile();
  mount(
    ui.profiles,
    h(
      'div',
      { class: 'profiles' },
      PROFILES.map((p) =>
        h(
          'button',
          { type: 'button', class: `profile${p.id === current ? ' is-on' : ''}`, 'aria-pressed': String(p.id === current), onclick: () => (p.id === current ? null : void applyProfile(p.id)) },
          h('strong', null, p.title, p.id === 'prudent' ? null : h('span', { class: 'badge risk' }, '⚠ risque'), p.id === current ? h('span', { class: 'badge ok' }, '✓ actuel') : null),
          h('span', { class: 'muted small' }, p.text),
        ),
      ),
    ),
    current ? null : h('p', { class: 'muted small' }, 'Réglages personnalisés : choisis un profil pour repartir d\'une base simple (tes étiquettes et tes prix ne changent pas).'),
  );
}

function quickFix(c: QuickCheck): Child {
  if (c.ok) return null;
  switch (c.id) {
    case 'collection':
      return h('a', { href: `${SITE_ORIGIN}/collection`, target: embedded ? '_top' : '_blank', rel: 'noopener' }, 'Ouvrir ma collection →');
    case 'api':
      return h('button', { type: 'button', class: 'small', onclick: () => void setAccess('read') }, 'Activer la lecture via l\'API…');
    case 'rules':
      return rules.length
        ? h('button', { type: 'button', class: 'small', onclick: () => scrollToSection('ventes') }, 'Voir mes étiquettes')
        : h(
            'button',
            {
              type: 'button',
              class: 'small',
              onclick: () => {
                rules = DEFAULT_RULES.map((r) => ({ ...r, id: newId() }));
                renderRules();
                onEdit();
                scrollToSection('ventes');
              },
            },
            'Partir de l\'exemple (50-100 et 20-50)',
          );
    case 'quotas':
      return h('button', { type: 'button', class: 'small', onclick: () => scrollToSection('ventes') }, 'Ajuster la répartition');
  }
}

function refreshQuickStart(): void {
  const checks = quickStartChecks({ cardCount: Object.keys(store.cards).length, rules, settings });
  const done = checks.filter((c) => c.ok).length;
  mount(
    ui.quick,
    h('p', { class: 'intro' }, done === checks.length ? 'Tout est prêt : Wiki-Traders peut te proposer des ventes.' : `${done} / ${checks.length} prêts. Les points restants se règlent en un clic.`),
    h(
      'ul',
      { class: 'checks' },
      checks.map((c) =>
        h(
          'li',
          { class: c.ok ? 'ok-item' : 'todo-item' },
          h('span', { class: 'check-icon', 'aria-hidden': 'true' }, c.ok ? '✓' : '!'),
          h('span', { class: 'grow' }, h('strong', null, c.label), h('span', { class: 'muted small' }, ` — ${c.detail}`)),
          quickFix(c),
        ),
      ),
    ),
  );
}

function homePanel() {
  ui.quick = h('div');
  ui.profiles = h('div');
  return panel(
    'accueil',
    h('section', { class: 'card opt-section', id: 'accueil' }, h('h2', null, 'Démarrage rapide'), ui.quick),
    section('profils', 'Profil', 'Un profil règle d\'un coup ce que Wiki-Traders a le droit de faire sur le site. Tu peux ensuite tout ajuster onglet par onglet.', [ui.profiles]),
    section(
      'plan',
      'Où trouver quoi',
      null,
      [
        h(
          'ul',
          { class: 'map' },
          [
            ['ventes', 'Ventes', 'tes slots, la mise de départ, le taux de vente, la durée des enchères, ce qui n\'est jamais vendu.'],
            ['etiquettes', 'Étiquettes', 'quelles cartes vont dans chaque étiquette et l\'étiquetage automatique.'],
            ['site', 'Sur le site', 'ce que Wiki-Traders ajoute aux pages de WikiMasters, notifications.'],
            ['acces', 'Accès au site', 'lecture via l\'API et actions à ta place (risque de bannissement).'],
            ['avance', 'Avancé', 'pages du site, prix saisis, sauvegarde, mises à jour.'],
          ].map(([id, label, text]) => h('li', null, h('button', { type: 'button', class: 'link', onclick: () => showTab(id as TabId) }, label), ` : ${text}`)),
        ),
      ],
    ),
  );
}

// ---------------------------------------------------------------------------
// Ventes : slots et étiquettes à vendre
// ---------------------------------------------------------------------------

function refreshQuota(): void {
  if (settings.allocationMode === 'pool') {
    ui.quota.className = 'quota-summary ok';
    mount(ui.quota, h('strong', null, 'Mode « meilleures cartes »'), h('span', null, ` — tes ${settings.slots} slots reçoivent les meilleures cartes de toutes tes étiquettes actives ; le nombre de slots par étiquette est ignoré.`));
    return;
  }
  const q = quotaSummary(rules, settings.slots);
  ui.quota.className = `quota-summary ${q.status}`;
  mount(ui.quota, h('strong', null, q.text), h('span', null, ` — ${q.status === 'ok' ? '✓ ' : '⚠ '}${q.message}`));
}

/** Champ « nom de l'étiquette », synchronisé entre les onglets Ventes et Étiquettes. */
function tagInput(rule: TagRule, registered: boolean) {
  const input = h('input', {
    class: 'tag-input',
    value: rule.tag,
    placeholder: '20-50',
    'aria-label': 'Étiquette',
    oninput: (e: Event) => {
      rule.tag = (e.target as HTMLInputElement).value;
      for (const other of ui.tagInputs.get(rule.id) ?? []) if (other !== e.target) other.value = rule.tag;
      onEdit();
    },
  }) as HTMLInputElement;
  const list = ui.tagInputs.get(rule.id) ?? [];
  list.push(input);
  ui.tagInputs.set(rule.id, list);
  return registered ? reg(`rule:${rule.id}:tag`, input) : input;
}

function removeRuleButton(rule: TagRule) {
  return h(
    'button',
    {
      type: 'button',
      class: 'danger',
      title: 'Supprimer cette étiquette (ventes et étiquetage)',
      'aria-label': `Supprimer l'étiquette ${rule.tag.trim() || 'sans nom'}`,
      onclick: () => {
        rules = rules.filter((r) => r !== rule);
        renderRules();
        onEdit();
      },
    },
    '✕',
  );
}

function activeSwitch(rule: TagRule) {
  return switchInput(
    rule.active,
    (box) => {
      rule.active = box.checked;
      for (const el of document.querySelectorAll(`[data-rule="${rule.id}"]`)) el.classList.toggle('inactive', !box.checked);
      for (const el of document.querySelectorAll<HTMLInputElement>(`[data-rule="${rule.id}"] .rule-head input.switch`)) el.checked = box.checked;
      onEdit();
    },
    `Étiquette ${rule.tag.trim() || 'sans nom'} active`,
  );
}

const MATCH_TEXT: Record<TagRule['match'], string> = {
  tag: 'cartes qui portent l\'étiquette sur le site',
  price: 'cartes dont le prix moyen est dans la plage',
};

/** Carte d'une étiquette dans l'onglet Ventes : combien de slots, à quel prix, combien en garder. */
function saleCard(rule: TagRule) {
  const bind = <K extends keyof TagRule>(key: K, parse: (v: string) => TagRule[K]) => (e: Event) => {
    rule[key] = parse((e.target as HTMLInputElement).value);
    onEdit();
  };
  const example = h('span', { class: 'muted small example' }, pctExample(rule.pct, settings.rounding));
  ui.pctExamples.set(rule, example);
  return h(
    'div',
    { class: `rule-card${rule.active ? '' : ' inactive'}`, 'data-rule': rule.id },
    h('div', { class: 'row rule-head' }, activeSwitch(rule), tagInput(rule, true), h('span', { class: 'grow' }), removeRuleButton(rule)),
    h(
      'div',
      { class: 'rule-line' },
      h('label', { class: 'inline' }, 'Réserve', reg(`rule:${rule.id}:quota`, h('input', { type: 'number', min: '0', value: rule.quota, 'aria-label': 'Slots réservés', oninput: bind('quota', (v) => num(v, 0)!) })), 'slot(s)'),
      h(
        'label',
        { class: 'inline' },
        'Mise de départ',
        reg(`rule:${rule.id}:pct`, h('input', { type: 'number', min: '1', max: '500', value: rule.pct, 'aria-label': '% du prix moyen', oninput: bind('pct', (v) => num(v, 0)!) })),
        '% du prix moyen',
        example,
      ),
      h(
        'label',
        { class: 'inline' },
        'Garder',
        h('input', { type: 'number', min: '0', value: rule.keepMin, 'aria-label': 'Exemplaires gardés', oninput: bind('keepMin', (v) => num(v, 1)!) }),
        'exemplaire(s)',
        hint('Exemplaires jamais vendus : avec 1, ton dernier exemplaire reste toujours dans ta collection ; seuls les doublons partent.'),
      ),
    ),
    h(
      'div',
      { class: 'muted small rule-source' },
      `Cartes proposées : ${MATCH_TEXT[rule.match]}. `,
      h('button', { type: 'button', class: 'link', onclick: () => scrollToSection(`etiquette-${rule.id}`) }, 'Changer dans Étiquettes →'),
    ),
    saleDetails(rule),
  );
}

/** Réglages de vente propres à une étiquette, repliés. */
function saleDetails(rule: TagRule) {
  const summary = h('span', { class: 'muted small' }, rule.sale ? `propres à cette étiquette (${SORT_LABELS[rule.sale.sort]})` : 'réglages généraux');
  const details = h(
    'details',
    {
      class: 'rule-extra',
      open: openRuleDetails.has(`sale:${rule.id}`),
      ontoggle: (e: Event) => ((e.target as HTMLDetailsElement).open ? openRuleDetails.add(`sale:${rule.id}`) : openRuleDetails.delete(`sale:${rule.id}`)),
    },
    h('summary', null, h('span', null, 'Ordre, taux de vente et durée'), ' · ', summary),
    ruleSaleBox(rule),
  );
  details.addEventListener('change', () => (summary.textContent = rule.sale ? `propres à cette étiquette (${SORT_LABELS[rule.sale.sort]})` : 'réglages généraux'));
  return details;
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
    h('span', { class: 'muted small' }, 'Étiquettes de ta collection pas encore suivies :'),
    missing.map(([tag, n]) =>
      h(
        'button',
        {
          type: 'button',
          class: 'small',
          title: 'Suivre cette étiquette (garder 0 : l\'étiquette désigne les cartes à vendre)',
          onclick: () => {
            rules.push({ id: newId(), tag, quota: 1, pct: 100, floor: null, ceiling: null, keepMin: 0, active: true, match: 'tag' });
            renderRules();
            onEdit();
          },
        },
        `+ ${tag} (${n} carte${n > 1 ? 's' : ''})`,
      ),
    ),
  );
}

function addRuleButton() {
  return h(
    'button',
    {
      type: 'button',
      onclick: () => {
        const rule: TagRule = { id: newId(), tag: '', quota: 1, pct: 70, floor: null, ceiling: null, keepMin: 1, active: true, match: 'tag' };
        rules.push(rule);
        renderRules();
        onEdit();
        (ui.fields.get(`rule:${rule.id}:tag`) as HTMLInputElement | undefined)?.focus();
      },
    },
    '+ Ajouter une étiquette',
  );
}

function renderRules(): void {
  ui.pctExamples.clear();
  ui.tagInputs.clear();
  mount(
    ui.rules,
    rules.length ? h('div', { class: 'rule-cards' }, rules.map(saleCard)) : h('p', { class: 'muted' }, 'Aucune étiquette : ajoute-en une pour que Wiki-Traders te propose des ventes.'),
    h('div', { class: 'row', style: 'margin-top:10px' }, addRuleButton()),
    detectedTagsBlock(),
  );
  renderTagRules();
}

/** Panneaux « Conditions et vente » ouverts (gardés ouverts quand le tableau est redessiné). */
const openRuleDetails = new Set<string>();

const SORT_LABELS: Record<CandidateSort, string> = {
  desc: 'doublons, puis la plus chère',
  asc: 'doublons, puis la moins chère (écouler)',
  random: 'doublons, puis au hasard',
  rate: 'doublons, puis meilleur taux de vente',
  custom: 'selon mes critères (tri multi-critères)',
  score: 'formule de score (avancé)',
};

/**
 * Éditeur de critères de tri : chaque ligne départage les égalités de la précédente (ex. prix ↓, puis tdv ↓,
 * puis nombre de ventes ↓). `prefix` : préfixe des champs pour les erreurs.
 */
function criteriaEditor(list: SortCriterion[], prefix: string): HTMLElement {
  const box = h('div', { class: 'criteria' });
  const draw = () =>
    mount(
      box,
      h(
        'ol',
        { class: 'tiers' },
        list.map((c, i) =>
          h(
            'li',
            { class: 'row tier' },
            h('span', { class: 'muted small tier-num' }, i === 0 ? 'D\'abord' : 'puis'),
            reg(
              `${prefix}sort:${i}:key`,
              h(
                'select',
                { 'aria-label': `Critère ${i + 1}`, onchange: (e: Event) => ((list[i] = { ...list[i], key: (e.target as HTMLSelectElement).value as SortKey }), draw(), onEdit()) },
                SORT_KEYS.map((k) => h('option', { value: k.key, selected: k.key === c.key, title: k.help }, k.label)),
              ),
            ),
            c.key === 'hasard'
              ? null
              : h(
                  'select',
                  { 'aria-label': `Sens du critère ${i + 1}`, onchange: (e: Event) => ((list[i] = { ...list[i], dir: (e.target as HTMLSelectElement).value as SortCriterion['dir'] }), onEdit()) },
                  h('option', { value: 'desc', selected: c.dir === 'desc' }, 'le plus haut d\'abord ↓'),
                  h('option', { value: 'asc', selected: c.dir === 'asc' }, 'le plus bas d\'abord ↑'),
                ),
            h('button', { type: 'button', class: 'small', title: 'Monter', disabled: i === 0, onclick: () => (list.splice(i - 1, 0, ...list.splice(i, 1)), draw(), onEdit()) }, '▲'),
            h('button', { type: 'button', class: 'small', title: 'Descendre', disabled: i === list.length - 1, onclick: () => (list.splice(i + 1, 0, ...list.splice(i, 1)), draw(), onEdit()) }, '▼'),
            h('button', { type: 'button', class: 'danger', title: 'Retirer ce critère', disabled: list.length === 1, onclick: () => (list.splice(i, 1), draw(), onEdit()) }, '✕'),
          ),
        ),
      ),
      h(
        'div',
        { class: 'row wrap', style: 'margin-top:8px' },
        h('button', { type: 'button', onclick: () => (list.push({ key: SORT_KEYS.find((k) => !list.some((c) => c.key === k.key))?.key ?? 'prix', dir: 'desc' }), draw(), onEdit()) }, '+ Ajouter un critère'),
        h('span', { class: 'muted small' }, 'Une valeur inconnue (taux de vente pas encore lu, moins de 5 enchères) passe toujours en dernier.'),
      ),
    );
  draw();
  return box;
}

/** Réglages de vente propres à une étiquette (activés par la case, copiés des réglages globaux). */
function ruleSaleBox(rule: TagRule): HTMLElement {
  const box = h('div', { class: 'rule-sale' });
  const prefix = `rule:${rule.id}:`;
  const draw = () => {
    const s = rule.sale;
    const toggle = toggleField(
      'Réglages de vente propres à cette étiquette',
      !!s,
      (input) => {
        if (input.checked) {
          rule.sale = {
            minSellRate: settings.minSellRate,
            sellRateRules: settings.sellRateRules.map((t) => ({ ...t })),
            durationRules: settings.durationRules.map((t) => ({ ...t })),
            sort: settings.sortPrice,
            sortCriteria: (settings.sortCriteria.length ? settings.sortCriteria : DEFAULT_CRITERIA).map((c) => ({ ...c })),
            score: '{prix} * {tdv} / 100 + {doublons} * 10',
          };
        } else delete rule.sale;
        draw();
        onEdit();
      },
      'Sinon, l\'étiquette suit les réglages généraux de cet onglet (Prix de départ, Taux de vente, Durée des enchères).',
    );
    if (!s) return mount(box, toggle);
    const formulaState = h('div', { class: 'small formula-state', 'aria-live': 'polite' });
    const checkFormula = () => {
      const err = s.score.trim() ? formulaError(s.score) : 'formule vide';
      formulaState.className = `small formula-state ${err ? 'bad' : 'ok'}`;
      formulaState.textContent = err ? `⚠ ${err}` : '✓ formule valide : la carte au score le plus haut est proposée en premier';
    };
    const formula = reg(
      `${prefix}score`,
      h('textarea', {
        rows: 2,
        class: 'formula',
        spellcheck: 'false',
        'aria-label': 'Formule de score',
        oninput: (e: Event) => {
          s.score = (e.target as HTMLTextAreaElement).value;
          checkFormula();
          onEdit();
        },
      }),
    ) as HTMLTextAreaElement;
    formula.value = s.score;
    checkFormula();
    const insert = (name: string) => {
      const at = formula.selectionStart ?? formula.value.length;
      formula.value = `${formula.value.slice(0, at)}{${name}}${formula.value.slice(formula.selectionEnd ?? at)}`;
      formula.dispatchEvent(new Event('input'));
      formula.focus();
    };
    mount(
      box,
      toggle,
      h(
        'div',
        { class: 'grid' },
        field(
          'Taux de vente minimum (%)',
          reg(`${prefix}minSellRate`, h('input', { type: 'number', min: '0', max: '100', value: s.minSellRate ?? '', placeholder: 'aucun', oninput: (e: Event) => ((s.minSellRate = num((e.target as HTMLInputElement).value)), onEdit()) })),
          'Sous ce taux, une carte de l\'étiquette n\'est plus proposée.',
        ),
        field(
          'Ordre de choix des cartes',
          h(
            'select',
            {
              onchange: (e: Event) => {
                s.sort = (e.target as HTMLSelectElement).value as CandidateSort;
                draw();
                onEdit();
              },
            },
            (Object.keys(SORT_LABELS) as CandidateSort[]).map((k) => h('option', { value: k, selected: s.sort === k }, SORT_LABELS[k])),
          ),
          'Quelle carte de l\'étiquette est proposée en premier pour un slot libre.',
        ),
      ),
      s.sort === 'custom' ? criteriaEditor((s.sortCriteria ??= DEFAULT_CRITERIA.map((c) => ({ ...c }))), prefix) : null,
      s.sort === 'score'
        ? h(
            'div',
            { class: 'formula-box' },
            h('div', { class: 'field-label' }, 'Formule de score'),
            formula,
            formulaState,
            h(
              'div',
              { class: 'row wrap formula-vars' },
              h('span', { class: 'muted small' }, 'Variables :'),
              FORMULA_VARS.map((v) => h('button', { type: 'button', class: 'chip', title: v.help, onclick: () => insert(v.name) }, `{${v.name}}`)),
            ),
            h('p', { class: 'muted small' }, 'Opérations + − * / % ^, comparaisons (< > <= >= == !=, vrai = 1), && || !, parenthèses, fonctions min, max, abs, arrondi, plancher, plafond, racine, log, si(condition, alors, sinon). Décimales avec un point : 1.5. Ex. : si({tdv} < 20, 0, {prix} * {tdv} / 100).'),
          )
        : null,
      h('h4', null, 'Prix selon le taux de vente'),
      rateTiers(s.sellRateRules, prefix),
      h('h4', null, 'Durée des enchères'),
      durationTiers(s.durationRules, prefix),
    );
  };
  draw();
  return box;
}


function slotsSection() {
  const s = settings;
  ui.rules = h('div');
  ui.quota = h('div', { class: 'quota-summary', 'aria-live': 'polite' });
  return section(
    'ventes',
    'Mes slots',
    'Chaque étiquette du site réserve des slots d\'enchères. Ex. : 1 slot pour « 50-100 » et 4 pour « 20-50 » ; Wiki-Traders propose une carte de l\'étiquette pour chaque slot libre.',
    [
      h(
        'div',
        { class: 'grid' },
        field('Nombre de slots', reg('slots', h('input', { type: 'number', min: '1', max: '50', value: s.slots, oninput: (e: Event) => ((s.slots = num((e.target as HTMLInputElement).value, 5)!), onEdit()) })), 'Enchères que tu peux avoir en même temps sur le site.'),
        field(
          'Répartition des slots',
          h(
            'select',
            {
              onchange: (e: Event) => {
                s.allocationMode = (e.target as HTMLSelectElement).value as Settings['allocationMode'];
                onEdit();
              },
            },
            h('option', { value: 'quota', selected: s.allocationMode === 'quota' }, 'par étiquette (slots réservés)'),
            h('option', { value: 'pool', selected: s.allocationMode === 'pool' }, 'meilleures cartes, toutes étiquettes'),
          ),
          undefined,
          'Meilleures cartes : pas de slots réservés ; les slots libres reçoivent les meilleures cartes de toutes tes étiquettes actives, et « Suivant » passe aux suivantes.',
        ),
      ),
      ui.quota,
      ui.rules,
    ],
    { errKey: 'rules' },
  );
}

function blacklistBlock() {
  return field(
    'Liste noire',
    h('textarea', {
      rows: 3,
      placeholder: 'Une carte par ligne (nom ou identifiant)',
      'aria-label': 'Liste noire',
      value: settings.blacklist.join('\n'),
      oninput: (e: Event) => {
        settings.blacklist = (e.target as HTMLTextAreaElement).value.split('\n').map((l) => l.trim()).filter(Boolean);
        onEdit();
      },
    }),
    'Ces cartes ne sont jamais proposées.',
  );
}

function protectSection() {
  return section(
    'protection',
    'Jamais vendu',
    'Ces cartes ne sont jamais proposées à la vente (tu peux toujours les vendre à la main). Les cartes en favori ★ sur le site sont toujours protégées.',
    [
      h(
        'div',
        { class: 'toggles' },
        settingToggle('protectFamilies', 'Cartes de mes familles', 'Une carte d\'une de tes familles n\'est jamais proposée, sauf pour une étiquette qui vise justement cette famille (Étiquettes → conditions).'),
        settingToggle('allowDuplicateListing', 'Proposer une carte déjà en vente', 'Autorise à mettre en vente un autre exemplaire d\'une carte déjà aux enchères.'),
      ),
      blacklistBlock(),
    ],
  );
}

// ---------------------------------------------------------------------------
// Ventes : prix de départ
// ---------------------------------------------------------------------------

function refreshFallback(): void {
  const tags = rules.map((r) => r.tag.trim()).filter(Boolean);
  const current = settings.fallbackTag;
  const key = JSON.stringify([tags, current]);
  if (key === ui.fallbackKey) return;
  ui.fallbackKey = key;
  const missing = current && !tags.includes(current);
  ui.fallback.replaceChildren(
    h('option', { value: '' }, '— aucune —'),
    ...tags.map((t) => h('option', { value: t, selected: t === current }, t)),
    missing ? h('option', { value: current, selected: true }, `${current} (aucune règle)`) : '',
  );
}

/** Critères de tri généraux, affichés seulement pour l'ordre « selon mes critères ». */
function renderCriteria(): void {
  mount(ui.criteria, settings.sortPrice === 'custom' ? [h('h3', null, 'Critères de tri'), criteriaEditor(settings.sortCriteria, '')] : null);
}

function pricingSection() {
  const s = settings;
  const set = <K extends keyof Settings>(key: K, parse: (v: string) => Settings[K]) => (e: Event) => {
    s[key] = parse((e.target as HTMLInputElement).value);
    onEdit();
  };
  ui.rounding = h('span', { class: 'muted small' });
  ui.criteria = h('div');
  renderCriteria();
  ui.fallback = h('select', { onchange: set('fallbackTag', (v) => v || null) });
  ui.fallbackKey = '';
  refreshFallback();
  return section(
    'prix',
    'Prix de départ',
    'Le prix de départ conseillé = prix moyen de la carte × la mise de départ de son étiquette, ajusté par le taux de vente si tu l\'as réglé, puis arrondi.',
    [
      h(
        'div',
        { class: 'grid' },
        field(
          'Ordre des cartes proposées',
          h(
            'select',
            {
              onchange: (e: Event) => {
                s.sortPrice = (e.target as HTMLSelectElement).value as Settings['sortPrice'];
                if (s.sortPrice === 'random') s.randomSeed = Date.now() % 2_147_483_647;
                if (s.sortPrice === 'custom' && !s.sortCriteria.length) s.sortCriteria = DEFAULT_CRITERIA.map((c) => ({ ...c }));
                renderCriteria();
                onEdit();
              },
            },
            h('option', { value: 'desc', selected: s.sortPrice === 'desc' }, 'doublons, puis la plus chère'),
            h('option', { value: 'asc', selected: s.sortPrice === 'asc' }, 'doublons, puis la moins chère (écouler)'),
            h('option', { value: 'random', selected: s.sortPrice === 'random' }, 'doublons, puis au hasard'),
            h('option', { value: 'custom', selected: s.sortPrice === 'custom' }, 'selon mes critères (tri multi-critères)'),
          ),
          'Quelle carte est proposée en premier pour un slot libre.',
        ),
        field(
          'Arrondi (W)',
          h('input', { type: 'number', min: '0', value: s.rounding, oninput: set('rounding', (v) => num(v, 0)!) }),
          h('span', { class: 'small' }, h('span', { class: 'muted' }, '0 = automatique. '), ui.rounding),
          'Pas d\'arrondi de la mise conseillée. Automatique : à l\'unité sous 20 W, à 5 sous 100, à 10 sous 1 000.',
        ),
      ),
      ui.criteria,
      fine(
        'Réglages fins : calcul du prix moyen, étiquette de secours',
        h(
          'div',
          { class: 'grid' },
          field(
            'Statistique',
            h(
              'select',
              { onchange: set('stat', (v) => v as Settings['stat']) },
              h('option', { value: 'median', selected: s.stat === 'median' }, 'médiane (conseillé)'),
              h('option', { value: 'mean', selected: s.stat === 'mean' }, 'moyenne'),
            ),
            'Médiane : le prix du milieu des ventes, qu\'une vente exceptionnelle ne fausse pas.',
          ),
          field('Période observée (jours)', h('input', { type: 'number', min: '1', max: '90', value: s.windowDays, oninput: set('windowDays', (v) => num(v, 7)!) }), 'Seules les ventes de ces derniers jours comptent.'),
          field('Étiquette de secours', ui.fallback, 'Quand une étiquette n\'a plus aucune carte à vendre, son slot reçoit une carte de celle-ci.'),
        ),
        h('div', { class: 'toggles' }, settingToggle('includeListings', 'Compter les enchères en cours dans le prix moyen', 'Par défaut, seules les ventes terminées comptent : une enchère en cours peut encore monter.')),
      ),
    ],
    { errKey: 'pricing' },
  );
}

// ---------------------------------------------------------------------------
// Ventes : taux de vente et durée
// ---------------------------------------------------------------------------

/** Éditeur de paliers de taux de vente ; `prefix` comme pour les paliers de durée. */
function rateTiers(rows: SellRateRule[], prefix: string): HTMLElement {
  const box = h('div');
  const set = (i: number, key: 'from' | 'to' | 'pricePct', v: number | null) => {
    rows[i] = { ...rows[i], [key]: key === 'pricePct' ? v ?? 100 : v };
    onEdit();
  };
  const pct = (i: number, key: 'from' | 'to', placeholder: string) =>
    reg(
      `${prefix}tdv:${i}:${key}`,
      h('input', { type: 'number', min: '0', max: '100', value: rows[i][key] ?? '', placeholder, 'aria-label': `Palier ${i + 1} : ${key === 'from' ? 'de' : 'à'}`, oninput: (e: Event) => set(i, key, num((e.target as HTMLInputElement).value)) }),
    );
  const draw = () => {
    ui.rateExamples = ui.rateExamples.filter((x) => x.el.isConnected);
    mount(
      box,
      rows.length
        ? h(
            'ol',
            { class: 'tiers' },
            rows.map((r, i) => {
              const example = h('span', { class: 'muted small' }, rateTierExample(r.pricePct, settings.rounding));
              ui.rateExamples.push({ el: example, row: () => rows[i] });
              return h(
                'li',
                { class: 'row tier' },
                h('span', { class: 'muted small tier-num' }, `Palier ${i + 1}`),
                'Taux de vente de',
                pct(i, 'from', '0'),
                'à',
                pct(i, 'to', '100'),
                '% → départ à',
                reg(`${prefix}tdv:${i}:pricePct`, h('input', { type: 'number', min: '1', max: '500', step: '5', value: r.pricePct, 'aria-label': `Palier ${i + 1} : % du prix`, oninput: (e: Event) => set(i, 'pricePct', num((e.target as HTMLInputElement).value, 100)) })),
                '% du prix conseillé',
                example,
                h(
                  'button',
                  { type: 'button', class: 'danger', title: 'Supprimer ce palier', 'aria-label': `Supprimer le palier ${i + 1}`, onclick: () => (rows.splice(i, 1), draw(), onEdit()) },
                  '✕',
                ),
              );
            }),
          )
        : null,
      h(
        'div',
        { class: 'row wrap', style: 'margin-top:8px' },
        h('button', { type: 'button', onclick: () => (rows.push({ from: null, to: null, pricePct: 100 }), draw(), onEdit()) }, '+ Ajouter un palier'),
        h(
          'button',
          {
            type: 'button',
            title: DEFAULT_RATE_TIERS.map(tierText).join(' · '),
            onclick: () => {
              if (rows.length && !confirm(`Remplacer tes paliers par la proposition par défaut ?\n\n${DEFAULT_RATE_TIERS.map(tierText).join('\n')}`)) return;
              rows.splice(0, rows.length, ...DEFAULT_RATE_TIERS.map((t) => ({ ...t })));
              draw();
              onEdit();
            },
          },
          'Proposition par défaut',
        ),
      ),
    );
  };
  draw();
  return box;
}

function renderRateTiers(): void {
  mount(ui.rateTiers, rateTiers(settings.sellRateRules, ''));
}

function tierText(r: SellRateRule): string {
  return `taux de vente ${r.from ?? 0}–${r.to ?? 100} % → ${pricePctLabel(r.pricePct)}`;
}

function sellRateSection() {
  ui.rateTiers = h('div');
  renderRateTiers();
  const s = settings;
  return section(
    'tdv',
    'Taux de vente',
    'Le taux de vente d\'une carte, c\'est la part de ses enchères terminées qui ont trouvé un acheteur (affiché « 17 / 20 vendues » sur tes cartes). Sur trop peu d\'enchères, il ne veut rien dire : il est alors ignoré partout (minimum, paliers, conditions, tri).',
    [
      h(
        'div',
        { class: 'grid' },
        field(
          'Compter à partir de (enchères terminées)',
          reg('sellRateMinSamples', h('input', { type: 'number', min: '1', max: '1000', value: s.sellRateMinSamples, oninput: (e: Event) => ((s.sellRateMinSamples = num((e.target as HTMLInputElement).value, 5)!), onEdit()) })),
          'Ex. 5 : une carte vendue 1 fois sur 2 enchères n\'a pas de taux de vente pris en compte.',
        ),
        field(
          'Taux de vente minimum (%)',
          reg('minSellRate', h('input', { type: 'number', min: '0', max: '100', value: s.minSellRate ?? '', placeholder: 'aucun', oninput: (e: Event) => ((s.minSellRate = num((e.target as HTMLInputElement).value)), onEdit()) })),
          'Une carte sous ce taux n\'est plus proposée. Vide = aucun minimum.',
        ),
      ),
      h(
        'div',
        { class: 'toggles' },
        settingToggle('sellRateTiersOn', 'Ajuster le prix selon le taux de vente', 'Une carte qui part toute seule peut partir plus haut, une carte qui ne se vend pas doit baisser. 100 % = prix inchangé, 50 % = moitié prix. Le premier palier qui correspond l\'emporte.'),
      ),
      h('div', { class: 'rate-tiers' }, ui.rateTiers),
    ],
    { errKey: 'sellRate' },
  );
}

function renderDurations(): void {
  mount(ui.durations, durationTiers(settings.durationRules, ''));
}

function refreshTiers(): void {
  mount(ui.tiers, tiersPreviewParts(settings.durationRules).map((p) => h('span', { class: 'chip' }, p)));
}

function durationsSection() {
  ui.durations = h('div');
  ui.tiers = h('div', { class: 'tiers-preview', 'aria-live': 'polite' });
  renderDurations();
  return section(
    'durees',
    'Durée des enchères',
    'La durée de chaque enchère selon sa mise de départ. Ex. : une carte à 15 W part 10 min, une carte à 150 W part 3 h. Le premier palier qui correspond l\'emporte.',
    [h('div', { class: 'muted small' }, 'Aperçu :'), ui.tiers, ui.durations],
    { errKey: 'durations' },
  );
}

/** Éditeur de paliers de durée ; `prefix` : préfixe des champs (« » global, « rule:<id>: » par étiquette). */
function durationTiers(rows: DurationRule[], prefix: string): HTMLElement {
  const box = h('div');
  const set = (i: number, key: 'from' | 'to' | 'minutes', v: number | null) => {
    rows[i] = { ...rows[i], [key]: v };
    onEdit();
  };
  const draw = () =>
    mount(
      box,
      rows.length
        ? h(
            'ol',
            { class: 'tiers' },
            rows.map((r, i) =>
              h(
                'li',
                { class: 'row tier' },
                h('span', { class: 'muted small tier-num' }, `Palier ${i + 1}`),
                'Mise de',
                reg(`${prefix}dur:${i}:from`, h('input', { type: 'number', min: '0', value: r.from ?? '', placeholder: '0', 'aria-label': `Palier ${i + 1} : de`, oninput: (e: Event) => set(i, 'from', num((e.target as HTMLInputElement).value)) })),
                'à',
                reg(`${prefix}dur:${i}:to`, h('input', { type: 'number', min: '0', value: r.to ?? '', placeholder: '∞', 'aria-label': `Palier ${i + 1} : à`, oninput: (e: Event) => set(i, 'to', num((e.target as HTMLInputElement).value)) })),
                'W →',
                h(
                  'select',
                  { 'aria-label': `Palier ${i + 1} : durée`, onchange: (e: Event) => set(i, 'minutes', Number((e.target as HTMLSelectElement).value)) },
                  DURATIONS.map((d) => h('option', { value: d.minutes, selected: d.minutes === r.minutes }, d.label)),
                ),
                h(
                  'button',
                  { type: 'button', class: 'danger', title: 'Supprimer ce palier', 'aria-label': `Supprimer le palier ${i + 1}`, onclick: () => (rows.splice(i, 1), draw(), onEdit()) },
                  '✕',
                ),
              ),
            ),
          )
        : null,
      h(
        'div',
        { class: 'row wrap', style: 'margin-top:8px' },
        h('button', { type: 'button', onclick: () => (rows.push(nextTier(rows)), draw(), onEdit()) }, '+ Ajouter un palier'),
        h(
          'button',
          {
            type: 'button',
            title: '≤ 20 W : 10 min · 21–100 W : 1 h · plus de 100 W : 3 h',
            onclick: () => {
              if (rows.length && !confirm('Remplacer tes paliers par la proposition par défaut ?\n\n0–20 W → 10 min · 21–100 W → 1 h · 101 W et + → 3 h')) return;
              rows.splice(0, rows.length, ...DEFAULT_DURATION_TIERS.map((t) => ({ ...t })));
              draw();
              onEdit();
            },
          },
          'Proposition par défaut',
        ),
      ),
    );
  draw();
  return box;
}


/** Où se règle chaque fonctionnalité qui n'est pas dans « Sur le site ». */
const FEATURE_PLACE: Partial<Record<FeatureKey, { where: string; anchor: string }>> = {
  popupSell: { where: 'Ventes → Aide à la vente', anchor: 'aide-vente' },
  rankingSell: { where: 'Ventes → Aide à la vente', anchor: 'aide-vente' },
  packTagAll: { where: 'Étiquettes → Étiquetage automatique', anchor: 'etiquetage-auto' },
  quickOutbid: { where: 'Sur le site → Marché et enchères', anchor: 'fonctionnalites' },
  openAllPacks: { where: 'Sur le site → Paquets', anchor: 'fonctionnalites' },
  autoOpenPacks: { where: 'Sur le site → Paquets', anchor: 'fonctionnalites' },
};

/** Groupe affiché dans « Sur le site » (les automatisations rejoignent ce qu'elles concernent). */
const SITE_GROUP: Partial<Record<FeatureKey, FeatureGroup>> = { quickOutbid: 'market', openAllPacks: 'packs', autoOpenPacks: 'packs' };
const OUTSIDE_SITE: FeatureKey[] = ['popupSell', 'rankingSell', 'packTagAll'];

function featureCard(f: FeatureDef, need?: AccessKey) {
  const flags = featureFlags(settings.features);
  const card = toggleField(
    f.label,
    flags[f.key],
    (box) => {
      if (box.checked && f.risky && !confirmRisk(f.label, f.help)) {
        box.checked = false;
        return;
      }
      settings.features = { ...settings.features, [f.key]: box.checked };
      onEdit();
    },
    undefined,
    [f.risky ? h('span', { class: 'badge risk', title: 'Agit sur le site à ta place' }, '⚠ risque') : null],
    'feature',
  );
  card.querySelector('.toggle-text')!.append(h('span', { class: 'muted small' }, f.help));
  return withNeed(card, need ?? (f.api ? 'apiRead' : undefined));
}

function sellHelpSection() {
  const byKey = (k: FeatureKey) => FEATURES.find((f) => f.key === k)!;
  return section(
    'aide-vente',
    'Aide à la vente',
    'Ce qui t\'aide à mettre en vente plus vite. Le clic final « Mettre aux enchères » reste toujours à toi, sauf les options ⚠ qui le font à ta place.',
    [
      h('h3', null, 'Fenêtre de vente du site'),
      h(
        'div',
        { class: 'toggles' },
        withNeed(settingToggle('sellMarketSummary', 'Résumé du marché', 'Sous « Marché · … » : nombre d\'offres en cours, min, médiane, max.'), 'apiRead'),
        withNeed(settingToggle('sellMarketList', 'Enchères en cours de la carte', 'Sous la fenêtre : prix et durée restante.'), 'apiRead'),
        withNeed(settingToggle('sellMarketHistory', 'Historique des prix', 'À droite de la fenêtre : ventes passées de la carte (graphique, moyenne, taux de vente…).'), 'apiRead'),
      ),
      h('h3', null, 'Actions à ta place'),
      h('div', { class: 'toggles' }, riskyToggle('prefill', 'Ouvrir la vente et pré-remplir le prix', '« Ouvrir » ouvre la carte, sa fenêtre de vente et remplit le prix et la durée. Le clic « Mettre en vente » reste à toi.')),
      h('div', { class: 'feature-grid' }, featureCard(byKey('popupSell')), featureCard(byKey('rankingSell'))),
    ],
  );
}

function salesPanel() {
  return panel('ventes', slotsSection(), protectSection(), pricingSection(), sellRateSection(), durationsSection(), sellHelpSection());
}

// ---------------------------------------------------------------------------
// Étiquettes : quelles cartes y vont, étiquetage automatique
// ---------------------------------------------------------------------------

/** Carte d'une étiquette dans l'onglet Étiquettes : quelles cartes y vont. */
function tagCard(rule: TagRule) {
  const prefix = `rule:${rule.id}:`;
  const when = () => (rule.when ??= { ...EMPTY_CONDITIONS });
  const summary = h('span', { class: 'muted small' });
  const refreshSummary = () => (summary.textContent = conditionsSummary(rule) || 'aucune');
  refreshSummary();
  const edit = (fn: () => void) => () => {
    fn();
    refreshSummary();
    onEdit();
  };
  const bind = <K extends keyof TagRule>(key: K, parse: (v: string) => TagRule[K]) => (e: Event) => {
    rule[key] = parse((e.target as HTMLInputElement).value);
    onEdit();
  };
  const families = [...new Set((store.myFamilies ?? []).map((f) => f.name))].sort((a, b) => a.localeCompare(b));
  const currentFamily = rule.when?.family ?? '';
  return h(
    'div',
    { class: `rule-card${rule.active ? '' : ' inactive'}`, 'data-rule': rule.id, id: `etiquette-${rule.id}` },
    h('div', { class: 'row rule-head' }, activeSwitch(rule), tagInput(rule, false), h('span', { class: 'grow' }), removeRuleButton(rule)),
    h(
      'div',
      { class: 'rule-line' },
      h(
        'label',
        { class: 'inline' },
        'Plage de prix : de',
        reg(`${prefix}floor`, h('input', { type: 'number', min: '0', value: rule.floor ?? '', placeholder: '—', 'aria-label': 'Plancher', oninput: bind('floor', (v) => num(v)) })),
        'à',
        reg(`${prefix}ceiling`, h('input', { type: 'number', min: '0', value: rule.ceiling ?? '', placeholder: '∞', 'aria-label': 'Plafond', oninput: bind('ceiling', (v) => num(v)) })),
        'W',
        hint('Prix moyen des cartes de l\'étiquette. Ne change pas le prix conseillé.'),
      ),
      h(
        'label',
        { class: 'inline' },
        'Pour les ventes, prendre les',
        h(
          'select',
          { 'aria-label': 'Cartes prises pour les ventes', onchange: bind('match', (v) => v as TagRule['match']) },
          h('option', { value: 'tag', selected: rule.match === 'tag' }, MATCH_TEXT.tag),
          h('option', { value: 'price', selected: rule.match === 'price' }, `${MATCH_TEXT.price} (et les conditions)`),
        ),
      ),
    ),
    h(
      'details',
      {
        class: 'rule-extra',
        open: openRuleDetails.has(`when:${rule.id}`),
        ontoggle: (e: Event) => ((e.target as HTMLDetailsElement).open ? openRuleDetails.add(`when:${rule.id}`) : openRuleDetails.delete(`when:${rule.id}`)),
      },
      h('summary', null, h('span', null, 'Conditions en plus'), ' · ', summary),
      h('p', { class: 'muted small' }, 'Avec une condition, l\'étiquetage automatique pose cette étiquette sur chaque carte qui les remplit toutes (et dont le prix est dans la plage, s\'il y en a une). Ex. : une étiquette « Films » pour les cartes de ta famille Films.'),
      h(
        'div',
        { class: 'grid' },
        field(
          'Le nom ou la catégorie contient',
          reg(`${prefix}text`, h('input', { value: rule.when?.text ?? '', placeholder: 'ex. pays, ville', oninput: (e: Event) => edit(() => (when().text = (e.target as HTMLInputElement).value))() })),
          'Un ou plusieurs mots séparés par des virgules (il suffit d\'un) ; accents et majuscules ignorés.',
        ),
        field(
          'Dans la famille',
          h(
            'select',
            { onchange: (e: Event) => edit(() => (when().family = (e.target as HTMLSelectElement).value))() },
            h('option', { value: '' }, '— peu importe —'),
            families.map((f) => h('option', { value: f, selected: f === currentFamily }, f)),
            currentFamily && !families.includes(currentFamily) ? h('option', { value: currentFamily, selected: true }, `${currentFamily} (introuvable)`) : null,
          ),
          families.length ? 'Une de tes familles (menu Familles).' : 'Aucune famille : crée-en dans le menu Familles du site.',
        ),
        field(
          'Taux de vente (%)',
          h(
            'span',
            { class: 'row nowrap' },
            'de',
            reg(`${prefix}rateMin`, h('input', { type: 'number', min: '0', max: '100', value: rule.when?.rateMin ?? '', placeholder: '0', 'aria-label': 'Taux de vente minimum', oninput: (e: Event) => edit(() => (when().rateMin = num((e.target as HTMLInputElement).value)))() })),
            'à',
            reg(`${prefix}rateMax`, h('input', { type: 'number', min: '0', max: '100', value: rule.when?.rateMax ?? '', placeholder: '100', 'aria-label': 'Taux de vente maximum', oninput: (e: Event) => edit(() => (when().rateMax = num((e.target as HTMLInputElement).value)))() })),
          ),
          'Compté à partir du nombre d\'enchères réglé dans Ventes → Taux de vente ; en dessous, l\'étiquette n\'est ni posée ni retirée.',
        ),
      ),
    ),
  );
}

function renderTagRules(): void {
  mount(
    ui.tagRules,
    rules.length ? h('div', { class: 'rule-cards' }, rules.map(tagCard)) : h('p', { class: 'muted' }, 'Aucune étiquette suivie.'),
    h('div', { class: 'row', style: 'margin-top:10px' }, addRuleButton()),
  );
}

function tagRulesSection() {
  ui.tagRules = h('div');
  return section(
    'etiquettes',
    'Mes étiquettes',
    [
      'Ici, tu décides quelles cartes vont dans chaque étiquette : une plage de prix (ex. « 20-50 » = cartes entre 20 et 50 W) et, si tu veux, des conditions. ',
      h('strong', null, 'Ça sert à l\'étiquetage automatique'),
      ' ; les slots et les prix se règlent dans Ventes.',
    ],
    [ui.tagRules],
    { errKey: 'rules' },
  );
}

function refreshAutoTagMode(): void {
  mount(
    ui.autoTagMode,
    settings.apiWrite
      ? h('span', null, '✓ Par l\'API (plus fiable) : les étiquettes sont écrites directement, favoris revérifiés avant chaque écriture.')
      : h('span', null, 'En cliquant dans la fiche de chaque carte (plus lent). ', h('button', { type: 'button', class: 'link', onclick: () => void setAccess('write') }, 'Passer par l\'API…')),
  );
}

function autoTagSection() {
  ui.autoTagMode = h('p', { class: 'muted small auto-mode' });
  const packTagAll = FEATURES.find((f) => f.key === 'packTagAll')!;
  return section(
    'etiquetage-auto',
    'Étiquetage automatique',
    'Range chaque carte dans l\'étiquette dont la plage de prix (et les conditions) lui correspond. Se lance depuis la popup, avec un bouton Arrêter.',
    [
      h('div', { class: 'toggles' }, riskyToggle('autoTag', 'Étiquetage automatique', 'Pose et retire les étiquettes suivies selon le prix moyen de chaque carte.')),
      ui.autoTagMode,
      h(
        'div',
        { class: 'toggles' },
        dependentToggle('autoTagRemoveOthers', 'Retirer les autres étiquettes suivies', 'Ex. une carte passée à 60 W perd « 20-50 » et reçoit « 50-100 ».'),
        dependentToggle('autoTagClearUnpriced', 'Retirer les étiquettes des cartes sans prix connu', 'Défait les classements faits sans prix propre (par ex. à partir de la médiane de la rareté).'),
        withNeed(settingToggle('retagUnsold', 'Remettre les étiquettes des invendues', 'Le site retire les étiquettes d\'une carte mise en vente : si l\'enchère se termine sans acheteur, la carte retrouve les siennes. Avec un onglet du site ouvert.'), 'apiWrite'),
      ),
      h('div', { class: 'feature-grid' }, featureCard(packTagAll, 'apiWrite')),
    ],
  );
}

/** Interrupteur grisé tant que l'étiquetage automatique est coupé. */
function dependentToggle(key: 'autoTagRemoveOthers' | 'autoTagClearUnpriced', label: string, help: string) {
  const el = settingToggle(key, label, help);
  dependent(el.querySelector('input')!, () => settings.autoTag);
  return el;
}

function tagDisplaySection() {
  const s = settings;
  return section(
    'etiquettes-affichage',
    'Sur tes cartes',
    'Comment tes étiquettes s\'affichent dans la collection.',
    [
      h('div', { class: 'toggles' }, settingToggle('showTagOverlay', 'Étiquettes visibles sur les cartes', 'Sur chaque carte de la collection, aux couleurs du site.')),
      field(
        'Style',
        dependent(
          h(
            'select',
            { onchange: (e: Event) => ((s.tagOverlayStyle = (e.target as HTMLSelectElement).value as Settings['tagOverlayStyle']), onEdit()) },
            h('option', { value: 'label', selected: s.tagOverlayStyle === 'label' }, 'libellés détaillés'),
            h('option', { value: 'dot', selected: s.tagOverlayStyle === 'dot' }, 'pastilles de couleur seulement'),
          ),
          () => settings.showTagOverlay,
        ),
        'Pastilles : le nom de l\'étiquette s\'affiche au survol.',
      ),
    ],
  );
}

function tagsPanel() {
  return panel('etiquettes', tagRulesSection(), autoTagSection(), tagDisplaySection());
}

// ---------------------------------------------------------------------------
// Sur le site : intégration, fonctionnalités, notifications
// ---------------------------------------------------------------------------

function featureGroup(group: FeatureGroup, extra: Child = null) {
  const list = FEATURES.filter((f) => !OUTSIDE_SITE.includes(f.key) && (SITE_GROUP[f.key] ?? f.group) === group);
  return h('div', { class: 'feature-group' }, h('h3', null, FEATURE_GROUPS[group]), h('div', { class: 'feature-grid' }, list.map((f) => featureCard(f))), extra);
}

/** Réglages des paquets qui ne sont pas des interrupteurs. */
function packSettings() {
  return h(
    'div',
    { class: 'grid feature-extra' },
    field(
      '« Tout défausser » : confirmer au-delà de (W)',
      reg('discardConfirmAbove', h('input', { type: 'number', min: '0', step: '1', value: settings.discardConfirmAbove, oninput: (e: Event) => ((settings.discardConfirmAbove = Math.max(0, num((e.target as HTMLInputElement).value, 10)!)), onEdit()) })),
      'Si une des cartes obtenues vaut plus que ce prix moyen, une confirmation s\'affiche avant de défausser. 0 = toujours confirmer une carte cotée.',
    ),
  );
}

function sitePanel() {
  const s = settings;
  const time = (key: 'quietStart' | 'quietEnd', label: string) =>
    dependent(h('input', { type: 'time', value: s[key] ?? '', 'aria-label': label, oninput: (e: Event) => ((s[key] = (e.target as HTMLInputElement).value || null), onEdit()) }), () => settings.notifications);
  const groups = (Object.keys(FEATURE_GROUPS) as FeatureGroup[]).filter((g) => g !== 'automation');
  return panel(
    'site',
    section('affichage', 'Intégration au site', 'Ce que Wiki-Traders ajoute dans la mise en page de WikiMasters.', [
      h(
        'div',
        { class: 'toggles' },
        settingToggle('siteIntegration', 'Intégration au site', 'Résumé et menu Wiki-Traders dans la barre latérale, onglet dans Paramètres.'),
        settingToggle('compactNav', 'Barre latérale compacte', 'Menus regroupés (Social, Progression) pour faire de la place.'),
      ),
    ]),
    section('fonctionnalites', 'Fonctionnalités', 'Ajouts aux pages du site, à activer ou couper selon tes goûts.', [groups.map((g) => featureGroup(g, g === 'packs' ? packSettings() : null))]),
    section('notifications', 'Notifications', 'Wiki-Traders te prévient quand une enchère se termine ou qu\'un slot se libère.', [
      h('div', { class: 'toggles' }, settingToggle('notifications', 'Notifications', 'Alertes du navigateur pour tes ventes.')),
      field('Heures silencieuses', h('span', { class: 'row' }, 'de', time('quietStart', 'Début des heures silencieuses'), 'à', time('quietEnd', 'Fin des heures silencieuses')), 'Aucune notification pendant cette plage (ex. la nuit). Vide = toujours prévenu.'),
    ]),
  );
}

// ---------------------------------------------------------------------------
// Avancé
// ---------------------------------------------------------------------------

function renderManual(): void {
  const entries = Object.entries(manualPrices);
  mount(
    ui.manual,
    entries.length
      ? h(
          'table',
          null,
          h('tr', null, h('th', null, 'Carte'), h('th', null, 'Prix moyen saisi'), h('th', null, h('span', { class: 'sr-only' }, 'Supprimer'))),
          entries.map(([id, price]) =>
            h(
              'tr',
              null,
              h('td', null, store.cards[id]?.name ?? id),
              h('td', null, h('input', { type: 'number', value: price, 'aria-label': 'Prix moyen saisi', oninput: (e: Event) => ((manualPrices[id] = num((e.target as HTMLInputElement).value, price)!), onEdit()) }), ' W'),
              h('td', null, h('button', { type: 'button', class: 'danger', 'aria-label': 'Supprimer ce prix', onclick: () => (delete manualPrices[id], renderManual(), onEdit()) }, '✕')),
            ),
          ),
        )
      : h('p', { class: 'muted' }, 'Aucun prix saisi. La popup te demande un prix quand une carte n\'a aucune donnée.'),
  );
}

function cardsBlock() {
  const cards = Object.values(store.cards).sort((a, b) => a.name.localeCompare(b.name));
  return h(
    'details',
    null,
    h('summary', null, `${cards.length} carte(s) connue(s) · dernier relevé de la collection : ${fmtDate(store.meta.lastCollectionScan)}`),
    h(
      'div',
      { class: 'table-wrap scroll' },
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
    ),
  );
}

function selectorsBlock() {
  const area = reg(
    'selectors',
    h('textarea', {
      rows: 8,
      class: 'mono',
      'aria-label': 'Sélecteurs personnalisés (JSON)',
      value: Object.keys(settings.selectorOverrides).length ? JSON.stringify(settings.selectorOverrides, null, 2) : '',
      placeholder: '{\n  "cardTile": "[data-card]"\n}',
      oninput: (e: Event) => {
        const v = (e.target as HTMLTextAreaElement).value.trim();
        try {
          settings.selectorOverrides = v ? JSON.parse(v) : {};
          selectorsInvalid = false;
        } catch {
          selectorsInvalid = true;
        }
        onEdit();
      },
    }),
  );
  return h(
    'details',
    null,
    h('summary', null, 'Sélecteurs avancés (si le site change)'),
    h('p', { class: 'muted small' }, 'Remplace les sélecteurs CSS / motifs utilisés pour lire le site. Valeurs par défaut :'),
    h('pre', { class: 'mono small defaults' }, JSON.stringify(DEFAULT_SELECTORS, null, 2)),
    area,
  );
}


function advancedPanel() {
  const s = settings;
  ui.manual = h('div');
  renderManual();
  const fileInput = h('input', {
    type: 'file',
    accept: 'application/json',
    style: 'display:none',
    onchange: (e: Event) => {
      const f = (e.target as HTMLInputElement).files?.[0];
      if (f) void importSettings(f);
    },
  });
  return panel(
    'avance',
    h(
      'section',
      { class: 'card opt-section', id: 'avance' },
      h('h2', null, 'Pages du site'),
      errorBox('advanced'),
      h(
        'div',
        { class: 'grid' },
        field('Page « mes enchères »', h('input', { value: s.myAuctionsPath ?? '', placeholder: 'auto (onglet « Mes ventes » de /marketplace)', oninput: (e: Event) => ((s.myAuctionsPath = (e.target as HTMLInputElement).value.trim() || null), onEdit()) }), 'Chemin, ex. /marketplace?tab=mine. Vide = automatique.'),
        field('Page ouverte par « Ouvrir »', h('input', { value: s.sellPath, oninput: (e: Event) => ((s.sellPath = (e.target as HTMLInputElement).value.trim() || DEFAULT_SETTINGS.sellPath), onEdit()) }), `Par défaut ${DEFAULT_SETTINGS.sellPath}.`),
      ),
      selectorsBlock(),
    ),
    section('prix-saisis', 'Prix saisis à la main', null, [ui.manual]),
    section('donnees', 'Données', null, [cardsBlock()]),
    section('maj', 'Mises à jour', 'Compare ta version avec la dernière publiée sur GitHub et installe les nouveautés en un clic (programme d\'aide à installer une fois).', [updatePanel()]),
    section('sauvegarde', 'Sauvegarde', 'Exporte tes réglages (étiquettes, paliers, prix saisis) dans un fichier JSON, pour les garder ou les copier sur un autre navigateur.', [
      h(
        'div',
        { class: 'row wrap' },
        h('button', { type: 'button', onclick: exportSettings }, 'Exporter (JSON)'),
        h('button', { type: 'button', onclick: () => fileInput.click() }, 'Importer…'),
        fileInput,
        h('span', { class: 'grow' }),
        h('button', { type: 'button', class: 'danger', onclick: wipe }, 'Effacer toutes les données'),
      ),
    ]),
  );
}

// ---------------------------------------------------------------------------
// Validation, enregistrement automatique
// ---------------------------------------------------------------------------

function showErrors(): void {
  for (const [key, el] of ui.fields) {
    if (!el.isConnected) {
      ui.fields.delete(key);
      continue;
    }
    el.classList.remove('invalid');
    el.removeAttribute('aria-invalid');
  }
  for (const e of errors) {
    for (const k of e.keys) {
      const el = ui.fields.get(k);
      if (!el) continue;
      el.classList.add('invalid');
      el.setAttribute('aria-invalid', 'true');
      el.title = e.message;
    }
  }
  // Chaque erreur va dans l'encadré de la section qui contient son champ (sinon le premier de sa catégorie).
  const home = (e: ValidationError) => {
    const boxes = ui.errorBoxes.filter((b) => b.key === e.section);
    const el = e.keys.map((k) => ui.fields.get(k)).find((x) => x?.isConnected);
    return (el && boxes.find((b) => b.box.closest('section')?.contains(el))) ?? boxes[0];
  };
  for (const entry of ui.errorBoxes) {
    const { box } = entry;
    const msgs = errors.filter((e) => home(e) === entry);
    box.hidden = !msgs.length;
    mount(box, msgs.length ? h('ul', null, msgs.map((m) => h('li', null, m.message))) : null);
  }
}


function focusFirstError(): void {
  const first = errors[0];
  if (!first) return;
  const el = first.keys.map((k) => ui.fields.get(k)).find((x) => x?.isConnected);
  if (!el) return;
  const tab = el.closest<HTMLElement>('[role=tabpanel]')?.dataset.tab as TabId | undefined;
  if (tab && tab !== activeTab) showTab(tab);
  const details = el.closest('details');
  if (details) details.open = true;
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  (el as HTMLInputElement).focus({ preventScroll: true });
}

function updateBar(): void {
  const dirty = isDirty(baseline, { rules, settings, manualPrices });
  document.documentElement.classList.toggle('dirty', dirty);
  ui.undoBtn.hidden = !undoPoint || dirty || !!errors.length;
  if (errors.length) {
    const n = errors.length;
    mount(
      ui.status,
      h('button', { type: 'button', class: 'link error', title: 'Aller au champ', onclick: focusFirstError }, `⚠ Pas enregistré : ${n} erreur${n > 1 ? 's' : ''} à corriger (${errors[0].message})`),
    );
    ui.status.className = 'status error';
  } else if (dirty) {
    mount(ui.status, h('span', { class: 'dot', 'aria-hidden': 'true' }), 'Enregistrement…');
    ui.status.className = 'status dirty';
  } else if (notice) {
    mount(ui.status, notice.text);
    ui.status.className = `status ${notice.kind}`;
  } else {
    mount(ui.status, 'Les modifications sont enregistrées automatiquement.');
    ui.status.className = 'status muted';
  }
}

/** Mise à jour après une saisie : uniquement les résumés et aperçus concernés. */
function refreshLive(): void {
  refreshQuota();
  refreshQuickStart();
  refreshProfiles();
  refreshAccess();
  refreshAutoTagMode();
  refreshTiers();
  refreshFallback();
  ui.rounding.textContent = `ex. ${roundingExamples(settings.rounding)}`;
  for (const [rule, el] of ui.pctExamples) el.textContent = pctExample(rule.pct, settings.rounding);
  for (const x of ui.rateExamples) {
    const row = x.row();
    if (row) x.el.textContent = rateTierExample(row.pricePct, settings.rounding);
  }
  for (const n of ui.needs) n.el.hidden = settings[n.key];
  for (const d of ui.dependents) d.el.disabled = !d.enabled();
  document.querySelector('.rate-tiers')?.classList.toggle('off', !settings.sellRateTiersOn);
  errors = validateOptions(rules, settings, { selectorsInvalid });
  showErrors();
}

function onEdit(): void {
  notice = null;
  undoPoint ??= baseline;
  refreshLive();
  updateBar();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => void saveAll(), AUTOSAVE_MS);
}

async function saveAll(): Promise<void> {
  clearTimeout(saveTimer);
  saveTimer = undefined;
  errors = validateOptions(rules, settings, { selectorsInvalid });
  showErrors();
  if (errors.length || !isDirty(baseline, { rules, settings, manualPrices })) return updateBar();
  // Étiquettes nettoyées sur place : les champs gardent leurs liens (et le focus) sans être redessinés.
  for (const r of rules) {
    const tag = r.tag.trim();
    if (tag === r.tag) continue;
    r.tag = tag;
    for (const input of ui.tagInputs.get(r.id) ?? []) if (document.activeElement !== input) input.value = tag;
  }
  await save({ rules, settings, manualPrices });
  await ext.runtime.sendMessage({ type: 'refreshBadge' }).catch(() => {});
  baseline = snapshot({ rules, settings, manualPrices });
  notice = { text: `✓ Enregistré à ${new Date().toLocaleTimeString('fr-FR')}`, kind: 'ok' };
  updateBar();
}

/** Revient à l'état d'avant la dernière série de modifications, et l'enregistre. */
async function undo(): Promise<void> {
  if (!undoPoint) return;
  const b = JSON.parse(undoPoint) as { rules: TagRule[]; settings: Settings; manualPrices: Record<string, number> };
  undoPoint = null;
  rules = b.rules;
  settings = b.settings;
  manualPrices = b.manualPrices;
  selectorsInvalid = false;
  render();
  await saveAll();
  notice = { text: 'Modifications annulées.', kind: 'ok' };
  updateBar();
}

function exportSettings(): void {
  downloadJson(`wiki-traders-reglages-${new Date().toISOString().slice(0, 10)}.json`, { version: 1, rules, settings, manualPrices });
}

async function importSettings(file: File): Promise<void> {
  try {
    const data = JSON.parse(await file.text());
    if (!Array.isArray(data.rules) || typeof data.settings !== 'object') throw new Error('format');
    rules = migrateRules(data.rules);
    settings = migrateSettings(data.settings);
    manualPrices = data.manualPrices ?? {};
    selectorsInvalid = false;
    render();
    await saveAll();
  } catch {
    notice = { text: 'Fichier de réglages invalide.', kind: 'error' };
    updateBar();
  }
}

async function wipe(): Promise<void> {
  if (!confirm('Effacer toutes les données de Wiki-Traders (règles, cartes, historique, journal) ?')) return;
  await clearAll();
  await load();
  notice = { text: 'Toutes les données ont été effacées.', kind: 'ok' };
  updateBar();
}


// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

function render(): void {
  const scroll = scrollY;
  ui.fields.clear();
  ui.needs = [];
  ui.dependents = [];
  ui.risky = {};
  ui.rateExamples = [];
  ui.tabs.clear();
  ui.errorBoxes = [];
  ui.status = h('span', { class: 'status muted', role: 'status', 'aria-live': 'polite' });
  ui.undoBtn = h('button', { type: 'button', class: 'small', hidden: true, title: 'Revenir à l\'état d\'avant tes dernières modifications', onclick: () => void undo() }, 'Annuler') as HTMLButtonElement;
  const tabs = tabBar();
  const panels = [homePanel(), salesPanel(), tagsPanel(), sitePanel(), panel('acces', accessSection()), advancedPanel()];
  renderRules();
  mount(
    app,
    h(
      'header',
      { class: 'row' },
      h('img', { src: 'icons/icon-48.png', width: 32, height: 32, alt: '' }),
      h('h1', { class: 'grow' }, 'Wiki-Traders – Réglages'),
      h('a', { href: 'journal.html' }, 'Journal →'),
    ),
    h('div', { class: 'tabs-wrap' }, tabs),
    h('main', { class: 'panels' }, panels),
    h('footer', { class: 'row sticky savebar' }, ui.status, ui.undoBtn),
  );
  showTab(activeTab);
  refreshLive();
  updateBar();
  scrollTo(0, scroll);
}

async function load(): Promise<void> {
  store = await loadAll();
  rules = structuredClone(store.rules);
  settings = structuredClone(store.settings);
  manualPrices = { ...store.manualPrices };
  selectorsInvalid = false;
  baseline = snapshot({ rules, settings, manualPrices });
  undoPoint = null;
  render();
  const anchor = location.hash.slice(1);
  if (anchor) {
    const tab = TABS.find(([id]) => id === anchor)?.[0];
    if (tab) showTab(tab);
    else scrollToSection(LEGACY_ANCHORS[anchor] ?? anchor);
  }
}

// Ctrl/Cmd+S enregistre tout de suite ; en quittant la page, ce qui attend est enregistré.
addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 's') {
    e.preventDefault();
    void saveAll();
  }
});
addEventListener('pagehide', () => {
  if (saveTimer) void saveAll();
});
addEventListener('beforeunload', (e) => {
  if (!embedded && settings && errors.length && isDirty(baseline, { rules, settings, manualPrices })) e.preventDefault();
});

void load();
