[← Sommaire de la documentation](README.md)

# Référence des réglages

Réglages : **Paramètres → onglet Wiky-Traders** sur le site, ou page d'options de l'extension. Clique sur **Enregistrer** pour appliquer.

## Règles par étiquette

| Colonne | Défaut | Description |
| --- | --- | --- |
| Étiquette | `50-100`, `20-50` | Nom de l'étiquette du site |
| Quota | 1, 4 | Slots réservés |
| % du prix moyen | 70 % | Prix conseillé = référence × % |
| Plancher / Plafond | 50–100, 20–50 | Plage de prix (étiquetage automatique, appartenance par prix) |
| Garder | 1 | Exemplaires jamais proposés |
| Appartenance | étiquette du site | Ou plage de prix moyen |
| Active | oui | |

## Prix et notifications

| Réglage | Défaut | Description |
| --- | --- | --- |
| Nombre de slots | 5 | Enchères simultanées ; mis à jour par le site |
| Fenêtre du prix moyen (jours) | 7 | Ventes prises en compte |
| Statistique | médiane | Ou moyenne |
| Arrondi | 0 (automatique) | Ou pas fixe |
| À doublons égaux | prix le plus haut | Le plus bas (écouler) ou aléatoire |
| Étiquette de secours | aucune | Reprend les slots d'une étiquette vide |
| Proposer une carte déjà en vente | non | |
| Compter les enchères en cours dans le prix moyen | non | |
| Notifications | oui | Fin d'enchère, slot libéré |
| Heures silencieuses | 23:00 – 08:00 | Pas de notification |
| Intégration au site | oui | Voir [Intégration au site](Integration-au-site.md) |
| Barre latérale compacte | oui | Menus Social et Progression |
| Étiquettes visibles sur les cartes | oui | |
| Style des étiquettes sur les cartes | libellés détaillés | Ou pastilles de couleur |
| Page « mes enchères » | automatique | Chemin, ex. `/marketplace?tab=mine` |
| Page ouverte par « Ouvrir » | `/collection` | |

## Fonctionnalités

Une case par fonctionnalité, par groupe (collection et familles, affichage des cartes, marché, paquets, échanges, automatisations) : voir [Fonctionnalités](Fonctionnalites.md). Les automatisations demandent une confirmation.

## Durée des enchères

Paliers **De – À → Durée** (10 min, 30 min, 1 h, 3 h, 6 h, 12 h). Le premier palier qui contient le prix l'emporte ; sans palier, la durée du site (1 h). Les paliers qui se chevauchent sont signalés.

## Liste noire

Une carte par ligne : jamais proposée à la vente.

## Automatisations

Toutes désactivées par défaut, avec confirmation à l'activation. Voir [Automatisations et risques](Automatisations-et-risques.md).

| Option | Effet |
| --- | --- |
| V4 – Ouvrir la vente et pré-remplir le prix | « Ouvrir » ouvre la carte et sa fenêtre de vente, remplit prix et durée. Requise par le Mode enchère. |
| Lecture via l'API du site | Mises, ventes conclues, ventes du marché, collection complète, ventes en cours relues chaque minute |
| Fenêtre de vente : résumé du marché | Offres en cours de la carte (nombre, min, médiane, max) |
| Fenêtre de vente : liste des enchères de la carte | Sous la fenêtre de vente |
| Étiquetage par l'API | L'étiquetage automatique écrit les étiquettes directement (plus fiable) |
| Étiquetage automatique sur le site | Range les cartes par plage de prix |
| Retirer les autres étiquettes gérées | Une seule plage par carte |

## Prix saisis à la main

Un prix de référence fixe pour une carte (prioritaire sur la médiane de la rareté).

## Données

- Cartes connues, dernière lecture de la collection et des ventes.
- **Sélecteurs avancés** (JSON) : à ajuster si le site change (voir [Dépannage](Depannage.md#page-non-reconnue)).
- **Exporter (JSON)** / **Importer** : sauvegarder ou transférer tes réglages.
- **Effacer toutes les données**.
