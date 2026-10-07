import './common.css';
import './options.css';
import { tagStats } from '../lib/journal';
import { loadAll, onStoreChange, save } from '../lib/storage';
import { formatPrice } from '../lib/text';
import type { JournalEntry, JournalType, StoreShape } from '../lib/types';
import { downloadJson, fmtDate, h, mount } from './dom';

const app = document.getElementById('app')!;
let store: StoreShape;
let filter: JournalType | 'all' = 'all';

const LABEL: Record<JournalType, string> = { proposed: 'Proposée', created: 'Créée', finished: 'Terminée' };

function pct(v: number | null): string {
  return v == null ? '—' : `${Math.round(v * 100)} %`;
}

function gap(e: JournalEntry): string {
  const p = e.finalPrice ?? e.startPrice;
  if (p == null || !e.avgPrice) return '—';
  const d = p / e.avgPrice - 1;
  return `${d >= 0 ? '+' : ''}${Math.round(d * 100)} %`;
}

function render(): void {
  const stats = tagStats(store.journal);
  const entries = [...store.journal].reverse().filter((e) => filter === 'all' || e.type === filter);
  mount(
    app,
    h('header', { class: 'row' }, h('img', { src: 'icons/icon-48.png', width: 32, height: 32, alt: '' }), h('h1', { class: 'grow' }, 'Wiki-Traders – Journal'), h('a', { href: 'options.html' }, '← Réglages')),
    h(
      'section',
      { class: 'card' },
      h('h2', null, 'Par étiquette'),
      stats.length
        ? h(
            'table',
            null,
            h('tr', null, ['Étiquette', 'Ventes terminées', 'Prix final / moyenne', 'Parties au prix de départ', 'Hausse moyenne', 'Conseil'].map((t) => h('th', null, t))),
            stats.map((s) =>
              h('tr', null, h('td', null, h('span', { class: 'pill' }, s.tag)), h('td', null, s.finished), h('td', null, pct(s.avgFinalRatio)), h('td', null, pct(s.atStartShare)), h('td', null, pct(s.avgUplift)), h('td', null, s.hint)),
            ),
          )
        : h('p', { class: 'muted' }, 'Aucune vente terminée pour l\'instant.'),
    ),
    h(
      'section',
      { class: 'card' },
      h(
        'div',
        { class: 'row' },
        h('h2', { class: 'grow' }, `Historique (${store.journal.length})`),
        h(
          'select',
          { onchange: (e: Event) => ((filter = (e.target as HTMLSelectElement).value as typeof filter), render()) },
          (['all', 'proposed', 'created', 'finished'] as const).map((t) => h('option', { value: t, selected: filter === t }, t === 'all' ? 'Tout' : LABEL[t])),
        ),
        h('button', { onclick: () => downloadJson(`wiki-traders-journal-${Date.now()}.json`, store.journal) }, 'Exporter'),
        h('button', { class: 'danger', onclick: async () => confirm('Vider le journal ?') && (await save({ journal: [] })) }, 'Vider'),
      ),
      entries.length
        ? h(
            'table',
            null,
            h('tr', null, ['Date', 'Événement', 'Carte', 'Étiquette', 'Prix de départ', 'Prix final', 'Prix moyen', 'Écart'].map((t) => h('th', null, t))),
            entries.slice(0, 500).map((e) =>
              h(
                'tr',
                null,
                h('td', null, fmtDate(e.at)),
                h('td', null, LABEL[e.type]),
                h('td', null, e.cardName),
                h('td', null, e.tag ?? '—'),
                h('td', null, formatPrice(e.startPrice)),
                h('td', null, formatPrice(e.finalPrice)),
                h('td', null, formatPrice(e.avgPrice)),
                h('td', null, gap(e)),
              ),
            ),
          )
        : h('p', { class: 'muted' }, 'Rien pour l\'instant.'),
    ),
  );
}

async function refresh(): Promise<void> {
  store = await loadAll();
  render();
}

onStoreChange(['journal'], refresh);
void refresh();
