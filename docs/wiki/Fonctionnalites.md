[← Sommaire de la documentation](README.md)

# Fonctionnalités

Les outils de collection de Wiki-Traders sont pensés pour être rapides : les prix de 150 cartes arrivent en **une** requête (au lieu d'une par carte) et restent en cache 6 h, et rien n'est recalculé si rien n'a changé.

> Si une autre extension WikiMasters propose les mêmes fonctions, désactive-la pour éviter les doublons (prix, « Plus chères », Familles…).

Chaque fonctionnalité s'active dans **Réglages → Sur le site → Fonctionnalités**, ou avec ce qu'elle concerne : les familles dans **Familles**, « Tout étiqueter » dans **Étiquettes**, la vente depuis le classement ou les ventes conseillées dans **Ventes → Aide à la vente**. Celles marquées *API* demandent la *lecture via l'API* (Réglages → Accès au site) ; celles marquées ⚠️ agissent sur le site à ta place, sont désactivées par défaut et demandent une confirmation (voir [Automatisations et risques](Automatisations-et-risques.md)).

## Collection et familles

| Fonctionnalité | Défaut | Ce qu'elle fait |
| --- | --- | --- |
| [Familles](Familles.md) (API) | oui | Familles de cartes, progression, ajout par sélection multiple, marché des manquantes (Réglages → Familles) |
| Familles sur les cartes | oui | Pastilles de famille sur les cartes (Réglages → Familles) |
| Prix moyen sur les cartes (API) | oui | « Moy. 12 W · 85 % » sous le titre de chaque carte de la collection et de « Toutes les cartes » (prix moyen, taux de vente rouge ≤ 15 %, vert ≥ 70 %), et « 17 / 20 vendues » en bas de la carte, au-dessus des étiquettes du site ; avec légende |
| Classement « Plus chères » (API) | oui | Bouton à côté du titre de la collection : ta collection triée par prix, filtres (recherche, rareté, étiquette, favoris), valeur totale |
| Mode compact | oui | Bouton « Compact » : cartes plus petites, plus de cartes à l'écran |

## Affichage des cartes

| Fonctionnalité | Défaut | Ce qu'elle fait |
| --- | --- | --- |
| Cartes illustrées | non | L'image de l'article en pleine carte, reflets selon la rareté (CSS seulement) |
| Bouton Wikipédia | oui | « W » sur chaque carte vers son article |
| Images manquantes | oui | Image trouvée sur Wikipédia (50 cartes par requête) ou Wikidata, mise en cache |
| Masquer ATK / DEF | non | Cache les statistiques des cartes |
| Masquer les étiquettes du site | oui | Cache les étiquettes en bas des cartes ; celles de Wiki-Traders restent en haut de l'image (option *Étiquettes visibles sur les cartes*) |
| Copier la carte en image | oui | Bouton « Copier » dans la fiche d'une carte (PNG ; téléchargé si le presse-papiers refuse) |

## Marché et enchères

| Fonctionnalité | Défaut | Ce qu'elle fait |
| --- | --- | --- |
| Prix moyen au marché (API) | oui | Sur chaque enchère du Marché : moyenne de la carte et écart (bonne affaire en vert) ; sur la page d'une enchère : historique des prix (graphique, statistiques) et autres enchères de la carte ; dans la fiche d'une carte : moyenne, ventes, min et max, taux de vente (enchères conclues sur toutes les enchères terminées) |
| Suivi de mes mises (API) | oui | « Mises en direct » sous le bloc Wiki-Traders : statut, compte à rebours, bip quand tu es surenchéri à moins d'une minute de la fin ; relève toutes les 20 s quand une mise se termine bientôt |

## Paquets

| Fonctionnalité | Défaut | Ce qu'elle fait |
| --- | --- | --- |
| Récapitulatif d'ouverture | oui | Après l'ouverture : cartes obtenues, « Nouvelle » ou exemplaires déjà possédés, et pour chacune les mêmes infos que sur tes cartes — « Moy. 12 W », taux de vente (rouge ≤ 15 %, vert ≥ 70 %), « 17 / 20 vendues », médiane, min et max au survol — et le total (sans gâcher la révélation). Les prix déjà connus s'affichent sans nouvelle requête |
| Statistiques de tirage | oui | Répartition des raretés de tes paquets, sur la page Paquets (réinitialisable, importable depuis une autre extension) ; masquées pendant l'ouverture des cartes |
| Partager un tirage | oui | Bouton « Partager » : le tirage en image |
| Tout étiqueter après ouverture | oui | Bouton « Tout étiqueter » sous le récapitulatif d'ouverture : les cartes obtenues reçoivent leurs étiquettes (plages de prix, conditions, familles). Visible avec l'étiquetage par l'API ; réglé dans Réglages → Étiquettes |
| Tout défausser après ouverture | oui | Bouton rouge « Tout défausser » sous le récapitulatif d'ouverture : un exemplaire de chaque carte obtenue est défaussé. Coche des cartes (case à gauche de chaque ligne) pour ne défausser qu'elles : le bouton devient « Défausser X cartes ». Confirmation si une carte vaut plus du seuil réglable sous les fonctionnalités Paquets (Réglages → Sur le site, 10 W par défaut), ou si les prix chargent encore. Irréversible ; favoris verrouillés |

## Échanges et notifications

| Fonctionnalité | Défaut | Ce qu'elle fait |
| --- | --- | --- |
| Valeur des échanges (API) | oui | Prix de chaque carte, total et différence de chaque côté (cartes + WikiBidous) |
| Aperçu des échanges | oui | Mini-cartes au lieu des noms tronqués |
| Son des notifications | non | Petit son à chaque nouvelle notification (silencieux pendant les heures silencieuses) |

## ⚠️ Automatisations

Désactivées par défaut ; chacune est rangée avec ce qu'elle concerne, et listée dans Réglages → Accès au site.

| Fonctionnalité | Où la régler | Ce qu'elle fait |
| --- | --- | --- |
| Surenchère en un clic | Sur le site → Marché et enchères | Bouton « Surenchérir » dans le suivi des mises : mise minimale (+10 %), après confirmation avec le montant et ton solde |
| Vendre depuis le classement | Ventes → Aide à la vente | « Vendre » sur une ligne du classement : prix et durée conseillés modifiables, deux clics pour confirmer ; jamais un exemplaire déjà en vente, confirmation pour un favori |
| Vendre depuis les ventes conseillées | Ventes → Aide à la vente | Bouton « Vendre… » sur chaque vente conseillée (fenêtre Vendre) : prix moyen, taux de vente, ventes, médiane, min – max, calcul du prix conseillé ; prix et durée modifiables (la durée suit les paliers tant qu'elle n'est pas choisie à la main) ; mise aux enchères en un clic. Un onglet WikiMasters doit être ouvert |
| Ouvrir tous les paquets | Sur le site → Paquets | Ouvre tes paquets un par un (pause aléatoire, 100 au plus), progression et bouton Arrêter, récapitulatif final ; respecte la limite du site |
| Ouverture automatique | Sur le site → Paquets | Ouvre tes paquets à intervalle aléatoire (min / max en minutes) tant qu'un onglet visible est ouvert ; indicateur et bouton Arrêter |
