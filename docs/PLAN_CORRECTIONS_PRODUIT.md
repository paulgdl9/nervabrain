# Plan vivant de correction produit

Journal de correction produit, par vagues. But constant : corriger les défauts
signalés sans réécrire l'application.

## Comment lire ce document

Chaque vague suit la même structure : causes racines vérifiées dans le code →
ordre d'exécution (rapide d'abord) → détail des missions avec critères
d'acceptation → journal d'exécution et apprentissages. Les vagues récentes sont
en bas du fichier.

**La source de vérité est l'application en production, pas ce tableau.** Un
« ✅ » du journal ne prouve rien tant que le parcours n'a pas été rejoué :
c'est exactement l'erreur qui a rendu la Vague 3 nécessaire.

## Où en est le chantier

| Vague | Date | État |
| --- | --- | --- |
| 1 — corrections initiales | 2026-07-21 | Livrée et déployée (`9dd37f4` sur `origin/main`). |
| 2 — post-déploiement | 2026-07-22 | Code livré et déployé (jusqu'à `e7af6e5`, les deux tenants sains), mais plusieurs « ✅ » se sont révélés incomplets au rendu. |
| 3 — audit honnête | 2026-07-23 | Audit du code déployé, correctifs. `V3-02` et `V3-06` restent bloqués (repro utilisateur / état externe du bridge). |
| 4 — retours dashboard et briefs | 2026-07-24 | Voir son journal. |
| 5 — dashboard type widgets iOS | 2026-07-24 | Plan écrit, exécution non commencée : `V5-03` (tailles de widget), `V5-04` (drag pointeur), `V5-05` (redesign des widgets, par lots). |

`REV-02` (import PDF et annales) reste reporté depuis la Vague 1.

## Règles de mise à jour

Après chaque tentative, réussie ou non :

1. mettre à jour le statut de la tâche ;
2. inscrire la commande ou le scénario de vérification dans le journal ;
3. noter la cause d'un échec et ce qui sera fait différemment ;
4. ne marquer terminé que lorsque tous les critères d'acceptation passent.

Statuts : `⬜ À faire`, `🟡 En cours`, `✅ Terminé`, `⛔ Bloqué`, `❌ Échec`,
`↩️ Reporté`.

## Vague 1 — état initial vérifié (2026-07-21)

Audit mené par Tera (architecture, IA, sécurité), Luna (UI métier) et Sol
(Markdown, Bibliothèque, Révisions).

- Les quatre captures ont été inspectées. Les popovers Tâches/Objectifs sont à la fois translucides, non adaptatifs au viewport et rognés par le conteneur de tableau.
- Le dashboard contient sept widgets connectés et quatre types de blocs personnels. Les données de disposition sont conservées dans `localStorage` sous `sb-dashboard-layout:v6`.
- Le widget autonome « Indicateurs clés » duplique exactement les quatre indicateurs déjà inclus dans « 7 derniers jours ».
- Un bloc personnel masqué ne peut plus être restauré depuis le catalogue, même si son état existe encore en stockage.
- Le Budget possède déjà un camembert et un tri décroissant des catégories. Il manque une vue par catégorie et la grille étire les accordéons fermés.
- L'Assistant attend jusqu'à trois secondes le statut du bridge avant de rendre la page et ne possède aucun `loading.tsx`.
- L'Assistant et le MCP indexent déjà tous les Markdown vivants du vault. `_Archive`, les répertoires cachés et la corbeille sont volontairement exclus. Les briefs Daily/Weekly ne couvrent toutefois pas tous les modules actifs.
- Le MCP peut actuellement lire un fichier non Markdown situé dans le vault si son chemin est fourni directement.
- Les prompts demandent explicitement les références de fichiers que l'utilisateur ne veut pas voir.
- Les commentaires `task-meta` sont nécessaires à la création structurée des tâches, puis sont sauvegardés à tort dans le Daily visible.
- La Bibliothèque suit le cycle Inbox → brouillon Wiki → connaissance validée, mais aucun bouton ne permet actuellement de publier un brouillon.
- Les checklists du lecteur Markdown sont volontairement rendues `disabled`; seul l'éditeur par blocs sait les persister.
- Les images HTTPS Markdown s'affichent déjà, mais sans contrat UI complet; la syntaxe Obsidian `![[image.png]]` est mal transformée.
- Le module Révisions crée six fichiers vides et présente ensuite un dashboard sans contenu utile au lieu d'un setup guidé.

Baseline du 21 juillet 2026 :

- `npm test` : 171/171 tests passent ;
- `npm run typecheck` : passe ;
- `npm run lint` : passe ;
- audit ciblé Luna : 6/6 tests Dashboard/Business passent ;
- audit ciblé Sol : 8/8 tests Markdown/Révisions passent ;
- audit ciblé Tera : 31 tests IA/MCP/Setup passent.

Ces nombres se chevauchent et ne doivent pas être additionnés. Ils prouvent une baseline logique saine, pas la qualité des interactions navigateur signalées.

Le worktree contenait déjà des modifications utilisateur avant cet audit. En particulier, `src/lib/i18n.ts` est modifié et sera un point de vigilance lors des libellés. Aucun audit de sous-agent n'a modifié de fichier.

## Ordre global — rapide d'abord

| Rang | ID | Mission | Propriétaire | Difficulté | Durée indicative | Priorité | Statut |
| ---: | --- | --- | --- | --- | --- | --- | --- |
| 1 | UI-01 | Empêcher l'étirement blanc des accordéons Budget | Luna | XS | 10–20 min | P0 | ✅ Terminé |
| 2 | AI-01 | Retirer `task-meta` après extraction, avant sauvegarde | Sol | XS | 30–60 min | P0 | ✅ Terminé |
| 3 | SEC-01 | Interdire au MCP toute lecture non `.md` | Tera | XS | 30–60 min | P0 | ✅ Terminé |
| 4 | PERF-01 | Afficher immédiatement un loader Assistant | Tera | XS | 30–60 min | P0 | ✅ Terminé |
| 5 | DASH-01 | Supprimer « Indicateurs clés » dupliqué et élargir « Focus par domaines » | Luna | S | 1–2 h | P0 | ✅ Terminé |
| 6 | UI-02 | Rendre les popovers Tâches/Objectifs opaques | Luna | XS | 15–30 min | P0 | ✅ Terminé |
| 7 | LIB-01 | Expliquer clairement le cycle de la Bibliothèque | Sol | XS | 30–60 min | P0 | ✅ Terminé |
| 8 | NOTE-01 | Fiabiliser les images HTTPS Markdown sans upload | Sol | S | 1–2 h | P1 | 🟡 MVP affichage terminé, erreur explicite restante |
| 9 | LIB-02 | Publier ou archiver un brouillon Wiki depuis l'UI | Sol | S | 2–4 h | P0 | 🟡 Implémenté, navigateur restant |
| 10 | AI-02 | Supprimer les références de fichiers des sorties IA et locales | Tera | S | 2–4 h | P0 | ✅ Terminé |
| 11 | PERF-02 | Mettre en cache le catalogue de modèles Assistant | Tera | S | 1–3 h | P1 | ✅ Terminé |
| 12 | BUD-01 | Mettre « Utilisation du revenu » sur toute la largeur | Luna | S | 1–2 h | P1 | ✅ Terminé |
| 13 | DASH-02 | Séparer clairement masquer, restaurer et supprimer | Luna | M | 3–6 h | P0 | ✅ Terminé |
| 14 | UI-03 | Porter et repositionner les popovers Tâches/Objectifs | Luna | M | 3–6 h | P0 | ✅ Terminé |
| 15 | AI-03 | Ajouter un niveau de détail à trois positions | Tera | M | 3–6 h | P1 | ✅ Terminé |
| 16 | NOTE-02 | Naviguer entre blocs Markdown avec ↑/↓ | Sol | M | 4–8 h | P1 | ✅ Terminé |
| 17 | LIB-03 | Rendre les checklists Wiki persistantes | Sol | M | 4–8 h | P1 | 🟡 En cours |
| 18 | BUD-02 | Ajouter les vues Catégories « Barres / Camembert » | Luna | M | 4–8 h | P1 | ✅ Terminé |
| 19 | BUS-01 | Rejouer la matrice Business complète | Luna | M | 4–8 h | P1 | ✅ Terminé |
| 20 | BUS-02 | Corriger les incohérences Business révélées | Luna | M | 4–8 h | P1 | ✅ Terminé |
| 21 | AI-04 | Construire la preuve bornée de tous les modules actifs | Tera | L | 1–2 j | P0 | ✅ Terminé |
| 22 | DASH-03 | Ajouter les blocs connectés conditionnels par module | Luna + Tera | L | 2–4 j | P1 | ✅ Terminé |
| 23 | REV-01 | Créer le setup guidé Révisions et un vrai état vide | Sol | M/L | 1–2 j | P2 | 🟡 Implémenté, écriture isolée restante |
| 24 | SEC-02 | Durcir le bridge IA contre la lecture du code source | Tera | L | 1–2 j | P0 | ✅ Terminé |
| 25 | REV-02 | Importer PDF/annales et générer des supports | Tera + Sol | XL | 4–8 j | P2 | ↩️ Reporté |

Les durées sont des ordres de grandeur pour séquencer, pas des promesses calendaires. Une tâche suivante ne démarre pas si elle dépend d'une tâche précédente non validée.

## Détail des missions

### UI-01 — Accordéons Budget sans vide blanc

Cause : `.finance-budget-editor-grid` étire chaque `<details>` à la hauteur du voisin ouvert.

Changement minimal : ajouter `align-items: start` à la grille, ou `align-self: start` à `.finance-budget-section` si le premier correctif ne couvre pas tous les navigateurs.

Fichiers :

- `src/app/globals.css`
- contrôle visuel de `src/components/Finance.tsx`

Critères d'acceptation :

- fermer le bloc gauche pendant que le droit reste ouvert ne crée plus de grand rectangle vide ;
- les quatre combinaisons ouvert/fermé d'une ligne restent alignées ;
- comportement correct à 1440, 1024, 620 et 390 px ;
- aucun décalage de contenu au rechargement.

Vérification : TypeScript, lint, puis matrice manuelle des accordéons Budget.

### AI-01 — Métadonnées `task-meta` invisibles

Cause : le bridge extrait les tâches structurées puis renvoie le Markdown brut; `generateDailyBrief()` sauvegarde ce brut. Le prompt affirme à tort que React masquera le commentaire.

Changement minimal :

1. conserver le brief brut pour valider et créer les tâches ;
2. retirer uniquement les commentaires `<!-- task-meta {...} -->` juste avant `upsertVaultNote()` ;
3. appliquer le même filtre dans `MarkdownView` pour les anciens Daily sans réécrire automatiquement les notes utilisateur ;
4. ne pas supprimer les autres commentaires HTML.

Fichiers :

- `src/lib/vault.ts`
- `src/components/MarkdownView.tsx`
- `tests/brief-tasks.test.ts`
- `tests/prompts.test.ts`

Critères d'acceptation :

- aucun `task-meta` dans un nouveau fichier Daily ni dans son HTML rendu ;
- la tâche créée conserve `objective` et `exec_kind` ;
- les métadonnées invalides restent refusées ;
- un ancien Daily est propre à l'écran sans migration destructive.

### SEC-01 — MCP strictement Markdown

Cause : `readNote()` protège la racine du vault mais accepte toute extension; `fetch` et `read_note` peuvent donc lire un JSON du vault.

Changement minimal : retourner `null` dans `readNote()` lorsque le chemin ne finit pas par `.md`. Ce garde commun couvre le MCP et tous les futurs appelants.

Fichiers :

- `src/lib/vault.ts`
- `tests/vault.test.ts`
- `tests/mcp-route.test.ts`

Critères d'acceptation :

- tous les Markdown du vault restent lisibles ;
- `.json`, `.ts`, fichiers cachés et chemins hors vault sont refusés ;
- `search`, `fetch`, `read_note`, `read_daily` et le lecteur web continuent de fonctionner ;
- aucune donnée applicative hors vault n'est exposée.

### PERF-01 et PERF-02 — Navigation Assistant immédiate

Cause principale : la page attend le `/status` du bridge, qui peut consommer son timeout de trois secondes. L'historique peut ensuite devenir une cause secondaire car tous les JSON sont lus avant la limite de 50.

Étape 1 : ajouter `src/app/(shell)/assistant/loading.tsx` avec une icône animée, `role="status"` et un texte accessible. Le clic doit produire un retour visuel en moins de 100 ms.

Étape 2 : mettre le catalogue `/status` en cache avec une durée courte. Ne charger/optimiser l'historique que si une mesure montre qu'il reste lent après ce cache.

Fichiers :

- `src/app/(shell)/assistant/loading.tsx`
- `src/app/(shell)/assistant/page.tsx`
- éventuellement `src/lib/assistant-chats.ts` après mesure

Critères d'acceptation :

- navigation visuellement instantanée ;
- panne ou timeout du bridge : loader puis page utilisable avec choix « auto » ;
- catalogue disponible après succès sans nouvel appel lent à chaque navigation ;
- aucune modification de la navigation globale.

### DASH-01 — Retirer le doublon « Indicateurs clés »

Décision : conserver les quatre indicateurs dans le bloc large « 7 derniers jours » et supprimer le widget autonome `metrics`. C'est la version déjà visible et la plus courte à maintenir.

Changement :

- retirer `metrics` de `DASHBOARD_WIDGET_IDS`, des icônes et du catalogue ;
- faire ignorer proprement l'ancien ID lors de la normalisation de `v6` ;
- passer `areas` en pleine largeur ;
- supprimer la propriété `title` dupliquée du widget `today` si elle est toujours présente au moment du correctif.

Fichiers :

- `src/components/DashboardLayout.tsx`
- `src/app/(shell)/page.tsx`
- `tests/dashboard-layout.test.ts`

Critères d'acceptation :

- « Indicateurs clés » n'est plus proposé alors qu'il est déjà visible ;
- « 7 derniers jours » conserve les indicateurs et toute sa largeur ;
- « Focus par domaines » occupe toute la largeur ;
- un ancien stockage contenant `metrics` migre sans erreur ni trou de grille.

### UI-02 et UI-03 — Popovers Tâches/Objectifs fiables

Cause : `TasksWorkspace` et `ObjectivesWorkspace` dupliquent un popover absolu dans un conteneur à défilement. `overflow-x: auto` provoque le rognage vertical; `var(--panel-2)` reste translucide.

Étape immédiate : utiliser `var(--menu-surface-strong)` pour une surface opaque.

Correctif racine : partager le petit comportement de portail déjà éprouvé par `CustomSelect` : rendu dans `document.body`, coordonnées `fixed`, placement au-dessus ou dessous, contrainte au viewport, suivi du scroll et retour de focus.

Fichiers :

- `src/components/TasksWorkspace.tsx`
- `src/components/ObjectivesWorkspace.tsx`
- un composant partagé uniquement si cela supprime réellement les deux copies
- `src/app/globals.css`

Matrice obligatoire : statut, domaine, priorité et filtre, depuis la première, une ligne centrale et la dernière ligne; scroll vertical et horizontal; thèmes clair/sombre; surfaces transparentes/opaques; 1440, 1024, 620 et 390 px.

Critères d'acceptation :

- aucun menu rogné ni texte visible derrière ;
- clic extérieur et Échap ferment ;
- le focus revient au déclencheur ;
- navigation fléchée et activation clavier conservées ;
- le menu reste attaché à sa cellule pendant le scroll.

### DASH-02 — Cycle de vie cohérent des blocs

Sémantique retenue :

- bloc connecté : « Retirer du dashboard » est récupérable depuis le catalogue; aucune suppression des données métier ;
- bloc personnel : œil = masquer temporairement, poubelle = supprimer définitivement après confirmation ;
- tout bloc masqué apparaît dans une section « Blocs masqués » avec « Restaurer » ;
- les icônes ont un libellé visible ou au minimum un `title` et un `aria-label` non ambigus.

Le CSS et plusieurs traductions de « Blocs masqués » existent déjà : les réutiliser.

Matrice de validation :

| Type | Ajouter | Masquer/retirer | Restaurer | Supprimer | Déplacer |
| --- | --- | --- | --- | --- | --- |
| Connecté visible | affiche « Ajouté » | oui | — | non | oui |
| Connecté masqué | oui | — | oui | non | après restauration |
| Personnel visible | créé en fin de grille | oui | — | oui + confirmation | oui |
| Personnel masqué | — | — | oui | oui + confirmation | après restauration |
| Personnel supprimé | nouvelle création seulement | — | non | — | — |

Après chaque cellule applicable : vérifier l'affichage immédiat, le rechargement, une autre navigation, le reset et la conservation du contenu.

Fichiers :

- `src/components/DashboardLayout.tsx`
- `src/app/globals.css`
- `src/lib/i18n.ts` avec fusion prudente des changements utilisateur
- `tests/dashboard-layout.test.ts`

### BUD-01 et BUD-02 — Budget lisible et vues par catégorie

`BUD-01` : faire de « Utilisation du revenu » une ligne pleine largeur au-dessus de la ventilation par catégories, au lieu d'une petite colonne isolée à gauche.

`BUD-02` : ajouter un contrôle local « Barres / Camembert » sur les mêmes agrégats de catégories. Réutiliser le SVG circulaire existant, sans nouvelle bibliothèque. Regrouper au besoin les catégories au-delà de la limite sous « Autres » afin de conserver les totaux.

Fichiers :

- `src/components/Finance.tsx`
- `src/app/globals.css`
- un test Node ciblé pour les agrégats si la logique change

Critères d'acceptation :

- les deux vues présentent exactement le même total ;
- tri décroissant stable, cas zéro, dépassement de revenu et catégorie « Autres » corrects ;
- le choix de vue ne modifie aucune donnée ;
- la mise en page reste propre sur desktop et mobile.

### LIB-01 et LIB-02 — Bibliothèque compréhensible et publiable

Utilité à rendre visible dans l'interface :

> Inbox = matière brute. Brouillons = synthèses à relire. Bibliothèque = connaissances validées utilisées par la recherche, l'assistant et les synthèses.

Blocage actuel : `createWikiNote()` et `processInbox()` créent un `draft`, mais aucun contrôle ne permet de passer à `active`.

Changement :

- ajouter « Publier » et « Archiver » aux brouillons ;
- lier une capture traitée à son `wiki_note` ;
- faire disparaître immédiatement une publication des brouillons et la faire apparaître dans la Bibliothèque ;
- alimenter les briefs seulement avec les Wiki `active`, pas avec les brouillons non validés.

Fichiers :

- `src/components/KnowledgeWorkspaces.tsx`
- `src/lib/vault.ts`
- l'action ou l'API de note existante, sans nouveau mécanisme de stockage
- tests de workflow Inbox/Wiki

### LIB-03 — Checklists Wiki persistantes

Rendre les checkboxes interactives uniquement lorsque `MarkdownView` reçoit explicitement le chemin et le `mtime` d'une note éditable. Les réponses de l'assistant et les briefs restent en lecture seule.

Réutiliser `/api/notes`, son `expectedMtime` et son refus de conflit. Ne modifier que le marqueur de tâche Markdown correspondant.

Critères d'acceptation :

- souris, Espace et libellé accessible ;
- état conservé après rechargement ;
- frontmatter et reste du Markdown inchangés ;
- un conflit Obsidian renvoie une erreur sans écraser la version récente ;
- aucune checkbox interactive dans un message IA ou un brief non éditable.

### NOTE-01 — Images Markdown par URL, sans upload

MVP retenu : URL HTTPS uniquement. L'upload, le stockage de pièces jointes et la synchronisation média sont reportés.

Changement :

- styler les images avec `max-width: 100%`, `height: auto`, coins cohérents et chargement différé ;
- fournir une action ou une aide qui insère `![Description](https://...)` ;
- empêcher `withWikiLinks()` de transformer `![[photo.png]]` en faux lien de recherche ;
- conserver un texte alternatif utile.

Critères d'acceptation : grande image sans débordement, erreur d'image compréhensible, lien normal inchangé, URL dangereuse refusée par le renderer.

Limite assumée : une image distante contacte son hébergeur. Un upload local ne sera ajouté que si confidentialité, hors-ligne ou synchronisation de médias deviennent nécessaires.

### NOTE-02 — Navigation ↑/↓ entre blocs

Réutiliser `activeBlockId`, `visibleBlocks` et le focus automatique existants.

Règles :

- ↑ au début d'un bloc place le curseur à la fin du bloc visible précédent ;
- ↓ à la fin place le curseur au début du bloc visible suivant ;
- au milieu d'un texte multiligne, les flèches gardent leur comportement natif ;
- ignorer les enfants repliés ;
- ne pas interférer avec sélection, IME, tableaux, CodeMirror ou menu `/`.

Vérification : une fonction de décision pure avec un test Node minimal, puis matrice manuelle texte, titre, todo, liste, citation, premier/dernier bloc et blocs repliés.

### AI-02 — Synthèses sans références visibles

Cause : les prompts Daily, Weekly et les fallbacks exigent eux-mêmes titres, chemins, wikiliens et sections Sources.

Contrat cible :

- utiliser les preuves silencieusement ;
- écrire uniquement des phrases et affirmations claires ;
- ne jamais afficher `.md`, chemin vault, `[[wikilien]]`, `[Task: ...]`, `task-meta` ou section Sources ;
- conserver la provenance complète dans le frontmatter `sources` ;
- appliquer le même contrat aux fallbacks déterministes.

Fichiers :

- `bridge/memo-bridge.py`
- `prompts/weekly-review.md`
- `vault/09-Skills/synthesize-daily/SKILL.md`
- `vault/09-Skills/synthesize-weekly/SKILL.md`
- `src/lib/vault.ts`
- `tests/prompts.test.ts`
- `tests/brief-ai-contract.test.ts`

Critères d'acceptation : tests négatifs sur chaque motif interdit, phrases complètes, zéro perte des `sources` frontmatter, zéro duplication de tâche.

### AI-03 — Niveau de détail à trois positions

Ajouter un réglage commun `briefDetail: "concise" | "balanced" | "detailed"` dans `SetupState.automation`. Le contrôle peut être un `input type="range"` natif à trois positions avec libellés visibles. Le défaut pour un état sans valeur sera `concise`, car le problème actuel est la verbosité.

Budgets proposés :

| Niveau | Daily | Weekly |
| --- | ---: | ---: |
| Concis | 120–180 mots | 200–300 mots |
| Équilibré | 220–300 mots | 350–500 mots |
| Détaillé | 350–450 mots | 500–650 mots |

Le niveau modifie la profondeur, pas la rigueur factuelle ni le nombre artificiel de sections. Une absence d'information reste une phrase courte, pas du remplissage.

Fichiers :

- `src/lib/vault.ts`
- `src/app/actions.ts`
- `src/app/(shell)/settings/page.tsx`
- `src/lib/i18n.ts`
- `bridge/memo-bridge.py`
- prompts/skills et tests Setup/Prompt

### AI-04 — Tous les Markdown vivants et tous les modules actifs

Interprétation réalisable de « lire tous les Markdown » : indexer tous les Markdown vivants, puis sélectionner de façon déterministe les preuves pertinentes et bornées. Envoyer des dizaines de milliers d'archives au modèle ralentirait l'application et noierait les décisions; `_Archive` reste accessible par ses index compressés.

Créer un sélecteur partagé `activeModuleEvidence(allNotes, setup.modules)` qui :

- reçoit l'index complet des Markdown vivants ;
- exclut chaque module désactivé ;
- retourne un objet borné pour Finance, Budget, Business, Entraînement, Révisions et pages personnalisées ;
- signale un module actif mais vide sans inventer de recommandation ;
- alimente Daily, Weekly et Assistant ;
- inclut toutes les sources réellement utilisées dans le frontmatter.

Le brief global synthétise les signaux inter-modules. En mode détaillé seulement, une section Modules peut donner une phrase utile par module alimenté; en mode concis, un module n'est cité que s'il change une décision, un risque ou une action.

Critères d'acceptation :

- une note à mot-clé unique est retrouvable depuis n'importe quel dossier Markdown vivant ;
- aucun module désactivé n'entre dans le payload ;
- chaque module actif et alimenté est récupérable dans Daily, Weekly et Assistant ;
- les pages custom opt-in sont couvertes ;
- les performances restent mesurées sur un vault volumineux.

### DASH-03 — Blocs connectés conditionnels aux modules

Le dashboard doit d'abord lire `readSetupState()` puis ne charger que les données locales des modules actifs. Ne pas appeler les prix Finance live ni les calculs Trail lourds au chargement initial.

Catalogue cible :

| Module actif | Blocs connectés proposés |
| --- | --- |
| Finance | Patrimoine, Allocation, Dernière évolution |
| Budget | Reste disponible, Répartition, Abonnements/échéances |
| Business | Revenu encaissé, Pipeline pondéré, Relances/factures |
| Entraînement | Prochaine séance, Charge/readiness locale, Conformité de semaine |
| Révisions | Séance du jour, Cartes dues, Compte à rebours/progression |
| Page personnalisée | Liste ou raccourci vers les notes; aucune métrique inventée sans schéma |

Règles :

- tous les blocs connectés sont restaurables et réordonnables ;
- les blocs ne sont proposés que si leur module est actif ;
- désactiver un module masque ses blocs sans perdre leur placement, réactiver le restaure ;
- les blocs de synthèse et graphiques sont pleine largeur pour éviter les trous de grille ;
- une seule lecture locale de données par module alimente tous ses blocs.

Cette mission démarre seulement après validation de `DASH-02` et `AI-04`.

### BUS-01 et BUS-02 — Business testé de bout en bout

Matrice à rejouer :

- état vide, création prospect, création facture ;
- toutes les étapes prospect, gagné/perdu puis réouverture ;
- brouillon → envoyée → payée → réouverte, avec `paid_at` et retard ;
- numéro automatique, doublon et changement d'année ;
- recherche sans casse ni accents ;
- relances avant, le jour même et après échéance ;
- objectif nul, atteint et dépassé ;
- suppression vers corbeille et restauration ;
- devise unique puis données de devises différentes ;
- six onglets, modales, erreurs et responsive desktop/tablette/mobile.

Défauts déjà confirmés à traiter :

- l'action serveur de suppression n'est pas exposée dans l'UI ;
- une facture accepte une échéance antérieure à l'émission ;
- un prospect revenu de `won` à `qualified` peut rester à 100 % ;
- les devises différentes sont additionnées sans conversion.

Décision minimale pour les devises : ne jamais additionner silencieusement. Grouper les totaux par devise ou refuser la saisie incohérente; ne pas ajouter un moteur de change sans demande et source de taux explicites.

### REV-01 — Setup guidé Révisions

Lorsque le module est actif mais vide, afficher un onboarding au lieu d'une 404 ou d'un dashboard à zéro.

Étapes :

1. demander le nom du programme, l'échéance et les modules à apprendre ;
2. créer les fichiers Markdown nécessaires sans écraser l'existant ;
3. proposer des CTA directs pour coller un cours, ajouter des flashcards/QCM et enregistrer des liens de sources ;
4. considérer le programme prêt seulement lorsqu'au moins un contenu utile existe ;
5. conserver intact tout programme déjà configuré.

MVP : texte collé et liens Markdown. Pas d'upload PDF dans cette tâche.

### REV-02 — PDF et annales, reporté

À ouvrir uniquement après validation et usage du setup texte/liens. Le chantier exige validation MIME, taille et noms, stockage par vault, extraction PDF, découpage, pages sources, import idempotent et génération de supports. Un simple stockage de PDF inutilisé ne serait pas une fonctionnalité utile.

## Barrières de validation

Après chaque tâche de code :

1. exécuter le test ciblé le plus petit ;
2. exécuter `npm run typecheck` et `npm run lint` ;
3. exécuter `npm test` à la fin de chaque lot P0/P1 ;
4. exécuter `npm run build` avant de considérer une phase terminée ;
5. pour une interaction visible, ajouter le scénario au tableau manuel ci-dessous et joindre le résultat au journal.

### Matrice navigateur commune

| Surface | 1440 px | 1024 px | 620 px | 390 px | Clavier | Reload/persistance |
| --- | --- | --- | --- | --- | --- | --- |
| Popovers Tâches/Objectifs | ✅ | ✅ | ✅ | ✅ | ✅ Échap/focus | n/a |
| Dashboard blocs | ✅ | ✅ | ✅ | ✅ | ✅ réordre | ✅ |
| Budget accordéons/vues | ✅ | ✅ | ✅ | ✅ | ✅ contrôles natifs | n/a |
| Business | ✅ | ✅ | ✅ | ✅ | ✅ Échap/focus | ✅ tests stockage |
| Notes ↑/↓ et images | ✅ | ✅ route | ✅ route | ✅ route | ✅ ↑/↓ réel | n/a |
| Bibliothèque/checklists | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ |
| Assistant loader | ✅ 72 ms | ✅ route | ✅ route | ✅ route | ✅ lien | n/a |
| Révisions setup | ✅ | ✅ | ✅ | ✅ contraste | ✅ contrôles natifs | ⬜ soumission isolée |

Aucune nouvelle dépendance de test navigateur ne sera ajoutée avant d'avoir démontré que les tests Node et la matrice manuelle ne suffisent pas à prévenir une régression répétée.

## Sécurité du bridge et du MCP

`SEC-02` complète `SEC-01` :

- passer Codex de `danger-full-access` à `read-only` ;
- exécuter les sous-processus IA depuis un répertoire sans code, aussi dans le mode systemd local ;
- retirer le montage `/vault` du bridge si les smoke tests confirment qu'aucun fournisseur ne l'utilise, car l'application transmet déjà les preuves ;
- conserver Claude sans outils ni MCP ;
- confirmer que l'image IA ne contient pas le code Next.js ;
- tester Claude et Codex avec une note Markdown unique, puis tenter explicitement de lire un fichier de code et un JSON ;
- documenter que le MCP applicatif expose uniquement les Markdown du vault, alors que les permissions d'un client MCP externe restent sous le contrôle de ce client.

La sécurité et l'accessibilité ne sont jamais simplifiées pour gagner quelques lignes.

## Journal d'exécution et d'apprentissage

| Date | ID | Résultat | Vérification / erreur | Apprentissage et suite |
| --- | --- | --- | --- | --- |
| 2026-07-21 | AUDIT-01 | ✅ Terminé | 171/171 tests, typecheck et lint passent | La baseline logique est saine; les bugs visibles nécessitent des scénarios navigateur. |
| 2026-07-21 | AUDIT-02 | ✅ Terminé | Quatre captures comparées aux composants et styles | Les défauts de transparence et rognage ont des causes CSS/portail distinctes. |
| 2026-07-21 | AUDIT-03 | ❌ Échec puis ✅ reprise | `npm test -- --test-name-pattern=…` a échoué car le script développe déjà `tests/*.test.ts`; relance ciblée explicite : 6/6 | Pour filtrer, appeler `npx tsx --test` avec les fichiers exacts, pas ajouter des arguments au script globé. |
| 2026-07-21 | AUDIT-04 | ✅ Terminé | Tera, Luna et Sol ont livré leurs audits sans modifier le dépôt | Les trois rapports convergent sur les causes racines et l'ordre rapide → risqué. |
| 2026-07-21 | PLAN-01 | ✅ Terminé | Plan écrit dans ce document | Prochaine reprise : `UI-01`, puis `AI-01`, puis `SEC-01`. |
| 2026-07-21 | UI-01 | 🟡 Implémenté, validation visuelle restante | `align-items: start` ajouté à la grille Budget; lint, typecheck, test Finance 1/1 et `git diff --check` passent | Le correctif racine tient en une règle CSS. Garder le statut en cours jusqu'au contrôle des quatre états d'accordéons aux largeurs prévues. |
| 2026-07-21 | AI-01 | ✅ Terminé | Filtre ciblé avant sauvegarde et au rendu des anciens briefs; 10/10 tests ciblés, lint, typecheck et diff-check passent | Extraire les tâches depuis le brut puis nettoyer une seule fois évite de perdre leurs métadonnées. Les autres commentaires HTML sont conservés. |
| 2026-07-21 | SEC-01 | ✅ Terminé | Le test MCP tente `fetch` et `read_note` sur un JSON; 18/18 tests groupés passent avec lint et typecheck | Le garde commun dans `readNote()` protège tous les appelants et refuse aussi les chemins cachés, sans dupliquer les contrôles dans chaque outil. |
| 2026-07-21 | PERF-01 | 🟡 Implémenté, validation navigateur restante | Fallback Next accessible ajouté; typecheck, ESLint ciblé et diff-check passent | Le loader est statique et sans dépendance. Mesurer le retour visuel au clic avant de conclure, puis décider si `PERF-02` reste nécessaire. |
| 2026-07-21 | UI-02 | ❌ Mauvaise cible puis ✅ Terminé | Le premier patch sans contexte a touché `.settings-grid`; il a été annulé immédiatement. Le patch contextualisé cible `.obj-popover`, avec un jeton sombre désormais réellement opaque; diff-check passe | Toujours inclure le sélecteur CSS dans un patch visant une propriété répétée. Les menus Tâches/Objectifs utilisent maintenant une surface pleine dans les deux thèmes. |
| 2026-07-21 | DASH-01 | ✅ Terminé | Widget `metrics` retiré du catalogue et normalisé hors des layouts v6; `areas` est large; 3/3 tests ciblés, lint, typecheck et diff-check passent | Supprimer le doublon existant règle en même temps le faux bouton « Ajouter » et la demi-largeur, sans créer de migration de stockage. |
| 2026-07-21 | LIB-01 | ✅ Terminé | Explication Inbox → Brouillons → Bibliothèque rendue en français et anglais; test de rendu 1/1, lint, typecheck et diff-check passent | Réutiliser `kb-side-block` rend le cycle visible sans nouvelle structure ni nouveau style. `LIB-02` reste distinct. |
| 2026-07-21 | BUD-01 | 🟡 Implémenté, validation visuelle restante | La carte Budget concernée passe d'une grille deux colonnes à une pile pleine largeur; test Finance 1/1, lint, typecheck et diff-check passent | Une règle existante suffisait; ne pas ajouter de markup. Confirmer desktop/mobile avant de terminer. |
| 2026-07-21 | PERF-02 | ✅ Terminé | Le `fetch` serveur `/status` utilise la revalidation native Next à 60 secondes; typecheck et lint passent | Une option native remplace les appels `no-store` répétés; aucun cache applicatif ni optimisation spéculative de l'historique n'est ajouté. |
| 2026-07-21 | NOTE-01 | 🟡 MVP affichage terminé | Images HTTPS responsives/lazy, alt conservé, URL dangereuse filtrée et `![[photo.png]]` non détourné; 8/8 tests ciblés, lint, typecheck et diff-check passent | Upload et stockage média restent exclus. Ajouter encore un échec d'image compréhensible avant de satisfaire tout le critère du plan. |
| 2026-07-21 | DASH-02 | 🟡 Implémenté, validation navigateur restante | Connectés et personnels sont masquables/restaurables; seuls les personnels ont une suppression confirmée, y compris masqués; 4/4 tests d'état, lint, typecheck et diff-check passent | Les helpers purs couvrent la persistance v6. Rejouer encore les clics, le clavier, le reset et le rechargement dans le navigateur avant de terminer. |
| 2026-07-21 | AI-02 | ❌ Typecheck du test puis ✅ Terminé | Contrat partagé appliqué aux Daily/Weekly IA, fallbacks et anciennes vues; le premier test JSX exigeait `children`, corrigé avant 14/14 tests ciblés, suite complète 176/176, lint, typecheck et diff-check | Garder les preuves dans `sources` et nettoyer seulement les corps de briefs évite d'altérer les notes normales. Tester les composants principaux, pas seulement le lecteur générique. |
| 2026-07-21 | NOTE-02 | 🟡 Implémenté, validation navigateur restante | Navigation ↑/↓ bornée aux frontières, focus début/fin, sélection/IME/modificateurs/menu `/`/table/code protégés; 177/177 tests, lint, typecheck et diff-check passent | Une décision pure et le focus existant suffisent. Rejouer encore texte, titre, todo, liste, citation, replis et premier/dernier bloc dans les navigateurs cibles. |
| 2026-07-21 | UI-03 | 🟡 Implémenté, validation navigateur restante | Popover partagé porté dans `body`, placement haut/bas contraint, scroll/resize, scroll interne, clic extérieur, Échap et retour de focus; 2/2 tests de placement, lint, typecheck et diff-check passent | Le premier contrôle avait révélé un `maxHeight` sans overflow; le scroll interne a été ajouté avant validation. Rejouer toute la matrice Tâches/Objectifs dans le navigateur. |
| 2026-07-21 | AI-03 | ✅ Terminé | Réglage natif concis/équilibré/détaillé, défaut concis, payloads et fallbacks adaptés, budgets Daily/Weekly alignés; 28/28 tests ciblés, Python compile, lint, typecheck et diff-check passent | Le curseur natif et des plafonds simples suffisent; aucun compteur de mots dynamique ni nouveau système de réglages. |
| 2026-07-21 | LIB-03 | ⏳ Validation différée | Les tests checklists ciblés passent, mais le premier typecheck global a rencontré `BudgetBarItem` absent pendant l'édition concurrente de `BUD-02` | Ne pas corriger un fichier hors mission pendant qu'un autre agent l'édite; relancer les barrières après stabilisation de Finance. |
| 2026-07-21 | BUD-02 | 🟡 Implémenté, validation navigateur restante | Sélecteur local Barres/Camembert sur un agrégat partagé, six catégories + « Autres » au-delà de sept; 3/3 tests ciblés, lint, typecheck et diff-check passent | Réutiliser le SVG existant garantit le même total sans nouvelle bibliothèque. Vérifier encore le basculement et le responsive dans le navigateur. |
| 2026-07-21 | LIB-03 | 🟡 Implémenté, validation navigateur restante | Checklists interactives uniquement sur Wiki, écriture ciblée avec `expectedMtime` et 409; après stabilisation Budget, 185/185 tests, lint, typecheck et diff-check passent | Le blocage précédent était bien transitoire et hors scope. Tester encore souris, Espace et conflit réel entre deux onglets dans les navigateurs cibles. |
| 2026-07-21 | BUS-01 | 🟡 Matrice automatisée terminée, navigateur restant | 9 tests réussis et 2 TODO reproductibles : probabilité 100 % après réouverture, échéance antérieure acceptée. Recherche sans accents, suppression UI absente, devises mixtes additionnées et focus modale incomplet confirmés statiquement | Les échecs deviennent le périmètre précis de `BUS-02`. Suite concurrente : 191 réussites/2 TODO; typecheck momentanément bloqué par l'édition AI-04, sans correction hors scope. |
| 2026-07-21 | AI-04 | ✅ Terminé | Preuve partagée et bornée pour Finance, Budget, Business, Entraînement, Révisions et modules personnalisés; modules désactivés/archives exclus et modules actifs vides explicités. Daily, Weekly et Assistant réutilisent le même index Markdown; test 20 000 notes, payload < 50 Ko, 27/27 ciblés, Python, lint, typecheck et diff-check passent | Réutiliser `getDashboard().allNotes` évite un second scan et garantit le même périmètre aux trois flux. Les Wiki automatiques sont limités aux notes publiées; une recherche Assistant explicite peut encore retrouver un brouillon. |
| 2026-07-21 | LIB-02 | 🟡 Implémenté, validation navigateur restante | Publier et archiver passent par l'API existante avec contrôle `mtime`; l'UI déplace immédiatement les cartes et relie les captures traitées à leur note. 4 tests ciblés et workflow API passent; les briefs excluent bien `draft`/`archived` | Réutiliser l'action d'édition évite une nouvelle route. Rejouer encore boutons, erreurs et rechargement dans le navigateur avant de terminer. |
| 2026-07-21 | BUS-02 | ❌ Commande ciblée incorrecte puis ✅ automatisation terminée | `npm test -- --test-name-pattern=…` a d'abord été interprété comme un chemin; relance correcte via `npx tsx --test` : 13/13. Recherche sans accents, suppression récupérable, focus/Échap, totaux par devise, probabilité de réouverture et invariant échéance sont corrigés; aucun TODO restant sur les tests ciblés | Employer directement le runner pour filtrer. Les additions multidevises sont exclues et signalées, sans moteur de change. La tâche reste en cours jusqu'au rejeu navigateur Business. |
| 2026-07-21 | LOT-02 | ✅ Barrières logiques, ⏳ build à relancer | Suite globale 199/199 sans échec ni TODO; typecheck, lint, compilation Python et diff-check passent. Le processus `next build` a disparu sans code retour et sans `BUILD_ID` après plusieurs attentes | Aucun défaut produit n'est établi par cette interruption silencieuse; relancer le build isolément après la prochaine vague et ne pas le déclarer réussi avant l'artefact final. |
| 2026-07-21 | DASH-03 | ✅ Terminé | 16 blocs connectés conditionnels; ajout, masquage, restauration, suppression personnelle, réordre clavier et persistance rejoués dans Chromium; toutes les cartes module sont pleine largeur | Conserver les identifiants et la sélection de modules dans `src/lib/dashboard-modules.ts` évite les imports client depuis le serveur. |
| 2026-07-21 | DASH-03 | ❌ Crash production puis ✅ reprise | Le premier serveur production appelait `dashboardWidgetIdsForModules()` depuis un module `use client`; le build et les tests Node ne l'avaient pas détecté. Helper déplacé dans la librairie serveur sûre, puis navigateur vert | Une fonction utilisée par un Server Component ne doit jamais être exportée depuis un composant client, même si elle paraît pure. |
| 2026-07-21 | UI-04 | ❌ Mauvaise cible CSS puis ✅ reprise | Un patch sans contexte a brièvement modifié `.notes-browser`; annulation immédiate, puis catalogue dashboard ciblé et rendu opaque avec `var(--menu-surface-strong)` | Pour toute propriété répétée dans le grand fichier CSS, inclure le sélecteur complet dans le contexte du patch. |
| 2026-07-21 | UI-03 | ✅ Terminé | Tâches et Objectifs testés à 1440/1024/620/390 px : surface opaque, placement dans le viewport, Échap et retour de focus; aucun débordement document | Le portail partagé supprime à la fois le rognage par tableau et les correctifs locaux divergents. |
| 2026-07-21 | UI-01/BUD-01/BUD-02 | ✅ Terminé | Quatre états ouvert/fermé des deux premiers accordéons, largeur de « Utilisation du revenu », vue Camembert et quatre largeurs testés dans Chromium | `align-items:start` règle le vide blanc à la source; les deux vues réutilisent le même agrégat. |
| 2026-07-21 | BUS-01/BUS-02 | ❌ Hydratation puis ✅ Terminé | Chromium a détecté `0,0 €` côté Node contre `0 €` côté client. Formatter partagé avec `minimumFractionDigits:0`; six onglets, modale, Échap/focus, quatre largeurs et aucune erreur React validés | Les options implicites d'`Intl.NumberFormat` compact peuvent varier selon ICU; fixer les bornes de fraction explicitement pour le SSR. |
| 2026-07-21 | PERF-01 | ✅ Terminé | Navigation réelle Dashboard → Assistant mesurée à 72 ms; `loading.tsx` accessible et catalogue bridge revalidé 60 s; route propre aux quatre largeurs | Le fallback Next et le cache natif suffisent; aucun cache applicatif supplémentaire. |
| 2026-07-21 | NOTE-02 | ❌ Course de focus puis ✅ Terminé | Premier test Chromium : bon bloc mais curseur à la fin (`60` au lieu de `0`). Le focus enfant gagnait la course. Le focus pending a maintenant priorité; ↓ début du suivant et ↑ fin du précédent passent sans modifier la note | Tester la position réelle du caret, pas seulement l'identifiant du bloc actif. |
| 2026-07-21 | REV-01 | 🟡 Implémenté, écriture isolée restante | Setup guidé responsive, CTA cours/cartes/QCM/liens, création de six fichiers idempotente testée et bouton mobile rendu lisible; 16/16 ciblés | Ne pas soumettre le formulaire contre le vault utilisateur pendant l'acceptation. Rejouer setup → contenu → dashboard sur un vault temporaire avant de terminer. |
| 2026-07-21 | SEC-02 | ✅ Terminé | Codex read-only et outils/web/MCP désactivés, Claude sans outils/MCP, cwd temporaire, image/Compose sans code ni vault, smokes live Claude/Codex, 12/12 sécurité | Le bridge ne doit recevoir que les preuves Markdown transmises par l'app, jamais le dépôt ou le vault monté. |
| 2026-07-21 | SEC-02 | ❌ Deux écarts de moindre privilège puis ✅ reprise | L'override Compose ignorait un chemin de clés personnalisé et chaque moteur recevait les deux clés. Override retiré et environnement cloisonné par fournisseur; py_compile, Bash, Compose et diff-check passent | Auditer les valeurs réellement résolues par Compose et les variables remises aux sous-processus, pas seulement les flags CLI. |
| 2026-07-21 | BROWSER-01 | ❌ Harnais auth puis ✅ reprise | Le premier parseur `.env` brut ne reproduisait pas Next et la connexion échouait; remplacement par `loadEnvConfig()` | Un test E2E doit charger l'environnement comme l'application, sans afficher les secrets. |
| 2026-07-21 | BROWSER-02 | ❌ Serveur standalone incomplet puis ✅ reprise | Le serveur standalone local n'avait pas `.next/static`, normalement copié par le Dockerfile : HTML sans JavaScript et catalogue introuvable. Rejeu sur le build local complet; Dockerfile vérifié avec la copie d'assets | Distinguer un artefact standalone non assemblé d'un bug d'hydratation produit. |
| 2026-07-21 | LOT-03 | ✅ Terminé | 207/207 tests, aucun échec/TODO; typecheck, lint, Python, Bash, Compose, diff-check et deux builds production réussis. Chromium : 9 routes × 4 largeurs, 7 captures, aucun débordement ni erreur de page | Les 14 avertissements Turbopack existants sur instrumentation Edge et traçage de chemins sont une dette de build/performance, pas un échec fonctionnel. |

| 2026-07-22 | DASH-04 | ✅ Stage A terminé | Blocs modules refondus : 16 cartes texte → 6 blocs visuels (1 par module). Donut SVG server-renderable partagé (`DashboardViz.tsx`, réutilise `.home-donut*`) pour Finance/Budget/Business ; anneau de progression pour Entraînement/Révisions ; Custom inchangé. IDs réduits à 1/module, migration v6 automatique (les anciens `module:*:*` sont filtrés par `normalizeDashboardState`) + `reconcileAvailableModules` ajoute les nouveaux IDs sans ressusciter les blocs masqués. 208/208 tests (dont test réconciliation), typecheck, lint. Vérifié navigateur réel (vault scratch + données démo) : donuts/anneaux corrects, arcs SVG mesurés (Encaissé 22 %/Pipeline 75 %), aucun débordement à 1280 px ni 390 px, seules erreurs console = HMR websocket (dev). | Réutiliser le donut existant du dashboard évite recharts côté serveur. Décision produit : 1 bloc fort visuel/module au lieu de 3 cartes « gros chiffre + phrase ». |
| 2026-07-22 | DASH-05 | ✅ Stage B terminé | Historique quotidien dans `data/snapshots.json` (télémétrie dérivée, hors vault → pas de churn Syncthing). `src/lib/snapshots.ts` (upsert pur idempotent par date, borné 120 j) + `src/lib/daily-snapshot.ts` (calcule patrimoine/dispo/pipeline/revenu/forme, écrit ≤1×/jour) branché sur le tick 5 min de `instrumentation.ts`. `page.tsx` affiche `Sparkline` (réutilisé de `ui/Analytics`) sous chaque donut/anneau dès ≥2 points. 211/211 tests (+3), typecheck, lint. Vérifié navigateur avec historique 7 j injecté : 4 courbes rendues (patrimoine, dispo, revenu, forme), aucun débordement. `data/` gitignoré. | Stocker la série dans `data/` évite d'inventer un schéma vault et de polluer Obsidian ; les courbes s'accumuleront d'elles-mêmes en production via le scheduler. |

## Vague 2 — corrections post-déploiement (2026-07-22)

Retours utilisateur après le déploiement de `9dd37f4`. Objectif : passer de « ça
marche » à « c'est beau, complet et logique ». Une régression introduite par notre
propre push (verify du bridge) est en tête.

### Causes racines déjà identifiées (audit code)

- **Verify IA cassé** — `AiProviderCard` (`SetupWizard.tsx`) grise le bouton via
  `disabled={!status.installed}`, et `status.installed = health.engines[x] === true`
  (`ai-bridge.ts`). `SEC-02` a changé l'exécution du bridge (Codex `read-only`,
  clés scindées par moteur, cwd sans code). Hypothèse : `/health` ne rapporte plus
  les moteurs comme installés, ou `/verify` échoue sous le nouveau régime. Régression
  P0 à déboguer sur le bridge réel.
