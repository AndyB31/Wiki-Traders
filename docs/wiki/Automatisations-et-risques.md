[← Sommaire de la documentation](README.md)

# Automatisations et risques

> ⚠️ Les [règles de la communauté](https://www.wiki-masters.com/rules) (section 3) et les [conditions d'utilisation](https://www.wiki-masters.com/terms) (section 6) de WikiMasters interdisent les bots, scripts et macros qui jouent ou échangent à ta place. Le risque est un **bannissement définitif, avec perte des cartes**, sans préavis.

Par défaut, Wiki-Traders ne fait que **lire** ce que la page affiche et **conseiller**. Les options ci-dessous vont plus loin : elles sont désactivées et demandent une confirmation ; tant que le pré-remplissage ou l'étiquetage automatique est actif, un avertissement reste affiché en bas de la popup.

**Réglages → Accès au site** regroupe le niveau d'accès (**Aucun accès**, **Lecture**, **Lecture et étiquettes**) et la liste de toutes les actions à ta place, activées ou non, avec un lien vers l'endroit où chacune se règle. Chaque option est rangée avec ce qu'elle concerne, avec un badge ⚠ risque. Les profils **Confort** et **Complet** (Réglages → Accueil) en activent plusieurs d'un coup, après confirmation ; aucun ne met en vente à ta place.

| Option | Où la régler | Ce qu'elle fait sur le site | Niveau |
| --- | --- | --- | --- |
| Lecture via l'API | Accès au site → Lecture | Requêtes de **lecture** à l'API du site, avec ta session (les mêmes que fait le site) | Lecture seule |
| Fenêtre de vente enrichie | Ventes → Aide à la vente | Ajoute des informations dans la fenêtre de vente (nécessite l'API) | Affichage |
| Ouvrir la vente et pré-remplir le prix | Ventes → Aide à la vente | **Clique** pour ouvrir la carte et sa vente, **remplit** prix et durée | Interaction |
| Mode enchère | Interrupteur sur la collection | Même chose, au clic sur une carte de la collection | Interaction |
| Étiquetage automatique (interface) | Étiquettes → Étiquetage automatique | **Clique** dans le menu des étiquettes de chaque carte | Interaction |
| Étiquetage par l'API | Accès au site → Lecture et étiquettes | **Écrit** les étiquettes (table des étiquettes de cartes uniquement) | Écriture |
| Étiquetage en continu | Étiquettes → Lancement | **Écrit** les étiquettes tout seul, tant qu'un onglet du site est ouvert (par l'API, par petits lots) | Écriture |
| Étiquettes des invendues | Étiquettes → Étiquetage automatique | **Écrit** à nouveau les étiquettes d'une carte revenue d'une enchère sans acheteur | Écriture |
| Surenchère en un clic | Sur le site → Marché et enchères | **Mise** à ta place (montant minimal, après confirmation) | Action |
| Vendre depuis le classement | Ventes → Aide à la vente | **Met aux enchères** à ta place (après deux clics de confirmation) | Action |
| Vendre depuis les ventes conseillées | Ventes → Aide à la vente | **Met aux enchères** à ta place, en un clic dans la fenêtre « Vendre… » d'une vente conseillée | Action |
| Ouvrir tous les paquets / ouverture automatique | Sur le site → Paquets | **Ouvre** tes paquets à ta place | Action |

Ce que l'extension ne fait **jamais** : acheter, échanger, ou agir sans que l'option correspondante soit activée. Mise, mise en vente et ouverture de paquets ne se font qu'avec les options ci-dessus, après confirmation. La défausse ne se fait que sur ton clic « Tout défausser » (ou « Défausser X cartes », pour les cartes cochées) sous le récapitulatif d'ouverture (confirmation au-delà du seuil réglé dans Sur le site → Paquets).

## Garde-fous

- Confirmation à l'activation de chaque option.
- Les **favoris** ne sont jamais proposés ni modifiés (revérifiés avant chaque écriture).
- Une valeur que tu modifies dans la fenêtre de vente n'est jamais écrasée.
- L'étiquetage s'arrête seul si l'interface n'est pas reconnue, et se stoppe d'un clic (**Arrêter**).
- Pauses aléatoires entre les actions.

## Désactiver

Décoche l'option là où elle se règle (la liste de **Réglages → Accès au site** y mène), ou repasse le niveau d'accès sur **Aucun accès** ; c'est enregistré aussitôt. Le profil **Prudent** (Réglages → Accueil) coupe tout d'un coup. L'interrupteur **Mode enchère** se coupe d'un clic sur la collection.
