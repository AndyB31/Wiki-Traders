[← Sommaire de la documentation](README.md)

# Premiers pas

Une fois l'extension [installée](Installation.md), voici la configuration conseillée, dans l'ordre. Compte 10 minutes.

Les réglages sont dans **Paramètres → onglet Wiky-Traders** sur le site (ou bloc Wiky-Traders → *Réglages*, ou clic droit sur l'icône → *Options*). Clique sur **Enregistrer** en bas de page après chaque série de modifications.

## Étape 1 – Faire connaître ta collection

1. Ouvre ta [collection](https://www.wiki-masters.com/collection).
2. L'extension relève tes cartes : nom, rareté, nombre d'exemplaires, favoris, étiquettes.
3. Si toutes les cartes ne sont pas chargées, parcours les pages de la collection (ou active la [lecture via l'API](#étape-6--facultatif--la-lecture-via-lapi), qui recharge toute la collection d'un coup).

## Étape 2 – Tes règles par étiquette

Chaque règle réserve des slots à une étiquette du site.

| Colonne | Exemple | Sens |
| --- | --- | --- |
| Étiquette | `20-50` | Nom exact de l'étiquette sur le site |
| Quota | 4 | Slots occupés en permanence par cette étiquette |
| % du prix moyen | 70 | Prix de départ = prix de référence × 70 % |
| Plancher / Plafond | 20 / 50 | Plage de prix de l'étiquette (sert à l'étiquetage automatique) |
| Garder | 1 | Exemplaires jamais proposés à la vente |
| Appartenance | étiquette du site | Ou « plage de prix moyen » si tes cartes ne sont pas étiquetées |
| Active | ✓ | |

Par défaut : **1 slot « 50-100 » + 4 slots « 20-50 »**, à 70 %, en gardant 1 exemplaire. Sous le tableau, les **étiquettes trouvées dans ta collection** s'ajoutent en un clic. La somme des quotas devrait égaler ton nombre de slots.

Voir [Étiquettes](Etiquettes.md).

## Étape 3 – Le prix

Section **Prix et notifications** :

- **Nombre de slots** : 5 par défaut ; mis à jour automatiquement quand tu ouvres Marché → *Mes ventes* (« Mes ventes (2/5) »).
- **Statistique** : garde **médiane** (quelques ventes énormes faussent la moyenne).
- **Fenêtre du prix moyen** : 7 jours.
- **Arrondi** : 0 = automatique.
- **À doublons égaux** : prix le plus haut d'abord, le plus bas (pour écouler), ou aléatoire.
- **Étiquette de secours** : prend le slot d'une étiquette qui n'a plus de carte vendable.

Puis va une fois sur Marché → onglet **Historique** : ce sont les meilleures données de prix réels. Voir [Prix conseillé](Prix-conseille.md).

## Étape 4 – La durée des enchères

Section **Durée des enchères** : ajoute des paliers, par exemple :

| De | À | Durée |
| --- | --- | --- |
| 0 | 20 | 10 min |
| 21 | 100 | 1 h |
| 101 | | 3 h |

Sans palier, la durée par défaut du site (1 h) est gardée. La durée conseillée s'affiche avec chaque proposition.

## Étape 5 – Notifications et affichage

- **Notifications** : une alerte à chaque fin d'enchère, sauf pendant les **heures silencieuses** (23 h – 8 h par défaut).
- **Intégration au site** : le bloc et le menu Wiky-Traders dans la barre latérale (conseillé).
- **Barre latérale compacte** : regroupe Échanges, Guilde, Amis, Messages, Bataille dans *Social*, et Profil, Succès, Classement dans *Progression*.
- **Étiquettes visibles sur les cartes** : en libellés ou en simples pastilles de couleur.

Voir [Intégration au site](Integration-au-site.md).

## Étape 6 – (Facultatif) La lecture via l'API

Section **Automatisations** → **Lecture via l'API du site**. Elle permet :

- la relève **automatique** de tes ventes en cours (chaque minute, sans aller sur *Mes ventes*) ;
- l'onglet **Mises** (tes enchères sur les cartes des autres) et les ventes conclues ;
- les ventes du marché pour les prix par rareté ;
- dans la fenêtre de vente : le résumé du marché de la carte et ses enchères en cours ;
- le rechargement complet de la collection.

Ce sont des **lectures seules** avec ta session, mais l'option demande une confirmation : lis [Automatisations et risques](Automatisations-et-risques.md).

## Étape 7 – Vérifier

Clique sur le bloc **Wiky-Traders** de la barre latérale : la fenêtre **Vendre** liste les slots à remplir avec une carte, un prix et une durée. Si un slot reste vide, la raison est indiquée.

Tu es prêt : voir **[Vendre](Vendre.md)**.
