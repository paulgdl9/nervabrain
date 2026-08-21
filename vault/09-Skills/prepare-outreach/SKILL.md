---
name: prepare-outreach
description: "Prepare every pending external touch for a project in one pass: reconstruct the outreach state from the project's tracking notes, draft each due follow-up, post, or reply to ready-to-send quality, and update the tracking table — without sending anything. Use when the user asks to prepare prospection, follow-ups, posts, or outreach for a project, or when open `prepare` tasks for a project have accumulated."
---

# Prepare Outreach

## Goal

Collapse the recurring cycle of small outreach tasks (check replies, draft the
relance, write the next post, update the tracking table) into one prepared
batch. The output is a set of ready-to-send drafts plus an updated tracking
note; the user's remaining work is only the human act of sending. This skill
operates strictly at `exec_kind: prepare` level: it never sends, posts, mails,
or schedules anything external.

## Scope

Run against one project in `../../08-Projects/<project>/`, named by the user.
If the user names none and exactly one project has open outreach-flavored
tasks, use it and say so; if several qualify, ask.

## Load context

1. Read the [repository contract](../../../CLAUDE.md) and
   [Agent Operating Guardrails](../../00-System/Agent-Operating-Guardrails.md),
   especially the `prepare` boundary.
2. Read the project's `CLAUDE.md`, `Project.md`, `Process.md`, and
   `Feedback.md` for the current positioning, message, and cadence decisions.
3. Read every tracking or asset note in the project folder: prospect tables
   (e.g. `Prospects-suivi.md`), message templates (e.g. `Cold-mail-v2.md`),
   content calendars (e.g. `X-posts-juillet.md`), and any note the project
   contract designates for outreach.
4. List open tasks in `../../05-Tasks/` whose title or `objective` ties them
   to this project and whose action is outreach-shaped (relance, post, mail,
   réponse, métriques).
5. Read the last 3 daily briefs for outreach follow-ups already flagged.

## 1. Reconstruct the state

Build one table from the tracking notes and tasks, one row per prospect or
channel: last touch (what, date), recorded response state, and the next touch
the project's own cadence implies. Only recorded facts enter the table; when a
row's state is unknown (e.g. "sent, no reply logged since"), mark it
`état non consigné` rather than assuming silence or interest.

Surface contradictions between the tracking note and task statuses (a task
says the relance went out, the table does not) before drafting anything on top
of them.

## 2. Draft every due touch

For each row whose next touch is due, and for each open `prepare` task:

- Draft the full artifact in French unless the recorded target audience calls
  for English: complete mail body with subject line, complete post text, or
  reply — not an outline. Reuse the project's recorded templates and voice;
  where a template has variants, pick one and say why in one line.
- Ground every claim in the draft in project inputs (a real scan finding, a
  recorded metric). If a needed fact is missing, write
  `Information absente des notes internes` in the draft's notes and leave a
  clearly marked `[À COMPLÉTER: ...]` slot instead of inventing it.
- Write the draft into the task body when a task exists, otherwise into the
  project's relevant asset note under a dated heading. End each with
  `Prêt à envoyer : <exact remaining human action>` (e.g. "coller dans Gmail
  et envoyer à <contact>").
- Leave every such task `status: todo` or `doing`. Never mark a `prepare` task
  done: sending is the user's act.

## 3. Prepare the measurement side

For due metric checks (post stats, bounces, replies) that require an external
account, prepare the checklist instead: what to open, which numbers to record,
and add matching empty fields in the tracking note so the user only fills
values. Where results are already logged in the vault, record them directly
(that is `verify`-class work) and cite the source.

## 4. Update the tracking note

Update the project's tracking table in place: one new or updated row per
prepared touch with today's date and state `préparé`. Preserve every existing
row and column; append columns only if the note already lacks a place for
prepared-state. Set `updated` in the note's frontmatter.

## Report

End with a ledger: one row per prepared item — prospect/channel, artifact
drafted, where it was written, and the exact remaining human action. Then list
contradictions found, `[À COMPLÉTER]` slots awaiting a fact, and the single
next cadence decision the user should record in `Process.md` if the current
one is ambiguous.

## Validate

- Confirm no external system was touched: no mail, post, API call, or
  scheduler — drafts and vault edits only.
- Confirm every draft cites its supporting note and contains no invented
  claim, metric, or personal fact.
- Confirm every touched note still has simple YAML frontmatter, an updated
  `updated` field, and resolving links.
- Confirm every prepared task carries a `Prêt à envoyer :` line and an
  unchanged open status.
