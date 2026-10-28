[← Sommaire de la documentation](README.md)

# Référence des réglages

Réglages : **Paramètres → onglet Wiki-Traders** sur le site, ou page d'options de l'extension. Depuis la **version 1.0.0**, ils sont rangés en onglets (8 depuis la 1.1.0, avec **Interface**), par ce que tu veux faire. Chaque section s'ouvre sur une explication avec un exemple, les « ? » détaillent chaque champ.

**Enregistrement automatique** : chaque modification est enregistrée aussitôt (Ctrl/⌘ + S force l'enregistrement). Le bandeau du bas affiche « ✓ Enregistré » avec un bouton **Annuler** qui revient à l'état d'avant tes dernières modifications. Une saisie invalide n'est pas enregistrée : l'erreur s'affiche à côté du champ.

Tes réglages d'avant la 1.0 ont été convertis automatiquement pour donner les mêmes prix et le même ordre de vente.

## Accueil

- **Démarrage rapide** : ce qui est prêt, ce qui manque, réglable en un clic.
- **Profil** : règle d'un coup ce que Wiki-Traders a le droit de faire sur le site. Tu peux ensuite tout ajuster onglet par onglet.

| Profil | Effet |
| --- | --- |
| Prudent | Aucun accès au site : conseils à partir des pages que tu ouvres. Aucun risque. |
| Confort | Lecture via l'API : prix, mises et ventes à jour. Rien n'est fait à ta place. |
| Complet | Lecture et étiquetage par l'API, étiquetage automatique activé. La mise en vente reste à toi. |

Les profils Confort et Complet demandent une confirmation (risque de bannissement).

## Ventes

Voir [Prix conseillé](Prix-conseille.md) pour le détail des calculs et [Vendre](Vendre.md) pour l'usage.

| Section | Réglages | Défaut |
| --- | --- | --- |
| Mes slots | Nombre de slots ; **mode** « meilleures cartes » ou « par étiquette » | 5 ; meilleures cartes |
| Quelles cartes vendre *(meilleures cartes)* | « toutes, sauf celles avec ces étiquettes » ou « seulement celles avec ces étiquettes », étiquettes à cocher ; exemplaires gardés | toutes ; 1 |
| Mes étiquettes *(par étiquette)* | Pour chaque étiquette : slots réservés, exemplaires gardés, durée, calcul du prix (A / B1 / B2) | — |
| Calcul du prix par défaut | Simple (mise de départ, influence du taux de vente, enchères pour être sûr) ou Avancé (formule) ; prix minimum et maximum ; arrondi ; réglages fins (statistique, période observée, étiquette de secours, enchères en cours) | 70 % · 50 % · 10 ; arrondi automatique ; médiane, 7 jours |
| Paliers de prix *(meilleures cartes)* | Par palier de prix moyen : calcul A / B1 / B2, prix minimum et maximum, durée ; option **Réserver des slots par palier** | aucun palier ; option coupée |
| Ordre de priorité | Équilibrée, Rapporter le plus, Vendre vite, Écouler, Mes critères, Ma formule ; **Doublons d'abord** | Équilibrée ; doublons d'abord |
| Aperçu | Tes prochaines ventes avec les réglages en cours, recalculées pendant la saisie | — |
| Jamais vendu | Proposer une carte déjà en vente ; liste noire (une carte par ligne). Favoris ★ toujours protégés ; cartes des familles : voir Familles | non ; vide |
| Taux de vente | Fiable à partir de N enchères terminées ; taux de vente minimum | 5 ; aucun |
| Durée des enchères | Paliers **Mise de – à → Durée** (10 min à 12 h) ; le premier qui correspond l'emporte ; sans palier, la durée du site (1 h) | aucun palier |
| Aide à la vente | Fenêtre de vente du site (résumé du marché, enchères en cours de la carte, historique des prix) ; actions à ta place ⚠ (pré-remplissage, Vendre depuis les ventes conseillées, Vendre depuis le classement) | voir [Automatisations et risques](Automatisations-et-risques.md) |

## Étiquettes

| Section | Réglages |
| --- | --- |
| Mes étiquettes | Pour chaque étiquette : nom, **plage de prix**, **conditions en plus** (le nom ou la catégorie contient, taux de vente). Sert uniquement à l'étiquetage automatique. |
| Étiquetage automatique ⚠ | Activation ; **Lancement** : à la demande (depuis la popup) ou **en continu** ; retirer les autres étiquettes suivies ; retirer les étiquettes des cartes sans prix connu ; remettre les étiquettes des invendues ; « Tout étiqueter » après ouverture d'un paquet |
| Sur tes cartes | Étiquettes visibles sur les cartes ; style (libellés ou pastilles) |

Voir [Étiquettes](Etiquettes.md).

## Familles

| Section | Réglages | Défaut |
| --- | --- | --- |
| Familles sur le site | Familles ; familles sur les cartes | oui ; oui |
| Une étiquette par famille | « Les cartes de [famille] reçoivent l'étiquette [étiquette] », posée par l'étiquetage automatique | aucune |
| Vente | Ne jamais vendre les cartes de mes familles | oui |

Voir [Familles](Familles.md).

## Interface

| Section | Réglages | Défaut |
| --- | --- | --- |
| Barre latérale | Intégration au site ; barre latérale compacte | oui ; oui |
| Vues de la collection | Tes propres menus sous « Collection » : nom, icône, filtre, tri ; affichée ou non, ordre, dupliquer, supprimer | aucune |

Une **vue** est un menu de la barre latérale qui ouvre ta collection avec un filtre et un tri déjà posés. Exemple : « 10-100 A→Z » = étiquette *10-100*, tri par *Nom A → Z*. Crée-en autant que tu veux avec **+ Nouvelle vue**.

- **Filtres** (tous facultatifs, ils se cumulent) : nom ou catégorie contient (plusieurs mots séparés par des virgules : l'un d'eux suffit) ; étiquettes (au moins une / toutes), étiquettes exclues, seulement les cartes sans étiquette ; raretés ; favoris (oui / non / indifférent) ; brillantes ; famille ; nombre d'exemplaires ; prix moyen (une carte sans prix connu est écartée dès qu'une limite est posée).
- **Tri** : nom, prix moyen, valeur (prix × exemplaires), rareté, exemplaires, taux de vente, nombre de ventes, catégorie, étiquette, favoris, date d'ajout ; dans un sens ou dans l'autre. Rareté, Nom (A → Z), Favoris et Date d'ajout passent par le tri du site (toutes les pages) ; les autres rangent la page affichée. Les cartes sans valeur (prix pas encore lu…) passent à la fin.
- **Icône du menu** : clique sur l'icône à côté du nom de la vue pour choisir parmi 21 icônes (entonnoir par défaut, étoile, cœur, couronne, flamme, gemme, trophée…) ; Échap referme le choix.
- À l'ouverture, la vue remplit les filtres du site (recherche, étiquette, raretés, tri) ; le reste est filtré sur la page affichée.
- Sous la vue, le nombre de cartes de ta collection qui y correspondent, et les premières.

