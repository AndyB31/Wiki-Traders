# Mises et ventes

## Mes ventes en cours

Fenêtre **Mes ventes** : chaque enchère avec sa carte, sa règle, son prix actuel et le temps restant.

Elles sont relues :

- **automatiquement via l'API** (si la lecture via l'API est activée) : au chargement d'une page du site, puis chaque minute tant qu'un onglet WikiMasters est visible, et en revenant sur l'onglet ;
- en ouvrant Marché → **Mes ventes** ;
- avec **↻** (bloc Wiky-Traders) ou 🔄 : via l'API, sinon l'extension va sur Marché → *Mes ventes* et relit la liste.

Une vente qui disparaît de la liste est comptée comme terminée (journal, prix final dans l'historique). Le nombre total de slots vient de tes réglages ou de « Mes ventes (2/5) » sur le site.

## Mes mises

*Nécessite la lecture via l'API.* Fenêtre **Mes mises** : les enchères des autres joueurs où tu as misé.

| Statut | Sens |
| --- | --- |
| En tête | Ta mise est la plus haute |
| Surenchéri | Quelqu'un a misé plus que toi |
| Gagnée / Perdue | Enchère terminée |
| Annulée | Enchère annulée par le vendeur |

Pour chaque mise : ta mise maximale, le prix actuel ou final, le temps restant et le **prix de la carte** (médiane de ses ventes) pour juger si tu paies trop cher. Le bloc Wiky-Traders résume les mises en cours et les résultats des dernières 24 h.

![Mises](https://raw.githubusercontent.com/AndyB31/Wiky-Traders/main/docs/screenshots/window-bids.png)

## Ventes conclues

*Nécessite la lecture via l'API.* Page **Ventes conclues** : tes ventes terminées, avec :

- le prix de départ et le prix final (gain en %) ;
- l'écart au **prix de la carte** (médiane de ses autres ventes) ou à la médiane de sa rareté ;
- le total et l'écart moyen ; option pour afficher les **invendues**.

![Ventes conclues](https://raw.githubusercontent.com/AndyB31/Wiky-Traders/main/docs/screenshots/window-sold.png)

## Cartes & prix

Page **Cartes & prix** : ta collection groupée par **famille** (familles de l'extension *Prix moyen collection*), **étiquette**, **catégorie** ou **rareté**, avec recherche. Un clic sur une carte affiche ses **enchères en cours**, de la moins chère à la plus chère (*Ouvrir* mène à la moins chère). Les cartes manquantes d'une famille apparaissent en premier.

## Journal

Outils → **📒 Journal** : toutes les ventes **proposées**, **créées** et **terminées**, avec par étiquette la part des ventes parties au prix de départ et un conseil pour ajuster ton %.

![Journal](https://raw.githubusercontent.com/AndyB31/Wiky-Traders/main/docs/screenshots/journal.png)
