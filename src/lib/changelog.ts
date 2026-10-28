/**
 * Nouveautés affichées une fois après une mise à jour (fenêtre « Nouveautés » sur le site, ou dans la popup).
 * À chaque mise à jour publiée, ajouter une entrée EN TÊTE de la liste, avec un identifiant plus grand que le
 * précédent (date ISO, suffixe b, c… pour plusieurs le même jour) : elle s'affiche à la prochaine visite.
 * L'identifiant ne doit jamais redescendre (un utilisateur qui a vu « 2026-10-19e » ne verrait pas « 2026-10-19c »).
 */

export interface ChangelogItem {
  title: string;
  text: string;
  /** Où le trouver ou comment l'activer. */
  where?: string;
  /** Option à activer (désactivée par défaut). */
  optIn?: boolean;
}

export interface ChangelogEntry {
  /** Identifiant croissant : date ISO, éventuellement suffixée (2026-10-19, 2026-10-19b). */
  id: string;
  title: string;
  intro?: string;
  sections: { title: string; items: ChangelogItem[] }[];
}

export const CHANGELOG: ChangelogEntry[] = [
  {
    id: '2026-10-28',
    title: 'Vues de la collection : leur propre page',
    intro: 'Une vue n\'affichait parfois rien : elle filtrait par-dessus la page de la collection du site, qui ne montre que 50 cartes à la fois. Elle a maintenant sa propre page, comme Familles.',
    sections: [
      {
        title: 'Collection',
        items: [
          {
            title: 'Une page Wiki-Traders pour chaque vue',
            text: 'Un clic sur une vue affiche d\'un coup toutes les cartes de ta collection qui lui correspondent, dans l\'ordre de son tri, sans dépendre des pages du site. Recherche, étiquette, raretés et tri permettent d\'affiner sur place. Un clic sur une carte l\'ouvre dans la collection du site (fiche, vente, étiquettes), et le bouton dossier l\'ajoute à une famille.',
            where: 'Barre latérale → Collection → tes vues.',
          },
          {
            title: 'Ou les filtres du site, au choix',
            text: 'Pour retrouver l\'ancien fonctionnement, où les champs de la collection du site sont remplis, choisis « Filtres du site ».',
            where: 'Réglages → Interface → Vues de la collection → Affichage d\'une vue.',
          },
        ],
      },
    ],
  },
  {
    id: '2026-10-27',
    title: 'Icône des vues : un clic pour la choisir',
    sections: [
      {
        title: 'Interface',
        items: [
          {
            title: 'Choisir l\'icône d\'une vue',
            text: 'Clique sur l\'icône à côté du nom de la vue : la liste des icônes s\'ouvre juste en dessous, un clic choisit et referme (Échap pour fermer sans changer).',
            where: 'Réglages → Interface → Vues de la collection.',
          },
        ],
      },
    ],
  },
  {
    id: '2026-10-26c',
    title: 'Étiquetage automatique : des conditions « ou »',
    sections: [
      {
        title: 'Étiquettes',
        items: [
          {
            title: 'Plusieurs façons d\'avoir une étiquette',
            text: 'Une étiquette peut maintenant avoir des groupes « ou », chacun avec sa plage de prix, son texte et son taux de vente. Exemple : « A » si la carte vaut entre 10 et 20 W avec au moins 90 % de taux de vente, OU entre 20 et 100 W avec au moins 70 %. L\'étiquette est posée dès qu\'un groupe est rempli ; un résumé « Posée si : … » s\'affiche sous l\'étiquette.',
            where: 'Réglages → Étiquettes → Mes étiquettes → « + Ajouter un « ou » » sous une étiquette.',
          },
        ],
      },
    ],
  },
  {
    id: '2026-10-26b',
    title: 'Vues de la collection : toutes les pages filtrées, une icône par vue',
    sections: [
      {
        title: 'Interface',
        items: [
          {
            title: 'Les vues remplissent les filtres du site',
            text: 'Ouvrir une vue règle la recherche, l\'étiquette, les raretés et le tri de la collection du site : toutes ses pages ne montrent plus que les cartes de la vue (avant, seules celles de la page affichée étaient filtrées). Ce que le site ne sait pas faire (prix, favoris, plusieurs étiquettes, tri par prix…) est appliqué en plus sur la page. « Quitter la vue » remet les filtres du site à zéro.',
            where: 'Barre latérale → Collection → une de tes vues.',
          },
          {
            title: 'Une icône par vue',
            text: 'Choisis l\'icône de chaque menu (étoile, couronne, flamme, gemme…). L\'entonnoir reste l\'icône par défaut.',
            where: 'Réglages → Interface → Vues de la collection → « Icône du menu ».',
          },
        ],
      },
    ],
  },
  {
    id: '2026-10-26',
    title: 'Tes propres menus dans la barre latérale',
    sections: [
      {
        title: 'Interface',
        items: [
          {
            title: 'Vues de la collection',
            text: 'Crée tes propres menus sous « Collection » : chaque vue garde un filtre (nom, étiquettes, rareté, favoris, brillantes, famille, exemplaires, prix moyen) et un tri (nom, prix, valeur, rareté, exemplaires, taux de vente…). Exemple : « 10-100 A→Z » = étiquette 10-100, triée par nom. Un clic ouvre ta collection avec seulement ces cartes, dans cet ordre ; « Quitter la vue » réaffiche tout.',
            where: 'Réglages → Interface → Vues de la collection, bouton « + Nouvelle vue ».',
          },
          {
            title: 'Nouvel onglet « Interface »',
            text: 'L\'intégration au site et la barre latérale compacte y sont rangées, avec les vues.',
            where: 'Réglages → Interface.',
          },
        ],
      },
    ],
  },
  {
    id: '2026-10-20',
    title: 'Défausse au choix, fenêtre « Slots à remplir » plus large',
    sections: [
      {
        title: 'Paquets',
        items: [
          {
            title: 'Choisir les cartes à défausser',
            text: 'Dans le récapitulatif d\'ouverture, coche les cartes à défausser (case à gauche de chaque ligne, ou clic sur la ligne) : « Tout défausser » devient « Défausser X cartes ». Les cartes défaussées sont barrées, et le bouton propose ensuite les autres.',
            where: 'Récapitulatif après l\'ouverture d\'un paquet (avec « Tout défausser après ouverture »).',
          },
        ],
      },
      {
        title: 'Vendre',
        items: [
          {
            title: 'Plus de place pour chaque carte',
            text: 'La fenêtre « Slots à remplir » s\'ouvre en grand : les fiches des cartes à vendre s\'affichent côte à côte, avec une image plus grande et le détail du prix en entier.',
            where: 'Bloc Wiki-Traders de la barre latérale → Vendre.',
          },
        ],
      },
    ],
  },
  {
    id: '2026-10-19f',
    title: 'Version 1.0 : des réglages plus simples',
    intro: 'Les réglages sont rangés par ce que tu veux faire, et non plus par niveau de risque. Rien de ce que tu avais réglé n\'est perdu.',
    sections: [
      {
        title: 'Réglages',
        items: [
          {
            title: 'Six onglets',
            text: 'Accueil, Ventes, Étiquettes, Sur le site, Accès au site, Avancé. Chaque option est rangée avec ce qu\'elle concerne, avec un badge ⚠ si elle agit à ta place.',
          },
          {
            title: 'Ventes et étiquetage séparés',
            text: 'Les étiquettes (plages de prix, familles, conditions de l\'étiquetage automatique) se règlent dans Étiquettes, sans rien changer à la vente.',
          },
          {
            title: 'Enregistrement automatique',
            text: 'Plus de bouton Enregistrer : chaque modification est enregistrée aussitôt, avec « Annuler » pour revenir en arrière.',
          },
          {
            title: 'Profils',
            text: 'Prudent, Confort ou Complet : règle d\'un coup ce que Wiki-Traders a le droit de faire sur le site.',
            where: 'Réglages → Accueil.',
          },
        ],
      },
      {
        title: 'Ventes',
        items: [
          {
            title: 'Meilleures cartes, par paliers de prix',
            text: 'Par défaut, tes slots reçoivent tes meilleures cartes. Les étiquettes ne servent plus qu\'à choisir quelles cartes vendre (seulement celles-ci, ou toutes sauf celles-là). Le prix se règle par paliers (ex. jusqu\'à 20 W, 21–100 W, 101 W et +), chacun avec son calcul, son prix minimum et sa durée. Le mode « par étiquette » reste au choix.',
            where: 'Réglages → Ventes.',
          },
          {
            title: 'Calcul du prix : par défaut, simple ou avancé',
            text: 'Simple : prix moyen × mise de départ, ajusté par le taux de vente selon le nombre d\'enchères (1 vente sur 2 ne compte presque pas). Avancé : ta propre formule avec les variables de la carte. Tes anciens réglages sont convertis pour donner les mêmes prix.',
            where: 'Réglages → Ventes → Calcul du prix par défaut, et chaque palier.',
          },
          {
            title: 'Ordre de priorité',
            text: 'Équilibrée (prix × chance de vente), rapporter le plus, vendre vite, écouler, tes critères ou ta formule. La chance de vente tient compte du nombre de ventes : 90 % sur 900 ventes passe devant 100 % sur 1 vente. Un aperçu montre tout de suite les prochaines ventes.',
            where: 'Réglages → Ventes → Ordre de priorité.',
          },
          {
            title: 'Cartes de tes familles jamais vendues',
            text: 'Une carte d\'une de tes familles n\'est plus proposée à la vente.',
            where: 'Réglages → Ventes → Jamais vendu (activé par défaut).',
          },
          {
            title: 'Seuil du taux de vente réglable',
            text: 'Choisis à partir de combien d\'enchères terminées le taux de vente est fiable (5 par défaut) pour le minimum et la priorité « vendre vite ».',
            where: 'Réglages → Ventes → Taux de vente.',
          },
        ],
      },
      {
        title: 'Étiquettes et familles',
        items: [
          {
            title: 'Onglet Familles',
            text: 'Tout ce qui concerne tes familles au même endroit, dont « les cartes de la famille X reçoivent l\'étiquette Y » pour l\'étiquetage automatique. Tes anciennes conditions « famille » y ont été déplacées.',
            where: 'Réglages → Familles.',
          },
          {
            title: 'Étiquetage en continu',
            text: 'L\'étiquetage automatique peut tourner tout seul tant qu\'un onglet du site est ouvert : seulement les cartes à changer, par petits lots, au plus toutes les 2 minutes, et peu après l\'ouverture d\'un paquet.',
            where: 'Réglages → Étiquettes → Lancement : « En continu » (avec l\'étiquetage par l\'API).',
            optIn: true,
          },
        ],
      },
      {
        title: 'Paquets',
        items: [
          {
            title: 'Récapitulatif complet',
            text: 'Chaque carte obtenue affiche son prix moyen, son taux de vente et « vendues / enchères », comme sur tes cartes ; médiane, min et max au survol. Les prix déjà connus s\'affichent sans nouvelle requête, et les lectures sont plus rapides.',
          },
        ],
      },
      {
        title: 'Popup',
        items: [
          {
            title: 'Quatre onglets',
            text: 'Vendre, Enchères (mes ventes et mes mises), Historique, Cartes (cartes et étiquetage). Outils et Nouveautés sont dans l\'en-tête. Chaque vente conseillée montre la fiche de la carte : image, catégorie, prix moyen, taux de vente, ventes, médiane, durée.',
          },
          {
            title: 'Plus lisible',
            text: 'Textes gris plus contrastés partout, et « 17 / 20 vendues » en vert et blanc sur les cartes.',
          },
        ],
      },
    ],
  },
  {
    // Fusion des mises à jour du 19 octobre (identifiant gardé à la dernière publiée, pour l'ordre des suivantes).
    id: '2026-10-19e',
    title: 'Taux de vente, ventes plus fines, paquets, étiquettes automatiques',
    intro:
      'Le taux de vente (tdv) d\'une carte, c\'est la part de ses enchères terminées qui ont trouvé un acheteur. Il est maintenant partout : sur tes cartes, dans le prix conseillé, dans le choix des cartes à vendre et dans l\'étiquetage. Ce qui agit à ta place sans que tu cliques reste désactivé par défaut (badge « à activer »).',
    sections: [
      {
        title: 'Sur tes cartes',
        items: [
          {
            title: 'Prix moyen et taux de vente',
            text: 'Sous le titre : « Moy. 720 W · 52 % ». Le tdv est rouge à 15 % ou moins (la carte se vend mal), vert à 70 % ou plus (elle part toute seule).',
          },
          {
            title: 'Nombre de ventes',
            text: 'En bas de la carte : « 324 / 625 vendues ». 90 % sur 4 enchères ou sur 1 000, ce n\'est pas la même chose.',
          },
          {
            title: 'Étiquettes du site masquées',
            text: 'Les étiquettes en bas des cartes laissent la place au nombre de ventes. Les pastilles Wiki-Traders restent en haut de l\'image.',
            where: 'Réglages → Fonctionnalités → « Masquer les étiquettes du site » pour les réafficher.',
          },
        ],
      },
      {
        title: 'Vendre',
        items: [
          {
            title: 'Taux de vente minimum',
            text: 'Une carte sous ce taux n\'est plus proposée pour remplir un slot (tu peux toujours la vendre à la main).',
            where: 'Réglages → Taux de vente (ex. 15 %).',
            optIn: true,
          },
          {
            title: 'Prix selon le taux de vente',
            text: 'Des paliers ajustent le prix conseillé : une carte qui part toute seule monte, une carte qui ne se vend pas baisse (−50 % = moitié prix). Le détail du prix affiche le calcul.',
            where: 'Réglages → Taux de vente → « Proposition par défaut » pour démarrer.',
            optIn: true,
          },
          {
            title: 'Ordre des cartes « selon mes critères »',
            text: 'Trie les cartes proposées par plusieurs critères à la suite : prix, taux de vente, nombre de ventes, doublons, rareté… (ex. prix ↓, puis tdv ↓, puis ventes ↓).',
            where: 'Réglages → Prix conseillé → Ordre des cartes proposées.',
          },
          {
            title: 'Mode « meilleures cartes »',
            text: 'Plus de slots réservés par étiquette : les slots libres reçoivent les meilleures cartes de toutes tes étiquettes. « Suivant ▶ » / « ◀ Précédent » passent aux suivantes ; après une mise en vente, on revient aux meilleures.',
            where: 'Réglages → Prix conseillé → Répartition des slots.',
            optIn: true,
          },
          {
            title: 'Vendre en un clic',
            text: 'Bouton « Vendre… » sur chaque vente conseillée : fiche de la carte (prix moyen, tdv, ventes, médiane…), prix et durée modifiables, et mise aux enchères directe. Contraire aux règles du site.',
            where: 'Réglages → Fonctionnalités → Automatisations → « Vendre depuis les ventes conseillées ».',
            optIn: true,
          },
        ],
      },
      {
        title: 'Paquets',
        items: [
          {
            title: 'Tout défausser',
            text: 'Bouton rouge sous le total du récapitulatif d\'ouverture : défausse en un instant un exemplaire de chaque carte obtenue (jamais tes anciens exemplaires). Les cartes en favori sont ignorées. Si une carte vaut plus du seuil (10 W par défaut), une confirmation liste les cartes, leur valeur et celles que tu n\'avais pas encore. Irréversible.',
            where: 'Seuil : Réglages → Fonctionnalités → Paquets → « confirmer au-delà de (W) ».',
          },
          {
            title: 'Tout étiqueter',
            text: 'À côté : les cartes obtenues reçoivent d\'un coup les étiquettes de tes règles (plages de prix, texte, famille, taux de vente).',
            where: 'Visible quand l\'étiquetage par l\'API est activé (Réglages → Automatisations).',
          },
        ],
      },
      {
        title: 'Étiquettes',
        items: [
          {
            title: 'Étiquettes des invendues',
            text: 'Le site retire les étiquettes d\'une carte mise en vente. Si l\'enchère se termine sans acheteur, la carte retrouve celles qu\'elle avait.',
            where: 'Réglages → Automatisations → « Remettre les étiquettes des invendues » (avec l\'étiquetage par l\'API).',
            optIn: true,
          },
          {
            title: 'Conditions d\'étiquetage',
            text: 'Une règle peut poser son étiquette selon un mot du nom ou de la description (« pays »), une famille (« Films ») ou une plage de taux de vente (« Invendable » sous 15 %), en plus des plages de prix.',
            where: 'Réglages → Mes ventes → « Conditions et vente » sous chaque étiquette.',
          },
          {
            title: 'Vente sur mesure par étiquette',
            text: 'Chaque étiquette peut avoir son taux de vente minimum, ses paliers de prix et de durée, son ordre de choix, ou une formule de score (mode avancé : « {prix} * {tdv} / 100 + {doublons} * 10 »).',
            where: 'Réglages → Mes ventes → « Conditions et vente » → « Réglages de vente propres à cette étiquette ».',
          },
        ],
      },
      {
        title: 'Cette fenêtre',
        items: [
          {
            title: 'Nouveautés à chaque mise à jour',
            text: 'Après chaque mise à jour, cette fenêtre présente ce qui a changé, une seule fois (même si l\'onglet était en arrière-plan).',
            where: 'Pour la revoir : barre latérale → Paramètres ▸ Nouveautés, ou popup → Outils.',
          },
        ],
      },
    ],
  },
];

export const LATEST_CHANGELOG = CHANGELOG[0].id;

/** Nouveautés pas encore vues (toutes si `seen` est vide), de la plus récente à la plus ancienne. */
export function unseenChangelog(seen: string | null | undefined, list: ChangelogEntry[] = CHANGELOG): ChangelogEntry[] {
  return seen ? list.filter((e) => e.id > seen) : list;
}
