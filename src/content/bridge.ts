/**
 * Script injecté dans le contexte de la page (world MAIN).
 *
 * WikiMasters est une application React : chaque élément affiché est rattaché aux props du
 * composant qui l'a rendu (carte, enchère…). Ce script lit ces props — c'est-à-dire exactement
 * ce que la page affiche — et les transmet au content script. Il ne fait aucune requête réseau
 * et ne modifie rien, à part un attribut `data-wiky-ref` qui permet de retrouver l'élément.
 *
 * Protocole : window.postMessage({ __wiky: 'req', id }) → window.postMessage({ __wiky: 'res', id, items }).
 *
 * Il relaie aussi, sans les modifier, les réponses de quelques appels que le site fait lui-même (ouverture de
 * paquet, échanges, collection, marché) : window.postMessage({ __wiky: 'net', url, method, status, body }).
 */
/** Appels du site dont la réponse est relayée au content script (paquets, échanges, collection, marché). */
const WATCHED = /\/api\/(packs\/open|trades|my-collection|marketplace|wikibidous)/;

const RARITY_KEYS = new Set(['C', 'PC', 'R', 'SR', 'UR', 'L']);
const END_KEY = /^(ends?_?at|end_?(time|date)|expires?_?at|expir(y|ation)(_?(at|date))?|closes?_?at|deadline|finish(es)?_?at|ending_?at)$/i;
const PRICE_KEY = /(bid|price|amount|prix|mise)/i;
const MAX_ELEMENTS = 8000;

export interface BridgeItem {
  kind: 'card' | 'auction' | 'tag';
  /** Valeur de `data-wiky-ref` posée sur l'élément (identifiant stable de la donnée). */
  ref: string;
  data: Record<string, unknown>;
  /** Objet englobant (ex. { quantity, card }) quand la carte est imbriquée. */
  container: Record<string, unknown> | null;
}

type Fiber = { tag: number; memoizedProps: unknown; return: Fiber | null };

function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  if ('$$typeof' in v || v instanceof Node || v instanceof Window) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

function rarityOf(o: Record<string, unknown>): boolean {
  const r = o.rarity ?? o.snapshot_rarity ?? o.rarete ?? o.rarity_code;
  return typeof r === 'string' && RARITY_KEYS.has(r.toUpperCase());
}

function nestedCard(o: Record<string, unknown>): Record<string, unknown> | null {
  for (const v of Object.values(o)) if (isPlainObject(v) && rarityOf(v)) return v;
  return null;
}

function looksCard(o: Record<string, unknown>): boolean {
  return rarityOf(o) || nestedCard(o) != null;
}

/** Définition d'étiquette de l'utilisateur ({ id, name, color }). */
function looksTagDef(o: Record<string, unknown>): boolean {
  return typeof o.id === 'string' && typeof o.name === 'string' && typeof o.color === 'string' && !rarityOf(o);
}

function looksAuction(o: Record<string, unknown>): boolean {
  const keys = Object.keys(o);
  return keys.some((k) => END_KEY.test(k)) && (keys.some((k) => PRICE_KEY.test(k)) || nestedCard(o) != null);
}

/** Copie JSON-compatible et bornée (pas de fonctions, d'éléments React ni de nœuds DOM). */
function sanitize(v: unknown, depth = 3): unknown {
  if (v == null || typeof v === 'number' || typeof v === 'boolean') return v;
  if (typeof v === 'string') return v.length > 300 ? v.slice(0, 300) : v;
  if (v instanceof Date) return v.toISOString();
  if (depth <= 0) return undefined;
  if (Array.isArray(v)) return v.slice(0, 30).map((x) => sanitize(x, depth - 1));
  if (!isPlainObject(v)) return undefined;
  const out: Record<string, unknown> = {};
  let n = 0;
  for (const [k, x] of Object.entries(v)) {
    if (n++ > 80 || k === 'children' || typeof x === 'function') continue;
    const s = sanitize(x, depth - 1);
    if (s !== undefined) out[k] = s;
  }
  return out;
}

