# Wiki-Traders — installation et maintenance.
#   make install            construit l'extension, demande où l'installer, explique comment la charger
#   make install DEST=~/X   idem, sans question
#   make update             récupère main, reconstruit et met à jour le dossier installé
#   make help               toutes les commandes

SHELL := /bin/bash
.DEFAULT_GOAL := help
TARGET_FILE := .install-target
DEFAULT_DEST := $(HOME)/Wiki-Traders
DEST ?=

.PHONY: help install deps build test zip update updater updater-uninstall clean

help: ## Affiche cette aide
	@echo "Wiki-Traders — commandes :"
	@grep -E '^[a-z-]+:.*## ' $(MAKEFILE_LIST) | awk -F':.*## ' '{ printf "  make %-18s %s\n", $$1, $$2 }'

deps: ## Vérifie Node.js (20+) et installe les dépendances si besoin
	@command -v node >/dev/null || { echo "✗ Node.js introuvable : installe Node.js 20 ou plus (https://nodejs.org)"; exit 1; }
	@node -e 'if (+process.versions.node.split(".")[0] < 20) { console.error("✗ Node.js " + process.versions.node + " : il faut la version 20 ou plus"); process.exit(1) }'
	@command -v npm >/dev/null || { echo "✗ npm introuvable (fourni avec Node.js)"; exit 1; }
	@if [ ! -d node_modules ] || [ package-lock.json -nt node_modules ]; then echo "→ Installation des dépendances…"; npm install --no-audit --no-fund; fi

build: deps ## Construit l'extension dans dist/
	@npm run build

test: deps ## Lance les vérifications (types et tests)
	@npx tsc --noEmit && npx vitest run

zip: deps ## Construit wiki-traders.zip (à partager)
	@npm run zip
	@echo "✔ wiki-traders.zip prêt à partager"

install: build ## Construit, copie l'extension dans le dossier choisi et explique comment la charger
	@dest="$(DEST)"; \
	if [ -z "$$dest" ]; then \
	  last=""; [ -f $(TARGET_FILE) ] && last="$$(cat $(TARGET_FILE))"; \
	  def="$${last:-$(DEFAULT_DEST)}"; \
	  echo ""; \
	  echo "  Le navigateur reconnaît l'extension à son dossier : tu la charges déjà depuis un dossier ?"; \
	  echo "  Donne le même pour garder tes réglages et tes familles (ex. $$PWD/dist)."; \
	  echo "  Un nouveau dossier = nouvelle extension (réglages : Exporter puis Importer en JSON)."; \
	  printf "\nOù installer l'extension ? [%s] " "$$def"; read dest; dest="$${dest:-$$def}"; \
	fi; \
	dest="$${dest/#\~/$$HOME}"; \
	case "$$dest" in /*) ;; *) dest="$$PWD/$$dest";; esac; \
	if [ "$$dest" = "$$PWD" ] || [ "$$dest" = "$$PWD/" ]; then echo "✗ Choisis un autre dossier que le dépôt lui-même."; exit 1; fi; \
	if [ "$$dest" != "$$PWD/dist" ]; then \
	  if [ -d "$$dest" ] && [ -n "$$(ls -A "$$dest" 2>/dev/null)" ] && [ ! -f "$$dest/manifest.json" ]; then \
	    echo "✗ $$dest existe et ne contient pas une extension Wiki-Traders : choisis un dossier vide ou nouveau."; exit 1; \
	  fi; \
	  mkdir -p "$$dest" && cp -R dist/. "$$dest/"; \
	fi; \
	echo "$$dest" > $(TARGET_FILE); \
	echo ""; echo "✔ Extension installée dans : $$dest"; \
	printf "\nInstaller la mise à jour en un clic (bouton « Mettre à jour » dans les réglages) ? [O/n] "; read up; \
	case "$$up" in [nN]*) echo "  (plus tard : make updater)";; *) node scripts/updater/install.mjs --target "$$dest";; esac; \
	echo ""; \
	echo "──────────────── Charger l'extension dans le navigateur ────────────────"; \
	echo ""; \
	echo " Chrome / Edge / Brave / Opera / Arc :"; \
	echo "   1. Ouvre la page des extensions :"; \
	echo "        chrome://extensions   (Arc : arc://extensions · Edge : edge://extensions · Brave : brave://extensions)"; \
	echo "   2. Active le « Mode développeur » (en haut à droite)."; \
	echo "   3. Clique sur « Charger l'extension non empaquetée » et choisis :"; \
	echo "        $$dest"; \
	echo "   4. Épingle l'icône (🧩 → 📌) puis va sur https://www.wiki-masters.com et recharge la page."; \
	echo ""; \
	echo " Firefox (128+) :"; \
	echo "   about:debugging#/runtime/this-firefox → « Charger un module complémentaire temporaire »"; \
	echo "   → choisis $$dest/manifest.json (à refaire à chaque démarrage de Firefox)."; \
	echo ""; \
	echo " Ensuite :"; \
	echo "   • Réglages : Paramètres → onglet Wiki-Traders sur le site ; active « Lecture via l'API »"; \
	echo "     (Automatisations) pour les prix, les familles et les mises."; \
	echo "   • Mettre à jour : bouton « Mettre à jour » dans les réglages, ou « make update »."; \
	echo "   • Déjà chargée avant ? Clique ↻ sur l'extension puis recharge les onglets WikiMasters."; \
	echo ""

update: ## Récupère main, reconstruit et met à jour le dossier installé
	@git pull --ff-only --autostash origin main
	@$(MAKE) --no-print-directory build
	@if [ -f $(TARGET_FILE) ] && [ "$$(cat $(TARGET_FILE))" != "$$PWD/dist" ]; then cp -R dist/. "$$(cat $(TARGET_FILE))/"; echo "✔ $$(cat $(TARGET_FILE)) mis à jour"; fi
	@echo "→ Clique ↻ sur l'extension (page des extensions) puis recharge les onglets WikiMasters."

updater: ## Installe le programme d'aide (mise à jour en un clic)
	@node scripts/updater/install.mjs $$( [ -f $(TARGET_FILE) ] && echo "--target $$(cat $(TARGET_FILE))" )

updater-uninstall: ## Désinstalle le programme d'aide
	@node scripts/updater/install.mjs --uninstall

clean: ## Supprime dist/ et le zip
	@rm -rf dist wiki-traders.zip
