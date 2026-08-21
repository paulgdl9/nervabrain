---
name: refresh-context
description: "Interview the user one question at a time to update the active system context in `vault/00-System/Context.md` (identity, current projects, goals, communication style, strengths and weaknesses). Use when the user asks to refresh, update, or review their profile, after a role or project change, or when the active context looks stale. Records only stated facts, preserves provenance, and shows a diff before writing."
---

# Refresh Context

## Goal

Bring the active profile in [System Context](../../00-System/Context.md) up to
date from what the user states now, without inventing facts and without losing
existing content or provenance. The output is one updated `Context.md` and a
clear record of what changed.

## Identity model

`Context.md` is the active profile. The
[repository operating contract](../../../CLAUDE.md) is the operating contract,
not a profile. `Context.imported.md` is the Notion import kept as provenance
only. This skill edits `Context.md` only. It never writes to the contract and
never overwrites `Context.imported.md`. See the identity and context model in
[Knowledge Operations](../../00-System/Knowledge-Operations.md).

## Load context

1. Read the [repository contract](../../../CLAUDE.md), especially the
   "No invented profile" rule.
2. Read [System Context](../../00-System/Context.md) and
   [Agent Operating Guardrails](../../00-System/Agent-Operating-Guardrails.md).
3. Note the current `Context.md` frontmatter shape, `sources`, and every
   existing section so it can be preserved.
4. Do not read or modify `Context.imported.md` except to verify provenance when
   resolving a discrepancy.

## Interview, one question at a time

Cover, in order, the areas the user wants to refresh:

- Identity: role, situation, current constraints.
- Current projects: what is active, paused, or abandoned.
- Goals: outcomes for the period the user names.
- How to communicate: language, tone, and answer style they prefer.
- Strengths and weaknesses: what helps and what gets in the way.

Rules for the interview:

- Ask exactly one question and wait for the answer before asking the next.
- Ask only about the areas the user agreed to refresh; skip the rest.
- When the user's answer is vague, ask one short clarifying question rather than
  guessing.
- If the user does not know or declines, leave the existing content unchanged
  and move on. Never fill a gap with an assumption.
- Distinguish a stated fact, an inference, and a recommendation. Record only
  stated facts as profile content.

## No invented profile

- Write only facts the user states in this session.
- Do not add biographical facts, preferences, goals, constraints, or priorities
  that the user did not state.
- Treat existing entries the user did not revisit as still valid; do not delete
  or rewrite them on a guess.
- When a new answer contradicts an existing entry, surface the contradiction and
  ask the user which to keep. Do not silently overwrite.
- Preserve stale-but-historical statements with their date and source rather
  than deleting them, unless the user explicitly retires them.

## Propose changes before writing

Before any write, show the user a summary of proposed changes:

- A per-section diff: lines to add, change, or remove, with the existing text
  shown next to the proposed text.
- For each change, the user statement it came from.
- Any unresolved contradiction still needing a decision.

Write only after the user approves. If the user approves part of the diff, apply
only the approved part.

## Write safely

Update `vault/00-System/Context.md` in place:

- Keep the existing frontmatter shape and every existing field, including
  `type`, `title`, `role`, `status`, and `sources`.
- Set `updated` to today's date in `YYYY-MM-DD` form.
- Do not change `sources` unless the user names a new provenance; never remove
  `Context.imported.md` from `sources`.
- Edit only the sections the user revised. Preserve untouched sections,
  ordering, and any unknown frontmatter fields.
- Keep one H1 aligned with the frontmatter title.
- Keep plain Markdown with simple YAML: scalars, inline arrays, or block arrays
  only. Statuses stay lowercase.
- Never write to `Context.imported.md` or to the repository `CLAUDE.md`.

## Validate

- Reopen `Context.md` and confirm the frontmatter still parses as simple YAML.
- Confirm `updated` is today and the frontmatter shape is unchanged otherwise.
- Confirm every new line traces to a statement the user made this session.
- Confirm no existing content was removed without explicit approval.
- Confirm `Context.imported.md` is untouched.
- Confirm every local Markdown link resolves and every wikilink uses an exact
  title.
- Report what changed, what was skipped, and any contradiction left for the user
  to resolve.
