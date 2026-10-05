/**
 * Réponses des appels que le site fait lui-même, relayées par bridge.ts (monde de la page) :
 * ouverture de paquet, échanges, collection, marché. Lecture seule, aucune requête supplémentaire.
 */
export interface SiteResponse {
  /** Chemin et paramètres, ex. `/api/packs/open`. */
  url: string;
  method: string;
  status: number;
  body: unknown;
}

type Listener = { test: RegExp; cb: (r: SiteResponse) => void };
const listeners: Listener[] = [];
let listening = false;

/** Appelle `cb` à chaque réponse du site dont l'adresse correspond à `test`. Renvoie une fonction de désabonnement. */
export function onSiteResponse(test: RegExp, cb: (r: SiteResponse) => void): () => void {
  if (!listening) {
    listening = true;
    window.addEventListener('message', (e) => {
      if (e.source !== window || e.data?.__wiky !== 'net') return;
      const r = e.data as SiteResponse;
      for (const l of listeners) if (l.test.test(r.url)) l.cb(r);
    });
  }
  const l = { test, cb };
  listeners.push(l);
  return () => listeners.splice(listeners.indexOf(l), 1);
}