- **Clignotement FR↔EN + flash thème** — `LanguageProvider.setLocale` appelle
  `window.location.reload()` (ligne 37). Le rechargement complet repeint le thème par
  défaut avant réapplication client → flash clair + clignotement.
- **Camemberts différents de « Focus par domaines »** — `DashboardViz.Donut` utilise
  des pastilles plates et son propre dégradé ; `HomeAreaFocus` utilise `glossFill`,
  un `drop-shadow` et un dégradé `userSpaceOnUse`. Deux composants donut divergents.
- **Trous dans le budget** — `.finance-budget-editor-grid` est une grille 2 colonnes
  `align-items:start` : les lignes s'alignent, donc réduire une section laisse un trou
  au lieu de faire remonter la voisine.
- **Objectif principal non lié aux tâches** — la liaison par `area` existe dans
  `objectiveProgress` (`page.tsx`), mais `PrimaryGoalCard` ne reçoit que `done/total/
  progress`, jamais la liste des tâches ; et si l'`area` de l'objectif ne matche aucune
  tâche (casse/absence), la carte se vide.
- **Séances validées à tort** — le bloc Entraînement compte les cases `[x]` du plan
  comme « fait » (`dashboard-modules.ts` → `currentTrainingSection`) sans vérifier que
  l'activité réelle correspond au type planifié (ex. « Sweet Spot » vélo).

