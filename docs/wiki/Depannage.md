[← Sommaire de la documentation](README.md)

# Dépannage

## Rien n'apparaît sur le site

1. **Recharge l'onglet WikiMasters** (Cmd/Ctrl + R). Après une installation ou une mise à jour, les onglets déjà ouverts gardent l'ancien script.
2. Page des extensions : Wiky-Traders est **activée**, et *Loaded from* pointe bien vers ton dossier `dist/`.
3. Une **seule** copie de Wiky-Traders est installée (supprime les anciennes).
4. Tu as bien lancé `npm run build` après `git pull`.
5. L'adresse est `https://www.wiki-masters.com/…` (avec `www`).

Pour vérifier quelle version tourne, ouvre la console de la page (Cmd+Option+J / Ctrl+Shift+J) et tape :

```js
!!document.querySelector('[data-wiky="nav-wiky"]')
```

`true` : l'intégration est active. `false` : vérifie l'option *Intégration au site* et recharge.

## L'ancienne interface est toujours là

Même cause : recharge la page du site après avoir rechargé l'extension. Sous Arc, si besoin, supprime l'extension puis recharge-la (*Load unpacked*).

## « Aucune carte connue »

Ouvre ta collection une fois (et ses différentes pages), ou active la lecture via l'API puis Cartes & prix → **↻ Recharger**.

## Les slots ou les ventes ne sont pas à jour

- Clique **↻** dans le bloc Wiky-Traders.
- Active la **lecture via l'API** : tes ventes en cours sont alors relues chaque minute.
- Sinon, ouvre Marché → *Mes ventes*. Si la page n'est pas reconnue : Outils → **C'est la page de mes enchères**.

## Un slot reste vide

La fenêtre Vendre en donne la raison :

- toutes les cartes de l'étiquette sont en **favori** ;
- elles sont **déjà en vente** ;
- **Garder** vaut 1 et tu n'as qu'un exemplaire ;
- aucune carte ne porte l'étiquette (vérifie l'orthographe, ou utilise *plage de prix moyen*) ;
- la somme des quotas est inférieure au nombre de slots (« slot libre sans règle »).

## Le prix semble faux

Le détail du calcul est affiché à côté de chaque prix. Voir [Prix conseillé](Prix-conseille.md) : visite Marché → *Historique*, ou saisis un prix à la main.

## Le Mode enchère n'ouvre pas la vente

- Le bouton « Mettre aux enchères » du site est désactivé quand tous tes slots sont pris : le toast l'indique.
- La carte doit être affichée sur la page de la collection.
- Exporte un **diagnostic** avec la fenêtre de la carte ouverte.

## Page non reconnue

WikiMasters change ses classes CSS à chaque mise à jour. L'extension préfère afficher « page non reconnue » plutôt que des données fausses.

1. Sur la page en question : **Outils → Diagnostic**. Un fichier JSON est téléchargé : le plan de la page (balises, classes, textes courts, **jamais** le contenu des champs), un échantillon des données lues et les dernières étapes des automatisations.
2. Ajuste Réglages → Données → **Sélecteurs avancés**, ou [ouvre une issue](https://github.com/AndyB31/Wiky-Traders/issues) avec le fichier.

## FAQ

**Mes données sont-elles envoyées quelque part ?** Non. Tout reste dans le navigateur ; seules les options d'API interrogent l'API de WikiMasters, avec ta session.

**Puis-je utiliser Wiky-Traders avec « Prix moyen collection » ?** Oui : ses familles sont lues (page Cartes & prix) et ses liens restent dans la barre latérale.

**Sur mobile ?** Les navigateurs mobiles ne chargent pas ces extensions ; la barre du bas du site n'est pas modifiée.

**Comment sauvegarder mes réglages ?** Réglages → **Exporter (JSON)**, puis **Importer** sur l'autre navigateur.
