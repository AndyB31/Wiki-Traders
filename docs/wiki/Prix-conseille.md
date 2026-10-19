[← Sommaire de la documentation](README.md)

# Prix conseillé

```
prix conseillé = arrondi(prix de référence × % de l'étiquette × ajustement selon le taux de vente)
```

L'ajustement selon le taux de vente est facultatif : sans palier réglé, il vaut 1 (voir [Le taux de vente](#le-taux-de-vente)).

## Le prix de référence

Sur WikiMasters, chaque carte est un article Wikipédia quasi unique : une même carte n'est presque jamais revendue. Le « prix moyen d'une carte » n'existe donc souvent pas. L'extension prend, dans l'ordre :

1. **le prix moyen affiché par le site**, s'il existe ;
2. **l'historique de la carte** : au moins 3 ventes dans la fenêtre (7 jours par défaut) ;
3. **un prix saisi à la main** (Réglages → *Prix saisis à la main*) ;
4. **la médiane des ventes conclues de la même rareté** : au moins 5 ventes, les cartes brillantes ✨ cotées à part ;
5. à défaut, une **estimation** (enchères en cours de la même rareté, peu de ventes), signalée comme telle.

Sans aucune donnée, l'extension demande un prix.

### Où l'extension trouve les ventes

- Marché → onglet **Historique** (à visiter de temps en temps) ;
- les pages du marché que tu consultes ;
- avec la lecture via l'API : les ventes conclues des 7 derniers jours, chargées automatiquement ;
- tes propres ventes terminées.

Le bilan (ventes par rareté, dernier chargement) est dans **Outils**.

## Le pourcentage

Chaque règle d'étiquette a son % (70 % par défaut). Vendre un peu sous la référence part plus vite ; le [journal](Mises-et-ventes.md#journal) montre la part des ventes parties au prix de départ et conseille d'ajuster.

## Le taux de vente

Le **taux de vente (tdv)** d'une carte est la part de ses enchères terminées qui ont trouvé un acheteur (vendues ÷ vendues + sans acheteur + annulées). Il s'affiche sur les cartes de la collection, à côté du prix : « Moy. 12 W · 85 % », avec en bas de la carte « 17 / 20 vendues ». Il ne sert au calcul qu'à partir de **5 enchères terminées**.

Réglages → **Taux de vente** :

- **Taux de vente minimum** : une carte sous ce taux n'est plus proposée pour remplir un slot (le slot vide l'indique). Tu peux toujours la vendre à la main.
- **Prix selon le taux de vente** : des paliers qui ajustent le prix conseillé. Par exemple, la proposition par défaut donne :

| Tdv | Prix |
| --- | --- |
| 80 % et + | +30 % |
| 50–79 % | inchangé |
| 20–49 % | −20 % |
| moins de 20 % | −50 % |

Le détail du prix l'indique : « moyenne 40 × 70 % −50 % (tdv 10 %) = 14 ».

## Réglages par étiquette et formule de score

Dans le panneau **Conditions et vente** d'une règle, la case **Réglages de vente propres à cette étiquette** remplace, pour elle seule, le taux de vente minimum, les paliers de prix selon le tdv, les paliers de durée et l'**ordre de choix** des cartes :

| Ordre | Carte proposée en premier |
| --- | --- |
| la plus chère / la moins chère / au hasard | après les doublons, comme le réglage global |
| meilleur taux de vente | après les doublons, le tdv le plus haut (fiable) |
| formule de score | le score le plus haut |

La **formule de score** utilise des variables entre accolades : `{prix}`, `{prix_conseille}`, `{tdv}` (0 si inconnu), `{ventes}`, `{encheres}`, `{quantite}`, `{doublons}`, `{vendables}`, `{rarete}` (1 à 6), `{brillante}` (0 ou 1). Opérations `+ − * / % ^`, comparaisons (vrai = 1), `&& || !`, fonctions `min`, `max`, `abs`, `arrondi`, `plancher`, `plafond`, `racine`, `log`, `si(condition, alors, sinon)`.

```
si({tdv} < 20, 0, {prix} * {tdv} / 100 + {doublons} * 10)
```

La formule est vérifiée pendant la saisie ; une formule invalide bloque l'enregistrement.

## L'arrondi

- **0 = automatique** : à l'unité sous 20, à 5 sous 100, à 10 sous 1 000, à 50 au-delà.
- Sinon, un pas fixe (ex. 5).

## Moyenne ou médiane ?

**Médiane** par défaut : quelques ventes énormes (une carte partie à 2 000) tirent la moyenne vers le haut. Option *Compter les enchères en cours dans le prix moyen* : désactivée, seules les ventes terminées comptent.

## Le prix sans règle (Mode enchère)

Une carte sans règle d'étiquette, mise en vente avec le Mode enchère, reçoit son prix de référence (100 %).
