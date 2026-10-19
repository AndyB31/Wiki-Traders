/**
 * Nouveautés affichées une fois après une mise à jour (fenêtre « Nouveautés » sur le site, ou dans la popup).
 * À chaque mise à jour publiée, ajouter une entrée EN TÊTE de la liste, avec un identifiant plus grand que le
 * précédent (date ISO, suffixe b, c… pour plusieurs le même jour) : elle s'affiche à la prochaine visite.
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
    id: '2026-10-19d',
    title: 'Défausse plus rapide',
    sections: [
      {
        title: 'Paquets',
        items: [
          {
            title: '« Tout défausser » en un instant',
            text: 'Les cartes du paquet sont défaussées en une ou deux requêtes au lieu d\'une par carte. Les cartes en favori sont simplement ignorées (signalées dans le message, sans erreur).',
          },
        ],
      },
    ],
  },
  {
    id: '2026-10-19c',
    title: 'Actions rapides après l\'ouverture d\'un paquet',
    sections: [
      {
        title: 'Paquets',
        items: [
          {
            title: 'Tout étiqueter',
            text: 'Sous le total du récapitulatif d\'ouverture (en bas à droite) : les cartes obtenues reçoivent d\'un coup les étiquettes de tes règles (plages de prix, texte, famille, taux de vente).',
            where: 'Visible quand l\'étiquetage par l\'API est activé (Réglages → Automatisations).',
          },
          {
            title: 'Tout défausser',
            text: 'Bouton rouge : défausse un exemplaire de chaque carte obtenue, en un clic. Si une carte vaut plus de 10 W, une confirmation liste les cartes, leur valeur et celles que tu n\'avais pas encore. Irréversible ; les favoris restent verrouillés.',
            where: 'Réglages → Fonctionnalités → Paquets → « Tout défausser après ouverture » pour le masquer.',
          },
        ],
      },
    ],
  },
  {
    id: '2026-10-19b',
    title: 'Corrections',
    sections: [
      {
        title: 'Vendre',
        items: [
          {
            title: '« Suivant » en mode meilleures cartes',
            text: 'Suivant, Précédent et ⏮ changent maintenant les cartes proposées à chaque clic (la fenêtre ne se mettait pas toujours à jour). L\'onglet « Mes ventes » du site suit la même page, et après une mise en vente on revient aux meilleures cartes.',
            where: 'Fenêtre Vendre, avec la répartition « meilleures cartes, toutes étiquettes ».',
          },
        ],
      },
      {
        title: 'Nouveautés',
        items: [
          {
            title: 'Après une mise à jour en arrière-plan',
            text: 'Si l\'onglet WikiMasters était en arrière-plan pendant la mise à jour, cette fenêtre s\'ouvre dès que tu y reviens.',
          },
        ],
      },
    ],
  },
  {
    id: '2026-10-19',
    title: 'Taux de vente, ventes plus fines, étiquettes automatiques',
    intro:
      'Le taux de vente (tdv) d\'une carte, c\'est la part de ses enchères terminées qui ont trouvé un acheteur. Il est maintenant partout : sur tes cartes, dans le prix conseillé, dans le choix des cartes à vendre et dans l\'étiquetage. Tout ce qui agit à ta place reste désactivé par défaut.',
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
            text: 'Plus de slots réservés par étiquette : les slots libres reçoivent les meilleures cartes de toutes tes étiquettes. « Suivant ▶ » passe aux suivantes.',
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
        ],
      },
      {
        title: 'Réglages par étiquette',
        items: [
          {
            title: 'Vente sur mesure',
            text: 'Chaque étiquette peut avoir son taux de vente minimum, ses paliers de prix et de durée, son ordre de choix, ou une formule de score (mode avancé : « {prix} * {tdv} / 100 + {doublons} * 10 »).',
            where: 'Réglages → Mes ventes → « Conditions et vente » → « Réglages de vente propres à cette étiquette ».',
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
