import './common.css';
import './options.css';
import { ext } from '../lib/browser';
import { CARD_PRICES_KEY, DEFAULT_RULES, DEFAULT_SETTINGS, SITE_ORIGIN } from '../lib/defaults';
import { DURATIONS } from '../lib/duration';
import { clearAll, loadAll, migrateRules, migrateSettings, save } from '../lib/storage';
import { formatPrice, RARITIES } from '../lib/text';
import { conditionsSummary, EMPTY_CONDITIONS, ruleSummary } from '../lib/conditions';
import { FORMULA_VARS, formulaError } from '../lib/formula';
import { sellRateOfCache, type RateEntry } from '../lib/sellrate';
import { allocate } from '../lib/allocation';
import { catalogPriceOf, type CatalogPriceEntry } from '../lib/autotag';
import { roundTo } from '../lib/pricing';
import { clampPrice, DEFAULT_CALC, defaultTiers, inheritCalc, newTier, PRIORITIES, simplePrice, tierLabel } from '../lib/salecalc';
import { DEFAULT_CRITERIA, SORT_KEYS } from '../lib/sorting';
import { applyView, DEFAULT_VIEW_ICON, newView, SITE_ONLY_SORTS, viewHref, viewIconSvg, viewSummary, VIEW_ICONS, VIEW_SORTS, type CollectionView, type TriState, type ViewContext, type ViewSortKey } from '../lib/views';
import { familiesOf, familyIndex } from '../lib/families';
import type { DurationRule, FamilyTag, PriceCalc, Rarity, RuleAlternative, PriceCalcMode, PriceTier, Settings, SortCriterion, SortKey, StoreShape, TagRule } from '../lib/types';
import { DEFAULT_SELECTORS } from '../content/parsers/selectors';
import { downloadJson, fmtDate, h, mount } from './dom';
import { updatePanel } from './update-panel';
import { embedded, initEmbed } from './embed';
import { FEATURE_GROUPS, FEATURES, featureFlags, type FeatureDef, type FeatureGroup, type FeatureKey } from '../lib/features';
import {
  DEFAULT_DURATION_TIERS,
  isDirty,
  nextTier,
  quickStartChecks,
  quotaSummary,
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

type TabId = 'accueil' | 'ventes' | 'etiquettes' | 'familles' | 'interface' | 'site' | 'acces' | 'avance';

const TABS: [id: TabId, label: string][] = [
  ['accueil', 'Accueil'],
  ['ventes', 'Ventes'],
  ['etiquettes', 'Étiquettes'],
  ['familles', 'Familles'],
  ['interface', 'Interface'],
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
  tiers: null as unknown as HTMLElement,
  priceTiers: null as unknown as HTMLElement,
  saleTags: null as unknown as HTMLElement,
  familyTags: null as unknown as HTMLElement,
  views: null as unknown as HTMLElement,
  priority: null as unknown as HTMLElement,
  preview: null as unknown as HTMLElement,
  tierTitles: [] as { el: HTMLElement; tier: PriceTier }[],
  calcExamples: [] as { el: HTMLElement; calc: () => PriceCalc }[],
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
      if (pool()) return h('button', { type: 'button', class: 'small', onclick: () => scrollToSection('cartes-a-vendre') }, 'Choisir les cartes à vendre');
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
            ['etiquettes', 'Étiquettes', 'quelles cartes reçoivent chaque étiquette et l\'étiquetage automatique (à la demande ou en continu).'],
            ['familles', 'Familles', 'tes familles sur le site, une étiquette par famille, et si leurs cartes peuvent être vendues.'],
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
// Ventes : mode, cartes à vendre, étiquettes (mode « par étiquette »)
// ---------------------------------------------------------------------------

const pool = () => settings.allocationMode === 'pool';

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

/** Carte d'une étiquette dans l'onglet Ventes (mode « par étiquette ») : slots, exemplaires gardés, calcul, durée. */
function saleCard(rule: TagRule) {
  const bind = <K extends keyof TagRule>(key: K, parse: (v: string) => TagRule[K]) => (e: Event) => {
    rule[key] = parse((e.target as HTMLInputElement).value);
    onEdit();
  };
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
        'Garder',
        h('input', { type: 'number', min: '0', value: rule.keepMin, 'aria-label': 'Exemplaires gardés', oninput: bind('keepMin', (v) => num(v, 1)!) }),
        'exemplaire(s)',
        hint('Exemplaires jamais vendus : avec 1, ton dernier exemplaire reste toujours dans ta collection ; seuls les doublons partent.'),
      ),
      durationSelect(() => rule.durationMin ?? null, (v) => (rule.durationMin = v)),
    ),
    rule.match === 'price'
      ? h(
          'div',
          { class: 'muted small rule-source' },
          `Cartes proposées : ${MATCH_TEXT.price} (ancien réglage). `,
          h('button', { type: 'button', class: 'link', onclick: () => ((rule.match = 'tag'), renderRules(), onEdit()) }, 'Prendre les cartes qui portent l\'étiquette'),
        )
      : null,
    calcEditor(() => rule.calc ?? inheritCalc(), (c) => (rule.calc = c), `rule:${rule.id}:`, true),
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
    h('span', { class: 'muted small' }, 'Étiquettes de ta collection pas encore suivies :'),
    missing.map(([tag, n]) =>
      h(
        'button',
        {
          type: 'button',
          class: 'small',
          title: 'Suivre cette étiquette (garder 0 : l\'étiquette désigne les cartes à vendre)',
          onclick: () => {
            rules.push({ id: newId(), tag, quota: 1, floor: null, ceiling: null, keepMin: 0, active: true, match: 'tag' });
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
        const rule: TagRule = { id: newId(), tag: '', quota: 1, floor: null, ceiling: null, keepMin: 1, active: true, match: 'tag' };
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
  ui.tagInputs.clear();
  mount(
    ui.rules,
    rules.length ? h('div', { class: 'rule-cards' }, rules.map(saleCard)) : h('p', { class: 'muted' }, 'Aucune étiquette : ajoute-en une pour que Wiki-Traders te propose des ventes.'),
    h('div', { class: 'row', style: 'margin-top:10px' }, addRuleButton()),
    detectedTagsBlock(),
  );
  renderTagRules();
}


/** Panneaux repliés ouverts (gardés ouverts quand une liste est redessinée). */
const openRuleDetails = new Set<string>();

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


// ---------------------------------------------------------------------------
// Calcul du prix : option A (par défaut), B1 (simple), B2 (formule)
// ---------------------------------------------------------------------------

const CALC_MODES: { mode: PriceCalcMode; label: string; help: string }[] = [
  { mode: 'default', label: 'Par défaut', help: 'Suit le calcul du prix par défaut.' },
  { mode: 'simple', label: 'Simple', help: 'Prix moyen × mise de départ, ajusté par le taux de vente.' },
  { mode: 'formula', label: 'Avancé', help: 'Ta propre formule, avec les variables de la carte.' },
];

/** Exemple du calcul simple : carte à 40 W qui se vend bien, mal, ou presque jamais mise en vente. */
function simpleExamples(c: PriceCalc): string {
  const at = (sold: number, total: number) => {
    const rate = total ? { sold, total, pct: Math.round((sold / total) * 100) } : null;
    return `${formatPrice(roundTo(clampPrice(simplePrice(40, rate, c), c), settings.rounding))} W`;
  };
  return `Carte à 40 W : ${at(16, 20)} si elle se vend 16 fois sur 20 · ${at(4, 20)} si 4 sur 20 · ${at(1, 2)} si 1 sur 2 (trop peu pour compter).`;
}

/**
 * Éditeur d'un calcul de prix. `allowDefault` : option A (palier ou étiquette) ; `prefix` : clés des champs pour
 * les erreurs. Change de mode sans perdre les valeurs saisies dans l'autre.
 */
function calcEditor(get: () => PriceCalc, set: (c: PriceCalc) => void, prefix: string, allowDefault: boolean): HTMLElement {
  const box = h('div', { class: 'calc' });
  const draw = () => {
    const c = get();
    const example = h('p', { class: 'muted small calc-example' }, c.mode === 'simple' ? simpleExamples(c) : '');
    ui.calcExamples.push({ el: example, calc: get });
    const numField = (key: 'pct' | 'tdvWeight' | 'trustSales' | 'minPrice' | 'maxPrice', label: string, attrs: Record<string, string>, help: string, nullable = false) =>
      field(
        label,
        reg(
          `${prefix}${key}`,
          h('input', {
            type: 'number',
            ...attrs,
            'aria-label': label,
            value: c[key] ?? '',
            placeholder: nullable ? 'aucun' : '',
            oninput: (e: Event) => {
              const v = num((e.target as HTMLInputElement).value);
              (c as unknown as Record<string, number | null>)[key] = nullable ? v : v ?? (DEFAULT_CALC[key] as number);
              set(c);
              onEdit();
            },
          }),
        ),
        help,
      );
    const formula = reg(
      `${prefix}formula`,
      h('textarea', {
        rows: 2,
        class: 'formula',
        spellcheck: 'false',
        'aria-label': 'Formule de prix',
        oninput: (e: Event) => {
          c.formula = (e.target as HTMLTextAreaElement).value;
          set(c);
          checkFormula();
          onEdit();
        },
      }),
    ) as HTMLTextAreaElement;
    formula.value = c.formula;
    const formulaState = h('div', { class: 'small formula-state', 'aria-live': 'polite' });
    const checkFormula = () => {
      const err = c.formula.trim() ? formulaError(c.formula) : 'formule vide';
      formulaState.className = `small formula-state ${err ? 'bad' : 'ok'}`;
      formulaState.textContent = err ? `⚠ ${err}` : '✓ formule valide';
    };
    checkFormula();
    mount(
      box,
      h(
        'div',
        { class: 'segmented', role: 'radiogroup', 'aria-label': 'Calcul du prix' },
        CALC_MODES.filter((m) => allowDefault || m.mode !== 'default').map((m) =>
          h(
            'button',
            {
              type: 'button',
              role: 'radio',
              'aria-checked': String(c.mode === m.mode),
              title: m.help,
              class: c.mode === m.mode ? 'is-on' : undefined,
              onclick: () => {
                if (c.mode === m.mode) return;
                set({ ...c, mode: m.mode });
                draw();
                onEdit();
              },
            },
            m.label,
          ),
        ),
      ),
      c.mode === 'default'
        ? h('p', { class: 'muted small' }, `Calcul par défaut : ${calcSummary(settings.defaultCalc)}.`)
        : [
            c.mode === 'simple'
              ? h(
                  'div',
                  { class: 'grid' },
                  numField('pct', 'Mise de départ (% du prix moyen)', { min: '1', max: '500' }, '70 = 70 % du prix moyen de la carte.'),
                  numField('tdvWeight', 'Influence du taux de vente (%)', { min: '0', max: '100', step: '5' }, '0 = aucune. 50 : une carte vendue à 80 % part 15 % plus haut, à 20 % 15 % plus bas.'),
                  numField('trustSales', 'Enchères pour être sûr', { min: '1' }, 'En dessous, le taux de vente compte en partie : 1 vente sur 2 enchères ne fait pas un vrai 50 %.'),
                )
              : h(
                  'div',
                  { class: 'formula-box' },
                  formula,
                  formulaState,
                  h(
                    'div',
                    { class: 'row wrap formula-vars' },
                    h('span', { class: 'muted small' }, 'Variables :'),
                    FORMULA_VARS.map((v) =>
                      h(
                        'button',
                        {
                          type: 'button',
                          class: 'chip',
                          title: v.help,
                          onclick: () => {
                            const at = formula.selectionStart ?? formula.value.length;
                            formula.value = `${formula.value.slice(0, at)}{${v.name}}${formula.value.slice(formula.selectionEnd ?? at)}`;
                            formula.dispatchEvent(new Event('input'));
                            formula.focus();
                          },
                        },
                        `{${v.name}}`,
                      ),
                    ),
                  ),
                  h('p', { class: 'muted small' }, 'Le résultat est le prix de départ (W). Opérations + − * / ^, comparaisons, && ||, si(condition, alors, sinon), min, max, arrondi… Ex. : {prix} * 0.7 * si({tdv} < 20, 0.8, 1).'),
                ),
            example,
            h(
              'div',
              { class: 'grid' },
              numField('minPrice', 'Prix minimum (W)', { min: '1' }, 'En dessous, le prix devient ce minimum (ex. 25).', true),
              numField('maxPrice', 'Prix maximum (W)', { min: '1' }, 'Au-dessus, le prix devient ce maximum.', true),
            ),
          ],
    );
  };
  draw();
  return box;
}

/** « 70 % du prix moyen, taux de vente 50 %, minimum 25 W ». */
function calcSummary(c: PriceCalc): string {
  const parts = c.mode === 'formula' ? ['formule'] : [`${c.pct} % du prix moyen`, c.tdvWeight ? `taux de vente ${c.tdvWeight} %` : 'sans taux de vente'];
  if (c.minPrice != null) parts.push(`minimum ${c.minPrice} W`);
  if (c.maxPrice != null) parts.push(`maximum ${c.maxPrice} W`);
  return parts.join(', ');
}

/** Durée de l'enchère d'un palier ou d'une étiquette (vide = paliers de durée généraux). */
function durationSelect(get: () => number | null, set: (v: number | null) => void) {
  return h(
    'label',
    { class: 'inline' },
    'Durée',
    h(
      'select',
      { 'aria-label': 'Durée de l\'enchère', onchange: (e: Event) => (set((e.target as HTMLSelectElement).value ? Number((e.target as HTMLSelectElement).value) : null), onEdit()) },
      h('option', { value: '', selected: get() == null }, 'selon la mise (Durée des enchères)'),
      DURATIONS.map((d) => h('option', { value: d.minutes, selected: d.minutes === get() }, d.label)),
    ),
  );
}

function calcSection() {
  const s = settings;
  ui.rounding = h('span', { class: 'muted small' });
  ui.fallback = h('select', { onchange: (e: Event) => ((s.fallbackTag = (e.target as HTMLSelectElement).value || null), onEdit()) });
  ui.fallbackKey = '';
  refreshFallback();
  return section(
    'prix',
    'Calcul du prix par défaut',
    pool() ? 'Le prix de départ de chaque carte, sauf pour un palier qui a son propre calcul.' : 'Le prix de départ de chaque carte, sauf pour une étiquette qui a son propre calcul.',
    [
      calcEditor(() => s.defaultCalc, (c) => (s.defaultCalc = c), 'calc:', false),
      h(
        'div',
        { class: 'grid' },
        field(
          'Arrondi (W)',
          h('input', { type: 'number', min: '0', value: s.rounding, oninput: (e: Event) => ((s.rounding = num((e.target as HTMLInputElement).value, 0)!), onEdit()) }),
          h('span', { class: 'small' }, h('span', { class: 'muted' }, '0 = automatique. '), ui.rounding),
          'Pas d\'arrondi du prix de départ. Automatique : à l\'unité sous 20 W, à 5 sous 100, à 10 sous 1 000.',
        ),
      ),
      fine(
        'Réglages fins : calcul du prix moyen' + (pool() ? '' : ', étiquette de secours'),
        h(
          'div',
          { class: 'grid' },
          field(
            'Statistique',
            h(
              'select',
              { onchange: (e: Event) => ((s.stat = (e.target as HTMLSelectElement).value as Settings['stat']), onEdit()) },
              h('option', { value: 'median', selected: s.stat === 'median' }, 'médiane (conseillé)'),
              h('option', { value: 'mean', selected: s.stat === 'mean' }, 'moyenne'),
            ),
            'Médiane : le prix du milieu des ventes, qu\'une vente exceptionnelle ne fausse pas.',
          ),
          field('Période observée (jours)', h('input', { type: 'number', min: '1', max: '90', value: s.windowDays, oninput: (e: Event) => ((s.windowDays = num((e.target as HTMLInputElement).value, 7)!), onEdit()) }), 'Seules les ventes de ces derniers jours comptent.'),
          pool() ? null : field('Étiquette de secours', ui.fallback, 'Quand une étiquette n\'a plus aucune carte à vendre, son slot reçoit une carte de celle-ci.'),
        ),
        h('div', { class: 'toggles' }, settingToggle('includeListings', 'Compter les enchères en cours dans le prix moyen', 'Par défaut, seules les ventes terminées comptent : une enchère en cours peut encore monter.')),
      ),
    ],
    { errKey: 'pricing' },
  );
}

// ---------------------------------------------------------------------------
// Meilleures cartes : filtre d'étiquettes et paliers de prix
// ---------------------------------------------------------------------------

/** Étiquettes connues : celles de la collection, plus celles déjà choisies. */
function knownTags(): string[] {
  const set = new Map<string, string>();
  for (const c of Object.values(store.cards)) for (const t of c.tags) set.set(t.toLowerCase(), t);
  for (const t of settings.saleTags.tags) set.set(t.toLowerCase(), t);
  for (const r of rules) if (r.tag.trim()) set.set(r.tag.trim().toLowerCase(), r.tag.trim());
  return [...set.values()].sort((a, b) => a.localeCompare(b));
}

function renderSaleTags(): void {
  const st = settings.saleTags;
  const tags = knownTags();
  const has = (t: string) => st.tags.some((x) => x.toLowerCase() === t.toLowerCase());
  mount(
    ui.saleTags,
    tags.length
      ? h(
          'div',
          { class: 'tag-chips', role: 'group', 'aria-label': 'Étiquettes' },
          tags.map((t) =>
            h(
              'button',
              {
                type: 'button',
                class: `tag-chip${has(t) ? ' is-on' : ''}`,
                'aria-pressed': String(has(t)),
                onclick: () => {
                  st.tags = has(t) ? st.tags.filter((x) => x.toLowerCase() !== t.toLowerCase()) : [...st.tags, t];
                  renderSaleTags();
                  onEdit();
                },
              },
              has(t) ? `✓ ${t}` : t,
            ),
          ),
        )
      : h('p', { class: 'muted small' }, 'Aucune étiquette connue : ouvre ta collection sur le site pour que Wiki-Traders la relève.'),
    h(
      'p',
      { class: 'muted small' },
      st.mode === 'include'
        ? st.tags.length
          ? `Seules les cartes avec ${st.tags.length > 1 ? 'une de ces étiquettes' : 'cette étiquette'} sont proposées.`
          : '⚠ Aucune étiquette choisie : rien ne sera proposé.'
        : st.tags.length
          ? `Toutes tes cartes sont proposées, sauf celles avec ${st.tags.length > 1 ? 'une de ces étiquettes' : 'cette étiquette'}.`
          : 'Toutes tes cartes peuvent être proposées.',
    ),
  );
}

function saleFilterSection() {
  const st = settings.saleTags;
  ui.saleTags = h('div');
  renderSaleTags();
  return section(
    'cartes-a-vendre',
    'Quelles cartes vendre',
    'C\'est le seul endroit où les étiquettes comptent pour la vente : le reste se règle par prix.',
    [
      h(
        'div',
        { class: 'grid' },
        field(
          'Cartes proposées',
          h(
            'select',
            {
              onchange: (e: Event) => {
                st.mode = (e.target as HTMLSelectElement).value as Settings['saleTags']['mode'];
                renderSaleTags();
                onEdit();
              },
            },
            h('option', { value: 'exclude', selected: st.mode === 'exclude' }, 'toutes, sauf celles avec ces étiquettes'),
            h('option', { value: 'include', selected: st.mode === 'include' }, 'seulement celles avec ces étiquettes'),
          ),
        ),
        field(
          'Exemplaires gardés',
          h('input', { type: 'number', min: '0', value: settings.keepMin, oninput: (e: Event) => ((settings.keepMin = Math.max(0, num((e.target as HTMLInputElement).value, 1)!)), onEdit()) }),
          '1 = ton dernier exemplaire reste toujours dans ta collection ; seuls les doublons partent.',
        ),
      ),
      ui.saleTags,
    ],
  );
}

function tierCard(t: PriceTier, i: number) {
  const bound = (key: 'from' | 'to', placeholder: string, label: string) =>
    reg(`tier:${t.id}:${key}`, h('input', { type: 'number', min: '0', value: t[key] ?? '', placeholder, 'aria-label': label, oninput: (e: Event) => ((t[key] = num((e.target as HTMLInputElement).value)), refreshTierTitles(), onEdit()) }));
  const list = settings.priceTiers;
  const title = h('strong', { class: 'tier-title' }, tierLabel(t));
  ui.tierTitles.push({ el: title, tier: t });
  return h(
    'div',
    { class: `rule-card${t.active ? '' : ' inactive'}`, 'data-tier': t.id },
    h(
      'div',
      { class: 'row rule-head' },
      switchInput(t.active, (box) => ((t.active = box.checked), box.closest('.rule-card')?.classList.toggle('inactive', !box.checked), onEdit()), `Palier ${tierLabel(t)} actif`),
      title,
      h('span', { class: 'grow' }),
      h('button', { type: 'button', class: 'small', title: 'Monter', disabled: i === 0, onclick: () => (list.splice(i - 1, 0, ...list.splice(i, 1)), renderTiers(), onEdit()) }, '▲'),
      h('button', { type: 'button', class: 'small', title: 'Descendre', disabled: i === list.length - 1, onclick: () => (list.splice(i + 1, 0, ...list.splice(i, 1)), renderTiers(), onEdit()) }, '▼'),
      h('button', { type: 'button', class: 'danger', title: 'Supprimer ce palier', 'aria-label': `Supprimer le palier ${tierLabel(t)}`, onclick: () => (list.splice(i, 1), renderTiers(), onEdit()) }, '✕'),
    ),
    h(
      'div',
      { class: 'rule-line' },
      h('label', { class: 'inline' }, 'Prix moyen de', bound('from', '0', 'Palier : de'), 'à', bound('to', '∞', 'Palier : à'), 'W'),
      settings.reserveTierSlots
        ? h('label', { class: 'inline' }, 'Réserve', reg(`tier:${t.id}:slots`, h('input', { type: 'number', min: '0', value: t.slots, 'aria-label': 'Slots réservés', oninput: (e: Event) => ((t.slots = num((e.target as HTMLInputElement).value, 0)!), onEdit()) })), 'slot(s)')
        : null,
      durationSelect(() => t.durationMin, (v) => (t.durationMin = v)),
    ),
    calcEditor(() => t.calc, (c) => (t.calc = c), `tier:${t.id}:`, true),
  );
}

function refreshTierTitles(): void {
  for (const x of ui.tierTitles) x.el.textContent = tierLabel(x.tier);
}

function renderTiers(): void {
  ui.tierTitles = [];
  const list = settings.priceTiers;
  mount(
    ui.priceTiers,
    list.length
      ? h('div', { class: 'rule-cards' }, list.map(tierCard))
      : h('p', { class: 'muted' }, 'Aucun palier : toutes les cartes suivent le calcul par défaut. Ajoute des paliers pour régler le prix (et le minimum) selon la valeur des cartes.'),
    h(
      'div',
      { class: 'row wrap', style: 'margin-top:10px' },
      h(
        'button',
        {
          type: 'button',
          onclick: () => {
            const last = list.at(-1);
            const from = last?.to != null ? last.to + 1 : null;
            list.push(newTier(from, null));
            renderTiers();
            onEdit();
          },
        },
        '+ Ajouter un palier',
      ),
      list.length
        ? null
        : h('button', { type: 'button', onclick: () => (list.push(...defaultTiers()), renderTiers(), onEdit()) }, 'Proposition : jusqu\'à 20 W · 21–100 W · 101 W et +'),
    ),
  );
}

function tiersSection() {
  ui.priceTiers = h('div');
  renderTiers();
  return section(
    'paliers',
    'Paliers de prix',
    'Chaque palier regroupe les cartes selon leur prix moyen et peut avoir son propre calcul, son prix minimum et sa durée. Une carte prend le premier palier qui la contient ; une carte hors de tous les paliers n\'est pas proposée.',
    [
      h(
        'div',
        { class: 'toggles' },
        toggleField(
          'Réserver des slots par palier',
          settings.reserveTierSlots,
          (box) => {
            settings.reserveTierSlots = box.checked;
            renderTiers();
            onEdit();
          },
          'Ex. 2 slots toujours pour les cartes de plus de 100 W. Les slots non réservés vont aux meilleures cartes, tous paliers confondus.',
        ),
      ),
      ui.priceTiers,
    ],
    { errKey: 'tiers' },
  );
}

// ---------------------------------------------------------------------------
// Priorité et aperçu
// ---------------------------------------------------------------------------

function renderPriority(): void {
  const s = settings;
  const formula = reg(
    'priorityFormula',
    h('textarea', { rows: 2, class: 'formula', spellcheck: 'false', 'aria-label': 'Formule de priorité', oninput: (e: Event) => ((s.priorityFormula = (e.target as HTMLTextAreaElement).value), onEdit()) }),
  ) as HTMLTextAreaElement;
  formula.value = s.priorityFormula;
  mount(
    ui.priority,
    h(
      'div',
      { class: 'priorities', role: 'radiogroup', 'aria-label': 'Priorité' },
      PRIORITIES.map((p) =>
        h(
          'label',
          { class: `level${s.priority === p.id ? ' is-on' : ''}` },
          h('input', {
            type: 'radio',
            name: 'priority',
            value: p.id,
            checked: s.priority === p.id,
            onchange: () => {
              s.priority = p.id;
              if (p.id === 'custom' && !s.sortCriteria.length) s.sortCriteria = DEFAULT_CRITERIA.map((c) => ({ ...c }));
              renderPriority();
              onEdit();
            },
          }),
          h('span', { class: 'level-text' }, h('strong', null, p.label, p.id === 'balanced' ? h('span', { class: 'badge ok' }, 'conseillé') : null), h('span', { class: 'muted small' }, p.help)),
        ),
      ),
    ),
    s.priority === 'custom' ? criteriaEditor(s.sortCriteria, '') : null,
    s.priority === 'formula'
      ? h(
          'div',
          { class: 'formula-box' },
          formula,
          h('p', { class: 'muted small' }, `Variables : ${FORMULA_VARS.map((v) => `{${v.name}}`).join(' ')}. {prix_conseille} est ici le prix de départ calculé.`),
        )
      : null,
    h('div', { class: 'toggles' }, settingToggle('duplicatesFirst', 'Doublons d\'abord', 'Les cartes que tu as en plus d\'exemplaires passent avant les autres ; la priorité départage le reste.')),
  );
}

function prioritySection() {
  ui.priority = h('div');
  renderPriority();
  return section(
    'priorite',
    'Ordre de priorité',
    'Quelle carte est proposée en premier quand un slot se libère. « Suivant » dans la popup passe aux cartes suivantes.',
    [ui.priority],
    { errKey: 'priority' },
  );
}

/** Cache des prix lus via l'API (pour l'aperçu) ; null tant qu'il n'est pas chargé ou s'il est vide. */
let cardPrices: Record<string, CatalogPriceEntry & RateEntry> | null = null;
let previewTimer: ReturnType<typeof setTimeout> | undefined;

/** Aperçu des prochaines ventes avec les réglages en cours (recalculé peu après chaque saisie). */
function refreshPreview(): void {
  clearTimeout(previewTimer);
  previewTimer = setTimeout(drawPreview, 150);
}

function drawPreview(): void {
  if (!ui.preview?.isConnected && !ui.preview) return;
  if (errors.length) return mount(ui.preview, h('p', { class: 'muted small' }, 'Corrige les erreurs pour voir l\'aperçu.'));
  const result = allocate(
    {
      rules,
      settings: { ...settings, slots: Math.max(settings.slots, 1) },
      cards: store.cards,
      priceObs: store.priceObs,
      myAuctions: [],
      manualPrices,
      slotOverrides: {},
      ignoredSlots: [],
      myFamilies: store.myFamilies,
      catalogPrice: catalogPriceOf(cardPrices),
      sellRate: sellRateOfCache(cardPrices),
    },
    Date.now(),
  );
  const shown = result.free.filter((f) => f.proposal);
  const count = Object.keys(store.cards).length;
  mount(
    ui.preview,
    !count
      ? h('p', { class: 'muted small' }, 'Ouvre ta collection sur le site pour voir l\'aperçu avec tes cartes.')
      : shown.length
        ? h(
            'ol',
            { class: 'preview' },
            shown.map((f) =>
              h(
                'li',
                null,
                h('span', { class: `rarity ${f.proposal!.card.rarity ?? ''}` }),
                h('strong', { class: 'grow ellipsis' }, f.proposal!.card.name),
                h('span', { class: 'pill' }, f.rule.tag),
                h('strong', { class: 'num' }, f.proposal!.pricing.price != null ? `${formatPrice(f.proposal!.pricing.price)} W` : '?'),
                h('span', { class: 'muted small detail' }, f.proposal!.pricing.detail),
              ),
            ),
          )
        : h('p', { class: 'muted small' }, 'Aucune carte à proposer avec ces réglages.'),
    result.pool ? h('p', { class: 'muted small' }, `${result.pool.size} carte(s) vendable(s) au total. Aperçu sans tes enchères en cours : ${settings.slots} slot(s) libres.`) : null,
  );
}

function previewSection() {
  ui.preview = h('div', { 'aria-live': 'polite' });
  return section('apercu', 'Aperçu : tes prochaines ventes', 'Avec tes réglages actuels, voici les cartes que Wiki-Traders proposerait si tous tes slots étaient libres.', [ui.preview]);
}

// ---------------------------------------------------------------------------
// Ventes : mode, jamais vendu, taux de vente
// ---------------------------------------------------------------------------

function slotsSection() {
  const s = settings;
  ui.rules = h('div');
  ui.quota = h('div', { class: 'quota-summary', 'aria-live': 'polite' });
  return section(
    'ventes',
    'Mes slots',
    null,
    [
      h(
        'div',
        { class: 'grid' },
        field('Nombre de slots', reg('slots', h('input', { type: 'number', min: '1', max: '50', value: s.slots, oninput: (e: Event) => ((s.slots = num((e.target as HTMLInputElement).value, 5)!), onEdit()) })), 'Enchères que tu peux avoir en même temps sur le site.'),
        field(
          'Mode',
          h(
            'select',
            {
              onchange: (e: Event) => {
                s.allocationMode = (e.target as HTMLSelectElement).value as Settings['allocationMode'];
                onEdit();
                render();
              },
            },
            h('option', { value: 'pool', selected: s.allocationMode === 'pool' }, 'meilleures cartes (conseillé)'),
            h('option', { value: 'quota', selected: s.allocationMode === 'quota' }, 'par étiquette'),
          ),
          pool() ? 'Les slots libres reçoivent tes meilleures cartes, réglées par paliers de prix.' : 'Chaque étiquette réserve ses slots et a son propre calcul.',
        ),
      ),
      pool() ? null : [ui.quota, ui.rules],
    ],
    { errKey: 'rules' },
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
        settingToggle('allowDuplicateListing', 'Proposer une carte déjà en vente', 'Autorise à mettre en vente un autre exemplaire d\'une carte déjà aux enchères.'),
      ),
      h(
        'p',
        { class: 'muted small' },
        `Cartes de tes familles : ${settings.protectFamilies ? 'jamais vendues' : 'vendues comme les autres'}. `,
        h('button', { type: 'button', class: 'link', onclick: () => scrollToSection('familles-vente') }, 'Régler dans Familles →'),
      ),
      blacklistBlock(),
    ],
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


function sellRateSection() {
  const s = settings;
  return section(
    'tdv',
    'Taux de vente',
    'Le taux de vente d\'une carte, c\'est la part de ses enchères terminées qui ont trouvé un acheteur (« 17 / 20 vendues » sur tes cartes). Le calcul simple en tient compte selon le nombre d\'enchères ; ici, les seuils pour le reste.',
    [
      h(
        'div',
        { class: 'grid' },
        field(
          'Fiable à partir de (enchères terminées)',
          reg('sellRateMinSamples', h('input', { type: 'number', min: '1', max: '1000', value: s.sellRateMinSamples, oninput: (e: Event) => ((s.sellRateMinSamples = num((e.target as HTMLInputElement).value, 5)!), onEdit()) })),
          'Pour le minimum ci-contre, la priorité « vendre vite », les conditions des étiquettes et {tdv_fiable}.',
        ),
        field(
          'Taux de vente minimum (%)',
          reg('minSellRate', h('input', { type: 'number', min: '0', max: '100', value: s.minSellRate ?? '', placeholder: 'aucun', oninput: (e: Event) => ((s.minSellRate = num((e.target as HTMLInputElement).value)), onEdit()) })),
          'Une carte sous ce taux (fiable) n\'est plus proposée. Vide = aucun minimum.',
        ),
      ),
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
const OUTSIDE_SITE: FeatureKey[] = ['popupSell', 'rankingSell', 'packTagAll', 'families', 'familyBadges'];

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
  return pool()
    ? panel('ventes', slotsSection(), saleFilterSection(), calcSection(), tiersSection(), prioritySection(), previewSection(), protectSection(), sellRateSection(), durationsSection(), sellHelpSection())
    : panel('ventes', slotsSection(), calcSection(), prioritySection(), previewSection(), protectSection(), sellRateSection(), durationsSection(), sellHelpSection());
}

// ---------------------------------------------------------------------------
// Étiquettes : quelles cartes y vont, étiquetage automatique
// ---------------------------------------------------------------------------

/** Carte d'une étiquette dans l'onglet Étiquettes : quelles cartes y vont. */
function tagCard(rule: TagRule) {
  const prefix = `rule:${rule.id}:`;
  const when = () => (rule.when ??= { ...EMPTY_CONDITIONS });
  const summary = h('span', { class: 'muted small' });
  // « Posée si : (10–20 W · tdv ≥ 90 %) ou (20–100 W · tdv ≥ 70 %) » : visible dès qu'il y a un « ou ».
  const orSummary = h('p', { class: 'small rule-or-summary' });
  const refreshSummary = () => {
    summary.textContent = conditionsSummary(rule) || 'aucune';
    orSummary.textContent = `Posée si : ${ruleSummary(rule) || 'toutes les cartes'}`;
    orSummary.hidden = !rule.or?.length;
  };
  refreshSummary();
  const edit = (fn: () => void) => () => {
    fn();
    refreshSummary();
    onEdit();
  };
  const bind = <K extends keyof TagRule>(key: K, parse: (v: string) => TagRule[K]) => (e: Event) => {
    rule[key] = parse((e.target as HTMLInputElement).value);
    refreshSummary();
    onEdit();
  };
  const numIn = (key: string, value: number | null, placeholder: string, label: string, set: (v: number | null) => void, max?: string) =>
    reg(key, h('input', { type: 'number', min: '0', max, value: value ?? '', placeholder, 'aria-label': label, oninput: (e: Event) => edit(() => set(num((e.target as HTMLInputElement).value)))() }));
  /** Alternative « ou » : sa plage de prix, son texte et son taux de vente. */
  const altBlock = (alt: RuleAlternative, i: number) => {
    const ap = `${prefix}or:${alt.id}:`;
    return h(
      'div',
      { class: 'rule-or', 'data-or': alt.id },
      h(
        'div',
        { class: 'row' },
        h('span', { class: 'pill' }, 'ou'),
        h('span', { class: 'muted small grow' }, `Groupe ${i + 2} : toutes ses conditions remplies suffisent.`),
        h('button', { type: 'button', class: 'danger small', 'aria-label': `Retirer le groupe ${i + 2}`, onclick: () => ((rule.or = rule.or!.filter((a) => a !== alt)), renderTagRules(), onEdit()) }, '✕'),
      ),
      h(
        'div',
        { class: 'grid' },
        field(
          'Plage de prix (W)',
          h('span', { class: 'row nowrap' }, 'de', numIn(`${ap}floor`, alt.floor, '—', 'Plancher', (v) => (alt.floor = v)), 'à', numIn(`${ap}ceiling`, alt.ceiling, '∞', 'Plafond', (v) => (alt.ceiling = v))),
        ),
        field(
          'Le nom ou la catégorie contient',
          reg(`${ap}text`, h('input', { value: alt.when.text, placeholder: 'ex. pays, ville', oninput: (e: Event) => edit(() => (alt.when.text = (e.target as HTMLInputElement).value))() })),
        ),
        field(
          'Taux de vente (%)',
          h(
            'span',
            { class: 'row nowrap' },
            'de',
            numIn(`${ap}rateMin`, alt.when.rateMin, '0', 'Taux de vente minimum', (v) => (alt.when.rateMin = v), '100'),
            'à',
            numIn(`${ap}rateMax`, alt.when.rateMax, '100', 'Taux de vente maximum', (v) => (alt.when.rateMax = v), '100'),
          ),
        ),
      ),
    );
  };
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
    ),
    h(
      'details',
      {
        class: 'rule-extra',
        open: openRuleDetails.has(`when:${rule.id}`),
        ontoggle: (e: Event) => ((e.target as HTMLDetailsElement).open ? openRuleDetails.add(`when:${rule.id}`) : openRuleDetails.delete(`when:${rule.id}`)),
      },
      h('summary', null, h('span', null, 'Conditions en plus'), ' · ', summary),
      h('p', { class: 'muted small' }, 'Avec une condition, l\'étiquetage automatique pose cette étiquette sur chaque carte qui les remplit toutes (et dont le prix est dans la plage, s\'il y en a une). Ex. : une étiquette « Pays » pour les cartes dont la catégorie contient « pays ». Pour une famille, voir l\'onglet Familles.'),
      h(
        'div',
        { class: 'grid' },
        field(
          'Le nom ou la catégorie contient',
          reg(`${prefix}text`, h('input', { value: rule.when?.text ?? '', placeholder: 'ex. pays, ville', oninput: (e: Event) => edit(() => (when().text = (e.target as HTMLInputElement).value))() })),
          'Un ou plusieurs mots séparés par des virgules (il suffit d\'un) ; accents et majuscules ignorés.',
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
    (rule.or ?? []).map(altBlock),
    h(
      'div',
      { class: 'row wrap' },
      h(
        'button',
        {
          type: 'button',
          class: 'small',
          title: 'Une autre façon d\'avoir cette étiquette : sa propre plage de prix et ses conditions',
          onclick: () => {
            (rule.or ??= []).push({ id: `or-${Date.now()}-${++idSeq}`, floor: null, ceiling: null, when: { ...EMPTY_CONDITIONS } });
            renderTagRules();
            onEdit();
          },
        },
        '+ Ajouter un « ou »',
      ),
      hint('Ex. : étiquette A si le prix est entre 10 et 20 W avec au moins 90 % de taux de vente, OU entre 20 et 100 W avec au moins 70 %. La plage et les conditions ci-dessus forment le premier groupe ; chaque « ou » en ajoute un. L\'étiquette est posée dès qu\'un groupe est rempli, et retirée seulement si aucun ne peut l\'être.'),
    ),
    orSummary,
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
      'Ici, tu décides quelles cartes reçoivent chaque étiquette : une plage de prix (ex. « 20-50 » = cartes entre 20 et 50 W) et, si tu veux, des conditions. ',
      h('strong', null, 'Ça sert à l\'étiquetage automatique'),
      pool() ? ' ; les ventes, elles, se règlent par paliers de prix dans Ventes.' : ' ; les slots et les prix se règlent dans Ventes.',
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
    'Range chaque carte dans l\'étiquette dont la plage de prix (et les conditions) lui correspond, et pose les étiquettes de tes familles (onglet Familles).',
    [
      h('div', { class: 'toggles' }, riskyToggle('autoTag', 'Étiquetage automatique', 'Pose et retire les étiquettes suivies selon le prix moyen de chaque carte.')),
      ui.autoTagMode,
      h(
        'div',
        { class: 'launch' },
        h('div', { class: 'field-label' }, 'Lancement'),
        h(
          'div',
          { class: 'levels', role: 'radiogroup', 'aria-label': 'Lancement de l\'étiquetage' },
          [
            [false, 'À la demande', 'Tu le lances depuis la popup (Cartes → Étiquetage), avec un bouton Arrêter.'],
            [true, 'En continu', 'Tourne tout seul tant qu\'un onglet du site est ouvert : seulement les cartes à changer, au plus toutes les 2 min, par petits lots. Par l\'API.'],
          ].map(([on, title, help]) =>
            h(
              'label',
              { class: `level${settings.autoTagContinuous === on ? ' is-on' : ''}` },
              h('input', {
                type: 'radio',
                name: 'autoTagLaunch',
                checked: settings.autoTagContinuous === on,
                onchange: (e: Event) => {
                  settings.autoTagContinuous = on as boolean;
                  for (const l of (e.target as HTMLElement).closest('.levels')!.querySelectorAll('.level')) l.classList.toggle('is-on', l.contains(e.target as Node));
                  onEdit();
                },
              }),
              h('span', { class: 'level-text' }, h('strong', null, title as string), h('span', { class: 'muted small' }, help as string), on ? needs('apiWrite') : null),
            ),
          ),
        ),
      ),
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
// Familles : sur le site, étiquette par famille, vente
// ---------------------------------------------------------------------------

function familyNames(): string[] {
  return [...new Set((store.myFamilies ?? []).map((f) => f.name))].sort((a, b) => a.localeCompare(b));
}

function familyTagRow(ft: FamilyTag, i: number) {
  const names = familyNames();
  const list = settings.familyTags;
  return h(
    'li',
    { class: `row wrap family-tag${ft.active ? '' : ' inactive'}` },
    switchInput(ft.active, (box) => ((ft.active = box.checked), box.closest('li')?.classList.toggle('inactive', !box.checked), onEdit()), `Famille ${ft.family || 'sans nom'} active`),
    'Les cartes de',
    reg(
      `famtag:${ft.id}:family`,
      h(
        'select',
        { 'aria-label': 'Famille', onchange: (e: Event) => ((ft.family = (e.target as HTMLSelectElement).value), onEdit()) },
        h('option', { value: '', selected: !ft.family }, '— famille —'),
        names.map((n) => h('option', { value: n, selected: n === ft.family }, n)),
        ft.family && !names.includes(ft.family) ? h('option', { value: ft.family, selected: true }, `${ft.family} (introuvable)`) : null,
      ),
    ),
    'reçoivent l\'étiquette',
    reg(`famtag:${ft.id}:tag`, h('input', { class: 'tag-input', list: 'wiky-known-tags', value: ft.tag, placeholder: 'ex. Films', 'aria-label': 'Étiquette', oninput: (e: Event) => ((ft.tag = (e.target as HTMLInputElement).value), onEdit()) })),
    h('button', { type: 'button', class: 'danger', title: 'Supprimer', 'aria-label': `Supprimer ${ft.family || 'cette famille'}`, onclick: () => (list.splice(i, 1), renderFamilyTags(), onEdit()) }, '✕'),
  );
}

function renderFamilyTags(): void {
  const list = settings.familyTags;
  const names = familyNames();
  mount(
    ui.familyTags,
    h('datalist', { id: 'wiky-known-tags' }, knownTags().map((t) => h('option', { value: t }))),
    list.length ? h('ul', { class: 'family-tags' }, list.map(familyTagRow)) : h('p', { class: 'muted' }, names.length ? 'Aucune famille étiquetée.' : 'Aucune famille : crée-en dans le menu Familles du site.'),
    h(
      'div',
      { class: 'row wrap', style: 'margin-top:8px' },
      h(
        'button',
        {
          type: 'button',
          disabled: !names.length,
          onclick: () => {
            const used = new Set(list.map((f) => f.family));
            const family = names.find((n) => !used.has(n)) ?? '';
            list.push({ id: `ft-${Date.now()}-${++idSeq}`, active: true, family, tag: family });
            renderFamilyTags();
            onEdit();
          },
        },
        '+ Étiqueter une famille',
      ),
    ),
  );
}

function familiesPanel() {
  ui.familyTags = h('div');
  renderFamilyTags();
  const byKey = (k: FeatureKey) => FEATURES.find((f) => f.key === k)!;
  return panel(
    'familles',
    section('familles-site', 'Familles sur le site', 'Regroupe des cartes en familles (menu Familles du site) et suis ta progression.', [
      h('div', { class: 'feature-grid' }, featureCard(byKey('families')), featureCard(byKey('familyBadges'))),
    ]),
    section(
      'familles-etiquettes',
      'Une étiquette par famille',
      [
        'Quand une carte appartient à une famille, l\'étiquetage automatique lui pose l\'étiquette choisie (et la retire si la carte quitte la famille, avec « Retirer les autres étiquettes suivies »). ',
        h('button', { type: 'button', class: 'link', onclick: () => scrollToSection('etiquetage-auto') }, settings.autoTag ? 'Étiquetage automatique : activé →' : 'Étiquetage automatique : désactivé, à activer dans Étiquettes →'),
      ],
      [ui.familyTags],
      { errKey: 'families' },
    ),
    section('familles-vente', 'Vente', null, [
      h('div', { class: 'toggles' }, settingToggle('protectFamilies', 'Ne jamais vendre les cartes de mes familles', pool() ? 'Une carte d\'une de tes familles n\'est jamais proposée à la vente (tu peux toujours la vendre à la main).' : 'Une carte d\'une de tes familles n\'est jamais proposée, sauf pour l\'étiquette posée sur cette famille ci-dessus.')),
    ]),
  );
}

// ---------------------------------------------------------------------------
// Interface : barre latérale et vues de la collection
// ---------------------------------------------------------------------------

const TRI_OPTIONS: [TriState, string][] = [
  ['any', 'Indifférent'],
  ['yes', 'Oui'],
  ['no', 'Non'],
];

/** Contexte des vues pour l'aperçu : prix et taux de vente du cache, familles enregistrées. */
function viewPreviewContext(): ViewContext {
  const price = catalogPriceOf(cardPrices);
  const rate = sellRateOfCache(cardPrices);
  const idx = familyIndex(store.myFamilies ?? []);
  return {
    price: (c) => price(c) ?? c.sitePrice,
    rate: (c) => rate(c)?.pct ?? null,
    families: (c) => familiesOf(idx, c.siteId ?? null, c.name).map((f) => f.name),
  };
}

/** « 12 cartes de ta collection » (et le début de la liste), mis à jour à chaque saisie. */
function viewCountText(v: CollectionView): string {
  const cards = Object.values(store.cards);
  if (!cards.length) return 'Ta collection n\'est pas encore relevée : ouvre-la une fois sur le site.';
  const list = applyView(cards, v, viewPreviewContext());
  if (!list.length) return 'Aucune carte de ta collection ne correspond.';
  const first = list.slice(0, 4).map((c) => c.name).join(', ');
  return `${list.length} carte${list.length > 1 ? 's' : ''} de ta collection : ${first}${list.length > 4 ? '…' : ''}`;
}

/** Choix multiple en pastilles (étiquettes, raretés). */
function chipPicker(options: { value: string; label: string }[], selected: () => string[], set: (list: string[]) => void, label: string) {
  const box = h('div', { class: 'tag-chips', role: 'group', 'aria-label': label });
  const draw = () => {
    const sel = selected();
    const has = (v: string) => sel.some((x) => x.toLowerCase() === v.toLowerCase());
    mount(
      box,
      options.map((o) =>
        h(
          'button',
          {
            type: 'button',
            class: `tag-chip${has(o.value) ? ' is-on' : ''}`,
            'aria-pressed': String(has(o.value)),
            onclick: () => {
              set(has(o.value) ? selected().filter((x) => x.toLowerCase() !== o.value.toLowerCase()) : [...selected(), o.value]);
              draw();
              onEdit();
            },
          },
          has(o.value) ? `✓ ${o.label}` : o.label,
        ),
      ),
    );
  };
  draw();
  return box;
}

function selectOf<T extends string>(options: [T, string][], value: T, onchange: (v: T) => void, label: string) {
  return h(
    'select',
    { 'aria-label': label, onchange: (e: Event) => onchange((e.target as HTMLSelectElement).value as T) },
    options.map(([v, l]) => h('option', { value: v, selected: v === value }, l)),
  );
}

function numberInput(value: number | null, onchange: (v: number | null) => void, label: string) {
  return h('input', { type: 'number', min: '0', step: '1', value: value ?? '', placeholder: '—', 'aria-label': label, oninput: (e: Event) => onchange(num((e.target as HTMLInputElement).value)) });
}

function viewCard(v: CollectionView, i: number) {
  const list = settings.collectionViews;
  const f = v.filter;
  const summary = h('span', { class: 'muted small' }, viewSummary(v));
  const count = h('span', { class: 'small view-count' }, viewCountText(v));
  // Résumé et nombre de cartes suivent chaque saisie, sans redessiner les champs (le focus reste).
  const edited = () => {
    summary.textContent = viewSummary(v);
    count.textContent = viewCountText(v);
    onEdit();
  };
  const tags = knownTags();
  const tagOptions = [...new Set([...tags, ...f.tags, ...f.excludeTags])].map((t) => ({ value: t, label: t }));
  const families = familyNames();
  const sortDef = () => VIEW_SORTS.find((s) => s.key === v.sort) ?? VIEW_SORTS[0];
  const dirSelect = h('select', { 'aria-label': 'Sens du tri', onchange: (e: Event) => ((v.dir = (e.target as HTMLSelectElement).value as 'asc' | 'desc'), edited()) });
  const drawDir = () => {
    mount(dirSelect, h('option', { value: 'asc', selected: v.dir === 'asc' }, sortDef().asc), h('option', { value: 'desc', selected: v.dir === 'desc' }, sortDef().desc));
    // Date d'ajout : seulement l'ordre du site.
    dirSelect.hidden = SITE_ONLY_SORTS.includes(v.sort);
  };
  drawDir();
  // Icône du menu : aperçu dans la tête de la carte, choix en pastilles.
  const headIcon = h('span', { class: 'view-icon', 'aria-hidden': 'true' });
  headIcon.innerHTML = viewIconSvg(v.icon, 20);
  const iconPicker = h('div', { class: 'icon-picks', role: 'radiogroup', 'aria-label': 'Icône du menu' });
  const drawIcons = () =>
    mount(
      iconPicker,
      Object.entries(VIEW_ICONS).map(([key, def]) => {
        const on = (v.icon ?? DEFAULT_VIEW_ICON) === key;
        const b = h('button', {
          type: 'button',
          class: `icon-pick${on ? ' is-on' : ''}`,
          role: 'radio',
          'aria-checked': String(on),
          title: def.label,
          'aria-label': def.label,
          onclick: () => {
            v.icon = key;
            headIcon.innerHTML = viewIconSvg(key, 20);
            drawIcons();
            onEdit();
          },
        });
        b.innerHTML = viewIconSvg(key, 18);
        return b;
      }),
    );
  drawIcons();
  const move = (step: number) => {
    const j = i + step;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    renderViews();
    onEdit();
  };
  const siteLink = embedded ? h('a', { href: viewHref(v.id), target: '_top', class: 'small' }, 'Ouvrir sur le site →') : h('a', { href: `${SITE_ORIGIN}${viewHref(v.id)}`, target: '_blank', rel: 'noopener', class: 'small' }, 'Ouvrir sur le site →');
  return h(
    'div',
    { class: `rule-card view-card${v.active ? '' : ' inactive'}` },
    h(
      'div',
      { class: 'row wrap rule-head' },
      switchInput(v.active, (box) => ((v.active = box.checked), box.closest('.view-card')?.classList.toggle('inactive', !box.checked), onEdit()), `Afficher « ${v.name} » dans la barre latérale`),
      headIcon,
      h('input', { class: 'view-name', value: v.name, maxlength: 40, placeholder: 'Nom du menu (ex. 10-100 A→Z)', 'aria-label': 'Nom de la vue', oninput: (e: Event) => ((v.name = (e.target as HTMLInputElement).value), edited()) }),
      h('span', { class: 'grow' }),
      siteLink,
      h('button', { type: 'button', class: 'small', title: 'Monter', 'aria-label': 'Monter', disabled: i === 0, onclick: () => move(-1) }, '↑'),
      h('button', { type: 'button', class: 'small', title: 'Descendre', 'aria-label': 'Descendre', disabled: i === list.length - 1, onclick: () => move(1) }, '↓'),
      h(
        'button',
        {
          type: 'button',
          class: 'small',
          title: 'Dupliquer',
          onclick: () => {
            list.splice(i + 1, 0, { ...structuredClone(v), id: `v-${Date.now()}-${++idSeq}`, name: `${v.name} (copie)` });
            renderViews();
            onEdit();
          },
        },
        'Dupliquer',
      ),
      h('button', { type: 'button', class: 'danger small', 'aria-label': `Supprimer la vue ${v.name}`, onclick: () => (list.splice(i, 1), renderViews(), onEdit()) }, '✕'),
    ),
    h('div', { class: 'row wrap' }, summary),
    h('details', { class: 'fine' }, h('summary', null, 'Icône du menu'), iconPicker),
    h(
      'div',
      { class: 'grid' },
      field('Nom ou catégorie contient', h('input', { type: 'search', value: f.q, placeholder: 'ex. roi, peintre', oninput: (e: Event) => ((f.q = (e.target as HTMLInputElement).value), edited()) }), 'Plusieurs mots séparés par des virgules : l\'un d\'eux suffit. Sans accents ni majuscules.'),
      field(
        'Tri',
        h(
          'span',
          { class: 'row' },
          selectOf(VIEW_SORTS.map((s) => [s.key, s.label] as [ViewSortKey, string]), v.sort, (k) => ((v.sort = k), drawDir(), edited()), 'Trier par'),
          dirSelect,
        ),
        'Le site sait trier par rareté, nom (A → Z), favoris et date d\'ajout : ces tris passent par lui. Les autres rangent chaque page affichée. Les cartes sans valeur (prix pas encore lu…) passent à la fin.',
      ),
    ),
    h('h4', { class: 'view-h' }, 'Étiquettes'),
    tagOptions.length
      ? chipPicker(tagOptions, () => f.tags, (l) => ((f.tags = l), edited()), 'Étiquettes demandées')
      : h('p', { class: 'muted small' }, 'Aucune étiquette connue : ouvre ta collection sur le site pour que Wiki-Traders la relève.'),
    h(
      'div',
      { class: 'row wrap' },
      selectOf<'any' | 'all'>([['any', 'Au moins une de ces étiquettes'], ['all', 'Toutes ces étiquettes']], f.tagMode, (m) => ((f.tagMode = m), edited()), 'Mode des étiquettes'),
      toggleField('Seulement les cartes sans étiquette', f.untagged, (box) => ((f.untagged = box.checked), edited())),
    ),
    tagOptions.length
      ? h('details', { class: 'fine', open: f.excludeTags.length > 0 }, h('summary', null, 'Exclure des étiquettes'), chipPicker(tagOptions, () => f.excludeTags, (l) => ((f.excludeTags = l), edited()), 'Étiquettes exclues'))
      : null,
    h('h4', { class: 'view-h' }, 'Rareté'),
    chipPicker(
      (Object.keys(RARITIES) as Rarity[]).map((r) => ({ value: r, label: RARITIES[r].label })),
      () => f.rarities,
      (l) => ((f.rarities = l as Rarity[]), edited()),
      'Raretés',
    ),
    h(
      'div',
      { class: 'grid' },
      field('Favoris', selectOf(TRI_OPTIONS, f.favorite, (t) => ((f.favorite = t), edited()), 'Favoris')),
      field('Brillantes', selectOf(TRI_OPTIONS, f.shiny, (t) => ((f.shiny = t), edited()), 'Brillantes')),
      field(
        'Famille',
        selectOf<string>([['', 'Toutes les cartes'], ...[...new Set([...families, ...(f.family ? [f.family] : [])])].map((n) => [n, n] as [string, string])], f.family, (n) => ((f.family = n), edited()), 'Famille'),
      ),
      field('Exemplaires', h('span', { class: 'row' }, 'de', numberInput(f.minQty, (n) => ((f.minQty = n), edited()), 'Exemplaires minimum'), 'à', numberInput(f.maxQty, (n) => ((f.maxQty = n), edited()), 'Exemplaires maximum'))),
      field('Prix moyen (W)', h('span', { class: 'row' }, 'de', numberInput(f.minPrice, (n) => ((f.minPrice = n), edited()), 'Prix minimum'), 'à', numberInput(f.maxPrice, (n) => ((f.maxPrice = n), edited()), 'Prix maximum')), 'Vide = sans limite. Une carte sans prix connu est écartée dès qu\'une limite est posée.'),
    ),
    count,
  );
}

function renderViews(): void {
  const list = settings.collectionViews;
  mount(
    ui.views,
    list.length ? h('div', { class: 'rule-cards' }, list.map(viewCard)) : h('p', { class: 'muted' }, 'Aucune vue. Crée par exemple « 10-100 A→Z » : étiquette 10-100, tri par nom.'),
    h(
      'div',
      { class: 'row wrap', style: 'margin-top:8px' },
      h(
        'button',
        {
          type: 'button',
          onclick: () => {
            list.push(newView(`v-${Date.now()}-${++idSeq}`, `Vue ${list.length + 1}`));
            renderViews();
            onEdit();
          },
        },
        '+ Nouvelle vue',
      ),
    ),
  );
}

function interfacePanel() {
  ui.views = h('div');
  renderViews();
  return panel(
    'interface',
    section('affichage', 'Barre latérale', 'Ce que Wiki-Traders ajoute dans la mise en page de WikiMasters.', [
      h(
        'div',
        { class: 'toggles' },
        settingToggle('siteIntegration', 'Intégration au site', 'Résumé et menu Wiki-Traders dans la barre latérale, onglet dans Paramètres.'),
        settingToggle('compactNav', 'Barre latérale compacte', 'Menus regroupés (Collection, Marché, Social, Progression) pour faire de la place.'),
      ),
    ]),
    section(
      'vues',
      'Vues de la collection',
      'Tes propres menus sous « Collection » dans la barre latérale : chaque vue garde un filtre, un tri et une icône. Un clic ouvre ta collection et remplit ses champs (recherche, étiquette, raretés, tri) : toutes les pages ne montrent plus que ces cartes. Ce que le site ne sait pas filtrer (prix, favoris, plusieurs étiquettes…) est filtré en plus sur la page affichée. Crée-en autant que tu veux.',
      [ui.views],
    ),
  );
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
  ui.calcExamples = ui.calcExamples.filter((x) => x.el.isConnected);
  for (const x of ui.calcExamples) {
    const c = x.calc();
    x.el.textContent = c.mode === 'simple' ? simpleExamples(c) : '';
  }
  for (const n of ui.needs) n.el.hidden = settings[n.key];
  for (const d of ui.dependents) d.el.disabled = !d.enabled();
  errors = validateOptions(rules, settings, { selectorsInvalid });
  showErrors();
  refreshPreview();
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
  ui.calcExamples = [];
  ui.tierTitles = [];
  ui.tabs.clear();
  ui.errorBoxes = [];
  ui.status = h('span', { class: 'status muted', role: 'status', 'aria-live': 'polite' });
  ui.undoBtn = h('button', { type: 'button', class: 'small', hidden: true, title: 'Revenir à l\'état d\'avant tes dernières modifications', onclick: () => void undo() }, 'Annuler') as HTMLButtonElement;
  const tabs = tabBar();
  const panels = [homePanel(), salesPanel(), tagsPanel(), familiesPanel(), interfacePanel(), sitePanel(), panel('acces', accessSection()), advancedPanel()];
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
  try {
    cardPrices = ((await ext.storage.local.get(CARD_PRICES_KEY))[CARD_PRICES_KEY] as typeof cardPrices) ?? null;
  } catch {
    cardPrices = null;
  }
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
