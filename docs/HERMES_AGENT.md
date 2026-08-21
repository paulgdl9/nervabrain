# Connecter Hermes Agent

Hermes Agent permet d'utiliser Nerva Brain depuis Telegram, Discord ou un
autre canal sans remplacer l'assistant intégré. Hermes se connecte uniquement
au MCP OAuth de Nerva Brain ; il n'a besoin d'aucun montage du vault, du code
ou du conteneur `ai-bridge`.

## Prérequis

- Une instance Nerva Brain accessible en HTTPS avec
  `NEXT_PUBLIC_MCP_BASE_URL` réglé sur son URL publique.
- Un `CAPTURE_TOKEN` robuste. Il sera saisi dans la page d'autorisation Nerva
  Brain, jamais dans la configuration Hermes.
- Une instance Hermes dédiée à cet utilisateur ou profil.

## Connexion en lecture seule

Ajoutez ceci dans `~/.hermes/config.yaml`, en remplaçant le domaine :

```yaml
mcp_servers:
  nerva_brain:
    url: "https://brain.example.com/api/mcp"
    auth: oauth
    oauth:
      scope: "read"
```

Lancez ensuite la connexion depuis un nouveau terminal :

```bash
hermes mcp login nerva_brain
```

Ouvrez l'URL affichée, saisissez le `CAPTURE_TOKEN` dans la page Nerva Brain,
puis autorisez l'accès. Hermes conserve ses jetons OAuth dans
`~/.hermes/mcp-tokens/` avec des permissions restreintes.

Vérifiez la connexion avant de lancer l'agent :

```bash
hermes mcp test nerva_brain
```

Le test doit annoncer **8 outils de lecture**. L'intégration reste en bêta :
[une issue Hermes ouverte](https://github.com/NousResearch/hermes-agent/issues/39551)
signale que certaines versions voient les outils avec `mcp test` sans les
exposer ensuite dans l'agent ou la gateway. Mettez Hermes à jour et validez le
test conversationnel en CLI avant de configurer une gateway.

Testez d'abord dans le terminal Hermes :

```bash
hermes
```

Demandez par exemple : « Avec Nerva Brain, liste mes tâches en cours. » En
lecture seule, les outils de création et de modification ne sont pas exposés.

## Conversations séparées

L'historique de l'assistant intégré reste dans Nerva Brain et sa barre
latérale affiche uniquement ces conversations. Hermes conserve séparément ses
sessions Telegram, Discord et CLI dans `~/.hermes/state.db`. Aucune conversation
Hermes n'est copiée dans l'historique de l'assistant intégré, et inversement.

## Telegram ou Discord

Configurez les canaux avec l'assistant Hermes :

```bash
hermes gateway setup
hermes gateway install
hermes gateway start
hermes gateway status
```

Commencez par Telegram pour un usage personnel, ou choisissez Discord pour les
messages privés et les salons. Dans les deux cas, renseignez le jeton du bot et
une liste stricte d'identifiants autorisés dans l'assistant ; n'activez pas
l'accès public. Une même gateway peut ensuite faire fonctionner plusieurs
canaux.

## Hermes installé sur un VPS

Exécutez `hermes mcp login nerva_brain` dans un terminal interactif sur le VPS.
Ouvrez localement l'URL d'autorisation affichée. Après validation, la redirection
vers `localhost` peut afficher une erreur : c'est attendu. Copiez l'URL finale
complète et collez-la à l'invite `Or paste the redirect URL here…` du terminal
sur le VPS. La chaîne `?code=…&state=…` seule est également acceptée.

## Autoriser les écritures

Ne passez en écriture qu'après validation du fonctionnement en lecture seule.
Remplacez alors la portée dans `~/.hermes/config.yaml` :

```yaml
    oauth:
      scope: "read write"
```

Puis relancez `hermes mcp login nerva_brain` et vérifiez que la page de
consentement demande bien `read write`. Cette portée permet notamment à Hermes
de créer des captures, des tâches et des notes ; gardez les confirmations
d'actions dangereuses de Hermes actives.

## Sécurité

- Une instance Hermes par utilisateur ou profil : ses utilisateurs autorisés
  partagent les mêmes capacités.
- Limitez Telegram et Discord par allowlist ; n'utilisez pas
  `GATEWAY_ALLOW_ALL_USERS=true`.
- N'exposez à Hermes ni le vault, ni le dépôt, ni Docker. Le MCP Nerva Brain est
  la seule frontière nécessaire.
- Supprimer la connexion côté Hermes efface seulement ses jetons locaux : cela
  ne les révoque pas côté Nerva Brain. Nerva Brain ne propose pas encore de
  révocation fine ; un jeton d'accès expire après 1 heure et un jeton de
  renouvellement après 30 jours.
- Ne partagez jamais les fichiers de `~/.hermes/mcp-tokens/`.

Références : [MCP dans Hermes](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/user-guide/features/mcp.md) et [gateway de messagerie](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/user-guide/messaging/index.md).
