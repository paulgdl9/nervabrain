# Collecte quotidienne des conversations IA

Chaque soir, collecte les conversations ChatGPT et Codex mises à jour depuis
00:00 aujourd'hui dans le fuseau Europe/Zurich, à partir de l'historique auquel
l'application a réellement accès.

Pour chaque conversation pertinente, lis les échanges du jour et conserve
seulement :

- les demandes formulées par l'utilisateur ;
- les décisions et arbitrages ;
- les engagements, blocages et questions encore ouvertes ;
- les apprentissages réutilisables et les signaux produit explicites.

Ignore les petites questions factuelles sans conséquence, le bavardage, les
réponses techniques intermédiaires et les sorties d'outils. Une demande n'est
pas une preuve que le travail a été réalisé.

Écris ou mets à jour un seul fichier :
`vault/02-Raw/YYYY-MM-DD-conversations-ia.md`. Utilise le YAML simple du vault
avec `type: raw`, la date du jour, `source: chat-history` et les tags
`[ai, conversations, daily]`. Place d'abord une synthèse des informations
importantes, puis un journal groupé par conversation. Ne duplique pas un échange
déjà présent dans le fichier.

Avant de mentionner une action existante, relis son fichier dans `05-Tasks`.
N'ouvre, ne rouvre et ne propose jamais une tâche dont le statut est `done` ou
`abandoned`. Ne crée aucune tâche automatiquement.

Après la collecte, mets à jour le Daily du jour selon
`vault/09-Skills/synthesize-daily/SKILL.md`, en préservant les modifications
manuelles. Si aucune conversation n'apporte de signal utile, n'ajoute aucun
bruit et indique simplement qu'aucun signal significatif n'a été trouvé.

Ne prétends pas lire Claude si son historique n'est pas accessible. Ne commit,
ne push et ne déploie rien.
