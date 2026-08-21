# Publication open source

Objectif : un produit local-first que chacun peut cloner et auto-héberger. La
publication reste manuelle — aucun script ne pousse, ne publie de release ni ne
déploie d'instance distante. État de référence : 15 août 2026.

## Où en est le dépôt

| Domaine | État | Détail |
| --- | --- | --- |
| Premier lancement | Prêt | Une connexion sur un coffre vide redirige vers le wizard, jamais vers le dashboard. |
| Données personnelles | Prêt | Vault, états OAuth, sessions d'agents, logs, caches, sorties et sauvegardes sont ignorés, et contrôlés en CI. |
| Installation | Prêt pour bêta | Quickstart Docker générique, secrets générés par `init-env.sh`, unités systemd rendues avec le chemin du clone. |
| Sécurité applicative | Prêt pour une instance personnelle | Écritures protégées, OAuth PKCE, flux RSS filtrés contre les accès réseau privés. Le mot de passe partagé reste un modèle mono-utilisateur. |
| IA | Prêt, en option | Clé API ou connexion aux CLI officielles, avec vérification réelle avant de continuer. |
| SaaS multi-tenant | Non prêt | Ni comptes par utilisateur, ni coffre de secrets, ni facturation, ni file de jobs par tenant. |
| Licence | Décidée | AGPL-3.0-only : usage commercial autorisé, copyleft réseau. |

Barrière technique verte quand `npm test`, `npm run typecheck`, `npm run lint`,
`npm run vault:lint`, `npm run public:check` et `npm run build` passent depuis
un clone propre. Le build émet les avertissements Turbopack connus sur les
chemins dynamiques du vault.

## Stratégie d'authentification IA

**Instance auto-hébergée.** Clé API, ou CLI officielle (`claude auth login`,
`codex login --device-auth` sur une machine sans navigateur). Le bouton de
vérification lance une requête minimale via le bridge. Une clé saisie va dans
`data/ai-credentials.env` en `0600`, jamais dans le vault ni dans Git. Sans
moteur, les replis déterministes gardent l'IA réellement optionnelle.

**Service hébergé.** Ne jamais promettre « connecter mon abonnement
ChatGPT/Claude » comme un OAuth universel. Une offre tierce utilise des clés
API gérées par l'opérateur avec quotas, du BYOK chiffré, ou un partenariat
explicite. Une session CLI personnelle n'est pas une base d'architecture SaaS.

## Plan produit

**Phase 0 — publication self-hosted gratuite.** Publier l'AGPL-3.0-only avec le
dépôt ; exporter l'arbre propre dans un dépôt vierge et contrôler son premier
commit ; valider `deploy-install.sh check` sur une machine Linux neuve ; tester
le quickstart depuis un clone propre ; publier une préversion `v0.1.0` avec un
canal de retour d'installation.

**Phase 1 — bêta self-hosted.** Aucune télémétrie intégrée : les signaux
(setup terminé, étape d'abandon, temps jusqu'à la première note utile,
activation des modules, usage à quatre semaines) viennent de retours
volontaires. Corriger d'abord les blocages répétés. Ajouts plausibles ensuite :
édition ultérieure des modules, test réel de chaque flux RSS, aide Obsidian
plus directe, backend Ollama facultatif.

**Phase 2 — offre hébergée simple, hors lancement.** Instances mono-tenant
gérées, proches du Compose existant : provisionnement, mises à jour,
sauvegardes chiffrées, supervision, support. Hypothèses à tester, pas des
tarifs validés : self-hosted gratuit ; hébergement avec IA fournie par
l'utilisateur 9 à 12 EUR/mois ; hébergement avec quota IA inclus 25 à 35
EUR/mois ; installation accompagnée 99 à 199 EUR une fois. On vend la
tranquillité, pas la revente d'un abonnement ChatGPT ou Claude.

**Phase 3 — SaaS multi-tenant, seulement si la demande le justifie.** Identité
par utilisateur, isolation stockage/calcul, rotation des secrets, migrations
versionnées, files de jobs et quotas, metering IA, facturation,
export/suppression de compte, observabilité, procédure d'incident. C'est un
produit différent, pas une option de déploiement du code actuel.

## Licence

`AGPL-3.0-only`. Chacun peut utiliser, auto-héberger, modifier et distribuer,
y compris commercialement. Un opérateur qui modifie Nerva Brain et laisse des
utilisateurs interagir avec cette version via un réseau doit leur proposer le
code source correspondant sous la même licence.

Le nom et le logo Nerva Brain restent hors licence du code : ils ne peuvent pas
servir à présenter un fork ou un service tiers comme une offre officielle.
Aucun CLA pour la première release ; les retours et rapports de bugs sont
acceptés, les contributions de code restent fermées. Une double licence
commerciale exigerait d'organiser les droits sur les contributions avant d'en
accepter.

## Barrière de publication

```bash
npm ci
npm run public:check
npm run typecheck
npm run lint
npm test
npm run build
cp .env.example .env
docker compose config --quiet
rm .env
```

Puis vérifier explicitement :

- aucun contenu suivi, diff ou historique ne porte de donnée ou de topologie
  personnelle ;
- `LICENSE.md` existe et le README nomme la même licence ;
- le setup complet fonctionne à 390 × 844 et sur desktop ;
- une installation existante ouvre son dashboard sans perdre son contexte ;
- une installation neuve reprend correctement après interruption ;
- aucune publication, release ou instance distante n'est lancée sans validation
  humaine séparée.

## Hors périmètre de la première release

Package npm public, marketplace de plugins, installateur desktop ; comptes
équipes, partage de vault, collaboration temps réel ; moteur générique de
widgets ou de blocs ; synchronisation serveur de la disposition du dashboard
(elle reste locale au navigateur) ; OAuth universel vers les abonnements IA
personnels ; exposition Internet automatique ; email obligatoire ou collecte
analytique implicite.
