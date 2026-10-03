# WikiMasters – Assistant d'enchères (specs)

Oct 3, 2026

## Faisabilité : possible techniquement, interdit en 100 % automatique

Une extension Chrome peut lire la page des enchères, calculer les prix et créer des ventes toute seule. Le problème n'est pas technique : les règles de WikiMasters l'interdisent explicitement.

- [Règles de la communauté](https://www.wiki-masters.com/rules), section 3 : les bots, scripts, macros et tout outil qui joue, échange ou interagit à votre place sont interdits, tout comme l'interception du trafic du site pour obtenir un avantage.
- [Conditions d'utilisation](https://www.wiki-masters.com/terms), section 6 : l'automatisation peut entraîner un bannissement sans préavis, avec perte possible du compte et des cartes.

Une extension qui crée les enchères elle-même expose donc ton compte à un ban définitif. Ces specs décrivent un **copilote** : l'extension fait tout le travail de réflexion (quel slot est libre, quelle carte mettre, à quel prix) et c'est toi qui cliques sur « Mettre en vente ». Tu gardes 90 % du gain de temps sans automatiser l'action interdite.

Pour aller plus loin légitimement : demander l'accord des développeurs via le contact de l'app, ou leur proposer la fonctionnalité « répartition automatique des ventes » directement dans le jeu.

## Objectif et périmètre

L'extension garde tes 5 slots d'enchères remplis selon une répartition par étiquette, avec un prix calculé à partir du prix moyen du marché. Exemple : 1 carte « 50-100 » + 4 cartes « 20-50 », chacune à 70 % de son prix moyen.

| Fait par l'extension | Fait par toi |
| --- | --- |
| Lire tes enchères en cours et tes étiquettes quand tu es sur le site | Ouvrir le site |
| Détecter les slots libres et l'heure de fin de chaque enchère | Cliquer sur la notification |
| Choisir la carte à vendre selon la répartition | Valider ou changer la carte proposée |
| Calculer le prix (moyenne × % de l'étiquette) | Cliquer sur « Mettre en vente » |
| T'alerter quand un slot se libère |  |

Hors périmètre : création d'enchère sans clic humain, rafraîchissement automatique des pages en arrière-plan, appels directs aux API internes du site, enchères automatiques sur les cartes des autres joueurs.

## Fonctionnalités détaillées

### F1 – Règles de répartition par étiquette

Chaque étiquette de ton album peut recevoir une règle. La somme des quotas ne peut pas dépasser le nombre de slots (5 par défaut, modifiable).

| Étiquette | Quota (slots) | % du prix moyen | Prix plancher | Prix plafond | Garder au moins | Active |
| --- | --- | --- | --- | --- | --- | --- |
| 50-100 | 1 | 70 % | 50 | 100 | 1 exemplaire | oui |
| 20-50 | 4 | 70 % | 20 | 50 | 1 exemplaire | oui |

- **Quota** : nombre de slots que cette étiquette doit occuper en permanence.
- **Garder au moins** : l'extension ne propose jamais de vendre ton dernier exemplaire (par défaut, seuls les doublons sont vendables).
- **Exclusions** : les cartes épinglées en favori et une liste noire manuelle ne sont jamais proposées.
- **Étiquette de secours** (optionnelle) : si une étiquette n'a plus de carte vendable, son slot est proposé à une autre étiquette au lieu de rester vide.

### F2 – Détection des slots libres

1. Quand tu ouvres la page de tes enchères, l'extension relève chaque enchère en cours : carte, étiquette, prix, heure de fin.
2. Pour chaque étiquette : manque = quota − enchères actives de cette étiquette.
3. L'heure de fin de chaque enchère programme une alarme locale. À l'heure dite, une notification annonce le slot libéré et l'étiquette à remettre, sans recharger le site.
4. Le badge de l'icône affiche le nombre de slots libres (ex. « 2 »).

Une enchère créée à la main hors règles est comptée dans son étiquette si la carte en a une, sinon dans « hors répartition », qui occupe un slot sans casser les quotas.

### F3 – Choix de la carte à vendre

Pour une étiquette en manque, l'extension classe les cartes vendables :

1. Plus grand nombre de doublons d'abord.
2. Puis prix calculé le plus haut (option : le plus bas, pour écouler).
3. Une carte déjà en vente n'est pas proposée deux fois, sauf si tu l'autorises.

Tu peux toujours remplacer la carte proposée par une autre de la même étiquette.

### F4 – Calcul du prix

```latex
\text{prix} = \min\big(\text{plafond},\ \max(\text{plancher},\ \text{arrondi}(\text{prix moyen} \times \%))\big)
```

- **Prix moyen** : moyenne des ventes observées pour cette carte sur une fenêtre glissante (7 jours par défaut). Option médiane, plus résistante aux ventes aberrantes.
- **Source** : le prix moyen affiché par le site s'il existe ; sinon l'historique construit par l'extension à partir des enchères que tu consultes.
- **Peu de données** : sous 3 ventes observées, l'extension utilise la moyenne des cartes de même rareté dans l'étiquette, et affiche « estimation ». Sans aucune donnée, elle te demande un prix.
- **Arrondi** : à la dizaine (réglable).
- Le détail du calcul est toujours visible : « moyenne 86 × 70 % = 60 ».

### F5 – File de mise en vente

La popup liste une ligne par slot à remplir : carte, étiquette, prix proposé, détail du calcul. Pour chaque ligne :

- **Ouvrir** : va sur la page de vente de la carte et affiche le prix à saisir, avec un bouton copier.
- **Changer de carte** / **Ignorer ce slot**.

Un mode « pré-remplissage » (le champ prix rempli, le clic final reste à toi) peut être ajouté, désactivé par défaut : c'est une zone grise vis-à-vis des règles, à n'activer qu'avec l'accord des développeurs.

### F6 – Journal

Historique local des ventes proposées, créées et terminées : carte, prix de départ, prix final, écart au prix moyen. Sert à ajuster le % de chaque étiquette (si tout part au prix de départ, ton % est sans doute trop bas).

## Architecture technique

Une extension Manifest V3 sans serveur : tout est calculé et stocké dans ton navigateur, et la seule action sur le site est ton clic.

&#91;embedded content: architecture · boucle lecture → conseil → clic humain\]

Le content script lit ce que tu affiches, le service worker décide quoi vendre et à quel prix, la popup te le propose, et c'est toi qui crées l'enchère.

**Socle**

- Manifest V3, compatible Chrome, Edge, Brave et Firefox.
- Permissions : `storage`, `alarms`, `notifications` ; accès hôte limité à `https://www.wiki-masters.com/*`.
- TypeScript + Vite ; aucun appel réseau sortant, aucune donnée envoyée ailleurs.
- Le site est une application Next.js qui change de page sans recharger : le content script suit les changements d'URL et du DOM (MutationObserver).

**Modules**

| Module | Rôle |
| --- | --- |
| `parsers/` | Lire enchères, collection, étiquettes et prix depuis le DOM ; sélecteurs dans `selectors.ts` |
| `allocation.ts` | Calculer le manque par étiquette et classer les cartes vendables (F1–F3) |
| `pricing.ts` | Prix moyen ou médian, % de l'étiquette, plancher, plafond, arrondi (F4) |
| `alarms.ts` | Une alarme par fin d'enchère, notification et badge (F2) |
| `ui/` | Popup, page d'options, overlay sur la page de vente, journal |

**Modèle de données** (chrome.storage.local)

| Objet | Champs |
| --- | --- |
| TagRule | étiquette, quota, pct, plancher, plafond, garderMin, active |
| Card | id, nom, rareté, étiquettes, quantité, favori |
| PriceObs | carteId, prix, type (vente terminée ou en cours), date |
| MyAuction | enchèreId, carteId, étiquette, prixDépart, finLe |
| Settings | nbSlots, fenêtreJours, moyenne ou médiane, arrondi, notifications, heures silencieuses |

**Algorithme de répartition**

```
pour chaque règle active, par quota décroissant :
  manque = quota - nb enchères actives de l'étiquette
  répéter manque fois :
    candidats = cartes de l'étiquette
                où quantité > garderMin, non favori, hors liste noire, pas déjà en vente
    trier par doublons décroissants, puis prix calculé
    si candidats vide : passer à l'étiquette de secours, sinon slot « vide »
    sinon : proposer (candidats[0], prix(candidats[0], règle))
```

## Interface utilisateur

Trois écrans : une popup pour agir, une page d'options pour régler, un journal pour ajuster.

**Popup (clic sur l'icône)**

- Bandeau : « 3/5 slots occupés · prochain libéré dans 1 h 12 ».
- Les 5 slots en liste : carte, étiquette, prix actuel, compte à rebours ; les slots libres en tête avec la carte proposée et le prix calculé.
- Boutons par slot libre : Ouvrir, Changer de carte, Ignorer.
- Avertissement si les données ont plus de 30 min : « ouvre la page des enchères pour mettre à jour ».

**Page d'options**

- Tableau des règles par étiquette (F1), avec contrôle que la somme des quotas ≤ nombre de slots.
- Fenêtre du prix moyen (jours), moyenne ou médiane, arrondi.
- Liste noire de cartes, étiquette de secours.
- Notifications : activées, heures silencieuses (ex. 23 h – 8 h).
- Export / import des réglages en JSON, bouton « effacer toutes les données ».

**Sur le site (overlay léger)**

- Sur la page de vente d'une carte : un encart « prix conseillé : 60 (moyenne 86 × 70 %) » avec bouton copier.
- Sur la collection : une pastille sur les cartes vendables selon tes règles.

## Points à vérifier et plan de développement

Les pages d'enchères ne sont visibles qu'une fois connecté : ces points sont à vérifier sur ton compte avant de coder.

- [ ] Nombre exact de slots d'enchères (5 pour tous, ou plus avec l'option pro ?)
- [ ] Le site affiche-t-il un prix moyen ou un historique de ventes par carte ? Sinon, l'historique sera construit par l'extension.
- [ ] Une enchère a-t-elle un prix de départ seulement, ou aussi un achat immédiat ? Le 70 % s'applique à lequel ?
- [ ] Durées d'enchère possibles et frais éventuels de mise en vente.
- [ ] Les étiquettes de l'album sont-elles visibles dans le code de la page de collection (pour savoir quelle carte a quelle étiquette) ?
- [ ] Chaque carte a-t-elle un identifiant stable dans le code de la page (lien, attribut) ?
- [ ] Accord écrit des développeurs pour le mode pré-remplissage.

**Plan par étapes**

1. **V0 – Lecture** : relevé des enchères, de la collection et des étiquettes ; affichage des 5 slots dans la popup.
2. **V1 – Règles et prix** : page d'options, calcul du manque par étiquette, choix de carte, prix conseillé.
3. **V2 – Alertes** : alarmes à la fin des enchères, notifications, badge, overlay sur la page de vente.
4. **V3 – Journal** : historique et statistiques pour ajuster les %.
5. **V4 – Pré-remplissage** : uniquement si les développeurs l'autorisent.

Le site est construit avec Next.js : les noms de classes CSS peuvent changer à chaque mise à jour. Tous les sélecteurs vivent donc dans un seul fichier de configuration, et l'extension affiche « page non reconnue » plutôt que des données fausses si un sélecteur ne trouve rien.
