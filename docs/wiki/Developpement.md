[← Sommaire de la documentation](README.md)

# Développement

## Commandes

```bash
npm install
npm run dev          # build en mode watch dans dist/
npm run build        # build de production
npm run typecheck    # TypeScript
npm test             # tests unitaires (Vitest + jsdom)
npm run demo         # parcours complet dans Chromium + captures du README
npm run zip          # dist/ → wiki-traders.zip
```

`npm run demo` nécessite le navigateur de Playwright : `npx playwright install chromium`. Il charge l'extension, sert une imitation du site (le vrai exige d'être connecté), vérifie chaque fonction et enregistre les captures dans `docs/screenshots/`.

Avec `npm run dev`, recharge l'extension (↻) puis l'onglet du site après chaque modification.

## Organisation

| Dossier / fichier | Rôle |
| --- | --- |
| `src/content/index.ts` | Content script : relevés, automatisations, messages |
| `src/content/bridge.ts` | Script de page (monde MAIN) : données React affichées |
| `src/content/parsers/` | Normalisation, lecture du texte, sélecteurs |
| `src/content/site-ui.ts` | Intégration au site : barre latérale, fenêtres, pages, onglet Paramètres |
| `src/content/auction-mode.ts` | Mode enchère |
| `src/content/toast.ts`, `overlay.ts`, `sell-market.ts` | Toasts, étiquettes sur les cartes, fenêtre de vente |
| `src/content/api.ts`, `api-tags.ts` | API du site (lecture ; écriture des étiquettes) |
| `src/lib/` | Logique pure : slots, prix, durées, journal, étiquetage |
| `src/background/` | Service worker : fusion, alarmes, notifications, badge |
| `src/ui/` | Popup (et vues `?embed=1&view=…` intégrées au site), réglages, journal |
| `tests/` | Tests ; `tests/fixtures/site-nav.html` est la vraie barre latérale du site |

## Principes

- Ne jamais déplacer les nœuds gérés par React : masquer et reproduire, ou ajouter à côté.
- Marquer tout ce qu'on ajoute avec `data-wiky` (ignoré par l'observateur de mutations et le diagnostic).
- Reprendre les classes et variables CSS du site (`--color-surface`, `--color-border`, `--color-foreground`…) ; orange `#f97316` pour Wiki-Traders.
- Toute action sur le site reste facultative, désactivée par défaut et confirmée.

## Contribuer

Issues et pull requests bienvenues sur [GitHub](https://github.com/AndyB31/Wiki-Traders). Joins un **diagnostic** pour tout problème de lecture du site.