### Ordre d'exécution — rapide d'abord, P0 en tête

| Rang | ID | Mission | Difficulté | Priorité | Agent / modèle suggéré |
| ---: | --- | --- | --- | --- | --- |
| 1 | V2-01 | Réparer la régression « Vérifier » du bridge IA | S | P0 | debug live + `general-purpose` (sonnet) |
| 2 | V2-02 | Unifier le style des donuts sur `HomeAreaFocus` | XS | P1 | `cavecrew-builder` (haiku) |
| 3 | V2-03 | Budget : blocs serrés, reflow au repli (multicol) | S | P1 | `cavecrew-builder` (sonnet) |
| 4 | V2-04 | Switch de langue sans reload ni flash thème | S | P1 | `general-purpose` (sonnet) |
| 5 | V2-05 | Curseur détail → segment iOS/macOS | S | P1 | `general-purpose` (sonnet) |
| 6 | V2-06 | Fréquence des briefs : dropdowns natifs → `CustomSelect` | S | P1 | `general-purpose` (sonnet) |
| 7 | V2-07 | Objectif principal lié à ses tâches par domaine | M | P0 | `general-purpose` (sonnet) |
| 8 | V2-08 | Refonte de l'apparence des Réglages (cartes concises) | M | P1 | `general-purpose` (opus) + verify-ui |
| 9 | V2-09 | Blocs modules plus riches et complets (résumés visuels) | L | P1 | `general-purpose` (opus) + verify-ui |
| 10 | V2-10 | Validation honnête des séances d'entraînement | L | P2 | `general-purpose` (opus) |