Voir [Intégration au site](Integration-au-site.md#vues-de-la-collection).

## Sur le site

- **Fonctionnalités** par thème (collection, affichage des cartes, marché et enchères, paquets, échanges) : voir [Fonctionnalités](Fonctionnalites.md). Seuil de confirmation de « Tout défausser » avec les paquets.
- **Notifications** (fin d'enchère, slot libéré) et **heures silencieuses** (23:00 – 08:00 par défaut).

## Accès au site

Un seul choix de niveau, avec l'avertissement de bannissement :

| Niveau | Effet |
| --- | --- |
| Aucun accès (défaut) | Wiki-Traders lit seulement les pages que tu ouvres. |
| Lecture | Lit les prix, tes mises et les ventes du marché via l'API, avec ta session. |
| Lecture et étiquettes | En plus, écrit tes étiquettes directement (étiquetage automatique plus fiable, mode continu). |

Dessous, la liste de toutes les **actions à ta place** (activée ou non), avec un lien vers l'endroit où chacune se règle. Partout ailleurs, une option qui a besoin de l'API l'indique (« ⚠ Nécessite la lecture via l'API ») avec un bouton **Activer…**. Voir [Automatisations et risques](Automatisations-et-risques.md).

## Avancé

- **Pages du site** : page « mes enchères » (automatique, ex. `/marketplace?tab=mine`), page ouverte par « Ouvrir » (`/collection`).
- **Sélecteurs avancés** (JSON) : à ajuster si le site change (voir [Dépannage](Depannage.md#page-non-reconnue)).
- **Prix saisis à la main** : un prix de référence fixe pour une carte (prioritaire sur la médiane de la rareté).
- **Données** : cartes connues, dernière lecture de la collection.
- **Mises à jour** : voir [Installation](Installation.md).
- **Sauvegarde** : **Exporter (JSON)** / **Importer…** pour garder ou transférer tes réglages ; **Effacer toutes les données**.
