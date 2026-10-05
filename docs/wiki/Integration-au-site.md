[← Sommaire de la documentation](README.md)

# Intégration au site

Avec l'option **Intégration au site** (activée par défaut), Wiky-Traders s'installe dans l'interface de WikiMasters, à la manière des « Familles » (en violet) de l'extension *WikiMasters – Prix moyen collection*, mais en **orange**.

![Barre latérale](../screenshots/site-sidebar.png)

## Barre latérale

Avec l'option **Barre latérale compacte** (activée par défaut), toute la barre est rangée en une seule arborescence, où les pages de Wiky-Traders sont mêlées à celles du site et reconnaissables à leur **icône orange** :

| Place | Contenu |
| --- | --- |
| En haut | **Paquets** |
| **Collection ▸** | Ma collection · Toutes les cartes · 🟠 Familles · 🟠 Cartes & prix · 🟠 Étiquettes |
| **Marché ▸** | Parcourir le marché · 🟠 Vendre · 🟠 Mes ventes · 🟠 Mes mises · 🟠 Ventes conclues |
| **Social ▸** | Échanges · Guilde · Amis · Messages · Bataille |
| **Progression ▸** | Profil · Succès · Classement |
| En bas | Le **récapitulatif Wiky-Traders** (et « Mises en direct ») |
| Tout en bas | **Paramètres ▸** : Paramètres du site · 🟠 Réglages Wiky-Traders · 🟠 Outils |

- Un clic sur **Collection**, **Marché** ou **Paramètres** ouvre la page et déplie le menu ; la **flèche** ne fait que déplier ou replier.
- Le menu de la page affichée est ouvert et mis en valeur ; l'état des autres menus est mémorisé.
- 🟠 Les pastilles orange (ex. *Vendre 2*) comptent les slots à remplir, les ventes et les mises en cours.
- Les liens d'autres extensions (ex. « Familles » et « Mes enchères » de *Prix moyen collection*, en violet) sont rangés au même endroit.

Les liens du site ne sont pas déplacés : ils sont masqués et reproduits dans les menus, et un clic utilise la navigation normale du site. Désactiver l'option rend la barre du site intacte, avec un bloc Wiky-Traders (récapitulatif et menu) au-dessus de *Paramètres*.

> La barre du bas, sur mobile, n'est pas modifiée.

## Le récapitulatif Wiky-Traders (toujours visible)

Juste au-dessus de *Paramètres* :

| Ligne | Contenu |
| --- | --- |
| Point coloré | Vert : données à jour · orange : anciennes (plus de 30 min) · gris : jamais synchronisé |
| Slots | Slots occupés / total, nombre de libres, barre de remplissage |
| Prochaine fin | Temps avant la fin de ta prochaine enchère |
| Mises | Tes mises en cours : **en tête** (vert) et **surenchéries** (rouge) |
| 24 h | Mises **gagnées** et **perdues** sur les dernières 24 h |
| Synchro | Âge des données, bouton **↻** pour actualiser |

- **Clic sur le récapitulatif** : ouvre la fenêtre **Vendre**.
- **↻** : relit tes ventes en cours et tes mises.
- Dessous, **Mises en direct** : tes mises en jeu avec leur compte à rebours.

## Les pages de l'extension

| Entrée | S'ouvre | Contenu |
| --- | --- | --- |
| Vendre *(n)* | fenêtre | Les slots à remplir : carte, prix, durée — voir [Vendre](Vendre.md) |
| Mes ventes *(n)* | fenêtre | Tes enchères en cours |
| Mes mises *(n)* | fenêtre | Tes mises sur les cartes des autres — voir [Mises et ventes](Mises-et-ventes.md) |
| Familles | page | Voir [Familles](Familles.md) |
| Cartes & prix | page | Ta collection par famille, étiquette, catégorie ou rareté, et les enchères en cours de chaque carte |
| Ventes conclues | page | Tes ventes terminées et l'écart au prix de la carte |
| Étiquettes | fenêtre | Étiquetage automatique — voir [Étiquettes](Etiquettes.md) |
| Outils | fenêtre | Relire la page, diagnostic, journal, bilan des prix |
| Réglages Wiky-Traders | page | L'onglet Wiky-Traders de *Paramètres* |

Les **fenêtres** s'affichent par-dessus la page en cours (Échap ou clic à côté pour fermer). Les **pages** prennent la place du contenu du site (adresse `?wiky=…`), sans le quitter.

![Fenêtre Vendre](../screenshots/site-modal.png)

## L'onglet Wiky-Traders dans Paramètres

Sur la page *Paramètres* du site, un onglet **Wiky-Traders** ouvre tous les réglages de l'extension, aux couleurs du site. L'onglet **Général** ramène aux réglages du site.

![Réglages dans Paramètres](../screenshots/site-settings.png)

## L'icône de l'extension

Sur WikiMasters, l'icône ouvre ou ferme la fenêtre **Vendre**. Ailleurs, elle ouvre le site.

## Toasts

Les messages de l'extension s'affichent en bas à droite, dans le style du site :

- **Prix conseillé** quand tu ouvres la fenêtre de vente d'une carte (avec un bouton *Copier*) ;
- **Progression** des automatisations (barre, étapes, bouton *Arrêter*) ; un résumé réussi disparaît après 10 s, une erreur reste affichée.

## Sans l'intégration

Si tu désactives l'option, l'ancienne **fenêtre flottante** revient : l'interface complète dans une fenêtre déplaçable, redimensionnable et réductible, que l'icône de l'extension ouvre ou ferme.