### Détail des missions

**V2-01 — Régression verify IA (P0).** Déboguer sur le bridge en cours d'exécution
(`docker compose exec ai-bridge`, `/health`, `/status`, `/verify`). Rétablir que
`/health` rapporte les moteurs installés et que `/verify` réussit sous Codex
`read-only` + clés scindées + cwd sans code. Critère : cliquer « Vérifier » repasse
`claude` et `codex` à « connexion vérifiée » sur une instance réelle ; aucun
assouplissement de `SEC-02` sans nécessité prouvée.

**V2-02 — Donut unifié.** Généraliser `HomeAreaFocus` (accepter couleurs explicites +
valeur/sous-titre du centre) et l'utiliser pour tous les blocs modules, OU aligner
`DashboardViz.Donut` sur son style exact (`glossFill`, `drop-shadow`, dégradé
`userSpaceOnUse`, légende identique). Un seul langage visuel de donut. Critère :
Patrimoine/Budget/Business et « Focus par domaines » sont visuellement identiques.

**V2-03 — Budget compact.** Remplacer la grille par un `columns: 2` (multicol) ou une
disposition qui fait remonter les sections quand une voisine se replie ; zéro trou aux
quatre largeurs. Critère : replier n'importe quelle section comble le vide
immédiatement ; pas de rectangle blanc.

