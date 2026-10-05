/**
 * Bloc « Mises à jour » (réglages) : version installée, nouveautés de la branche main, bouton « Mettre à jour »
 * (programme d'aide) ou, s'il n'est pas installé, la commande à lancer une fois.
 */
import { ext } from '../lib/browser';
import { BUILD, REPO_URL, shortSha, UPDATE_KEY, type UpdateInfo } from '../lib/update';
import { fmtDate, h, mount } from './dom';

interface HelperStatus {
  ok: boolean;
  missing?: boolean;
  error?: string;
  mode?: 'git' | 'zip';
  dir?: string;
  id?: string;
}

const date = (iso: string | null | undefined) => (iso ? fmtDate(Date.parse(iso)) : '—');

export function updatePanel(): HTMLElement {
  const box = h('div', { class: 'update-panel' });
  let info: UpdateInfo | null = null;
  let helper: HelperStatus | null = null;
  let busy: 'check' | 'update' | null = null;
  let result: { ok: boolean; text: string; log?: string[] } | null = null;

  const draw = () => {
    const status = info?.status;
    const headline =
      busy === 'check' ? 'Vérification…'
      : busy === 'update' ? 'Mise à jour en cours… (récupération, construction, puis rechargement)'
      : !info ? 'Pas encore vérifié.'
      : status === 'available' ? `Mise à jour disponible : ${info.behind} nouveauté${info.behind > 1 ? 's' : ''}.`
      : status === 'up-to-date' ? 'Wiky-Traders est à jour.'
      : status === 'unknown' ? 'Version locale (non publiée) : comparaison impossible.'
      : `Vérification impossible : ${info.error ?? 'erreur'}.`;
    const canUpdate = helper?.ok && (status === 'available' || status === 'unknown') && !busy;
    const helperHelp = helper && !helper.ok
      ? h(
          'div',
          { class: 'warn small' },
          h('p', { style: 'margin:0 0 6px' }, 'Pour mettre à jour en un clic, installe une fois le programme d\'aide (Node.js 20+ requis) :'),
          h('pre', { class: 'mono', style: 'margin:0 0 6px;white-space:pre-wrap' }, `cd <dossier Wiky-Traders>\nnpm run updater:install -- --id ${helper.id ?? ext.runtime.id}`),
          h('p', { class: 'muted', style: 'margin:0' }, 'Installation depuis un zip : node <dossier de l\'extension>/updater/install.mjs --id ' + (helper.id ?? ext.runtime.id) + ' — puis recharge l\'extension (↻).'),
        )
      : null;
    mount(
      box,
      h('div', { class: 'row' }, h('strong', { class: `grow ${status === 'available' ? 'ok' : ''}` }, headline)),
      h(
        'p',
        { class: 'muted small', style: 'margin:4px 0 8px' },
        `Version installée : ${shortSha(BUILD.sha)}${BUILD.dirty ? ' (modifiée localement)' : ''} du ${date(BUILD.date)}`,
        info?.latest ? ` · dernière sur GitHub : ${shortSha(info.latest.sha)} du ${date(info.latest.date)}` : '',
        info ? ` · vérifié ${fmtDate(info.checkedAt)}` : '',
      ),
      info?.commits.length
        ? h('ul', { class: 'small', style: 'margin:0 0 8px;padding-left:18px' }, info.commits.map((c) => h('li', null, h('span', { class: 'mono muted' }, shortSha(c.sha)), ` ${c.message}`)))
        : null,
      h(
        'div',
        { class: 'row' },
        h('button', { disabled: !!busy, onclick: check }, 'Vérifier les mises à jour'),
        h('button', { class: 'primary', disabled: !canUpdate, title: helper?.ok ? '' : 'Programme d\'aide non installé', onclick: update }, 'Mettre à jour'),
        h('span', { class: 'grow' }),
        h('a', { href: `${REPO_URL}/commits/main`, target: '_blank', rel: 'noopener' }, 'Historique sur GitHub'),
      ),
      helper?.ok ? h('p', { class: 'muted small', style: 'margin:6px 0 0' }, `Programme d'aide installé (${helper.mode === 'git' ? 'dépôt git' : 'zip'} : ${helper.dir}).`) : helperHelp,
      result
        ? h(
            'div',
            { class: result.ok ? 'small ok' : 'warn error small', style: 'margin-top:8px' },
            result.text,
            result.log?.length ? h('details', null, h('summary', null, 'Journal'), h('pre', { class: 'mono', style: 'white-space:pre-wrap;max-height:200px;overflow:auto' }, result.log.join('\n'))) : null,
          )
        : null,
    );
  };

  async function check(): Promise<void> {
    busy = 'check';
    result = null;
    draw();
    info = ((await ext.runtime.sendMessage({ type: 'checkUpdate' }).catch(() => null)) as UpdateInfo | null) ?? info;
    helper = (await ext.runtime.sendMessage({ type: 'updaterStatus' }).catch(() => null)) as HelperStatus | null;
    busy = null;
    draw();
  }

  async function update(): Promise<void> {
    busy = 'update';
    result = null;
    draw();
    const res = (await ext.runtime.sendMessage({ type: 'applyUpdate' }).catch((e) => ({ ok: false, error: String(e) }))) as { ok: boolean; error?: string; log?: string[] } | null;
    busy = null;
    // En cas de succès, l'extension se recharge (cette page se ferme ou se recharge avec elle).
    result = res?.ok
      ? { ok: true, text: 'Mise à jour installée : l\'extension redémarre et les onglets WikiMasters se rechargent.', log: res.log }
      : { ok: false, text: `Échec de la mise à jour : ${res?.error ?? 'pas de réponse'}`, log: res?.log };
    draw();
  }

  draw();
  void (async () => {
    try {
      info = ((await ext.storage.local.get(UPDATE_KEY))[UPDATE_KEY] as UpdateInfo | undefined) ?? null;
    } catch {
      info = null;
    }
    // Vérification au premier affichage si la dernière date de plus d'une heure.
    if (!info || Date.now() - info.checkedAt > 3600_000) await check();
    else {
      helper = (await ext.runtime.sendMessage({ type: 'updaterStatus' }).catch(() => null)) as HelperStatus | null;
      draw();
    }
  })();
  return box;
}
