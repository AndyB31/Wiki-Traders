# Installation

Wiky-Traders n'est pas publiée sur les boutiques d'extensions : on la construit depuis les sources, puis on la charge « non empaquetée ».

## 1. Prérequis

| Outil | Version | Vérifier |
| --- | --- | --- |
| [Node.js](https://nodejs.org) | 20 ou plus | `node -v` |
| [Git](https://git-scm.com) | toute version récente | `git --version` |
| Navigateur | Chromium (Chrome, Edge, Brave, Arc, Opera) ou Firefox 128+ | |

Sur macOS, Node.js s'installe avec `brew install node` ; sous Windows, avec l'installeur de nodejs.org.

## 2. Construire l'extension

```bash
git clone https://github.com/AndyB31/Wiky-Traders.git
cd Wiky-Traders
npm install        # dépendances (une seule fois, puis après chaque mise à jour)
npm run build      # crée le dossier dist/
```

Le dossier **`dist/`** est l'extension. Ne le déplace pas après l'avoir chargé : le navigateur le relit à chaque rechargement.

> `npm run zip` crée aussi `wiky-traders.zip` (le contenu de `dist/`), pratique pour l'installer sur un autre ordinateur : dézippe-le puis charge le dossier obtenu.

## 3. Charger l'extension

### Chrome, Edge, Brave, Opera

1. Ouvre la page des extensions :
   - Chrome : `chrome://extensions`
   - Edge : `edge://extensions`
   - Brave : `brave://extensions`
   - Opera : `opera://extensions`
2. Active le **Mode développeur** (en haut à droite ; dans Edge, en bas à gauche).
3. **Charger l'extension non empaquetée** → choisis le dossier `dist/`.
4. Épingle l'extension : icône 🧩 de la barre d'outils → 📌 à côté de Wiky-Traders.

### Arc

1. Ouvre `arc://extensions` (ou `chrome://extensions`).
2. Active **Developer mode**, puis **Load unpacked** → dossier `dist/`.
3. Sur la carte Wiky-Traders, *Source* doit indiquer **Unpacked extension** et *Loaded from* le chemin de ton dossier `dist/`.

### Firefox 128+

1. Ouvre `about:debugging#/runtime/this-firefox`.
2. **Charger un module complémentaire temporaire…** → choisis `dist/manifest.json`.
3. Un module temporaire disparaît à la fermeture de Firefox : recharge-le à chaque démarrage.

> Firefox est pris en charge, mais l'extension est surtout testée sur Chromium.

La page de réglages s'ouvre automatiquement après l'installation.

## 4. Vérifier l'installation

1. Va sur [wiki-masters.com](https://www.wiki-masters.com) et connecte-toi.
2. Recharge l'onglet (Cmd/Ctrl + R).
3. Tu dois voir :
   - le bloc orange **Wiky-Traders** dans la barre latérale, au-dessus de *Paramètres* ;
   - les menus **Social** et **Progression** qui regroupent les liens du site ;
   - un onglet **Wiky-Traders** dans *Paramètres*.

Rien de tout ça ? Voir [Dépannage](Depannage#rien-napparait-sur-le-site).

## 5. Mettre à jour

```bash
cd Wiky-Traders
git pull
npm install
npm run build
```

Ensuite :

1. page des extensions → **↻** sous Wiky-Traders ;
2. **recharge chaque onglet WikiMasters ouvert** : une extension rechargée ne remplace pas le script déjà chargé dans une page.

Tes réglages, ta collection connue et ton journal sont conservés.

## 6. Désinstaller

1. (Facultatif) Réglages → **Effacer toutes les données**.
2. Page des extensions → **Supprimer**.

Suite : **[Premiers pas](Premiers-pas)**.
