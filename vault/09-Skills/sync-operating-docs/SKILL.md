---
name: sync-operating-docs
description: "Audit the repository's operator documentation (CLAUDE.md, README.md, docs/, the 00-System operating notes, and skill files' operational claims) against the code, Compose files, and scripts as they exist now, then apply targeted in-place corrections for every stale claim, with a ledger of what changed and the evidence. Use after a feature lands, when many commits have accumulated since the docs were touched, or when the user asks to audit or update the documentation."
---

# Sync Operating Docs

## Goal

Keep the documents that steer agents and operators truthful. The repository
contract's rule is that when a document and the code disagree, the code wins
and the document gets fixed (failure mode 21, the stale-manual trust). This
skill is the fixing half: find every checkable claim, verify it against the
repository as it exists today, correct the stale ones in place, and leave a
ledger. Documentation drift here is expensive because the manuals are loaded
by every agent run and by the AI bridge automations.

## Scope

In scope, in this order:

1. `CLAUDE.md` — the operating contract.
2. `README.md` and `docs/*.md`.
3. `vault/00-System/Knowledge-Operations.md` and
   `vault/00-System/Agent-Operating-Guardrails.md` (operating notes, not
   personal content).
4. Operational claims inside `vault/09-Skills/*/SKILL.md` (schedule times,
   paths, tool names, command lines) — not their editorial substance.
5. Project-level `CLAUDE.md` files only when the user names the project.

Never in scope, whatever the request wording: `Context.md` (refresh-context
skill only), `Context.imported.md` (never), the user's journal, captures,
briefs, reviews, and any note carrying personal content. This skill updates
documentation about the system, not the user's knowledge.

## Load context

1. Read the repository contract in full.
2. For each in-scope document, record its last-touch baseline:
   `git log -1 --format='%h %ad' --date=short -- <file>`.
3. Measure the drift window since the oldest relevant baseline:
   `git log --oneline <baseline>..HEAD` and `git diff --stat <baseline>..HEAD`
   show which subsystems moved while the document stood still.
4. Run `git status` first and preserve concurrent edits; the vault is edited
   live by Obsidian, Syncthing, and the schedulers.

## Extract and verify claims

Go document by document. A **claim** is anything checkable: a command line, an
npm script name, a path, a port, a service or container name, a folder list, a
schedule or frequency, an env variable, an endpoint list, a count ("carries
several `.bak` files", "~4k lines"), or a statement about behavior ("the
bridge falls back", "the timer only fast-forwards").

Verify each claim against the primary source, not against another document:

- Commands and scripts → `package.json`, the script file itself.
- Ports, services, volumes, healthchecks → `docker-compose.yml`,
  `.env.example`.
- Vault structure → `ls vault/` and the folder map in `src/lib/vault.ts`.
- Schedules → `src/instrumentation.ts`, `src/lib/brief-schedule.ts`, Compose
  service definitions, `deploy/systemd/`.
- Endpoints → the route files under `src/app/api/` and
  `bridge/memo-bridge.py`.
- Skill inventory → the actual directories under `vault/09-Skills/`.

Classify every claim: **confirmed**, **stale** (with the evidence and the
correct current fact), or **unverifiable** (say why). Never "fix" a claim you
could not verify; report it instead.

## Apply corrections

- Edit in place, minimally: change the stale fact, keep the sentence,
  paragraph structure, and voice around it. A drifted number does not license
  a rewrite of the section. Full-document rewrites happen only when the user
  asked for one.
- Preserve each document's language: French operator docs stay French, the
  contract and skills stay English.
- On vault notes, set the `updated:` frontmatter date and confirm the
  frontmatter still parses as simple YAML (scalars, inline arrays, block
  arrays) after the edit.
- When a document references another document, verify the link target exists;
  when two documents contradict each other, the code decides which is right —
  if the code decides neither, surface both to the user instead of picking.
- New reality that no document records (a new folder, a new automation, a new
  failure mode observed in git history) is added to the document whose scope
  owns it — the contract for agent rules, README for users, `docs/` for
  operators — as a proposal in the report when the addition is substantial,
  directly when it is a line.
- Never delete a document, and never move personal facts into a generic
  document: the contract cites `Context.md`, it does not copy it.

## Wrap up

1. Every changed link resolves; `npm run vault:lint` is clean when vault notes
   were touched.
2. `git status` shows only the intended documents.
3. If skill files changed operationally, confirm the skill list in
   `Knowledge-Operations.md` still matches the `vault/09-Skills/` directory
   listing exactly.

## Report

End with a ledger, one row per correction: document → claim → what it said →
what it says now → the evidence file that decided it. Then three short lists:
claims confirmed (count is enough), claims left unverifiable and why, and
proposed additions awaiting the user's decision. When nothing drifted, say
exactly that with the baseline dates checked — a clean audit is a valid
result.
