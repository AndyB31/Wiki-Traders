type Child = Node | string | number | null | undefined | false;
type Props = Record<string, unknown> & { class?: string; style?: string };

/** Petit utilitaire de création d'éléments (pas de framework pour une extension légère). */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Props | null = null, ...children: (Child | Child[])[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props ?? {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
    else if (k === 'class') el.className = String(v);
    else if (k in el && k !== 'style' && k !== 'list') (el as unknown as Record<string, unknown>)[k] = v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : String(c));
  }
  return el;
}

export function mount(target: HTMLElement, ...nodes: (Child | Child[])[]): void {
  target.replaceChildren(...nodes.flat().filter((n): n is Node | string => n != null && n !== false).map((n) => (n instanceof Node ? n : String(n))));
}

export function downloadJson(filename: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function fmtDate(ts: number | null | undefined): string {
  if (!ts) return '—';
  return new Date(ts).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}
