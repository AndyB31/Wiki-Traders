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
            text: 'Une étiquette se règle en deux endroits : comment tu la vends (slots, mise de départ, garder) dans Ventes, quelles cartes y vont (plage de prix, famille, conditions) dans Étiquettes.',
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
        title: 'Taux de vente',
        items: [
          {
            title: 'Paliers en « % du prix »',
            text: '81 veut maintenant dire 81 % du prix conseillé (100 = inchangé, 50 = moitié prix). Avant, c\'était un ajustement (+81 % !). Tes paliers ont été convertis pour donner le même prix qu\'avant : vérifie-les.',
            where: 'Réglages → Ventes → Taux de vente.',
          },
          {
            title: 'Interrupteur et seuil réglable',
            text: 'Coupe les paliers sans les supprimer, et choisis à partir de combien d\'enchères terminées le taux de vente compte (5 par défaut).',
            where: 'Réglages → Ventes → Taux de vente.',
          },
        ],
      },
      {
        title: 'Ventes',
        items: [
          {
            title: 'Cartes de tes familles jamais vendues',
            text: 'Une carte d\'une de tes familles n\'est plus proposée à la vente, sauf pour une étiquette qui vise justement cette famille.',
            where: 'Réglages → Ventes → Jamais vendu (activé par défaut).',
          },
        ],
      },
      {
        title: 'Popup',
        items: [
          {
            title: 'Quatre onglets',
            text: 'Vendre, Enchères (mes ventes et mes mises), Historique, Cartes (cartes et étiquetage). Outils et Nouveautés sont dans l\'en-tête. Les ventes conseillées sont plus compactes, le détail se déplie avec « ? ».',
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