**V2-04 — Langue sans flash.** Supprimer `window.location.reload()` ; propager la
locale par contexte + `router.refresh()` (soft nav), et garantir que le thème est
appliqué avant peinture (pas de passage clair). Critère : bascule FR↔EN instantanée,
thème stable, aucun clignotement à 390 px et ≥1280 px.

**V2-05 — Segment détail iOS.** Remplacer l'`input range` de `BriefDetailSetting` par
un contrôle segmenté 3 positions (Concis / Équilibré / Détaillé) type iOS/macOS :
pilule glissante, états `:focus-visible`, tap ≥44 px, clavier. Critère : joli, lisible,
accessible, mêmes valeurs enregistrées.

**V2-06 — Dropdowns custom.** Remplacer les `<select>` natifs de fréquence/rythme des
briefs par `CustomSelect` (déjà dans le repo). Critère : dropdowns stylés cohérents,
clavier + Échap + retour de focus conservés.

**V2-07 — Objectif ↔ tâches par domaine (P0).** Fiabiliser la liaison (par `area` ET
champ `objective`, insensible à la casse) et faire afficher à `PrimaryGoalCard` les
tâches liées de l'objectif principal (pas seulement un pourcentage). Gérer proprement
l'absence d'`area`. Critère : l'objectif principal montre ses tâches liées par domaine
sur un vrai vault ; aucune régression du bloc « Objectifs · progression ».

**V2-08 — Apparence des Réglages.** Casser les longs blocs pleine largeur en cartes
concises (grille 2 colonnes déjà amorcée par `.settings-grid`), hiérarchie claire,
densité correcte. Vérif mobile + desktop obligatoire. Critère : plus aucun bloc
« bande pleine largeur » superflu ; lisible et dense à 390 px et ≥1280 px.

**V2-09 — Blocs modules riches (design).** Moins de variété, plus de complétude :
chaque module = une carte « résumé » claire (métrique clé + composition donut/anneau
+ courbe de tendance + 1-2 stats secondaires + une phrase disant ce que ça apporte).
Unifier la grammaire visuelle des blocs. Cadrer d'abord la maquette (design skill),
puis implémenter, puis verify-ui. Critère : chaque bloc se comprend d'un coup d'œil et
apporte une info actionnable ; style homogène.

**V2-10 — Validation honnête des séances.** Auditer ce qui coche les `[x]` (plan
manuel vs sync Garmin). Ne plus traiter une case cochée comme preuve quand l'activité
ne correspond pas au type planifié. Approche : validation explicite par l'utilisateur
(confirmer une séance d'un tap) et/ou heuristique de correspondance (type d'activité +
durée/intensité vs séance planifiée) ; la musculation reste en validation manuelle.
Critère : une séance non conforme n'est pas comptée « faite » sans action de
l'utilisateur.

### Barrières Vague 2

Mêmes barrières que la Vague 1 : test ciblé, `typecheck`, `lint`, `npm test` en fin de
lot, `npm run build` avant de clore, et rejeu navigateur mobile-first (390 + ≥1280)
pour toute mission UI. Aucune régression de `SEC-01`/`SEC-02` : `V2-01` répare sans
rouvrir le bridge au code ou au vault.

### Journal Vague 2

