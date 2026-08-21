# Déploiement Linux

Le quickstart Docker ne configure ni systemd ni exposition publique. Les
services utilisateur ne s'installent que sur commande explicite.

## Prérequis

- Linux avec systemd utilisateur, Docker Compose v2, `curl` et `flock` ;
- un clone appartenant à l'utilisateur qui exécutera les services ;
- un `.env` en `600` avec des valeurs robustes pour `CAPTURE_TOKEN`,
  `DASHBOARD_PASSWORD`, `SESSION_SECRET` et `MEMO_TOKEN` ;
- aucun runtime IA sur l'hôte : Claude Code et Codex sont dans l'image
  `second-brain-ai-shared` et leurs sessions restent dans le volume du profil ;
- sudo sans mot de passe pour l'opérateur : le déploiement valide chaque racine
  et lance Compose sous le propriétaire de chaque tenant via `sudo -n`.

## Profils isolés

`data/tenants.conf` liste les profils déployés. Le fichier est ignoré par Git
et ne contient aucun secret :

```text
client-a|/srv/second-brain/client-a
client-b|/srv/second-brain/client-b
```

Copiez `deploy/tenants.conf.example`, puis adaptez projets et chemins. Chaque
racine a son `.env` en `600`, son `vault/` et son `data/`. Le déploiement
construit les trois images partagées une fois, puis lance un trio
`second-brain` + `ai-bridge` + `garmin-sync` par client. Les sessions CLI
restent dans `data/ai-home`, les tokens Garmin dans `data/garmin` ; rien ne
traverse les profils.

Le choix des modules dans le setup ne change pas la topologie Docker : il
active des fonctions dans le vault du client. Pas de conteneur inutile, et un
changement d'abonnement ne demande aucune migration de données.

## Installation

Depuis la racine du clone :

```bash
chmod 600 .env
./scripts/deploy-install.sh check
./scripts/deploy-install.sh install
```

L'installateur remplace les placeholders `@PROJECT_ROOT@` des unités par le
chemin absolu du clone, les copie dans
`${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user`, puis active la pile Docker et
l'unique timer hôte. Ce timer ne prend qu'un fast-forward propre de
`origin/main`, reconstruit les images partagées et redéploie tous les tenants
du registre. La fréquence des briefs se règle par profil dans l'application.

Pour garder les timers après déconnexion :

```bash
sudo loginctl enable-linger "$USER"
```

## Exploitation

```bash
./scripts/deploy-install.sh status
systemctl --user list-timers 'second-brain-*'
journalctl --user -u second-brain-code-update.service -f
docker compose logs -f second-brain ai-bridge
```

La désinstallation retire seulement les unités et conserve le vault, `.env` et
les volumes Docker :

```bash
./scripts/deploy-install.sh uninstall
```

## Exposition réseau

Le dashboard écoute sur `127.0.0.1` par défaut. Ne publiez pas le port 3000
directement : passez par un proxy HTTPS ou le profil Cloudflare Tunnel, gardez
l'authentification du dashboard, et limitez `MCP_ALLOWED_ORIGINS` aux origines
nécessaires.
