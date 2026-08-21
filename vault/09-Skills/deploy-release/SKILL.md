---
name: deploy-release
description: "The only sanctioned path to ship this repository to production: preflight the quality bar, push or run the deploy script, then verify container health, app health, and every tenant in the registry, with a rollback plan. Use exclusively when the user explicitly asks to push, deploy, ship, or restart production in the current run — never as the automatic tail of finishing a feature."
---

# Deploy Release

## Authorization gate

Run this skill only when the user asked, in the current run, to push, deploy,
or restart production. A finished, verified feature is **not** authorization
(repository failure modes 12 and 20): in this repository a push to
`origin/main` is itself a deployment, because the code-update timer
fast-forwards main and redeploys every configured profile. If this skill is
reached without that explicit request, stop and report "ready to deploy"
with the revision hash instead.

Two profiles can share this machine and its images. A deploy therefore ships
to **all** of them; say so in the report.

## Load context

1. Read the repository contract (`CLAUDE.md`), especially "One codebase,
   several profiles" and the deployment quality bar.
2. Read `docs/DEPLOYMENT.md` for the operator view of the installer and
   timer.
3. Run `git status`, `git log --oneline -5`, and `git branch --show-current`.
4. Run `docker compose ps` to record the pre-deploy state of `second-brain`,
   `ai-bridge`, and `garmin-sync`.

## Preflight — every box, before anything ships

- Working tree contains only the intended change; concurrent vault edits are
  preserved, not staged.
- Current branch is `main` (the timer only deploys a clean fast-forward of
  `origin/main`).
- `npm run typecheck`, `npm run test`, and `npm run lint` pass now, in this
  run — not remembered from earlier.
- For UI changes: the `verify-ui` skill ran and its evidence exists.
- For vault-touching changes: `npm run vault:lint` is clean.
- The commit message is one imperative English sentence about the outcome;
  nothing from `.env`, `data/`, logs, or scratch files is staged.
- Secrets stay out of the transcript: never print `.env`,
  `data/ai-credentials.env`, `data/oauth-state.json`, `data/garmin/`, or
  `data/ai-home/` contents. The deploy scripts already `unset CAPTURE_TOKEN`;
  keep it that way.

## Ship — two sanctioned paths

**Path A — push and let the timer deploy (default).**

1. `git push origin main`.
2. The `second-brain-code-update.timer` picks up the revision on its next
   tick, runs `scripts/deploy-on-main.sh`, builds the shared images, and
   restarts the profiles. Watch it:
   `journalctl --user -u second-brain-code-update.service -f` (or `--since`
   for a bounded read).
3. Deployment is complete when `data/deployed-main` contains the pushed
   revision hash.

**Path B — immediate deploy (user asked for "now").**

1. Push first if the change must also reach `origin/main` (it should; a
   deployed revision that origin lacks will block the next timer run's
   fast-forward check).
2. Run `./scripts/deploy-second-brain.sh start`. This validates the tenant
   registry (`data/tenants.conf`), builds the three shared images once, then
   deploys and health-checks an isolated `second-brain`/`ai-bridge`/
   `garmin-sync` trio for every tenant, running Compose as each root's owner
   through passwordless sudo. `validate`, `health`, and `status` exist as
   read-only subcommands.

Do not improvise a third path: no raw `docker compose build`/`up` sequences,
no editing units under `deploy/systemd/`, no `systemctl` mutations, unless
the user explicitly directs that exact command. On this hardware image builds
are slow; raise timeouts before concluding a hang.

## Verify — the deploy is done only when measured

1. `docker compose ps`: `second-brain`, `ai-bridge`, and `garmin-sync` all
   `Up` and `healthy`. The bridge healthcheck runs **inside** the Compose
   network; do not curl `127.0.0.1:8089` on the host and conclude the bridge
   is down (failure mode 19). If a container is unhealthy, read
   `docker compose logs --since 10m <service>` before touching anything.
2. App health on this profile's port:
   `curl -sf http://127.0.0.1:${SECOND_BRAIN_PORT:-3000}/api/health` must
   report ok.
3. Bridge through the app: the same `/api/health` (and `docker compose ps`
   health state) is the source of truth for bridge reachability.
4. Other tenants in `data/tenants.conf`: verify **only** through
   `./scripts/deploy-second-brain.sh health` (in-container checks) or each
   tenant's public health endpoint on its own port. Never open, list, or read
   another tenant's files, `.env`, or vault — health is the entire permitted
   surface.
5. When the instance is publicly exposed (tunnel or Cloudflare Access) and the
   run has network access, fetch the public URL once and confirm the app
   answers behind the gate. If the run cannot reach it, report that check as
   not performed rather than assumed.
6. Scan `docker compose logs --since 5m second-brain ai-bridge` for new
   errors.

## Rollback

If verification fails and the cause is the shipped change:

1. `git revert <bad-commit>` on `main` — never `git reset --hard`, never a
   force push: the timer requires clean fast-forwards and every tenant shares
   this history.
2. Redeploy through the same path used to ship (push + timer, or
   `deploy-second-brain.sh start`).
3. Re-run the verification list above.
4. Report both revisions and the observed failure verbatim; do not retry the
   bad revision "to see if it passes this time".

If the cause is not the change (disk, network, external outage), report the
evidence and stop; infrastructure repair is its own explicitly requested task.

## Report

End with a ledger the user can audit:

- Revision before → revision after (hashes), and which path shipped it.
- Images rebuilt, and the list of registry tenants deployed and health-checked.
- Each verification step with its actual result, including the checks not
  performed and why.
- Any anomaly in the logs, quoted exactly.
- The rollback command that undoes this deploy, ready to paste.