| Date | ID | Résultat | Vérification | Apprentissage |
| --- | --- | --- | --- | --- |
| 2026-07-22 | V2-02 | ✅ Terminé | `DashboardViz.Donut` aligné sur `HomeAreaFocus` : `glossFill` + `gradientTransform` copiés, pastilles de légende en dégradé gloss. Navigateur : donuts modules = « Focus par domaines ». | Agent sonnet, diff minimal (3 lignes), API `Donut` intacte. |
| 2026-07-22 | V2-03 | ✅ Terminé | `.finance-budget-editor-grid` grid→`columns:2` multicol + `break-inside:avoid`, 1 colonne en mobile. Navigateur : replier 2 sections fait remonter/packer les voisines, aucun trou. | Multicol = reflow gratuit vs grille. |
| 2026-07-22 | V2-04 | ✅ Terminé | `window.location.reload()`→lecture défensive de `AppRouterContext` + `router?.refresh()`. Navigateur : `Réglages→Settings`, sentinelle anti-reload survit, thème stable, zéro flash. | `useRouter()` jette en render SSR de test ; lire `AppRouterContext` via `useContext` dégrade proprement (no-op) hors app et corrige 4 tests `.tsx`. |
| 2026-07-22 | V2-05 | ✅ Terminé | `input range`→contrôle segmenté iOS (radiogroup + pilule, `*.module.css`, tokens). Contrat préservé : `briefDetail` = index `"0"/"1"/"2"`. Navigateur : segment « Concis/Équilibré/Détaillé » propre. | L'agent a vérifié le vrai contrat (`actions.ts` indexe un tableau) au lieu du libellé supposé. |
| 2026-07-22 | V2-01 | ✅ Clos (pas de code) | Agent opus a enquêté sur le **bridge live** (lecture seule) : `/status` rapporte `engines: claude=true, codex=true` (bouton cliquable, pas grisé). `/verify` échoue pour causes **externes** : session Claude CLI expirée (`OAuth session expired`) + Codex quota atteint (reset ~28 juil). Auraient échoué à l'identique avant SEC-02. Aucun diff. | Ce n'était pas notre régression. Remédiation = re-login Claude / clé API, attendre quota Codex. SEC-02 intact. Seul vrai changement SEC-02 (non lié, non patché) : les clés posées en variable d'env du conteneur ne sont plus transmises, seules celles de `data/ai-credentials.env` le sont. |
| 2026-07-22 | V2-07 | ✅ Terminé | `PrimaryGoalCard` affiche les tâches liées (top 3 + badge priorité) + état vide « aucune tâche liée » ; call-site `page.tsx` passe `tasks`. Navigateur : carte « Objectif principal » montre l'objectif finance + Ouvrir PEA/Automatiser virement (liés par area). typecheck/lint/214 tests/build verts. | Liaison area+objectif déjà correcte ; seul le rendu manquait. `dashboard-objectives.ts`/`i18n.ts` intacts. |
| 2026-07-22 | V2-08 | ✅ Terminé (nav vérifié) | `.settings-content` grid→2 colonnes, seule Assistant IA reste `is-wide`. Navigateur : desktop 2 colonnes (Apparence\|Langue+Setup ; Pages\|Infos), mobile 1 colonne, aucun débordement, clair/sombre OK. | `.settings-grid` (776-789) confirmée morte, laissée hors-scope. |
| 2026-07-22 | V2-10 | ✅ Terminé (logique) | Audit : le dashboard compte des `[x]` **manuels** (aucun code ne coche) ; la vraie auto-validation est `matchWeek` (`trail.ts`) qui matchait par sport sans durée. Ajout `activityFitsSession` (plancher 60% de la durée planifiée) + test `trail-plausibility.test.ts` (3 pass). | Plafond documenté (durée seule, pas les zones d'intensité) ; validation manuelle = source de vérité. Suivi possible : split « à valider »/« fait » dans le bloc dashboard (touche page.tsx). |
| 2026-07-23 | V2-06 | ✅ Terminé | `<select name="briefFrequency">` natif (dans `settings/page.tsx`, pas `SetupWizard`) → `CustomSelect` (même `name`/valeurs, hidden input). Les `<input type="time">` restés natifs. Navigateur : dropdown custom stylé (Manuel/Tous les jours/Deux fois/Chaque lundi/Premier du mois). Fait en direct (agents bloqués par limite de dépense). | — |
| 2026-07-23 | V2-09 | ✅ Terminé | Squelette de bloc unifié : header + donut/anneau + courbe + **rangée de 3 stats sourcées** (`moduleStats`) séparée par un filet, remplace la ligne « detail » vague. Finance (positions/évolution/premier poste), Budget (planifié/abonnements/échéance), Business (encaissé/pipeline/à traiter), Entraînement (séances/forme/prochaine), Révisions (contenu/cartes/examen). CSS `.dashboard-module-stats` en place (mort `.dashboard-module-detail` retiré). Navigateur desktop+mobile 390 : cohérent, aucune donnée inventée, aucun débordement. Fait en direct. | Moins de variété, plus de complétude : une grammaire visuelle unique pour les 5 modules. |
| 2026-07-23 | LOT-V2-2b | ✅ Barrières vertes | typecheck, lint, tests (fail 0), build EXIT=0. Navigateur : blocs enrichis + dropdown custom, desktop + mobile. Agents 2b échoués sur limite de dépense mensuelle → V2-06/V2-09 réalisés par l'agent principal. | — |
| 2026-07-22 | LOT-V2-2a | ✅ Barrières vertes | typecheck, lint, 214/214 tests, build EXIT=0. Navigateur : objectif lié, réglages 2 colonnes desktop + 1 mobile. | — |
| 2026-07-22 | LOT-V2-1 | ✅ Barrières vertes | typecheck, lint, 211/211 tests, build EXIT=0. Régression de mon Stage B corrigée au passage : `tests/snapshots.test.ts` typait `history` trop étroitement (jamais passé sous `tsc`, poussé rouge car le build ne typecheck pas les tests). | Toujours lancer `npm run typecheck` (pas seulement `tsx --test`) après ajout d'un fichier de test. |
| 2026-07-23 | V2-02/V2-09 (finition) | ✅ Terminé | `DashboardViz.Donut` : suppression de l'anneau de fond (`<circle>` track) pour aligner sa structure sur `HomeAreaFocus`, qui n'a jamais eu de track. `globals.css` : trois `.home-card:hover` contradictoires fusionnés en une seule règle (transition tokenisée + `translateY(-1px)`, partagée avec `.dashboard-custom-card`). Rendu navigateur 390 + 1280 sur vault scratch (auth off, 3 positions finance injectées) : donut = 3 arcs et 0 track, aucun débordement, erreurs console limitées au socket HMR de dev. typecheck, lint, 214/214 tests. | Un donut d'allocation somme toujours au cercle complet, donc le track ne servait qu'à laisser filtrer le fond dans les gaps arrondis. La fusion supprime aussi un append-override (failure mode #1). |

## Vague 3 — audit honnête post-déploiement (2026-07-23)

Retours utilisateur sur `e7af6e5` en production. Le principe de cette vague : **ne
plus marquer « ✅ » sans preuve navigateur au viewport et aux données réelles.** Chaque
correctif UI est rendu à 390 et à ≥ 1440 (l'utilisateur signale les débordements en
large, pas seulement en mobile) avec des données représentatives (titres longs,
positions finance, plan d'entraînement, factures), mesuré et capturé avant tout « ✅ ».

### État réel vérifié (lecture du code déployé, pas du journal)

| Sujet | Verdict | Cause racine constatée |
| --- | --- | --- |
| Objectif ↔ tâches | ❌ Incomplet | `page.tsx` `objectiveProgress` lie par `area` uniquement (`normKey(objective.data.area)` vs `task.data.area`) ; le champ `objective` des tâches est ignoré. |
| Validation séances | ❌ Insuffisant | `activityFitsSession` (`trail.ts:1682`) = sport + durée ≥ 60 % (`PLAUSIBLE_DURATION_FLOOR`) ; aucune comparaison d'intensité/type. Un vélo Z1 remplit un slot « Sweet spot ». Le bloc dashboard compte en plus les `[x]` manuels (`dashboard-modules.ts:232`). |
| Débordement carte objectif | ❌ Bug réel | `.home-analytics-side` (`minmax(250px,.65fr)`) + `overflow:visible` sur l'overview + carte sans `min-width:0` → la carte déborde la grille en large. |
| Camemberts vs Focus par domaines | ⚠️ À vérifier | `Donut` aligné en structure sur `HomeAreaFocus` (V2-02 + finition), parité visuelle non re-mesurée au rendu réel. |
| Blocs modules riches | ⚠️ Design refusé | `moduleStats` (3 stats) présent, mais l'utilisateur veut de vrais résumés visuels (métrique + donut/anneau + courbe + phrase d'apport), moins de types différents. |
| Réglages | ⚠️ Design partiel | `.settings-content` en 2 colonnes, mais slabs `is-wide` restants jugés moches. |
| Flash thème FR↔EN | ❌ Incomplet | `reload()` retiré (`LanguageProvider` lit `AppRouterContext` + `router.refresh()`), mais le flash persiste : thème non réappliqué avant peinture au soft-nav. |
| Budget reflow | ⚠️ À vérifier | `.finance-budget-editor-grid` en `columns` (multicol) ; packing réel à confirmer aux 4 largeurs. |
| Vérifier IA | ⚠️ Externe présumé | Diagnostic V2-01 = session Claude expirée + quota Codex ; à re-confirmer en live et surtout afficher une erreur actionnable au lieu d'un échec muet. |
| Curseur détail / dropdowns | ⚠️ À vérifier | `BriefDetailSetting` segmenté + `CustomSelect` présents ; rendu à confirmer. |

### Ordre d'exécution — rapide d'abord, modèle adapté à la difficulté

| Rang | ID | Mission | Difficulté | Priorité | Agent / modèle |
| ---: | --- | --- | --- | --- | --- |
| 1 | V3-01 | Carte objectif qui déborde en large (CSS `min-width:0` + revoir `overflow:visible`) | XS | P0 | `cavecrew-builder` (haiku) |
| 2 | V3-02 | Flash thème au switch FR↔EN (thème appliqué avant peinture) | XS | P1 | `general-purpose` (sonnet) |
| 3 | V3-03 | Parité visuelle des camemberts avec « Focus par domaines » (mesure + ajuste) | S | P1 | `cavecrew-builder` (sonnet) |
| 4 | V3-04 | Confirmer/corriger budget reflow + curseur détail + dropdowns au rendu | S | P1 | `general-purpose` (sonnet) |
| 5 | V3-05 | Objectif ↔ tâches par `area` **ET** champ `objective` (insensible casse) | S | P0 | `general-purpose` (sonnet) |
| 6 | V3-06 | Vérifier IA : re-diagnostic live + erreur UI actionnable | S | P1 | `general-purpose` (sonnet) |
| 7 | V3-07 | Réglages : casser les slabs pleine largeur en cartes concises | M | P1 | `general-purpose` (opus) + verify-ui |
| 8 | V3-08 | Blocs modules riches (maquette design → implémentation → verify) | L | P1 | `general-purpose` (opus) + design skill |
| 9 | V3-09 | Validation séances par intensité/type + validation explicite utilisateur | L | P0 | `general-purpose` (opus) |

### Détail des missions

**V3-01 — Carte objectif débordante (P0, XS).** Contraindre la piste de grille de la
carte : `min-width:0` sur `.home-analytics-side` et sur l'`article` de `PrimaryGoalCard`,
et vérifier que `overflow:visible` sur l'overview (ligne ~11262) n'est pas la cause du
spill (le remettre à `clip`/`hidden` si le menu popover n'en dépend pas). Critère : à
1440 et 1920, avec un titre d'objectif long et 3 tâches longues, la carte reste dans la
grille, le texte des tâches est tronqué (ellipsis), `scrollWidth <= innerWidth`.

**V3-02 — Flash thème FR↔EN (P1, XS).** Le soft-nav repeint avant que le thème client
soit réappliqué. Garantir que l'attribut de thème est posé sur `<html>` avant peinture
(script inline pré-hydratation déjà présent ? sinon l'ajouter) et que `router.refresh()`
ne réinitialise pas la locale/thème. Critère : bascule FR↔EN sans passage clair ni
clignotement à 390 et ≥ 1440.

**V3-03 — Parité camemberts (P1, S).** Mesurer au rendu `DashboardViz.Donut` vs
`HomeAreaFocus` (taille, épaisseur d'anneau, légende, gloss, ombre). Aligner ce qui
diffère. Critère : côte à côte, Patrimoine/Budget/Business et « Focus par domaines »
sont indiscernables en style.

**V3-04 — Confirmations rendu (P1, S).** Rendre et mesurer : budget reflow (replier une
section comble le trou, 4 largeurs), curseur détail segmenté (tap ≥ 44 px, focus),
dropdowns fréquence (clavier + Échap). Corriger uniquement ce qui échoue. Critère :
chacun conforme, capture à l'appui.

**V3-05 — Objectif ↔ tâches (P0, S).** Dans `objectiveProgress`, lier une tâche si
`normKey(task.area) === normKey(objective.area)` **OU** `normKey(task.objective)`
correspond au titre/slug de l'objectif. Gérer l'absence d'`area`. Critère : sur un vrai
vault, l'objectif principal montre ses tâches liées par domaine **et** par champ
`objective` ; aucune régression du bloc « Objectifs · progression ».

**V3-06 — Vérifier IA (P1, S).** Re-tester `/health` `/verify` sur le bridge live. Si
l'échec est externe (OAuth/quota), afficher dans l'UI un message clair et actionnable
(« session Claude expirée : reconnecter » / « quota Codex atteint ») au lieu d'un bouton
qui « ne marche plus » silencieusement. Aucun assouplissement de `SEC-02`. Critère :
cliquer « Vérifier » donne toujours un état lisible (succès ou raison précise).

**V3-07 — Réglages concis (P1, M).** Casser les longs blocs pleine largeur en cartes
denses ; ne garder `is-wide` que là où c'est justifié. Hiérarchie et densité correctes.
verify-ui obligatoire 390 + ≥ 1440, clair/sombre. Critère : plus aucun slab superflu,
lisible et dense aux deux largeurs.

**V3-08 — Blocs modules riches (P1, L).** Maquette d'abord (design skill) : une
grammaire unique = métrique clé + composition (donut/anneau) + courbe de tendance + 1-2
stats secondaires + une phrase disant ce que le bloc apporte. Moins de types, plus de
complétude. Puis implémentation, puis verify-ui. Critère : chaque bloc se comprend d'un
coup d'œil et donne une info actionnable ; style homogène ; validé au rendu avec données
réelles.

**V3-09 — Validation séances honnête (P0, L).** Étendre `activityFitsSession` : au-delà
de sport + durée, comparer l'intensité/type. Parser l'intensité planifiée (`% FTP`,
« Sweet spot », zones Z1–Z5, RPE) et la confronter aux données d'activité (puissance
moyenne / FC / dénivelé). En cas de doute, **ne pas** valider automatiquement : proposer
une validation explicite par l'utilisateur (un tap « c'était bien cette séance » /
« non »). Musculation = validation manuelle assumée. Critère : une séance de type/
intensité non conforme n'est jamais comptée « faite » sans action utilisateur ; le cas
« Sweet spot planifié, sortie facile réelle » n'est plus auto-validé.

### Barrières Vague 3

Chaque mission : test ciblé + `typecheck` + `lint`, `npm test` en fin de lot,
`npm run build` avant de clore, et pour toute mission UI un **rendu navigateur mesuré à
390 et ≥ 1440 avec données représentatives**, capture jointe au journal. Aucune
régression `SEC-01`/`SEC-02`. Un « ✅ » sans preuve navigateur est interdit dans cette
vague.

### Journal Vague 3

| Date | ID | Résultat | Vérification | Apprentissage |
| --- | --- | --- | --- | --- |
| 2026-07-23 | AUDIT-V3 | ✅ Audit livré | Lecture du code déployé `e7af6e5` : V3-05 (lien area-only), V3-09 (durée sans intensité) et V3-01 (débordement carte) confirmés par le code ; reste à re-mesurer au rendu. | Ne jamais reporter « ✅ » depuis le journal : vérifier l'app. La Vague 2 a livré du code mais pas la satisfaction produit. |
| 2026-07-23 | V3-01 | ✅ Terminé, déployé | Cause mesurée au rendu 1920 : la carte `.primary-goal-card` (713 px) débordait sa piste de grille de 309 px de 96 px. `min-w-0` ajouté sur l'`article`. Re-mesuré : `scrollWidth == innerWidth` à 1440 et 1920, carte revenue à 309 px. | Un enfant de grille sans `min-width:0` refuse de rétrécir sous son min-content ; c'est la cause classique d'un débordement en large, invisible à 1280. |
| 2026-07-23 | V3-05 | ✅ Terminé, déployé | La liaison area+objectif existait déjà ; le vrai bug était `normKey` (`trim().toLowerCase()`) qui ne gérait pas les `[[wikilink]]`, `.md` ni les accents. Durci. Prouvé : une tâche `objective: "[[…]]"` d'un autre domaine se lie désormais (carte 4→5 tâches). | Le code « correct » peut échouer sur la vraie donnée Obsidian ; normaliser les formes de référence, pas juster la casse. |
| 2026-07-23 | V3-03 | ✅ Vérifié conforme, déployé | Comparaison mesurée `DashboardViz.Donut` vs `HomeAreaFocus` : mêmes stroke (13), boîte (116 px), gloss, dégradé, légende. Capture à l'appui. Déjà à parité depuis V2-02. | La plainte visait en fait des courbes/blocs riches (→ V3-08), pas le style du donut. |
| 2026-07-23 | V3-08 | ✅ v1 terminé, déployé | Structure (donut/anneau + courbe + 3 stats) déjà présente ; courbes vides car `snapshots.json` n'a qu'1 jour (système démarré la veille, seuil ≥ 2). Bootstrap : 1 point → ligne plate day-one (aucune donnée inventée). Ajout d'une phrase de but par bloc (« à quoi ça sert »). Rendu 1440 : captions + courbes présentes, aucun débordement. | Les courbes se rempliront d'elles-mêmes ; le bootstrap les montre dès aujourd'hui. Blocs bornés par la donnée réelle du module. |
| 2026-07-23 | V3-04 | ✅ Vérifié conforme, déployé | Rendu Réglages : curseur détail = pilule segmentée iOS (Concis/Équilibré/Détaillé), 0 `<select>` natif, 4 `CustomSelect`. | Ces trois-là étaient déjà livrés (V2-05/V2-06) ; la vérification suffit. |
| 2026-07-23 | V3-09 | ✅ Terminé, déployé | `activityFitsSession` étendu : une session « quality » (sweet spot / FTP / seuil / VO2 / intervalles) exige un signal d'effort réel (Garmin Training Effect aérobie ≥ 3.0 ou anaérobie ≥ 1.0). Une sortie facile pleine durée ne valide plus un slot Sweet spot ; sans donnée d'effort → non bloquant (validation manuelle = vérité). 2 tests ajoutés, 216/216. | Le Training Effect est un signal normalisé par athlète, sans besoin de FTP/zones. Le « tap » utilisateur = la validation manuelle existante ; un état « à valider » explicite reste un plus futur. |
| 2026-07-23 | V3-07 | ✅ v1 terminé, déployé | Slab Assistant IA : les 3-4 blocs de commandes docker par fournisseur repliés dans un `<details>` « Voir les commandes CLI ». Cartes fournisseur 600→341 px. Rendu 1440 + 390 : repli/dépli OK, aucun débordement. | `.setup-command{display:grid}` (règle auteur) battait même le repli natif de `<details>` ; un `:not([open]) > *:not(summary){display:none}` explicite est nécessaire. HMR CSS Turbopack peu fiable : redémarrer le dev pour vérifier une règle CSS. |
| 2026-07-23 | V3-02 | ⛔ Bloqué (repro) | `reload()` déjà retiré (V2-04) ; flash de peinture non reproductible en headless. En attente : où l'utilisateur bascule la langue (sidebar / Réglages / toggle Langue) pour piloter la repro exacte. | Ne pas deviner un correctif de timing de peinture sans repro. |
| 2026-07-23 | V3-06 | ⛔ Bloqué (externe) | Bouton « Vérifier » cliquable et fonctionnel ; l'échec réel dépend de l'état CLI du bridge (session Claude expirée / quota Codex, cf. V2-01), pas d'un bug de code. En attente : décision d'ajouter un message d'erreur actionnable. | Distinguer un bug de code d'un état externe avant de « corriger ». |

## Vague 4 — retours dashboard/briefs (2026-07-24)

Retours utilisateur sur l'app live après la Vague 3. Thème : finir la refonte des
blocs dashboard (largeur, courbes réelles, trous blancs), le bloc entraînement, la
page budget, l'erreur IA, et sortir le bruit inutile des briefs. Planifié avec Opus
4.8, exécution par sous-agents (repli sur l'agent principal si la limite de dépense
mensuelle bloque, comme en Vague 3).

### Causes racines vérifiées (lecture code)

- **Trou blanc dans le camembert** : `DashboardViz.Donut` a un `gap = 5` entre segments
  mais plus de piste de fond (retirée en V2-02). En thème clair, le gap laisse voir le
  fond blanc de la carte. Correctif : réintroduire une piste `--surface-sunken`
  discrète derrière les arcs du `Donut` (le `Ring` en a déjà une).
- **Courbe finance plate** : le bloc utilise le `Sparkline` des snapshots (1 point).
  L'utilisateur veut la vraie courbe patrimoine de la page Finance (`history` →
  `FinanceMetricChart`). Il faut passer `history` finance au bloc dashboard.
- **Largeur des blocs** : `.dashboard-layout-grid` est déjà une grille 2 colonnes ;
  `wide: false` donne un demi-bloc, `wide: true` (`is-wide`) le plein. Les demi-largeurs
  demandées sont donc triviales ; le *choix* de largeur par l'utilisateur est un plus.
- **Bruit dans les briefs** : `vault.ts:3385` pousse littéralement
  « N inbox captures are still raw. Capture is working, digestion is lagging. » (+ ligne
  2466 hebdo). L'utilisateur ne veut pas de nag de triage.
- **Bloc « Budget mensuel » page budget** : `Finance.tsx:1186-1242` utilise un style
  `finance-kicker` propre, incohérent avec les autres cartes.
- **Quota IA déconnecte** : à confirmer — la vérification IA remet l'état à
  « non connecté » quand le quota est atteint ; l'utilisateur veut garder la connexion.

### Ordre d'exécution — rapide d'abord, modèle adapté

| Rang | ID | Mission | Difficulté | Priorité | Modèle |
| ---: | --- | --- | --- | --- | --- |
| 1 | V4-01 | Camembert : piste de fond, supprimer le trou blanc | XS | P0 | haiku |
| 2 | V4-02 | Briefs : retirer le nag « inbox captures raw / digestion lagging » | XS | P1 | haiku |
| 3 | V4-03 | Bloc Budget : demi-largeur, retirer la courbe | S | P1 | sonnet |
| 4 | V4-04 | Bloc Révisions : demi-largeur | XS | P1 | sonnet |
| 5 | V4-05 | Page Budget : bloc « Budget mensuel » cohérent avec les autres | M | P1 | opus + verify-ui |
| 6 | V4-06 | Vérif IA : message d'erreur actionnable + ne pas déconnecter au quota | M | P0 | opus |
| 7 | V4-07 | Bloc Finance plein largeur : donut à gauche, vraie courbe patrimoine à droite | M | P1 | opus + verify-ui |
| 8 | V4-08 | Bloc Entraînement : refonte semaine (prochaine séance du jour, % semaine, distance + temps total semaine, J avant objectif, sans trou blanc) | L | P1 | opus + verify-ui |
| 9 | V4-09 | Briefs : remplacer le triage par du contenu utile (actus/à apprendre) | L | P2 | opus |
| 10 | V4-10 | Choix de largeur du bloc par l'utilisateur (demi/plein) | M | P2 | opus + verify-ui |

### Détail

**V4-01 (P0).** Ajouter dans `Donut` un `<circle>` de piste `stroke:var(--surface-sunken)`
sous le groupe d'arcs (comme `Ring`). Critère : aucun fond blanc entre segments en thème
clair et sombre, à toutes les tailles.

**V4-02 (P1).** Retirer les lignes de nag (`vault.ts:3385`, `2466`) des briefs/hebdo.
Critère : plus aucune phrase de type « N captures still raw ».

**V4-03 (P1).** Bloc Budget : `wide:false` (demi-largeur), retirer le `Sparkline`.
Critère : demi-bloc propre, sans courbe, sans trou de grille.

**V4-04 (P1).** Bloc Révisions : `wide:false`. Critère : demi-bloc propre.

**V4-05 (P1).** Refondre l'en-tête « Budget mensuel » de la page Budget pour réutiliser
la grammaire des autres cartes (même en-tête, mêmes tokens), sans le style `finance-kicker`
divergent. verify-ui obligatoire.

**V4-06 (P0).** `verifyAiConnectionAction` : en cas d'erreur, renvoyer un motif lisible
(session expirée / quota atteint / bridge indisponible) affiché dans l'UI. Un échec pour
quota **ne doit pas** repasser `verified` à faux ni effacer la connexion configurée :
distinguer « non joignable / quota » de « non connecté ». Aucun assouplissement `SEC-02`.

**V4-07 (P1).** Passer `history` finance au bloc dashboard Finance ; en plein largeur,
disposer donut à gauche et `FinanceMetricChart`/courbe patrimoine réelle à droite. Retomber
proprement en une colonne en mobile. Critère : vraie courbe (pas plate), pas de trou blanc.

**V4-08 (P1).** Refonte du bloc Entraînement, vue semaine : % de complétion de la semaine,
prochaine séance du jour, distance et temps total cette semaine, jours restants avant
l'objectif. Anneau sans trou blanc moche. Critère : lisible d'un coup d'œil, données réelles
du plan/activités, verify-ui 390 + ≥ 1440.

**V4-09 (P2).** Remplacer le contenu de triage des briefs par du contenu à valeur (par ex.
actus du jour issues des flux RSS déjà ingérés, ou « à apprendre » depuis le vault), sans
demander de tri manuel à l'utilisateur.

**V4-10 (P2).** Contrôle de largeur (demi/plein) par bloc, persistant dans le layout v6,
réutilisant `is-wide`. Nice-to-have après le reste.

### Journal Vague 4

| Date | ID | Résultat | Vérification | Apprentissage |
| --- | --- | --- | --- | --- |
| 2026-07-24 | PLAN-V4 | ✅ Plan écrit | Causes racines lues dans le code (donut gap, nag briefs, largeur grille, budget page, courbe finance). Agents à tenter, repli agent principal. | La demi-largeur est déjà supportée par la grille ; ne pas sur-construire. |
| 2026-07-24 | V4-01 | ✅ Déployé | Piste de fond réintroduite dans `Donut` (agent haiku, diff relu). Rendu thème clair : anneau lisse, plus de trou blanc entre segments. | Le donut n'a besoin que d'une piste discrète (les gaps sont fins), l'anneau `Ring` en a besoin d'une visible (arc non rempli large). |
| 2026-07-24 | V4-02 | ✅ Déployé | Nag « inbox captures raw / digestion lagging » retiré du brief. Variables orphelines nettoyées (lint). | — |
| 2026-07-24 | V4-03/V4-04 | ✅ Déployé | Budget et Révisions en `wide:false` (demi-largeur), sparkline budget retiré. `grid-auto-flow:row dense` ajouté pour appairer les deux demi-blocs sans trou. Rendu 1440 : Budget \| Révisions sur une ligne, aucun trou. | HMR CSS Turbopack peu fiable : effacer `.next/dev .next/cache` pour qu'une règle CSS prenne. |
| 2026-07-24 | V4-06 | ✅ Déployé | Agent sonnet (code relu) : `verifyAiConnectionAction` ne dé-vérifie plus une connexion déjà vérifiée en cas d'échec (quota/expiré) ; `memo-bridge.py /verify` classe l'échec (quota/auth/unreachable) via une sonde plus verrouillée que l'exécution normale (SEC-02 intact) ; carte « stale » + message actionnable. 217 tests, py_compile OK. | Séparer « dernière vérif échouée » de « déconnecté » ; la sonde de vérif est plus restreinte que les chemins brief/chat, pas moins. |
| 2026-07-24 | V4-07 | ✅ Déployé | Agent sonnet (code relu + rendu) : bloc Finance plein largeur = donut à gauche, vraie courbe patrimoine (`FinanceMetricChart`, `getFinanceHistory`) à droite. Rendu 1440 + 390 : courbe réelle rendue (client Recharts dans le dashboard serveur, aucun crash), empile en mobile, aucun débordement. | Un composant client (Recharts) passe bien en prop `content` du serveur vers `DashboardLayout` client ; vérifier au rendu car ça compile même si ça casserait au runtime. |
| 2026-07-24 | V4-08 | ✅ Déployé | Agent sonnet (code relu) : bloc Entraînement = résumé semaine réel (via `computeTrailStats` gardé par `hasTrainingPlan`), stats distance+temps+J-objectif, piste `Ring` `surface-sunken`→`line-strong` (anneau lisible sans arc cassé). 218 tests. Vérifié sans crash en fallback (pas de plan) ; le rendu avec plan réel reste à confirmer sur le vault utilisateur. | L'anneau et le donut ont des besoins de piste différents ; le rendu avec données de plan n'a pas pu être seedé en scratch. |
| 2026-07-24 | V4-05 | ✅ Déployé | Agent sonnet (code relu + rendu) : en-tête « Budget mensuel » repassé sur la coquille partagée `.finance-budget-chart-card` + `.finance-budget-chart-head`, cohérent avec les cartes sœurs. Rendu page budget après onboarding : même grammaire, montant toujours mis en avant sans slab divergent. | — |
| 2026-07-24 | V4-10 | ✅ Déployé | Agent sonnet (code relu + rendu) : sélecteur de largeur demi/plein par bloc, override `widths` dans l'état v6 (sanitisé + migration), bouton dans les contrôles d'édition. Vérifié : clic « Réduire Patrimoine » → 1060→522 px, `is-wide` retiré, persisté en localStorage. 219 tests. | — |
| 2026-07-24 | V4-09 | ✅ Déployé | Agent sonnet (code relu + test) : nag de triage « Trier N captures » retiré du brief, section « À découvrir » ajoutée (captures RSS récentes, titre + source) quand elles existent. 220 tests (test dédié : triage absent, section présente). | Les 2264 captures « raw » sont les items RSS ; les montrer comme découverte au lieu de nager le tri. Version brief IA (bridge) = suivi possible. |
| 2026-07-24 | LOT-V4 | ✅ 10/10 déployé | Deux poussées (`9bd1a8c` : V4-01..08+05 ; `6317d45` : V4-09+10). typecheck, lint, 220/220 tests, py_compile ; les deux tenants sains ; snapshot de prod réparé après corruption scratch. | 4 agents sonnet + 1 haiku, tous relus. Reste hors périmètre : rendu du bloc entraînement avec plan réel (vault utilisateur), et version IA du brief « À découvrir ». |

## Vague 5 — dashboard type widgets iOS/Tahoe (2026-07-24)

Retours utilisateur + images de référence (widgets iOS/macOS Tahoe : carte crypto,
courbe patrimoine, anneau data-usage, cartes balance/performance/bank, widget streak).
Objectif : refonte du dashboard en widgets qui (a) se déplacent aussi facilement
qu'iOS, (b) changent de contenu et de complétude selon leur largeur (demi = compact,
plein = riche), inspirés au maximum des images. Plus deux bugs concrets.

### Causes racines vérifiées (lecture code)

- **Thème + langue non conservés entre sessions** : le thème vit uniquement en
  `localStorage` (`second-brain:theme`, `ThemePicker`/init script `layout.tsx`) et la
  langue en cookie posé côté client (`LOCALE_COOKIE`, `LanguageProvider`). iOS/Safari
  ITP efface localStorage et plafonne les cookies client à ~7 j → réglages perdus.
  `getLocale` (`i18n-server.ts`) ne lit que le cookie, sans repli sur `setup.locale`
  (qui existe déjà, côté serveur, dans le vault). Aucun champ `theme` dans le setup.
- **Séparation courbe/camembert du bloc Finance** : la grille `.dashboard-module-finance`
  (V4-07) met un `gap` visible entre donut et courbe ; l'utilisateur n'en veut pas et
  veut un **demi-bloc** avec un **switch camembert↔courbe** au lieu des deux côte à côte.
- **Largeur/contenu** : les blocs ont `wide` (plein) ou demi (V4-10), mais le CONTENU
  est identique quelle que soit la largeur. iOS rend un contenu différent par taille.

### Missions

| Rang | ID | Mission | Difficulté | Priorité | Modèle |
| ---: | --- | --- | --- | --- | --- |
| 1 | V5-01 | Persister thème + langue côté serveur (setup state), appliqués au SSR ; repli `getLocale` sur `setup.locale` ; survivent à ITP/sessions | M | P0 | sonnet |
| 2 | V5-02 | Bloc Finance : demi-largeur, switch camembert↔courbe interne, sans séparation | M | P1 | sonnet + verify-ui |
| 3 | V5-03 | Système de widget responsive : chaque widget rend un contenu compact (demi) vs riche (plein) — variantes « small/large » à la iOS | L | P1 | opus + design skill + verify-ui |
| 4 | V5-04 | Drag & drop fluide type iOS (pointeur + animation), remplace le HTML5 drag actuel | M | P1 | opus + verify-ui |
| 5 | V5-05 | Refonte de tous les widgets dashboard dans le nouveau système, inspirée des images de référence | XL | P1 | opus + design skill + verify-ui |

### Détail

**V5-01 (P0).** Ajouter `theme` à `SetupState`, sauver thème+langue via server action dans
le setup (vault). SSR : poser `data-theme` sur `<html>` depuis `setup.theme` (avant le
script client), et poser le cookie langue **côté serveur** (Set-Cookie, non plafonné ITP).
`getLocale` : cookie sinon `setup.locale`. localStorage reste un cache client rapide.
Critère : thème+langue choisis survivent à un vidage du storage client / nouvelle session.

**V5-02 (P1).** Bloc Finance en `wide:false` (demi). Un switch segmenté interne
« Camembert / Courbe » bascule entre `Donut` et `FinanceMetricChart` dans le même cadre,
sans grille 2-colonnes ni séparateur. En plein largeur (si l'utilisateur l'agrandit via
V4-10) : afficher les deux + stats (contenu riche). Critère : demi-bloc propre, switch
fluide, zéro séparation, pas de courbe plate.

**V5-03 (P1, L).** Introduire une notion de taille de rendu par widget (`half` | `full`)
passée au contenu, et faire que chaque widget module rende un layout compact en demi et
un layout riche/complet en plein (métrique + viz + tendance + secondaires + phrase),
comme les tailles de widget iOS. Cadrer d'abord une maquette (design skill).

**V5-04 (P1).** Remplacer le drag HTML5 de `DashboardLayout` par un drag pointeur fluide
(déplacement suivi, animation de réordonnancement, retour haptique visuel), proche d'iOS.
Conserver clavier + accessibilité. verify-ui obligatoire.

**V5-05 (P1, XL).** Redessiner chaque widget (accueil, finance, budget, business,
entraînement, révisions, objectif, tâches) dans le nouveau système, en s'inspirant des
images de référence (cartes contrastées, courbes pleine largeur, anneaux, streak). Par
phases, un lot de widgets à la fois, verify-ui à chaque lot.

### Journal Vague 5

| Date | ID | Résultat | Vérification | Apprentissage |
| --- | --- | --- | --- | --- |
| 2026-07-24 | PLAN-V5 | ✅ Plan écrit | Bug thème/langue = storage client effacé par ITP ; correctif = persistance serveur. Le gros du travail (V5-03/04/05) = refonte widget responsive + drag iOS, par phases. | Ne pas one-shot une refonte de dashboard entière : phaser, cadrer le design, vérifier chaque lot. |
