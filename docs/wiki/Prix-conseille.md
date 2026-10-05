# Prix conseillé

```
prix conseillé = arrondi(prix de référence × % de l'étiquette)
```

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

Chaque règle d'étiquette a son % (70 % par défaut). Vendre un peu sous la référence part plus vite ; le [journal](Mises-et-ventes#journal) montre la part des ventes parties au prix de départ et conseille d'ajuster.

## L'arrondi

- **0 = automatique** : à l'unité sous 20, à 5 sous 100, à 10 sous 1 000, à 50 au-delà.
- Sinon, un pas fixe (ex. 5).

## Moyenne ou médiane ?

**Médiane** par défaut : quelques ventes énormes (une carte partie à 2 000) tirent la moyenne vers le haut. Option *Compter les enchères en cours dans le prix moyen* : désactivée, seules les ventes terminées comptent.

## Le prix sans règle (Mode enchère)

Une carte sans règle d'étiquette, mise en vente avec le Mode enchère, reçoit son prix de référence (100 %).
