[← Sommaire de la documentation](README.md)

# Étiquettes

Les étiquettes du site (ex. `20-50`, `50-100`, « Mettre au Enchère ») sont la base de ta répartition : chaque règle réserve des slots à une étiquette.

## Règles par étiquette

Réglages → **Règles par étiquette**. Voir le détail des colonnes dans [Premiers pas](Premiers-pas.md#étape-2--tes-règles-par-étiquette).

- **Appartenance « étiquette du site »** : une carte appartient à la règle si elle porte l'étiquette.
- **Appartenance « plage de prix moyen »** : une carte appartient à la règle si son prix de référence est entre le plancher et le plafond (utile si tes cartes ne sont pas étiquetées).
- **Étiquette de secours** : quand une étiquette n'a plus de carte vendable, son slot passe à l'étiquette de secours.
- **Liste noire** : une carte par ligne, jamais proposée. Les favoris ne le sont jamais non plus.

### Conditions et vente (par étiquette)

Sous chaque règle, le panneau **Conditions et vente** :

**Conditions d'étiquetage** (toutes celles remplies doivent être vraies) :

| Condition | Exemple |
| --- | --- |
| Le nom ou la catégorie contient | `pays, nation` : il suffit d'un mot ; accents et majuscules ignorés |
| Dans la famille | `Films` : une de tes familles |
| Taux de vente | de 0 à 15 % (compté à partir de 5 enchères terminées) |

Une règle avec des conditions est **indépendante** des plages de prix : la carte France (catégorie Pays, 30 W) reçoit `20-50` **et** `Pays`. En appartenance « plage de prix moyen », les conditions comptent aussi pour les ventes.

**Réglages de vente propres** (case à cocher, copiés des réglages globaux au départ) : taux de vente minimum, ordre de choix des cartes, paliers de prix selon le taux de vente, paliers de durée. Voir [Prix conseillé](Prix-conseille.md#réglages-par-étiquette-et-formule-de-score).

## Étiquettes sur les cartes

Option **Étiquettes visibles sur les cartes** : sur chaque carte de la collection, les étiquettes s'affichent en haut, aux couleurs choisies sur le site.

- **libellés détaillés** : le nom de chaque étiquette (3 au plus, puis « +n ») ;
- **pastilles de couleur seulement** : de simples ronds, le nom au survol.

L'interrupteur à côté de ⚙️ dans la popup bascule entre les deux.

| Libellés | Pastilles |
| --- | --- |
| ![Libellés](../screenshots/tag-overlay.png) | ![Pastilles](../screenshots/tag-overlay-dots.png) |

## Étiquetage automatique

> ⚠️ Facultatif et désactivé par défaut : voir [Automatisations et risques](Automatisations-et-risques.md).

Range chaque carte dans l'étiquette dont la plage **plancher – plafond** contient son prix de référence (ex. 62 → `50-100`), une seule plage par carte. Les règles avec des **conditions** (texte, famille, taux de vente) ajoutent en plus leur étiquette à chaque carte qui les remplit. Une étiquette n'est retirée que si sa règle n'est plus remplie, jamais sur un prix ou un taux de vente inconnu.

1. Réglages → Automatisations → **Étiquetage automatique sur le site** (confirmation).
2. Options : **Retirer les autres étiquettes gérées** (une carte ne garde qu'une plage). Les cartes sans prix connu ne sont pas modifiées.
3. Sur ta collection, bouton **Étiquettes** (à côté de « Plus chères ») : la fenêtre d'étiquetage s'ouvre par-dessus la page, avec la liste des changements prévus (carte → étiquette), et pourquoi certaines cartes sont écartées.
4. **Lancer** :
   - par l'**interface** (sur la collection) : l'extension ouvre chaque carte et clique dans le menu des étiquettes ;
   - par l'**API** (option *Étiquetage par l'API*, plus fiable, depuis n'importe quelle page) : les mêmes écritures que la sélection multiple du site, limitées aux étiquettes.
5. Un toast affiche la progression avec un bouton **Arrêter**. Les favoris sont revérifiés avant chaque écriture ; l'étiquetage s'arrête seul si l'interface n'est pas reconnue.

![Étiquetage](../screenshots/autotag.png)

## Étiquettes des invendues

Le site retire les étiquettes d'une carte mise en vente : si l'enchère se termine **sans acheteur**, la carte revenait en collection sans étiquette. Avec l'option **Remettre les étiquettes des invendues** (Réglages → Automatisations, désactivée par défaut, nécessite *Étiquetage par l'API*) :

1. à la mise en vente, l'extension note les étiquettes de la carte (à défaut, l'étiquette de sa règle ou du slot proposé) ;
2. à la fin d'une enchère sans mise, la carte entre dans une file ;
3. un onglet du site ouvert vérifie le statut réel de l'enchère (toutes les 30 s) : invendue ou annulée → les étiquettes sont remises et un toast le signale ; vendue → rien. Une carte pas encore revenue est réessayée pendant 24 h.
