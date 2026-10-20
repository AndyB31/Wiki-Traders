[← Sommaire de la documentation](README.md)

# Vendre

## La fenêtre « Vendre »

Ouvre-la d'un clic sur le bloc **Wiki-Traders** de la barre latérale (ou avec l'icône de l'extension). C'est aussi le premier onglet de la popup (**Vendre**). Chaque **slot libre** affiche :

- le **palier de prix** du slot (ex. `21–100 W`, mode « meilleures cartes ») ou son **étiquette** (ex. `20-50`, mode « par étiquette ») ;
- la **carte proposée**, sa rareté (point coloré) et son nombre d'exemplaires (×3) ;
- le **prix conseillé** et le détail du calcul sur une ligne (« médiane Rare 36 (12 ventes) × 70 % = 25 ») ;
- la **durée conseillée** (celle du palier, sinon selon tes paliers de durée) ;
- un « ? » qui déplie les explications (estimation, prix déduit de la rareté…).

| Bouton | Effet |
| --- | --- |
| **Ouvrir** | Va sur ta collection, met la carte en évidence et affiche le toast « prix conseillé ». Avec le pré-remplissage : ouvre aussi la carte et sa fenêtre de vente, prix et durée remplis. |
| **Vendre…** | Avec l'option *Vendre depuis les ventes conseillées* : fiche de la carte (prix moyen, taux de vente, ventes…), prix et durée modifiables, mise aux enchères en un clic. |
| **Copier le prix** | Copie le prix dans le presse-papiers. |
| Liste déroulante | Choisir une autre carte du même palier ou de la même étiquette. |
| **Ignorer** | Laisse ce slot vide jusqu'à la prochaine enchère. |
| **🔀 Proposer d'autres cartes** | Passe chaque slot à la carte suivante, sans doublon. |
| **◀ Précédent / Suivant ▶** | Mode « meilleures cartes » : passe aux N cartes suivantes de la liste (N = slots libres), en boucle ; ⏮ revient aux meilleures. |

Un slot vide est expliqué : cartes en favori, en liste noire, dans tes familles, déjà en vente, bloquées par les exemplaires gardés, sous le taux de vente minimum, ou aucune carte dans ce palier ou cette étiquette.

## Quelle carte est proposée ?

Tout se règle dans **Réglages → Ventes** ; l'**aperçu** y montre tes prochaines ventes pendant que tu règles.

### Mode « meilleures cartes » (par défaut)

1. **Quelles cartes vendre** : toutes tes cartes sauf celles qui portent certaines étiquettes, ou seulement celles qui portent certaines étiquettes. C'est le seul endroit où les étiquettes jouent sur la vente.
2. Sauf : favoris, liste noire, cartes de tes familles (option, voir [Familles](Familles.md)), cartes déjà en vente (sauf réglage contraire), exemplaires gardés, taux de vente sous le minimum.
3. Les cartes sont rangées par **paliers de prix** (ex. jusqu'à 20 W, 21–100 W, 101 W et +), chacun avec son calcul du prix, son prix minimum et sa durée (voir [Prix conseillé](Prix-conseille.md)). Une carte prend le premier palier qui la contient ; une carte hors de tous les paliers n'est pas proposée. Sans palier, toutes les cartes suivent le calcul par défaut.
4. Les slots libres reçoivent les cartes les mieux classées selon l'**ordre de priorité**, tous paliers confondus. **Suivant ▶** passe aux suivantes.

Option **Réserver des slots par palier** (coupée par défaut) : chaque palier réserve son nombre de slots (ex. 2 slots toujours pour les cartes de plus de 100 W) ; les slots non réservés vont aux meilleures cartes.

### Mode « par étiquette »

Chaque étiquette réserve ses slots, et a son propre calcul du prix (A / B1 / B2), son prix minimum, sa durée et ses exemplaires gardés. Une carte appartient à l'étiquette si elle la porte sur le site. **Étiquette de secours** (réglages fins) : quand une étiquette n'a plus de carte vendable, son slot passe à l'étiquette de secours.

### Ordre de priorité

| Priorité | Carte proposée en premier |
| --- | --- |
| **Équilibrée** (défaut) | Celle qui rapporte le plus en moyenne : prix de départ × chance de vente (le taux de vente pondéré par le nombre d'enchères ; une carte inconnue compte pour 50 %) |
| Rapporter le plus | Le prix de départ le plus haut |
| Vendre vite | Le meilleur taux de vente (fiable), puis le prix le plus haut |
| Écouler | Le plus d'exemplaires en trop, puis le prix le plus bas |
| Mes critères | Une liste de critères appliqués dans l'ordre, chacun départageant les égalités du précédent — prix conseillé, prix moyen, taux de vente, nombre de ventes, enchères terminées, doublons, rareté, hasard — chacun du plus haut ou du plus bas. Une valeur inconnue passe toujours en dernier. |
| Ma formule | Ta formule (mêmes variables que le calcul avancé, `{prix_conseille}` = prix de départ calculé) : le score le plus haut d'abord |

**Doublons d'abord** (activé par défaut) : les cartes en plus d'exemplaires passent avant les autres ; la priorité départage le reste.

## Dans la fenêtre « Mettre aux enchères » du site

Quand tu ouvres la mise en vente d'une carte connue :

- un **toast** rappelle le prix conseillé, son calcul et la durée conseillée ;
- avec la lecture via l'API : sous « Marché · Rare », un **résumé des offres en cours** de la carte (nombre, min, médiane, max) et, sous la fenêtre, la **liste de ses enchères en cours** (prix, mise de départ ou en cours, temps restant), et, à droite (dessous sur un écran étroit), son **historique des prix** (le même que sur la page d'une enchère, en compact : chiffres clés dont le taux de vente, graphique, liste des enchères terminées) ;
- avec le pré-remplissage : la mise de départ et la durée sont remplies une fois (une valeur que tu modifies n'est jamais écrasée).

Le clic **« Mettre aux enchères »** reste toujours le tien.

![Fenêtre de vente](../screenshots/sell-market.png)

## Mode enchère (collection)

Sur la collection, l'interrupteur **Mode enchère** se trouve sur la ligne du titre, à côté de *Sélectionner*.

1. Active-le (la première fois, une confirmation rappelle les risques et active le pré-remplissage).
2. Survole une carte : contour orange et étiquette « Mettre aux enchères ».
3. Clique sur la carte : sa fenêtre **Mettre aux enchères** s'ouvre, **prix et durée remplis**.
4. Vérifie et clique toi-même sur **Mettre aux enchères**.

Le prix est celui du palier ou de l'étiquette de la carte, ou à défaut son prix moyen ; sans prix connu, la fenêtre s'ouvre avec le prix à saisir. Le bouton favori et le lien Wikipédia de la carte gardent leur rôle. Le mode est mémorisé dans le navigateur.

![Mode enchère](../screenshots/auction-mode.png)

> Le Mode enchère clique sur le site à ta place : voir [Automatisations et risques](Automatisations-et-risques.md).

## Après la mise en vente

- La vente apparaît dans **Mes ventes** et dans le bloc Wiki-Traders (slots occupés).
- À la fin de l'enchère : alarme locale, **notification** (« Slot libéré : remets une carte 20-50 »), badge sur l'icône.
- Le **journal** garde la trace de la vente pour ajuster ta mise de départ.
