---
name: vault-doctor
description: "Run a traceable maintenance pass over the Obsidian vault: lint findings, placeholder tasks, duplicate Wiki notes, ambiguous wikilinks, sync-conflict files, missing frontmatter fields, and the memory-maintenance proposals accumulated by weekly reviews. Use when the user asks to clean, repair, dedupe, or lint the vault, or to apply weekly maintenance proposals. Never deletes without an archive step; destructive fixes require explicit approval."
---

# Vault Doctor

## Goal

Turn accumulated vault entropy (lint warnings, `nouvelle-tache` placeholders,
duplicate ingested articles, ambiguous links, stale statuses) into either a
safe applied fix or a precise proposal, in one run, with a ledger the user can
audit. The weekly review is allowed to propose maintenance but never to apply
it; this skill is the applying half, with the safety gates that makes that
acceptable.

## Load context

1. Read the [repository contract](../../../CLAUDE.md), especially source
   preservation and the escalation rules.
2. Read [Agent Operating Guardrails](../../00-System/Agent-Operating-Guardrails.md).
3. Run `npm run vault:lint` from the repository root and capture the output.
4. Read the most recent note in `../../07-Weekly/` and extract its
   memory-maintenance proposals (section 4 of the review structure).
5. Inspect `git status` for the vault; preserve concurrent edits.

## Classify every finding before acting

Sort each finding into exactly one bucket. The bucket decides whether you act
or propose; when a finding fits two buckets, use the more conservative one.

### Bucket A — apply directly (vault-internal, reversible, evidence-based)

- Missing `area`, `priority`, or `exec_kind` on a task or objective **when the
  correct value is stated in the note body or its linked objective**. Never
  infer a value from topic alone.
- Missing `done_on` on a task whose body or a daily brief records completion
  with a date: stamp that recorded date.
- Inconsistent tag casing where one spelling is clearly dominant: normalize to
  the dominant lowercase form, preserving meaning.
- A wikilink that is ambiguous (duplicate titles) but whose intended target is
  unambiguous from context: replace it with a relative Markdown link to the
  exact file. Do not rename either note.
- A broken relative link whose target moved within the vault (verify with a
  filename search): repoint the link.
- Frontmatter that violates the simple-YAML protocol in a note **created by
  the app or an agent** (not user-authored): repair to the equivalent simple
  form, preserving every field and value.

For each applied fix, keep the diff minimal and re-read the file afterwards to
confirm the frontmatter still parses as simple YAML.

### Bucket B — propose, apply only on explicit approval in this run

- **Duplicate Wiki notes** (same article ingested twice, duplicated titles):
  propose which note to keep, what unique content to merge into it, and an
  archive destination `_Archive/03-Wiki/<filename>` for the loser. Show the
  proposal as: keep-path, merge-lines, archive-path. Apply only the approved
  ones; the archived file keeps its full original content plus an appended
  provenance line `> Archivé par vault-doctor le YYYY-MM-DD, contenu fusionné
  dans <keep-path>.`
- **Placeholder tasks** (`new-task`, `nouvelle-tache`, empty bodies): list
  them with creation date and any body text. Propose per task: give it a real
  title (when the body says what it is), mark `abandoned`, or leave. Never
  guess a title from nothing.
- **Contradictory statuses** (e.g. a task `done` whose objective says the work
  is blocked): present both sources; the user picks.
- **Renaming or splitting any note**, whatever the reason.

### Bucket C — report only, never touch

- Syncthing conflict files (`*.sync-conflict-*`): list them with both
  versions' mtimes. The user decides which wins.
- Anything in `00-System/` (Context, guardrails, budget, feeds).
- User-authored journal notes in `02-Raw/`, whatever their state.
- Findings whose fix would require deleting content with no archive step.

## Weekly maintenance proposals

For each proposal extracted from the latest weekly review:

1. Locate its exact target path; if the path no longer exists, mark the
   proposal stale.
2. Classify it into bucket A, B, or C using the same rules — a weekly proposal
   is not pre-approval for a destructive change.
3. Execute or re-propose accordingly, and record the outcome next to the
   proposal text in the ledger.

## Ledger

End with one table, one row per finding: source (lint | weekly | scan), file,
finding, bucket, action taken or proposal, resulting path(s). Follow it with
the count of findings left open and the single highest-value follow-up.

## Validate

- Re-run `npm run vault:lint`; the finding count must not have increased, and
  every bucket-A fix must have cleared its warning.
- Re-open every modified file: simple YAML frontmatter, one H1 matching the
  title, links resolve.
- Confirm every archived file exists at its archive path with its content
  intact, and that nothing was deleted outside an approved archive step.
- Confirm `git status` shows no unexpected vault changes beyond the ledger.
