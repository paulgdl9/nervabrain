# Configuration pas à pas

Guide d'installation d'une instance personnelle. Pour un serveur, enchaînez
avec [DEPLOYMENT.md](DEPLOYMENT.md).

## 1. Démarrer une instance locale

```bash
git clone <repository-url> second-brain
cd second-brain
./scripts/init-env.sh
docker compose up -d --build
```

Ouvrez `http://127.0.0.1:3000/setup` et connectez-vous avec le mot de passe
affiché par le script. Le wizard enchaîne : langue et fuseau, connexion IA
facultative, contexte guidé, modules optionnels, objectifs de vie, flux RSS,
revue finale. Aucun email n'est demandé.

Pour essayer sans données personnelles :

```bash
npm run dev:empty
```

## 2. Ouvrir le vault dans Obsidian

1. Installez Obsidian Desktop.
2. **Open folder as vault**, puis sélectionnez le dossier `vault/` du clone (ou
   sa copie synchronisée).
3. Facultatif : activez le plugin Local REST API with MCP et gardez son serveur
   sur `127.0.0.1`. Son port ne doit jamais être exposé au LAN ni à Internet.
   Détails dans [OBSIDIAN_MCP.md](OBSIDIAN_MCP.md).

## 3. Connecter Claude ou ChatGPT/Codex

Étape facultative : chaque fonction IA a un repli local déterministe.

Dans l'étape **IA** du wizard, choisissez pour chaque moteur soit une clé API
(écrite dans `data/ai-credentials.env` en `0600`), soit une connexion CLI :

```bash
docker compose up -d --build ai-bridge
docker compose exec ai-bridge claude auth login
docker compose exec ai-bridge codex login --device-auth
```

Revenez ensuite dans `/setup` et cliquez sur **Vérifier la connexion**. Un seul
moteur vérifié devient principal ; avec deux, vous choisissez le principal et
l'autre sert de fallback.

Après une mise à jour du bridge, le smoke de sécurité contrôle chaque moteur
avec des canaris source/JSON aléatoires :

```bash
docker compose exec ai-bridge python3 /bridge/check-ai-bridge-security.py --engine claude
docker compose exec ai-bridge python3 /bridge/check-ai-bridge-security.py --engine codex
```

### Ce que le bridge peut faire

Le conteneur `ai-bridge` monte le vault du profil **en lecture seule** sur
`/vault` et ne monte jamais le code Next.js. Les moteurs travaillent depuis
`/vault` avec `--tools Read,Glob,Grep` (Codex ajoute son sandbox lecture
seule) : ils lisent au-delà des extraits fournis par l'application, mais
n'écrivent jamais. Toute modification passe par les chemins d'écriture typés de
l'application, derrière votre validation.

Les sessions CLI restent dans `data/ai-home`, propre à chaque profil, et ne
doivent jamais être copiées dans le dépôt ni dans l'image Docker. Le fichier de
clés est ignoré par Git et n'est plus affiché après sa saisie.

Si vous personnalisez `AI_CREDENTIALS_FILE` avec Docker, utilisez un chemin
relatif comme `private/ai.env` : l'application et le bridge le résolvent tous
les deux dans le volume `data/`. Un chemin absolu ne convient que si les deux
processus voient exactement le même espace de fichiers.

## 4. Synchroniser plusieurs appareils

```bash
docker compose --profile sync up -d syncthing
```

L'interface écoute sur `127.0.0.1:8384`. Appairez vos appareils depuis
Syncthing et ne partagez que le vault : ni `.env`, ni `data/`, ni les sessions
des CLI IA.

## 5. Passer en exploitation

Suivez [DEPLOYMENT.md](DEPLOYMENT.md). Avant toute exposition publique,
terminez le HTTPS en amont, gardez le port applicatif privé, et vérifiez :

```bash
npm run public:check
npm run typecheck
npm test
npm run build
docker compose config --quiet
```
