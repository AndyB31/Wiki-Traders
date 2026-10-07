[← Sommaire de la documentation](README.md)

# Fonctionnalités

Les outils de collection de Wiki-Traders sont pensés pour être rapides : les prix de 150 cartes arrivent en **une** requête (au lieu d'une par carte) et restent en cache 6 h, et rien n'est recalculé si rien n'a changé.

> Si une autre extension WikiMasters propose les mêmes fonctions, désactive-la pour éviter les doublons (prix, « Plus chères », Familles…).

Chaque fonctionnalité s'active dans **Réglages → Fonctionnalités**. Celles marquées *API* demandent la *lecture via l'API* ; celles marquées ⚠️ agissent sur le site à ta place, sont désactivées par défaut et demandent une confirmation (voir [Automatisations et risques](Automatisations-et-risques.md)).

## Collection et familles

| Fonctionnalité | Défaut | Ce qu'elle fait |
| --- | --- | --- |
| [Familles](Familles.md) (API) | oui | Familles de cartes, progression, ajout par sélection multiple, marché des manquantes |
| Familles sur les cartes | oui | Pastilles de famille sur les cartes |
| Prix moyen sur les cartes (API) | oui | « Moy. 12 W » sous le titre de chaque carte de la collection et de « Toutes les cartes », avec légende |
| Classement « Plus chères » (API) | oui | Bouton à côté du titre de la collection : ta collection triée par prix, filtres (recherche, rareté, étiquette, favoris), valeur totale |
| Mode compact | oui | Bouton « Compact » : cartes plus petites, plus de cartes à l'écran |

## Affichage des cartes

| Fonctionnalité | Défaut | Ce qu'elle fait |
| --- | --- | --- |
| Cartes illustrées | non | L'image de l'article en pleine carte, reflets selon la rareté (CSS seulement) |
| Bouton Wikipédia | oui | « W » sur chaque carte vers son article |
| Images manquantes | oui | Image trouvée sur Wikipédia (50 cartes par requête) ou Wikidata, mise en cache |
| Masquer ATK / DEF | non | Cache les statistiques des cartes |
| Copier la carte en image | oui | Bouton « Copier » dans la fiche d'une carte (PNG ; téléchargé si le presse-papiers refuse) |

## Marché et enchères

| Fonctionnalité | Défaut | Ce qu'elle fait |
| --- | --- | --- |
| Prix moyen au marché (API) | oui | Sur chaque enchère du Marché : moyenne de la carte et écart (bonne affaire en vert) ; sur la page d'une enchère : historique des prix (graphique, statistiques) et autres enchères de la carte ; dans la fiche d'une carte : moyenne, ventes, min et max, taux de vente (enchères conclues sur toutes les enchères terminées) |
| Suivi de mes mises (API) | oui | « Mises en direct » sous le bloc Wiki-Traders : statut, compte à rebours, bip quand tu es surenchéri à moins d'une minute de la fin ; relève toutes les 20 s quand une mise se termine bientôt |

## Paquets

| Fonctionnalité | Défaut | Ce qu'elle fait |
| --- | --- | --- |
| Récapitulatif d'ouverture | oui | Après l'ouverture : cartes obtenues, « Nouvelle » ou exemplaires déjà possédés, prix et total (sans gâcher la révélation) |
| Statistiques de tirage | oui | Répartition des raretés de tes paquets, sur la page Paquets (réinitialisable, importable depuis une autre extension) ; masquées pendant l'ouverture des cartes |
| Partager un tirage | oui | Bouton « Partager » : le tirage en image |

## Échanges et notifications

| Fonctionnalité | Défaut | Ce qu'elle fait |
| --- | --- | --- |
| Valeur des échanges (API) | oui | Prix de chaque carte, total et différence de chaque côté (cartes + WikiBidous) |
| Aperçu des échanges | oui | Mini-cartes au lieu des noms tronqués |
| Son des notifications | non | Petit son à chaque nouvelle notification (silencieux pendant les heures silencieuses) |

## ⚠️ Automatisations

| Fonctionnalité | Ce qu'elle fait |
| --- | --- |
| Surenchère en un clic | Bouton « Surenchérir » dans le suivi des mises : mise minimale (+10 %), après confirmation avec le montant et ton solde |
| Vendre depuis le classement | « Vendre » sur une ligne du classement : prix et durée conseillés modifiables, deux clics pour confirmer ; jamais un exemplaire déjà en vente, confirmation pour un favori |
| Ouvrir tous les paquets | Ouvre tes paquets un par un (pause aléatoire, 100 au plus), progression et bouton Arrêter, récapitulatif final ; respecte la limite du site |
| Ouverture automatique | Ouvre tes paquets à intervalle aléatoire (min / max en minutes) tant qu'un onglet visible est ouvert ; indicateur et bouton Arrêter |
