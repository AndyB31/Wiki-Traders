import './common.css';
import './options.css';
import { ext } from '../lib/browser';
import { DEFAULT_RULES, DEFAULT_SETTINGS, SITE_ORIGIN } from '../lib/defaults';
import { DURATIONS } from '../lib/duration';
import { clearAll, loadAll, save } from '../lib/storage';
import { formatPrice, RARITIES } from '../lib/text';
import type { Settings, StoreShape, TagRule } from '../lib/types';
import { DEFAULT_SELECTORS } from '../content/parsers/selectors';
import { downloadJson, fmtDate, h, mount } from './dom';
import { updatePanel } from './update-panel';
import { embedded, initEmbed } from './embed';
import { FEATURE_GROUPS, FEATURES, featureFlags, type FeatureDef, type FeatureGroup } from '../lib/features';
import {
  DEFAULT_DURATION_TIERS,
  isDirty,
  nextTier,
  pctExample,
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
let selectorsInvalid = false;
let errors: ValidationError[] = [];
/** Message ponctuel (enregistré, importé…) affiché tant qu'aucune modification ne suit. */
let notice: { text: string; kind: 'ok' | 'error' } | null = null;
let advancedOpen = false;
let idSeq = 0;

const RISK_TEXT = 'Les règles de WikiMasters (section 3) interdisent les outils qui interagissent à ta place : ton compte peut être banni sans préavis.';

// Nœuds mis à jour sans tout redessiner (pas de re-rendu complet à chaque frappe).
const ui = {
  status: null as unknown as HTMLElement,
  saveBtn: null as unknown as HTMLButtonElement,
  revertBtn: null as unknown as HTMLButtonElement,
  quick: null as unknown as HTMLElement,
  quota: null as unknown as HTMLElement,
  rules: null as unknown as HTMLElement,
  durations: null as unknown as HTMLElement,
  tiers: null as unknown as HTMLElement,
  manual: null as unknown as HTMLElement,
  rounding: null as unknown as HTMLElement,
  fallback: null as unknown as HTMLSelectElement,
  fallbackKey: '',
  errorBoxes: {} as Record<OptionsSection, HTMLElement>,
  /** Champs repérés par clé (« slots », « rule:<id>:tag »…) pour y afficher les erreurs. */
  fields: new Map<string, HTMLElement>(),
  pctExamples: new Map<TagRule, HTMLElement>(),
  /** Mentions « nécessite la lecture via l'API », visibles seulement quand elle est coupée. */
  apiNotes: [] as HTMLElement[],
  /** Interrupteurs des automatisations (le démarrage rapide peut en activer une). */
  risky: {} as Partial<Record<RiskyKey, HTMLInputElement>>,
  /** Champs grisés selon un autre réglage. */
  dependents: [] as { el: HTMLInputElement | HTMLSelectElement; enabled: () => boolean }[],
};

type RiskyKey = 'prefill' | 'autoTag' | 'apiRead' | 'apiWrite';

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

function apiNote(text = 'nécessite la lecture via l\'API, désactivée') {
  const el = h('span', { class: 'api-note small', hidden: settings.apiRead }, `⚠ ${text}`);
  ui.apiNotes.push(el);
  return el;
}

function dependent<T extends HTMLInputElement | HTMLSelectElement>(el: T, enabled: () => boolean): T {
  ui.dependents.push({ el, enabled });
  el.disabled = !enabled();
  return el;
}

function section(id: string, title: string, intro: Child | Child[], ...body: (Child | Child[])[]) {
  const errKey = ({ ventes: 'rules', prix: 'pricing', durees: 'durations' } as Record<string, OptionsSection>)[id];
  return h(
    'section',
    { class: 'card opt-section', id },
    h('h2', null, title),
    intro ? h('p', { class: 'intro' }, ...[intro].flat()) : null,
    errKey ? errorBox(errKey) : null,
    ...body,
  );
}

function errorBox(key: OptionsSection) {
  const box = h('div', { class: 'section-errors', role: 'alert', hidden: true });
  ui.errorBoxes[key] = box;
  return box;
}

function scrollToSection(id: string): void {
  const el = document.getElementById(id);
  if (!el) return;
  if (el instanceof HTMLDetailsElement) el.open = true;
  el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ---------------------------------------------------------------------------
// Démarrage rapide
// ---------------------------------------------------------------------------

function quickFix(c: QuickCheck): Child {
  if (c.ok) return null;
  switch (c.id) {
    case 'collection':
      return h('a', { href: `${SITE_ORIGIN}/collection`, target: embedded ? '_top' : '_blank', rel: 'noopener' }, 'Ouvrir ma collection →');
    case 'api':
      return h('button', { type: 'button', class: 'small', onclick: () => void enableRisky('apiRead', 'Lecture via l\'API du site', true) }, 'Activer la lecture via l\'API');
    case 'rules':
      return rules.length
        ? h('button', { type: 'button', class: 'small', onclick: () => scrollToSection('ventes') }, 'Voir les règles')
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

// ---------------------------------------------------------------------------
// Mes ventes : répartition par étiquette
// ---------------------------------------------------------------------------

function ruleRow(rule: TagRule) {
  const bind = <K extends keyof TagRule>(key: K, parse: (v: string) => TagRule[K]) => (e: Event) => {
    rule[key] = parse((e.target as HTMLInputElement).value);
    onEdit();
  };
  const example = h('div', { class: 'muted small example' }, pctExample(rule.pct, settings.rounding));
  ui.pctExamples.set(rule, example);
  const name = () => rule.tag.trim() || 'sans nom';
  return h(
    'tr',
    { class: rule.active ? undefined : 'inactive' },
    h(
      'td',
      null,
      switchInput(
        rule.active,
        (box) => {
          rule.active = box.checked;
          box.closest('tr')?.classList.toggle('inactive', !box.checked);
          onEdit();
        },
        `Règle ${name()} active`,
      ),
    ),
    h('td', null, reg(`rule:${rule.id}:tag`, h('input', { class: 'tag-input', value: rule.tag, placeholder: '20-50', 'aria-label': 'Étiquette', oninput: bind('tag', (v) => v) }))),
    h('td', null, reg(`rule:${rule.id}:quota`, h('input', { type: 'number', min: '0', value: rule.quota, 'aria-label': 'Slots réservés', oninput: bind('quota', (v) => num(v, 0)!) }))),
    h(
      'td',
      null,
      h(
        'span',
        { class: 'row nowrap' },
        reg(`rule:${rule.id}:pct`, h('input', { type: 'number', min: '1', max: '500', value: rule.pct, 'aria-label': '% du prix moyen', oninput: bind('pct', (v) => num(v, 0)!) })),
        h('span', { class: 'small' }, '% du prix moyen'),
      ),
      example,
    ),
    h(
      'td',
      null,
      h(
        'span',
        { class: 'row nowrap' },
        'de',
        reg(`rule:${rule.id}:floor`, h('input', { type: 'number', min: '0', value: rule.floor ?? '', placeholder: '—', 'aria-label': 'Plancher', oninput: bind('floor', (v) => num(v)) })),
        'à',
        reg(`rule:${rule.id}:ceiling`, h('input', { type: 'number', min: '0', value: rule.ceiling ?? '', placeholder: '∞', 'aria-label': 'Plafond', oninput: bind('ceiling', (v) => num(v)) })),
        'W',
      ),
    ),
    h('td', null, h('input', { type: 'number', min: '0', value: rule.keepMin, 'aria-label': 'Exemplaires gardés', oninput: bind('keepMin', (v) => num(v, 1)!) })),
    h(
      'td',
      null,
      h(
        'select',
        { 'aria-label': 'Appartenance', onchange: bind('match', (v) => v as TagRule['match']) },
        h('option', { value: 'tag', selected: rule.match === 'tag' }, 'étiquette du site'),
        h('option', { value: 'price', selected: rule.match === 'price' }, 'prix dans la plage'),
      ),
    ),
    h(
      'td',
      null,
      h(
        'button',
        {
          type: 'button',
          class: 'danger',
          title: 'Supprimer cette règle',
          'aria-label': `Supprimer la règle ${name()}`,
          onclick: () => {
            rules = rules.filter((r) => r !== rule);
            renderRules();
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
    h('span', { class: 'muted small' }, 'Étiquettes de ta collection sans règle :'),
    missing.map(([tag, n]) =>
      h(
        'button',
        {
          type: 'button',
          class: 'small',
          title: 'Ajouter une règle pour cette étiquette (garder 0 : l\'étiquette désigne les cartes à vendre)',
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

const th = (label: string, help?: string) => h('th', null, h('span', { class: 'row nowrap th-label' }, label, help ? hint(help) : null));

function renderRules(): void {
  ui.pctExamples.clear();
  mount(
    ui.rules,
    rules.length
      ? h(
          'div',
          { class: 'table-wrap' },
          h(
            'table',
            { class: 'rules' },
            h(
              'thead',
              null,
              h(
                'tr',
                null,
                th('Active', 'Désactivée, l\'étiquette ne réserve plus aucun slot (la règle est gardée).'),
                th('Étiquette', 'Nom exact de l\'étiquette sur WikiMasters, ex. « 20-50 ».'),
                th('Slots', 'Nombre de tes slots d\'enchères réservés à cette étiquette.'),
                th('Mise de départ', 'Pourcentage du prix moyen de la carte utilisé comme mise de départ conseillée.'),
                th('Plage de prix', 'Plage de prix de l\'étiquette (plancher–plafond). Sert à l\'étiquetage automatique et à l\'appartenance « prix moyen dans la plage » ; ne change pas le prix conseillé.'),
                th('Garder', 'Exemplaires jamais vendus : avec 1, ton dernier exemplaire reste toujours dans ta collection.'),
                th('Appartenance', 'Comment savoir qu\'une carte fait partie de l\'étiquette : elle porte l\'étiquette sur le site, ou son prix moyen tombe dans la plage de prix.'),
                h('th', null, h('span', { class: 'sr-only' }, 'Supprimer')),
              ),
            ),
            h('tbody', null, rules.map(ruleRow)),
          ),
        )
      : h('p', { class: 'muted' }, 'Aucune règle : ajoute une étiquette pour que Wiki-Traders te propose des ventes.'),
    h(
      'div',
      { class: 'row', style: 'margin-top:8px' },
      h(
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
      ),
    ),
    detectedTagsBlock(),
  );
}

function refreshQuota(): void {
  const q = quotaSummary(rules, settings.slots);
  ui.quota.className = `quota-summary ${q.status}`;
  mount(ui.quota, h('strong', null, q.text), h('span', null, ` — ${q.status === 'ok' ? '✓ ' : '⚠ '}${q.message}`));
}

function rulesSection() {
  ui.rules = h('div');
  ui.quota = h('div', { class: 'quota-summary', 'aria-live': 'polite' });
  renderRules();
  return section(
    'ventes',
    'Mes ventes : répartition par étiquette',
    [
      'Chaque étiquette du site réserve des slots. Ex. : 1 slot pour tes cartes « 50-100 » et 4 slots pour « 20-50 » ; Wiki-Traders propose une carte de cette étiquette pour chaque slot libre, avec une mise de départ égale à un % de son prix moyen.',
    ],
    ui.quota,
    ui.rules,
  );
}

// ---------------------------------------------------------------------------
// Prix conseillé
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

function pricingSection() {
  const s = settings;
  const set = <K extends keyof Settings>(key: K, parse: (v: string) => Settings[K]) => (e: Event) => {
    s[key] = parse((e.target as HTMLInputElement).value);
    onEdit();
  };
  ui.rounding = h('span', { class: 'muted small' });
  ui.fallback = h('select', { onchange: set('fallbackTag', (v) => v || null) });
  ui.fallbackKey = '';
  refreshFallback();
  return section(
    'prix',
    'Prix conseillé',
    'Comment Wiki-Traders calcule le prix moyen d\'une carte et choisit quoi proposer. Les valeurs par défaut conviennent à la plupart des joueurs.',
    h(
      'div',
      { class: 'grid' },
      field(
        'Nombre de slots',
        reg('slots', h('input', { type: 'number', min: '1', max: '50', value: s.slots, oninput: set('slots', (v) => num(v, 5)!) })),
        'Nombre d\'enchères que tu peux avoir en même temps sur le site.',
      ),
      field(
        'Statistique',
        h(
          'select',
          { onchange: set('stat', (v) => v as Settings['stat']) },
          h('option', { value: 'median', selected: s.stat === 'median' }, 'médiane (conseillé)'),
          h('option', { value: 'mean', selected: s.stat === 'mean' }, 'moyenne'),
        ),
        'Médiane = le prix du milieu des ventes : une vente exceptionnelle ne la fausse pas. Moyenne = total ÷ nombre de ventes.',
      ),
      field(
        'Période observée (jours)',
        h('input', { type: 'number', min: '1', max: '90', value: s.windowDays, oninput: set('windowDays', (v) => num(v, 7)!) }),
        'Seules les ventes de ces derniers jours comptent (7 = la dernière semaine).',
      ),
      field(
        'Arrondi (W)',
        h('input', { type: 'number', min: '0', value: s.rounding, oninput: set('rounding', (v) => num(v, 0)!) }),
        h('span', { class: 'small' }, h('span', { class: 'muted' }, '0 = automatique. '), ui.rounding),
        'Pas d\'arrondi de la mise conseillée. Automatique : à l\'unité sous 20 W, à 5 sous 100, à 10 sous 1 000.',
      ),
      field(
        'Entre deux cartes aussi doublonnées, proposer',
        h(
          'select',
          {
            onchange: (e: Event) => {
              s.sortPrice = (e.target as HTMLSelectElement).value as Settings['sortPrice'];
              if (s.sortPrice === 'random') s.randomSeed = Date.now() % 2_147_483_647;
              onEdit();
            },
          },
          h('option', { value: 'desc', selected: s.sortPrice === 'desc' }, 'la plus chère d\'abord'),
          h('option', { value: 'asc', selected: s.sortPrice === 'asc' }, 'la moins chère d\'abord (écouler)'),
          h('option', { value: 'random', selected: s.sortPrice === 'random' }, 'au hasard'),
        ),
        'Les cartes en plus d\'exemplaires passent en premier ; ce choix départage les égalités.',
      ),
      field('Étiquette de secours', ui.fallback, 'Quand une étiquette n\'a plus aucune carte à vendre, son slot reçoit une carte de cette étiquette-ci.'),
    ),
    h(
      'div',
      { class: 'toggles' },
      settingToggle('includeListings', 'Compter les enchères en cours dans le prix moyen', 'Par défaut, seules les ventes terminées comptent : une enchère en cours peut encore monter.'),
      settingToggle('allowDuplicateListing', 'Proposer une carte déjà en vente', 'Autorise à mettre en vente un autre exemplaire d\'une carte déjà aux enchères.'),
    ),
  );
}

// ---------------------------------------------------------------------------
// Durée des enchères
// ---------------------------------------------------------------------------

function renderDurations(): void {
  const rows = settings.durationRules;
  const set = (i: number, key: 'from' | 'to' | 'minutes', v: number | null) => {
    rows[i] = { ...rows[i], [key]: v };
    onEdit();
  };
  mount(
    ui.durations,
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
              reg(`dur:${i}:from`, h('input', { type: 'number', min: '0', value: r.from ?? '', placeholder: '0', 'aria-label': `Palier ${i + 1} : de`, oninput: (e: Event) => set(i, 'from', num((e.target as HTMLInputElement).value)) })),
              'à',
              reg(`dur:${i}:to`, h('input', { type: 'number', min: '0', value: r.to ?? '', placeholder: '∞', 'aria-label': `Palier ${i + 1} : à`, oninput: (e: Event) => set(i, 'to', num((e.target as HTMLInputElement).value)) })),
              'W →',
              h(
                'select',
                { 'aria-label': `Palier ${i + 1} : durée`, onchange: (e: Event) => set(i, 'minutes', Number((e.target as HTMLSelectElement).value)) },
                DURATIONS.map((d) => h('option', { value: d.minutes, selected: d.minutes === r.minutes }, d.label)),
              ),
              h(
                'button',
                { type: 'button', class: 'danger', title: 'Supprimer ce palier', 'aria-label': `Supprimer le palier ${i + 1}`, onclick: () => (rows.splice(i, 1), renderDurations(), onEdit()) },
                '✕',
              ),
            ),
          ),
        )
      : null,
    h(
      'div',
      { class: 'row wrap', style: 'margin-top:8px' },
      h(
        'button',
        {
          type: 'button',
          onclick: () => {
            rows.push(nextTier(rows));
            renderDurations();
            onEdit();
          },
        },
        '+ Ajouter un palier',
      ),
      h(
        'button',
        {
          type: 'button',
          title: '≤ 20 W : 10 min · 21–100 W : 1 h · plus de 100 W : 3 h',
          onclick: () => {
            if (rows.length && !confirm('Remplacer tes paliers par la proposition par défaut ?\n\n0–20 W → 10 min · 21–100 W → 1 h · 101 W et + → 3 h')) return;
            settings.durationRules = DEFAULT_DURATION_TIERS.map((t) => ({ ...t }));
            renderDurations();
            onEdit();
          },
        },
        'Proposition par défaut',
      ),
    ),
  );
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
    'Choisis la durée de chaque enchère selon sa mise de départ. Ex. : une carte à 15 W part 10 min, une carte à 150 W part 3 h. Le premier palier qui correspond l\'emporte ; la durée s\'affiche avec chaque proposition (et se choisit seule avec le pré-remplissage).',
    h('div', { class: 'muted small' }, 'Aperçu :'),
    ui.tiers,
    ui.durations,
  );
}

// ---------------------------------------------------------------------------
// Notifications, affichage
// ---------------------------------------------------------------------------

function notificationsSection() {
  const s = settings;
  const time = (key: 'quietStart' | 'quietEnd', label: string) =>
    dependent(h('input', { type: 'time', value: s[key] ?? '', 'aria-label': label, oninput: (e: Event) => ((s[key] = (e.target as HTMLInputElement).value || null), onEdit()) }), () => settings.notifications);
  return section(
    'notifications',
    'Notifications',
    'Wiki-Traders te prévient quand une enchère se termine ou qu\'un slot se libère.',
    h('div', { class: 'toggles' }, settingToggle('notifications', 'Notifications', 'Alertes du navigateur pour tes ventes.')),
    field(
      'Heures silencieuses',
      h('span', { class: 'row' }, 'de', time('quietStart', 'Début des heures silencieuses'), 'à', time('quietEnd', 'Fin des heures silencieuses')),
      'Aucune notification pendant cette plage (ex. la nuit). Laisse vide pour toujours être prévenu.',
    ),
  );
}

function displaySection() {
  const s = settings;
  return section(
    'affichage',
    'Affichage sur le site',
    'Ce que Wiki-Traders ajoute directement dans les pages de WikiMasters.',
    h(
      'div',
      { class: 'toggles' },
      settingToggle('siteIntegration', 'Intégration au site', 'Résumé et menu Wiki-Traders dans la barre latérale, onglet dans Paramètres.'),
      settingToggle('compactNav', 'Barre latérale compacte', 'Menus regroupés (Social, Progression) pour faire de la place.'),
      settingToggle('showTagOverlay', 'Étiquettes visibles sur les cartes', 'Sur chaque carte de la collection, aux couleurs du site.'),
    ),
    field(
      'Style des étiquettes sur les cartes',
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
  );
}

// ---------------------------------------------------------------------------
// Fonctionnalités
// ---------------------------------------------------------------------------

function featureCard(f: FeatureDef) {
  const flags = featureFlags(settings.features);
  return toggleField(
    f.label,
    flags[f.key],
    (box) => {
      if (box.checked && f.risky && !confirm(`${f.label}\n\n${f.help}\n\n${RISK_TEXT}\n\nActiver quand même ?`)) {
        box.checked = false;
        return;
      }
      settings.features = { ...settings.features, [f.key]: box.checked };
      onEdit();
    },
    undefined,
    [f.api ? h('span', { class: 'badge api', title: 'Utilise la lecture via l\'API' }, 'API') : null, f.risky ? h('span', { class: 'badge risk', title: 'Agit sur le site à ta place' }, '⚠ risque') : null],
    'feature',
  );
}

function featureGroup(group: FeatureGroup, title = FEATURE_GROUPS[group]) {
  return h(
    'div',
    { class: 'feature-group' },
    h('h3', null, title),
    h(
      'div',
      { class: 'feature-grid' },
      FEATURES.filter((f) => f.group === group).map((f) => {
        const card = featureCard(f);
        card.querySelector('.toggle-text')!.append(h('span', { class: 'muted small' }, f.help), f.api ? apiNote() : '');
        return card;
      }),
    ),
  );
}

function featuresSection() {
  const groups = (Object.keys(FEATURE_GROUPS) as FeatureGroup[]).filter((g) => g !== 'automation');
  return section(
    'fonctionnalites',
    'Fonctionnalités',
    'Ajouts au site, à activer ou couper selon tes goûts. Le badge API indique ce qui a besoin de la lecture via l\'API (section Automatisations).',
    groups.map((g) => featureGroup(g)),
  );
}

// ---------------------------------------------------------------------------
// Automatisations
// ---------------------------------------------------------------------------

/** Active une automatisation après confirmation ; `saveNow` : enregistre aussitôt (démarrage rapide). */
async function enableRisky(key: RiskyKey, label: string, saveNow = false): Promise<void> {
  if (!confirm(`${label}\n\n${RISK_TEXT}\n\nActiver quand même ?`)) return;
  settings[key] = true;
  const box = ui.risky[key];
  if (box) box.checked = true;
  onEdit();
  if (saveNow) await saveAll();
}

function riskyToggle(key: RiskyKey, label: string, help: string, extra: Child[] = []) {
  const el = toggleField(
    label,
    settings[key],
    (box) => {
      if (box.checked && !confirm(`${label}\n\n${RISK_TEXT}\n\nActiver quand même ?`)) {
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

function automationSection() {
  const withNote = (el: HTMLElement) => (el.querySelector('.toggle-text')!.append(apiNote()), el);
  return h(
    'section',
    { class: 'card opt-section danger-zone', id: 'automatisations' },
    h('h2', null, 'Automatisations (risque de bannissement)'),
    h(
      'p',
      { class: 'risk-banner' },
      h('strong', null, '⚠ À tes risques. '),
      'Ces options lisent le site avec ta session ou cliquent à ta place. Les règles de WikiMasters (section 3) et ses conditions (section 6) l\'interdisent : ton compte peut être banni définitivement, avec perte des cartes. Tout est désactivé par défaut et chaque activation demande une confirmation.',
    ),
    h('h3', null, 'Lecture du site'),
    h(
      'div',
      { class: 'toggles' },
      riskyToggle('apiRead', 'Lecture via l\'API du site', 'Prix des cartes, onglet « Mises » (enchères où tu as misé) et ventes du marché. Lectures seules, avec ta session.'),
      withNote(settingToggle('sellMarketSummary', 'Fenêtre de vente : résumé du marché', 'Sous « Marché · … » : nombre d\'offres en cours, min, médiane, max.')),
      withNote(settingToggle('sellMarketList', 'Fenêtre de vente : enchères de la carte', 'Sous la fenêtre : enchères en cours de cette carte, prix et durée restante.')),
      withNote(settingToggle('sellMarketHistory', 'Fenêtre de vente : historique des prix', 'À droite de la fenêtre : ventes passées de la carte (graphique, moyenne, taux de vente…), comme sur la page d\'une enchère.')),
    ),
    h('h3', null, 'Actions à ta place'),
    h(
      'div',
      { class: 'toggles' },
      riskyToggle('prefill', 'Ouvrir la vente et pré-remplir le prix', '« Ouvrir » ouvre la carte, sa fenêtre de vente et remplit le prix. Le clic « Mettre en vente » reste toujours à toi.'),
      riskyToggle('autoTag', 'Étiquetage automatique', 'Range chaque carte dans l\'étiquette dont la plage de prix contient son prix moyen. Lancé depuis la popup, avec bouton Arrêter.'),
      riskyToggle('apiWrite', 'Étiquetage par l\'API (plus fiable)', 'Écrit directement les étiquettes, comme le site, au lieu de cliquer dans la fiche de chaque carte. Écritures limitées aux étiquettes ; favoris revérifiés avant chaque écriture.'),
      settingToggle('autoTagRemoveOthers', 'Retirer les autres étiquettes gérées', 'Ex. une carte passée à 60 W perd « 20-50 » et reçoit « 50-100 ».'),
      settingToggle('autoTagClearUnpriced', 'Retirer les étiquettes des cartes sans prix connu', 'Défait les classements faits sans prix propre (par ex. à partir de la médiane de la rareté).'),
    ),
    featureGroup('automation', 'Fonctionnalités automatisées'),
  );
}

// ---------------------------------------------------------------------------
// Avancé
// ---------------------------------------------------------------------------

function blacklistBlock() {
  return h(
    'div',
    null,
    h('textarea', {
      rows: 4,
      placeholder: 'Une carte par ligne (nom ou identifiant)',
      'aria-label': 'Liste noire',
      value: settings.blacklist.join('\n'),
      oninput: (e: Event) => {
        settings.blacklist = (e.target as HTMLTextAreaElement).value.split('\n').map((l) => l.trim()).filter(Boolean);
        onEdit();
      },
    }),
    h('div', { class: 'muted small' }, 'Ces cartes ne sont jamais proposées à la vente. Les cartes épinglées en favori non plus.'),
  );
}

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

function advancedSection() {
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
  return h(
    'details',
    { class: 'card opt-section advanced', id: 'avance', open: advancedOpen, ontoggle: (e: Event) => (advancedOpen = (e.target as HTMLDetailsElement).open) },
    h('summary', null, h('h2', null, 'Avancé'), h('span', { class: 'muted small' }, 'pages du site, liste noire, prix saisis, données, sauvegarde')),
    errorBox('advanced'),
    h('h3', null, 'Pages du site'),
    h(
      'div',
      { class: 'grid' },
      field('Page « mes enchères »', h('input', { value: s.myAuctionsPath ?? '', placeholder: 'auto (onglet « Mes ventes » de /marketplace)', oninput: (e: Event) => ((s.myAuctionsPath = (e.target as HTMLInputElement).value.trim() || null), onEdit()) }), 'Chemin, ex. /marketplace?tab=mine. Vide = automatique.'),
      field('Page ouverte par « Ouvrir »', h('input', { value: s.sellPath, oninput: (e: Event) => ((s.sellPath = (e.target as HTMLInputElement).value.trim() || DEFAULT_SETTINGS.sellPath), onEdit()) }), `Par défaut ${DEFAULT_SETTINGS.sellPath}.`),
    ),
    h('h3', null, 'Liste noire'),
    blacklistBlock(),
    h('h3', null, 'Prix saisis à la main'),
    ui.manual,
    h('h3', null, 'Données'),
    cardsBlock(),
    selectorsBlock(),
    h('h3', null, 'Sauvegarde'),
    h('p', { class: 'muted small' }, 'Exporte tes réglages (règles, paliers, prix saisis) dans un fichier JSON, pour les garder ou les copier sur un autre navigateur.'),
    h(
      'div',
      { class: 'row wrap' },
      h('button', { type: 'button', onclick: exportSettings }, 'Exporter (JSON)'),
      h('button', { type: 'button', onclick: () => fileInput.click() }, 'Importer…'),
      fileInput,
      h('span', { class: 'grow' }),
      h('button', { type: 'button', class: 'danger', onclick: wipe }, 'Effacer toutes les données'),
    ),
  );
}

// ---------------------------------------------------------------------------
// Validation, état « modifié », barre d'enregistrement
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
  for (const [key, box] of Object.entries(ui.errorBoxes) as [OptionsSection, HTMLElement][]) {
    const msgs = errors.filter((e) => e.section === key);
    box.hidden = !msgs.length;
    mount(box, msgs.length ? h('ul', null, msgs.map((m) => h('li', null, m.message))) : null);
  }
}

function focusFirstError(): void {
  const first = errors[0];
  if (!first) return;
  const el = first.keys.map((k) => ui.fields.get(k)).find((x) => x?.isConnected);
  const details = el?.closest('details');
  if (details) details.open = true;
  el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  (el as HTMLInputElement | undefined)?.focus({ preventScroll: true });
}

function updateBar(): void {
  const dirty = isDirty(baseline, { rules, settings, manualPrices });
  ui.saveBtn.disabled = !dirty;
  ui.revertBtn.disabled = !dirty;
  document.documentElement.classList.toggle('dirty', dirty);
  if (errors.length) {
    const n = errors.length;
    mount(
      ui.status,
      h(
        'button',
        { type: 'button', class: 'link error', title: 'Aller au champ', onclick: focusFirstError },
        `⚠ ${n} erreur${n > 1 ? 's' : ''} à corriger : ${errors[0].message}`,
      ),
    );
    ui.status.className = 'status error';
  } else if (notice && (!dirty || notice.kind === 'error')) {
    mount(ui.status, notice.text);
    ui.status.className = `status ${notice.kind}`;
  } else if (dirty) {
    mount(ui.status, h('span', { class: 'dot', 'aria-hidden': 'true' }), 'Modifications non enregistrées');
    ui.status.className = 'status dirty';
  } else {
    mount(ui.status, 'Tout est enregistré.');
    ui.status.className = 'status muted';
  }
}

/** Mise à jour après une saisie : uniquement les résumés et aperçus concernés. */
function refreshLive(): void {
  refreshQuota();
  refreshQuickStart();
  refreshTiers();
  refreshFallback();
  ui.rounding.textContent = `ex. ${roundingExamples(settings.rounding)}`;
  for (const [rule, el] of ui.pctExamples) el.textContent = pctExample(rule.pct, settings.rounding);
  for (const n of ui.apiNotes) n.hidden = settings.apiRead;
  for (const d of ui.dependents) d.el.disabled = !d.enabled();
  errors = validateOptions(rules, settings, { selectorsInvalid });
  showErrors();
}

function onEdit(): void {
  notice = null;
  refreshLive();
  updateBar();
}

async function saveAll(): Promise<void> {
  errors = validateOptions(rules, settings, { selectorsInvalid });
  showErrors();
  if (errors.length) {
    updateBar();
    focusFirstError();
    return;
  }
  // Étiquettes nettoyées sur place : le tableau garde ses liens (et le focus) sans être redessiné.
  for (const r of rules) {
    const tag = r.tag.trim();
    if (tag === r.tag) continue;
    r.tag = tag;
    const input = ui.fields.get(`rule:${r.id}:tag`) as HTMLInputElement | undefined;
    if (input) input.value = tag;
  }
  await save({ rules, settings, manualPrices });
  await ext.runtime.sendMessage({ type: 'refreshBadge' }).catch(() => {});
  baseline = snapshot({ rules, settings, manualPrices });
  notice = { text: `✓ Enregistré à ${new Date().toLocaleTimeString('fr-FR')}`, kind: 'ok' };
  refreshLive();
  updateBar();
}

function revert(): void {
  const b = JSON.parse(baseline) as { rules: TagRule[]; settings: Settings; manualPrices: Record<string, number> };
  rules = b.rules;
  settings = b.settings;
  manualPrices = b.manualPrices;
  selectorsInvalid = false;
  notice = { text: 'Modifications annulées.', kind: 'ok' };
  render();
}

function exportSettings(): void {
  downloadJson(`wiki-traders-reglages-${new Date().toISOString().slice(0, 10)}.json`, { version: 1, rules, settings, manualPrices });
}

async function importSettings(file: File): Promise<void> {
  try {
    const data = JSON.parse(await file.text());
    if (!Array.isArray(data.rules) || typeof data.settings !== 'object') throw new Error('format');
    rules = data.rules;
    settings = { ...DEFAULT_SETTINGS, ...data.settings };
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

const TOC: [id: string, label: string][] = [
  ['demarrage', 'Démarrage rapide'],
  ['ventes', 'Mes ventes'],
  ['prix', 'Prix conseillé'],
  ['durees', 'Durée des enchères'],
  ['notifications', 'Notifications'],
  ['affichage', 'Affichage sur le site'],
  ['fonctionnalites', 'Fonctionnalités'],
  ['automatisations', 'Automatisations'],
  ['maj', 'Mises à jour'],
  ['avance', 'Avancé'],
];

function tocNav() {
  return h(
    'nav',
    { class: 'toc', 'aria-label': 'Sections des réglages' },
    h(
      'ul',
      null,
      TOC.map(([id, label]) =>
        h(
          'li',
          null,
          h(
            'a',
            {
              href: `#${id}`,
              class: id === 'automatisations' ? 'risk' : undefined,
              onclick: (e: Event) => {
                e.preventDefault();
                scrollToSection(id);
              },
            },
            label,
          ),
        ),
      ),
    ),
  );
}

function render(): void {
  const scroll = scrollY;
  ui.fields.clear();
  ui.apiNotes = [];
  ui.dependents = [];
  ui.risky = {};
  ui.errorBoxes = {} as Record<OptionsSection, HTMLElement>;
  ui.status = h('span', { class: 'status muted', role: 'status', 'aria-live': 'polite' });
  ui.saveBtn = h('button', { type: 'button', class: 'primary', title: `Enregistrer (${/Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl+'}S)`, onclick: () => void saveAll() }, 'Enregistrer');
  ui.revertBtn = h('button', { type: 'button', title: 'Revenir aux réglages enregistrés', onclick: revert }, 'Annuler les modifications');
  ui.quick = h('div');
  mount(
    app,
    h(
      'header',
      { class: 'row' },
      h('img', { src: 'icons/icon-48.png', width: 32, height: 32, alt: '' }),
      h('h1', { class: 'grow' }, 'Wiki-Traders – Réglages'),
      h('a', { href: 'journal.html' }, 'Journal →'),
    ),
    h(
      'div',
      { class: 'layout' },
      tocNav(),
      h(
        'main',
        { class: 'sections' },
        h('section', { class: 'card opt-section quick', id: 'demarrage' }, h('h2', null, 'Démarrage rapide'), ui.quick),
        rulesSection(),
        pricingSection(),
        durationsSection(),
        notificationsSection(),
        displaySection(),
        featuresSection(),
        automationSection(),
        h(
          'section',
          { class: 'card opt-section', id: 'maj' },
          h('h2', null, 'Mises à jour'),
          h('p', { class: 'intro muted' }, 'Compare ta version avec la dernière publiée sur GitHub et installe les nouveautés en un clic (programme d\'aide à installer une fois).'),
          updatePanel(),
        ),
        advancedSection(),
      ),
    ),
    h('footer', { class: 'row sticky savebar' }, ui.saveBtn, ui.revertBtn, ui.status),
  );
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
  render();
}

// Ctrl/Cmd+S enregistre ; avertissement en quittant la page avec des modifications.
addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 's') {
    e.preventDefault();
    if (!ui.saveBtn?.disabled) void saveAll();
  }
});
addEventListener('beforeunload', (e) => {
  if (!embedded && settings && isDirty(baseline, { rules, settings, manualPrices })) e.preventDefault();
});

void load();
