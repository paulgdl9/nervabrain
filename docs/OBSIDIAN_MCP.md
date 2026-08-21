# Obsidian Local REST API et MCP

Configuration facultative : brancher Claude Code sur le vault via le plugin
Obsidian **Local REST API with MCP** (coddingtonbear, v4.1.3). Ce plugin expose
lui-même un serveur MCP Streamable HTTP ; n'installez pas le paquet tiers
homonyme `mcp-obsidian`.

Le MCP intégré à Nerva Brain est une surface différente : ses outils ne lisent
et n'écrivent que des notes Markdown du vault, les gardes de chemin refusant
les autres extensions et les chemins cachés. Cette limite ne restreint pas les
permissions propres du client (Claude Code, Codex ou autre) : ce client décide
séparément des fichiers, shells et MCP auxquels il accède, et doit donc être
restreint dans sa propre configuration.

## Prérequis

Activez le plugin dans Obsidian et récupérez la clé dans **Settings > Local
REST API**. Le serveur appartient au processus Obsidian : l'endpoint n'est
actif que si **Obsidian Desktop** est ouvert sur ce vault, pendant les
contrôles comme pendant l'usage.

Exportez la clé uniquement dans le shell qui lancera Claude Code, sans la faire
apparaître dans l'historique :

```bash
read -r -s -p 'Obsidian API key: ' OBSIDIAN_API_KEY
printf '\n'
export OBSIDIAN_API_KEY
export OBSIDIAN_HOST='127.0.0.1'
export OBSIDIAN_PORT='27124'
```

Les scripts ne l'affichent jamais et ne l'écrivent dans aucun fichier. Ils ne
lisent pas non plus la clé stockée dans la configuration privée du plugin :
sur une autre machine, `OBSIDIAN_API_KEY` doit être exportée ou injectée par un
gestionnaire de secrets.

## Choisir HTTP ou HTTPS

Le port 27123 sélectionne `http`, tout autre port `https`.
`OBSIDIAN_SCHEME=http|https` force le schéma.

- **HTTPS (27124, par défaut)** : le certificat du plugin est auto-signé. Le
  contrôle REST l'accepte sur une adresse de bouclage, mais Claude Code doit
  lui faire confiance. Téléchargez-le depuis
  `https://127.0.0.1:27124/obsidian-local-rest-api.crt` et ajoutez-le au
  magasin de confiance du système.
- **HTTP (27123)** : activez **Enable HTTP server** dans Obsidian, gardez le
  binding `127.0.0.1` et n'exposez jamais ce port au réseau.

## Provisionner Claude Code

Depuis la racine du dépôt :

```bash
./scripts/obsidian-mcp-configure.sh
./scripts/check-obsidian-mcp.sh
```

Le provisioning est idempotent et utilise le MCP natif :

```text
claude mcp add --transport http ... --header 'Authorization: Bearer ${OBSIDIAN_API_KEY}'
```

La configuration Claude contient le placeholder littéral
`${OBSIDIAN_API_KEY}`, jamais la valeur : la variable doit donc être présente
avant chaque lancement de `claude`, et les quotes simples autour de l'en-tête
sont indispensables pour empêcher son expansion pendant le provisioning.

Le scope par défaut est `user` (`local`, `project` et `user` sont acceptés) :

```bash
OBSIDIAN_MCP_SCOPE=local ./scripts/obsidian-mcp-configure.sh
OBSIDIAN_MCP_NAME=obsidian ./scripts/check-obsidian-mcp.sh
```

## Diagnostic

Le contrôle REST fonctionne sans Claude Code et distingue un plugin arrêté,
une mauvaise clé et un problème MCP :

```bash
./scripts/obsidian-api-check.sh
```

Il teste l'endpoint public, puis `/vault/` avec authentification, sans afficher
le corps de réponse ; la clé arrive à `curl` par l'entrée standard, jamais dans
ses arguments ni dans un fichier temporaire.

| Code de sortie | Signification |
| --- | --- |
| `0` | contrôle complet réussi |
| `1` | configuration ou connexion en erreur |
| `2` | endpoint joignable ou provisioning fait, mais clé absente |

Variables optionnelles : `OBSIDIAN_CA_CERT`, `OBSIDIAN_TLS_VERIFY`,
`OBSIDIAN_CONNECT_TIMEOUT_SECONDS`, `OBSIDIAN_REQUEST_TIMEOUT_SECONDS`,
`OBSIDIAN_MCP_TIMEOUT_MS`.

Sources : [plugin coddingtonbear](https://github.com/coddingtonbear/obsidian-local-rest-api),
[documentation MCP de Claude Code](https://code.claude.com/docs/en/mcp).
