[← Sommaire de la documentation](README.md)

# Premiers pas

Une fois l'extension [installée](Installation.md), voici la configuration conseillée, dans l'ordre. Compte 10 minutes.

Les réglages sont dans **Paramètres → onglet Wiki-Traders** sur le site (ou bloc Wiki-Traders → *Réglages*, ou clic droit sur l'icône → *Options*). Ils sont rangés en onglets (Accueil, Ventes, Étiquettes, Familles, Sur le site, Accès au site, Avancé) et **enregistrés automatiquement** ; **Annuler**, en bas, revient en arrière. Voir [Référence des réglages](Reglages.md).

## Étape 1 – Faire connaître ta collection

1. Ouvre ta [collection](https://www.wiki-masters.com/collection).
2. L'extension relève tes cartes : nom, rareté, nombre d'exemplaires, favoris, étiquettes.
3. Si toutes les cartes ne sont pas chargées, parcours les pages de la collection (ou active la [lecture via l'API](#étape-6--facultatif--la-lecture-via-lapi), qui recharge toute la collection d'un coup).

L'onglet **Accueil** des réglages montre ce qui est prêt et ce qui manque, réglable en un clic.

## Étape 2 – Quelles cartes vendre

Onglet **Ventes**. Par défaut, le mode **meilleures cartes** : tes slots libres reçoivent tes meilleures cartes.

- **Nombre de slots** : 5 par défaut ; mis à jour automatiquement quand tu ouvres Marché → *Mes ventes* (« Mes ventes (2/5) »).
- **Quelles cartes vendre** : toutes, sauf celles qui portent certaines étiquettes (ex. « À garder »), ou seulement celles qui portent certaines étiquettes (ex. « À vendre »). Coche les étiquettes concernées.
- **Exemplaires gardés** : 1 = ton dernier exemplaire reste toujours ; seuls les doublons partent.

Tu préfères réserver des slots à chaque étiquette ? Choisis le mode **par étiquette** : chaque étiquette a alors ses slots, son calcul du prix et sa durée. Voir [Vendre](Vendre.md#quelle-carte-est-proposée-).

## Étape 3 – Le prix

- **Calcul du prix par défaut** : **Simple** (prix moyen × mise de départ de 70 %, ajusté par le taux de vente) ou **Avancé** (ta formule). L'exemple sous les réglages se met à jour pendant la saisie.
- **Prix minimum** (facultatif) : en dessous, le prix devient ce minimum.
- **Paliers de prix** (facultatif) : par exemple jusqu'à 20 W, 21–100 W, 101 W et +, chacun avec son calcul, son minimum et sa durée. Le bouton **Proposition** les crée en un clic.
- **Ordre de priorité** : garde **Équilibrée** (ce qui rapporte le plus en moyenne).

L'**aperçu** montre tes prochaines ventes avec ces réglages. Va ensuite une fois sur Marché → onglet **Historique** : ce sont les meilleures données de prix réels. Voir [Prix conseillé](Prix-conseille.md).

## Étape 4 – La durée des enchères

Ventes → **Durée des enchères** : ajoute des paliers, par exemple (ou **Proposition par défaut**) :

| De | À | Durée |
| --- | --- | --- |
| 0 | 20 | 10 min |
| 21 | 100 | 1 h |
| 101 | | 3 h |

Sans palier, la durée par défaut du site (1 h) est gardée. Un palier de prix peut aussi imposer sa durée. La durée conseillée s'affiche avec chaque proposition.

## Étape 5 – Notifications et affichage

Onglet **Sur le site** :

- **Notifications** : une alerte à chaque fin d'enchère, sauf pendant les **heures silencieuses** (23 h – 8 h par défaut).
- **Intégration au site** : le bloc et le menu Wiki-Traders dans la barre latérale (conseillé).
- **Barre latérale compacte** : regroupe Échanges, Guilde, Amis, Messages, Bataille dans *Social*, et Profil, Succès, Classement dans *Progression*.

Onglet **Étiquettes → Sur tes cartes** : **étiquettes visibles sur les cartes**, en libellés ou en simples pastilles de couleur.

Voir [Intégration au site](Integration-au-site.md).

## Étape 6 – (Facultatif) La lecture via l'API

Onglet **Accès au site** → niveau **Lecture** (ou le profil **Confort** dans l'Accueil). Elle permet :

- la relève **automatique** de tes ventes en cours (chaque minute, sans aller sur *Mes ventes*) ;
- **Enchères → Mes mises** (tes enchères sur les cartes des autres) et les ventes conclues ;
- les ventes du marché pour les prix par rareté, et le taux de vente de chaque carte ;
- dans la fenêtre de vente : le résumé du marché de la carte et ses enchères en cours ;
- le rechargement complet de la collection.

Ce sont des **lectures seules** avec ta session, mais le niveau demande une confirmation : lis [Automatisations et risques](Automatisations-et-risques.md).

## Étape 7 – Vérifier

Clique sur le bloc **Wiki-Traders** de la barre latérale : la fenêtre **Vendre** liste les slots à remplir avec une carte, un prix et une durée. Si un slot reste vide, la raison est indiquée.

Tu es prêt : voir **[Vendre](Vendre.md)**.
