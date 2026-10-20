[← Sommaire de la documentation](README.md)

# Prix conseillé

```
prix de départ = arrondi(borné(calcul(prix de référence)))
```

Le **calcul** est celui du palier de prix (mode « meilleures cartes ») ou de l'étiquette (mode « par étiquette ») de la carte, sinon le **calcul du prix par défaut**. Il est **borné** par le prix minimum et maximum de ce calcul, puis **arrondi**. Tout se règle dans **Réglages → Ventes**.

## Le prix de référence

Sur WikiMasters, chaque carte est un article Wikipédia quasi unique : une même carte n'est presque jamais revendue. Le « prix moyen d'une carte » n'existe donc souvent pas. L'extension prend, dans l'ordre :

1. **le prix moyen affiché par le site**, s'il existe ;
2. **l'historique de la carte** : au moins 3 ventes dans la période observée (7 jours par défaut) ;
3. **un prix saisi à la main** (Réglages → Avancé → *Prix saisis à la main*) ;
4. **la médiane des ventes conclues de la même rareté** : au moins 5 ventes, les cartes brillantes ✨ cotées à part ;
5. à défaut, une **estimation** (enchères en cours de la même rareté, peu de ventes), signalée comme telle.

Sans aucune donnée, l'extension demande un prix.

### Où l'extension trouve les ventes

- Marché → onglet **Historique** (à visiter de temps en temps) ;
- les pages du marché que tu consultes ;
- avec la lecture via l'API : les ventes conclues des 7 derniers jours, chargées automatiquement ;
- tes propres ventes terminées.

Le bilan (ventes par rareté, dernier chargement) est dans **Outils**.

## Les trois calculs

Chaque palier de prix (et chaque étiquette en mode « par étiquette ») choisit son calcul :

| Option | Calcul |
| --- | --- |
| **A. Par défaut** | Le calcul du prix par défaut (rien de spécifique) |
| **B1. Simple** | Prix moyen × mise de départ, ajusté par le taux de vente |
| **B2. Avancé** | Ta propre formule |

Le calcul par défaut lui-même est Simple ou Avancé. Chaque calcul a un **prix minimum** et un **prix maximum** facultatifs : en dessous de 25, le prix devient 25.

### Calcul simple

```
prix de départ = prix moyen × mise de départ × bonus du taux de vente
bonus          = 1 + influence × (tdv − 50 %) × confiance
confiance      = min(1, enchères terminées ÷ enchères pour être sûr)
```

| Réglage | Défaut | Effet |
| --- | --- | --- |
| Mise de départ | 70 % | Part du prix moyen |
| Influence du taux de vente | 50 % | 0 = aucune ; 50 : une carte vendue à 80 % part 15 % plus haut, à 20 % 15 % plus bas |
| Enchères pour être sûr | 10 | En dessous, le taux de vente ne compte qu'en partie |

Exemples pour une carte à 40 W (départ de base : 40 × 70 % = 28 W) :

| Taux de vente | Enchères terminées | Calcul | Départ |
| --- | --- | --- | --- |
| 80 % | 20 | 28 × 1,15 | 32 W |
| 20 % | 20 | 28 × 0,85 | 24 W |
| 50 % | 2 | confiance 0,2 : presque inchangé | 28 W |

Une carte peu mise en vente n'est donc presque pas ajustée : 1 vente sur 2 enchères ne fait pas un vrai 50 %. Le détail du prix l'indique : « moyenne 40 × 70 % × 115 % (tdv 80 % sur 20) = 32 ». L'exemple sous les réglages se met à jour pendant la saisie.

### Calcul avancé

Une formule dont le résultat est le prix de départ (W). Variables entre accolades :

| Variable | Valeur |
| --- | --- |
| `{prix}` | prix moyen de la carte |
| `{prix_conseille}` | prix du calcul par défaut |
| `{tdv}` | taux de vente (0 à 100 ; 50 si inconnu) |
| `{confiance}` | de 0 (aucune enchère) à 1 (assez d'enchères) |
| `{tdv_fiable}` | 1 si le taux de vente porte sur assez d'enchères (Ventes → Taux de vente), sinon 0 |
| `{ventes}`, `{encheres}` | enchères conclues, enchères terminées |
| `{quantite}`, `{doublons}`, `{vendables}` | exemplaires possédés, en plus du premier, vendables |
| `{rarete}` | 1 (Commune) à 6 (Légendaire) |
| `{brillante}` | 1 si brillante, sinon 0 |

Opérations `+ − * / % ^`, comparaisons (vrai = 1), `&& || !`, fonctions `min`, `max`, `abs`, `arrondi`, `plancher`, `plafond`, `racine`, `log`, `si(condition, alors, sinon)`.

```
{prix} * 0.7 * si({tdv} < 20, 0.8, 1)
```

La formule est vérifiée pendant la saisie ; une formule invalide n'est pas enregistrée. Les paliers de taux de vente d'avant la 1.0 ont été convertis en formule de ce type, pour garder les mêmes prix.

## Le taux de vente

Le **taux de vente (tdv)** d'une carte est la part de ses enchères terminées qui ont trouvé un acheteur (vendues ÷ vendues + sans acheteur + annulées). Il s'affiche sur les cartes de la collection, à côté du prix : « Moy. 12 W · 85 % », avec en bas de la carte « 17 / 20 vendues ».

Réglages → Ventes → **Taux de vente** :

- **Fiable à partir de** (5 enchères terminées par défaut) : seuil pour le minimum ci-dessous, la priorité « Vendre vite », les conditions des étiquettes et `{tdv_fiable}`. Le calcul simple, lui, utilise la confiance.
- **Taux de vente minimum** : une carte sous ce taux (fiable) n'est plus proposée pour remplir un slot (le slot vide l'indique). Tu peux toujours la vendre à la main.

## L'arrondi

- **0 = automatique** : à l'unité sous 20, à 5 sous 100, à 10 sous 1 000, à 50 au-delà.
- Sinon, un pas fixe (ex. 5).

## Moyenne ou médiane ?

**Médiane** par défaut : quelques ventes énormes (une carte partie à 2 000) tirent la moyenne vers le haut. Option *Compter les enchères en cours dans le prix moyen* : désactivée, seules les ventes terminées comptent. Ces réglages sont dans *Réglages fins*, sous le calcul par défaut.

## Le prix d'une carte hors de tes ventes (Mode enchère)

Une carte qui n'est dans aucun palier ni aucune étiquette, mise en vente avec le Mode enchère, reçoit son prix de référence (100 %).
