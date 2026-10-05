[← Sommaire de la documentation](README.md)

# Automatisations et risques

> ⚠️ Les [règles de la communauté](https://www.wiki-masters.com/rules) (section 3) et les [conditions d'utilisation](https://www.wiki-masters.com/terms) (section 6) de WikiMasters interdisent les bots, scripts et macros qui jouent ou échangent à ta place. Le risque est un **bannissement définitif, avec perte des cartes**, sans préavis.

Par défaut, Wiky-Traders ne fait que **lire** ce que la page affiche et **conseiller**. Les options ci-dessous vont plus loin : elles sont désactivées et demandent une confirmation ; tant que le pré-remplissage ou l'étiquetage automatique est actif, un avertissement reste affiché en bas de la popup.

| Option | Ce qu'elle fait sur le site | Niveau |
| --- | --- | --- |
| Lecture via l'API | Requêtes de **lecture** à l'API du site, avec ta session (les mêmes que fait le site) | Lecture seule |
| Fenêtre de vente enrichie | Ajoute des informations dans la fenêtre de vente (nécessite l'API) | Affichage |
| V4 – pré-remplissage | **Clique** pour ouvrir la carte et sa vente, **remplit** prix et durée | Interaction |
| Mode enchère | Même chose, au clic sur une carte de la collection | Interaction |
| Étiquetage automatique (interface) | **Clique** dans le menu des étiquettes de chaque carte | Interaction |
| Étiquetage par l'API | **Écrit** les étiquettes (table des étiquettes de cartes uniquement) | Écriture |

Ce que l'extension ne fait **jamais**, même avec ces options : cliquer sur « Mettre aux enchères », miser, acheter, échanger, ouvrir des paquets, ou modifier autre chose que des étiquettes.

## Garde-fous

- Confirmation à l'activation de chaque option.
- Les **favoris** ne sont jamais proposés ni modifiés (revérifiés avant chaque écriture).
- Une valeur que tu modifies dans la fenêtre de vente n'est jamais écrasée.
- L'étiquetage s'arrête seul si l'interface n'est pas reconnue, et se stoppe d'un clic (**Arrêter**).
- Pauses aléatoires entre les actions.

## Désactiver

Réglages → **Automatisations** : décoche l'option puis **Enregistrer**. L'interrupteur **Mode enchère** se coupe d'un clic sur la collection.
