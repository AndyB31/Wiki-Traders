# Intégration au site

Avec l'option **Intégration au site** (activée par défaut), Wiky-Traders s'installe dans l'interface de WikiMasters, à la manière des « Familles » (en violet) de l'extension *WikiMasters – Prix moyen collection*, mais en **orange**.

![Barre latérale](https://raw.githubusercontent.com/AndyB31/Wiky-Traders/main/docs/screenshots/site-sidebar.png)

## Barre latérale compacte

Option **Barre latérale compacte** (activée par défaut) :

- les liens sont plus serrés, pour faire de la place ;
- **Social** regroupe Échanges, Guilde, Amis, Messages et Bataille ;
- **Progression** regroupe Profil, Succès et Classement ;
- un menu s'ouvre d'un clic (son état est mémorisé) et s'ouvre tout seul quand tu es sur une de ses pages ;
- Paquets, Collection, Marché, Toutes les cartes, Paramètres (et les liens des autres extensions, comme Familles et Mes enchères) restent à leur place.

Les liens du site ne sont pas déplacés : ils sont masqués et reproduits dans les menus, et un clic sur la copie utilise la navigation normale du site. Désactiver l'option rend la barre latérale intacte.

> La barre du bas, sur mobile, n'est pas modifiée.

## Le bloc Wiky-Traders (toujours visible)

Au-dessus de *Paramètres* :

| Ligne | Contenu |
| --- | --- |
| Point coloré | Vert : données à jour · orange : anciennes (plus de 30 min) · gris : jamais synchronisé |
| Slots | Slots occupés / total, nombre de libres, barre de remplissage |
| Prochaine fin | Temps avant la fin de ta prochaine enchère |
| Mises | Tes mises en cours : **en tête** (vert) et **surenchéries** (rouge) |
| 24 h | Mises **gagnées** et **perdues** sur les dernières 24 h |
| Synchro | Âge des données, bouton **↻** pour actualiser |

- **Clic sur le bloc** : ouvre la fenêtre **Vendre**.
- **⌄** : replie ou déplie le menu en dessous.
- **↻** : relit tes ventes en cours et tes mises (via l'API si la lecture via l'API est activée, sinon en passant par Marché → *Mes ventes*).

## Le menu Wiky-Traders

| Entrée | S'ouvre | Contenu |
| --- | --- | --- |
| Vendre *(n)* | fenêtre | Les slots à remplir : carte, prix, durée — voir [Vendre](Vendre) |
| Mes ventes *(n)* | fenêtre | Tes enchères en cours |
| Mes mises *(n)* | fenêtre | Tes mises sur les cartes des autres — voir [Mises et ventes](Mises-et-ventes) |
| Cartes & prix | page | Ta collection par famille, étiquette, catégorie ou rareté, et les enchères en cours de chaque carte |
| Ventes conclues | page | Tes ventes terminées et l'écart au prix de la carte |
| Étiquettes | fenêtre | Étiquetage automatique — voir [Étiquettes](Etiquettes) |
| Outils | fenêtre | Relire la page, diagnostic, journal, bilan des prix |
| Réglages | page | L'onglet Wiky-Traders de *Paramètres* |

Les **fenêtres** s'affichent par-dessus la page en cours (Échap ou clic à côté pour fermer). Les **pages** prennent la place du contenu du site (adresse `?wiky=…`), sans le quitter.

![Fenêtre Vendre](https://raw.githubusercontent.com/AndyB31/Wiky-Traders/main/docs/screenshots/site-modal.png)

## L'onglet Wiky-Traders dans Paramètres

Sur la page *Paramètres* du site, un onglet **Wiky-Traders** ouvre tous les réglages de l'extension, aux couleurs du site. L'onglet **Général** ramène aux réglages du site.

![Réglages dans Paramètres](https://raw.githubusercontent.com/AndyB31/Wiky-Traders/main/docs/screenshots/site-settings.png)

## L'icône de l'extension

Sur WikiMasters, l'icône ouvre ou ferme la fenêtre **Vendre**. Ailleurs, elle ouvre le site.

## Toasts

Les messages de l'extension s'affichent en bas à droite, dans le style du site :

- **Prix conseillé** quand tu ouvres la fenêtre de vente d'une carte (avec un bouton *Copier*) ;
- **Progression** des automatisations (barre, étapes, bouton *Arrêter*) ; un résumé réussi disparaît après 10 s, une erreur reste affichée.

## Sans l'intégration

Si tu désactives l'option, l'ancienne **fenêtre flottante** revient : l'interface complète dans une fenêtre déplaçable, redimensionnable et réductible, que l'icône de l'extension ouvre ou ferme.