function fiberOf(el: Element): Fiber | null {
  for (const k in el) if (k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$')) return (el as unknown as Record<string, Fiber>)[k];
  return null;
}

export function extract(root: ParentNode = document): BridgeItem[] {
  const seen = new WeakSet<object>();
  const items: BridgeItem[] = [];
  const marked = new Set<Element>();
  const add = (kind: BridgeItem['kind'], data: Record<string, unknown>, container: Record<string, unknown> | null, el: Element) => {
    if (seen.has(data)) return;
    seen.add(data);
    // Référence stable (identifiant de la donnée) : l'attribut n'est réécrit que s'il change,
    // pour ne pas provoquer de mutations inutiles sur les cartes (d'autres extensions les observent).
    const id = data.id ?? data.card_id;
    const ref = typeof id === 'string' || typeof id === 'number' ? `${kind}:${id}` : `${kind}#${items.length}`;
    if (el.getAttribute('data-wiky-ref') !== ref) el.setAttribute('data-wiky-ref', ref);
    marked.add(el);
    items.push({ kind, ref, data: sanitize(data, 4) as Record<string, unknown>, container: container ? (sanitize(container, 3) as Record<string, unknown>) : null });
  };
  const addTag = (t: Record<string, unknown>) => {
    seen.add(t);
    items.push({ kind: 'tag', ref: '', data: { id: t.id, name: t.name, color: t.color }, container: null });
  };

  const elements = root.querySelectorAll('*');
  for (let i = 0; i < elements.length && i < MAX_ELEMENTS; i++) {
    const el = elements[i];
    const fiber = fiberOf(el);
    if (!fiber) continue;
    // Composants qui ont rendu cet élément comme racine : on remonte jusqu'au prochain élément DOM.
    let f = fiber.return;
    for (let guard = 0; f && f.tag !== 5 && f.tag !== 3 && guard < 20; guard++, f = f.return) {
      const props = f.memoizedProps;
      if (!isPlainObject(props)) continue;
      if (looksAuction(props)) add('auction', props, null, el);
      else if (rarityOf(props)) add('card', props, null, el);
      for (const v of Object.values(props)) {
        // Listes d'étiquettes : on ne garde que leurs définitions (id → nom).
        if (Array.isArray(v)) {
          for (const t of v.slice(0, 200)) if (isPlainObject(t) && looksTagDef(t) && !seen.has(t)) addTag(t);
          continue;
        }
        if (!isPlainObject(v) || seen.has(v)) continue;
        if (looksTagDef(v)) {
          addTag(v);
          continue;
        }
        if (looksAuction(v)) add('auction', v, props, el);
        else if (rarityOf(v)) add('card', v, props, el);
        else if (looksCard(v)) add('card', nestedCard(v)!, v, el);
      }
    }
  }
  for (const el of document.querySelectorAll('[data-wiky-ref]')) if (!marked.has(el)) el.removeAttribute('data-wiky-ref');
  return items;
}

declare global {
  interface Window {
    __wikyBridge?: boolean;
  }
}

function watchFetch(): void {
  const original = window.fetch;
  window.fetch = async function (this: unknown, input: RequestInfo | URL, init?: RequestInit) {
    const res = await original.call(this, input, init);
    try {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (WATCHED.test(url) && res.ok && (res.headers.get('content-type') ?? '').includes('json')) {
        const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
        void res
          .clone()
          .json()
          .then((body) => window.postMessage({ __wiky: 'net', url: new URL(url, location.href).pathname + new URL(url, location.href).search, method, status: res.status, body }, '*'))
          .catch(() => {});
      }
    } catch {
      // Jamais d'effet sur la requête du site.
    }
    return res;
  };
}

if (!window.__wikyBridge) {
  window.__wikyBridge = true;
  watchFetch();
  window.addEventListener('message', (e) => {
    if (e.source !== window || e.data?.__wiky !== 'req') return;
    let items: BridgeItem[] = [];
    try {
      items = extract();
    } catch {
      items = [];
    }
    window.postMessage({ __wiky: 'res', id: e.data.id, items }, '*');
  });
}
